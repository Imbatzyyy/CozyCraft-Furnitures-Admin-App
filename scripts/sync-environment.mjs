import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const candidates = [
  resolve(appDirectory, '.env.local'),
  resolve(appDirectory, '.env'),
  resolve(appDirectory, '..', '.env.local'),
  resolve(appDirectory, '..', '.env'),
];

const parseEnv = (source) => Object.fromEntries(
  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

const values = candidates.reduce((result, candidate) => {
  if (Object.keys(result).length || !existsSync(candidate)) return result;
  return parseEnv(readFileSync(candidate, 'utf8'));
}, {});

const supabaseUrl = values.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const supabaseKey = values.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const androidPushConfigured = existsSync(resolve(appDirectory, 'android/app/google-services.json'));
const output = resolve(appDirectory, 'src/environments/environment.generated.ts');

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `// Generated from a local environment file. Do not commit.\nexport const environment = {\n  production: false,\n  supabaseUrl: ${JSON.stringify(supabaseUrl)},\n  supabasePublishableKey: ${JSON.stringify(supabaseKey)},\n  androidPushConfigured: ${JSON.stringify(androidPushConfigured)},\n} as const;\n`,
  'utf8',
);

if (!supabaseUrl || !supabaseKey) {
  console.warn('CozyCraft Admin: Supabase configuration is missing. Copy .env.example to .env.local.');
} else {
  console.log('CozyCraft Admin: browser-safe Supabase configuration synchronized.');
}
