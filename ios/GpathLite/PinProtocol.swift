import CoreBluetooth

/// Everything device-specific lives here. Fill in from `tools/gpath_probe.py dump/capture` results.
enum PinProtocol {
    /// Advertised name prefix used to recognise the Pin while scanning.
    static let namePrefix = "Gpath"

    // TODO: replace with UUIDs discovered by `gpath_probe.py dump`.
    static let service = CBUUID(string: "0000FFF0-0000-1000-8000-00805F9B34FB")
    static let dataCharacteristic = CBUUID(string: "0000FFF1-0000-1000-8000-00805F9B34FB")

    enum Packet {
        /// Device already computed a rep (velocity in m/s, power in W).
        case rep(meanVelocity: Double, peakVelocity: Double, power: Double)
        /// Raw IMU sample; reps are derived by `RepDetector`.
        case imu(timestamp: TimeInterval, accel: SIMD3<Double>, gyro: SIMD3<Double>)
    }

    /// TODO: implement once the packet layout is known from captures.
    static func decode(_ data: Data) -> Packet? {
        nil
    }
}
