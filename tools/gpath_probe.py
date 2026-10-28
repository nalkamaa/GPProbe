"""Discover and capture the Gpath Pin BLE protocol.

Usage:
  python gpath_probe.py scan                 # list nearby BLE devices
  python gpath_probe.py dump <address>       # print GATT services/characteristics + readable values
  python gpath_probe.py capture <address>    # subscribe to all notify chars, log to captures/*.csv
  python gpath_probe.py poll <address> [char_uuid] [interval_s]   # read-only: print value changes
  python gpath_probe.py session <address>    # send the official app's start commands, print decoded reps

During `capture`, do labelled sets (e.g. 3 slow reps, pause, 3 fast reps) and note
the timestamps, so the packet stream can be matched to real movement.
"""

import asyncio
import csv
import struct
import sys
import time
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

# Services not to subscribe to during capture:
#   00001801 Generic Attribute (Service Changed) - owned by the OS, Windows denies access.
#   00008018 Espressif BLE OTA (firmware update) - never touch, risk of bricking.
SKIP_SERVICE_PREFIXES = ("00001801-", "00008018-")


async def scan() -> None:
    devices = await BleakScanner.discover(timeout=10.0, return_adv=True)
    for device, adv in sorted(devices.values(), key=lambda d: d[1].rssi, reverse=True):
        print(f"{device.address}  rssi={adv.rssi:4}  name={device.name!r}  "
              f"services={adv.service_uuids}  mfr={ {k: v.hex() for k, v in adv.manufacturer_data.items()} }")


async def dump(address: str) -> None:
    async with BleakClient(address) as client:
        for service in client.services:
            print(f"[service] {service.uuid}  {service.description}")
            for char in service.characteristics:
                value = ""
                if "read" in char.properties:
                    try:
                        value = (await client.read_gatt_char(char)).hex()
                    except Exception as exc:
                        value = f"<read failed: {exc}>"
                print(f"  [char] {char.uuid}  handle={char.handle}  {char.properties}  {value}")


async def capture(address: str) -> None:
    out_dir = Path(__file__).parent / "captures"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"capture_{datetime.now():%Y%m%d_%H%M%S}.csv"
    start = time.monotonic()

    with out_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["t_s", "char_uuid", "len", "hex"])

        def on_disconnect(_client) -> None:
            print(f"{time.monotonic() - start:8.3f}  DISCONNECTED by device/OS")

        async with BleakClient(address, disconnected_callback=on_disconnect) as client:
            print(f"{time.monotonic() - start:8.3f}  connected")
            notify_chars = [c for s in client.services for c in s.characteristics
                            if {"notify", "indicate"} & set(c.properties)
                            and not s.uuid.startswith(SKIP_SERVICE_PREFIXES)]

            subscribed = 0
            for char in notify_chars:
                def handler(_, data: bytearray, uuid=char.uuid):
                    t = time.monotonic() - start
                    writer.writerow([f"{t:.4f}", uuid, len(data), data.hex()])
                    print(f"{t:8.3f}  {uuid[:8]}  {data.hex()}")
                try:
                    await client.start_notify(char, handler)
                except Exception as exc:
                    print(f"skipped:    {char.uuid}  ({exc})")
                    continue
                subscribed += 1
                print(f"subscribed: {char.uuid}")

            if not subscribed:
                print("No characteristics could be subscribed.")
                return

            print(f"Logging to {out_path}. Press Ctrl+C to stop.")
            try:
                while client.is_connected:
                    await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                pass


DATA_CHAR = "beb5483e-36e1-4688-b7f5-ea07361b2688"

# Single-byte commands observed from the official Android app (btsnoop capture 2026-10-28).
# Only these are sent; never write anything else to the Pin.
CMD_HELLO = b"\x06"     # -> 0x86. Without it the Pin disconnects after ~4 s.
CMD_BATTERY = b"\x01"   # -> 0x81 + float32 (battery %, also pushed every 30 s)
CMD_START = b"\x03"     # -> 0x83 after ~3 s (keep the Pin still: probably zeroing)
CMD_STOP = b"\x04"      # -> 0x84
CMD_END = b"\x05"       # -> 0x85, sent by the app just before disconnecting

