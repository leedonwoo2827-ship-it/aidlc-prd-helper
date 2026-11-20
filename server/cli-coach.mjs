// Local coach that calls an already logged-in CLI (Claude Code or Codex) using its OAuth subscription.
// No API key is read or stored here; each CLI uses its own login (claude: /login, codex: codex login).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEPS } from '../public/shared.js';
import { AppError } from './engine.mjs';
import { COACH_SCHEMA } from './coach-schema.mjs';

const TIMEOUT = 240000;
const basePrompt = readFileSync(new URL('./prompts/prd-coach.md', import.meta.url), 'utf8');
const system = `${basePrompt}

---
## 출력 형식 (필수)
도구를 사용하지 마세요. 아래 JSON Schema를 정확히 따르는 JSON 객체 하나만 출력하세요.
설명, 코드펜스(\`\`\`), 앞뒤 텍스트를 붙이지 마세요.

${JSON.stringify(COACH_SCHEMA)}`;

export const CLI_LABELS = { claude: 'Claude Code (OAuth)', codex: 'Codex CLI (OAuth)' };

function run(command, args, { input, cwd, env, signal }) {
  return new Promise((resolve, reject) => {
    // Args are fixed flags and quoted temp paths only; user text goes through stdin, never the command line.
    const child = spawn([command, ...args].join(' '), { cwd, env, shell: true, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, TIMEOUT);
    const abort = () => { child.kill(); reject(new Error(`${command} aborted`)); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).slice(-800)}`));
    });
    child.stdin.end(input, 'utf8');
  });
}

export function parseJsonReply(text) {
  let body = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start > 0 || (end >= 0 && end < body.length - 1)) body = body.slice(start, end + 1);
  return JSON.parse(body);
}

export function createCliCoach({ provider, model = '' }) {
  if (!CLI_LABELS[provider]) throw new Error(`Unknown COACH_PROVIDER: ${provider}`);
  return async ({ session, text, step, signal }) => {
    const context = {
      currentStep: STEPS[step],
      nextStep: STEPS[step + 1] ?? { id: 'review', label: '최종 검토' },
      answerSourceId: `Q${step + 1}`,
      confirmedAnswers: session.answers,
      currentQuestion: session.question,
      userAnswer: text
    };
    // An empty scratch directory keeps the CLI from picking up project files or instructions.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'prd-coach-'));
    const q = file => `"${file}"`;
    let output;
    try {
      if (provider === 'claude') {
        const promptFile = path.join(dir, 'system.md');
        writeFileSync(promptFile, system, 'utf8');
        const env = { ...process.env };
        delete env.ANTHROPIC_API_KEY; // force the OAuth subscription login
        const args = ['-p', '--output-format', 'json', '--system-prompt-file', q(promptFile),
          '--model', model || 'sonnet'];
        const raw = await run('claude', args, { input: JSON.stringify(context), cwd: dir, env, signal });
        const result = JSON.parse(raw);
        if (result.is_error) throw new Error(`claude error: ${String(result.result).slice(0, 500)}`);
        output = result.result;
      } else {
        const schemaFile = path.join(dir, 'schema.json');
        const outFile = path.join(dir, 'out.txt');
        writeFileSync(schemaFile, JSON.stringify(COACH_SCHEMA), 'utf8');
        const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral',
          '--output-schema', q(schemaFile), '-o', q(outFile), ...(model ? ['-m', model] : []), '-'];
        await run('codex', args, { input: `${system}\n\n---\n## 입력\n${JSON.stringify(context)}`, cwd: dir, env: process.env, signal });
        output = readFileSync(outFile, 'utf8');
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'cli_coach_error', provider, message: String(error.message).slice(0, 800) }));
      throw new AppError(502, 'MODEL_ERROR', 'AI 응답을 받지 못했어요. 입력을 유지했으니 다시 보내 주세요. CLI 로그인 상태를 확인해 주세요.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    try {
      return parseJsonReply(output);
    } catch {
      console.error(JSON.stringify({ event: 'model_validation', reason: 'invalid_json', provider }));
      throw new AppError(502, 'INVALID_MODEL_RESPONSE', 'AI 응답 형식을 확인하지 못했어요. 입력은 보존되어 있으니 다시 보내 주세요.');
    }
  };
}
