import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  compareVersions,
  manifestName,
  packageNames,
  record,
  repository,
  root,
  sha256,
  text,
  validateAssets,
  validateSource,
} from './contract.ts';
import type { Manifest, Source } from './contract.ts';
import { workflowSource } from './source.ts';

const endpoint = `repos/${repository}`;
function gh(args: string[], input?: unknown): string {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    ...(input === undefined ? {} : { input: JSON.stringify(input) }),
  }).trim();
}
function api(path: string, method = 'GET', input?: unknown): Record<string, unknown> {
  return record(
    JSON.parse(
      gh(
        [
          'api',
          `${endpoint}/${path}`,
          '--method',
          method,
          ...(input === undefined ? [] : ['--input', '-']),
        ],
        input,
      ),
    ) as unknown,
  );
}
function pages(path: string): Record<string, unknown>[] {
  const result: unknown = JSON.parse(gh(['api', `${endpoint}/${path}`, '--paginate', '--slurp']));
  if (!Array.isArray(result)) throw new Error('Expected GitHub API pages.');
  return result.flatMap((page: unknown) => {
    if (!Array.isArray(page)) throw new Error('Expected a GitHub API list.');
    return page.map(record);
  });
}
function identifier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid GitHub identity.');
  return value;
}

function recheckSource(source: Source, advance: boolean): void {
  const remote = record(api(`git/ref/tags/${source.tag}`).object);
  if (remote.type !== 'tag') throw new Error('The remote tag is not annotated.');
  const annotation = record(api(`git/tags/${text(remote.sha)}`).object);
  if (annotation.type !== 'commit' || annotation.sha !== source.commit)
    throw new Error('The remote tag changed.');
  execFileSync(
    'git',
    ['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
    { cwd: root, stdio: 'pipe' },
  );
  validateSource(source.tag, source.commit);
  if (!advance) return;
  const refs = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
    cwd: root,
    encoding: 'utf8',
  });
  const versions = [
    ...refs.matchAll(/refs\/tags\/v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/gm),
  ].map((match) => text(match[1]));
  for (const release of pages('releases?per_page=100')) {
    if (
      !release.draft &&
      !release.prerelease &&
      typeof release.tag_name === 'string' &&
      /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(release.tag_name)
    )
      versions.push(release.tag_name.slice(1));
  }
  if (
    versions.some(
      (version) => version !== source.version && compareVersions(source.version, version) <= 0,
    )
  )
    throw new Error('The candidate must advance every other remote stable tag and release.');
}

