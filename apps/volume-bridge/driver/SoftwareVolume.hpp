#pragma once
#include <aspl/VolumeControl.hpp>
#include <algorithm>
#include <cmath>

// HAL scalar volume is a slider coordinate, not a PCM amplitude multiplier.
// Apply the dB value reported to macOS so the control and DSP agree.
class SoftwareVolume : public aspl::VolumeControl {
 public:
  explicit SoftwareVolume(std::shared_ptr<aspl::Context> context)
      : aspl::VolumeControl(std::move(context)) {}
  void ApplyProcessing(Float32* frames, UInt32 frameCount, UInt32 channelCount) const override {
    const float gain = GetRawValue() == 0 ? 0.0f : std::pow(10.0f, GetDecibelValue() / 20.0f);
    for (UInt32 i = 0; i < frameCount * channelCount; ++i)
      frames[i] = std::clamp(frames[i] * gain, -1.0f, 1.0f);
  }
};
