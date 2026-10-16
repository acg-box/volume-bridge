import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appleTeamId,
  manifestName,
  repository,
  record,
  root,
  validateAssets,
  validateManifest,
} from './contract.ts';
import { workflowSource } from './source.ts';

const source = workflowSource();
const stage = resolve(root, 'target/packages/release');
const output = resolve(root, 'target/release-assets');
const original = record(JSON.parse(readFileSync(resolve(stage, 'source.json'), 'utf8')) as unknown);
if (original.commit !== source.commit || original.version !== source.version)
  throw new Error('The packages were built from a different source revision.');
const evidence: unknown = JSON.parse(readFileSync(resolve(stage, 'notarization.json'), 'utf8'));
const manifest = validateManifest(
  {
    schema: 1,
    repository,
    teamId: appleTeamId,
    architecture: 'arm64',
    minimumMacOS: '14.0',
    ...source,
    packages: evidence,
  },
  source,
);
mkdirSync(output); // A fresh directory prevents stale or extra publication assets.
for (const item of manifest.packages) cpSync(resolve(stage, item.name), resolve(output, item.name));
writeFileSync(
  resolve(output, manifestName(source.version)),
  JSON.stringify(manifest, null, 2) + '\n',
);
validateAssets(output, source);
console.log(`Verified release assets: ${output}`);
