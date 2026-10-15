#include "MonitorVolume.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <array>
#include <cstdio>
#include <cstring>
#include <unistd.h>

// Apple Silicon IOAV interfaces are private. Keep their use in installation
// calibration, outside the HAL driver and the audio service's render path.
extern "C" CFTypeRef IOAVServiceCreateWithService(CFAllocatorRef, io_service_t);
extern "C" int IOAVServiceCopyEDID(CFTypeRef, CFDataRef*);
extern "C" int IOAVServiceReadI2C(CFTypeRef, uint32_t, uint32_t, void*, uint32_t);
extern "C" int IOAVServiceWriteI2C(CFTypeRef, uint32_t, uint32_t, const void*, uint32_t);

namespace {
bool matches(CFTypeRef service, const char* targetUID) {
  CFDataRef edid = nullptr;
  if (IOAVServiceCopyEDID(service, &edid) || !edid) return false;
  bool result = false;
  const auto* bytes = CFDataGetBytePtr(edid);
  if (CFDataGetLength(edid) >= 24 && bytes[8] == 0x1e && bytes[9] == 0x6d) {
    CFUUIDBytes uuidBytes;
    memcpy(&uuidBytes, bytes + 8, sizeof(uuidBytes));
    // Core Audio masks the four EDID serial bytes on this output. Respect that
    // UID form, but still reject ambiguous matches before a DDC write.
    if (strlen(targetUID) == 36 && !strncmp(targetUID + 8, "-0000-0000-", 11)) {
      uuidBytes.byte4 = uuidBytes.byte5 = uuidBytes.byte6 = uuidBytes.byte7 = 0;
    }
    auto uuid = CFUUIDCreateFromUUIDBytes(kCFAllocatorDefault, uuidBytes);
    auto string = CFUUIDCreateString(kCFAllocatorDefault, uuid);
    char uid[64]{};
    result = CFStringGetCString(string, uid, sizeof(uid), kCFStringEncodingUTF8) && !strcmp(uid, targetUID);
    CFRelease(string); CFRelease(uuid);
  }
  CFRelease(edid);
  return result;
}
bool writePacket(CFTypeRef service, const uint8_t* bytes, uint32_t size) {
  for (int cycle = 0; cycle < 2; ++cycle) {
    usleep(10000);
    if (IOAVServiceWriteI2C(service, 0x37, 0x51, bytes, size)) return false;
  }
  return true;
}
bool readVolume(CFTypeRef service, unsigned& current, unsigned& maximum) {
  const uint8_t request[] = {0x82, 0x01, 0x62, 0x6e ^ 0x82 ^ 0x01 ^ 0x62};
  for (int attempt = 0; attempt < 5; ++attempt) {
    if (!writePacket(service, request, sizeof(request))) continue;
    usleep(50000);
    std::array<uint8_t, 11> reply{};
    if (IOAVServiceReadI2C(service, 0x37, 0, reply.data(), reply.size())) continue;
    uint8_t checksum = 0x50;
    for (unsigned i = 0; i < 10; ++i) checksum ^= reply[i];
    if ((reply[1] & 0x7f) != 8 || reply[2] != 2 || reply[3] != 0 ||
        reply[4] != 0x62 || reply[10] != checksum) continue;
    current = (reply[8] << 8) | reply[9];
    maximum = (reply[6] << 8) | reply[7];
    return maximum == 100 && current <= maximum;
  }
  return false;
}
}

int monitorVolumeCommand(const char* targetUID, int requested) {
  if (requested < -1 || requested > 100) return 2;
  io_iterator_t iterator = 0;
  if (IOServiceGetMatchingServices(kIOMainPortDefault,
      IOServiceMatching("DCPAVServiceProxy"), &iterator)) return 1;
  CFTypeRef target = nullptr;
  unsigned count = 0;
  io_service_t item;
  while ((item = IOIteratorNext(iterator))) {
    auto service = IOAVServiceCreateWithService(kCFAllocatorDefault, item);
    IOObjectRelease(item);
    if (!service) continue;
    if (matches(service, targetUID)) { ++count; if (!target) target = CFRetain(service); }
    CFRelease(service);
  }
  IOObjectRelease(iterator);
  if (count != 1) {
    if (target) CFRelease(target);
    fprintf(stderr, "Calibration requires exactly one matching LG DDC/CI display.\n");
    return 1;
  }
  unsigned current = 0, maximum = 0;
  bool ok = readVolume(target, current, maximum);
  if (ok && requested >= 0 && current != static_cast<unsigned>(requested)) {
    uint8_t packet[] = {0x84, 0x03, 0x62, 0, static_cast<uint8_t>(requested), 0};
    packet[5] = 0x6e ^ 0x51;
    for (unsigned i = 0; i < 5; ++i) packet[5] ^= packet[i];
    ok = writePacket(target, packet, sizeof(packet));
    usleep(50000);
    ok = ok && readVolume(target, current, maximum) && current == static_cast<unsigned>(requested);
  }
  CFRelease(target);
  if (!ok) { fprintf(stderr, "Monitor volume calibration did not pass readback.\n"); return 1; }
  printf("{\"hardware_volume\":%u,\"maximum\":%u}\n", current, maximum);
  return 0;
}
