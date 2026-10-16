---
type: workflow
title: Installation, calibration, and removal
description: Install and remove the native packages, understand hardware-volume calibration, and recover a failed Rust-owned installation transaction.
tags: [installation, calibration, recovery, uninstall, privileges]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T06:30:02.662Z
sources:
  - id: openwiki-source-81bffa88a98604584a809277
    resource: repo://apps/volume-bridge/native/MonitorVolume.mm
  - id: openwiki-source-b9eb96831aff16413593f200
    resource: repo://apps/volume-bridge/src/installer.rs
  - id: openwiki-source-230e78ed9b8e418643313281
    resource: repo://apps/volume-bridge/src/installer/calibration.rs
  - id: openwiki-source-5452c999636e6e9a3f7b9e9c
    resource: repo://apps/volume-bridge/src/installer/host.rs
  - id: openwiki-source-7d4fa9bbbd6184e70a1b7c3d
    resource: repo://apps/volume-bridge/src/installer/transaction.rs
  - id: openwiki-source-51d9de9b25d94d95ce636d7e
    resource: repo://scripts/package.ts
generated: { by: "codex", at: "2026-10-16T06:30:02.662Z" }
---

# Installation, calibration, and removal

Download the installation and removal packages from
[GitHub Releases](https://github.com/acg-box/volume-bridge/releases). Open the
installation `.pkg` in Finder and follow macOS Installer. Keep the original LG
connected and stay signed in with the desktop unlocked. The package requires
administrator authorization and installs on the startup disk.

The package target is Apple Silicon with macOS 14 or later. Actual hardware
acceptance is narrower: one Mac and LG ULTRAGEAR+ USB-C setup, as recorded in
[acceptance](../verification/acceptance.md). The installer requires exactly one
supported stereo LG endpoint.

## Destination requirements and privilege boundary

The destination needs the bundled executable and macOS system utilities. It does
not need Xcode, Rust, Node, Python, Homebrew, a source build, or a network download.
The package's shell entry point checks the target disk and invokes the compiled
binary. Rust owns the complete installation transaction.

Root owns the installed executable, driver, receipt, and launch configuration.
The launch daemon runs the service as the installing desktop user. Audio and DDC
commands execute in that user's bootstrap session and identity. During a package
operation, a root-owned temporary copy of the executable allows that user to run
commands outside PackageKit's private script directory. The temporary directory
is removed when the session object exits.

Short-lived native audio commands have a 20-second timeout. Commands resolve
device UIDs in the process that changes audio properties; they do not reuse a
device number obtained from another process.

## Installed state

| Path | Purpose |
| --- | --- |
| `/Library/Application Support/VolumeBridge/bin/volume-bridge` | Service and diagnostic executable. |
| `/Library/Application Support/VolumeBridge/install-state.json` | Original user, display UID, output routes, and hardware-volume receipt. |
| `/Library/Application Support/VolumeBridge/licenses/` | Project and dependency notices. |
| `/Library/Audio/Plug-Ins/HAL/VolumeBridge.driver` | Native HAL output plugin. |
| `/Library/LaunchDaemons/com.acgbox.volumebridge.service.plist` | System Mach service and user-owned daemon process. |
| `/Library/Logs/VolumeBridge/service.log` | Service output and error log. |
| `/Library/Application Support/VolumeBridge Transaction/` | Protected backup and journal while an operation is incomplete. |

The receipt uses format version 1 and remains readable from the original
prototype. JSON updates are written to a temporary file, flushed, and renamed.
Keep personal receipt fields and raw device listings outside public source control.

## Preflight and safe calibration

The installer takes an exclusive process lock and attempts recovery of any known
unfinished transaction first. It verifies both payload code signatures, finds the
desktop user and supported LG, and reads hardware volume before replacing files.
Existing owned paths without a valid installation receipt stop the operation.
An update requires the original account and display.

The first installation saves the original output routes and monitor volume.
Later updates keep that first receipt instead of replacing it with calibrated
hardware volume. Before changes, the transaction copies the existing runtime,
driver, and launch configuration and saves the current audio snapshot.

Calibration uses this order:

1. Mute the proxy.
2. Set software volume to 0.02 for a fresh installation or a monitor that is no
   longer calibrated. Otherwise retain the previous software volume.
3. Select the proxy on a fresh installation. On update, retain another selected
   output; an old proxy or physical LG selection selects the proxy.
4. Set hardware volume to 100 if required and verify the readback.
5. Restore the previous mute state, then perform the final hardware-volume check.

The control can quantize a requested 0.02 to approximately 0.02126736. See the
[volume curve](../architecture/audio-and-control.md) for scalar and decibel behavior.
Keep the monitor's OSD volume at 100 and use the macOS slider or keyboard keys.
After an OSD change or monitor reset, rerun the installation package to recalibrate.

The DDC helper matches the configured UID to LG EDID identity. It supports the
Core Audio form with masked EDID serial bytes but still requires exactly one
match. It uses private Apple Silicon IOAV interfaces and DDC/CI VCP 0x62 outside
the render callback. Failed or ambiguous matching cannot proceed to a hardware
write. Failed readback stops calibration before unmute.

## File replacement and rollback

Installation stops the old service, replaces the owned files, writes launchd
configuration, starts the service, restarts Core Audio, and waits for the proxy
and driver connection. Audio can pause during this operation.

If an operation fails, rollback mutes the proxy and restores the snapshot's
hardware volume before any output can receive unattenuated audio. It then restores
backed-up files, restarts the service and Core Audio as required, and restores
software volume, mute, and the output routes that are still available.

If recovery cannot reach the display or complete another required step, it retains
the transaction and reports the error. Keep the original display connected and
rerun the package. Do not delete a retained transaction to hide the failure. The
next package invocation attempts recovery before starting a new operation.

## Removal

Open `Uninstall-VolumeBridge-X.Y.Z.pkg` in Finder. Keep the original display
connected so the saved hardware value can be restored and verified. Removal stops
if that value is missing or the display cannot be reached.

The removal transaction mutes the proxy, restores the saved monitor volume,
selects the original output if available (otherwise built-in speakers), and
restores the original system-effects route when present. It then stops the
service, removes the launch file, driver, and runtime, and restarts Core Audio.
The service log directory is removed. A restoration receipt remains at
`/Library/Logs/VolumeBridge-uninstall.json`.

Running removal after an already removed installation reports that it is already
removed. The package still uses the normal administrator and desktop-session
requirements.

See [signed package releases](../operations/releases.md) for distribution trust
and [acceptance](../verification/acceptance.md) for the actual update, removal,
fresh-install, and rollback evidence.
