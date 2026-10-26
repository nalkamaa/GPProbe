# Gpath Lite

A minimal personal iOS client for the Gpath Pin, offering reliable reconnect, live velocity and power, and a local workout log.

## Step 1: Learn the protocol (Windows laptop)

There is no public BLE documentation for the Pin, so the packet format has to be captured from the device first.

Close the official app on your phone and turn off its Bluetooth. The Pin accepts only one connection at a time.

```powershell
cd C:\Users\tikyllon\Projects\gpath-pin-client\tools
pip install -r requirements.txt
python gpath_probe.py scan
python gpath_probe.py dump <ADDRESS>
python gpath_probe.py capture <ADDRESS>
```

While `capture` is running, do clearly separated test movements and write down roughly when each one happened:

1. Leave the Pin still for 10 seconds.
2. Do 3 slow reps, then pause.
3. Do 3 fast reps, then pause.
4. Rotate the Pin 90 degrees and hold it still.

Use this sequence to tell the two possible packet types apart:

- **Per-rep summaries:** a short packet arrives after each rep. Decode its velocity and power fields directly.
- **Raw IMU stream:** steady packets arrive at a fixed rate (about 50 to 200 Hz). Velocity has to be computed in the app by integrating vertical acceleration within each rep.

## Step 2: Fill in `ios/GpathLite/PinProtocol.swift`

Add the service and characteristic UUIDs and the `decode` function.

## Step 3: Build the iOS app (needs a Mac with Xcode)

1. Create a new iOS App project named GpathLite (SwiftUI, iOS 17 or later) and add the files from `ios/GpathLite/`.
2. In Info.plist, add `NSBluetoothAlwaysUsageDescription`.
3. Under Background Modes, enable "Uses Bluetooth LE accessories".
4. Sign the app with a free Apple ID and install it on your iPhone. With a free Apple ID, the app has to be re-signed every 7 days. A paid developer account ($99 per year) avoids this.

## Firmware updates

Keep using the official app only for firmware updates. Doing them yourself would mean reverse-engineering the vendor's DFU process and getting firmware images. If that goes wrong, the Pin can be bricked, which is not worth the risk. Note that a firmware update could also change the protocol, so capture again after each one.
