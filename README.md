<div align="center">

# VolumeBridge

Native macOS volume control for a fixed-volume LG display, with a HAL driver and a background service.

[![License](https://img.shields.io/badge/License-GPLv3%20only-blue.svg)](https://spdx.org/licenses/GPL-3.0-only.html)
[![Docs](https://img.shields.io/badge/docs-OpenWiki-blue)](openwiki/quickstart.md)
[![Release](https://github.com/acg-box/volume-bridge/actions/workflows/release.yml/badge.svg)](https://github.com/acg-box/volume-bridge/actions/workflows/release.yml)
[![GitHub tag (latest by date)](https://img.shields.io/github/v/tag/acg-box/volume-bridge)](https://github.com/acg-box/volume-bridge/tags)
[![GitHub last commit](https://img.shields.io/github/last-commit/acg-box/volume-bridge?color=red&style=plastic)](https://github.com/acg-box/volume-bridge)

</div>

## Feature Highlights

### Native Volume Controls

Use the macOS volume keys, slider, and mute control with **LG ULTRAGEAR+ · VolumeBridge**. No app or menu bar item is required.

### Installation and Recovery

Install a compiled package with Finder. Automatic calibration starts at low volume, and the removal package restores the saved monitor volume.

## Status

This prototype targets one LG ULTRAGEAR+ connected by USB-C to an Apple Silicon Mac. See the [acceptance record](openwiki/verification/acceptance.md) for the tested scope and limitations.

## Workspace Posture

- [apps/volume-bridge/](apps/volume-bridge/) owns the Rust service, installer, Apple SDK adapter, and HAL driver.
- [scripts/](scripts/) owns build, packaging, and release programs.
- [packages/](packages/) is reserved for reusable workspace packages.
- [Cargo.toml](Cargo.toml) owns shared Rust metadata and dependencies.
- [package.json](package.json) and [package-lock.json](package-lock.json) own the pinned TypeScript toolchain.
- [openwiki/](openwiki/quickstart.md) is the authoritative architecture, operations, and validation guide.

## Usage

### Installation

#### Build from Source

Follow the [OpenWiki build guide](openwiki/development/build-and-dependencies.md) with the repository-selected tools.

#### Download Pre-built Packages

Download the installation and removal packages from [GitHub Releases](https://github.com/acg-box/volume-bridge/releases). Follow the [installation guide](openwiki/workflows/installation-and-recovery.md) on the destination Mac.

### Configuration

The installer records the original display volume and calibrates the monitor. See [calibration and recovery](openwiki/workflows/installation-and-recovery.md).

### Interaction

Select **LG ULTRAGEAR+ · VolumeBridge** in macOS and use native volume controls. See [audio behavior](openwiki/architecture/audio-and-control.md) and [output switching](openwiki/architecture/device-lifecycle.md).

### Update

Open the next installation package with the original display connected. See [updates and removal](openwiki/workflows/installation-and-recovery.md).

## Development

Use the [build and test guide](openwiki/development/build-and-dependencies.md) for repository commands and dependencies. CI builds, signs, notarizes, and uploads release packages through the [release workflow](openwiki/operations/releases.md).

### Architecture

Start with the [OpenWiki quickstart](openwiki/quickstart.md), then follow the audio, device lifecycle, installation, and release pages. Detailed project documentation is maintained in OpenWiki.

## Support Me

If you find this project helpful and would like to support its development, you can buy me a coffee!

Your support is greatly appreciated and motivates me to keep improving this project.

- **Fiat**
    - [Ko-fi](https://ko-fi.com/hack_ink)
    - [Afdian](https://afdian.com/a/hack_ink)
- **Crypto**
    - **Bitcoin**
        - `bc1pedlrf67ss52md29qqkzr2avma6ghyrt4jx9ecp9457qsl75x247sqcp43c`
    - **Ethereum**
        - `0x3e25247CfF03F99a7D83b28F207112234feE73a6`
    - **Polkadot**
        - `156HGo9setPcU2qhFMVWLkcmtCEGySLwNqa3DaEiYSWtte4Y`

Thank you for your support!

## Appreciation

We would like to extend our heartfelt gratitude to the following projects and contributors:

- The Rust community for their continuous support and development of the Rust ecosystem.

## Additional Acknowledgements

- TODO

---

<div align="right">

### License

<sup>Licensed under [GPL-3.0-only](LICENSE).</sup>

</div>
