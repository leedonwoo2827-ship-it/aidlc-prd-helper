import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { partialString } from '../server/stream.mjs';
import { createApp } from '../server/index.mjs';
import { fixtureCoach } from './fixture-coach.mjs';

test('streaming decoder preserves Korean, escaped quotes, newlines and complete Unicode only', () => {
  const json = JSON.stringify({ summary: '내용', reflection: '첫 문장\n"인용"과 한글 😀', question: '누가 쓰나요?' });
  assert.equal(partialString(json, 'reflection'), '첫 문장\n"인용"과 한글 😀');
  assert.equal(partialString('{"reflection":"아직 작성 중', 'reflection'), '아직 작성 중');
  assert.equal(partialString('{"reflection":"값\\uAC', 'reflection'), '값');
  assert.equal(partialString('{"reflection":"값\\uAC00', 'reflection'), '값가');
  assert.equal(partialString('{"summary":"\\"reflection\\":\\"속이기\\"","reflection":"실제"}', 'reflection'), '실제');
});

test('SSE sends deltas before completion and commits validated state only at completion', async t => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const { server } = createApp({ bedrockEnabled: true, coach: async payload => {
    payload.onDelta({ field: 'reflection', text: '재고 관리 문제를' });
    await hold;
    payload.onDelta({ field: 'reflection', text: '재고 관리 문제를 이해했어요.' });
    return fixtureCoach(payload);
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { session, token } = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const response = await fetch(`${base}/api/sessions/${session.id}/answers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': token, Accept: 'text/event-stream' },
    body: JSON.stringify({ text: '카페 재고 관리', revision: 0, requestId: randomUUID() })
  });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  while (!text.includes('event: delta')) text += decoder.decode((await reader.read()).value, { stream: true });
  assert.doesNotMatch(text, /event: complete/);
  const interim = await (await fetch(`${base}/api/sessions/${session.id}`, { headers: { 'X-Session-Token': token } })).json();
  assert.equal(interim.session.step, 0);
  release();
  while (true) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value, { stream: true }); }
  assert.match(text, /event: complete/);
  const after = await (await fetch(`${base}/api/sessions/${session.id}`, { headers: { 'X-Session-Token': token } })).json();
  assert.equal(after.session.step, 1);
});
