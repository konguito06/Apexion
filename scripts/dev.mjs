import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const frontend = resolve(root, 'frontend');
const venvPython = process.platform === 'win32'
  ? resolve(backend, '.venv', 'Scripts', 'python.exe')
  : resolve(backend, '.venv', 'bin', 'python');
const viteEntry = resolve(frontend, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(venvPython) || !existsSync(viteEntry)) {
  console.error('[apexion] Dependencies are missing. From the project root, run `npm run setup` first.');
  process.exit(1);
}

const backendCheck = spawnSync(venvPython, ['-c', 'import fastapi, uvicorn'], { cwd: backend, stdio: 'ignore' });
if (backendCheck.error || backendCheck.status !== 0) {
  console.error('[apexion] FastAPI or Uvicorn is missing from backend/.venv. Run `npm run setup` to install backend dependencies.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [];
let stopping = false;
let exitCode = 0;

function logLines(name, stream) {
  const reader = createInterface({ input: stream });
  reader.on('line', line => console.log(`[${name}] ${line}`));
}

function sendSignal(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.spawnargs && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`[apexion] Could not stop process ${child.pid}: ${error.message}`);
  }
}

function stopAll(signal = 'SIGTERM', code = 1) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const service of services) sendSignal(service.child, signal);
  const forceStop = setTimeout(() => {
    for (const service of services) sendSignal(service.child, 'SIGKILL');
  }, 5000);
  forceStop.unref();
}

function start(name, command, args, cwd) {
  console.log(`[apexion] Starting ${name}…`);
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    console.error(`[apexion] Could not start ${name}: ${error.message}`);
    stopAll('SIGTERM', 1);
    return;
  }

  services.push({ name, child });
  logLines(name, child.stdout);
  logLines(name, child.stderr);
  child.on('error', error => {
    console.error(`[apexion] ${name} failed to start: ${error.message}`);
    stopAll('SIGTERM', 1);
  });
  child.on('close', (code, signal) => {
    if (!stopping) {
      console.error(`[apexion] ${name} stopped unexpectedly (exit ${code ?? signal ?? 'unknown'}). Check its log above; the port may already be in use.`);
      stopAll('SIGTERM', code || 1);
    }
    if (services.every(service => service.child.exitCode !== null || service.child.signalCode !== null)) {
      process.exitCode = exitCode;
    }
  });
}

process.on('SIGINT', () => {
  if (stopping) return;
  console.log('\n[apexion] Ctrl+C received; stopping frontend and backend…');
  stopAll('SIGINT', 130);
});
process.on('SIGTERM', () => stopAll('SIGTERM', 143));

console.log('[apexion] Starting Apexion. Press Ctrl+C to stop both services.');
console.log('[apexion] Frontend: http://localhost:5173 · API docs: http://localhost:8000/docs');
start('backend', venvPython, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], backend);
start('frontend', npm, ['run', 'dev', '--', '--strictPort'], frontend);
