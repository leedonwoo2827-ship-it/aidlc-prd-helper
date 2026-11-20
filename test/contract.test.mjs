import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTRACT_MARKDOWN, DEFER_ANSWER, SINGLE_UNIT_RULE, enforceWorkshopContract, isDeferred, withDeferOption } from '../public/workshop.js';
import { validateProductDoc } from '../server/engine.mjs';
import { draftMarkdown } from '../public/shared.js';

test('fixed workshop rules survive custom document replacement and remain idempotent', () => {
  const edited = '# 고객의 수정 문서\n\n사용자가 새로 쓴 요구사항입니다.';
  const result = enforceWorkshopContract(edited);
  assert.match(result, /로컬에서 빌드하고 실행/);
  assert.ok(result.includes(SINGLE_UNIT_RULE));
  for (const excluded of ['프로덕션 배포', 'CI/CD', 'IaC', 'APM', '재해 복구', '결제 처리', 'SaaS 구독', '수십만 건', '캐시 / CDN', '다국어'])
    assert.ok(result.includes(excluded), excluded);
  assert.doesNotMatch(CONTRACT_MARKDOWN, /컨테이너|Docker/);
  assert.equal(enforceWorkshopContract(result), result);
});
test('every follow-up offers deferral without treating a partially unresolved answer as wholly deferred', () => {
  assert.equal(withDeferOption(['점주가 사용해요', '직원이 사용해요']).at(-1), DEFER_ANSWER);
  assert.equal(withDeferOption([DEFER_ANSWER]).length, 1);
  assert.equal(withDeferOption(['yes'], true).length, 0);
  assert.equal(isDeferred(DEFER_ANSWER), true);
  assert.equal(isDeferred('아직 정하지 못했어요.'), true);
  assert.equal(isDeferred('사용자는 점주이고 데이터베이스는 미정이에요.'), false);
});
test('deferred answers are open questions and cannot ground confirmed requirements', () => {
  const answers = { data: { raw: DEFER_ANSWER, value: DEFER_ANSWER, uncertain: true, deferred: true } };
  const invalid = { title: 'MVP', functionalRequirements: [], nonFunctionalRequirements: [{ text: 'PostgreSQL을 사용한다', sources: [5] }], acceptanceCriteria: [], outOfScope: [], openQuestions: [] };
  assert.throws(() => validateProductDoc(invalid, answers), /근거/);
  const valid = { ...invalid, nonFunctionalRequirements: [], openQuestions: [{ text: '데이터의 형식과 접근 조건을 확인한다.', sources: [5] }] };
  assert.doesNotThrow(() => validateProductDoc(valid, answers));
  const md = draftMarkdown(answers);
  assert.match(md, /\[보류\]/);
  assert.match(md, /데이터와 제약: AI-DLC 진행 중 구체화 예정/);
  assert.doesNotMatch(md, /PostgreSQL/);
});
test('initial ideas have no deferral option, time selector, output selector or demo mode', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="duration"|id="target"|예시로 체험|mode-demo|mode-bedrock|단일 컨테이너/);
  assert.doesNotMatch(js, /data-action="defer-start"|아직 정하지 못했어요/);
  assert.match(html, /로컬에서 빌드하고 실행할 수 있는 MVP/);
  assert.match(html, /Unit of Work는 단일 유닛/);
});
