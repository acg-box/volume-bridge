import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const repository = 'acg-box/volume-bridge';
export const appleTeamId = '4N949UKQ55';
export const root = resolve(import.meta.dirname, '../..');
export const secretNames = [
  'ACG_MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64',
  'ACG_MACOS_DEVELOPER_ID_APPLICATION_P12_PASSWORD',
  'ACG_MACOS_DEVELOPER_ID_INSTALLER_P12_BASE64',
  'ACG_MACOS_DEVELOPER_ID_INSTALLER_P12_PASSWORD',
  'ACG_MACOS_NOTARY_API_KEY_ID',
  'ACG_MACOS_NOTARY_API_ISSUER_ID',
  'ACG_MACOS_NOTARY_API_PRIVATE_KEY_P8',
] as const;

export interface Source {
  version: string;
  tag: string;
  commit: string;
}

export interface PackageEvidence {
  name: string;
  bytes: number;
  sha256: string;
  uploadSha256: string;
  submissionId: string;
}

export interface Manifest extends Source {
  schema: 1;
  repository: typeof repository;
  teamId: typeof appleTeamId;
  architecture: 'arm64';
  minimumMacOS: '14.0';
  packages: PackageEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected a nonempty string.');
  return value;
}

export function stableVersion(value: string): string {
  if (value !== value.trim() || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value))
    throw new Error('A stable X.Y.Z version without leading zeroes is required.');
  return value;
}

export function compareVersions(left: string, right: string): number {
  const a = stableVersion(left).split('.').map(BigInt);
  const b = stableVersion(right).split('.');
  for (const [index, component] of a.entries()) {
    const other = BigInt(text(b[index]));
    if (component < other) return -1;
    if (component > other) return 1;
  }
  return 0;
}

export function packageNames(version: string): string[] {
  stableVersion(version);
  return [`VolumeBridge-${version}.pkg`, `Uninstall-VolumeBridge-${version}.pkg`];
}

export function manifestName(version: string): string {
  return `VolumeBridge-${stableVersion(version)}-release.json`;
}

export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

export function readVersion(directory = root): string {
  const cargo = readFileSync(resolve(directory, 'Cargo.toml'), 'utf8');
  const section = cargo.match(/\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const version = stableVersion(text(section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1]));
  const lock = readFileSync(resolve(directory, 'Cargo.lock'), 'utf8');
  const locked = lock.split('[[package]]').find((item) => /^name = "volume-bridge"$/m.test(item));
  if (locked?.match(/^version = "([^"]+)"/m)?.[1] !== version)
    throw new Error('Cargo.lock and workspace versions differ.');
  const plist = readFileSync(
    resolve(directory, 'apps/volume-bridge/packaging/Driver-Info.plist.in'),
    'utf8',
  );
  for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
    if (plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1] !== version)
      throw new Error(`Driver ${key} and workspace versions differ.`);
  }
  return version;
}

export function validateSource(tag: string, eventCommit?: string, directory = root): Source {
  const version = stableVersion(tag.replace(/^v/, ''));
  if (tag !== `v${version}`) throw new Error('The tag must be vX.Y.Z.');
  const origin = git(directory, 'remote', 'get-url', 'origin');
  if (
    ![
      `https://github.com/${repository}.git`,
      `https://github.com/${repository}`,
      `git@github.com:${repository}.git`,
    ].includes(origin)
  )
    throw new Error('The origin is not the canonical VolumeBridge repository.');
  const ref = `refs/tags/${tag}`;
  if (git(directory, 'cat-file', '-t', ref) !== 'tag')
    throw new Error('An annotated tag is required.');
  const annotation = git(directory, 'cat-file', '-p', ref);
  if (!/^type commit$/m.test(annotation))
    throw new Error('The annotated tag must point directly to a commit.');
  const commit = git(directory, 'rev-parse', `${ref}^{commit}`);
  if (git(directory, 'rev-parse', 'HEAD') !== commit || (eventCommit && eventCommit !== commit))
    throw new Error('The event, checkout, and tag commits differ.');
  git(directory, 'merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
  if (readVersion(directory) !== version) throw new Error('Tag and product versions differ.');
  return { version, tag, commit };
}

export function validateManifest(value: unknown, source: Source): Manifest {
  if (source.tag !== `v${stableVersion(source.version)}` || !/^[a-f0-9]{40}$/.test(source.commit))
    throw new Error('Invalid release source identity.');
  const manifest = record(value);
  for (const [key, expected] of Object.entries({
    schema: 1,
    repository,
    teamId: appleTeamId,
    architecture: 'arm64',
    minimumMacOS: '14.0',
    ...source,
  })) {
    if (manifest[key] !== expected) throw new Error(`Release manifest ${key} does not match.`);
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== 2)
    throw new Error('The release requires exactly two packages.');
  const expectedNames = packageNames(source.version).toSorted();
  const packages = manifest.packages.map((item: unknown) => {
    const entry = record(item);
    const name = text(entry.name);
    if (
      !expectedNames.includes(name) ||
      typeof entry.bytes !== 'number' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0
    )
      throw new Error('Invalid package identity or size.');
    for (const key of ['sha256', 'uploadSha256'])
      if (!/^[a-f0-9]{64}$/.test(text(entry[key]))) throw new Error('Invalid package digest.');
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(text(entry.submissionId)))
      throw new Error('Invalid notarization submission ID.');
    return {
      name,
      bytes: entry.bytes,
      sha256: text(entry.sha256),
      uploadSha256: text(entry.uploadSha256),
      submissionId: text(entry.submissionId),
    };
  });
  if (
    packages
      .map((entry) => entry.name)
      .toSorted()
      .join() !== expectedNames.join()
  )
    throw new Error('Duplicate or missing release package.');
  return {
    ...source,
    schema: 1,
    repository,
    teamId: appleTeamId,
    architecture: 'arm64',
    minimumMacOS: '14.0',
    packages,
  };
}

export function validateAssets(directory: string, source: Source): Manifest {
  const name = manifestName(source.version);
  const manifest = validateManifest(
    JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as unknown,
    source,
  );
  const expected = [...packageNames(source.version), name].toSorted();
  if (readdirSync(directory).toSorted().join() !== expected.join())
    throw new Error('Release directory must contain only the two packages and manifest.');
  for (const item of manifest.packages) {
    const file = resolve(directory, item.name);
    const info = lstatSync(file);
    if (!info.isFile() || info.size !== item.bytes || sha256(file) !== item.sha256)
      throw new Error(`Package bytes do not match the manifest: ${item.name}`);
  }
  return manifest;
}
