# Signing and releases

VolumeBridge adapts the ACG macOS release contract to two flat product archives.
It does not use Sparkle or install an application UI. The release contains exactly:

- `VolumeBridge-X.Y.Z.pkg`
- `Uninstall-VolumeBridge-X.Y.Z.pkg`
- `VolumeBridge-X.Y.Z-release.json`

The JSON binds both final file sizes and SHA-256 hashes to the source commit,
version, architecture, Apple team, upload hashes, and notarization submission IDs.
It is a provenance record. Apple signatures and stapled tickets provide the
package trust checks.

## Shared credentials

The expected Apple team is `4N949UKQ55`. The signer requires one Developer ID
Application identity and one Developer ID Installer identity from that team.
The organization owns these GitHub Actions secrets:

| Secret | Content |
| --- | --- |
| `ACG_MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64` | Encrypted Application identity and private key, encoded as Base64. |
| `ACG_MACOS_DEVELOPER_ID_APPLICATION_P12_PASSWORD` | Application P12 password. |
| `ACG_MACOS_DEVELOPER_ID_INSTALLER_P12_BASE64` | Encrypted Installer identity and private key, encoded as Base64. |
| `ACG_MACOS_DEVELOPER_ID_INSTALLER_P12_PASSWORD` | Installer P12 password. |
| `ACG_MACOS_NOTARY_API_KEY_ID` | App Store Connect Team Key ID. |
| `ACG_MACOS_NOTARY_API_ISSUER_ID` | Team Key issuer ID. |
| `ACG_MACOS_NOTARY_API_PRIVATE_KEY_P8` | Team Key private key in PEM format. |

The key has the Developer role. Organization access is `all repositories`.
Do not add repository or environment secrets with the same names. Keep recovery
copies in the owner's protected secret store. The legacy `APPLE_*` organization
secrets are not used by this workflow. No signing identity label or persistent
GitHub publication token is required.

## Workflow

The workflow runs for stable annotated `vX.Y.Z` tags. The tag must point directly
to the checked-out commit, and that commit must be an ancestor of canonical
`main`. The Cargo workspace, Cargo lockfile, driver versions, and tag must agree.
Prerelease tags, leading zeroes, and lightweight tags are rejected.

The Linux source job validates those bindings. The Apple Silicon `macos-26` job
runs the repository checks and builds without release credentials. The next
step imports the two certificates into an isolated keychain and signs each
payload component with hardened runtime and a secure timestamp. It signs both
product archives, submits them to Apple, and binds each response to its upload
hash. It requires Accepted status, a matching notarization log without errors,
valid stapled tickets, and Gatekeeper acceptance.

The signing keychain stays in the search list until packaging finishes.
The user's original default keychain remains selected during packaging.
The signer restores the original search list and default before it removes the
temporary keychain, including when packaging fails.

The Linux publisher receives only the final assets, public source metadata, and
the ephemeral workflow token. It uses the repository's `release` environment,
with reviewer `acgxv`, self-review permitted, and tag deployment policy `v*`.
Only this job has `contents: write`. The environment contains no secrets.
The source validator enforces stable tag syntax more narrowly than `v*`.

The publisher first validates the local assets. It creates or reuses a draft,
uploads exactly the three assets, and checks their metadata and downloaded bytes.
GitHub can assign temporary `untagged-` browser URLs to draft assets. The publisher
downloads drafts by authenticated asset ID and verifies their bytes. After
publication, it requires the canonical tag URL for every public asset.
It rechecks the remote annotated tag, main ancestry, and version advance before
publication. It downloads the public files and verifies them after publication.
An already public same-tag rerun is read-only and verifies the existing files.

## Release procedure

1. Complete source review, merge the intended commit into `main`, and obtain
   authorization for the exact version and tag.
2. Fetch canonical `main` and all remote tags. Confirm that the version advances
   every remote stable tag and public stable release.
3. At the intended commit, create one annotated tag and run
   `node scripts/release/source.ts vX.Y.Z` before pushing that tag.
4. Push the exact tag. Inspect the source and package jobs. Review the protected
   publisher only after the signing and notarization evidence is complete.
5. Confirm the workflow and public readback. A local package test does not
   establish a completed public release.

The workflow never creates or moves tags. Source fixes require a new version
after a remote tag has been published.

## Recovery and local checks

The local publisher check makes no GitHub requests:

```sh
node scripts/release/publish.ts --dry-run DIRECTORY VolumeBridge-X.Y.Z-release.json
```

If Apple processing exceeds the bounded wait, preserve the packages and JSON
receipts. The failed CI job retains them in `notarization-recovery` for seven days.
Recover them at the same source revision and use the credential-injected signer
with `--resume`, as described in [packaging](packaging.md). Reuse a submission only
when its upload hash matches the exact package. Do not rebuild over a pending
submission or bypass the Accepted requirement.

If publication is uncertain, inspect the release ID and public assets before a
new write. Do not replace public assets or manually publish an unverified draft.
No public GitHub release is implied by the local Developer ID validation record.
