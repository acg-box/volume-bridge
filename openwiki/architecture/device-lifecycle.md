---
type: lifecycle
title: Device routing, reconnects, and sleep
description: Rust routing decisions, authenticated XPC attachment, output switching, and recovery after service restarts or sleep.
tags: [routing, xpc, sleep, wake, lifecycle]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T06:30:02.662Z
sources:
  - id: openwiki-source-349ac7cf64b4e7ebc4729582
    resource: repo://apps/volume-bridge/driver/Driver.cpp
  - id: openwiki-source-6efb4901588b16a31d00a974
    resource: repo://apps/volume-bridge/native/Service.mm
  - id: openwiki-source-69a3b23c1cfb118e7aa59f45
    resource: repo://apps/volume-bridge/src/main.rs
  - id: openwiki-source-a2038a92fe0c7f97a6aab8d9
    resource: repo://apps/volume-bridge/src/route.rs
generated: { by: "codex", at: "2026-10-16T06:30:02.662Z" }
---

# Device routing, reconnects, and sleep

The `volume-bridge serve --target-uid UID` process owns route policy. Rust reads a
snapshot from the native adapter, decides whether the configured physical output
must render, and applies transitions outside the audio callback. Native property
listeners and power notifications wake the controller; its normal wait is bounded
at 200 ms.

## Device identity and route selection

The native adapter resolves the physical output from its saved UID. It also
requires the Core Audio DisplayPort transport value and manufacturer `GSM`.
This is an API filter, not a description of the cable connector. The recorded
hardware setup uses USB-C. Core Audio device numbers are temporary; saved
installation state uses UIDs instead.

The route runs only when all these conditions hold:

- The proxy and configured physical output are present.
- The proxy is the current default output.
- The driver connection is ready and a client is writing audio.
- The system is not sleeping.

Selecting built-in speakers or another output stops the relay. Reconnecting the
LG does not select the proxy over the user's current choice. The driver keeps
its HAL endpoint registered while it is loaded; service availability is separate
from that endpoint's registration.

## XPC attachment and authentication

The system launch daemon provides the Mach service
`com.acgbox.volumebridge.service`. The driver sends an attachment message with a
shared-memory handle and a generation token every two seconds. Audio samples
travel through the shared ring, not through XPC messages.

For attachment requests, the service requires a code signature anchored to Apple
and an identifier beginning with `com.apple.audio`. It checks the shared-memory
size, protocol magic, and version before accepting the mapping. A new mapping
first becomes pending. The controller stops physical I/O before it replaces the
old mapping, discards old audio, and marks the connection ready.

Status requests use a different rule: the client must satisfy the service's own
designated code-signing requirement. A locally rebuilt binary with a different
identity can therefore fail to query an installed service. Use the installed
binary for diagnostics.

## Reconnect behavior

An interrupted XPC connection disables producer writes. A permanently invalid
connection is released and cleared. On the next timer event, the driver creates
a new connection. This handles a driver that starts before its launchd service
exists, as well as later service replacement.

Connection replacement, timer messages, and activity notifications use one
serial dispatch queue. PCM callbacks do not access the connection. The controller
also tracks the driver generation token. A changed generation stops the previous
render session before it starts a new one.

## Sleep, wake, and fallback

IOKit notifications set the sleeping flag and advance the wake counter after
power-on. The route predicate stops output during sleep. A changed wake counter
starts a fresh rendering generation and a 15-second display-enumeration grace
period. Recent display presence also has a three-second grace period.

While the display is absent, physical rendering stays stopped. After the grace
period expires, the controller selects a built-in output only if the proxy is
still selected and a built-in output is available. It does not overwrite a
different user-selected output. The output-selection helper moves the system
effects route only when that route previously followed the old default output.

Stopping physical I/O disables producer writes and discards the ring. Starting
it enables writes only after the physical device starts successfully. A failed
start is reported and retried after a one-second controller delay. The
[audio path](audio-and-control.md) explains the prefill and queue behavior.

## Diagnostics and acceptance

The installed binary supports these read-only observations:

```sh
"/Library/Application Support/VolumeBridge/bin/volume-bridge" devices
"/Library/Application Support/VolumeBridge/bin/volume-bridge" status
```

The status reply includes route IDs, connection and sleep state, wake and driver
generations, callback/frame counters, queue depth, underruns, resynchronizations,
dropped frames, and sample peaks. The status client has a five-second reply
timeout. Device listings can contain personal UIDs; keep raw reports out of
public documentation.

The [route tests](../../apps/volume-bridge/src/route.rs) exercise the predicate for
selection changes, absent inputs, and sleep. They do not simulate an actual
hardware wake or prove long-running audio quality. See the
[acceptance record](../verification/acceptance.md) for observed switching,
reconnect, and sleep/wake results, and
[installation and recovery](../workflows/installation-and-recovery.md) for service
replacement and saved settings.
