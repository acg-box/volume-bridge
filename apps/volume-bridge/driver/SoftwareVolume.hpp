#pragma once
#include <aspl/VolumeControl.hpp>
#include <algorithm>
#include <cmath>

// HAL scalar volume is a slider coordinate, not a PCM amplitude multiplier.
// Apply the dB value reported to macOS so the control and DSP agree.
class SoftwareVolume : public aspl::VolumeControl {
 public:
  explicit SoftwareVolume(std::shared_ptr<aspl::Context> context)
      : aspl::VolumeControl(std::move(context), volumeParameters()) {}

  Float32 GetScalarValue() const override {
    return ConvertDecibelsToScalar(GetDecibelValue());
  }
  OSStatus SetScalarValue(Float32 value) override {
    return SetDecibelValue(ConvertScalarToDecibels(value));
  }
  Float32 ConvertScalarToDecibels(Float32 value) const override {
    return (std::clamp(value, 0.0f, 1.0f) - 1.0f) * DecibelSpan;
  }
  Float32 ConvertDecibelsToScalar(Float32 value) const override {
    return std::clamp(1.0f + value / DecibelSpan, 0.0f, 1.0f);
  }
  void ApplyProcessing(Float32* frames, UInt32 frameCount, UInt32 channelCount) const override {
    const float decibels = GetDecibelValue();
    const float gain = decibels == -DecibelSpan ? 0.0f : std::pow(10.0f, decibels / 20.0f);
    for (UInt32 i = 0; i < frameCount * channelCount; ++i)
      frames[i] = std::clamp(frames[i] * gain, -1.0f, 1.0f);
  }

 private:
  // Sixteen equal slider intervals of 4 dB. Position zero also mutes the PCM.
  static constexpr Float32 DecibelSpan = 64.0f;
  static aspl::VolumeControlParameters volumeParameters() {
    aspl::VolumeControlParameters params;
    params.MinDecibelVolume = -DecibelSpan;
    params.MaxRawVolume = 1 << 16;
    return params;
  }
};
