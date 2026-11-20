import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync } from 'node:fs';
import { STEPS } from '../public/shared.js';
import { AppError } from './engine.mjs';
import { partialString } from './stream.mjs';
import { COACH_SCHEMA } from './coach-schema.mjs';
import { required } from './config.mjs';
const system = readFileSync(new URL('./prompts/prd-coach.md', import.meta.url), 'utf8');

export function createBedrockCoach({ region, modelId, client }) {
  required({ AWS_REGION: region, BEDROCK_MODEL_ID: modelId }, ['AWS_REGION', 'BEDROCK_MODEL_ID']);
  client ??= new BedrockRuntimeClient({ region, maxAttempts: 1 });
  return async ({ session, text, step, onDelta, signal }) => {
    const context = {
      currentStep: STEPS[step],
      nextStep: STEPS[step + 1] ?? { id: 'review', label: '최종 검토' },
      answerSourceId: `Q${step + 1}`,
      confirmedAnswers: session.answers,
      currentQuestion: session.question,
      userAnswer: text
    };
    let body = '';
    let stopReason;
    try {
      const input = {
        modelId, system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: JSON.stringify(context) }] }],
        inferenceConfig: { maxTokens: step === STEPS.length - 1 ? 5000 : 1800 },
        outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { name: 'workshop_prd_coach', schema: JSON.stringify(COACH_SCHEMA) } } } }
      };
      const abortSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000);
      if (onDelta) {
        const result = await client.send(new ConverseStreamCommand(input), { abortSignal });
        const emitted = {};
        for await (const event of result.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            body += event.contentBlockDelta.delta.text;
            if (body.length > 80000) throw new Error('Bedrock response exceeds allowed size');
            for (const field of ['reflection', 'question']) {
              const value = partialString(body, field);
              if (value !== null && value !== emitted[field]) {
                emitted[field] = value;
                onDelta({ field, text: value });
              }
            }
          }
          if (event.messageStop) stopReason = event.messageStop.stopReason;
          if (Object.keys(event).some(key => /Exception$/.test(key))) throw new Error('Bedrock stream returned an exception');
        }
      } else {
        const result = await client.send(new ConverseCommand(input), { abortSignal });
        stopReason = result.stopReason;
        body = result.output?.message?.content?.filter(item => item.text).map(item => item.text).join('') || '';
      }
    } catch (error) {
      // Keep provider details in the server log, never customer prompts or credentials.
      console.error(JSON.stringify({ event: 'bedrock_error', name: error.name, message: error.message?.slice(0, 500), code: error.code, requestId: error.$metadata?.requestId }));
      throw new AppError(502, 'BEDROCK_ERROR', 'Bedrock에서 응답을 받지 못했어요. 입력을 유지했으니 다시 보내 주세요. 연결 설정은 진행자에게 확인해 주세요.');
    }
    if (stopReason !== 'end_turn') throw new AppError(502, 'INCOMPLETE_MODEL_RESPONSE', 'AI 응답이 완료되지 않았어요. 잠시 후 다시 보내 주세요.');
    try {
      return JSON.parse(body);
    } catch {
      console.error(JSON.stringify({ event: 'model_validation', reason: 'invalid_json' }));
      throw new AppError(502, 'INVALID_MODEL_RESPONSE', 'AI 응답 형식을 확인하지 못했어요. 입력은 보존되어 있으니 다시 보내 주세요.');
    }
  };
}
