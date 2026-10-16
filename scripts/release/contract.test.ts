import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  appleTeamId,
  compareVersions,
  manifestName,
  packageNames,
  repository,
  root,
  sha256,
  stableVersion,
  validateAssets,
  validateManifest,
  validateSource,
} from './contract.ts';
import type { Manifest, Source } from './contract.ts';

const source: Source = { version: '0.2.0', tag: 'v0.2.0', commit: 'a'.repeat(40) };

function fixture(): { directory: string; manifest: Manifest } {
  const directory = mkdtempSync(resolve(tmpdir(), 'volumebridge-assets-test-'));
  const packages = packageNames(source.version).map((name) => {
    const file = resolve(directory, name);
    writeFileSync(file, name);
    return {
      name,
      bytes: readFileSync(file).length,
      sha256: sha256(file),
      uploadSha256: 'b'.repeat(64),
      submissionId: '12345678-1234-1234-1234-123456789abc',
    };
  });
  const manifest: Manifest = {
    ...source,
    schema: 1,
    repository,
    teamId: appleTeamId,
    architecture: 'arm64',
    minimumMacOS: '14.0',
    packages,
  };
  writeFileSync(resolve(directory, manifestName(source.version)), JSON.stringify(manifest));
  return { directory, manifest };
}

await test('stable versions reject ambiguous tags and compare numeric components', () => {
  for (const version of [
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.3-beta',
    '1.2.3+build',
    '1.2',
    '1.2.3\n',
  ])
    assert.throws(() => stableVersion(version));
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
});

await test('assets reject changed bytes, extra files, and missing packages', () => {
  const { directory, manifest } = fixture();
  try {
    assert.deepEqual(validateAssets(directory, source), manifest);
    writeFileSync(resolve(directory, 'extra.txt'), 'unexpected');
    assert.throws(() => validateAssets(directory, source), /only the two/);
    rmSync(resolve(directory, 'extra.txt'));
    const name = packageNames(source.version)[0];
    assert.ok(name);
    writeFileSync(resolve(directory, name), 'modified');
    assert.throws(() => validateAssets(directory, source), /bytes/);
    rmSync(resolve(directory, name));
    assert.throws(() => validateAssets(directory, source), /only the two/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

await test('manifests bind both distinct packages to one source and Apple team', () => {
  const { directory, manifest } = fixture();
  try {
    assert.throws(
      () => validateManifest({ ...manifest, commit: 'c'.repeat(40) }, source),
      /commit/,
    );
    assert.throws(() => validateManifest({ ...manifest, teamId: 'OTHER' }, source), /teamId/);
    assert.throws(
      () =>
        validateManifest(
          { ...manifest, packages: [manifest.packages[0], manifest.packages[0]] },
          source,
        ),
      /Duplicate/,
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...manifest,
            packages: [{ ...manifest.packages[0], name: '../escape.pkg' }, manifest.packages[1]],
          },
          source,
        ),
      /identity/,
    );
    assert.throws(() => validateManifest(manifest, { ...source, tag: 'v0.3.0' }), /source/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

await test('publisher dry-run validates assets without network tools or GitHub credentials', () => {
  const { directory } = fixture();
  try {
    const output = execFileSync(
      process.execPath,
      [
        resolve(root, 'scripts/release/publish.ts'),
        '--dry-run',
        directory,
        manifestName(source.version),
      ],
      {
        env: { PATH: '/nonexistent' },
        encoding: 'utf8',
      },
    );
    assert.match(output, /No GitHub requests/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

await test('source validation rejects lightweight tags, mismatched events, versions, and ancestry', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'volumebridge-source-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release@example.invalid');
    git('remote', 'add', 'origin', `https://github.com/${repository}.git`);
    writeFileSync(resolve(directory, 'Cargo.toml'), '[workspace.package]\nversion = "0.2.0"\n');
    writeFileSync(
      resolve(directory, 'Cargo.lock'),
      '[[package]]\nname = "volume-bridge"\nversion = "0.2.0"\n',
    );
    mkdirSync(resolve(directory, 'apps/volume-bridge/packaging'), { recursive: true });
    writeFileSync(
      resolve(directory, 'apps/volume-bridge/packaging/Driver-Info.plist.in'),
      '<key>CFBundleVersion</key><string>0.2.0</string><key>CFBundleShortVersionString</key><string>0.2.0</string>',
    );
    git('add', '.');
    git('commit', '-m', 'Create source fixture');
    const commit = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', commit);
    git('tag', 'v0.2.0');
    assert.throws(() => validateSource('v0.2.0', commit, directory), /annotated/);
    git('tag', '-d', 'v0.2.0');
    git('tag', '-a', 'v0.2.0', '-m', 'Release');
    assert.deepEqual(validateSource('v0.2.0', commit, directory), { ...source, commit });
    assert.throws(() => validateSource('v0.2.0', 'b'.repeat(40), directory), /commits differ/);
    writeFileSync(
      resolve(directory, 'Cargo.lock'),
      '[[package]]\nname = "volume-bridge"\nversion = "0.3.0"\n',
    );
    assert.throws(() => validateSource('v0.2.0', commit, directory), /versions differ/);
    git('checkout', '--', 'Cargo.lock');
    git('checkout', '--orphan', 'unrelated');
    git('commit', '-m', 'Unrelated main');
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
    git('checkout', '--detach', commit);
    assert.throws(() => validateSource('v0.2.0', commit, directory));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
