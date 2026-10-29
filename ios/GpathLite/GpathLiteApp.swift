import AVFoundation
import AudioToolbox
import SwiftData
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct GpathLiteApp: App {
    @State private var pin = PinConnection()

    var body: some Scene {
        WindowGroup {
            TabView {
                LiveSetView()
                    .tabItem { Label("Treeni", systemImage: "figure.strengthtraining.traditional") }
                HistoryView()
                    .tabItem { Label("Kalenteri & CSV", systemImage: "calendar") }
            }
            .environment(pin)
        }
        .modelContainer(for: Workout.self)
    }
}

// MARK: - Audio & Haptic Feedback (ignores iOS silent switch via AVAudioSession .playback)

enum SoundFeedback {
    private static var activePlayer: AVAudioPlayer?

    private static func playTone(frequency: Double, durationMs: Int) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)

        let sampleRate = 22050
        let numSamples = max(1, (sampleRate * durationMs) / 1000)
        var pcm = [Int16](repeating: 0, count: numSamples)
        for i in 0..<numSamples {
            let t = Double(i) / Double(sampleRate)
            let env = exp(-3.0 * Double(i) / Double(numSamples))
            let val = sin(2.0 * .pi * frequency * t) * env * 0.45
            pcm[i] = Int16(max(-1.0, min(1.0, val)) * Double(Int16.max))
        }

        let dataSize = UInt32(numSamples * 2)
        var wav = Data()
        wav.append("RIFF".data(using: .ascii)!)
        var chunkSize = (36 + dataSize).littleEndian
        wav.append(Data(bytes: &chunkSize, count: 4))
        wav.append("WAVEfmt ".data(using: .ascii)!)
        var fmtLen = UInt32(16).littleEndian
        var audioFmt = UInt16(1).littleEndian
        var channels = UInt16(1).littleEndian
        var sr = UInt32(sampleRate).littleEndian
        var byteRate = UInt32(sampleRate * 2).littleEndian
        var blockAlign = UInt16(2).littleEndian
        var bitsPerSample = UInt16(16).littleEndian
        wav.append(Data(bytes: &fmtLen, count: 4))
        wav.append(Data(bytes: &audioFmt, count: 2))
        wav.append(Data(bytes: &channels, count: 2))
        wav.append(Data(bytes: &sr, count: 4))
        wav.append(Data(bytes: &byteRate, count: 4))
        wav.append(Data(bytes: &blockAlign, count: 2))
        wav.append(Data(bytes: &bitsPerSample, count: 2))
        wav.append("data".data(using: .ascii)!)
        var subchunk2Size = dataSize.littleEndian
        wav.append(Data(bytes: &subchunk2Size, count: 4))
        pcm.withUnsafeBufferPointer { ptr in
            wav.append(UnsafeBufferPointer(start: UnsafeRawPointer(ptr.baseAddress!)
                .assumingMemoryBound(to: UInt8.self), count: Int(dataSize)))
        }

        if let player = try? AVAudioPlayer(data: wav) {
            activePlayer = player
            player.play()
        } else {
            AudioServicesPlaySystemSound(1057)
        }
    }

    /// Short confirmation tone when sensor zeroing (`0x83`) completes.
    static func playReady(enabled: Bool) {
        guard enabled else { return }
        playTone(frequency: 784.0, durationMs: 180)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// Beep when a rep concentric phase completes.
    static func playRep(enabled: Bool) {
        guard enabled else { return }
        playTone(frequency: 880.0, durationMs: 130)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// Distinct fanfare when the target rep count is reached.
    static func playTargetReached(enabled: Bool) {
        guard enabled else { return }
        playTone(frequency: 1046.5, durationMs: 260)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// Warning feedback when controlled lowering is too fast (> 0.60 m/s).
    static func playLoweringWarning(enabled: Bool) {
        guard enabled else { return }
        playTone(frequency: 240.0, durationMs: 220)
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}

// MARK: - Transferable CSV Document for ShareLink

struct CSVDocument: Transferable {
    let text: String
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .commaSeparatedText) { doc in
            Data(doc.text.utf8)
        }
        .suggestedFileName { $0.filename }
    }
}

// MARK: - Persisted Exercise Catalogue

enum ExerciseStore {
    private static let key = "savedExercises"
    static let defaults = [
        "Jalkakyykky",
        "Penkkipunnerrus",
        "Sotilaspenkkipunnerrus",
        "Maastaveto",
        "Ylätalja (Lat Pulldown)",
        "Alatalja (Seated Row)",
        "Rintaprässi (Chest Press)",
        "Pystypunnerrus (Shoulder Press)",
        "Ojentajat taljassa (Triceps Pushdown)",
        "Hauiskääntö taljassa (Cable Curl)",
        "Jalkaprässi (Leg Press)",
        "Reiden ojennus (Leg Extension)",
        "Reiden koukistus (Leg Curl)"
    ]

    static func load() -> [String] {
        if let saved = UserDefaults.standard.stringArray(forKey: key), !saved.isEmpty {
            let topDefaults = ["Jalkakyykky", "Penkkipunnerrus", "Sotilaspenkkipunnerrus", "Maastaveto"]
            let missing = topDefaults.filter { !saved.contains($0) }
            if !missing.isEmpty {
                let merged = missing + saved
                save(merged)
                return merged
            }
            return saved
        }
        return defaults
    }

    static func save(_ list: [String]) {
        UserDefaults.standard.set(list, forKey: key)
    }
}

// MARK: - Live Training View

struct LiveSetView: View {
    @Environment(PinConnection.self) private var pin
    @Environment(\.modelContext) private var context
    @Query(sort: \Workout.date, order: .reverse) private var workouts: [Workout]

    @State private var workoutDate: Date = .now
    @State private var exercises: [String] = ExerciseStore.load()
    @State private var selectedExercise: String = ExerciseStore.load().first ?? "Ylätalja (Lat Pulldown)"
    @State private var weightKg: Double = 8.0
    @State private var targetReps: Int = 10
    @State private var soundEnabled: Bool = true
    @State private var showingExerciseSheet: Bool = false

    @State private var reps: [Rep] = []
    @State private var currentSetSaved: Bool = false
    @State private var assembler = PinProtocol.RepAssembler()

    private var completedSetsToday: Int {
        let cal = Calendar.current
        let targetDay = cal.startOfDay(for: workoutDate)
        return workouts.first(where: { cal.isDate($0.date, inSameDayAs: targetDay) })?.sets.count ?? 0
    }

    private var activeSetNumber: Int {
        if currentSetSaved && !reps.isEmpty {
            return max(1, completedSetsToday)
        }
        return completedSetsToday + 1
    }

    private var avgRomCm: Double {
        guard !reps.isEmpty else { return 0 }
        return reps.map(\.rangeOfMotionCm).reduce(0, +) / Double(reps.count)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                // Status bar: BLE state, battery, sound toggle
                HStack {
                    Circle()
                        .fill(pin.state == .ready ? Color.green : Color.orange)
                        .frame(width: 10, height: 10)
                    Text(pin.state.rawValue)
                        .font(.caption.bold())
                    if let battery = pin.batteryPercent {
                        Text(String(format: "• %.0f%%", battery))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        soundEnabled.toggle()
                        if soundEnabled { SoundFeedback.playRep(enabled: true) }
                    } label: {
                        Image(systemName: soundEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                }

                // Pre-set settings: Date, Exercise, Weight (kg), Target Reps on separate rows so nothing clips
                VStack(spacing: 8) {
                    HStack {
                        DatePicker("Päivä", selection: $workoutDate, displayedComponents: .date)
                            .labelsHidden()
                        Spacer()
                        Picker("Liike", selection: $selectedExercise) {
                            ForEach(exercises, id: \.self) { ex in
                                Text(ex).tag(ex)
                            }
                        }
                        .pickerStyle(.menu)
                        Button {
                            showingExerciseSheet = true
                        } label: {
                            Label("Liikkeet", systemImage: "plus.circle.fill")
                                .labelStyle(.iconOnly)
                        }
                    }

                    HStack {
                        Text("Paino (kg)").font(.caption.bold()).foregroundStyle(.secondary)
                        Spacer()
                        HStack(spacing: 4) {
                            Button("-2.5") { weightKg = max(0, weightKg - 2.5) }.buttonStyle(.bordered)
                            Button("-1") { weightKg = max(0, weightKg - 1) }.buttonStyle(.bordered)
                            TextField("kg", value: $weightKg, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.center)
                                .frame(width: 56)
                                .textFieldStyle(.roundedBorder)
                            Button("+1") { weightKg += 1 }.buttonStyle(.bordered)
                            Button("+2.5") { weightKg += 2.5 }.buttonStyle(.bordered)
                        }
                    }

                    HStack {
                        Text("Tavoitetoistot").font(.caption.bold()).foregroundStyle(.secondary)
                        Spacer()
                        Stepper("\(targetReps) toistoa", value: $targetReps, in: 1...100)
                            .font(.subheadline.bold())
                            .fixedSize()
                    }
                }
                .padding(10)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

                // Live metrics card: Movement power (m/s & W), Controlled lowering, Avg ROM
                VStack(spacing: 6) {
                    Text(reps.last.map { String(format: "%.2f m/s", $0.meanVelocity) } ?? "-- m/s")
                        .font(.system(size: 54, weight: .bold, design: .rounded))
                    Text(reps.last.map { String(format: "%.2f W", $0.power) } ?? "-- W")
                        .font(.title2.bold())

                    HStack(spacing: 28) {
                        VStack {
                            Text("Controlled Lowering").font(.caption).foregroundStyle(.secondary)
                            Text(reps.last?.loweringVelocity.map { String(format: "%.2f m/s", $0) } ?? "-- m/s")
                                .font(.headline)
                                .foregroundStyle(loweringColor(for: reps.last))
                        }
                        VStack {
                            Text("Avg ROM").font(.caption).foregroundStyle(.secondary)
                            Text(reps.isEmpty ? "-- cm" : String(format: "%.0f cm", avgRomCm))
                                .font(.headline)
                        }
                    }
                    .padding(.top, 4)
                }

                // Rep counter & target progress
                HStack {
                    Text("Sarja #\(activeSetNumber) • Toistot: \(reps.count) / \(targetReps)")
                        .font(.headline)
                        .foregroundStyle(reps.count >= targetReps ? .green : .primary)
                    Spacer()
                    ProgressView(value: min(Double(reps.count), Double(targetReps)),
                                 total: Double(max(targetReps, 1)))
                        .frame(width: 110)
                        .tint(reps.count >= targetReps ? .green : .accentColor)
                }

                // Per-rep list
                List(Array(reps.enumerated()), id: \.offset) { i, rep in
                    HStack {
                        Text(String(format: "#%d  %.2f m/s  %.1f W", i + 1, rep.meanVelocity, rep.power))
                        Spacer()
                        if let low = rep.loweringVelocity {
                            Text(String(format: "↓ %.2f m/s", low))
                                .foregroundStyle(rep.isLoweringControlled == true ? .green : .red)
                        }
                        Text(String(format: "%.0f cm", rep.rangeOfMotionCm))
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline.monospacedDigit())
                }
                .listStyle(.plain)

                // Action buttons
                HStack(spacing: 12) {
                    if pin.state == .ready || pin.state == .zeroing {
                        Button("⏹ Lopeta sarja #\(completedSetsToday + 1)") {
                            stopAndSaveCurrentSet()
                        }
                        .buttonStyle(.bordered)
                        .tint(.red)
                    } else {
                        Button("▶ Aloita sarja #\(completedSetsToday + 1)") {
                            beginNewSet()
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Button("🏁 Lopeta treeni", action: finishSet)
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(reps.isEmpty && completedSetsToday == 0)
                }
            }
            .padding()
            .navigationTitle("Gpath Lite")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showingExerciseSheet) {
                ExerciseManagerSheet(exercises: $exercises, selectedExercise: $selectedExercise)
            }
            .onAppear {
                pin.onPacket = { packet in
                    if case .ack(0x03) = packet, pin.state == .ready {
                        SoundFeedback.playReady(enabled: soundEnabled)
                    }
                    guard pin.state == .ready else { return }
                    guard let event = assembler.ingest(packet, weightKg: weightKg) else { return }
                    switch event {
                    case .concentricCompleted(let rep):
                        reps.append(rep)
                        if reps.count == targetReps {
                            SoundFeedback.playTargetReached(enabled: soundEnabled)
                        } else {
                            SoundFeedback.playRep(enabled: soundEnabled)
                        }
                    case .loweringCompleted(let eccVelocity):
                        if !reps.isEmpty {
                            reps[reps.count - 1].loweringVelocity = eccVelocity
                            if reps[reps.count - 1].isLoweringControlled == false {
                                SoundFeedback.playLoweringWarning(enabled: soundEnabled)
                            }
                        }
                    }
                }
            }
        }
    }

    private func loweringColor(for rep: Rep?) -> Color {
        guard let controlled = rep?.isLoweringControlled else { return .primary }
        return controlled ? .green : .red
    }

    private func saveSetToStoreIfNeeded() {
        guard !reps.isEmpty, !currentSetSaved else { return }
        let cal = Calendar.current
        let targetDay = cal.startOfDay(for: workoutDate)
        let workout: Workout
        if let existing = workouts.first(where: { cal.isDate($0.date, inSameDayAs: targetDay) }) {
            workout = existing
        } else {
            workout = Workout(date: targetDay)
            context.insert(workout)
        }
        let set = LiftSet(createdAt: .now, exercise: selectedExercise, weightKg: weightKg, targetReps: targetReps)
        set.reps = reps
        workout.sets.append(set)
        currentSetSaved = true
    }

    private func beginNewSet() {
        if !reps.isEmpty {
            saveSetToStoreIfNeeded()
            reps = []
            currentSetSaved = false
        }
        assembler = PinProtocol.RepAssembler()
        pin.startSet()
    }

    private func stopAndSaveCurrentSet() {
        pin.stopSet()
        saveSetToStoreIfNeeded()
    }

    private func finishSet() {
        pin.stopSet()
        saveSetToStoreIfNeeded()
        reps = []
        currentSetSaved = false
    }
}

// MARK: - Exercise Manager Sheet

struct ExerciseManagerSheet: View {
    @Binding var exercises: [String]
    @Binding var selectedExercise: String
    @Environment(\.dismiss) private var dismiss
    @State private var newExercise = ""

    private func addExercise() {
        let trimmed = newExercise.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if !exercises.contains(trimmed) {
            exercises.insert(trimmed, at: 0)
            ExerciseStore.save(exercises)
        }
        selectedExercise = trimmed
        newExercise = ""
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Lisää uusi liike") {
                    HStack {
                        TextField("Esim. Ristikkäistalja", text: $newExercise)
                            .submitLabel(.done)
                            .onSubmit(addExercise)
                        Button("Lisää", action: addExercise)
                            .disabled(newExercise.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Section("Liikkeet (napauta valitaksesi)") {
                    ForEach(exercises, id: \.self) { ex in
                        HStack {
                            Text(ex)
                            Spacer()
                            if ex == selectedExercise {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedExercise = ex
                            dismiss()
                        }
                    }
                    .onDelete { offsets in
                        exercises.remove(atOffsets: offsets)
                        ExerciseStore.save(exercises)
                        if !exercises.contains(selectedExercise), let first = exercises.first {
                            selectedExercise = first
                        }
                    }
                }
            }
            .navigationTitle("Valitse liike")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Valmis") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Calendar & CSV Export View

struct HistoryView: View {
    @Query(sort: \Workout.date, order: .reverse) private var workouts: [Workout]
    @State private var selectedDate: Date = .now
    @State private var filterByDate: Bool = true

    private var filteredWorkouts: [Workout] {
        guard filterByDate else { return workouts }
        let cal = Calendar.current
        return workouts.filter { cal.isDate($0.date, inSameDayAs: selectedDate) }
    }

    private var csvDocumentForSelection: CSVDocument {
        let list = filteredWorkouts.isEmpty ? workouts : filteredWorkouts
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withFullDate]
        let name = filterByDate ? "gpath_\(fmt.string(from: selectedDate)).csv" : "gpath_all_workouts.csv"
        return CSVDocument(text: CSVExporter.export(workouts: list), filename: name)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                DatePicker("Valitse päivä", selection: $selectedDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .padding(.horizontal)

                Toggle("Näytä vain valitun päivän treenit", isOn: $filterByDate)
                    .font(.subheadline)
                    .padding(.horizontal)

                if filteredWorkouts.isEmpty {
                    ContentUnavailableView("Ei tallennettuja sarjoja",
                                           systemImage: "dumbbell",
                                           description: Text("Tee sarja Treeni-välilehdellä ja paina Tallenna sarja."))
                } else {
                    List {
                        ForEach(filteredWorkouts) { workout in
                            Section(workout.date.formatted(date: .abbreviated, time: .omitted)) {
                                ForEach(workout.sets.sorted(by: { $0.createdAt < $1.createdAt })) { set in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            Text(set.exercise).font(.headline)
                                            Spacer()
                                            Text(String(format: "%.1f kg • %d/%d toistoa",
                                                        set.weightKg, set.reps.count, set.targetReps))
                                                .font(.subheadline)
                                                .foregroundStyle(.secondary)
                                        }
                                        Text(String(format: "Paras: %.2f m/s (%.1f W) • Avg ROM %.0f cm",
                                                    set.bestVelocity, set.bestPower, set.averageRangeOfMotionCm))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Kalenteri & Historia")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(
                        item: csvDocumentForSelection,
                        preview: SharePreview(csvDocumentForSelection.filename)
                    ) {
                        Label("Vie CSV", systemImage: "square.and.arrow.up")
                    }
                    .disabled(workouts.isEmpty)
                }
            }
        }
    }
}
