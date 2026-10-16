#include "Service.h"
#include "MonitorVolume.hpp"
#include "Protocol.hpp"
#import <Foundation/Foundation.h>
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <IOKit/IOMessage.h>
#include <IOKit/pwr_mgt/IOPMLib.h>
#include <Security/Security.h>
#include <dispatch/dispatch.h>
#include <sys/mman.h>
#include <signal.h>
#include <unistd.h>
#include <xpc/xpc.h>
#include <array>
#include <cmath>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
std::string targetUID;
std::mutex ipcMutex;
bridge::Ring* ring = nullptr;
bridge::Ring* pendingRing = nullptr;
size_t ringBytes = 0, pendingBytes = 0;
uint64_t providerToken = 0;
xpc_connection_t provider = nullptr, listener = nullptr;
SecRequirementRef clientRequirement = nullptr;
dispatch_semaphore_t changed = nullptr;
std::atomic<bool> connected{false}, available{false}, sleeping{false};
std::atomic<uint64_t> wakes{0}, callbacks{0}, rendered{0}, underruns{0}, resyncs{0}, outputPeak{0};
AudioDeviceID renderDevice = 0;
AudioDeviceIOProcID renderProc = nullptr;
bool primed = false;
std::array<float, bridge::Capacity * bridge::Channels> scratch{};

