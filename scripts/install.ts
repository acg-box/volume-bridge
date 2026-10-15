import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { calibrateMonitor } from './calibration.ts';

const root = resolve(import.meta.dirname, '..');
const serviceName = 'com.acgbox.volumebridge.service';
const home = '/Library/Application Support/VolumeBridge';
const driver = '/Library/Audio/Plug-Ins/HAL/VolumeBridge.driver';
const launchFile = `/Library/LaunchDaemons/${serviceName}.plist`;
const executable = `${home}/bin/volume-bridge`;
const stateFile = `${home}/install-state.json`;
const logs = '/Library/Logs/VolumeBridge';
const action = process.argv[2];
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: 'inherit' });
const capture = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();
const stopService = () => {
  const result = spawnSync('/bin/launchctl', ['bootout', `system/${serviceName}`], {
    encoding: 'utf8',
  });
  if (
    result.status !== 0 &&
    !result.stderr.includes('No such process') &&
    !result.stderr.includes('Could not find service')
  ) {
    throw new Error(`Cannot stop service: ${result.stderr}`);
  }
  // bootout can return before launchd releases the Mach service registration.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = spawnSync('/bin/launchctl', ['print', `system/${serviceName}`], {
      encoding: 'utf8',
    });
    if (state.status !== 0) return;
    run('/bin/sleep', ['0.1']);
  }
  throw new Error('The previous service did not finish unloading.');
};

interface Device {
  id: number;
  uid: string;
  name: string;
  default: boolean;
  transport: number;
  channels: number;
  volume: number;
  mute: number;
}
interface InstallState {
  version: 1;
  uid: number;
  user: string;
  targetUID: string;
  originalOutputUID: string;
  originalHardwareVolume?: number;
}

function parseDevices(text: string): Device[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('Expected an audio device list.');
  return value.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'number' ||
      !('uid' in item) ||
      typeof item.uid !== 'string' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('default' in item) ||
      typeof item.default !== 'boolean' ||
      !('transport' in item) ||
      typeof item.transport !== 'number' ||
      !('channels' in item) ||
      typeof item.channels !== 'number' ||
      !('volume' in item) ||
      typeof item.volume !== 'number' ||
      !('mute' in item) ||
      typeof item.mute !== 'number'
    ) {
      throw new Error('Invalid audio device record.');
    }
    return {
      id: item.id,
      uid: item.uid,
      name: item.name,
      default: item.default,
      transport: item.transport,
      channels: item.channels,
      volume: item.volume,
      mute: item.mute,
    };
  });
}

function parseState(text: string): InstallState {
  const item: unknown = JSON.parse(text);
  if (
    typeof item !== 'object' ||
    item === null ||
    !('version' in item) ||
    item.version !== 1 ||
    !('uid' in item) ||
    typeof item.uid !== 'number' ||
    !Number.isSafeInteger(item.uid) ||
    item.uid <= 0 ||
    !('user' in item) ||
    typeof item.user !== 'string' ||
    !('targetUID' in item) ||
    typeof item.targetUID !== 'string' ||
    !('originalOutputUID' in item) ||
    typeof item.originalOutputUID !== 'string'
  ) {
    throw new Error('Invalid installation receipt.');
  }
  const state: InstallState = {
    version: 1,
    uid: item.uid,
    user: item.user,
    targetUID: item.targetUID,
    originalOutputUID: item.originalOutputUID,
  };
  if ('originalHardwareVolume' in item) {
    if (
      typeof item.originalHardwareVolume !== 'number' ||
      !Number.isInteger(item.originalHardwareVolume) ||
      item.originalHardwareVolume < 0 ||
      item.originalHardwareVolume > 100
    )
      throw new Error('Invalid recorded monitor volume.');
    state.originalHardwareVolume = item.originalHardwareVolume;
  }
  return state;
}

