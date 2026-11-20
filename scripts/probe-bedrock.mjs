import { createBedrockCoach } from '../server/bedrock.mjs';
import { validateCoach } from '../server/engine.mjs';
import { STEPS } from '../public/shared.js';
import { localConfig } from '../server/config.mjs';
const { region, modelId, bedrockEnabled } = localConfig();
if (!bedrockEnabled) throw new Error('Set BEDROCK_ENABLED=true and provide customer region/model configuration to run this paid probe.');
const text = '작은 카페에서 재료의 입출고를 기록하고 남은 재고를 확인하는 앱을 만들고 싶어요.';
const started = Date.now();
const response = validateCoach(await createBedrockCoach({ region, modelId })({
  session: { answers: {}, question: STEPS[0].prompt },
  text, step: 0
}), text);
console.log(JSON.stringify({ region, modelId, latencyMs: Date.now() - started, response }, null, 2));
