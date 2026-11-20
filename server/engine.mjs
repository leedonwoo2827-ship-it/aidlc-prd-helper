import { STEPS, draftMarkdown } from '../public/shared.js';
import { isDeferred, enforceWorkshopContract } from '../public/workshop.js';
export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function validateText(text) {
  if (typeof text !== 'string' || text.trim().length < 2 || text.trim().length > 2000)
    throw new AppError(400, 'INVALID_ANSWER', '답변을 2~2,000자로 적어 주세요.');
  if (!/[가-힣a-zA-Z0-9]/u.test(text) || /^(.)\1{5,}$/u.test(text.trim()))
    throw new AppError(400, 'INVALID_ANSWER', '질문에 대한 내용을 조금 더 구체적으로 적어 주세요.');
  return text.trim();
}
export function validateProductDoc(value, answers) {
  const fail = () => { throw new AppError(502, 'INVALID_DOCUMENT_RESPONSE', 'PRD의 근거를 확인하지 못했어요. 입력은 유지했으니 다시 보내 주세요.'); };
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) fail();
  const result = { title: value.title };
  for (const key of ['functionalRequirements', 'nonFunctionalRequirements', 'acceptanceCriteria', 'outOfScope', 'openQuestions']) {
    const items = value[key];
    if (!Array.isArray(items) || items.length > 15) fail();
    result[key] = items.map(item => {
      if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 1200 || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 7) fail();
      for (const n of item.sources) {
        if (!Number.isInteger(n) || n < 1 || n > 7 || !answers[STEPS[n - 1].id]) fail();
        if (key !== 'openQuestions' && answers[STEPS[n - 1].id].uncertain) fail();
      }
      return { text: item.text, sources: [...new Set(item.sources)] };
    });
  }
  return result;
}
export function validateCoach(value, text) {
  const fail = (reason = 'unknown') => { console.error(JSON.stringify({ event: 'model_validation', reason })); throw new AppError(502, 'INVALID_MODEL_RESPONSE', 'AI 응답 형식을 확인하지 못했어요. 입력은 보존되어 있으니 다시 보내 주세요.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (typeof value.accepted !== 'boolean' || typeof value.uncertain !== 'boolean') fail('status_type');
  for (const key of ['summary', 'reflection', 'question']) if (typeof value[key] !== 'string' || value[key].length > 5000) fail(`text_${key}`);
  if (!value.reflection.trim() || !value.question.trim() || (value.accepted && !value.summary.trim())) fail('empty_required_text');
  if (!Array.isArray(value.suggestions) || value.suggestions.length > 3 || value.suggestions.some(s => typeof s !== 'string' || s.length < 2 || s.length > 160)) fail('suggestions_shape');
  if (value.accepted && !text.trim()) fail();
  return value;
}
export function publicSession(session) {
  return {
    id: session.id, mode: session.mode,
    answers: session.answers, messages: session.messages, step: session.step,
    revision: session.revision, reviewed: session.reviewed, createdAt: session.createdAt,
    question: session.question, suggestions: session.suggestions,
    markdown: session.markdown ? enforceWorkshopContract(session.markdown) : draftMarkdown(session.answers, session)
  };
}
