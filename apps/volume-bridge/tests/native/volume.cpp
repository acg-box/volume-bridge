#include "SoftwareVolume.hpp"
#include <aspl/Tracer.hpp>
#include <cassert>
#include <memory>

int main() {
  auto context = std::make_shared<aspl::Context>(std::make_shared<aspl::Tracer>(aspl::Tracer::Mode::Noop));
  SoftwareVolume volume(context);
  float previous = -1;
  for (int step = 0; step <= 16; ++step) {
    assert(volume.SetScalarValue(float(step) / 16) == noErr);
    float samples[] = {1, -1, 0.5f, -0.5f};
    volume.ApplyProcessing(samples, 2, 2);
    const float gain = samples[0];
    assert(gain >= previous && gain <= 1);
    assert(samples[1] == -gain && samples[2] == gain / 2 && samples[3] == -gain / 2);
    if (step == 0) assert(gain == 0);
    if (step == 1) assert(gain < 0.001f); // First key step must be below -60 dB.
    if (step == 8) assert(gain < 0.1f);   // Midpoint must be below -20 dB.
    if (step == 16) assert(gain == 1);    // Maximum must not attenuate or amplify.
    if (gain > 0) assert(std::abs(20 * std::log10(gain) - volume.GetDecibelValue()) < 0.001f);
    previous = gain;
  }
}
