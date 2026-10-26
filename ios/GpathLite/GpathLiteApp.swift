import SwiftData
import SwiftUI

@main
struct GpathLiteApp: App {
    @State private var pin = PinConnection()

    var body: some Scene {
        WindowGroup {
            TabView {
                LiveSetView().tabItem { Label("Lift", systemImage: "figure.strengthtraining.traditional") }
                HistoryView().tabItem { Label("History", systemImage: "list.bullet") }
            }
            .environment(pin)
        }
        .modelContainer(for: Workout.self)
    }
}

struct LiveSetView: View {
    @Environment(PinConnection.self) private var pin
    @Environment(\.modelContext) private var context
    @State private var exercise = "Squat"
    @State private var weightKg = 100.0
    @State private var reps: [Rep] = []

    var body: some View {
        VStack(spacing: 16) {
            Text(String(describing: pin.state).capitalized).font(.caption)

            HStack {
                TextField("Exercise", text: $exercise)
                TextField("kg", value: $weightKg, format: .number).keyboardType(.decimalPad).frame(width: 80)
            }
            .textFieldStyle(.roundedBorder)

            Text(reps.last.map { String(format: "%.2f m/s", $0.meanVelocity) } ?? "-- m/s")
                .font(.system(size: 64, weight: .bold, design: .rounded))
            Text(reps.last.map { String(format: "%.0f W", $0.power) } ?? "-- W").font(.title)
            Text("Reps: \(reps.count)").font(.title2)

            List(Array(reps.enumerated()), id: \.offset) { i, rep in
                Text(String(format: "#%d  %.2f m/s  %.0f W", i + 1, rep.meanVelocity, rep.power))
            }

            Button("Finish set", action: finishSet).buttonStyle(.borderedProminent).disabled(reps.isEmpty)
        }
        .padding()
        .onAppear {
            pin.onPacket = { packet in
                if case let .rep(mean, peak, power) = packet {
                    reps.append(Rep(meanVelocity: mean, peakVelocity: peak, power: power))
                }
            }
        }
    }

    private func finishSet() {
        let set = LiftSet(exercise: exercise, weightKg: weightKg)
        set.reps = reps
        let workout = Workout()
        workout.sets.append(set)
        context.insert(workout)
        reps = []
    }
}

struct HistoryView: View {
    @Query(sort: \Workout.date, order: .reverse) private var workouts: [Workout]

    var body: some View {
        NavigationStack {
            List(workouts) { workout in
                Section(workout.date.formatted(date: .abbreviated, time: .shortened)) {
                    ForEach(workout.sets) { set in
                        Text(String(format: "%@  %.1f kg × %d  best %.2f m/s",
                                    set.exercise, set.weightKg, set.reps.count, set.bestMeanVelocity))
                    }
                }
            }
            .navigationTitle("History")
        }
    }
}
