import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const generatedPaths = [
  '.angular',
  'build',
  'out-tsc',
  'www',
  'android/.gradle',
  'android/.kotlin',
  'android/build',
  'android/app/build',
  'android/capacitor-cordova-android-plugins/build',
  'ios/App/build',
  'src/environments/environment.generated.ts',
];

for (const path of generatedPaths) {
  rmSync(resolve(workspace, path), { force: true, recursive: true });
}

console.log('Removed generated web and native build output.');
