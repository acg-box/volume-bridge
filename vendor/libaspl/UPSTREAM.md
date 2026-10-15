# libASPL source

Source: https://github.com/gavv/libASPL
Commit: `633e0f70203edd87d320fc5a3cae901e1363aac5`
Commit date: 2025-04-14
Imported: 2026-10-15

Only `include/`, `src/`, and license files are imported. The root build compiles
the checked-in C++ sources. It does not run upstream generators, download test
dependencies, or install the library globally.

Local compatibility changes: define the VolumeControl destructor out of line so
subclasses do not require the private VolumeCurve definition. Put the default
AudioStreamBasicDescription field initializers in SDK declaration order. These
changes do not alter the volume curve or stream format.

This dependency replaces handwritten HAL property dispatch. The library has no
third-party runtime dependency beyond Apple frameworks and the C++ standard
library. Preserve all upstream licenses and source notices.

Selection evidence on 2026-10-15: the source commit matched GitHub; the upstream
CMake build and source inventory were inspected. OSV commit lookup returned no
record. GitHub published repository security advisories returned an empty list.
These checks do not prove the absence of defects. No baseline dependency existed.
Risk coverage: complete for this scoped selection. Risk delta: unchanged for
reported findings. Decision: proceed with local prototype validation.
