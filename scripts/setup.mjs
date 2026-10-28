import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const frontend = resolve(root, 'frontend');
const venvPython = process.platform === 'win32'
  ? resolve(backend, '.venv', 'Scripts', 'python.exe')
  : resolve(backend, '.venv', 'bin', 'python');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd, label) {
  console.log(`\n[setup] ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[setup] Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[setup] ${label} failed (exit ${result.status ?? 'unknown'}). Check the output above and try again.`);
    process.exit(result.status || 1);
  }
}

const pythonCandidates = process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python'];
const python = pythonCandidates.find(candidate => {
  const result = spawnSync(candidate, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return false;
  const [major, minor] = result.stdout.trim().split('.').map(Number);
  return major > 3 || (major === 3 && minor >= 10);
});

if (!python) {
  console.error('[setup] Python 3.10 or newer was not found. Install it, or set PYTHON to its executable.');
  process.exit(1);
}

run(npm, ['ci'], frontend, 'Installing locked frontend dependencies');

if (!existsSync(venvPython)) {
  run(python, ['-m', 'venv', resolve(backend, '.venv')], root, 'Creating backend virtual environment');
}

run(venvPython, ['-m', 'pip', 'install', '-r', resolve(backend, 'requirements-dev.txt')], backend, 'Installing backend and development dependencies');
console.log('\n[setup] Apexion is ready. Start both services with: npm run dev');
