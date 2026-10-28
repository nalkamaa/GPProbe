# Gpath Pin BLE protocol

Source: Android btsnoop captures of the official app (`com.getgpath.gpath`) on 2026-10-28, cross-verified against the raw 80 Hz trace (`0xA4`) sent by the Pin after each set.
Device: `GPATH_Sensor`, model `GPATH-2000-BETA`, `FW-2.82-BETA`, `HW-2.0`, ESP32-based (`E8:3D:C1:23:15:8A`).

Everything goes through one characteristic:

- Advertised name: `GPATH_Sensor`
- Service: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- Characteristic: `beb5483e-36e1-4688-b7f5-ea07361b2688` (ATT value handle `0x002a`, CCCD `0x002b`)

Never write to service `0x8018` (characteristics `0x8020` and `0x8022`). It is Espressif BLE OTA (firmware update).

## Commands (phone → Pin, write with response, 1 byte)

| Byte | Reply | Meaning |
|---|---|---|
| `06` | `86` | Handshake / keep-alive. **Required.** Without it the Pin disconnects after ~4 s. Sent before and after enabling notifications. |
| `01` | `81` + float32 | Battery level in % (e.g. `80.8`). Also pushed automatically every ~30 s. |
| `03` | `83` (after ~3 s) | Start set / zero sensor. Keep the Pin still until `83` arrives. |
| `04` | `84` | Stop set. |
| `05` | `85` | End session (sent right before disconnecting). |

Handshake sequence on connect: write `06`, enable notifications, write `06`, write `01`, write `03`.

## Per-rep notifications (Pin → phone, little-endian)

At the top of each lift (concentric phase complete), four 5-byte packets (`type` + `float32`) arrive in order `03`, `05`, `04`, `02`. When the weight is lowered back down (eccentric phase complete), `06` arrives.

| Type | Unit | Exact firmware definition (verified against raw 80 Hz stream) | Official app metric |
|---|---|---|---|
| `02` | mm/s | Mean concentric velocity $\bar{v}_{\text{conc}}$ over the full upward movement `[i0..i1]` | **Movement power (m/s)** (`f02 / 1000` m/s) |
| `03` | mm/s | Mean propulsive velocity $\bar{v}_{\text{prop}}$ over the propulsive sub-phase `[i0..ip]` (where $a \ge 0$) | Propulsive velocity (`f03 / 1000` m/s) |
| `04` | mm/s² | Mean positive vertical acceleration $\bar{a}_{\text{prop}}$ over `[i0..ip]` | Used to compute **Watts** (with $m$ in kg): $P \approx m \cdot (9.80665 + 0.58 \cdot \text{f04}/1000) \cdot v$ |
| `05` | mm | Upward displacement / Range of Motion $\int v\,dt$ | **Range of motion** (`f05 / 10` cm) |
| `06` | mm/s | Mean eccentric (downward) speed $|\bar{v}_{\text{ecc}}|$ over `[e0..e1]` | **Controlled lowering (m/s)** (`f06 / 1000` m/s; green: `0.2–0.6 m/s`, red: `> 0.6 m/s`) |

Other notifications:

| Format | Meaning |
|---|---|
| `01 xx` | Movement phase state machine (`01` = lifting / concentric, `02` = transition / lowering, `03` = bottom / rest). |
| `b0` + `u32 start_ms` + `u32` | Set trace marker. |
| `b1` + `u32 start_ms` + `u32 end_ms` + `u16 reps` + `u32 samples` | Set trace header. |
| `b2`/`b4` + `u32 samples` + `f32 duration_s` | Set trace duration (`(end_ms - start_ms) / 1000`). |
| `a4` + `u16 seq` + `u16 total_pkts` + `u8 count` + `count × 34 B` | Raw 80 Hz trace (`dt_us = 12500` u16 + `8 × int32`: raw accel/gyro in cols 0..5, vertical acceleration mm/s² in col 6, vertical velocity mm/s in col 7). |
| `b3` | End of trace dump. |

## Captured 6-rep calibration session (2026-10-28 22:55, 2 × [slow, medium, fast])

| Rep | Tempo | `02` Mean vel (m/s) | `03` Movement power (m/s) | `04` Prop. accel (m/s²) | `05` ROM (cm) | `06` Lowering (m/s) |
|---|---|---|---|---|---|---|
| 1 | Slow | 0.27 | 0.31 | 0.57 | 40.3 | 0.20 |
| 2 | Medium | 0.45 | 0.49 | 1.45 | 51.4 | 0.42 |
| 3 | Fast | 0.97 | 1.00 | 5.57 | 64.3 | 0.92 |
| 4 | Slow | 0.36 | 0.37 | 0.95 | 43.6 | 0.25 |
| 5 | Medium | 0.49 | 0.50 | 2.76 | 38.9 | 0.64 |
| 6 | Fast | 0.94 | 0.95 | 6.12 | 55.6 | 1.17 |
