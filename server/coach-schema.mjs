const claim = {
  type: 'object', additionalProperties: false, required: ['text', 'sources'],
  properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7] } } }
};
const product = {
  type: 'object', additionalProperties: false,
  required: ['title', 'functionalRequirements', 'nonFunctionalRequirements', 'acceptanceCriteria', 'outOfScope', 'openQuestions'],
  properties: {
    title: { type: 'string' },
    ...Object.fromEntries(['functionalRequirements', 'nonFunctionalRequirements', 'acceptanceCriteria', 'outOfScope', 'openQuestions'].map(key => [key, { type: 'array', items: claim }]))
  }
};
export const COACH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['accepted', 'summary', 'uncertain', 'deferred', 'reflection', 'question', 'suggestions', 'document'],
  properties: {
    accepted: { type: 'boolean' }, summary: { type: 'string' }, uncertain: { type: 'boolean' }, deferred: { type: 'boolean' },
    reflection: { type: 'string' }, question: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    document: { anyOf: [{ type: 'null' }, product] }
  }
};
