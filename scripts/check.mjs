import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './deployment-config.mjs';
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const files = ['index.mjs', ...['public', 'server', 'scripts', 'test'].flatMap(dir => walk(path.join(ROOT, dir)))];
for (const file of files.filter(file => /\.(mjs|js)$/.test(file)))
  execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' });
console.log('PASS: all JavaScript modules parse.');
