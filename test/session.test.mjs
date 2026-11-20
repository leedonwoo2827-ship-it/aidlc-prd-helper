import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server/index.mjs';
import { fixtureCoach as demoCoach } from './fixture-coach.mjs';
import { EXAMPLE_ANSWERS, STEPS } from '../public/shared.js';

async function fixture(t, options = {}) {
  const { server } = createApp({ bedrockEnabled: true, coach: demoCoach, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { method = 'GET', body, token, headers = {} } = {}) {
    const result = await fetch(base + route, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Session-Token': token } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: result.status, data: await result.json() };
  }
  async function start() {
    const result = await request('/api/sessions', { method: 'POST', body: {} });
    assert.equal(result.status, 201); return result.data;
  }
  async function answer(s, text, overrides = {}) {
    return request(`/api/sessions/${s.session.id}/answers`, { method: 'POST', token: s.token, body: { text, revision: s.session.revision, requestId: randomUUID(), ...overrides } });
  }
  return { request, start, answer, base };
}

test('every conversation owns a different capability; cross-session read, answer, rewind, review, delete are denied', async t => {
  const f = await fixture(t);
  const a = await f.start(), b = await f.start();
  assert.notEqual(a.session.id, b.session.id); assert.notEqual(a.token, b.token);
  for (const [suffix, method, body] of [
    ['', 'GET'], ['/answers', 'POST', { text: '다른 고객 데이터', revision: 0, requestId: randomUUID() }],
    ['/rewind', 'POST', { step: 0, revision: 0 }], ['/review', 'POST', { markdown: 'wrong', revision: 0 }], ['', 'DELETE']
  ]) {
    const result = await f.request(`/api/sessions/${b.session.id}${suffix}`, { method, body, token: a.token });
    assert.equal(result.status, 404);
  }
  assert.equal((await f.request(`/api/sessions/${a.session.id}`)).status, 404);
});

test('concurrent Bedrock conversations send only their own confirmed answers and commit independently', async t => {
  const captures = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { bedrockEnabled: true, coach: async payload => {
    captures.push(structuredClone({ session: payload.session, text: payload.text, step: payload.step }));
    if (captures.length === 2) release();
    await barrier;
    return demoCoach(payload);
  } });
  const a = await f.start('bedrock'), b = await f.start('bedrock');
  const [ra, rb] = await Promise.all([f.answer(a, '카페 재고 ALPHA_ONLY'), f.answer(b, '고객 문의 BETA_ONLY')]);
  assert.equal(ra.status, 200); assert.equal(rb.status, 200);
  assert.match(ra.data.session.markdown, /ALPHA_ONLY/); assert.doesNotMatch(ra.data.session.markdown, /BETA_ONLY/);
  assert.match(rb.data.session.markdown, /BETA_ONLY/); assert.doesNotMatch(rb.data.session.markdown, /ALPHA_ONLY/);
  a.session = ra.data.session; b.session = rb.data.session;
  await Promise.all([f.answer(a, '카페 점주 ALPHA_USER'), f.answer(b, 'CS 직원 BETA_USER')]);
  const aPayload = captures.find(x => x.text === '카페 점주 ALPHA_USER');
  const bPayload = captures.find(x => x.text === 'CS 직원 BETA_USER');
  assert.doesNotMatch(JSON.stringify(aPayload), /BETA/); assert.doesNotMatch(JSON.stringify(bPayload), /ALPHA/);
});

test('one conversation rejects concurrent writes and commits just one answer', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { bedrockEnabled: true, coach: async p => { entered(); await hold; return demoCoach(p); } });
  const a = await f.start('bedrock');
  const first = f.answer(a, '카페 재고 관리');
  await started;
  const second = await f.answer(a, '동시에 다른 답변');
  assert.equal(second.status, 409); assert.equal(second.data.error.code, 'BUSY');
  release(); const result = await first; assert.equal(result.data.session.step, 1);
});

test('retry is idempotent; reusing an ID with different content or stale revision is refused', async t => {
  let calls = 0;
  const f = await fixture(t, { bedrockEnabled: true, coach: p => { calls++; return demoCoach(p); } });
  const a = await f.start('bedrock'); const requestId = randomUUID();
  const first = await f.answer(a, '카페 재고 관리', { requestId });
  const replay = await f.answer(a, '카페 재고 관리', { requestId });
  assert.deepEqual(replay.data, first.data); assert.equal(calls, 1);
  assert.equal((await f.answer(a, '다른 내용', { requestId })).status, 409);
  assert.equal((await f.answer(a, '다음 단계지만 오래된 버전')).status, 409);
});

