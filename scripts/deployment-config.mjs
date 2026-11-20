import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function validateDeployment(value) {
  const missing = ['region', 'stackName', 'expectedAccountId', 'modelId']
    .filter(key => typeof value?.[key] !== 'string' || !value[key].trim());
  if (missing.length) throw new Error(`Fill config/deployment.json: ${missing.join(', ')}`);
  const config = { ...value };
  for (const key of ['region', 'stackName', 'expectedAccountId', 'modelId', 'awsProfile'])
    config[key] = String(config[key] ?? '').trim();
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.region)) throw new Error('Invalid region.');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,99}$/.test(config.stackName)) throw new Error('stackName must be 1-100 letters, digits or hyphens, starting with a letter.');
  if (!/^\d{12}$/.test(config.expectedAccountId)) throw new Error('expectedAccountId must be the customer AWS account ID.');
  if (!Array.isArray(config.bedrockResourceArns) || !config.bedrockResourceArns.length)
    throw new Error('bedrockResourceArns must list the selected model and inference-profile resources.');
  for (const arn of config.bedrockResourceArns) {
    if (typeof arn !== 'string' || /[\s*,]/.test(arn)) throw new Error('Bedrock resource ARNs must be explicit, without wildcards.');
    const match = /^arn:aws:bedrock:([a-z0-9-]+):(\d{12})?:(foundation-model|inference-profile|application-inference-profile)\/([A-Za-z0-9._:-]+)$/.exec(arn);
    if (!match || (match[3] === 'foundation-model' ? !!match[2] : match[2] !== config.expectedAccountId))
      throw new Error('Bedrock resources must be foundation models or inference profiles in the expected customer account.');
  }
  const matchesModel = config.bedrockResourceArns.some(arn => arn === config.modelId || arn.endsWith('/' + config.modelId));
  if (!matchesModel) throw new Error('modelId must match a resource in bedrockResourceArns.');
  return config;
}

export function loadDeployment(file = path.join(ROOT, 'config/deployment.json')) {
  return validateDeployment(JSON.parse(readFileSync(file, 'utf8')));
}
export function awsEnvironment(config) {
  return { ...process.env, AWS_REGION: config.region, AWS_DEFAULT_REGION: config.region,
    ...(config.awsProfile ? { AWS_PROFILE: config.awsProfile } : {}) };
}
export function verifyTarget(config) {
  const identity = JSON.parse(execFileSync('aws', ['sts', 'get-caller-identity', '--region', config.region, '--output', 'json'],
    { env: awsEnvironment(config), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (identity.Account !== config.expectedAccountId) throw new Error('AWS account does not match expectedAccountId. No resources were changed.');
}

// Machine-readable bridge used by deploy.py; never reads credentials or account files.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(loadDeployment(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
