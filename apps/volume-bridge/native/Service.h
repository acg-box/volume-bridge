#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
  uint32_t default_output;
  uint32_t proxy;
  uint32_t target;
  uint32_t builtin;
  uint32_t sleeping;
  uint32_t driver_connected;
  uint32_t source_active;
  uint32_t reserved;
  uint64_t wake_count;
  uint64_t driver_generation;
  uint64_t output_callbacks;
  uint64_t output_frames;
  uint64_t source_frames;
  uint64_t queued_frames;
  uint64_t underruns;
  uint64_t resyncs;
  uint64_t dropped_frames;
  uint64_t source_peak_million;
  uint64_t output_peak_million;
} BridgeSnapshot;
int bridge_initialize(const char* target_uid);
BridgeSnapshot bridge_snapshot(void);
void bridge_wait(uint32_t milliseconds);
int bridge_set_running(uint32_t target_id, int running);
int bridge_select(uint32_t device_id);
void bridge_publish_available(int available);
void bridge_shutdown(void);
int bridge_command(int argc, const char* const* argv);
#ifdef __cplusplus
}
#endif
