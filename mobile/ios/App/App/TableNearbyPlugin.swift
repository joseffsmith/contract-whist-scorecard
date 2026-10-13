import Capacitor
import CoreBluetooth

// "Join this table": while the host shows the invite, the phone advertises the
// Whist table service over Bluetooth LE. A phone nearby that finds it reads
// one characteristic, a small JSON {"g": gameId, "n": host's name}, and offers
// to join (src/lib/nearby.ts; scanning uses @capacitor-community/bluetooth-le).
// iOS only advertises while the app is in the foreground, which is when the
// invite is on screen anyway.
@objc(TableNearbyPlugin)
public class TableNearbyPlugin: CAPPlugin, CAPBridgedPlugin, CBPeripheralManagerDelegate {
    public let identifier = "TableNearbyPlugin"
    public let jsName = "TableNearby"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startHosting", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHosting", returnType: CAPPluginReturnPromise),
    ]

    // Keep in step with src/lib/nearby.ts and the Android plugin.
    static let service = CBUUID(string: "E62C7DB0-F38E-4DB6-8651-AA677B9EA2C8")
    static let table = CBUUID(string: "3CCF0D62-8326-4755-9836-E4F29387516D")

    private var manager: CBPeripheralManager?
    private var payload: Data?
    // The startHosting call waiting for Bluetooth to be ready, or for
    // advertising to start.
    private var pending: CAPPluginCall?
    // Services added and not yet confirmed (didAdd comes in order): only the
    // latest one's confirmation starts advertising, and none once stopped.
    private var adding = 0

    @objc func startHosting(_ call: CAPPluginCall) {
        guard
            let gameId = call.getString("gameId"),
            let data = try? JSONSerialization.data(withJSONObject: [
                "g": gameId,
                "n": String((call.getString("name") ?? "").prefix(40)),
            ])
        else {
            return call.reject("Missing gameId.", "bad_options")
        }
        DispatchQueue.main.async {
            self.pending?.reject("Replaced.", "replaced")
            self.pending = call
            self.payload = data
            if let manager = self.manager {
                self.peripheralManagerDidUpdateState(manager)
            } else {
                // Asks for Bluetooth permission the first time.
                self.manager = CBPeripheralManager(delegate: self, queue: nil)
            }
        }
    }

    @objc func stopHosting(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stop()
            call.resolve()
        }
    }

    private func stop() {
        pending?.reject("Stopped.", "stopped")
        pending = nil
        payload = nil
        manager?.stopAdvertising()
        manager?.removeAllServices()
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        // Bluetooth back on while hosting (iOS drops services when it goes
        // off): set the table up again.
        if pending == nil, payload != nil, peripheral.state == .poweredOn {
            return addService(peripheral)
        }
        guard pending != nil else { return }
        switch peripheral.state {
        case .poweredOn:
            addService(peripheral)  // advertising starts in didAdd
        case .unauthorized:
            fail("Bluetooth isn't allowed for Whist.", "unauthorized")
        case .poweredOff:
            fail("Bluetooth is off.", "off")
        case .unsupported:
            fail("This phone can't do Bluetooth LE.", "unsupported")
        default:
            break  // resetting or unknown: wait for the next update
        }
    }

    private func addService(_ peripheral: CBPeripheralManager) {
        peripheral.stopAdvertising()
        peripheral.removeAllServices()
        let characteristic = CBMutableCharacteristic(
            type: Self.table, properties: [.read], value: nil, permissions: [.readable])
        let service = CBMutableService(type: Self.service, primary: true)
        service.characteristics = [characteristic]
        adding += 1
        peripheral.add(service)
    }

    public func peripheralManager(
        _ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?
    ) {
        adding = max(0, adding - 1)
        guard adding == 0, payload != nil else { return }  // superseded, or stopped
        if let error {
            return fail(error.localizedDescription, "failed")
        }
        peripheral.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [Self.service],
            CBAdvertisementDataLocalNameKey: "Whist",
        ])
    }

    public func peripheralManagerDidStartAdvertising(
        _ peripheral: CBPeripheralManager, error: Error?
    ) {
        if let error {
            fail(error.localizedDescription, "failed")
        } else {
            pending?.resolve()
            pending = nil
        }
    }

    // A start that failed is over: nothing to set up again when Bluetooth
    // comes back on.
    private func fail(_ message: String, _ code: String) {
        let call = pending
        pending = nil
        payload = nil
        manager?.stopAdvertising()
        manager?.removeAllServices()
        call?.reject(message, code)
    }

    // Answers in pieces when the reader's MTU is smaller than the payload.
    public func peripheralManager(
        _ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest
    ) {
        guard request.characteristic.uuid == Self.table, let payload else {
            return peripheral.respond(to: request, withResult: .attributeNotFound)
        }
        guard request.offset <= payload.count else {
            return peripheral.respond(to: request, withResult: .invalidOffset)
        }
        request.value = payload.subdata(in: request.offset..<payload.count)
        peripheral.respond(to: request, withResult: .success)
    }
}
