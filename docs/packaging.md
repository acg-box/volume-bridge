# Packaging and recovery

The release unit contains two flat macOS product archives. Each opens in Apple's
Installer. Neither package installs an application UI.

| Package | Operation |
| --- | --- |
| VolumeBridge | Install or update the HAL driver and user-owned background service, then calibrate hardware volume. |
| Uninstall VolumeBridge | Restore the saved hardware volume and output, then remove the runtime. |

The supported package target is Apple Silicon and macOS 14 or later. Hardware
acceptance remains limited to the Mac and LG recorded in the validation report.
Install on the startup disk while a desktop user is signed in.

## Runtime and privilege boundary

The package contains compiled Mach-O code. A small shell entry point checks the
target volume and executes the bundled binary. There is no development runtime,
package manager, network download, or source build during installation.

Rust owns installation state, calibration ordering, file replacement, and recovery.
Apple Installer provides administrator authorization. Root owns the installed
files. The background service runs as the desktop user. Audio preference and DDC
commands run in that user's bootstrap session and identity. A root-owned temporary
copy of the same binary permits execution from outside PackageKit's private
script directory. It is removed when the installer process exits.

Device IDs are local to a Core Audio client. Installation commands pass device
UIDs and resolve them inside the process that changes the property. They do not
pass temporary IDs from a separate enumeration process. Short-lived audio commands
have a 20-second timeout so a stalled HAL call cannot hold the installation open.

The installer reads hardware volume before it replaces files. It verifies both
code signatures, requires exactly one matching LG, and checks ownership of an
existing installation. Existing prototype receipts remain readable.

## Recovery

A system lock prevents concurrent VolumeBridge installation operations. Before
changes, the installer copies the current owned runtime, driver, and launch
configuration to a protected transaction directory and saves the audio snapshot.
The first original-volume receipt remains unchanged across updates.

On failure, it mutes the bridge, restores hardware volume, restores the previous
files, restarts Core Audio, and restores the previous software volume and output.
If recovery cannot reach the display, the transaction is retained. The next run
attempts recovery before it starts a new installation. Keep the original display
connected when retrying. The directory is removed after success.

Removal requires the original display so hardware restoration can be verified.
It does not silently delete the information needed to undo calibration.

## Build and trust

Use `cargo make build-package-local` with `VOLUMEBRIDGE_SIGN_ID` for local tests.
The payload is code signed, but the local product archives are not distribution
signed or notarized. A local package is not proof of Gatekeeper acceptance.

A release uses `cargo make build-package` and requires:

- `VOLUMEBRIDGE_SIGN_ID`: an existing Developer ID Application identity.
- `VOLUMEBRIDGE_INSTALLER_SIGN_ID`: an existing Developer ID Installer identity.
- `VOLUMEBRIDGE_NOTARY_PROFILE`: an existing notarytool keychain profile name.

The release path signs code with hardened runtime and a timestamp, signs each
product archive, submits it to Apple, staples the ticket, and checks Gatekeeper.
It fails if any step fails. Credentials and signing keys stay outside the repository.

Apple describes these requirements in
[Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
and [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
