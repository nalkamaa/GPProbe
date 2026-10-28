import CoreBluetooth
import Foundation

/// Gpath Pin BLE protocol (`GPATH_Sensor`, `FW-2.82-BETA`).
/// Verified from Android btsnoop captures and raw 80 Hz trace (`0xA4`) on 2026-10-28.
enum PinProtocol {
    /// Case-insensitive advertised name prefix (`GPATH_Sensor`).
    static let namePrefix = "GPATH"

    static let service = CBUUID(string: "4FAFC201-1FB5-459E-8FCC-C5C9C331914B")
    static let dataCharacteristic = CBUUID(string: "BEB5483E-36E1-4688-B7F5-EA07361B2688")

    /// Single-byte commands written with response to `dataCharacteristic`.
    /// Never write to service `0x8018` (`0x8020` / `0x8022`), which is Espressif BLE OTA.
    enum Command {
        /// Required within ~4 s of connecting or the Pin drops the link.Replies with `0x86`.
        static let hello = Data([0x06])
        /// Requests battery percentage (`0x81` + float32).
        static let battery = Data([0x01])
        /// Zeroes the sensor (~3 s, keep Pin still) and starts rep detection. Replies with `0x83`.
        static let startSet = Data([0x03])
        /// Stops rep detection. Replies with `0x84`.
        static let stopSet = Data([0x04])
        /// Sent before disconnecting. Replies with `0x85`.
        static let endSession = Data([0x05])
    }

    enum Packet {
        case ack(UInt8)
        case battery(percent: Double)
        case phase(UInt8)
        /// `0x02`: Mean concentric velocity (m/s). Arrives last in the 4-packet concentric burst.
        case meanVelocity(Double)
        /// `0x03`: Mean propulsive velocity (m/s) — displayed as "Movement power (m/s)".
        case propulsiveVelocity(Double)
        /// `0x04`: Mean positive propulsive acceleration (m/s²), used to compute Watts.
        case propulsiveAcceleration(Double)
        /// `0x05`: Upward Range of Motion (cm).
        case rangeOfMotionCm(Double)
        /// `0x06`: Mean eccentric velocity (m/s) — displayed as "Controlled lowering (m/s)".
        case loweringVelocity(Double)
    }

    static func decode(_ data: Data) -> Packet? {
        guard let type = data.first else { return nil }

        if data.count == 1, (0x81...0x86).contains(type) {
            return .ack(type & 0x7F)
        }
        if type == 0x01, data.count == 2 {
            return .phase(data[data.startIndex + 1])
        }
        guard data.count == 5 else { return nil }
        let raw = data.dropFirst().withUnsafeBytes {
            UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))
        }
        let value = Double(Float(bitPattern: raw))

        switch type {
        case 0x81: return .battery(percent: value)
        case 0x02: return .meanVelocity(value / 1000.0)
        case 0x03: return .propulsiveVelocity(value / 1000.0)
        case 0x04: return .propulsiveAcceleration(value / 1000.0)
        case 0x05: return .rangeOfMotionCm(value / 10.0)
        case 0x06: return .loweringVelocity(value / 1000.0)
        default:   return nil
        }
    }

    /// Collects the 4 concentric packets (`03`, `05`, `04`, `02`) into a `Rep`
    /// and attaches the delayed eccentric packet (`06`) when lowering finishes.
    struct RepAssembler {
        private var propulsiveVelocity: Double?
        private var propulsiveAcceleration: Double?
        private var rangeOfMotionCm: Double?

        mutating func ingest(_ packet: Packet, weightKg: Double) -> Event? {
            switch packet {
            case .propulsiveVelocity(let v):
                propulsiveVelocity = v
                return nil
            case .rangeOfMotionCm(let cm):
                rangeOfMotionCm = cm
                return nil
            case .propulsiveAcceleration(let a):
                propulsiveAcceleration = a
                return nil
            case .meanVelocity(let meanV):
                let propV = propulsiveVelocity ?? meanV
                let propA = propulsiveAcceleration ?? 0
                let romCm = rangeOfMotionCm ?? 0
                propulsiveVelocity = nil
                propulsiveAcceleration = nil
                rangeOfMotionCm = nil
                return .concentricCompleted(Rep(
                    meanVelocity: meanV,
                    propulsiveVelocity: propV,
                    propulsiveAcceleration: propA,
                    rangeOfMotionCm: romCm,
                    loweringVelocity: nil,
                    weightKg: weightKg
                ))
            case .loweringVelocity(let eccV):
                return .loweringCompleted(eccV)
            default:
                return nil
            }
        }

        enum Event {
            case concentricCompleted(Rep)
            case loweringCompleted(Double)
        }
    }
}
