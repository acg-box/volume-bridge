import { deepEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { calibrateMonitor, type CalibrationIO } from './calibration.ts';

function fixture(hardware: number) {
  const events: string[] = [];
  const io: CalibrationIO = {
    readHardware: () => hardware,
    writeHardware: (value) => {
      events.push(`hardware:${value}`);
      return value;
    },
    saveOriginal: (value) => {
      events.push(`save:${value}`);
    },
    setMute: (value) => {
      events.push(`mute:${value}`);
    },
    setVolume: (value) => {
      events.push(`software:${value}`);
    },
    selectBridge: () => {
      events.push('select');
    },
    restoreRoute: () => {
      events.push('restore');
    },
  };
  return { io, events };
}

await test('a low hardware ceiling is raised only after mute and low software gain', () => {
  const { io, events } = fixture(5);
  calibrateMonitor(io, { volume: 1, mute: false, originalHardwareVolume: undefined });
  deepEqual(events, [
    'save:5',
    'mute:true',
    'software:0.02',
    'select',
    'hardware:100',
    'mute:false',
  ]);
});

await test('an unreadable monitor makes no audio changes', () => {
  const { io, events } = fixture(5);
  io.readHardware = () => {
    throw new Error('DDC unavailable');
  };
  throws(() => calibrateMonitor(io, { volume: 1, mute: false, originalHardwareVolume: undefined }));
  deepEqual(events, []);
});

await test('a repeated installation preserves volume and the first restoration receipt', () => {
  const { io, events } = fixture(100);
  calibrateMonitor(io, { volume: 0.3, mute: false, originalHardwareVolume: 5 });
  deepEqual(events, ['mute:true', 'software:0.3', 'select', 'mute:false']);
});

await test('a failed calibration restores hardware before software and route', () => {
  const { io, events } = fixture(5);
  io.writeHardware = (value) => {
    events.push(`hardware:${value}`);
    return value === 100 ? 50 : value;
  };
  throws(() => calibrateMonitor(io, { volume: 1, mute: false, originalHardwareVolume: undefined }));
  deepEqual(events, [
    'save:5',
    'mute:true',
    'software:0.02',
    'select',
    'hardware:100',
    'hardware:5',
    'software:1',
    'restore',
    'mute:false',
  ]);
});

await test('failed hardware restoration leaves output muted', () => {
  const { io, events } = fixture(5);
  io.writeHardware = () => {
    throw new Error('Display disconnected');
  };
  throws(
    () => calibrateMonitor(io, { volume: 1, mute: false, originalHardwareVolume: 5 }),
    /bridge remains muted/,
  );
  deepEqual(events, ['mute:true', 'software:0.02', 'select']);
});