REP_FIELDS = {
    0x02: ("mean_vel", 0.001, "m/s"),
    0x03: ("movement_power_vel", 0.001, "m/s"),
    0x04: ("prop_accel", 0.001, "m/s^2"),
    0x05: ("rom", 0.1, "cm"),
    0x06: ("lowering_vel", 0.001, "m/s"),
}


def describe(data: bytes) -> str:
    """Human-readable decoding of one notification from the data characteristic."""
    if not data:
        return "<empty>"
    t = data[0]
    if len(data) == 1 and 0x81 <= t <= 0x86:
        return f"ACK 0x{t & 0x7F:02x}"
    if t == 0xB3 and len(data) == 1:
        return "trace end"
    if t == 0x81 and len(data) == 5:
        return f"battery {struct.unpack('<f', data[1:])[0]:.1f} %"
    if t == 0x01 and len(data) == 2:
        return f"state {data[1]}"
    if t in REP_FIELDS and len(data) == 5:
        name, scale, unit = REP_FIELDS[t]
        raw = struct.unpack("<f", data[1:])[0]
        return f"rep {name} = {raw * scale:.3f} {unit} (raw {raw:.1f})"
    if t == 0xA4:
        return f"trace packet seq={struct.unpack('<H', data[1:3])[0]} len={len(data)}"
    return f"unknown type 0x{t:02x} len={len(data)}"


async def session(address: str) -> None:
    """Replay the official app's start sequence and print decoded notifications."""
    out_dir = Path(__file__).parent / "captures"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"session_{datetime.now():%Y%m%d_%H%M%S}.csv"
    start = time.monotonic()

    def on_disconnect(_client) -> None:
        print(f"{time.monotonic() - start:8.3f}  DISCONNECTED by device/OS")

    with out_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["t_s", "len", "hex", "meaning"])

        def handler(_, data: bytearray) -> None:
            t = time.monotonic() - start
            meaning = describe(bytes(data))
            writer.writerow([f"{t:.4f}", len(data), data.hex(), meaning])
            if data and data[0] == 0xA4:
                return  # trace dumps are long; CSV only
            print(f"{t:8.3f}  {data.hex():<20} {meaning}")

        async with BleakClient(address, disconnected_callback=on_disconnect) as client:
            print(f"{time.monotonic() - start:8.3f}  connected")
            await client.write_gatt_char(DATA_CHAR, CMD_HELLO, response=True)
            await client.start_notify(DATA_CHAR, handler)
            await client.write_gatt_char(DATA_CHAR, CMD_HELLO, response=True)
            await client.write_gatt_char(DATA_CHAR, CMD_BATTERY, response=True)
            print("Keep the Pin still, starting...")
            await client.write_gatt_char(DATA_CHAR, CMD_START, response=True)
            print(f"Started. Do reps. Logging to {out_path}. Press Ctrl+C to stop.")
            try:
                while client.is_connected:
                    await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                pass
            finally:
                if client.is_connected:
                    try:
                        await client.write_gatt_char(DATA_CHAR, CMD_STOP, response=True)
                        await client.write_gatt_char(DATA_CHAR, CMD_END, response=True)
                        print("Sent stop + end.")
                    except Exception as exc:
                        print(f"Stop failed: {exc}")


async def poll(address: str, char_uuid: str = DATA_CHAR,
               interval: str = "0.1") -> None:
    """Read-only: repeatedly read one characteristic and print whenever its value changes."""
    start = time.monotonic()

    def on_disconnect(_client) -> None:
        print(f"{time.monotonic() - start:8.3f}  DISCONNECTED by device/OS")

    async with BleakClient(address, disconnected_callback=on_disconnect) as client:
        print(f"{time.monotonic() - start:8.3f}  connected")
        print(f"Polling {char_uuid} every {interval}s. Press Ctrl+C to stop.")
        last = None
        reads = 0
        while client.is_connected:
            try:
                value = (await client.read_gatt_char(char_uuid)).hex()
            except Exception as exc:
                print(f"{time.monotonic() - start:8.3f}  read failed after {reads} reads: {exc}")
                break
            reads += 1
            if value != last:
                print(f"{time.monotonic() - start:8.3f}  read#{reads}  {value}")
                last = value
            await asyncio.sleep(float(interval))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd, args = sys.argv[1], sys.argv[2:]
    commands = {"scan": scan, "dump": dump, "capture": capture, "poll": poll, "session": session}
    try:
        asyncio.run(commands[cmd](*args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
