import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localConfig, cloudConfig } from '../server/config.mjs';
import { createBedrockCoach } from '../server/bedrock.mjs';
import { ROOT, validateDeployment } from '../scripts/deployment-config.mjs';
import { scanText } from '../scripts/verify-handoff.mjs';

const account = '1'.repeat(12);
const deployment = () => ({
  region: 'us-east-1', stackName: 'customer-test', expectedAccountId: account, awsProfile: '',
  modelId: 'test.model',
  bedrockResourceArns: ['arn:aws:bedrock:us-east-1::foundation-model/test.model']
});

test('blank local configuration previews without a model; explicit enable needs region and model', () => {
  assert.equal(localConfig({}).bedrockEnabled, false);
  assert.equal(localConfig({ AWS_REGION: '', BEDROCK_MODEL_ID: '', BEDROCK_ENABLED: 'false' }).region, '');
  assert.throws(() => localConfig({ BEDROCK_ENABLED: 'true' }), /AWS_REGION, BEDROCK_MODEL_ID/);
  assert.throws(() => localConfig({ BEDROCK_ENABLED: 'true', AWS_REGION: 'us-east-1' }), /BEDROCK_MODEL_ID/);
  assert.throws(() => localConfig({ BEDROCK_ENABLED: 'yes' }), /true or false/);
  assert.throws(() => localConfig({ PORT: 'NaN' }), /PORT/);
  assert.equal(localConfig({ BEDROCK_ENABLED: 'true', AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'test.model' }).modelLabel, 'Bedrock');
  assert.throws(() => createBedrockCoach({ region: '', modelId: '' }), /Required configuration/);
});

test('cloud runtime fails closed when generated auth/store/origin configuration is missing', () => {
  assert.throws(() => cloudConfig({}), /USER_POOL_ID.*CLIENT_ID.*TABLE_NAME.*PUBLIC_ORIGIN/);
  const values = { AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'test.model',
    USER_POOL_ID: 'configured', CLIENT_ID: 'configured', TABLE_NAME: 'configured', PUBLIC_ORIGIN: 'https://customer.example' };
  assert.equal(cloudConfig(values).modelLabel, 'Bedrock');
  assert.throws(() => cloudConfig({ ...values, PUBLIC_ORIGIN: 'http://customer.example' }), /HTTPS/);
  assert.throws(() => cloudConfig({ ...values, PUBLIC_ORIGIN: 'https://customer.example/path' }), /HTTPS/);
});

test('customer model selection is used verbatim while the full instruction and structured output remain', async () => {
  let request;
  const reply = { accepted: false, summary: '', uncertain: false, deferred: false, reflection: '확인이 필요해요.', question: '누가 쓰나요?', suggestions: [], document: null };
  const client = { send: async command => {
    request = command.input;
    return { stopReason: 'end_turn', output: { message: { content: [{ text: JSON.stringify(reply) }] } } };
  } };
  const coach = createBedrockCoach({ region: 'us-east-1', modelId: 'customer.selected-model', client });
  assert.deepEqual(await coach({ session: { answers: {}, question: '어떤 제품인가요?' }, text: '카페 재고 관리', step: 0 }), reply);
  assert.equal(request.modelId, 'customer.selected-model');
  assert.match(request.system[0].text, /미정은 미정으로 보존/);
  assert.match(request.system[0].text, /단일 유닛/);
  assert.equal(request.outputConfig.textFormat.type, 'json_schema');
});

test('deployment config rejects empty settings, broad permissions and resources from a different account', () => {
  assert.throws(() => validateDeployment({}), /Fill/);
  assert.deepEqual(validateDeployment(deployment()), deployment());
  assert.throws(() => validateDeployment({ ...deployment(), bedrockResourceArns: ['*'] }), /wildcards/);
  assert.throws(() => validateDeployment({ ...deployment(), modelId: 'other.model' }), /must match/);
  assert.throws(() => validateDeployment({ ...deployment(), bedrockResourceArns: [
    `arn:aws:bedrock:us-east-1:${'2'.repeat(12)}:inference-profile/test.model`
  ] }), /expected customer account/);
});

test('deployment plan is offline and an account mismatch stops apply before any AWS mutation', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prd-config-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'deployment.json');
  writeFileSync(config, JSON.stringify(deployment()));
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  const sentinel = path.join(dir, 'unexpected-aws');
  const calls = path.join(dir, 'aws-calls');
  writeFileSync(path.join(bin, 'aws'), `#!/bin/sh\nprintf '%s %s\\n' "$1" "$2" >> '${calls}'\nif [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then\n  printf '{"Account":"${'2'.repeat(12)}"}'\nelse\n  touch '${sentinel}'\n  exit 91\nfi\n`, { mode: 0o700 });
  const options = { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } };
  const plan = spawnSync('python3', ['scripts/deploy.py', '--config', config], options);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /AWS was not contacted/);
  assert.equal(existsSync(calls), false);
  const apply = spawnSync('python3', ['scripts/deploy.py', '--config', config, '--apply'], options);
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /does not match expectedAccountId/);
  assert.equal(existsSync(sentinel), false);
  assert.equal(readFileSync(calls, 'utf8').trim(), 'sts get-caller-identity');
});

test('handoff pattern scan detects seeded account identifiers and credentials without logging their values', () => {
  assert.ok(scanText(`account: ${account}`).includes('AWS account ID'));
  assert.ok(scanText('key: ' + 'AKIA' + 'X'.repeat(16)).includes('AWS access key'));
  assert.ok(scanText('https://' + 'exampledistribution' + '.cloudfront.net/').includes('deployed CloudFront address'));
  assert.ok(scanText('password="' + 'X'.repeat(20) + '"').includes('literal credential'));
  assert.deepEqual(scanText('AWS_PROFILE=\nBEDROCK_MODEL_ID=\n'), []);
});
