---
type: guide
title: VolumeBridge quickstart
description: Choose the installation, architecture, development, release, or validation guide for the native macOS volume bridge.
tags: [quickstart, navigation, macos, volume]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T06:30:02.662Z
sources:
  - id: openwiki-source-589635d050c1ba0499df0c29
    resource: repo://apps/volume-bridge/CMakeLists.txt
  - id: openwiki-source-b9eb96831aff16413593f200
    resource: repo://apps/volume-bridge/src/installer.rs
  - id: openwiki-source-230e78ed9b8e418643313281
    resource: repo://apps/volume-bridge/src/installer/calibration.rs
  - id: openwiki-source-51d9de9b25d94d95ce636d7e
    resource: repo://scripts/package.ts
generated: { by: "codex", at: "2026-10-16T06:30:02.662Z" }
---

# VolumeBridge quickstart

VolumeBridge adds native macOS volume and mute controls for a fixed-volume LG
display. It installs a HAL output driver and a background service. There is no
application window, menu bar item, input audio device, or kernel extension.

The output is named **LG ULTRAGEAR+ · VolumeBridge**. Select it in macOS Sound
Settings or the output selector, then use the normal volume keys, slider, and mute
control. The original physical LG output remains available and bypasses the
bridge's software attenuation.

## Choose a task

| Task | Start here |
| --- | --- |
| Install, update, recalibrate, or remove VolumeBridge | [Installation, calibration, and removal](workflows/installation-and-recovery.md) |
| Understand volume range, PCM transfer, and buffering | [Audio path and native volume control](architecture/audio-and-control.md) |
| Diagnose output selection, service reconnects, or sleep/wake | [Device routing, reconnects, and sleep](architecture/device-lifecycle.md) |
| Build the driver and service or run repository checks | [Build, tests, and dependencies](development/build-and-dependencies.md) |
| Operate the signed package release workflow | [Signed package releases](operations/releases.md) |
| Check what was tested and which limits remain | [Validation evidence and acceptance limits](verification/acceptance.md) |

## Install with a package

Use the installation `.pkg` from
[GitHub Releases](https://github.com/acg-box/volume-bridge/releases). Keep the LG
connected and stay signed in to the desktop. Open the package in Finder and follow
macOS Installer with administrator authorization. The destination Mac does not
need development tools.

Installation saves the original hardware volume, mutes the bridge, sets a low
software volume, and verifies hardware calibration before unmuting. Leave the
monitor's own volume at 100 and control volume through macOS. Use the separate
removal package to restore the saved monitor volume and remove the driver and
service. Keep the original display connected for removal.

The package compatibility target is Apple Silicon and macOS 14 or later. Recorded
hardware acceptance covers one LG ULTRAGEAR+ connected by USB-C to one Mac. This
does not establish support for arbitrary monitors, multiple displays, or all
macOS versions. Check the [acceptance record](verification/acceptance.md) before
extending that scope.

## Work on the repository

Use the host-managed tools selected by the repository. From its root, install the
locked development dependencies with `npm ci --ignore-scripts`, then run
`cargo make build` and `cargo make check`. The
[development guide](development/build-and-dependencies.md) explains prerequisites,
outputs, and focused test coverage.

Documentation is maintained in OpenWiki. Update a page through its assigned
OpenWiki job and submit the source Claims through the lifecycle tools. Keep
generated indexes and provenance under OpenWiki ownership. README files route
readers here rather than duplicating the detailed guides.

For a release, merge the intended source, obtain authorization for the exact
version, and push its validated annotated tag. CI owns the build, signatures,
notarization, uploads, and public-file verification. Follow the
[release procedure](operations/releases.md); a successful local package test is
not evidence of a public release.