function hardwareVolume(binary: string, uid: string, value?: number): number {
  const args = ['monitor-volume', uid];
  if (value !== undefined) args.push(String(value));
  const record: unknown = JSON.parse(capture(binary, args));
  if (
    typeof record !== 'object' ||
    record === null ||
    !('hardware_volume' in record) ||
    typeof record.hardware_volume !== 'number' ||
    !('maximum' in record) ||
    record.maximum !== 100
  )
    throw new Error('The monitor did not report a supported volume range.');
  return record.hardware_volume;
}

function saveState(state: InstallState): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function calibrate(state: InstallState, previousDevices: Device[]): void {
  const proxyUID = 'com.acgbox.volumebridge.lg-output.v1';
  let current: Device[] = [];
  let proxy: Device | undefined;
  const deadline = Date.now() + 15000;
  while (!proxy && Date.now() < deadline) {
    current = parseDevices(capture(executable, ['devices']));
    proxy = current.find((device) => device.uid === proxyUID);
    if (!proxy) run('/bin/sleep', ['0.25']);
  }
  if (!proxy) throw new Error('The installed HAL output did not appear.');
  const proxyID = String(proxy.id);
  const previousProxy = previousDevices.find((device) => device.uid === proxyUID);
  const previousOutput = previousDevices.find((device) => device.default);
  calibrateMonitor(
    {
      readHardware: () => hardwareVolume(executable, state.targetUID),
      writeHardware: (value) => hardwareVolume(executable, state.targetUID, value),
      saveOriginal: (value) => {
        state.originalHardwareVolume = value;
        saveState(state);
      },
      setMute: (value) => run(executable, ['mute', proxyID, value ? '1' : '0']),
      setVolume: (value) => run(executable, ['volume', proxyID, String(value)]),
      selectBridge: () => {
        if (previousOutput?.uid === state.targetUID || previousOutput?.uid === proxyUID)
          run(executable, ['select', proxyID]);
      },
      restoreRoute: () => {
        const restore = current.find((device) => device.uid === previousOutput?.uid);
        if (restore) run(executable, ['select', String(restore.id)]);
      },
    },
    {
      volume: previousProxy?.volume ?? 0.02,
      mute: previousProxy?.mute === 1,
      originalHardwareVolume: state.originalHardwareVolume,
    },
  );
}

if (process.getuid?.() !== 0) throw new Error('Run this installation command with sudo.');

