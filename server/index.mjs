import http from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS } from '../public/shared.js';
import { withDeferOption, isDeferred, enforceWorkshopContract, CONTRACT_VERSION } from '../public/workshop.js';
import { AppError, validateText, validateCoach, validateProductDoc, publicSession } from './engine.mjs';
import { createBedrockCoach } from './bedrock.mjs';
import { localConfig } from './config.mjs';
import { createCliCoach, CLI_LABELS } from './cli-coach.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest();
const TTL = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_ATTEMPTS = 40;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export function createApp({ bedrockEnabled = false, coach, modelLabel = 'Bedrock', now = Date.now } = {}) {
  const sessions = new Map();
  let activeModelCalls = 0;
  const clean = () => {
    for (const [id, session] of sessions) if (now() - session.touchedAt > TTL && !session.busy) sessions.delete(id);
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  async function body(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'JSON 요청만 지원합니다.');
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 100000) throw new AppError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
    }
    try { return JSON.parse(text); } catch { throw new AppError(400, 'INVALID_JSON', '올바르지 않은 요청입니다.'); }
  }
  function resolve(req, id) {
    clean();
    const session = sessions.get(id);
    const token = req.headers['x-session-token'];
    // A per-conversation capability is a second isolation boundary, not a login mechanism.
    // This local-only server deliberately has no deployable authentication bypass.
    if (!session || typeof token !== 'string' || !timingSafeEqual(hash(token), session.tokenHash))
      throw new AppError(404, 'SESSION_NOT_FOUND', '이 탭의 대화를 찾을 수 없어요. 새 대화를 시작해 주세요.');
    session.touchedAt = now();
    return session;
  }
  function revisionGuard(session, input) {
    if (session.busy) throw new AppError(409, 'BUSY', '이 대화의 답변을 처리하고 있어요. 잠시 기다려 주세요.');
    if (input.revision !== session.revision) throw new AppError(409, 'STALE_REVISION', '대화 상태가 변경됐어요. 현재 답변을 확인하고 다시 보내 주세요.');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Exact host and origin checking prevents DNS rebinding and cross-site local API calls.
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) throw new AppError(403, 'INVALID_HOST', '허용되지 않은 호스트입니다.');
      const expectedOrigin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new AppError(403, 'INVALID_ORIGIN', '허용되지 않은 요청 출처입니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'CROSS_SITE', '교차 사이트 요청을 허용하지 않습니다.');
      const url = new URL(req.url, expectedOrigin);
      if (url.pathname === '/api/config' && req.method === 'GET')
        return send(res, 200, { local: true, bedrockEnabled, model: bedrockEnabled ? modelLabel : null, persistence: 'memory', sessionTtlHours: 4 });
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        const input = await body(req);
        clean();
        if (sessions.size >= MAX_SESSIONS) throw new AppError(429, 'CAPACITY', '현재 대화가 많아요. 잠시 후 다시 시작해 주세요.');
        if (!bedrockEnabled || !coach) throw new AppError(503, 'BEDROCK_DISABLED', '아직 Bedrock이 연결되지 않았어요. 진행자에게 연결 상태를 확인해 주세요.');
        const token = randomBytes(32).toString('base64url');
        const session = {
          id: randomUUID(), tokenHash: hash(token), mode: 'bedrock',
          contractVersion: CONTRACT_VERSION,
          answers: {}, messages: [], step: 0, revision: 0, reviewed: false,
          createdAt: new Date(now()).toISOString(), touchedAt: now(), busy: false, attempts: 0,
          question: STEPS[0].prompt, suggestions: withDeferOption([]), receipts: new Map()
        };
        sessions.set(session.id, session);
        return send(res, 201, { session: publicSession(session), token });
      }
      const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(answers|rewind|review))?$/);
      if (match) {
        const session = resolve(req, match[1]);
        if (req.method === 'GET' && !match[2]) return send(res, 200, { session: publicSession(session) });
        if (req.method === 'DELETE' && !match[2]) {
          if (session.busy) throw new AppError(409, 'BUSY', '응답이 끝난 후 대화를 종료해 주세요.');
          sessions.delete(session.id); return send(res, 200, { deleted: true });
        }
        if (req.method !== 'POST') throw new AppError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
        const input = await body(req);
        if (match[2] === 'answers') {
          if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new AppError(400, 'REQUEST_ID', '요청 ID가 필요합니다.');
          const fingerprint = JSON.stringify({ text: input.text, revision: input.revision });
          const receipt = session.receipts.get(input.requestId);
          if (receipt) {
            if (receipt.fingerprint !== fingerprint) throw new AppError(409, 'REQUEST_REUSED', '요청 ID가 다른 내용에 재사용됐어요.');
            return send(res, 200, receipt.response);
          }
          revisionGuard(session, input);
          if (session.step >= STEPS.length) throw new AppError(409, 'COMPLETE', '답변이 모두 모였어요. PRD를 검토해 주세요.');
          if (session.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'TURN_LIMIT', '이 대화의 질문 한도에 도달했어요. 현재 초안을 내려받고 새로 시작해 주세요.');
          const text = validateText(input.text);
          if (session.mode === 'bedrock' && activeModelCalls >= 12) throw new AppError(429, 'MODEL_CAPACITY', 'AI 요청이 많아요. 입력은 유지되니 잠시 후 다시 보내 주세요.');
          session.busy = true; session.attempts++;
          if (session.mode === 'bedrock') activeModelCalls++;
          const stream = String(req.headers.accept || '').includes('text/event-stream');
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableEnded) controller.abort(); };
          res.on('close', disconnected);
          const event = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
          if (stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
            res.flushHeaders();
            event('status', { message: '답변을 읽고 있어요.' });
          }
          try {
            const step = session.step;
            // Only this session is copied into the model request; no shared history or mutable global prompt.
            const snapshot = structuredClone({ answers: session.answers, question: session.question });
            const reply = validateCoach(await coach({ session: snapshot, text, step, signal: controller.signal,
              ...(stream ? { onDelta: data => event('delta', data) } : {})
            }), text);
            if (controller.signal.aborted) throw new AppError(499, 'CLIENT_DISCONNECTED', '연결이 종료되어 답변을 반영하지 않았어요.');
            const deferred = isDeferred(text) || reply.deferred === true;
            const nextAnswers = reply.accepted ? { ...session.answers, [STEPS[step].id]: {
              raw: text, value: deferred ? 'AI-DLC를 진행하면서 구체화할 예정.' : reply.summary,
              uncertain: reply.uncertain || deferred, deferred
            } } : session.answers;
            let productDoc = null;
            if (reply.accepted && step === STEPS.length - 1) {
              productDoc = validateProductDoc(reply.document, nextAnswers);
            }
            session.messages.push({ role: 'user', text, step, id: randomUUID() });
            session.messages.push({ role: 'assistant', text: reply.reflection, question: reply.question, step: reply.accepted ? step + 1 : step, id: randomUUID() });
            if (reply.accepted) {
              session.answers = nextAnswers;
              session.step++;
            }
            session.question = reply.question;
            session.suggestions = withDeferOption(reply.suggestions, session.step === STEPS.length);
            session.productDoc = productDoc;
            session.revision++; session.reviewed = false; session.markdown = undefined;
            const response = { session: publicSession(session), accepted: reply.accepted };
            session.receipts.set(input.requestId, { fingerprint, response });
            if (stream) { event('complete', response); return res.end(); }
            return send(res, 200, response);
          } catch (error) {
            if (!stream) throw error;
            event('failure', { error: { code: error.code || 'STREAM_ERROR', message: error.status ? error.message : '응답을 완료하지 못했어요. 입력은 유지했으니 다시 보내 주세요.' } });
            res.end();
          } finally { res.off('close', disconnected); session.busy = false; if (session.mode === 'bedrock') activeModelCalls--; }
        }
        revisionGuard(session, input);
        if (match[2] === 'rewind') {
          if (!Number.isInteger(input.step) || input.step < 0 || input.step >= session.step) throw new AppError(400, 'INVALID_STEP', '수정할 완료 단계를 선택해 주세요.');
          for (let i = input.step; i < STEPS.length; i++) delete session.answers[STEPS[i].id];
          session.messages = session.messages.filter(m => m.role === 'user' ? m.step < input.step : m.step <= input.step);
          session.step = input.step; session.question = STEPS[input.step].prompt;
          session.suggestions = withDeferOption([]);
          session.productDoc = null; session.reviewed = false; session.markdown = undefined; session.revision++; session.receipts.clear();
          return send(res, 200, { session: publicSession(session) });
        }
        if (match[2] === 'review') {
          if (session.step !== STEPS.length) throw new AppError(409, 'INCOMPLETE', '모든 질문에 답한 뒤 PRD를 확정해 주세요.');
          if (typeof input.markdown !== 'string' || input.markdown.trim().length < 100 || input.markdown.length > 70000) throw new AppError(400, 'INVALID_DOCUMENT', 'PRD 내용을 확인해 주세요.');
          session.reviewed = true; session.markdown = enforceWorkshopContract(input.markdown); session.revision++;
          return send(res, 200, { session: publicSession(session) });
        }
      }
      if (url.pathname.startsWith('/api/')) throw new AppError(404, 'NOT_FOUND', '요청을 찾을 수 없어요.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root) || !mime[path.extname(file)] || url.pathname.split('/').some(s => s.startsWith('.'))) throw new AppError(404, 'NOT_FOUND', '파일을 찾을 수 없어요.');
      let content;
      try { content = await readFile(file); } catch { throw new AppError(404, 'NOT_FOUND', '파일을 찾을 수 없어요.'); }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' } });
    }
  });
  const cleanup = setInterval(clean, 30000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); });
  return { server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { provider, bedrockEnabled, region, modelId, port } = localConfig();
  const cli = provider === 'claude' || provider === 'codex';
  const modelLabel = cli ? CLI_LABELS[provider] : localConfig().modelLabel;
  const { server } = createApp({
    bedrockEnabled, modelLabel,
    coach: cli ? createCliCoach({ provider, model: modelId }) : bedrockEnabled ? createBedrockCoach({ region, modelId }) : undefined
  });
  server.listen(port, '127.0.0.1', () => console.log(`AI-DLC PRD Studio · http://127.0.0.1:${port} · Coach: ${bedrockEnabled ? modelLabel : 'disabled'}`));
}
