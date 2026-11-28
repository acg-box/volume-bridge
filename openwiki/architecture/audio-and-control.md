---
type: architecture
title: Audio path and native volume control
description: How the HAL output applies native volume and mute controls, transfers PCM to the physical display, and limits queue growth.
tags: [audio, core-audio, hal, volume, shared-memory]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-28T15:22:04.648Z
sources:
  - id: openwiki-source-349ac7cf64b4e7ebc4729582
    resource: repo://apps/volume-bridge/driver/Driver.cpp
  - id: openwiki-source-5616a4d6af3a79770d22c2d8
    resource: repo://apps/volume-bridge/driver/SoftwareVolume.hpp
  - id: openwiki-source-7a55b95fdb8c8ab883443bc9
    resource: repo://apps/volume-bridge/native/Protocol.hpp
  - id: openwiki-source-6efb4901588b16a31d00a974
    resource: repo://apps/volume-bridge/native/Service.mm
  - id: openwiki-source-e7f8f050fe08414f61265f79
    resource: repo://apps/volume-bridge/tests/native/volume.cpp
generated: { by: "codex", at: "2026-11-28T15:22:04.648Z" }
---

# Audio path and native volume control

VolumeBridge adds a HAL output named **LG ULTRAGEAR+ · VolumeBridge**. It contains
one stereo stream at 48 kHz, a volume control, and a mute control. Applications can
select this output through the normal macOS sound interface. The physical LG
output remains a separate device; VolumeBridge does not patch an Apple endpoint.

## Ownership and data flow

```mermaid
flowchart LR
    A[Application audio] --> H[VolumeBridge HAL output]
    H --> V[Volume and mute processing]
    V --> R[Shared memory ring]
    R --> S[Service output callback]
    S --> L[Physical LG output]
    C[Rust route controller] --> S
    X[XPC registration] -. shares memory handle .-> R
```

The C++ driver implements the libASPL plugin contract. It exposes the output and
writes processed PCM into shared memory. The separate service is a Core Audio
client. Its Objective-C++ adapter renders that PCM to the configured physical
device. Rust decides when rendering must run. Client HAL calls belong in the
service, outside the driver.

The stream uses interleaved 32-bit floating-point stereo PCM. Before it starts
physical output, the service checks for linear PCM, floating-point samples,
32 bits per channel, and a 48 kHz sample rate. It reports an unsupported-format
error when those conditions fail. There is no sample-rate conversion path.

See [device lifecycle](device-lifecycle.md) for selection, authentication, and
sleep/wake decisions.

## The slider controls decibels

The HAL scalar is the slider position from 0 to 1. The control converts it to
decibels and applies this gain to each sample.

```text
reported_dB = 64 * (scalar - 1)
gain = 0                         when the slider is at zero
gain = 10^(reported_dB / 20)      otherwise
sample = clamp(sample * gain, -1, 1)
```

The first of 16 keyboard steps is -60 dB. Each subsequent step adds 4 dB.
Step 8 is -32 dB and step 16 is 0 dB (unity gain). At slider position zero
the control reports its lower limit of -64 dB and outputs exact silence.
Fractional slider positions follow the same decibel slope. libASPL applies
the attached volume and mute controls to the stream.

The driver saves the slider position in libASPL storage. When only an older
raw setting exists, the driver restores the previous slider position by
squaring the saved fraction of the old 0 to 96 range.

The native volume test checks all 16 keyboard intervals. It checks monotonic
gain, channel symmetry, exact silence, unity gain at maximum, and agreement
between the reported decibels and measured sample gain. It also checks the
scalar and decibel conversions at each step and a setting between two steps.

Software gain cannot remove attenuation inside the monitor. Installation
calibrates the monitor separately through DDC/CI, with a mute and low software
volume applied first. See [installation and recovery](../workflows/installation-and-recovery.md).
The original physical LG output bypasses this software attenuation.

## Queue and timing contract

The shared protocol has version 2. Its ring holds 16,384 stereo frames. One writer
owns the write cursor, and one reader owns the read cursor. Acquire/release
atomics publish completed frame writes. A full ring drops new frames and updates
the dropped-frame counter. Reads return only frames that are available. A transfer
uses one contiguous copy or two copies when it crosses the end of the ring.

The render callback clears output buffers before it reads the ring. It waits for
1,024 queued frames before playback, which is approximately 21.3 ms at 48 kHz.
This is the prefill component, not a measurement of total audio latency. If the
queue exceeds 4,096 frames, the callback discards it and waits for a new prefill.
An underrun also clears the primed state; unfilled output remains silent.

VolumeBridge's ring operations and PCM callbacks do not allocate memory, make IPC
requests, or take a mutex. Shared-memory setup, connection changes, and device
operations occur outside those callbacks. The scratch buffer is allocated in
static service storage.

Stopping a relay disables producer writes and discards pending frames. Starting
one enables writes only after `AudioDeviceStart` succeeds. This ordering prevents
a waking physical device from accumulating audio before it can consume it.

This bounded queue is a prototype clock-drift policy. It is not synchronized
resampling and does not establish zero latency. Longer playback acceptance must
measure underruns, dropped frames, and queue resynchronizations.

## Source and tests

- [Driver endpoint and processing](../../apps/volume-bridge/driver/Driver.cpp)
- [Decibel gain](../../apps/volume-bridge/driver/SoftwareVolume.hpp)
- [Shared protocol](../../apps/volume-bridge/native/Protocol.hpp)
- [Physical rendering](../../apps/volume-bridge/native/Service.mm)
- [Ring ordering and capacity tests](../../apps/volume-bridge/tests/native/ring.cpp)
- [Volume curve tests](../../apps/volume-bridge/tests/native/volume.cpp)

Use the [acceptance record](../verification/acceptance.md) to distinguish these
code guarantees from observations on the tested Mac and display.
