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

    /// Theoretical 1RM using Epley's formula: 1RM = w * (1 + r / 30.0) for r > 1, and w for r == 1.
    static func epley1RM(weightKg: Double, reps: Int) -> Double? {
        guard weightKg > 0, reps > 0 else { return nil }
        if reps == 1 { return weightKg }
        return weightKg * (1.0 + Double(reps) / 30.0)
    }

    var estimated1RM: Double? {
        Self.epley1RM(weightKg: weightKg, reps: reps.count)
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

// MARK: - VBT (Velocity-Based Training) Profiles (Squat, Bench Press, Military Bench, Deadlift)

struct VBTZone: Identifiable, Hashable {
    let id: String
    let label: String
    let subLabel: String
    let rangeText: String
    let minVel: Double
    let maxVel: Double
    let icon: String
}

struct VBTProfile {
    let id: String
    let mvt: Double
    let mvtText: String
    let zones: [VBTZone]

    static let squat = VBTProfile(
        id: "squat",
        mvt: 0.23,
        mvtText: "1RM kynnys (MVT): ~0.23 m/s",
        zones: [
            VBTZone(id: "max", label: "Maksimivoima", subLabel: "85–100% 1RM", rangeText: "0.23 – 0.50 m/s", minVel: 0.01, maxVel: 0.50, icon: "🔴"),
            VBTZone(id: "acc", label: "Perus- / kiihdyttävä voima", subLabel: "65–85% 1RM", rangeText: "0.50 – 0.75 m/s", minVel: 0.50, maxVel: 0.75, icon: "🟠"),
            VBTZone(id: "str-spd", label: "Nopeusvoima (Voimapainotteinen)", subLabel: "45–65% 1RM", rangeText: "0.75 – 1.00 m/s", minVel: 0.75, maxVel: 1.00, icon: "🟢"),
            VBTZone(id: "spd-str", label: "Nopeusvoima (Räjähtävä)", subLabel: "30–45% 1RM", rangeText: "1.00 – 1.30+ m/s", minVel: 1.00, maxVel: 99.0, icon: "⚡")
        ]
    )

    static let bench = VBTProfile(
        id: "bench",
        mvt: 0.15,
        mvtText: "1RM kynnys (MVT): ~0.15 m/s",
        zones: [
            VBTZone(id: "max", label: "Maksimivoima", subLabel: "85–100% 1RM", rangeText: "0.15 – 0.45 m/s", minVel: 0.01, maxVel: 0.45, icon: "🔴"),
            VBTZone(id: "acc", label: "Perus- / kiihdyttävä voima", subLabel: "65–85% 1RM", rangeText: "0.45 – 0.75 m/s", minVel: 0.45, maxVel: 0.75, icon: "🟠"),
            VBTZone(id: "str-spd", label: "Nopeusvoima (Voimapainotteinen)", subLabel: "45–65% 1RM", rangeText: "0.75 – 0.95 m/s", minVel: 0.75, maxVel: 0.95, icon: "🟢"),
            VBTZone(id: "spd-str", label: "Nopeusvoima (Räjähtävä)", subLabel: "30–45% 1RM", rangeText: "0.95 – 1.30+ m/s", minVel: 0.95, maxVel: 99.0, icon: "⚡")
        ]
    )

    static let deadlift = VBTProfile(
        id: "deadlift",
        mvt: 0.14,
        mvtText: "1RM kynnys (MVT): ~0.14 m/s",
        zones: [
            VBTZone(id: "max", label: "Maksimivoima", subLabel: "85–100% 1RM", rangeText: "0.14 – 0.45 m/s", minVel: 0.01, maxVel: 0.45, icon: "🔴"),
            VBTZone(id: "acc", label: "Perus- / kiihdyttävä voima", subLabel: "65–85% 1RM", rangeText: "0.45 – 0.70 m/s", minVel: 0.45, maxVel: 0.70, icon: "🟠"),
            VBTZone(id: "str-spd", label: "Nopeusvoima (Voimapainotteinen)", subLabel: "50–65% 1RM", rangeText: "0.70 – 0.90 m/s", minVel: 0.70, maxVel: 0.90, icon: "🟢"),
            VBTZone(id: "spd-str", label: "Nopeusvoima (Räjähtävä)", subLabel: "30–50% 1RM", rangeText: "0.90 – 1.20+ m/s", minVel: 0.90, maxVel: 99.0, icon: "⚡")
        ]
    )

    static func forExercise(_ exerciseName: String) -> VBTProfile? {
        let s = exerciseName.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if s.contains("kyykky") || s.contains("squat") { return .squat }
        if s.contains("penkki") || s.contains("bench") { return .bench }
        if s.contains("maastaveto") || s.contains("mave") || s.contains("deadlift") { return .deadlift }
        return nil
    }

    static func classify(exercise: String, velocity: Double) -> VBTZone? {
        guard let profile = forExercise(exercise), velocity > 0 else { return nil }
        for z in profile.zones where velocity >= z.minVel && velocity < z.maxVel {
            return z
        }
        return profile.zones.last
    }
}

enum CSVExporter {
    static func export(workouts: [Workout]) -> String {
        var lines = [
            "date,time,exercise,set_number,weight_kg,target_reps,rep_number,movement_power_m_s,movement_power_w,vbt_strength_zone,controlled_lowering_m_s,lowering_status,rom_cm,epley_1rm_kg"
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
                let rmStr = set.estimated1RM.map { String(format: "%.1f", $0) } ?? ""
                for (repIdx, rep) in set.reps.enumerated() {
                    let lowStr = rep.loweringVelocity.map { String(format: "%.3f", $0) } ?? ""
                    let statusStr: String
                    if let ok = rep.isLoweringControlled {
                        statusStr = ok ? "GREEN" : "RED"
                    } else {
                        statusStr = ""
                    }
                    let zoneStr = VBTProfile.classify(exercise: set.exercise, velocity: rep.meanVelocity)
                        .map { "\"\($0.label)\"" } ?? ""
                    let line = String(
                        format: "%@,%@,%@,%d,%.1f,%d,%d,%.3f,%.2f,%@,%@,%@,%.1f,%@",
                        dStr, tStr, escapedExercise,
                        setIdx + 1, set.weightKg, set.targetReps, repIdx + 1,
                        rep.meanVelocity, rep.power, zoneStr, lowStr, statusStr, rep.rangeOfMotionCm, rmStr
                    )
                    lines.append(line)
                }
            }
        }
        return lines.joined(separator: "\n")
    }
}
