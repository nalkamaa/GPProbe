import CoreBluetooth
import Observation
import UIKit

/// Owns the BLE link. Performs the mandatory `0x06` handshake so the Pin does not
/// drop the connection after 4 s, sends periodic 15 s keep-alives, keeps the screen
/// awake while connected, and reconnects automatically whenever the link drops.
@Observable
final class PinConnection: NSObject {
    enum State: String {
        case off = "Bluetooth Off"
        case scanning = "Scanning"
        case connecting = "Connecting"
        case idle = "Connected – Press Aloita sarja"
        case zeroing = "Keep Pin Still..."
        case ready = "Ready"
    }

    private(set) var state: State = .off {
        didSet {
            updateScreenAwakeState()
        }
    }
    private(set) var batteryPercent: Double?
    private(set) var lastPacket: PinProtocol.Packet?
    var onPacket: ((PinProtocol.Packet) -> Void)?

    private var central: CBCentralManager!
    private var pin: CBPeripheral?
    private var dataChar: CBCharacteristic?
    private var pinStarted: Bool = false
    private var keepAliveTimer: Timer?
    private let keepAliveInterval: TimeInterval = 15.0
    private let savedPinKey = "savedPinIdentifier"

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main,
                                   options: [CBCentralManagerOptionRestoreIdentifierKey: "GpathLite"])
    }

    /// Zeroes the Pin on the first set (~3 s) and activates subsequent sets immediately.
    func startSet() {
        guard pin?.state == .connected else { return }
        if !pinStarted {
            state = .zeroing
            send(PinProtocol.Command.hello)
            send(PinProtocol.Command.battery)
            send(PinProtocol.Command.startSet)
        } else {
            state = .ready
            send(PinProtocol.Command.hello)
            onPacket?(.ack(0x03))
        }
    }

    func stopSet() {
        // Keep Pin firmware in 0x03 mode between sets; gate reps in app via state = .idle
        if pin?.state == .connected {
            state = .idle
        }
    }

    private func updateScreenAwakeState() {
        let shouldKeepAwake = (state == .idle || state == .zeroing || state == .ready)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = shouldKeepAwake
        }
    }

    private func startKeepAliveTimer() {
        stopKeepAliveTimer()
        keepAliveTimer = Timer.scheduledTimer(withTimeInterval: keepAliveInterval, repeats: true) { [weak self] _ in
            guard let self, self.pin?.state == .connected, self.dataChar != nil else { return }
            // Skip sending during the 3-second initial sensor calibration (0x03)
            guard self.state != .zeroing else { return }
            self.send(PinProtocol.Command.hello)
        }
    }

    private func stopKeepAliveTimer() {
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
    }

    private func send(_ command: Data) {
        guard let pin, let dataChar else { return }
        pin.writeValue(command, for: dataChar, type: .withResponse)
    }

    private func connectOrScan() {
        if let id = UserDefaults.standard.string(forKey: savedPinKey).flatMap(UUID.init),
           let known = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(known)
        } else {
            state = .scanning
            central.scanForPeripherals(withServices: nil)
        }
    }

    private func connect(_ peripheral: CBPeripheral) {
        central.stopScan()
        pin = peripheral
        peripheral.delegate = self
        state = .connecting
        // A pending connect never times out on iOS, so this also covers "Pin was switched off".
        central.connect(peripheral)
    }
}

extension PinConnection: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn { connectOrScan() } else { state = .off }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        pin = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first
        pin?.delegate = self
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advName ?? ""
        guard name.uppercased().hasPrefix(PinProtocol.namePrefix) else { return }
        connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: savedPinKey)
        pinStarted = false
        state = .connecting
        peripheral.discoverServices([PinProtocol.service])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        stopKeepAliveTimer()
        dataChar = nil
        pinStarted = false
        connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        stopKeepAliveTimer()
        dataChar = nil
        pinStarted = false
        connect(peripheral)
    }
}

extension PinConnection: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics([PinProtocol.dataCharacteristic], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        for char in service.characteristics ?? [] where char.uuid == PinProtocol.dataCharacteristic {
            dataChar = char
            // Official app sends 0x06 before and after enabling notifications.
            peripheral.writeValue(PinProtocol.Command.hello, for: char, type: .withResponse)
            peripheral.setNotifyValue(true, for: char)
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateNotificationStateFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard characteristic.uuid == PinProtocol.dataCharacteristic, characteristic.isNotifying else { return }
        send(PinProtocol.Command.hello)
        send(PinProtocol.Command.battery)
        startKeepAliveTimer()
        state = .idle
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard let data = characteristic.value, let packet = PinProtocol.decode(data) else { return }
        switch packet {
        case .battery(let pct):
            batteryPercent = pct
        case .ack(0x03):
            if state == .zeroing {
                pinStarted = true
                state = .ready
            }
        case .ack(0x04):
            state = .idle
        default:
            break
        }
        lastPacket = packet
        onPacket?(packet)
    }
}
