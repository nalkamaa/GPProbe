"""Discover and capture the Gpath Pin BLE protocol.

Usage:
  python gpath_probe.py scan                 # list nearby BLE devices
  python gpath_probe.py dump <address>       # print GATT services/characteristics + readable values
  python gpath_probe.py capture <address>    # subscribe to all notify chars, log to captures/*.csv

During `capture`, do labelled sets (e.g. 3 slow reps, pause, 3 fast reps) and note
the timestamps, so the packet stream can be matched to real movement.
"""

import asyncio
import csv
import sys
import time
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner


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

        async with BleakClient(address) as client:
            notify_chars = [c for s in client.services for c in s.characteristics
                            if {"notify", "indicate"} & set(c.properties)]

            for char in notify_chars:
                def handler(_, data: bytearray, uuid=char.uuid):
                    t = time.monotonic() - start
                    writer.writerow([f"{t:.4f}", uuid, len(data), data.hex()])
                    print(f"{t:8.3f}  {uuid[:8]}  {data.hex()}")
                await client.start_notify(char, handler)
                print(f"subscribed: {char.uuid}")

            print(f"Logging to {out_path}. Press Ctrl+C to stop.")
            try:
                while True:
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                pass


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd, args = sys.argv[1], sys.argv[2:]
    commands = {"scan": scan, "dump": dump, "capture": capture}
    try:
        asyncio.run(commands[cmd](*args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
