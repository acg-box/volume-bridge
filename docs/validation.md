# Validation

## Developer ID release preparation for 0.2.0

Recorded on 2026-10-16. Both product archives and all bundled Mach-O components
pass the Developer ID signature checks for team `4N949UKQ55`. The payload uses
hardened runtime and secure timestamps. Both product signatures have trusted
timestamps and the Developer ID Installer certificate chain.

The signing process successfully authenticated to Apple's notarization service
with the shared Developer Team Key. Both packages were submitted. Accepted status,
stapled tickets, and Gatekeeper acceptance remain pending. No public release or
version tag has been published.

The release adapter passed `cargo make check`: seven Rust tests, two native
tests, seven TypeScript tests, type checking, and lint. The new release tests
cover source and version binding, annotated tags, main ancestry, asset tampering,
and a publisher dry-run without network tools. These results do not establish
GitHub release workflow acceptance. The credential-free macOS CI run also passed
at revision `b7382d6ada12311fc452dc61e77af26059bfa712`.

An actual Developer ID package update preserved output selections, software
volume, mute, and the original hardware-volume receipt. The signed uninstall
restored the original hardware volume and output and removed the owned runtime.
A subsequent fresh installation returned success but did not satisfy the
immediate low-volume assertion. Its exact initial readback was not retained, so
that result remains unclassified.

A repeat cycle encountered 20-second Core Audio device-enumeration timeouts after
removal. The desktop was unlocked. Automatic rollback retained its transaction
when enumeration also timed out during recovery. The same query later succeeded
once after a server restart, then timed out again. A bounded stack sample showed
Core Audio plug-in-list processing. System logs also reported a load failure for
another installed HAL driver; causality has not been established. This blocks
installation acceptance for the signed candidate. Do not infer readiness from
the successful earlier local-package cycles below.

## Local package validation for 0.2.0

Recorded on 2026-10-15 with macOS 27.2, an Apple Silicon Mac, and one LG
ULTRAGEAR+ connected by USB-C. Artifact hashes are recorded below.

Status: local installation, update, removal, rollback, native controls, and
sleep/wake checks pass. Developer ID distribution remains pending.

The destination uses only the bundled binary and macOS system utilities. Dynamic
link inspection found only Apple system libraries. The build and repository
checks pass with seven Rust tests, two native tests, and two TypeScript tests.
Actual package operations ran through `/usr/sbin/installer` with an empty
environment and only `/usr/bin:/bin:/usr/sbin:/sbin` in PATH. The Installer GUI
also opened the installation package and rendered its welcome page. The complete
package operations were checked through the system installer CLI.

| Check | Evidence and result |
| --- | --- |
| Repair an incomplete prototype installation | The package installed version 0.2.0, loaded the driver, and connected the service. It preserved the selected built-in output and the original hardware-volume receipt of 5/100. Hardware calibration read back 100/100. |
| Update | A second installation preserved the selected proxy, system-effects output, volume 0.19140625, and mute state. The original hardware-volume receipt remained 5/100. |
| Uninstall | The removal package restored hardware volume 5/100 and the original LG output. The driver, runtime, launch plist, launch service, and transaction directory were absent. The proxy was absent from Core Audio. |
| Repeated removal | Running the removal package again succeeded without an installed runtime. |
| Fresh installation | After removal, installation selected the proxy, started at approximately 2% software volume, calibrated hardware to 100/100, and recorded the original hardware value of 5/100. |
| Failed file copy | A test payload with no licenses directory caused a file-copy failure after the transaction began. Recovery restored the binary, driver, and receipt with identical SHA-256 hashes. All enumerated devices retained their output selections, volume, and mute. The service reconnected and the transaction directory was removed. |
| Native controls | Sound Settings exposed the output slider and mute checkbox. Setting the slider to the first step and enabling mute in the UI read back as scalar 0.0625 and mute 1 through Core Audio. |
| Output switching | With silent PCM active, built-in selection stopped relay callbacks. Selecting the proxy resumed callbacks. This run reported zero underruns, zero dropped producer frames, and two queue resynchronizations. |
| Restart | After a user-initiated reboot, the driver and service started automatically, the proxy remained selected, and hardware volume read back 100/100. |
| Sleep and wake | The final package completed a real sleep and automatic wake. The physical LG device received a new Core Audio ID. The relay resumed, the proxy stayed selected, and volume and mute were preserved. The run reported zero underruns, zero dropped producer frames, and two resynchronizations across the transition. During the next measured interval, callbacks continued and no counter increased except frame and callback counts. |