function verifyRemote(
  release: Record<string, unknown>,
  source: Source,
  localManifest?: Manifest,
  localDirectory?: string,
): void {
  if (
    release.tag_name !== source.tag ||
    release.prerelease !== false ||
    (release.draft === false &&
      release.html_url !== `https://github.com/${repository}/releases/tag/${source.tag}`)
  )
    throw new Error('Unexpected release identity.');
  const id = identifier(release.id);
  const assets = pages(`releases/${id}/assets?per_page=100`);
  const expected = [...packageNames(source.version), manifestName(source.version)].toSorted();
  if (
    assets
      .map((asset) => text(asset.name))
      .toSorted()
      .join() !== expected.join()
  )
    throw new Error('Remote assets are not the expected package triplet.');
  const directory = mkdtempSync(resolve(tmpdir(), 'volumebridge-download-'));
  try {
    for (const asset of assets) {
      const name = text(asset.name);
      const url = `https://github.com/${repository}/releases/download/${source.tag}/${name}`;
      if (asset.state !== 'uploaded' || asset.browser_download_url !== url)
        throw new Error('Unexpected release asset URL or upload state.');
      // Drafts need authenticated API downloads. Public assets use their public URL.
      const bytes = release.draft
        ? execFileSync(
            'gh',
            [
              'api',
              `${endpoint}/releases/assets/${identifier(asset.id)}`,
              '-H',
              'Accept: application/octet-stream',
            ],
            { maxBuffer: 32 * 1024 * 1024 },
          )
        : execFileSync(
            'curl',
            [
              '--fail',
              '--location',
              '--silent',
              '--show-error',
              '--proto',
              '=https',
              '--proto-redir',
              '=https',
              url,
            ],
            { maxBuffer: 32 * 1024 * 1024 },
          );
      const file = resolve(directory, name);
      writeFileSync(file, bytes);
      if (asset.size !== bytes.length || asset.digest !== `sha256:${sha256(file)}`)
        throw new Error('Downloaded bytes differ from GitHub asset metadata.');
      if (localDirectory && sha256(resolve(localDirectory, name)) !== sha256(file))
        throw new Error('Draft asset differs from the validated local asset.');
    }
    const manifest = validateAssets(directory, source);
    if (localManifest && JSON.stringify(manifest) !== JSON.stringify(localManifest))
      throw new Error('The draft release manifest differs.');
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function publish(source: Source, directory: string): void {
  const manifest = validateAssets(directory, source);
  let matches = pages('releases?per_page=100').filter((item) => item.tag_name === source.tag);
  if (matches.length > 1) throw new Error('Multiple releases use this tag.');
  const existing = matches[0];
  recheckSource(source, !existing || existing.draft === true);
  if (existing && existing.draft === false) {
    verifyRemote(existing, source); // Public reruns never compare against a rebuild.
    console.log(`Verified existing public release: ${text(existing.html_url)}`);
    return;
  }
  const release =
    existing ??
    api('releases', 'POST', {
      tag_name: source.tag,
      target_commitish: source.commit,
      name: `VolumeBridge ${source.version}`,
      draft: true,
      prerelease: false,
      body: `Install VolumeBridge with the installation package. Use the uninstall package to restore the saved monitor volume and remove the driver and service.\n\nApple Silicon, macOS 14 or later. Hardware acceptance currently covers the LG ULTRAGEAR+ USB-C setup in the validation report. Both packages are Developer ID signed, notarized, and stapled. The release JSON records their SHA-256 hashes.\n\n[Installation and validation](https://github.com/${repository}/tree/${source.tag})`,
    });
  const id = identifier(release.id);
  if (release.draft !== true) throw new Error('Only draft assets can be replaced.');
  for (const asset of pages(`releases/${id}/assets?per_page=100`))
    gh(['api', `${endpoint}/releases/assets/${identifier(asset.id)}`, '--method', 'DELETE']);
  gh([
    'release',
    'upload',
    source.tag,
    ...[...packageNames(source.version), manifestName(source.version)].map((name) =>
      resolve(directory, name),
    ),
    '--repo',
    repository,
  ]);
  verifyRemote(api(`releases/${id}`), source, manifest, directory);
  recheckSource(source, true);
  matches = pages('releases?per_page=100').filter((item) => item.tag_name === source.tag);
  if (matches.length !== 1 || matches[0]?.id !== id || matches[0]?.draft !== true)
    throw new Error('Draft release state changed before publication.');
  let uncertain = false;
  try {
    api(`releases/${id}`, 'PATCH', { draft: false, make_latest: 'true' });
  } catch {
    uncertain = true;
  }
  // Resolve ambiguous writes with fresh state. Never retry the publish mutation.
  const actual = api(`releases/${id}`);
  if (actual.draft !== false)
    throw new Error(
      uncertain
        ? 'Publication was not confirmed. Inspect the retained draft before retrying.'
        : 'The release is still a draft.',
    );
  verifyRemote(actual, source, manifest, directory);
  if (api('releases/latest').id !== id) throw new Error('Published release is not latest.');
  console.log(`Published and verified: ${text(actual.html_url)}`);
}

if (process.argv[2] === '--dry-run') {
  const directory = resolve(text(process.argv[3]));
  const name = text(process.argv[4]);
  const candidate = record(JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as unknown);
  const source = {
    version: text(candidate.version),
    tag: text(candidate.tag),
    commit: text(candidate.commit),
  };
  validateAssets(directory, source);
  console.log('Local release assets passed validation. No GitHub requests were made.');
} else {
  if (process.argv.length !== 2)
    throw new Error('Usage: publish.ts [--dry-run DIRECTORY MANIFEST]');
  publish(workflowSource(), resolve(root, 'artifacts'));
}
