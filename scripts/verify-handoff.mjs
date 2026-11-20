import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './deployment-config.mjs';

const rules = [
  ['AWS account ID', /(?<!\d)\d{12}(?!\d)/],
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['JWT', /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/],
  ['deployed CloudFront address', /https?:\/\/[a-z0-9]+\.cloudfront\.net\b/i],
  ['Cognito pool ID', /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{6,}\b/],
  ['private workstation path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
  ['internal website', /https?:\/\/(?:w|code|phonetool|inside|midway|build)\.amazon\.(?:com|dev)\b/],
  ['literal credential', /(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|password|refreshToken)\s*["']?\s*[:=]\s*["'][A-Za-z0-9/+_=!.-]{14,}["']/i]
];
export const scanText = text => rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const textExtensions = new Set(['.mjs', '.js', '.json', '.md', '.txt', '.yaml', '.py', '.css', '.html']);

export function verifyHandoff(root = ROOT, strict = false) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'handoff-files.json'), 'utf8'));
  const failures = [];
  if (!Array.isArray(manifest.files) || new Set(manifest.files).size !== manifest.files.length)
    throw new Error('Invalid or duplicate manifest files.');
  for (const name of manifest.files) {
    if (typeof name !== 'string' || path.isAbsolute(name) || name.split('/').some(part => ['..', 'node_modules', '.local', '.git'].includes(part)) ||
        ['.env', 'config/deployment.json', 'config/outputs.json'].includes(name))
      throw new Error('Private or invalid file in handoff manifest.');
    const file = path.join(root, name);
    let cursor = root;
    for (const part of name.split('/')) {
      cursor = path.join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${name}`);
    }
    if (!lstatSync(file).isFile()) throw new Error(`Not a regular file: ${name}`);
    const bytes = readFileSync(file);
    if (textExtensions.has(path.extname(file)) || name === '.env.example' || name === '.gitignore')
      failures.push(...scanText(bytes.toString('utf8')).map(rule => `${name}: ${rule}`));
    if (manifest.preservedCore?.[name] && digest(bytes) !== manifest.preservedCore[name])
      failures.push(`${name}: preserved core differs from the reviewed handoff`);
  }
  const env = readFileSync(path.join(root, '.env.example'), 'utf8');
  const entries = Object.fromEntries(env.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
  for (const key of ['AWS_REGION', 'AWS_PROFILE', 'BEDROCK_MODEL_ID', 'BEDROCK_MODEL_LABEL'])
    if (entries[key] !== '') failures.push(`.env.example: ${key} must be empty`);
  if (entries.BEDROCK_ENABLED !== 'false') failures.push('.env.example: Bedrock must default to disabled');
  const deployment = JSON.parse(readFileSync(path.join(root, 'config/deployment.example.json'), 'utf8'));
  for (const key of ['region', 'stackName', 'expectedAccountId', 'awsProfile', 'modelId'])
    if (deployment[key] !== '') failures.push(`deployment example: ${key} must be empty`);
  if (!Array.isArray(deployment.bedrockResourceArns) || deployment.bedrockResourceArns.length)
    failures.push('deployment example: resource ARNs must be empty');
  const outputs = JSON.parse(readFileSync(path.join(root, 'config/outputs.example.json'), 'utf8'));
  if (!Object.keys(outputs).length || Object.values(outputs).some(value => value !== ''))
    failures.push('outputs example: all generated identifiers must be empty');
  if (strict) {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(file) : [path.relative(root, file).split(path.sep).join('/')];
    });
    for (const name of walk(root)) if (!manifest.files.includes(name)) failures.push(`${name}: not in handoff manifest`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return { files: manifest.files.length, preservedCoreFiles: Object.keys(manifest.preservedCore || {}).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const index = process.argv.indexOf('--root');
    const result = verifyHandoff(index < 0 ? ROOT : path.resolve(process.argv[index + 1]), process.argv.includes('--strict'));
    console.log(`PASS: ${result.files} allowlisted files, blank customer settings, secret/identifier patterns, ${result.preservedCoreFiles} preserved core hashes.`);
    if (!process.argv.includes('--strict')) console.log('Only allowlisted files were checked; package:handoff excludes private working files.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