The first sleep/wake session was interrupted by a user-initiated reboot. A later
completed run exposed 6,656 dropped producer frames during the transition. The
service had enabled writes before the physical device finished starting. It now
enables writes only after `AudioDeviceStart` succeeds. The final run above used
the corrected package and reported no dropped frames. The final package also
passed another update, uninstall, and fresh installation cycle.

Power settings match the pre-test snapshot, including the original
`SleepDisabled` value. Test wake events are no longer scheduled. These silent-PCM
measurements confirm control and callback recovery; they do not establish
gap-free acoustic playback. The two transition resynchronizations discard
buffered audio, as described in the architecture.

The local packages contain payload code signed with an Apple Development identity.
The local product archives are unsigned and not notarized. Distribution
credentials were not yet available during this local validation. The separate
Developer ID preparation record above describes the later signing work.

| Artifact | SHA-256 |
| --- | --- |
| `VolumeBridge-0.2.0-local.pkg` | `a36bb181ae8ff0524bf61fe620aff8b3b1c233e1a6d3633c9fd885ab382cc666` |
| `Uninstall-VolumeBridge-0.2.0-local.pkg` | `af7ef889255500383edeb0d6960fd4eaaf8a850b295fe48923c9fe408412f9ac` |

Earlier package tests exposed process-local Core Audio device IDs and later
encountered enumeration timeouts while the desktop was locked. Stable UID
resolution, desktop-session commands, bounded commands, and stable HAL registration
were included in the tested revision. The later successful package runs do not
establish the cause of those earlier system audio timeouts.

## Prototype 0.1.0 evidence

Recorded on 2026-10-15 with macOS 27.2, an Apple Silicon Mac, and one LG
ULTRAGEAR+ connected by USB-C. This is prototype acceptance for that combination.

| Check | Evidence and result |
| --- | --- |
| Build and signing | Driver and service built with the host Xcode toolchain. Installed signatures pass verification. SIP remains enabled. |
| Repository checks | `cargo make check` passes: native ring and volume tests, three Rust route tests, seven TypeScript tests, typecheck, and lint. |
| Native volume | Sound Settings shows a writable volume slider and mute control on `LG ULTRAGEAR+ · VolumeBridge`. The user confirmed that the corrected first step and upward adjustment sound normal. |
| DSP curve | Tests cover all 16 keyboard steps. Reported dB matches sample gain; zero is silence, the first step is -72 dB, and maximum is unity. |
| Native mute | A low-level signal measured zero at both the driver and physical output callback when the native mute checkbox was enabled. |
| Output switching | Built-in speaker selection stopped LG callbacks while a client still wrote to the proxy. Selecting the proxy resumed callbacks and preserved its volume. The user selected built-in speakers instead of AirPods for this test. |
| Sleep and wake | A real system sleep produced a power event. After wake, the LG physical device had a new ID. The proxy remained selected, callbacks resumed, and the volume was unchanged. Original power settings were restored. |
| Installation calibration | The monitor initially reported 5/100. Installation saved this value, muted and lowered the software control, set hardware volume to 100, and verified it. |
| Update and removal | Repeated installation preserved the calibrated software volume and original hardware receipt. Actual uninstall removed the driver and service, restored the original output, and read back hardware volume 5/100. Reinstall calibrated the monitor again. |

The final switch/sleep/wake run reported zero underruns and zero dropped producer
frames. It also reported three queue resynchronizations across route and wake
transitions. A resynchronization discards buffered audio. These counters are not
proof of gap-free playback or a measured acoustic latency result. Silent PCM was
used for the final transition tests to avoid repeated audible test tones.

A separate 60-second silent playback check kept the output active and reported
zero underruns and zero dropped producer frames. After its initial start, no
additional resynchronization occurred in the last 50 seconds.

Limits: no AirPods test, no cable hot-plug acceptance, no multi-monitor acceptance,
no long-duration playback acceptance, and no notarized distribution installer.
The fixed 48 kHz bridge uses independent clocks and a bounded queue. Clock-drift
resampling remains future work if longer playback exposes audible discontinuities.
DDC calibration depends on private Apple Silicon IOAV interfaces. A monitor OSD
change or reset requires recalibration by the installer.

Machine-specific UIDs, raw runtime snapshots, and installation receipts remain
outside Git. The public record separates source checks, measured callbacks,
native UI behavior, and the user's audible confirmation.
