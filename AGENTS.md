# VolumeBridge

The repository owns a macOS prototype with a HAL output driver and a headless
service. Do not add an app, menu bar item, input audio stream, or kernel extension.

- Use `cargo make build`, `cargo make check`, `cargo make test`, and `cargo make fmt`.
- Use host-managed tools and the repository's version files. Do not install tools
  or change global defaults to resolve a missing command.
- Rust owns route and lifecycle policy. Native code binds libASPL and the Apple
  Core Audio, XPC, and IOKit SDKs. Keep client HAL calls out of the driver.
- Keep allocation, IPC, and locks out of the audio I/O callbacks.
- Keep the driver, service, protocol, and installer in one release unit.
- Preserve the original output and power settings in local test receipts.
- Read `docs/architecture.md` and `docs/validation.md` before runtime changes.
- Separate build, API, UI, audible, and sleep/wake evidence. Do not infer hardware
  acceptance from tests. Keep personal device UIDs and serials out of Git.
- The inherited OpenWiki pages described the template and were removed during
  adoption. No OpenWiki generation or recurring automation is configured.
