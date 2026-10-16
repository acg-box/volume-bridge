import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { appleTeamId, record, secretNames, sha256, text } from './contract.ts';
import type { PackageEvidence } from './contract.ts';

export function capture(program: string, args: string[], sensitive = false): string {
  try {
    return execFileSync(program, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error: unknown) {
    const details =
      !sensitive && typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).slice(0, 2000)
        : '';
    // Command errors can contain credential arguments. Never attach that cause.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error(`${basename(program)} failed. ${details}`);
  }
}

export function runAsync(
  program: string,
  args: string[],
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        env,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 22 * 60 * 1000,
        ...(signal ? { signal } : {}),
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              `${basename(program)} did not complete successfully. The upload may still be processing; retain its submission receipt.`,
            ),
          );
        else resolve(stdout.trim());
      },
    );
  });
}

export function verifyCode(file: string, identifier: string): void {
  capture('/usr/bin/codesign', ['--verify', '--strict', file]);
  const display = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', file], { encoding: 'utf8' });
  if (display.status !== 0) throw new Error('Cannot inspect the code signature.');
  const details = display.stderr;
  if (
    !details.includes(`Identifier=${identifier}\n`) ||
    !details.includes(`TeamIdentifier=${appleTeamId}\n`) ||
    !/^Authority=Developer ID Application: .+ \(4N949UKQ55\)$/m.test(details) ||
    !/^Timestamp=.+$/m.test(details) ||
    !/^CodeDirectory .+flags=.*runtime/m.test(details)
  )
    throw new Error(
      `Unexpected Developer ID signature, timestamp, or hardened runtime: ${basename(file)}`,
    );
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', file], {
    encoding: 'utf8',
  });
  if (entitlements.status !== 0 || entitlements.stdout.includes('<key>'))
    throw new Error('VolumeBridge release code must not carry additional entitlements.');
}

export async function notarize(
  file: string,
  profile: string,
  keychain?: string,
  signal?: AbortSignal,
): Promise<PackageEvidence> {
  verifyPackageSignature(file);
  const auth = ['--keychain-profile', profile, ...(keychain ? ['--keychain', keychain] : [])];
  const receipt = `${file}.notary.json`;
  let submissionId: string;
  let uploadSha256: string;
  let complete = false;
  if (existsSync(receipt)) {
    const saved = record(JSON.parse(readFileSync(receipt, 'utf8')) as unknown);
    submissionId = text(saved.submissionId);
    uploadSha256 = text(saved.uploadSha256);
    complete = typeof saved.sha256 === 'string';
    if (sha256(file) !== (complete ? saved.sha256 : uploadSha256))
      throw new Error('The saved submission does not match this package.');
    console.log(`Resuming notarization: ${basename(file)} (${submissionId})`);
  } else {
    uploadSha256 = sha256(file);
    const submission = record(
      JSON.parse(
        await runAsync(
          '/usr/bin/xcrun',
          ['notarytool', 'submit', file, ...auth, '--output-format', 'json'],
          signal,
        ),
      ) as unknown,
    );
    submissionId = text(submission.id);
    if (!/^[a-f0-9-]{36}$/i.test(submissionId))
      throw new Error('Apple did not return a submission ID.');
    writeFileSync(receipt, JSON.stringify({ uploadSha256, submissionId }, null, 2));
    console.log(`Notarization submitted: ${basename(file)} (${submissionId})`);
  }
  if (!complete)
    await runAsync(
      '/usr/bin/xcrun',
      ['notarytool', 'wait', submissionId, ...auth, '--timeout', '20m', '--output-format', 'json'],
      signal,
    );
  const info = record(
    JSON.parse(
      capture('/usr/bin/xcrun', [
        'notarytool',
        'info',
        submissionId,
        ...auth,
        '--output-format',
        'json',
      ]),
    ) as unknown,
  );
  const logFile = `${file}.notary-log.json`;
  capture('/usr/bin/xcrun', ['notarytool', 'log', submissionId, ...auth, logFile]);
  const log = record(JSON.parse(readFileSync(logFile, 'utf8')) as unknown);
  if (info.status !== 'Accepted' || log.status !== 'Accepted')
    throw new Error(`Apple did not accept ${basename(file)}. Read its notarization log.`);
  if (info.id !== submissionId || log.jobId !== submissionId || log.sha256 !== uploadSha256)
    throw new Error('Apple notarization evidence does not match the submitted package.');
  if (
    Array.isArray(log.issues) &&
    log.issues.some((item: unknown) => record(item).severity === 'error')
  )
    throw new Error('Apple reported a notarization error.');
  if (Array.isArray(log.issues) && log.issues.length)
    console.log(
      `Apple reported ${log.issues.length} notarization warning(s); inspect ${basename(logFile)}.`,
    );
  if (!complete) {
    if (sha256(file) !== uploadSha256) throw new Error('Package changed after submission.');
    capture('/usr/bin/xcrun', ['stapler', 'staple', file]);
  }
  capture('/usr/bin/xcrun', ['stapler', 'validate', file]);
  verifyPackageSignature(file);
  capture('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=2', file]);
  const bytes = readFileSync(file).length;
  const evidence = {
    name: basename(file),
    bytes,
    sha256: sha256(file),
    uploadSha256,
    submissionId,
  };
  writeFileSync(receipt, JSON.stringify(evidence, null, 2));
  console.log(`Notarization accepted and ticket verified: ${basename(file)}`);
  return evidence;
}

