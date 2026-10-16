import { appendFileSync } from 'node:fs';
import { repository, text, validateSource } from './contract.ts';

export function workflowSource() {
  const tag = text(process.env.GITHUB_REF_NAME);
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== `refs/tags/${tag}`)
    throw new Error('A tag event from the canonical repository is required.');
  const source = validateSource(tag, text(process.env.GITHUB_SHA));
  for (const [key, expected] of Object.entries({
    VOLUMEBRIDGE_RELEASE_COMMIT: source.commit,
    VOLUMEBRIDGE_RELEASE_VERSION: source.version,
  })) {
    if (process.env[key] && process.env[key] !== expected)
      throw new Error(`Validated source binding differs: ${key}`);
  }
  return source;
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error('Usage: source.ts [vX.Y.Z]');
  const source = process.argv[2] ? validateSource(process.argv[2]) : workflowSource();
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `commit=${source.commit}\nversion=${source.version}\n`,
    );
  console.log(JSON.stringify(source));
}
