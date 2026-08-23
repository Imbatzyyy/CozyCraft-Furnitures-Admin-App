import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = join(workspaceRoot, 'ios', 'App', 'App.xcodeproj');
const xcodeExecutable = '/Applications/Xcode.app/Contents/MacOS/Xcode';
const launcherPath = fileURLToPath(import.meta.url);

if (process.argv.includes('--watch-build-service')) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      execFileSync('/usr/bin/pgrep', ['-x', 'Xcode'], { stdio: 'ignore' });
    } catch {
      execFileSync('/bin/launchctl', ['unsetenv', 'CCC_OVERRIDE_OPTIONS']);
      process.exit(0);
    }

    try {
      execFileSync('/usr/bin/pgrep', ['-x', 'SWBBuildService'], { stdio: 'ignore' });
      execFileSync('/bin/launchctl', ['unsetenv', 'CCC_OVERRIDE_OPTIONS']);
      process.exit(0);
    } catch {
      // Keep watching until Xcode starts its out-of-process build service.
    }
  }
}

try {
  execFileSync('/usr/bin/pgrep', ['-x', 'Xcode'], { stdio: 'ignore' });
  console.error('Xcode is already open. Quit Xcode completely, then run `npm run ios` again.');
  process.exit(1);
} catch {
  // pgrep exits with 1 when Xcode is not running, which is the expected state.
}

// Xcode launches its build service outside the app's child-process tree, so
// this must be present in the macOS user session before Xcode starts. Xcode
// 26.6 can deadlock while capturing the combined output of its `clang -v -E
// -dM /dev/null` metadata probe. Apple's Clang override removes only `-v`;
// normal builds do not use that flag and all other compiler arguments remain
// unchanged.
execFileSync('/bin/launchctl', ['unsetenv', 'XCODE_XCCONFIG_FILE']);
execFileSync('/bin/launchctl', ['unsetenv', 'TOOLCHAINS']);
execFileSync('/bin/launchctl', ['setenv', 'CCC_OVERRIDE_OPTIONS', 'x-v']);

const xcode = spawn(xcodeExecutable, [projectPath], {
  detached: true,
  env: { ...process.env, CCC_OVERRIDE_OPTIONS: 'x-v' },
  stdio: 'ignore',
});
xcode.unref();

// Keep the override global only until Xcode's out-of-process build service
// inherits it, then remove it from the rest of the user session. Xcode itself
// retains the same environment for any child service it relaunches later.
const cleanup = spawn(process.execPath, [launcherPath, '--watch-build-service'], {
  detached: true,
  stdio: 'ignore',
});
cleanup.unref();

console.log('CozyCraft iOS opened in Xcode with the Xcode 26.6 build workaround enabled.');
