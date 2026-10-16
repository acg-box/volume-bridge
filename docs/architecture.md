# Architecture

This prototype has two runtime components and no application UI.

- `VolumeBridge.driver` publishes a stereo 48 kHz output with native volume
  and mute controls. libASPL owns the HAL object contract. The driver applies gain
  before it writes samples to a bounded shared-memory ring.
- `volume-bridge serve` uses Rust for route and lifecycle policy. Its
  native SDK adapter owns XPC connections, physical Core Audio callbacks, and
  IOKit power notifications. It runs as the installing user, not as root.

The system launch daemon publishes one Mach service. The driver provides a shared
memory handle over XPC. Audio samples stay on this Mac. The service accepts driver
connections only from an Apple-signed audio host. Status clients must match the
service's own code-signing requirement. No microphone or loopback input is added.

The driver retries registration every two seconds. If the service name does not
exist yet, XPC invalidates that connection permanently. The driver releases it
and creates a new connection on the next timer event. Connection replacement and
activity messages use the same serial queue. The PCM callback does not access
the connection. Loading the driver before the service is registered must recover
without restarting the driver host.

Client HAL API calls are forbidden inside the driver. The service is a separate
HAL client and sends audio only to the configured physical LG device UID. It runs
that output only while the proxy is the default output and the target is present.
Switching to another output stops the relay. Reconnecting a display does not replace
the user's selected output. Sleep stops I/O; wake starts a fresh relay when
the selected output still requires it.

The HAL endpoint stays registered while the driver is loaded. Service restarts
do not toggle the device's hidden or alive properties. The service stops the
relay when the physical display is absent. After a wake event it allows up to
15 seconds for that display to enumerate before it selects built-in speakers.
It does not select the proxy over another user-selected output. A disabled relay
also stops writes to the shared ring, so inactive routes do not fill the queue.
The service enables writes only after the physical output has started. A device
that is still waking cannot fill the queue before it can consume frames.

The first prototype uses a 1,024-frame prefill (21.3 ms at 48 kHz) and a bounded
queue. It drops new frames on a full ring and re-anchors a queue above 4,096
frames. This is a prototype clock-drift policy, not a claim of zero latency or
professional audio quality. Long playback and hardware acceptance must measure
underruns and resynchronization. Replace it with clock-synchronized resampling if
those measurements require it.

The driver cannot add a control to Apple's existing LG endpoint. Both endpoints
remain visible. No Apple system binary or security setting is modified.

## Volume curve

The HAL scalar is a slider coordinate. DSP uses `10^(dB/20)`, with exact silence
at zero. The dB range is -96 to 0. At 1/16 scalar, the driver reports -72 dB and
applies the same attenuation. At maximum it applies unity gain. Tests compare
reported dB with the measured sample gain at all 16 keyboard steps. The earlier
prototype multiplied samples by the scalar coordinate directly; that made low
steps too loud after hardware calibration. The override fixes that mismatch.

## Installation calibration

The system slider controls software attenuation. Its maximum is unity gain;
it cannot overcome attenuation inside the display. The installer reads DDC/CI
VCP 0x62 and saves the original hardware volume in its local receipt. It mutes
the bridge and sets software volume to 2% before it raises hardware volume to
100%. A DDC readback must confirm the change before unmute. A repeated install
preserves the first hardware receipt and the current calibrated software volume.
On failure, it restores hardware before software volume and routing. If hardware
restoration fails, the bridge stays muted and installation reports an error.

The DDC helper matches the configured Core Audio UID to EDID identity. Core Audio
can mask the EDID serial bytes; this form still requires exactly one match.
Ambiguous matches cannot change hardware volume. The helper uses private Apple
Silicon IOAV calls only during installation and removal. It does not run in the
audio callback or poll during normal playback. Uninstall restores hardware volume
before selecting the original output. Keep the display connected for removal.

## Language boundary

Rust owns the long-running service and route policy. C++ is limited to the
libASPL plugin interface, real-time buffer transfer, and Apple SDK callbacks.
Objective-C++ binds XPC blocks and Foundation JSON output. These SDK and library
interfaces are the reason for the native-language boundary.
