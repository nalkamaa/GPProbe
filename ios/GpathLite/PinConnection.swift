import CoreBluetooth
import Observation

/// Owns the BLE link. Reconnects automatically whenever the link drops, which is the
/// main reliability problem of the official app.
@Observable
final class PinConnection: NSObject {
    enum State { case off, scanning, connecting, connected }

    private(set) var state: State = .off
    private(set) var lastPacket: PinProtocol.Packet?
    var onPacket: ((PinProtocol.Packet) -> Void)?

    private var central: CBCentralManager!
    private var pin: CBPeripheral?
    private let savedPinKey = "savedPinIdentifier"

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main,
                                   options: [CBCentralManagerOptionRestoreIdentifierKey: "GpathLite"])
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
        guard peripheral.name?.hasPrefix(PinProtocol.namePrefix) == true else { return }
        connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: savedPinKey)
        state = .connected
        peripheral.discoverServices([PinProtocol.service])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
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
            peripheral.setNotifyValue(true, for: char)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard let data = characteristic.value, let packet = PinProtocol.decode(data) else { return }
        lastPacket = packet
        onPacket?(packet)
    }
}
