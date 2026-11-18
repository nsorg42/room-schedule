import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const stdio = ['ignore', 'inherit', 'inherit'];
const children = [
  spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8787'], { stdio }),
  spawn('node', ['node_modules/vite/bin/vite.js'], { stdio }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => stop(code ?? 0));
}
