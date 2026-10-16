import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { appleTeamId, manifestName, packageNames, repository, root, sha256 } from './contract.ts';

await test('remote verification accepts draft URLs but requires canonical public assets', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'volumebridge-remote-test-'));
  const assetsDirectory = resolve(directory, 'assets');
  mkdirSync(assetsDirectory);
  const source = { version: '0.2.1', tag: 'v0.2.1', commit: 'a'.repeat(40) };
  const packages = packageNames(source.version).map((name) => {
    const file = resolve(assetsDirectory, name);
    writeFileSync(file, name);
    return {
      name,
      bytes: readFileSync(file).length,
      sha256: sha256(file),
      uploadSha256: 'b'.repeat(64),
      submissionId: '12345678-1234-1234-1234-123456789abc',
    };
  });
  const manifest = {
    ...source,
    schema: 1,
    repository,
    teamId: appleTeamId,
    architecture: 'arm64',
    minimumMacOS: '14.0',
    packages,
  };
  const manifestFile = manifestName(source.version);
  writeFileSync(resolve(assetsDirectory, manifestFile), JSON.stringify(manifest));
  const assets = [...packageNames(source.version), manifestFile].map((name, index) => ({
    id: index + 1,
    name,
    state: 'uploaded',
    size: readFileSync(resolve(assetsDirectory, name)).length,
    digest: `sha256:${sha256(resolve(assetsDirectory, name))}`,
    browser_download_url: `https://github.com/${repository}/releases/download/untagged-fixture/${name}`,
  }));
  const release = {
    id: 42,
    tag_name: source.tag,
    prerelease: false,
    draft: true,
    html_url: `https://github.com/${repository}/releases/tag/untagged-fixture`,
  };
  // The CLI fixtures support downloads only. No credential or network tool is
  // available, and an attempted publication or other write fails the test.
  const cli = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const assets = JSON.parse(fs.readFileSync(path.join(__dirname, 'metadata.json'), 'utf8'));
let asset;
if (path.basename(process.argv[1]) === 'gh') {
  if (args.join(' ') === 'api repos/${repository}/releases/42/assets?per_page=100 --paginate --slurp') {
    process.stdout.write(JSON.stringify([assets]));
    process.exit(0);
  }
  if (args[0] !== 'api' || args.slice(2).join(' ') !== '-H Accept: application/octet-stream') throw new Error('Unexpected GitHub request');
  asset = assets.find(item => args[1] === 'repos/${repository}/releases/assets/' + item.id);
} else {
  asset = assets.find(item => args.at(-1) === 'https://github.com/${repository}/releases/download/${source.tag}/' + item.name);
}
if (!asset) throw new Error('Unexpected download');
process.stdout.write(fs.readFileSync(path.join(__dirname, 'assets', asset.name)));
`;
  for (const name of ['gh', 'curl']) writeFileSync(resolve(directory, name), cli, { mode: 0o755 });
  const verify = () => {
    writeFileSync(resolve(directory, 'metadata.json'), JSON.stringify(assets));
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {verifyRemote} from ${JSON.stringify(pathToFileURL(resolve(root, 'scripts/release/publish.ts')).href)};
verifyRemote(${JSON.stringify(release)}, ${JSON.stringify(source)}, ${JSON.stringify(manifest)}, ${JSON.stringify(assetsDirectory)});`,
      ],
      { env: { PATH: directory }, stdio: 'pipe' },
    );
  };
  try {
    verify();
    release.draft = false;
    release.html_url = `https://github.com/${repository}/releases/tag/${source.tag}`;
    assert.throws(verify, /Unexpected release asset URL/);
    for (const asset of assets)
      asset.browser_download_url = `https://github.com/${repository}/releases/download/${source.tag}/${asset.name}`;
    verify();
    const first = assets[0];
    assert.ok(first);
    first.state = 'starter';
    assert.throws(verify, /Unexpected release asset URL or upload state/);
    first.state = 'uploaded';
    first.digest = `sha256:${'c'.repeat(64)}`;
    assert.throws(verify, /Downloaded bytes differ/);
    first.digest = `sha256:${sha256(resolve(assetsDirectory, first.name))}`;
    writeFileSync(resolve(assetsDirectory, first.name), 'tampered package');
    assert.throws(verify, /Downloaded bytes differ/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
