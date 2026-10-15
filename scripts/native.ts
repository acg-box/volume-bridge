import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const build = resolve(root, 'target/native');
const app = resolve(root, 'apps/volume-bridge');
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const xcrun = (name: string) =>
  execFileSync('/usr/bin/xcrun', ['--find', name], { encoding: 'utf8' }).trim();
const action = process.argv[2];

if (action === 'build') {
  const sdk = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  run('cmake', [
    '-S',
    app,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=RelWithDebInfo',
    `-DCMAKE_CXX_COMPILER=${xcrun('clang++')}`,
    `-DCMAKE_OBJCXX_COMPILER=${xcrun('clang++')}`,
    `-DCMAKE_OSX_SYSROOT=${sdk}`,
  ]);
  run('cmake', ['--build', build, '-j', '6']);
} else if (action === 'test') {
  run('ctest', ['--test-dir', build, '--output-on-failure']);
} else if (action === 'sign') {
  const identity = process.env.VOLUMEBRIDGE_SIGN_ID;
  if (!identity) throw new Error('Set VOLUMEBRIDGE_SIGN_ID to an existing local signing identity.');
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity,
    '--identifier',
    'com.acgbox.volumebridge.driver',
    resolve(build, 'VolumeBridge.driver'),
  ]);
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity,
    '--identifier',
    'com.acgbox.volumebridge.service',
    resolve(root, 'target/release/volume-bridge'),
  ]);
} else {
  throw new Error('Usage: node scripts/native.ts build|test|sign');
}
