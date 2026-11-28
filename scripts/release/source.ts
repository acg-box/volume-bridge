import { readVersion, validateSource } from './contract.ts';

export function releaseSource(tag = `v${readVersion()}`) {
  return validateSource(tag);
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error('Usage: source.ts [vX.Y.Z]');
  console.log(JSON.stringify(releaseSource(process.argv[2])));
}
