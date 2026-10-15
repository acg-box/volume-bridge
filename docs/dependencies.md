# Dependency evidence

The Rust service uses only the standard library. libASPL source and its licenses
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
