#include "SoftwareVolume.hpp"
#include <aspl/Tracer.hpp>
#include <cassert>
#include <memory>

int main() {
  auto context = std::make_shared<aspl::Context>(std::make_shared<aspl::Tracer>(aspl::Tracer::Mode::Noop));
  SoftwareVolume volume(context);
  float previous = -1;
  for (int step = 0; step <= 16; ++step) {
    const float scalar = float(step) / 16;
    const float expectedDB = -64.0f + 4.0f * step;
    assert(volume.ConvertScalarToDecibels(scalar) == expectedDB);
    assert(volume.ConvertDecibelsToScalar(expectedDB) == scalar);
    assert(volume.SetScalarValue(scalar) == noErr);
    assert(volume.GetScalarValue() == scalar);
    assert(volume.GetDecibelValue() == expectedDB);
    float samples[] = {1, -1, 0.5f, -0.5f};
    volume.ApplyProcessing(samples, 2, 2);
    const float gain = samples[0];
    assert(gain > previous && gain <= 1);
    assert(samples[1] == -gain && samples[2] == gain / 2 && samples[3] == -gain / 2);
    if (step == 0) assert(gain == 0);
    if (step == 16) assert(gain == 1);
    if (gain > 0) assert(std::abs(20 * std::log10(gain) - expectedDB) < 0.001f);
    previous = gain;
  }
  assert(volume.SetDecibelValue(-59.0f) == noErr);
  assert(volume.GetScalarValue() == 5.0f / 64.0f);
}
