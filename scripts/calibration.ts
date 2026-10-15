export interface CalibrationIO {
  readHardware: () => number;
  writeHardware: (value: number) => number;
  saveOriginal: (value: number) => void;
  setMute: (value: boolean) => void;
  setVolume: (value: number) => void;
  selectBridge: () => void;
  restoreRoute: () => void;
}

export function calibrateMonitor(
  io: CalibrationIO,
  previous: { volume: number; mute: boolean; originalHardwareVolume: number | undefined },
): void {
  // An unreadable monitor must fail before any audio setting is changed.
  const hardware = io.readHardware();
  if (!Number.isInteger(hardware) || hardware < 0 || hardware > 100)
    throw new Error('The monitor must report a volume in the range 0..100.');
  if (previous.originalHardwareVolume === undefined) io.saveOriginal(hardware);
  const adjust = previous.originalHardwareVolume === undefined || hardware !== 100;
  io.setMute(true);
  try {
    io.setVolume(adjust ? 0.02 : previous.volume);
    io.selectBridge();
    if (hardware !== 100 && io.writeHardware(100) !== 100)
      throw new Error('The monitor did not confirm full hardware volume.');
  } catch (error) {
    try {
      if (io.writeHardware(hardware) !== hardware)
        throw new Error('The monitor did not confirm the previous volume.', { cause: error });
      io.setVolume(previous.volume);
      io.restoreRoute();
      io.setMute(previous.mute);
    } catch (restoreError) {
      // Leave the bridge muted if the hardware state is uncertain.
      throw new Error('Calibration and restoration failed; the bridge remains muted.', {
        cause: restoreError,
      });
    }
    throw error;
  }
  io.setMute(previous.mute);
}
