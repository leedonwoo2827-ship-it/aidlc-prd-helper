import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { CognitoIdentityProviderClient, InitiateAuthCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { EXAMPLE_ANSWERS } from '../public/shared.js';
import { DEFER_ANSWER, SINGLE_UNIT_RULE } from '../public/workshop.js';
import { ROOT, loadDeployment, verifyTarget } from './deployment-config.mjs';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { awsEnvironment } from './deployment-config.mjs';

if (!process.argv[2] || !process.argv.includes('--run-live'))
  throw new Error('Usage: node scripts/verify-deployed.mjs PRIVATE_ACCOUNT_JSON --run-live (paid model calls and a temporary account).');
process.chdir(ROOT);
const deployment = loadDeployment();
verifyTarget(deployment);
Object.assign(process.env, awsEnvironment(deployment));
const account = JSON.parse(await readFile(process.argv[2], 'utf8'));
const stack = await new CloudFormationClient({ region: deployment.region }).send(new DescribeStacksCommand({ StackName: deployment.stackName }));
const outputs = Object.fromEntries(stack.Stacks[0].Outputs.map(x => [x.OutputKey, x.OutputValue]));
if (account.siteUrl !== outputs.SiteUrl || account.userPoolId !== outputs.UserPoolId || account.clientId !== outputs.ClientId || account.region !== deployment.region)
  throw new Error('Account file does not belong to the configured customer stack.');
await mkdir('.local/evidence', { recursive: true, mode: 0o700 });
const base = account.siteUrl;
const cognito = new CognitoIdentityProviderClient({ region: account.region });
const evidence = { checkedAt: new Date().toISOString(), site: base, checks: [], streams: [] };
const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); console.log(`PASS: ${name}`); };
async function login(user = account) {
  const result = await cognito.send(new InitiateAuthCommand({
    ClientId: user.clientId, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: user.username, PASSWORD: user.password }
  }));
  const jwt = result.AuthenticationResult.IdToken;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  return { jwt, claims };
}
async function request(route, { method = 'GET', body, login: who, session, accept } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return fetch(base + route, {
    method, headers: {
      Origin: base, ...(who ? { 'X-App-Token': who.jwt } : {}),
      ...(session ? { 'X-Session-Token': session.token } : {}),
      ...(encoded !== undefined ? { 'Content-Type': 'application/json', 'X-Amz-Content-Sha256': createHash('sha256').update(encoded).digest('hex') } : {}),
      ...(accept ? { Accept: accept } : {})
    }, ...(encoded !== undefined ? { body: encoded } : {})
  });
}
const clients = [];
let expiryAccount, expiryLogin;
try {
  const anon = await request('/api/me');
  check('anonymous API is denied by login gate', anon.status === 401 && (await anon.json()).error.code === 'LOGIN_REQUIRED');
  const forged = await request('/api/me', { login: { jwt: 'forged-token' } });
  check('forged credentials are rejected', forged.status === 401);
  const expiryName = `expiry-proof-${Date.now()}`;
  const expiryEnd = new Date(Date.now() + 150000).toISOString();
  const creation = JSON.parse(execFileSync(process.execPath, [
    'scripts/workshop-account.mjs', 'create', '--username', expiryName, '--end', expiryEnd
  ], { encoding: 'utf8' }));
  expiryAccount = JSON.parse(await readFile(creation.credentialsFile, 'utf8'));
  expiryAccount.file = creation.credentialsFile;
  expiryLogin = await login(expiryAccount);
  check('short-lived account works before expiry', (await request('/api/me', { login: expiryLogin })).status === 200);
  const logins = await Promise.all(Array.from({ length: 4 }, () => login()));
  check('four logins share one account subject', new Set(logins.map(x => x.claims.sub)).size === 1);
  check('each login has a distinct origin_jti', new Set(logins.map(x => x.claims.origin_jti)).size === 4 && logins.every(x => x.claims.origin_jti));
  for (const who of logins) {
    const response = await request('/api/sessions', { method: 'POST', body: {}, login: who });
    check('authenticated conversation creation', response.status === 201);
    clients.push({ login: who, ...(await response.json()) });
  }
  check('same account has four distinct conversations', new Set(clients.map(c => c.session.id)).size === 4);
  for (const [suffix, method, body] of [
    ['', 'GET'], ['/answers', 'POST', { text: '다른 대화에 쓰기', revision: 0, requestId: randomUUID() }],
    ['/review', 'POST', { revision: 0, markdown: 'x'.repeat(200) }], ['', 'DELETE']
  ]) {
    const res = await request(`/api/sessions/${clients[1].session.id}${suffix}`, {
      method, body, login: clients[0].login, session: clients[1]
    });
    check(`cross-login access denied: ${method} ${suffix || 'session'}`, res.status === 404);
  }
  const wrongKey = await request(`/api/sessions/${clients[0].session.id}`, { login: clients[0].login, session: clients[1] });
  check('wrong conversation capability rejected even in same login', wrongKey.status === 404);
  const markers = ['PROBE_ALPHA', 'PROBE_BETA', 'PROBE_GAMMA', 'PROBE_DELTA'];
  async function answer(client, text, { testConcurrent = false } = {}) {
    const payload = { text, revision: client.session.revision, requestId: randomUUID() };
    const start = Date.now();
    const response = await request(`/api/sessions/${client.session.id}/answers`, {
      method: 'POST', body: payload, login: client.login, session: client, accept: 'text/event-stream'
    });
    assert.equal(response.status, 200, `answer HTTP ${response.status}`);
    check('deployed response is SSE', response.headers.get('content-type')?.includes('text/event-stream'));
    if (testConcurrent) {
      const second = await request(`/api/sessions/${client.session.id}/answers`, {
        method: 'POST', body: { ...payload, requestId: randomUUID() }, login: client.login, session: client
      });
      check('concurrent writes to one conversation are rejected', second.status === 409);
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = '', complete = null, deltas = 0, firstDeltaMs = null;
    while (true) {
      const next = await reader.read(); buffer += decoder.decode(next.value, { stream: !next.done });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        const type = frame.split('\n').find(x => x.startsWith('event: '))?.slice(7);
        const data = JSON.parse(frame.split('\n').filter(x => x.startsWith('data: ')).map(x => x.slice(6)).join('\n'));
        if (type === 'delta') { deltas++; firstDeltaMs ??= Date.now() - start; }
        if (type === 'complete') complete = data;
        if (type === 'failure') throw new Error(`Server failure: ${data.error.code}: ${data.error.message}`);
      }
      if (next.done) break;
    }
    assert.ok(complete?.accepted, 'answer accepted');
    client.session = complete.session;
    evidence.streams.push({ step: client.session.step, deltas, firstDeltaMs, totalMs: Date.now() - start });
    check('text deltas arrive before validated completion', deltas > 2 && firstDeltaMs < Date.now() - start);
    return payload;
  }
  const topics = [
    `${markers[0]} 작은 카페에서 재료 입출고를 기록하고 남은 재고를 확인하는 앱.`,
    `${markers[1]} 테이블에서 메뉴를 주문하고 직원이 주문 상태를 바꾸는 도구. 결제 제외.`,
    `${markers[2]} 회의실의 빈 시간을 확인하고 예약과 취소를 하는 시스템.`,
    `${markers[3]} 선생님이 과제를 등록하고 가상 학생의 제출 상태를 확인하는 도구.`
  ];
  const receipts = await Promise.all(clients.map((client, i) => answer(client, topics[i], { testConcurrent: i === 0 })));
  await Promise.all(clients.map((client, i) => answer(client, [
    EXAMPLE_ANSWERS[1], '식당 직원이 주문을 종이에 적다가 누락해요.', '회사 직원이 메신저로 회의실 빈 시간을 물어봐야 해요.', '선생님이 제출 여부를 종이 명단에서 확인하고 있어요.'
  ][i])));
  for (let i = 0; i < clients.length; i++) {
    const all = JSON.stringify(clients[i].session);
    check(`conversation ${i + 1} contains only its own input`, all.includes(markers[i]) && markers.every((marker, j) => j === i || !all.includes(marker)));
  }
  const retry = await request(`/api/sessions/${clients[0].session.id}/answers`, {
    method: 'POST', body: receipts[0], login: clients[0].login, session: clients[0]
  });
  check('replayed request does not append an answer', retry.status === 200 && (await retry.json()).session.step === 2);
  for (let i = 2; i < 7; i++) await answer(clients[0], i === 4 ? DEFER_ANSWER : EXAMPLE_ANSWERS[i]);
  const final = clients[0].session;
  check('seven-turn PRD preserves deferral and fixed workshop rules', final.step === 7 && final.answers.data.deferred && final.markdown.includes(SINGLE_UNIT_RULE) && final.markdown.includes('## 제외 기능 (구현하지 않음)') && final.markdown.includes('FR1') && !final.markdown.includes('단일 컨테이너'));
  const edited = '# 사용자가 검토한 PRD\n\n' + '재고를 조회하고 입출고를 기록한다. '.repeat(12);
  const reviewed = await request(`/api/sessions/${final.id}/review`, {
    method: 'POST', body: { revision: final.revision, markdown: edited }, login: clients[0].login, session: clients[0]
  });
  const reviewedData = await reviewed.json();
  check('edited document retains mandatory exclusions and single unit', reviewed.status === 200 && reviewedData.session.reviewed && reviewedData.session.markdown.includes(SINGLE_UNIT_RULE) && reviewedData.session.markdown.includes('다국어 지원'));
  clients[0].session = reviewedData.session;
  await writeFile('.local/evidence/deployed-prd.md', final.markdown);
  const expiryMs = Date.parse(expiryAccount.endsAt);
  while (Date.now() < expiryMs + 1000) {
    console.log(`Waiting for scheduled expiry: ${Math.ceil((expiryMs - Date.now()) / 1000)}s`);
    await new Promise(resolve => setTimeout(resolve, Math.min(20000, Math.max(1000, expiryMs - Date.now() + 1000))));
  }
  const expired = await request('/api/me', { login: expiryLogin });
  check('already-issued JWT is denied at workshop end', expired.status === 403 && (await expired.json()).error.code === 'WORKSHOP_EXPIRED');
  let deleted = false;
  for (let i = 0; i < 15; i++) {
    try { await cognito.send(new AdminGetUserCommand({ UserPoolId: expiryAccount.userPoolId, Username: expiryAccount.username })); }
    catch (error) { if (error.name === 'UserNotFoundException') { deleted = true; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  check('scheduler deletes the expired Cognito account', deleted);
  await unlink(expiryAccount.file);
  await writeFile('.local/evidence/deployed-verification.json', JSON.stringify(evidence, null, 2));
  console.log(`PASS: ${evidence.checks.length} deployed checks, ${evidence.streams.length} real Bedrock streams.`);
} finally {
  for (const client of clients) await request(`/api/sessions/${client.session.id}`, { method: 'DELETE', login: client.login, session: client }).catch(() => {});
}
