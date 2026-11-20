import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { EXAMPLE_ANSWERS } from '../public/shared.js';
import { DEFER_ANSWER, SINGLE_UNIT_RULE } from '../public/workshop.js';
import { localConfig } from '../server/config.mjs';
const { region, modelId, port, bedrockEnabled } = localConfig();
if (!bedrockEnabled) throw new Error('Set BEDROCK_ENABLED=true explicitly before this paid live test.');
const base = `http://127.0.0.1:${port}`;
const evidence = [];
async function request(route, method, body, token) {
  const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json(); assert.equal(res.ok, true, JSON.stringify(data)); return data;
}
const a = await request('/api/sessions', 'POST', {});
const b = await request('/api/sessions', 'POST', {});
async function answer(client, text, marker) {
  const start = Date.now();
  const result = await request(`/api/sessions/${client.session.id}/answers`, 'POST', { text, revision: client.session.revision, requestId: randomUUID() }, client.token);
  client.session = result.session;
  evidence.push({ marker, step: client.session.step, accepted: result.accepted, latencyMs: Date.now() - start, lastReply: client.session.messages.at(-1), suggestions: client.session.suggestions });
  console.log(`${marker}: step ${client.session.step}/7; accepted=${result.accepted}; ${Date.now() - start} ms`);
  return result;
}
try {
  await Promise.all([
    answer(a, 'ALPHA_CAFE 팀이 작은 카페에서 입출고를 기록하고 남은 재고를 확인하는 앱을 만들고 싶어요.', 'cafe'),
    answer(b, 'BETA_SUPPORT 팀이 고객 문의를 등록하고 처리 상태를 관리하는 도구를 만들고 싶어요.', 'support')
  ]);
  await Promise.all([
    answer(a, EXAMPLE_ANSWERS[1], 'cafe'),
    answer(b, 'CS 담당자 한 명이 써요. 지금은 스프레드시트에서 문의를 찾아서, 미처리 문의를 놓치는 일이 있어요.', 'support')
  ]);
  for (let i = 2; i < EXAMPLE_ANSWERS.length; i++) {
    assert.ok(a.session.suggestions.includes(DEFER_ANSWER));
    await answer(a, i === 4 ? DEFER_ANSWER : EXAMPLE_ANSWERS[i], 'cafe');
  }
  assert.equal(a.session.step, 7);
  assert.doesNotMatch(JSON.stringify(a.session), /BETA_SUPPORT/);
  assert.doesNotMatch(JSON.stringify(b.session), /ALPHA_CAFE/);
  assert.equal(a.session.answers.audience.raw, EXAMPLE_ANSWERS[1]);
  assert.doesNotMatch(a.session.markdown, /워크숍 시간:/);
  assert.ok(a.session.markdown.includes(SINGLE_UNIT_RULE));
  assert.match(a.session.markdown, /## 제외 기능 \(구현하지 않음\)/);
  assert.doesNotMatch(a.session.markdown, /단일 컨테이너/);
  assert.equal(a.session.answers.data.deferred, true);
  assert.match(a.session.markdown, /FR1/);
  assert.match(a.session.markdown, /AC1/);
  const reviewed = await request(`/api/sessions/${a.session.id}/review`, 'POST', {
    revision: a.session.revision,
    markdown: a.session.markdown.replace('문서 상태: 검토 전 초안', '문서 상태: 사용자 검토 완료')
  }, a.token);
  assert.equal(reviewed.session.reviewed, true);
  await mkdir('.local/evidence', { recursive: true });
  await writeFile('.local/evidence/live-prd.md', reviewed.session.markdown);
  await writeFile('.local/evidence/live-bedrock.json', JSON.stringify({ verifiedAt: new Date().toISOString(), modelId, region, calls: evidence.length, results: evidence }, null, 2));
  console.log('PASS: two concurrent live conversations, context isolation, seven-answer PRD, review.');
} finally {
  await Promise.all([a, b].map(client => request(`/api/sessions/${client.session.id}`, 'DELETE', undefined, client.token)));
}
