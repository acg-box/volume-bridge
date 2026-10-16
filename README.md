# VolumeBridge

**Downloads:** [GitHub Releases](https://github.com/acg-box/volume-bridge/releases).

Use native macOS volume controls with a fixed-volume LG display. VolumeBridge
contains a HAL audio driver and a background service. It has no app or menu bar
item. It does not add a microphone, input audio device, or kernel extension.

The current target is one LG ULTRAGEAR+ connected to an Apple Silicon Mac by
USB-C. The output appears as **LG ULTRAGEAR+ · VolumeBridge**. The original LG
output remains available. The audio path supports stereo float PCM at 48 kHz.

## Install and remove

Open the installation `.pkg` in Finder and follow the macOS Installer. Keep the
LG connected and stay signed in to your desktop. The package needs administrator
authorization. It does not need Xcode, Rust, Node, Python, Homebrew, or a network
connection on the destination Mac.

The installer saves the original output and display volume. It mutes the bridge,
sets low software volume, calibrates the monitor to 100%, and verifies the result
before it unmutes. The first installation selects VolumeBridge. An update
preserves the existing software volume and selected output. Audio pauses briefly
while Core Audio restarts. No system security setting is changed.

Keep the monitor's own volume at 100% and use the macOS volume keys or slider.
After an OSD volume change or monitor reset, run the installation package again
to recalibrate. The original LG output bypasses software attenuation.

Open **Uninstall VolumeBridge.pkg** to remove it. Keep the same display connected.
Removal restores the saved hardware volume before it restores the original output
and removes the driver and service. If the display cannot be reached, removal
stops before it changes the installation. A restoration receipt remains at
`/Library/Logs/VolumeBridge-uninstall.json`.

Packages with `-local` in the filename are development packages. They are not
Developer ID signed or notarized and are not public release installers.

## Build

Build-time tools are the host Xcode toolchain, the repository's Rust and Node/npm
versions, CMake, cargo-make, cargo-nextest, cargo-vstyle, and nightly rustfmt.
These tools are not part of the installation payload.

```sh
npm ci --ignore-scripts
cargo make build
cargo make check
cargo make fmt
VOLUMEBRIDGE_SIGN_ID='YOUR EXISTING CODE SIGNING IDENTITY' cargo make build-package-local
```

Local packages are written to `target/packages/local/`. The release workflow
uses the shared ACG Developer ID certificates and notarization API key. It builds
and checks the source before it supplies credentials to the signing process.
See [release](docs/release.md) for the credential names and publication process.

## Evidence and scope

- [Architecture](docs/architecture.md)
- [Validation](docs/validation.md)
- [Packaging and recovery](docs/packaging.md)
- [Signing and releases](docs/release.md)
- [Dependencies](docs/dependencies.md)
- [Template adoption](docs/template-adoption.md)

This remains a prototype. It has a bounded audio queue and does not claim zero
latency. DDC calibration uses private Apple Silicon IOAV interfaces. Longer
playback, other display models, and other macOS versions need separate acceptance.

The public repository was created from
[`acg-box/vibe-mono`](https://github.com/acg-box/vibe-mono). It retains the
GPL-3.0-only license. Vendored code retains its own license notices.