AudioObjectPropertyAddress property(AudioObjectPropertySelector selector,
  AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal,
  AudioObjectPropertyElement element = kAudioObjectPropertyElementMain) {
  return {selector, scope, element};
}
template<class T> bool readProperty(AudioObjectID id, AudioObjectPropertySelector selector, T& value,
  AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
  auto address = property(selector, scope);
  UInt32 size = sizeof(value);
  return AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) == noErr;
}
std::string textProperty(AudioObjectID id, AudioObjectPropertySelector selector) {
  CFStringRef value = nullptr;
  if (!readProperty(id, selector, value) || !value) return {};
  char bytes[1024]{};
  CFStringGetCString(value, bytes, sizeof(bytes), kCFStringEncodingUTF8);
  CFRelease(value);
  return bytes;
}
std::vector<AudioDeviceID> devices() {
  auto address = property(kAudioHardwarePropertyDevices);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size)) return {};
  std::vector<AudioDeviceID> ids(size / sizeof(AudioDeviceID));
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, ids.data())) return {};
  ids.resize(size / sizeof(AudioDeviceID));
  return ids;
}
uint32_t outputChannels(AudioDeviceID id) {
  auto address = property(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &address, 0, nullptr, &size) || size < sizeof(AudioBufferList)) return 0;
  std::vector<uint8_t> buffer(size);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, buffer.data())) return 0;
  auto* list = reinterpret_cast<AudioBufferList*>(buffer.data());
  uint32_t count = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; ++i) count += list->mBuffers[i].mNumberChannels;
  return count;
}
AudioDeviceID resolveDevice(const char* identifier) {
  char* end = nullptr;
  const auto number = strtoul(identifier, &end, 10);
  if (*identifier && end && !*end && number <= UINT32_MAX) return static_cast<AudioDeviceID>(number);
  for (const auto id : devices()) {
    if (textProperty(id, kAudioDevicePropertyDeviceUID) == identifier) return id;
  }
  return kAudioObjectUnknown;
}
AudioDeviceID defaultOutput() {
  AudioDeviceID id = 0;
  readProperty(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, id);
  return id;
}
bool writable(AudioDeviceID id, AudioObjectPropertySelector selector) {
  auto address = property(selector, kAudioObjectPropertyScopeOutput);
  Boolean result = false;
  return AudioObjectHasProperty(id, &address) && !AudioObjectIsPropertySettable(id, &address, &result) && result;
}
void printJSON(id object) {
  NSData* data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingPrettyPrinted error:nil];
  if (data) { fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout); }
}
NSDictionary* snapshotObject(const BridgeSnapshot& s) {
  return @{ @"default_output":@(s.default_output), @"proxy":@(s.proxy), @"target":@(s.target),
    @"builtin":@(s.builtin), @"sleeping":@(s.sleeping), @"driver_connected":@(s.driver_connected),
    @"source_active":@(s.source_active), @"wake_count":@(s.wake_count), @"driver_generation":@(s.driver_generation),
    @"output_callbacks":@(s.output_callbacks), @"output_frames":@(s.output_frames),
    @"source_frames":@(s.source_frames), @"queued_frames":@(s.queued_frames),
    @"underruns":@(s.underruns), @"resyncs":@(s.resyncs), @"dropped_frames":@(s.dropped_frames),
    @"source_peak":@(double(s.source_peak_million)/1000000), @"output_peak":@(double(s.output_peak_million)/1000000) };
}
BridgeSnapshot observe() {
  BridgeSnapshot s{};
  s.default_output = defaultOutput();
  for (auto id : devices()) {
    if (outputChannels(id) == 0) continue;
    const auto uid = textProperty(id, kAudioDevicePropertyDeviceUID);
    if (uid == bridge::DeviceUID) s.proxy = id;
    if (uid == targetUID) {
      UInt32 transport = 0;
      readProperty(id, kAudioDevicePropertyTransportType, transport);
      const auto manufacturer = textProperty(id, kAudioObjectPropertyManufacturer);
      if (transport == kAudioDeviceTransportTypeDisplayPort && manufacturer == "GSM") s.target = id;
    }
    UInt32 transport = 0;
    readProperty(id, kAudioDevicePropertyTransportType, transport);
    if (transport == kAudioDeviceTransportTypeBuiltIn) s.builtin = id;
  }
  s.sleeping = sleeping.load(); s.driver_connected = connected.load(); s.wake_count = wakes.load();
  s.driver_generation = providerToken;
  s.output_callbacks = callbacks.load(); s.output_frames = rendered.load();
  s.underruns = underruns.load(); s.resyncs = resyncs.load(); s.output_peak_million = outputPeak.load();
  if (ring) {
    s.source_active = ring->sourceActive.load(); s.source_frames = ring->written.load();
    s.queued_frames = ring->queued(); s.dropped_frames = ring->dropped.load();
    s.source_peak_million = ring->sourcePeakMillion.load();
  }
  return s;
}
void sendAvailable(xpc_connection_t peer) {
  auto reply = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_bool(reply, "available", available.load());
  xpc_connection_send_message(peer, reply);
  xpc_release(reply);
}
bool checkPeer(xpc_object_t message, bool audioHost) {
  SecCodeRef guest = nullptr;
  const auto status = SecCodeCreateWithXPCMessage(message, kSecCSDefaultFlags, &guest);
  if (status || !guest) return false;
  bool accepted = false;
  if (audioHost) {
    SecRequirementRef requirement = nullptr;
    SecRequirementCreateWithString(CFSTR("anchor apple"), kSecCSDefaultFlags, &requirement);
    CFDictionaryRef info = nullptr;
    if (requirement && !SecCodeCheckValidity(guest, kSecCSDefaultFlags, requirement) &&
        !SecCodeCopySigningInformation(guest, kSecCSSigningInformation, &info)) {
      auto identifier = static_cast<CFStringRef>(CFDictionaryGetValue(info, kSecCodeInfoIdentifier));
      accepted = identifier && CFStringHasPrefix(identifier, CFSTR("com.apple.audio"));
      if (!accepted && identifier) CFShow(identifier);
      CFRelease(info);
    }
    if (requirement) CFRelease(requirement);
  } else if (clientRequirement) {
    accepted = !SecCodeCheckValidity(guest, kSecCSDefaultFlags, clientRequirement);
  }
  CFRelease(guest);
  return accepted;
}
void acceptPeer(xpc_connection_t peer) {
  xpc_connection_set_event_handler(peer, ^(xpc_object_t event) {
    if (xpc_get_type(event) == XPC_TYPE_ERROR) {
      std::lock_guard lock(ipcMutex);
      if (provider == peer) { connected.store(false); xpc_release(provider); provider = nullptr; dispatch_semaphore_signal(changed); }
      return;
    }
    if (xpc_get_type(event) != XPC_TYPE_DICTIONARY) return;
    const char* op = xpc_dictionary_get_string(event, "op");
    if (!op) return;
    if (!strcmp(op, "attach")) {
      if (!checkPeer(event, true)) {
        fprintf(stderr, "reject audio peer pid=%d uid=%u\n", xpc_connection_get_pid(peer), xpc_connection_get_euid(peer));
        xpc_connection_cancel(peer); return;
      }
      std::lock_guard lock(ipcMutex);
      const auto token = xpc_dictionary_get_uint64(event, "token");
      if (provider != peer || token != providerToken) {
        auto memory = xpc_dictionary_get_value(event, "memory");
        if (!memory || xpc_get_type(memory) != XPC_TYPE_SHMEM) return;
        void* mapped = nullptr;
        const size_t bytes = xpc_shmem_map(memory, &mapped);
        if (bytes < sizeof(bridge::Ring) || !mapped) { if (mapped) munmap(mapped, bytes); return; }
        auto* incoming = static_cast<bridge::Ring*>(mapped);
        if (incoming->magic != bridge::Magic || incoming->version != bridge::Version) { munmap(mapped, bytes); return; }
        if (pendingRing) munmap(pendingRing, pendingBytes);
        pendingRing = incoming; pendingBytes = bytes;
        if (provider) xpc_release(provider);
        provider = static_cast<xpc_connection_t>(xpc_retain(peer)); providerToken = token;
        connected.store(false);
        dispatch_semaphore_signal(changed);
        fprintf(stderr, "driver attached pid=%d\n", xpc_connection_get_pid(peer));
      }
      sendAvailable(peer);
    } else if (!strcmp(op, "activity")) {
      std::lock_guard lock(ipcMutex);
      if (provider == peer) dispatch_semaphore_signal(changed);
    } else if (!strcmp(op, "status") && checkPeer(event, false)) {
      std::lock_guard lock(ipcMutex);
      const auto s = observe();
      NSData* data = [NSJSONSerialization dataWithJSONObject:snapshotObject(s) options:0 error:nil];
      auto reply = xpc_dictionary_create_reply(event);
      if (reply && data) {
        xpc_dictionary_set_data(reply, "json", data.bytes, data.length);
        xpc_connection_send_message(peer, reply);
      }
      if (reply) xpc_release(reply);
    }
  });
  xpc_connection_resume(peer);
}
OSStatus outputCallback(AudioDeviceID, const AudioTimeStamp*, const AudioBufferList*,
  const AudioTimeStamp*, AudioBufferList* output, const AudioTimeStamp*, void*) {
  uint32_t frames = 0;
  for (UInt32 b = 0; b < output->mNumberBuffers; ++b) {
    auto& buffer = output->mBuffers[b];
    if (buffer.mData) memset(buffer.mData, 0, buffer.mDataByteSize);
    if (buffer.mNumberChannels && buffer.mData) frames = buffer.mDataByteSize / (sizeof(float) * buffer.mNumberChannels);
  }
  callbacks.fetch_add(1, std::memory_order_relaxed);
  if (!ring || !frames || frames > bridge::Capacity || sleeping.load() || !connected.load()) return noErr;
  auto queued = ring->queued();
  if (!primed) { if (queued < bridge::Prefill) return noErr; primed = true; }
  if (queued > bridge::MaxQueued) { ring->discard(); primed = false; resyncs.fetch_add(1); return noErr; }
  memset(scratch.data(), 0, frames * bridge::Channels * sizeof(float));
  const auto count = ring->pop(scratch.data(), frames);
  if (count < frames) { underruns.fetch_add(1); primed = false; }
  float peak = 0;
  uint32_t channelBase = 0;
  for (UInt32 b = 0; b < output->mNumberBuffers; ++b) {
    auto& buffer = output->mBuffers[b];
    if (!buffer.mData) continue;
    auto* destination = static_cast<float*>(buffer.mData);
    for (uint32_t f = 0; f < count; ++f) {
      for (uint32_t c = 0; c < buffer.mNumberChannels; ++c) {
        const auto channel = channelBase + c;
        if (channel < bridge::Channels) {
          const float value = scratch[f * bridge::Channels + channel];
          destination[f * buffer.mNumberChannels + c] = value;
          peak = std::max(peak, std::abs(value));
        }
      }
    }
    channelBase += buffer.mNumberChannels;
  }
  outputPeak.store(static_cast<uint64_t>(std::min(peak,1000.0f)*1000000), std::memory_order_relaxed);
  rendered.fetch_add(count, std::memory_order_relaxed);
  return noErr;
}
void powerThread() {
  IONotificationPortRef port = nullptr;
  io_object_t notifier = 0;
  static io_connect_t root = 0;
  root = IORegisterForSystemPower(nullptr, &port, [](void*, io_service_t, natural_t message, void* argument) {
    if (message == kIOMessageSystemWillSleep) sleeping.store(true);
    if (message == kIOMessageSystemHasPoweredOn) { sleeping.store(false); wakes.fetch_add(1); }
    if (message == kIOMessageSystemWillNotSleep) sleeping.store(false);
    dispatch_semaphore_signal(changed);
    if (message == kIOMessageCanSystemSleep || message == kIOMessageSystemWillSleep)
      IOAllowPowerChange(root, reinterpret_cast<intptr_t>(argument));
  }, &notifier);
  if (!root) { fprintf(stderr, "power notification registration failed\n"); return; }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), IONotificationPortGetRunLoopSource(port), kCFRunLoopDefaultMode);
  CFRunLoopRun();
}
void listDevices() {
  NSMutableArray* result = [NSMutableArray array];
  AudioDeviceID systemOutput = 0;
  readProperty(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultSystemOutputDevice, systemOutput);
  for (auto id : devices()) {
    const auto channels = outputChannels(id);
    if (!channels) continue;
    Float32 volume = -1; UInt32 mute = 0, transport = 0; AudioStreamBasicDescription format{};
    readProperty(id, kAudioHardwareServiceDeviceProperty_VirtualMainVolume, volume, kAudioObjectPropertyScopeOutput);
    readProperty(id, kAudioDevicePropertyMute, mute, kAudioObjectPropertyScopeOutput);
    readProperty(id, kAudioDevicePropertyTransportType, transport);
    readProperty(id, kAudioDevicePropertyStreamFormat, format, kAudioObjectPropertyScopeOutput);
    [result addObject:@{ @"id":@(id), @"name":@(textProperty(id,kAudioObjectPropertyName).c_str()),
      @"uid":@(textProperty(id,kAudioDevicePropertyDeviceUID).c_str()), @"channels":@(channels),
      @"default":@(id == defaultOutput()), @"volume":@(volume), @"mute":@(mute),
      @"system_default":@(id == systemOutput),
      @"volume_writable":@(writable(id,kAudioHardwareServiceDeviceProperty_VirtualMainVolume)),
      @"transport":@(transport), @"sample_rate":@(format.mSampleRate), @"format_flags":@(format.mFormatFlags),
      @"bits_per_channel":@(format.mBitsPerChannel) }];
  }
  printJSON(result);
}
int requestStatus() {
  auto semaphore = dispatch_semaphore_create(0);
  auto queue = dispatch_queue_create("com.acgbox.volumebridge.status", DISPATCH_QUEUE_SERIAL);
  auto connection = xpc_connection_create_mach_service(bridge::ServiceName, queue, XPC_CONNECTION_MACH_SERVICE_PRIVILEGED);
  xpc_connection_set_event_handler(connection, ^(xpc_object_t){});
  xpc_connection_resume(connection);
  auto message = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_string(message, "op", "status");
  __block int result = 1;
  xpc_connection_send_message_with_reply(connection, message, queue, ^(xpc_object_t reply) {
    if (xpc_get_type(reply) == XPC_TYPE_DICTIONARY) {
      size_t size = 0; const void* bytes = xpc_dictionary_get_data(reply, "json", &size);
      if (bytes) { fwrite(bytes, 1, size, stdout); fputc('\n',stdout); result = 0; }
    }
    dispatch_semaphore_signal(semaphore);
  });
  const auto timedOut = dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5*NSEC_PER_SEC));
  if (timedOut) fprintf(stderr, "service status timed out\n");
  xpc_connection_cancel(connection); xpc_release(connection); xpc_release(message);
  // Blocks can still finish after timeout, so keep the queue and semaphore until exit.
  return timedOut ? 1 : result;
}
struct Tone { double phase = 0; double rate = 48000; float amplitude = 0.01; };
OSStatus toneCallback(AudioDeviceID, const AudioTimeStamp*, const AudioBufferList*, const AudioTimeStamp*,
  AudioBufferList* output, const AudioTimeStamp*, void* context) {
  auto& tone = *static_cast<Tone*>(context);
  uint32_t frameCount = 0;
  for (UInt32 b = 0; b < output->mNumberBuffers; ++b) {
    auto& buffer = output->mBuffers[b]; if (!buffer.mData || !buffer.mNumberChannels) continue;
    auto* samples = static_cast<float*>(buffer.mData);
    const auto frames = buffer.mDataByteSize / (sizeof(float)*buffer.mNumberChannels);
    frameCount = frames;
    for (uint32_t f = 0; f < frames; ++f) {
      const float sample = tone.amplitude * sin(tone.phase + 2*M_PI*440*f/tone.rate);
      for (uint32_t c = 0; c < buffer.mNumberChannels; ++c) samples[f*buffer.mNumberChannels+c] = sample;
    }
  }
  tone.phase = fmod(tone.phase + 2*M_PI*440*frameCount/tone.rate, 2*M_PI);
  return noErr;
}
}

