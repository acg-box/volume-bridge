# VolumeBridge

The repository owns a macOS prototype with a HAL output driver and a headless
service. Do not add an app, menu bar item, input audio stream, or kernel extension.

- Use `cargo make build`, `cargo make check`, `cargo make test`, and `cargo make fmt`.
- Use `cargo make build-package-local` for local package tests. Use
  `cargo make build-package` only with the required Developer ID identities and
  notary profile. Local packages are not public releases.
- Rust owns installer transactions and recovery. Shell package entry points only
  prepare execution context and call the compiled binary. Do not add a Node,
  Python, or developer-tool dependency to the destination Mac.
- Require an unlocked desktop and the original display for hardware acceptance.
- Use host-managed tools and the repository's version files. Do not install tools
  or change global defaults to resolve a missing command.
- Rust owns route and lifecycle policy. Native code binds libASPL and the Apple
  Core Audio, XPC, and IOKit SDKs. Keep client HAL calls out of the driver.
- Keep allocation, IPC, and locks out of the audio I/O callbacks.
- Keep the driver, service, protocol, and installer in one release unit.
- Preserve the original output and power settings in local test receipts.
- Read `openwiki/architecture/audio-and-control.md` and
  `openwiki/verification/acceptance.md` before runtime changes.
- Separate build, API, UI, audible, and sleep/wake evidence. Do not infer hardware
  acceptance from tests. Keep personal device UIDs and serials out of Git.
- Maintain project documentation only in `openwiki/` through the OpenWiki page
  lifecycle. Keep README files as short entry points. Do not add a `docs/` tree
  or duplicate the wiki's architecture, operations, or validation pages.
- Preserve the README layout inherited from `acg-box/vibe-mono`. Keep its
  `Support Me` section and all subsequent content identical to the template.

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
