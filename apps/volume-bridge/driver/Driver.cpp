// VolumeBridge HAL driver. No client HAL calls are permitted in this file.
#include "Protocol.hpp"
#include "SoftwareVolume.hpp"
#include <aspl/Driver.hpp>
#include <aspl/Storage.hpp>
#include <dispatch/dispatch.h>
#include <mach/mach_time.h>
#include <sys/mman.h>
#include <syslog.h>
#include <unistd.h>
#include <xpc/xpc.h>
#include <cmath>
#include <memory>

namespace {
class PersistentVolume final : public SoftwareVolume {
 public:
  explicit PersistentVolume(std::shared_ptr<aspl::Context> context)
      : SoftwareVolume(context), storage_(context), context_(std::move(context)) {}
  void restore() {
    const auto saved = storage_.ReadInt("volume.raw");
    SetRawValue(saved.second ? static_cast<SInt32>(std::clamp<SInt64>(saved.first, 0, 96)) : 60);
  }
 protected:
  OSStatus SetRawValueImpl(SInt32 value) override {
    const auto status = aspl::VolumeControl::SetRawValueImpl(value);
    if (status == noErr && context_->Host.load()) storage_.WriteInt("volume.raw", value);
    return status;
  }
 private:
  aspl::Storage storage_;
  std::shared_ptr<aspl::Context> context_;
};

class Handler final : public aspl::ControlRequestHandler,
                      public aspl::IORequestHandler,
                      public aspl::DriverRequestHandler {
 public:
  explicit Handler(std::shared_ptr<PersistentVolume> volume)
      : volume_(std::move(volume)) {
    void* memory = mmap(nullptr, sizeof(bridge::Ring), PROT_READ | PROT_WRITE,
                        MAP_ANON | MAP_SHARED, -1, 0);
    if (memory != MAP_FAILED) ring_ = new (memory) bridge::Ring();
  }
  OSStatus OnInitialize() override {
    if (!ring_) return kAudioHardwareUnspecifiedError;
    volume_->restore();
    queue_ = dispatch_queue_create("com.acgbox.volumebridge.driver.ipc", DISPATCH_QUEUE_SERIAL);
    memory_ = xpc_shmem_create(ring_, sizeof(bridge::Ring));
    token_ = mach_absolute_time();
    timer_ = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue_);
    dispatch_source_set_timer(timer_, DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC, NSEC_PER_SEC / 4);
    dispatch_source_set_event_handler(timer_, ^{
      if (!connection_) connect();
      xpc_object_t message = xpc_dictionary_create(nullptr, nullptr, 0);
      xpc_dictionary_set_string(message, "op", "attach");
      xpc_dictionary_set_uint64(message, "token", token_);
      xpc_dictionary_set_value(message, "memory", memory_);
      xpc_connection_send_message(connection_, message);
      xpc_release(message);
    });
    dispatch_resume(timer_);
    syslog(LOG_NOTICE, "VolumeBridge driver initialized pid=%d", getpid());
    return noErr;
  }
  OSStatus OnStartIO() override { ring_->sourceActive.store(1); notifyActivity(); return noErr; }
  void OnStopIO() override { ring_->sourceActive.store(0); notifyActivity(); }
  void OnWriteMixedOutput(const std::shared_ptr<aspl::Stream>&, Float64, Float64,
                          const void* bytes, UInt32 byteCount) override {
    const auto* samples = static_cast<const float*>(bytes);
    const auto frames = byteCount / (sizeof(float) * bridge::Channels);
    float peak = 0;
    for (uint32_t i = 0; i < frames * bridge::Channels; ++i) peak = std::max(peak, std::abs(samples[i]));
    ring_->sourcePeakMillion.store(static_cast<uint64_t>(std::min(peak, 1000.0f) * 1000000), std::memory_order_relaxed);
    if (ring_->relayEnabled.load(std::memory_order_acquire)) ring_->push(samples, frames);
  }
 private:
  void connect() {
    // A missing launchd service makes the connection permanently invalid.
    // Recreate it on the existing timer after installation or service restart.
    connection_ = xpc_connection_create_mach_service(bridge::ServiceName, queue_, XPC_CONNECTION_MACH_SERVICE_PRIVILEGED);
    const auto connection = connection_;
    xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
      if (connection_ != connection) return;
      if (xpc_get_type(event) == XPC_TYPE_DICTIONARY) {
        if (!xpc_dictionary_get_bool(event, "available")) ring_->relayEnabled.store(0);
      } else if (event == XPC_ERROR_CONNECTION_INTERRUPTED || event == XPC_ERROR_CONNECTION_INVALID) {
        ring_->relayEnabled.store(0);
        if (event == XPC_ERROR_CONNECTION_INVALID) {
          connection_ = nullptr;
          xpc_release(connection);
        }
      }
    });
    xpc_connection_resume(connection);
  }
  void notifyActivity() {
    // Connection replacement and sends share one queue. PCM callbacks do not
    // access the connection or allocate messages.
    dispatch_async(queue_, ^{
      if (!connection_) return;
      auto message = xpc_dictionary_create(nullptr, nullptr, 0);
      xpc_dictionary_set_string(message, "op", "activity");
      xpc_connection_send_message(connection_, message);
      xpc_release(message);
    });
  }
  std::shared_ptr<PersistentVolume> volume_;
  bridge::Ring* ring_ = nullptr;
  dispatch_queue_t queue_ = nullptr;
  dispatch_source_t timer_ = nullptr;
  xpc_connection_t connection_ = nullptr;
  xpc_object_t memory_ = nullptr;
  uint64_t token_ = 0;
};

std::shared_ptr<aspl::Driver> createDriver() {
  auto context = std::make_shared<aspl::Context>(std::make_shared<aspl::Tracer>(aspl::Tracer::Mode::Noop));
  aspl::DeviceParameters params;
  params.Name = "LG ULTRAGEAR+ · VolumeBridge";
  params.Manufacturer = "acg-box";
  params.DeviceUID = bridge::DeviceUID;
  params.ModelUID = "com.acgbox.volumebridge.stereo48";
  params.SampleRate = bridge::Rate;
  params.ChannelCount = bridge::Channels;
  params.Latency = bridge::Prefill;
  params.ZeroTimeStampPeriod = 512;
  auto device = std::make_shared<aspl::Device>(context, params);
  aspl::StreamParameters streamParams;
  streamParams.Format = {bridge::Rate, kAudioFormatLinearPCM,
    kAudioFormatFlagsNativeEndian | kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    8, 1, 8, 2, 32, 0};
  auto stream = device->AddStreamAsync(streamParams);
  auto volume = std::make_shared<PersistentVolume>(context);
  auto mute = std::make_shared<aspl::MuteControl>(context);
  device->AddVolumeControlAsync(volume);
  device->AddMuteControlAsync(mute);
  stream->AttachVolumeControl(volume);
  stream->AttachMuteControl(mute);
  auto handler = std::make_shared<Handler>(volume);
  device->SetControlHandler(handler);
  device->SetIOHandler(handler);
  auto plugin = std::make_shared<aspl::Plugin>(context);
  plugin->AddDevice(device);
  auto driver = std::make_shared<aspl::Driver>(context, plugin);
  driver->SetDriverHandler(handler);
  return driver;
}
}

extern "C" void* VolumeBridgeFactory(CFAllocatorRef, CFUUIDRef type) {
  if (!CFEqual(type, kAudioServerPlugInTypeUUID)) return nullptr;
  static const auto driver = createDriver();
  return driver->GetReference();
}