export function verifyPackageSignature(file: string): void {
  const signature = capture('/usr/sbin/pkgutil', ['--check-signature', file]);
  if (
    !/Developer ID Installer: .+ \(4N949UKQ55\)/.test(signature) ||
    !/Status: signed by (a developer certificate issued by Apple for distribution|a certificate trusted by macOS)/.test(
      signature,
    ) ||
    !signature.includes('Signed with a trusted timestamp')
  )
    throw new Error('Package does not have the expected trusted Installer signature.');
}

export interface SigningContext {
  application: string;
  installer: string;
  keychain: string;
  profile: string;
  signal: AbortSignal;
}

export async function withSigning<T>(work: (context: SigningContext) => Promise<T>): Promise<T> {
  const values = Object.fromEntries(secretNames.map((name) => [name, process.env[name]]));
  for (const name of secretNames) delete process.env[name];
  for (const name of secretNames)
    if (!values[name]) throw new Error(`Missing release credential: ${name}`);
  const savedList = capture('/usr/bin/security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .filter(Boolean)
    .map((line) => text(JSON.parse(line.trim()) as unknown));
  const savedDefault = text(
    JSON.parse(capture('/usr/bin/security', ['default-keychain', '-d', 'user'])) as unknown,
  );
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'volumebridge-signing-'));
  chmodSync(directory, 0o700);
  const keychain = join(directory, 'release.keychain-db');
  const password = randomBytes(32).toString('hex');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let created = false;
  let restored = false;
  const restore = () => {
    capture('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...savedList]);
    capture('/usr/bin/security', ['default-keychain', '-d', 'user', '-s', savedDefault]);
    const current = capture('/usr/bin/security', ['list-keychains', '-d', 'user'])
      .split('\n')
      .filter(Boolean)
      .map((line) => text(JSON.parse(line.trim()) as unknown));
    if (
      JSON.stringify(current) !== JSON.stringify(savedList) ||
      JSON.parse(capture('/usr/bin/security', ['default-keychain', '-d', 'user'])) !== savedDefault
    )
      throw new Error(
        `Keychain restoration needs attention. Protected recovery files remain at ${directory}.`,
      );
    restored = true;
  };
  try {
    capture('/usr/bin/security', ['create-keychain', '-p', password, keychain], true);
    created = true;
    capture('/usr/bin/security', ['set-keychain-settings', '-lut', '3600', keychain]);
    capture('/usr/bin/security', ['unlock-keychain', '-p', password, keychain], true);
    for (const kind of ['APPLICATION', 'INSTALLER']) {
      const prefix = `ACG_MACOS_DEVELOPER_ID_${kind}`;
      const file = join(directory, `${kind}.p12`);
      writeFileSync(file, Buffer.from(text(values[`${prefix}_P12_BASE64`]), 'base64'), {
        mode: 0o600,
      });
      capture(
        '/usr/bin/security',
        [
          'import',
          file,
          '-k',
          keychain,
          '-P',
          text(values[`${prefix}_P12_PASSWORD`]),
          '-T',
          '/usr/bin/codesign',
          '-T',
          '/usr/bin/productbuild',
          '-T',
          '/usr/bin/security',
        ],
        true,
      );
    }
    capture('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychain]);
    capture('/usr/bin/security', ['default-keychain', '-d', 'user', '-s', keychain]);
    capture(
      '/usr/bin/security',
      ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain],
      true,
    );
    // Only the partition-list operation needs the temporary default. Keep
    // normal applications on their original keychains during notarization.
    restore();
    const identities = capture('/usr/bin/security', [
      'find-identity',
      '-v',
      '-p',
      'basic',
      keychain,
    ]);
    const names = [...identities.matchAll(/^\s*\d+\) [A-Fa-f0-9]{40} "([^"]+)"$/gm)].map((match) =>
      text(match[1]),
    );
    const application = names.find(
      (name) => name.startsWith('Developer ID Application:') && name.endsWith(`(${appleTeamId})`),
    );
    const installer = names.find(
      (name) => name.startsWith('Developer ID Installer:') && name.endsWith(`(${appleTeamId})`),
    );
    if (names.length !== 2 || !application || !installer)
      throw new Error(
        'The temporary keychain does not contain exactly the expected Developer ID pair.',
      );
    const key = join(directory, 'notary.p8');
    writeFileSync(key, text(values.ACG_MACOS_NOTARY_API_PRIVATE_KEY_P8), { mode: 0o600 });
    const profile = 'volumebridge-release';
    capture(
      '/usr/bin/xcrun',
      [
        'notarytool',
        'store-credentials',
        profile,
        '--key',
        key,
        '--key-id',
        text(values.ACG_MACOS_NOTARY_API_KEY_ID),
        '--issuer',
        text(values.ACG_MACOS_NOTARY_API_ISSUER_ID),
        '--keychain',
        keychain,
      ],
      true,
    );
    return await work({ application, installer, keychain, profile, signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (!restored) restore();
    if (created) capture('/usr/bin/security', ['delete-keychain', keychain]);
    rmSync(directory, { recursive: true });
  }
}
