#pragma once
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>

namespace bridge {
constexpr const char* ServiceName = "com.acgbox.volumebridge.service";
constexpr const char* DeviceUID = "com.acgbox.volumebridge.lg-output.v1";
constexpr uint64_t Magic = 0x44414252494e4731ULL;
constexpr uint64_t Version = 2;
constexpr uint32_t Rate = 48000;
constexpr uint32_t Channels = 2;
constexpr uint32_t Capacity = 16384;
constexpr uint32_t Prefill = 1024;
constexpr uint32_t MaxQueued = 4096;

// One HAL writer and one physical-device reader. Each side owns one cursor.
// No locks, allocation, IPC, or filesystem access occurs in these operations.
struct alignas(64) Ring {
  uint64_t magic = Magic;
  uint64_t version = Version;
  alignas(64) std::atomic<uint64_t> written{0};
  alignas(64) std::atomic<uint64_t> read{0};
  alignas(64) std::atomic<uint64_t> dropped{0};
  std::atomic<uint64_t> sourceCallbacks{0};
  std::atomic<uint64_t> sourceActive{0};
  std::atomic<uint64_t> relayEnabled{0};
  std::atomic<uint64_t> sourcePeakMillion{0};
  float samples[Capacity * Channels]{};

  uint32_t push(const float* source, uint32_t frames) {
    const auto w = written.load(std::memory_order_relaxed);
    const auto r = read.load(std::memory_order_acquire);
    const auto queued = w - r;
    const auto count = static_cast<uint32_t>(std::min<uint64_t>(frames, Capacity - std::min<uint64_t>(Capacity, queued)));
    for (uint32_t f = 0; f < count; ++f) {
      const auto slot = ((w + f) % Capacity) * Channels;
      samples[slot] = source[f * Channels];
      samples[slot + 1] = source[f * Channels + 1];
    }
    written.store(w + count, std::memory_order_release);
    dropped.fetch_add(frames - count, std::memory_order_relaxed);
    sourceCallbacks.fetch_add(1, std::memory_order_relaxed);
    return count;
  }

  uint32_t pop(float* destination, uint32_t frames) {
    const auto r = read.load(std::memory_order_relaxed);
    const auto w = written.load(std::memory_order_acquire);
    const auto count = static_cast<uint32_t>(std::min<uint64_t>(frames, w - r));
    for (uint32_t f = 0; f < count; ++f) {
      const auto slot = ((r + f) % Capacity) * Channels;
      destination[f * Channels] = samples[slot];
      destination[f * Channels + 1] = samples[slot + 1];
    }
    read.store(r + count, std::memory_order_release);
    return count;
  }

  uint64_t queued() const {
    const auto r = read.load(std::memory_order_acquire);
    return written.load(std::memory_order_acquire) - r;
  }
  void discard() { read.store(written.load(std::memory_order_acquire), std::memory_order_release); }
};
static_assert(std::atomic<uint64_t>::is_always_lock_free);
}
