"""Extract BLE ATT traffic for one device from an Android btsnoop / hci_snoop*.cfa log.

Usage:
  python btsnoop_att.py <log file> [device address] [--csv out.csv]

Default device address is the Gpath Pin (E8:3D:C1:23:15:8A).
Prints connection events, discovered characteristics (handle -> UUID) and every
ATT read/write/notification, so the official app's start command can be found.
"""

import csv
import struct
import sys

ATT_CID = 0x0004

ATT_OPS = {
    0x01: "ERROR_RSP", 0x02: "MTU_REQ", 0x03: "MTU_RSP",
    0x04: "FIND_INFO_REQ", 0x05: "FIND_INFO_RSP",
    0x08: "READ_BY_TYPE_REQ", 0x09: "READ_BY_TYPE_RSP",
    0x0A: "READ_REQ", 0x0B: "READ_RSP", 0x0C: "READ_BLOB_REQ", 0x0D: "READ_BLOB_RSP",
    0x10: "READ_BY_GROUP_REQ", 0x11: "READ_BY_GROUP_RSP",
    0x12: "WRITE_REQ", 0x13: "WRITE_RSP", 0x52: "WRITE_CMD",
    0x1B: "NOTIFY", 0x1D: "INDICATE", 0x1E: "CONFIRM",
}


def uuid_str(raw: bytes) -> str:
    if len(raw) == 2:
        return f"0000{struct.unpack('<H', raw)[0]:04x}-0000-1000-8000-00805f9b34fb"
    h = raw[::-1].hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def records(path: str):
    with open(path, "rb") as f:
        header = f.read(16)
        if header[:8] != b"btsnoop\0":
            raise SystemExit("Not a btsnoop file")
        while True:
            rec = f.read(24)
            if len(rec) < 24:
                return
            orig_len, incl_len, flags, _drops, ts = struct.unpack(">IIIIq", rec)
            data = f.read(incl_len)
            if len(data) < incl_len:
                return
            # btsnoop timestamps: microseconds since 0000-01-01; convert relative later.
            yield ts, flags, data


def main() -> None:
    args = [a for a in sys.argv[1:]]
    csv_path = None
    if "--csv" in args:
        i = args.index("--csv")
        csv_path = args[i + 1]
        del args[i:i + 2]
    if not args:
        print(__doc__)
        sys.exit(1)
    path = args[0]
    target = (args[1] if len(args) > 1 else "E8:3D:C1:23:15:8A").upper()
    target_le = bytes.fromhex(target.replace(":", ""))[::-1]

    handles: set[int] = set()          # ACL connection handles for the target
    char_uuid: dict[int, str] = {}     # ATT value handle -> characteristic UUID
    pending_read: dict[int, int] = {}  # conn handle -> last read ATT handle
    frag: dict[int, bytearray] = {}    # L2CAP reassembly per conn handle
    t0 = None
    rows = []

    def label(h: int) -> str:
        if h in char_uuid:
            return f"0x{h:04x} ({char_uuid[h][:8]})"
        if h - 1 in char_uuid:
            return f"0x{h:04x} (CCCD of {char_uuid[h - 1][:8]})"
        return f"0x{h:04x}"

    def handle_att(t: float, direction: str, conn: int, pdu: bytes) -> None:
        op = pdu[0]
        name = ATT_OPS.get(op, f"OP_0x{op:02x}")
        att_handle = None
        value = b""
        if op in (0x12, 0x52, 0x1B, 0x1D, 0x0A, 0x0C) and len(pdu) >= 3:
            att_handle = struct.unpack("<H", pdu[1:3])[0]
            value = pdu[3:]
            if op in (0x0A, 0x0C):
                pending_read[conn] = att_handle
        elif op in (0x0B, 0x0D):
            att_handle = pending_read.get(conn)
            value = pdu[1:]
        elif op == 0x09 and len(pdu) >= 2:
            # Characteristic declarations: [decl handle][props][value handle][uuid]
            item_len = pdu[1]
            body = pdu[2:]
            for i in range(0, len(body) - item_len + 1, item_len):
                item = body[i:i + item_len]
                if item_len in (7, 21):
                    vh = struct.unpack("<H", item[3:5])[0]
                    char_uuid[vh] = uuid_str(item[5:])
                    print(f"{t:9.3f}  discovered char {uuid_str(item[5:])}  value handle=0x{vh:04x}  props=0x{item[2]:02x}")
            return
        elif op == 0x01 and len(pdu) >= 5:
            att_handle = struct.unpack("<H", pdu[2:4])[0]
            value = pdu[1:2] + pdu[4:5]
        elif op in (0x02, 0x03, 0x13, 0x1E):
            value = pdu[1:]
        else:
            return  # skip discovery noise
        where = label(att_handle) if att_handle is not None else ""
        print(f"{t:9.3f}  {direction}  {name:<10} {where:<28} len={len(value):3}  {value.hex()}")
        rows.append([f"{t:.4f}", direction, name,
                     f"0x{att_handle:04x}" if att_handle is not None else "",
                     char_uuid.get(att_handle, "") if att_handle is not None else "",
                     len(value), value.hex()])

    for ts, flags, data in records(path):
        if not data:
            continue
        if t0 is None:
            t0 = ts
        t = (ts - t0) / 1e6
        received = bool(flags & 1)
        ptype = data[0]

        if ptype == 0x04 and len(data) > 3:  # HCI event
            evt = data[1]
            params = data[3:]
            if evt == 0x3E and params:  # LE meta
                sub = params[0]
                if sub in (0x01, 0x0A) and len(params) >= 11:
                    status = params[1]
                    conn = struct.unpack("<H", params[2:4])[0] & 0x0FFF
                    peer = params[6:12]
                    if peer == target_le and status == 0:
                        handles.add(conn)
                        print(f"{t:9.3f}  === CONNECTED to {target} (conn handle 0x{conn:03x}) ===")
            elif evt == 0x05 and len(params) >= 4:  # disconnection complete
                conn = struct.unpack("<H", params[1:3])[0] & 0x0FFF
                if conn in handles:
                    print(f"{t:9.3f}  === DISCONNECTED (reason 0x{params[3]:02x}) ===")
                    handles.discard(conn)
                    frag.pop(conn, None)

        elif ptype == 0x02 and len(data) >= 5:  # ACL
            hdr, length = struct.unpack("<HH", data[1:5])
            conn = hdr & 0x0FFF
            pb = (hdr >> 12) & 0x3
            if conn not in handles:
                continue
            payload = data[5:5 + length]
            if pb == 0x01:  # continuation
                if conn in frag:
                    frag[conn] += payload
            else:
                frag[conn] = bytearray(payload)
            buf = frag.get(conn)
            if buf is None or len(buf) < 4:
                continue
            l2_len, cid = struct.unpack("<HH", buf[:4])
            if len(buf) - 4 < l2_len:
                continue
            pdu = bytes(buf[4:4 + l2_len])
            del frag[conn]
            if cid == ATT_CID and pdu:
                handle_att(t, "PIN->PHONE" if received else "PHONE->PIN", conn, pdu)

    if csv_path:
        with open(csv_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["t_s", "direction", "op", "att_handle", "char_uuid", "len", "hex"])
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {csv_path}")


if __name__ == "__main__":
    main()
