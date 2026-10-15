# Validation

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
