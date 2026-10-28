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

// MARK: - Audio & Haptic Feedback

enum SoundFeedback {
    /// Short confirmation tone when sensor zeroing (`0x83`) completes.
    static func playReady(enabled: Bool) {
        guard enabled else { return }
        AudioServicesPlaySystemSound(1113)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// Beep when a rep concentric phase completes.
    static func playRep(enabled: Bool) {
        guard enabled else { return }
        AudioServicesPlaySystemSound(1057)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// Distinct fanfare when the target rep count is reached.
    static func playTargetReached(enabled: Bool) {
        guard enabled else { return }
        AudioServicesPlaySystemSound(1025)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// Warning feedback when controlled lowering is too fast (> 0.60 m/s).
    static func playLoweringWarning(enabled: Bool) {
        guard enabled else { return }
        AudioServicesPlaySystemSound(1053)
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
    @State private var assembler = PinProtocol.RepAssembler()

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
                    } label: {
                        Image(systemName: soundEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                }

                // Pre-set settings: Date, Exercise, Weight (kg), Target Reps
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
                            Image(systemName: "plus.circle")
                        }
                    }

                    HStack(spacing: 12) {
                        HStack(spacing: 4) {
                            Button("-1") { weightKg = max(0, weightKg - 1) }.buttonStyle(.bordered)
                            TextField("kg", value: $weightKg, format: .number)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.center)
                                .frame(width: 60)
                                .textFieldStyle(.roundedBorder)
                            Text("kg").font(.caption).foregroundStyle(.secondary)
                            Button("+1") { weightKg += 1 }.buttonStyle(.bordered)
                        }

                        Spacer()

                        Stepper("Tavoite: \(targetReps)", value: $targetReps, in: 1...50)
                            .font(.subheadline.bold())
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
                    Text("Toistot: \(reps.count) / \(targetReps)")
                        .font(.headline)
                        .foregroundStyle(reps.count >= targetReps ? .green : .primary)
                    Spacer()
                    ProgressView(value: min(Double(reps.count), Double(targetReps)),
                                 total: Double(max(targetReps, 1)))
                        .frame(width: 140)
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
                        Button("⏹ Lopeta sarja") {
                            pin.stopSet()
                        }
                        .buttonStyle(.bordered)
                        .tint(.red)
                    } else {
                        Button("▶ Aloita sarja") {
                            pin.startSet()
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Button("Tallenna sarja", action: finishSet)
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(reps.isEmpty)
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
                    if case .ack(0x03) = packet {
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

    private func finishSet() {
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
        reps = []
        pin.stopSet()
    }
}

// MARK: - Exercise Manager Sheet

struct ExerciseManagerSheet: View {
    @Binding var exercises: [String]
    @Binding var selectedExercise: String
    @Environment(\.dismiss) private var dismiss
    @State private var newExercise = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Lisää uusi liike") {
                    HStack {
                        TextField("Esim. Ristikkäistalja", text: $newExercise)
                        Button("Lisää") {
                            let trimmed = newExercise.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !trimmed.isEmpty else { return }
                            if !exercises.contains(trimmed) {
                                exercises.append(trimmed)
                                ExerciseStore.save(exercises)
                            }
                            selectedExercise = trimmed
                            newExercise = ""
                        }
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
