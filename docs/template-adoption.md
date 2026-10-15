# Template adoption

GitHub created `acg-box/volume-bridge` as a public repository from
`acg-box/vibe-mono` on 2026-10-15. The GitHub repository metadata confirms
`template_repository.full_name = acg-box/vibe-mono`.

The template main commit at initialization was
`3ec54864bfc4004783541c01b2518689339073da`. The generated repository's first commit
was `49127177111a820b4529480d49af4cd61986e3cc`.

The adoption keeps the workspace layout, license, pinned TypeScript tool graph,
Rust toolchain policy, marker scanner, and cargo-make validation entrypoints.
The default application package is renamed to `apps/volume-bridge`.

The template's cross-platform CLI release workflow and mold installer do not
apply to this macOS driver prototype and were removed. No release is published.
The inherited OpenWiki pages describe the source template. They were removed;
the product's current architecture and acceptance scope live under `docs/`.
