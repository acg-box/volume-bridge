#include "Protocol.hpp"
#include <cassert>
#include <memory>
#include <thread>
#include <vector>

int main() {
  auto ring = std::make_unique<bridge::Ring>();
  std::vector<float> input(bridge::Capacity*2), output(bridge::Capacity*2);
  for (size_t i=0;i<input.size();++i) input[i]=static_cast<float>(i);
  assert(ring->push(input.data(),bridge::Capacity)==bridge::Capacity);
  assert(ring->push(input.data(),1)==0);
  assert(ring->dropped.load()==1);
  assert(ring->pop(output.data(),bridge::Capacity)==bridge::Capacity);
  assert(input==output);
  for (int round=0;round<100;++round) {
    assert(ring->push(input.data(),777)==777);
    assert(ring->pop(output.data(),777)==777);
    for (int i=0;i<777*2;++i) assert(input[i]==output[i]);
  }
  assert(ring->pop(output.data(),1)==0);
  constexpr uint32_t count = 100000;
  std::thread producer([&] {
    for (uint32_t i=0;i<count;++i) {
      const float pair[]={static_cast<float>(i),-static_cast<float>(i)};
      while (!ring->push(pair,1)) std::this_thread::yield();
    }
  });
  for (uint32_t i=0;i<count;++i) {
    float pair[2]{};
    while (!ring->pop(pair,1)) std::this_thread::yield();
    assert(pair[0]==static_cast<float>(i));
    assert(pair[1]==-static_cast<float>(i));
  }
  producer.join();
  assert(ring->queued()==0);
  return 0;
}
