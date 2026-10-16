import { spawn } from 'node:child_process';
import { root } from './contract.ts';
import { withSigning } from './macos.ts';

// Run the repository build and checks before this credential-bearing process.
try {
  await withSigning(async ({ application, installer, keychain, profile, signal }) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scripts/package.ts', 'release', ...process.argv.slice(2)],
        {
          cwd: root,
          stdio: 'inherit',
          signal,
          env: {
            ...process.env,
            VOLUMEBRIDGE_SIGN_ID: application,
            VOLUMEBRIDGE_INSTALLER_SIGN_ID: installer,
            VOLUMEBRIDGE_KEYCHAIN: keychain,
            VOLUMEBRIDGE_NOTARY_PROFILE: profile,
          },
        },
      );
      child.once('error', () => reject(new Error('The signing process was interrupted.')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Package signing did not complete.')),
      );
    });
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Signing failed.');
  process.exitCode = 1;
}
