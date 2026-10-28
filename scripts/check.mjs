import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(root, 'frontend');
const backend = resolve(root, 'backend');
const python = process.platform === 'win32'
  ? resolve(backend, '.venv', 'Scripts', 'python.exe')
  : resolve(backend, '.venv', 'bin', 'python');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requested = process.argv[2] ?? 'check';

function run(command, args, cwd, label) {
  console.log(`\n[check] ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[check] Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const checks = {
  lint: () => {
    run(npm, ['run', 'lint'], frontend, 'Frontend lint');
    run(python, ['-m', 'ruff', 'check', 'app', 'tests'], backend, 'Backend lint');
  },
  typecheck: () => run(npm, ['run', 'typecheck'], frontend, 'Frontend TypeScript check'),
  test: () => {
    run(python, ['-m', 'pytest'], backend, 'Backend tests');
    run(npm, ['test'], frontend, 'Frontend tests');
  },
  build: () => run(npm, ['run', 'build'], frontend, 'Frontend production build'),
};

if (requested === 'check') {
  for (const name of ['lint', 'typecheck', 'test', 'build']) checks[name]();
} else if (checks[requested]) {
  checks[requested]();
} else {
  console.error(`[check] Unknown check "${requested}". Choose lint, typecheck, test, build, or check.`);
  process.exit(2);
}
