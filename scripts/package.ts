import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2];
if (mode !== 'local' && mode !== 'release')
  throw new Error('Usage: node scripts/package.ts local|release');
const local = mode === 'local';
const codeIdentity = process.env.VOLUMEBRIDGE_SIGN_ID;
const installerIdentity = process.env.VOLUMEBRIDGE_INSTALLER_SIGN_ID;
const notaryProfile = process.env.VOLUMEBRIDGE_NOTARY_PROFILE;
if (!codeIdentity)
  throw new Error('Set VOLUMEBRIDGE_SIGN_ID to an existing code-signing identity.');
if (
  !local &&
  (!codeIdentity.startsWith('Developer ID Application:') ||
    !installerIdentity?.startsWith('Developer ID Installer:') ||
    !notaryProfile)
) {
  throw new Error(
    'A release requires Developer ID Application, Developer ID Installer, and a notary keychain profile. Use build-package-local for local testing.',
  );
}

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const capture = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
if (capture('/usr/bin/uname', ['-m']) !== 'arm64')
  throw new Error('This package currently targets Apple Silicon.');
const binary = resolve(root, 'target/release/volume-bridge');
const driver = resolve(root, 'target/native/VolumeBridge.driver');
const version = capture(binary, ['--version']);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid build version.');
const driverVersion = capture('/usr/bin/plutil', [
  '-extract',
  'CFBundleVersion',
  'raw',
  '-o',
  '-',
  `${driver}/Contents/Info.plist`,
]);
if (driverVersion !== version) throw new Error('Driver and service versions must match.');
const stage = resolve(root, 'target/packages', mode);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

function sign(path: string, identifier: string): void {
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    codeIdentity ?? '',
    '--options',
    'runtime',
    local ? '--timestamp=none' : '--timestamp',
    '--identifier',
    identifier,
    path,
  ]);
  run('/usr/bin/codesign', ['--verify', '--strict', path]);
}

function copyRustLicenses(destination: string): void {
  const metadata: unknown = JSON.parse(
    capture('cargo', ['metadata', '--locked', '--format-version', '1']),
  );
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('packages' in metadata) ||
    !Array.isArray(metadata.packages)
  )
    throw new Error('Cargo did not return package metadata.');
  for (const item of metadata.packages as unknown[]) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('version' in item) ||
      typeof item.version !== 'string' ||
      !('manifest_path' in item) ||
      typeof item.manifest_path !== 'string'
    )
      throw new Error('Cargo returned invalid package metadata.');
    if (item.name === 'volume-bridge') continue;
    if (!/^[a-z0-9_-]+$/.test(item.name) || !/^[a-zA-Z0-9.+-]+$/.test(item.version))
      throw new Error('Invalid dependency identity.');
    const folder = dirname(item.manifest_path);
    const output = resolve(destination, `${item.name}-${item.version}`);
    mkdirSync(output);
    for (const file of readdirSync(folder).filter((name) =>
      /^(LICENSE|COPYING|UNLICENSE)/.test(name),
    ))
      cpSync(resolve(folder, file), resolve(output, file));
  }
}

function buildPackage(remove: boolean): string {
  const action = remove ? 'uninstall' : 'install';
  const name = remove ? 'Uninstall VolumeBridge' : 'VolumeBridge';
  const scripts = resolve(stage, `${action}-scripts`);
  const payload = resolve(scripts, 'payload');
  const resources = resolve(stage, `${action}-resources`);
  mkdirSync(payload, { recursive: true });
  mkdirSync(resources, { recursive: true });
  cpSync(binary, `${payload}/volume-bridge`);
  chmodSync(`${payload}/volume-bridge`, 0o755);
  sign(`${payload}/volume-bridge`, 'com.acgbox.volumebridge.service');
  if (!remove) {
    cpSync(driver, `${payload}/VolumeBridge.driver`, { recursive: true });
    run('/bin/chmod', ['-R', 'a+rX,go-w', `${payload}/VolumeBridge.driver`]);
    sign(`${payload}/VolumeBridge.driver`, 'com.acgbox.volumebridge.driver');
    const licenses = resolve(payload, 'licenses');
    mkdirSync(licenses);
    cpSync(resolve(root, 'LICENSE'), `${licenses}/VolumeBridge.txt`);
    copyRustLicenses(licenses);
    for (const file of ['LICENSE', 'LICENSE.apple2012', 'LICENSE.apple2020']) {
      cpSync(resolve(root, 'vendor/libaspl', file), `${licenses}/libaspl-${file}.txt`);
    }
  }
  const entry = `#!/bin/sh\nset -eu\n[ "\${3:-/}" = / ] || { echo "Install on the startup disk only." >&2; exit 1; }\npackage_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$package_dir/payload/volume-bridge" package ${action}${remove ? '' : ' "$package_dir/payload"'}\n`;
  writeFileSync(`${scripts}/postinstall`, entry, { mode: 0o755 });
  chmodSync(`${scripts}/postinstall`, 0o755);
  run('/bin/sh', ['-n', `${scripts}/postinstall`]);
  for (const document of ['welcome', 'conclusion']) {
    const template = readFileSync(
      resolve(root, `apps/volume-bridge/packaging/${action}-${document}.html`),
      'utf8',
    );
    writeFileSync(`${resources}/${document}.html`, template.replaceAll('{{VERSION}}', version));
  }
  const component = `${action}.pkg`;
  const identifier = `com.acgbox.volumebridge.${action}`;
  run('/usr/bin/pkgbuild', [
    '--nopayload',
    '--scripts',
    scripts,
    '--identifier',
    identifier,
    '--version',
    version,
    '--install-location',
    '/',
    resolve(stage, component),
  ]);
  const distribution = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>${name} ${version}</title>
  <organization>com.acgbox</organization>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <options customize="never" require-scripts="true" hostArchitectures="arm64"/>
  <volume-check><allowed-os-versions><os-version min="14.0"/></allowed-os-versions></volume-check>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <choices-outline><line choice="default"><line choice="${identifier}"/></line></choices-outline>
  <choice id="default"/>
  <choice id="${identifier}" visible="false"><pkg-ref id="${identifier}"/></choice>
  <pkg-ref id="${identifier}" version="${version}" onConclusion="None">${component}</pkg-ref>
</installer-gui-script>
`;
  writeFileSync(`${stage}/${action}.xml`, distribution);
  const output = resolve(
    stage,
    `${name.replaceAll(' ', '-')}-${version}${local ? '-local' : ''}.pkg`,
  );
  const args = [
    '--distribution',
    `${stage}/${action}.xml`,
    '--package-path',
    stage,
    '--resources',
    resources,
  ];
  if (!local && installerIdentity) args.push('--sign', installerIdentity, '--timestamp');
  run('/usr/bin/productbuild', [...args, output]);
  if (!local && notaryProfile) {
    run('/usr/bin/xcrun', [
      'notarytool',
      'submit',
      output,
      '--keychain-profile',
      notaryProfile,
      '--wait',
    ]);
    run('/usr/bin/xcrun', ['stapler', 'staple', output]);
    run('/usr/bin/xcrun', ['stapler', 'validate', output]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=2', output]);
  }
  return output;
}

const packages = [buildPackage(false), buildPackage(true)];
for (const path of packages) console.log(`Package: ${path}`);
if (local)
  console.log(
    'Local packages are not Developer ID signed or notarized. Do not publish them as release installers.',
  );
