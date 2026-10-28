import Foundation
import SwiftData

@Model
final class Workout {
    var date: Date
    @Relationship(deleteRule: .cascade) var sets: [LiftSet] = []

    init(date: Date = .now) { self.date = date }
}

@Model
final class LiftSet {
    var createdAt: Date
    var exercise: String
    var weightKg: Double
    var targetReps: Int
    var reps: [Rep] = []

    init(createdAt: Date = .now, exercise: String, weightKg: Double, targetReps: Int) {
        self.createdAt = createdAt
        self.exercise = exercise
        self.weightKg = weightKg
        self.targetReps = targetReps
    }

    var bestVelocity: Double { reps.map(\.meanVelocity).max() ?? 0 }
    var bestPower: Double { reps.map(\.power).max() ?? 0 }
    var averageRangeOfMotionCm: Double {
        guard !reps.isEmpty else { return 0 }
        return reps.map(\.rangeOfMotionCm).reduce(0, +) / Double(reps.count)
    }
}

struct Rep: Codable, Hashable {
    /// `0x02`: Mean concentric velocity (m/s) — "Movement power (m/s)".
    var meanVelocity: Double
    /// `0x03`: Mean propulsive velocity (m/s).
    var propulsiveVelocity: Double
    /// `0x04`: Mean positive propulsive acceleration (m/s²).
    var propulsiveAcceleration: Double
    /// `0x05`: Upward Range of Motion (cm) — "Range of motion".
    var rangeOfMotionCm: Double
    /// `0x06`: Mean eccentric velocity (m/s) — "Controlled lowering (m/s)".
    /// Green zone in official app: 0.20 ... 0.60 m/s; Red zone: > 0.60 m/s.
    var loweringVelocity: Double?
    /// Mechanical power in Watts: P = m * (g + 0.58 * a_prop) * v.
    var power: Double

    var isLoweringControlled: Bool? {
        guard let v = loweringVelocity else { return nil }
        return (0.20...0.60).contains(v)
    }

    init(meanVelocity: Double,
         propulsiveVelocity: Double,
         propulsiveAcceleration: Double,
         rangeOfMotionCm: Double,
         loweringVelocity: Double? = nil,
         weightKg: Double) {
        self.meanVelocity = meanVelocity
        self.propulsiveVelocity = propulsiveVelocity
        self.propulsiveAcceleration = propulsiveAcceleration
        self.rangeOfMotionCm = rangeOfMotionCm
        self.loweringVelocity = loweringVelocity
        self.power = weightKg * (9.80665 + 0.58 * propulsiveAcceleration) * meanVelocity
    }
}

enum CSVExporter {
    static func export(workouts: [Workout]) -> String {
        var lines = [
            "date,time,exercise,set_number,weight_kg,target_reps,rep_number,movement_power_m_s,movement_power_w,controlled_lowering_m_s,lowering_status,rom_cm"
        ]
        let dateFmt = ISO8601DateFormatter()
        dateFmt.formatOptions = [.withFullDate]
        let timeFmt = ISO8601DateFormatter()
        timeFmt.formatOptions = [.withTime, .withColonSeparatorInTime]

        let sortedWorkouts = workouts.sorted { $0.date < $1.date }
        for workout in sortedWorkouts {
            let sortedSets = workout.sets.sorted { $0.createdAt < $1.createdAt }
            for (setIdx, set) in sortedSets.enumerated() {
                let dStr = dateFmt.string(from: workout.date)
                let tStr = timeFmt.string(from: set.createdAt)
                let escapedExercise = "\"\(set.exercise.replacingOccurrences(of: "\"", with: "\"\""))\""
                for (repIdx, rep) in set.reps.enumerated() {
                    let lowStr = rep.loweringVelocity.map { String(format: "%.3f", $0) } ?? ""
                    let statusStr: String
                    if let ok = rep.isLoweringControlled {
                        statusStr = ok ? "GREEN" : "RED"
                    } else {
                        statusStr = ""
                    }
                    let line = String(
                        format: "%@,%@,%@,%d,%.1f,%d,%d,%.3f,%.2f,%@,%@,%.1f",
                        dStr, tStr, escapedExercise,
                        setIdx + 1, set.weightKg, set.targetReps, repIdx + 1,
                        rep.meanVelocity, rep.power, lowStr, statusStr, rep.rangeOfMotionCm
                    )
                    lines.append(line)
                }
            }
        }
        return lines.joined(separator: "\n")
    }
}