test('blank and irrelevant answers do not advance; idea never occupies audience', async t => {
  const f = await fixture(t); const a = await f.start();
  assert.equal((await f.answer(a, '  ')).status, 400);
  assert.equal((await f.answer(a, '!!!!')).status, 400);
  const irrelevant = await f.answer(a, '안녕');
  assert.equal(irrelevant.data.accepted, false); assert.equal(irrelevant.data.session.step, 0);
  a.session = irrelevant.data.session;
  const valid = await f.answer(a, '재고 관리 앱 (입출고 기록)');
  assert.equal(valid.data.session.step, 1);
  assert.equal(valid.data.session.answers.audience, undefined);
  assert.equal(valid.data.session.answers.idea.raw, '재고 관리 앱 (입출고 기록)');
  assert.equal(valid.data.session.messages.at(-1).step, 1);
});

test('recommendations follow the topic and are never recorded until submitted', async t => {
  const f = await fixture(t); const a = await f.start(), b = await f.start();
  const ra = await f.answer(a, '카페 재고 관리 앱'), rb = await f.answer(b, '고객 문의 정리 도구');
  assert.ok(ra.data.session.suggestions.some(s => s.includes('카페')));
  assert.ok(rb.data.session.suggestions.some(s => s.includes('CS')));
  assert.equal(Object.keys(ra.data.session.answers).length, 1);
  assert.doesNotMatch(ra.data.session.markdown, /창고 담당자/);
});

test('provider failure or invalid structured response commits no history and never falls back to demo', async t => {
  for (const coach of [
    async () => { throw new Error('provider unavailable'); },
    async () => ({ accepted: true, summary: 'invalid' })
  ]) {
    const f = await fixture(t, { bedrockEnabled: true, coach }); const a = await f.start('bedrock');
    const result = await f.answer(a, '카페 재고 관리 앱');
    assert.ok(result.status >= 500);
    const read = await f.request(`/api/sessions/${a.session.id}`, { token: a.token });
    assert.equal(read.data.session.step, 0); assert.equal(read.data.session.messages.length, 0);
  }
});

test('all seven answers produce an exportable grounded draft; review preserves explicit edits', async t => {
  const f = await fixture(t); const a = await f.start();
  assert.equal((await f.request(`/api/sessions/${a.session.id}/review`, { method: 'POST', token: a.token, body: { revision: 0, markdown: 'x'.repeat(100) } })).status, 409);
  for (const text of EXAMPLE_ANSWERS) {
    const result = await f.answer(a, text); assert.equal(result.status, 200);
    a.session = result.data.session;
  }
  assert.equal(a.session.step, 7); assert.equal(a.session.reviewed, false);
  assert.deepEqual(a.session.suggestions, []);
  STEPS.forEach((step, i) => assert.equal(a.session.answers[step.id].raw, EXAMPLE_ANSWERS[i]));
  assert.match(a.session.markdown, /7개/); assert.match(a.session.markdown, /부록/);
  const markdown = a.session.markdown + '\n\n사용자 직접 추가: 오프라인 시연';
  const result = await f.request(`/api/sessions/${a.session.id}/review`, { method: 'POST', token: a.token, body: { revision: a.session.revision, markdown } });
  assert.equal(result.status, 200); assert.equal(result.data.session.reviewed, true);
  assert.equal(result.data.session.markdown.trim(), markdown.trim());
});

test('rewind removes dependent answers and approval without leaving stale document state', async t => {
  const f = await fixture(t); const a = await f.start();
  for (const text of EXAMPLE_ANSWERS.slice(0, 4)) a.session = (await f.answer(a, text)).data.session;
  const result = await f.request(`/api/sessions/${a.session.id}/rewind`, { method: 'POST', token: a.token, body: { revision: a.session.revision, step: 1 } });
  assert.equal(result.status, 200); assert.equal(result.data.session.step, 1);
  assert.deepEqual(Object.keys(result.data.session.answers), ['idea']);
  assert.equal(result.data.session.reviewed, false);
  assert.doesNotMatch(result.data.session.markdown, /카페 점주 한 명/);
});

test('cross-origin access, bad settings and unconfigured live mode are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const badHost = await new Promise(resolve => {
    http.get(`${f.base}/api/config`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(badHost, 403);
  const disabled = await fixture(t, { bedrockEnabled: false });
  assert.equal((await disabled.request('/api/sessions', { method: 'POST', body: {} })).status, 503);
});

test('expired sessions cannot be read even with the correct token', async t => {
  let clock = 1000;
  const f = await fixture(t, { now: () => clock }); const a = await f.start();
  clock += 4 * 60 * 60 * 1000 + 1;
  assert.equal((await f.request(`/api/sessions/${a.session.id}`, { token: a.token })).status, 404);
});