extern "C" int bridge_initialize(const char* uid) {
  targetUID = uid;
  changed = dispatch_semaphore_create(0);
  SecCodeRef self = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &self)) return 1;
  const auto status = SecCodeCopyDesignatedRequirement(self, kSecCSDefaultFlags, &clientRequirement);
  CFRelease(self); if (status) return status;
  auto queue = dispatch_queue_create("com.acgbox.volumebridge.service.ipc", DISPATCH_QUEUE_SERIAL);
  listener = xpc_connection_create_mach_service(bridge::ServiceName, queue, XPC_CONNECTION_MACH_SERVICE_LISTENER);
  if (!listener) return 1;
  xpc_connection_set_event_handler(listener, ^(xpc_object_t event) {
    if (xpc_get_type(event) == XPC_TYPE_CONNECTION) acceptPeer(static_cast<xpc_connection_t>(event));
  });
  xpc_connection_resume(listener);
  for (auto selector : {kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices}) {
    auto address = property(selector);
    AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &address, queue,
      ^(UInt32, const AudioObjectPropertyAddress*) { dispatch_semaphore_signal(changed); });
  }
  std::thread(powerThread).detach();
  return 0;
}
extern "C" BridgeSnapshot bridge_snapshot() {
  std::lock_guard lock(ipcMutex);
  if (pendingRing) {
    bridge_set_running(0, 0);
    if (ring) munmap(ring, ringBytes);
    ring = pendingRing; ringBytes = pendingBytes; pendingRing = nullptr; pendingBytes = 0;
    ring->discard(); connected.store(true);
  }
  const auto state = observe();
  if (!renderProc && ring && state.default_output != state.proxy) ring->discard();
  return state;
}
extern "C" void bridge_wait(uint32_t milliseconds) {
  dispatch_semaphore_wait(changed, dispatch_time(DISPATCH_TIME_NOW, uint64_t(milliseconds)*NSEC_PER_MSEC));
}
extern "C" int bridge_set_running(uint32_t id, int running) {
  if (renderProc && (!running || renderDevice != id)) {
    if (ring) ring->relayEnabled.store(0, std::memory_order_release);
    AudioDeviceStop(renderDevice, renderProc);
    AudioDeviceDestroyIOProcID(renderDevice, renderProc);
    renderProc = nullptr; renderDevice = 0; primed = false;
    if (ring) ring->discard();
  }
  if (!running || renderProc) return 0;
  AudioStreamBasicDescription format{};
  if (!readProperty(id, kAudioDevicePropertyStreamFormat, format, kAudioObjectPropertyScopeOutput) ||
      format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) ||
      format.mBitsPerChannel != 32 || format.mSampleRate != bridge::Rate) return kAudioDeviceUnsupportedFormatError;
  // A client can continue writing while another output is selected. Do not
  // replay that old audio when the user returns to the bridge.
  if (ring) ring->discard();
  auto status = AudioDeviceCreateIOProcID(id, outputCallback, nullptr, &renderProc);
  if (status) { renderProc = nullptr; return status; }
  renderDevice = id; primed = false;
  status = AudioDeviceStart(id, renderProc);
  if (status) {
    AudioDeviceDestroyIOProcID(id, renderProc); renderProc=nullptr; renderDevice=0;
  } else if (ring) {
    // Starting a physical device can wait for it to finish waking. Accept
    // producer frames only after that start succeeds, or the queue can fill
    // before the physical output consumes any frames.
    ring->relayEnabled.store(1, std::memory_order_release);
  }
  return status;
}
extern "C" void bridge_publish_available(int value) {
  const bool changed = available.exchange(value != 0) != (value != 0);
  if (changed) { std::lock_guard lock(ipcMutex); if (provider) sendAvailable(provider); }
}
extern "C" void bridge_shutdown() {
  bridge_set_running(0, 0); bridge_publish_available(0);
  if (listener) xpc_connection_cancel(listener);
}
extern "C" int bridge_select(uint32_t id) {
  if (!outputChannels(id)) return kAudioHardwareBadDeviceError;
  const auto old = defaultOutput();
  AudioDeviceID oldSystem = 0;
  readProperty(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultSystemOutputDevice, oldSystem);
  auto address = property(kAudioHardwarePropertyDefaultOutputDevice);
  auto status = AudioObjectSetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, sizeof(id), &id);
  if (!status && oldSystem == old) {
    address.mSelector = kAudioHardwarePropertyDefaultSystemOutputDevice;
    status = AudioObjectSetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, sizeof(id), &id);
  }
  return status;
}
extern "C" int bridge_command(int argc, const char* const* argv) {
  // HAL calls can stall while the audio server changes devices. Bound each
  // short-lived diagnostic/installer client so the transaction can recover.
  if (argc < 2 || strcmp(argv[1], "tone")) {
    signal(SIGALRM, [](int) {
      constexpr char message[] = "Audio operation timed out.\n";
      write(STDERR_FILENO, message, sizeof(message) - 1);
      _exit(124);
    });
    alarm(20);
  }
  @autoreleasepool {
    if ((argc == 3 || argc == 4) && !strcmp(argv[1], "monitor-volume")) {
      int value = -1;
      if (argc == 4) {
        char* end = nullptr;
        const auto parsed = strtol(argv[3], &end, 10);
        if (!end || end == argv[3] || *end || parsed < 0 || parsed > 100) return 2;
        value = static_cast<int>(parsed);
      }
      return monitorVolumeCommand(argv[2], value);
    }
    if (argc >= 2 && !strcmp(argv[1], "devices")) { listDevices(); return 0; }
    if (argc >= 2 && !strcmp(argv[1], "status")) return requestStatus();
    if (argc == 3 && !strcmp(argv[1], "select-system")) {
      const auto id = resolveDevice(argv[2]);
      if (!outputChannels(id)) return kAudioHardwareBadDeviceError;
      auto address = property(kAudioHardwarePropertyDefaultSystemOutputDevice);
      return AudioObjectSetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, sizeof(id), &id);
    }
    if (argc >= 3 && !strcmp(argv[1], "select")) return bridge_select(resolveDevice(argv[2]));
    if (argc >= 4 && (!strcmp(argv[1],"volume") || !strcmp(argv[1],"mute"))) {
      const auto id = resolveDevice(argv[2]);
      const bool isVolume = !strcmp(argv[1],"volume");
      auto address = property(isVolume ? kAudioHardwareServiceDeviceProperty_VirtualMainVolume : kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput);
      if (isVolume) {
        Float32 value = strtof(argv[3],nullptr); if (!std::isfinite(value) || value<0 || value>1) return 2;
        return AudioObjectSetPropertyData(id,&address,0,nullptr,sizeof(value),&value);
      }
      UInt32 value = strcmp(argv[3],"0") ? 1 : 0;
      return AudioObjectSetPropertyData(id,&address,0,nullptr,sizeof(value),&value);
    }
    if (argc >= 4 && !strcmp(argv[1], "tone")) {
      const auto id = resolveDevice(argv[2]);
      const double seconds = strtod(argv[3],nullptr);
      if (!std::isfinite(seconds) || seconds<=0 || seconds>120) return 2;
      AudioStreamBasicDescription format{};
      if (!readProperty(id,kAudioDevicePropertyStreamFormat,format,kAudioObjectPropertyScopeOutput) ||
          !(format.mFormatFlags & kAudioFormatFlagIsFloat) || format.mBitsPerChannel != 32) return 2;
      Tone tone; tone.rate = format.mSampleRate;
      if (argc >= 5) tone.amplitude = strtof(argv[4],nullptr);
      if (!std::isfinite(tone.amplitude) || tone.amplitude<0 || tone.amplitude>0.05) return 2;
      AudioDeviceIOProcID proc = nullptr;
      auto status = AudioDeviceCreateIOProcID(id,toneCallback,&tone,&proc); if(status) return status;
      status = AudioDeviceStart(id,proc);
      if (!status) std::this_thread::sleep_for(std::chrono::duration<double>(seconds));
      AudioDeviceStop(id,proc); AudioDeviceDestroyIOProcID(id,proc);
      return status;
    }
    fprintf(stderr,"usage: volume-bridge devices | status | select ID | volume ID 0..1 | mute ID 0|1 | tone ID SECONDS [AMPLITUDE] | monitor-volume UID [0..100]\n");
    return 2;
  }
}
