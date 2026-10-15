#pragma once

// Installer-only DDC/CI access. Never call this from an audio callback.
int monitorVolumeCommand(const char* targetUID, int requested);