if (action === 'install') {
  const uid = Number(process.env.SUDO_UID);
  if (!Number.isSafeInteger(uid) || uid <= 0)
    throw new Error('Invoke sudo from the user account that will run the service.');
  const user = capture('/usr/bin/id', ['-nu', String(uid)]);
  const baselineFile = resolve(root, 'work/baseline.devices.json');
  const devices = parseDevices(readFileSync(baselineFile, 'utf8'));
  const targets = devices.filter(
    (device) => device.name === 'LG ULTRAGEAR+' && device.channels === 2,
  );
  if (targets.length !== 1 || !targets[0])
    throw new Error('Baseline must contain one LG ULTRAGEAR+ output.');
  const selected = devices.find((device) => device.default);
  if (!selected) throw new Error('Baseline must record the original default output.');
  const sourceBinary = resolve(root, 'target/release/volume-bridge');
  const sourceDriver = resolve(root, 'target/native/VolumeBridge.driver');
  const previousDevices = parseDevices(capture(sourceBinary, ['devices']));
  // Preflight DDC before replacing any installed component.
  hardwareVolume(sourceBinary, targets[0].uid);
  run('/usr/bin/codesign', ['--verify', '--strict', sourceBinary]);
  run('/usr/bin/codesign', ['--verify', '--strict', sourceDriver]);
  let state: InstallState = {
    version: 1,
    uid,
    user,
    targetUID: targets[0].uid,
    originalOutputUID: selected.uid,
  };
  if (existsSync(home)) {
    if (!existsSync(stateFile))
      throw new Error(
        'Existing installation has no ownership receipt; inspect it before replacing files.',
      );
    state = parseState(readFileSync(stateFile, 'utf8'));
    if (state.version !== 1 || state.uid !== uid)
      throw new Error('Existing installation belongs to a different user or format.');
    const backup = resolve(root, 'work/install-backups', String(Date.now()));
    mkdirSync(backup, { recursive: true });
    cpSync(home, `${backup}/runtime`, { recursive: true });
    if (existsSync(driver)) cpSync(driver, `${backup}/VolumeBridge.driver`, { recursive: true });
    stopService();
  } else if (existsSync(driver) || existsSync(launchFile)) {
    throw new Error('An unowned driver or launch definition already exists.');
  }
  mkdirSync(`${home}/bin`, { recursive: true, mode: 0o755 });
  mkdirSync(logs, { recursive: true, mode: 0o750 });
  cpSync(sourceBinary, executable);
  if (existsSync(driver)) rmSync(driver, { recursive: true });
  cpSync(sourceDriver, driver, { recursive: true });
  chmodSync(home, 0o755);
  chmodSync(`${home}/bin`, 0o755);
  chmodSync(executable, 0o755);
  run('/bin/chmod', ['-R', 'a+rX,go-w', driver]);
  saveState(state);
  run('/usr/sbin/chown', ['-R', 'root:wheel', home, driver]);
  run('/usr/sbin/chown', ['-R', `${user}:staff`, logs]);
  const launch = {
    Label: serviceName,
    ProgramArguments: [executable, 'serve', '--target-uid', state.targetUID],
    UserName: user,
    GroupName: 'staff',
    RunAtLoad: true,
    KeepAlive: true,
    ThrottleInterval: 5,
    ProcessType: 'Interactive',
    MachServices: { [serviceName]: true },
    StandardOutPath: `${logs}/service.log`,
    StandardErrorPath: `${logs}/service.log`,
  };
  writeFileSync(launchFile, JSON.stringify(launch), { mode: 0o644 });
  run('/usr/bin/plutil', ['-convert', 'xml1', launchFile]);
  chmodSync(launchFile, 0o644);
  run('/usr/sbin/chown', ['root:wheel', launchFile]);
  run('/bin/launchctl', ['bootstrap', 'system', launchFile]);
  run('/usr/bin/killall', ['coreaudiod']);
  calibrate(state, previousDevices);
  console.log(
    'Installed and calibrated VolumeBridge. The monitor is at 100%. New calibration starts system volume at 2%; updates preserve it. Original settings are saved for uninstall.',
  );
} else if (action === 'uninstall') {
  if (!existsSync(stateFile)) throw new Error('No VolumeBridge installation receipt exists.');
  const state = parseState(readFileSync(stateFile, 'utf8'));
  if (state.version !== 1) throw new Error('Unsupported installation receipt.');
  const devices = parseDevices(capture(executable, ['devices']));
  const proxy = devices.find((device) => device.uid === 'com.acgbox.volumebridge.lg-output.v1');
  if (
    state.originalHardwareVolume !== undefined &&
    devices.some((device) => device.uid === state.targetUID)
  ) {
    if (proxy) run(executable, ['mute', String(proxy.id), '1']);
    hardwareVolume(executable, state.targetUID, state.originalHardwareVolume);
  }
  const restore =
    devices.find((device) => device.uid === state.originalOutputUID) ??
    devices.find((device) => device.name === 'MacBook Pro Speakers');
  if (restore) run(executable, ['select', String(restore.id)]);
  stopService();
  rmSync(launchFile);
  rmSync(driver, { recursive: true });
  const receipt = resolve(root, 'work/uninstall-state.json');
  writeFileSync(receipt, JSON.stringify(state, null, 2), { mode: 0o600 });
  rmSync(home, { recursive: true });
  run('/usr/bin/killall', ['coreaudiod']);
  console.log('Removed VolumeBridge. Logs and a local restoration receipt are retained.');
} else {
  throw new Error('Usage: node scripts/install.ts install|uninstall');
}
