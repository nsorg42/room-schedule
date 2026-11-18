import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const stdio = ['ignore', 'inherit', 'inherit'];
const detached = process.platform !== 'win32';
const children = [
  spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8787'], { stdio, detached }),
  spawn('node', ['node_modules/vite/bin/vite.js'], { stdio, detached }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Wrangler starts child processes too; stop each server's whole process group.
  for (const child of children) {
    try {
      if (detached && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error);
    }
  }
  process.exitCode = code;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => stop(code ?? 0));
}
