---
type: verification
title: Validation evidence and acceptance limits
description: Dated local and CI evidence, the distinction between source tests and hardware acceptance, and the remaining prototype limits.
tags: [validation, acceptance, audio, packaging, provenance]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T06:30:02.662Z
sources:
  - id: openwiki-source-230e78ed9b8e418643313281
    resource: repo://apps/volume-bridge/src/installer/calibration.rs
  - id: openwiki-source-d908193ec290bdb670b55b4b
    resource: repo://apps/volume-bridge/src/installer/model.rs
  - id: openwiki-source-e99dc82d69978d42762837da
    resource: repo://apps/volume-bridge/tests/native/ring.cpp
  - id: openwiki-source-f1a02f6a4473b265a9e84ccc
    resource: repo://scripts/release/contract.test.ts
  - id: openwiki-source-02f15f3b05f2f30c315723ef
    resource: repo://scripts/release/publish.test.ts
generated: { by: "codex", at: "2026-10-16T06:30:02.662Z" }
---

# Validation evidence and acceptance limits

Build checks, API readback, native UI behavior, audible results, sleep/wake
behavior, and public distribution are separate evidence. A passing test or signed
local package does not establish all of them.

The observations below preserve the dated
[validation record at c8245e6](https://github.com/acg-box/volume-bridge/blob/c8245e621c5e50ce92786d3dfc7ae7c78d66dcca/docs/validation.md).
They were not rerun merely to migrate the documentation. For current public
artifacts, use [GitHub Releases](https://github.com/acg-box/volume-bridge/releases)
and the manifest attached to the exact version.

## What the repository tests establish

| Tests | Contract exercised |
| --- | --- |
| Native ring test | Full-ring drop accounting, wraparound, empty reads, and ordered concurrent producer/consumer transfer. |
| Native volume test | All keyboard intervals, monotonic gain, channel symmetry, silence at zero, unity at maximum, and agreement with reported decibels. |
| Rust route tests | Relay selection, missing driver/target/source, and sleep predicates. |
| Rust calibration tests | Mute and low gain before hardware maximum, volume preservation on calibrated updates, and no unmute after a hardware error. |
| Rust receipt test | Read compatibility with the original prototype receipt. |
| Release contract tests | Stable versions, source and tag binding, main ancestry, manifest identity, tampered bytes, extra assets, and a local dry-run without network tools. |
| Publisher regression test | Temporary draft URLs, canonical public URLs, uploaded state, metadata digests, and downloaded bytes. CLI fixtures permit downloads only. |

At the draft-URL correction, `cargo make check` passed seven Rust tests, two native
tests, eight Node tests, type checking, and lint. The
[PR check at c8245e6](https://github.com/acg-box/volume-bridge/actions/runs/38860839467)
also passed. These checks do not exercise actual acoustic output or a physical
sleep transition. See [build and dependencies](../development/build-and-dependencies.md).

## Native controls and hardware scope

The 2026-10-15 prototype observations used one Apple Silicon Mac running macOS
27.2 and one LG ULTRAGEAR+ connected by USB-C. SIP remained enabled.

| Layer | Recorded observation |
| --- | --- |
| Native UI | Sound Settings exposed volume and mute for `LG ULTRAGEAR+ · VolumeBridge`. The first slider step read back as scalar 0.0625, and mute read back as 1. |
| Audible result | The user confirmed that the corrected first step and upward volume adjustment sounded normal. |
| DSP and mute | The first keyboard step reported -72 dB; maximum was unity. A low-level signal measured zero at both driver and physical output callbacks with native mute enabled. |
| Output switching | Built-in selection stopped LG callbacks while a client still wrote to the proxy. Selecting the proxy resumed callbacks and preserved volume. The user selected built-in speakers for this test; AirPods were not tested. |
| Restart | After a user-initiated reboot, the driver and service started automatically, the proxy remained selected, and calibrated hardware volume read back as 100/100. |
| Sustained silent PCM | A 60-second observation reported no underruns or dropped producer frames; no additional resynchronization occurred in its last 50 seconds. |

The earlier prototype switch/wake run recorded three queue resynchronizations.
A resynchronization discards queued audio. Silent PCM confirms callback recovery,
not uninterrupted acoustic playback or a measured end-to-end latency.

## Package operations on the destination Mac

The 2026-10-15 local package checks ran through `/usr/sbin/installer` with an empty
environment and only `/usr/bin:/bin:/usr/sbin:/sbin` in PATH. Dynamic-link inspection
found only system libraries. The Installer GUI opened the package and displayed
its welcome page; complete transactions were exercised through the system CLI.

| Operation | Recorded result |
| --- | --- |
| Repair and update | Restored an incomplete prototype installation and preserved output selection, software volume, mute, and the first hardware-volume receipt. |
| Remove and repeat removal | Restored hardware volume 5/100 and the original LG output, removed the owned runtime, driver, service, and transaction, and succeeded again when already absent. |
| Fresh install | Selected the proxy with approximately 2% software volume, verified monitor volume 100/100, and retained the original 5/100 value. |
| File-copy failure | A payload without its license directory triggered recovery. Restored binary, driver, and receipt hashes matched; output selections, volume, and mute were preserved. |
| Real sleep/wake | The physical LG received a new Core Audio ID. Relay callbacks resumed, the proxy stayed selected, and volume and mute were preserved. The final run added no underruns or dropped frames and recorded two transition resynchronizations. |

The first sleep test was interrupted by a user-initiated reboot. A later run
exposed 6,656 dropped frames because producer writes were enabled before the
physical output finished starting. The final run used the corrected start order.
Original power settings, including `SleepDisabled`, were restored, and test wake
events were removed.

Those local archives had Apple Development-signed payloads and unsigned product
archives. Their hashes identify that test stage only:

| Local artifact | SHA-256 |
| --- | --- |
| `VolumeBridge-0.2.0-local.pkg` | `a36bb181ae8ff0524bf61fe620aff8b3b1c233e1a6d3633c9fd885ab382cc666` |
| `Uninstall-VolumeBridge-0.2.0-local.pkg` | `af7ef889255500383edeb0d6960fd4eaaf8a850b295fe48923c9fe408412f9ac` |

## Developer ID package validation on 2026-10-16

The final local candidate at source
`5b099058938b0d6063a1dc586488b690c20e7b16` contained the XPC reconnect correction.
Both packages and their bundled Mach-O components passed Developer ID signature,
hardened runtime, timestamp, notarization, staple, and Gatekeeper checks for team
`4N949UKQ55`.

| Signed artifact | Final SHA-256 | Apple submission |
| --- | --- | --- |
| `VolumeBridge-0.2.0.pkg` | `2d6804b4ea09c88293a10ca6785b0ac999534b53fa841dbd00f6d2d40dd3e250` | `39d013d9-6505-4fc1-ae2c-ea0f19101568` |
| `Uninstall-VolumeBridge-0.2.0.pkg` | `aa9d2a88354d6a2f11c6e5fd6e4ed5c3210f1de03b983820e64b096d4a67a02f` | `08259db7-d4a1-4339-98a3-0425d35d8301` |

The actual update, removal, and fresh-install cycle passed with the same restricted
destination environment. Fresh volume read back as 0.02126736: the requested 0.02
is quantized by the control. An earlier upper bound of 0.021 was too narrow; the
test was corrected without changing the volume curve.

After the final cycle, silent PCM resumed without added underruns or dropped
frames. Final readback confirmed the original output and system-effects route,
software volume 0.19140625, mute off, a connected driver, and no active transaction.
The first hardware-volume receipt still held 5/100.

## Reconnect correction and unresolved system stalls

The driver previously retained a permanently invalid XPC connection when it
loaded before the service name existed. The corrected driver connected after
delayed service registration without a driver-host PID change. It also reconnected
after service removal and registration with the same host PID. Silent PCM resumed
without added underruns or dropped frames. See
[device lifecycle](../architecture/device-lifecycle.md) for the implementation.

Earlier rapid package cycles encountered 20-second Core Audio enumeration timeouts,
including while the desktop was unlocked. Recovery retained the transaction when
enumeration also timed out during rollback. A stack sample showed plug-in-list
processing. The complete cause of that system stall was not established.

`ParrotAudioPlugin.driver` was initially misclassified as third-party software.
Its Apple signing authority, system package receipt, and binary hash matched the
protected macOS template. It is an Apple OS component and was not modified.
A load-failure log did not establish that it caused the stall. Recovery reset only
the verified VolumeBridge driver host and Core Audio, restored the previous
settings, and completed a later package cycle. The XPC fix does not by itself
explain the separate plug-in-list stall.

## CI distribution observations

The [v0.2.0 run](https://github.com/acg-box/volume-bridge/actions/runs/38858949865)
passed source checks and compilation but failed to find the signing identity.
The signing-keychain search-list correction was then merged.

The [v0.2.1 run](https://github.com/acg-box/volume-bridge/actions/runs/38859914425),
at source `d15c1ea35c0c79e1a78de502ed43c03d12f8b9c4`, passed source validation,
native checks, compilation, Developer ID signing, notarization, stapling, and
Gatekeeper assessment on the macOS 26 runner. Its publisher stopped before public
release because GitHub used temporary draft asset URLs. The corrected verifier
subsequently downloaded all three retained draft assets and matched their sizes,
hashes, and source manifest to the CI artifact without changing the draft.

These observations establish CI package trust and draft-byte verification at
that checkpoint. They do not establish public publication or hardware acceptance
of a later CI build. Follow [signed package releases](../operations/releases.md)
to verify the exact public version and its downloaded assets.

## Remaining acceptance limits

The recorded hardware scope is one Mac and one LG. It excludes AirPods, cable
hot-plug acceptance, multiple monitors, other display models, and long-duration
playback. The independent 48 kHz clocks and bounded queue have not been evaluated
as a professional audio path. Monitor OSD changes or resets require recalibration.
The DDC helper depends on private Apple Silicon IOAV interfaces.

For another hardware run, preserve the original route, volume, mute, monitor
volume, and power settings; keep the desktop unlocked and original display
connected. Record each tested artifact's hash. Compare callback counters across
switching and wake, verify removal and restoration, and obtain audible confirmation
separately. Keep personal UIDs, serials, raw snapshots, and installation receipts
outside Git. See [installation and recovery](../workflows/installation-and-recovery.md).
