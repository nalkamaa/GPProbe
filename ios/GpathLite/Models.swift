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
    var exercise: String
    var weightKg: Double
    var reps: [Rep] = []

    init(exercise: String, weightKg: Double) {
        self.exercise = exercise
        self.weightKg = weightKg
    }

    var bestMeanVelocity: Double { reps.map(\.meanVelocity).max() ?? 0 }
}

struct Rep: Codable, Hashable {
    var meanVelocity: Double
    var peakVelocity: Double
    var power: Double
}
