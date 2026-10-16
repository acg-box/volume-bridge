# Dependency evidence

The initial Rust service used only the standard library. libASPL source and its licenses
are pinned under `vendor/libaspl`; see its `UPSTREAM.md` receipt.

The TypeScript tool graph comes from `acg-box/vibe-mono`. On 2026-10-15, the
inherited lock resolved oxfmt 0.62.0 to tinypool 2.1.0. npm audit reported
GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr. A scoped override raises tinypool to
the fixed 2.1.2 patch line without changing the formatter version.

The npm registry identifies `tinylibs/tinypool` as the producer. The fixed package
has no install lifecycle script or runtime dependency. Lockfile resolution and
installation used `--ignore-scripts`. The final npm audit returned zero findings.

Selection mode: scoped transitive patch correction. Baseline: two critical
reported nodes from one vulnerable transitive package. Final: no reported npm
advisory. Risk coverage: complete for the package identity, lifecycle, registry,
integrity, and advisory checks performed. Risk delta: improved. Decision: proceed
with repository validation. These checks do not establish absence of defects.

## Native installer serialization

Selection mode on 2026-10-15: use Serde and serde_json for the installer receipt
and transaction JSON. The standard library has no JSON parser. Foundation would
move durable installation policy across the SDK binding boundary. A handwritten
parser would add unnecessary input and recovery risk. The Rust module owns this
choice; revisit it if the receipt format or supported platform changes.

The baseline Cargo lock had no registry packages. The resolved graph now contains
serde 1.0.229, serde_json 1.0.154, serde_core 1.0.229, serde_derive 1.0.229,
proc-macro2 1.0.107, quote 1.0.47, syn 3.0.9, unicode-ident 1.0.27, itoa 1.0.18,
memchr 2.8.3, and zmij 1.0.23. Direct requirements select the 1.0 minor series and
inherit from the workspace. Cargo generated the lock.

Registry metadata identifies the serde-rs, dtolnay, and BurntSushi source
repositories. All eleven registry checksums match the resolved lock. OSV's exact
crates.io name/version query returned no advisory for every resolved package.
These checks are recorded as checked-no-record on 2026-10-15. Cargo's artifact
checksum verification also passed. No external registry source was introduced.

All new build scripts were inspected before execution. They select compiler
capabilities, compile local probes, or write generated Rust files. They do not
download binaries or execute network requests. Derive macros execute at build
time. The installed binaries have no dependency on a Rust runtime distribution.
Dependency license files are included in the install payload.

Risk coverage: complete for registry identity, integrity, build behavior, and the
advisory checks performed. Risk delta: unchanged for reported findings; the source
graph is larger. Decision: proceed with repository and package validation. This
evidence does not establish absence of defects or malicious behavior.
