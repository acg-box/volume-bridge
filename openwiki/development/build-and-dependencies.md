---
type: development
title: Build, tests, and dependencies
description: Repository-owned build and validation commands, tool selection, native linkage, dependency provenance, and documentation ownership.
tags: [build, testing, dependencies, rust, typescript, provenance]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T06:30:02.662Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-9ec1a584061158fcfc6acaae
    resource: repo://apps/volume-bridge/build.rs
  - id: openwiki-source-589635d050c1ba0499df0c29
    resource: repo://apps/volume-bridge/CMakeLists.txt
  - id: openwiki-source-c8b1a2a9f2113ec43d4066da
    resource: repo://Makefile.toml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-faabd6d6bc9acd8ff6590dc8
    resource: repo://vendor/libaspl/UPSTREAM.md
generated: { by: "codex", at: "2026-10-16T06:30:02.662Z" }
---

# Build, tests, and dependencies

Build VolumeBridge on macOS with the host-managed Xcode toolchain and the tools
selected by the repository. The installed packages contain compiled code and
system-utility entry points. They do not require the user's Mac to have the
development tools listed here.

## Command entry points

Run commands from the repository root:

```sh
npm ci --ignore-scripts
cargo make build
cargo make check
```

| Task | Responsibility |
| --- | --- |
| `cargo make build` | Build the native driver and SDK adapter, then the Rust release binary. |
| `cargo make check` | Build native targets, type-check TypeScript, run lint, and run native, Rust, and Node tests. |
| `cargo make test` | Run native tests, cargo-nextest, and Node tests. |
| `cargo make fmt` | Apply nightly rustfmt, Taplo, and oxfmt. Formatting is separate from the check task. |
| `cargo make list-template-markers` | Report tracked template markers for adoption review. |
| `cargo make build-package-local` | Build local test packages with an explicitly selected code-signing identity. |
| `cargo make build-package` | Build and invoke the credential-injected release signer. |

Use [signed package releases](../operations/releases.md) for release credentials
and the CI process. A local package is not a distribution release.

## Tools and native linkage

`rust-toolchain.toml` selects stable Rust, the minimal profile, and Clippy. Rust
formatting explicitly uses nightly rustfmt. The Node and npm versions are 26.8.1
and 11.19.0. Package metadata and the npm lockfile select the TypeScript tool graph.
Do not change host defaults or install replacement tools to bypass a missing
repository prerequisite.

The native build uses CMake 3.20 or later, C++17, Objective-C++, and the SDK and
Clang selected through `xcrun`. It sets the macOS deployment target to 14.0.
CMake produces the HAL module, a static `bridge_native` adapter, and two test
executables. The Rust build links that adapter, the C++ runtime, and the Apple
CoreAudio, CoreFoundation, Foundation, Security, and IOKit frameworks.

The main outputs are:

- `target/native/VolumeBridge.driver`
- `target/native/libbridge_native.a`
- `target/release/volume-bridge`

The [audio architecture](../architecture/audio-and-control.md) explains why the
HAL and Apple SDK interfaces remain native while Rust owns route and installer
policy.

## CI checks

Pull requests and `main` pushes run the checked-in macOS 26 workflow with read-only
repository permission. It installs cargo-make 0.37.24 and cargo-nextest 0.9.143,
then runs `npm ci --ignore-scripts`, `cargo make check`, and `cargo make build`.
It does not receive release credentials.

The workflow builds vibe-style from Git revision
`3f39ce57b54def2cdd95a330faae299f5eb55014`. That version requires Git metadata which
its crates.io archive does not contain. Keep the checked-in command when changing
runner setup; replacing it with a registry install reintroduces the observed
build failure.

## Dependency ownership and licenses

| Dependency group | Owner and purpose |
| --- | --- |
| libASPL | Checked-in C++ source at revision `633e0f70203edd87d320fc5a3cae901e1363aac5`; implements HAL object dispatch and controls. |
| Serde and serde_json | Rust-owned serialization for installation receipts, snapshots, and transaction data. Workspace requirements select the 1.0 series; Cargo.lock fixes the resolved graph. |
| TypeScript, oxfmt, Oxlint, and type definitions | Development-only tools selected by package.json and package-lock.json. |
| Apple frameworks and C++ runtime | System libraries used by the compiled runtime. |

The native build compiles vendored libASPL directly. It does not run its upstream
generators or install it globally. Local compatibility changes move the volume
control destructor out of line and put stream-format field initializers in SDK
order. The [upstream receipt](../../vendor/libaspl/UPSTREAM.md) records these changes
and preserves license provenance.

The npm override selects `tinypool ~2.1.2` under oxfmt. The dependency review on
2026-10-15 recorded zero npm audit findings after that correction and no OSV
record for the resolved Rust dependencies. These are dated observations, not a
current security assessment. Their original scope and limitations are retained
in the [historical dependency record](https://github.com/acg-box/volume-bridge/blob/c8245e621c5e50ce92786d3dfc7ae7c78d66dcca/docs/dependencies.md).

The package builder copies the project license, Rust dependency license files,
and the three libASPL license notices into the installation payload. The project
uses GPL-3.0-only; dependency notices retain their own terms.

## Template and documentation ownership

The repository was created from `acg-box/vibe-mono`. The adoption record identifies
template revision `3ec54864bfc4004783541c01b2518689339073da` and initial repository
commit `49127177111a820b4529480d49af4cd61986e3cc`. It retained the workspace and
validation structure while replacing the generic cross-platform CLI distribution
with the macOS driver and service. See the
[historical adoption record](https://github.com/acg-box/volume-bridge/blob/c8245e621c5e50ce92786d3dfc7ae7c78d66dcca/docs/template-adoption.md).

OpenWiki owns the maintained architecture, operations, and validation pages.
README files provide entry points. Use the OpenWiki page lifecycle to update
pages and source Claims; do not edit its generated indexes or metadata directly.
Do not maintain a second `docs/` tree.

See [acceptance](../verification/acceptance.md) for the distinction between tests,
package operations, hardware observations, and public release verification.
