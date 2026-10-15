# VolumeBridge

Native macOS volume controls for a fixed-volume display output. VolumeBridge is
a HAL audio driver and a headless background service. It has no app, menu bar
item, input audio device, or kernel extension.

**Status: local prototype, verified on one Apple Silicon Mac.** See the
[validation record](docs/validation.md) for the tested scope and remaining limits.

The first target is an LG ULTRAGEAR+ connected to an Apple Silicon Mac by USB-C.
macOS reports this connection as DisplayPort audio. The new output is named
**LG ULTRAGEAR+ · VolumeBridge**. Select that output to use system volume and mute
controls. The original LG output remains available.

VolumeBridge changes the software audio level. The installer first saves the
monitor's hardware volume, mutes the bridge, sets a low software level, and
calibrates the monitor to 100%. It verifies the hardware value before it unmutes.
This prevents an old monitor setting from limiting the system slider's range.
The first prototype supports stereo, 32-bit
floating-point PCM at 48 kHz. It includes buffering and does not claim zero latency.

## Build and check

Use the host Xcode toolchain, stable Rust with Clippy, cargo-make, cargo-nextest,
nightly rustfmt, cargo-vstyle, CMake, and the Node/npm versions in this repository.
Do not change global tool versions to build this project.

```sh
npm ci --ignore-scripts
cargo make build
cargo make check
cargo make fmt
```

Native artifacts are written to `target/native/`. The service and diagnostic CLI
are written to `target/release/volume-bridge`.

## Local installation

Sign with an existing certificate in the local keychain:

```sh
VOLUMEBRIDGE_SIGN_ID='YOUR EXISTING SIGNING IDENTITY' cargo make sign
mkdir -p work
./target/release/volume-bridge devices > work/baseline.devices.json
sudo node scripts/install.ts install
```

Installation restarts Core Audio and briefly interrupts sound. The service runs
as the invoking user. Its launch definition is in `/Library/LaunchDaemons`; the
driver is in `/Library/Audio/Plug-Ins/HAL`. No system security setting is changed.
Keep machine-specific device identifiers and receipts out of Git.

Connect the target LG before installation. Calibration must pass; an unsupported
or unreadable DDC/CI interface fails preflight before installed files change.
The first calibration starts system volume at approximately 2%. Increase it
gradually. Updates preserve system volume if the monitor is still calibrated.
Uninstall restores the saved hardware volume before it restores the output.

Keep the monitor's own volume at 100% while using VolumeBridge. Use the output
with the VolumeBridge suffix for playback. The original LG output bypasses
software attenuation. A monitor reset or an OSD volume change requires another
installation calibration. DDC calibration currently uses private Apple Silicon
IOAV interfaces, which can change in macOS updates. The audio driver itself uses
the HAL plugin API.

```sh
./target/release/volume-bridge devices
./target/release/volume-bridge status
```

Remove the prototype and restore the recorded output:

```sh
sudo node scripts/install.ts uninstall
```

## Source and evidence

- [Architecture](docs/architecture.md)
- [Validation scope and results](docs/validation.md)
- [Dependency evidence](docs/dependencies.md)
- [Template adoption](docs/template-adoption.md)

The repository was created with GitHub's template operation from
[`acg-box/vibe-mono`](https://github.com/acg-box/vibe-mono).

The project retains the template's GPL-3.0-only license. Vendored libASPL code
retains its MIT and Apple sample-code notices. See `vendor/libaspl/UPSTREAM.md`.
