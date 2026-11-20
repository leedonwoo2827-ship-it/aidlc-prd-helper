import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoIdentityProviderClient, AdminDisableUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudStore } from './cloud-store.mjs';
import { createBedrockCoach } from './bedrock.mjs';
import { AppError, validateText, validateCoach, validateProductDoc, publicSession } from './engine.mjs';
import { STEPS } from '../public/shared.js';
import { CONTRACT_VERSION, enforceWorkshopContract, isDeferred, withDeferOption } from '../public/workshop.js';
import { cloudConfig } from './config.mjs';

const runtimeConfig = cloudConfig();
const digest = value => createHash('sha256').update(value).digest('hex');
const store = new CloudStore();
const verifier = CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID, tokenUse: 'id', clientId: process.env.CLIENT_ID });
const coach = createBedrockCoach({ region: process.env.AWS_REGION, modelId: process.env.BEDROCK_MODEL_ID });

export function checkSessionOwner(session, user, token) {
  const loginId = user.origin_jti || user.jti;
  if (!session || !loginId || session.ownerSub !== user.sub || session.loginId !== loginId || typeof token !== 'string')
    throw new AppError(404, 'SESSION_NOT_FOUND', '이 로그인 세션의 대화를 찾을 수 없어요.');
  const expected = Buffer.from(session.tokenHash, 'hex'), actual = Buffer.from(digest(token), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || session.expiresAt <= Math.floor(Date.now() / 1000))
    throw new AppError(404, 'SESSION_NOT_FOUND', '이 로그인 세션의 대화를 찾을 수 없어요.');
}

export const handler = awslambda.streamifyResponse(async (event, rawStream) => {
  let output;
  const open = (status, type = 'application/json; charset=utf-8') => {
    output = awslambda.HttpResponseStream.from(rawStream, {
      statusCode: status,
      headers: { 'Content-Type': type, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
        ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Cognito workshop"' } : {}) }
    });
  };
  const json = async (status, data) => { open(status); output.write(JSON.stringify(data)); output.end(); await finished(output); };
  const emit = (type, data) => { if (!output.destroyed) output.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  let held = null;
  try {
    // Scheduler invokes the function with IAM; HTTP request bodies cannot become top-level events.
    if (event.source === 'workshop-expiry' && !event.requestContext) {
      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      await ddb.send(new UpdateCommand({ TableName: process.env.TABLE_NAME, Key: { pk: `WORKSHOP#${event.sub}` }, UpdateExpression: 'SET enabled = :off', ExpressionAttributeValues: { ':off': false } }));
      const cognito = new CognitoIdentityProviderClient({});
      for (const Command of [AdminDisableUserCommand, AdminDeleteUserCommand])
        await cognito.send(new Command({ UserPoolId: process.env.USER_POOL_ID, Username: event.username })).catch(e => { if (e.name !== 'UserNotFoundException') throw e; });
      return await json(200, { closed: true });
    }
    const method = event.requestContext?.http?.method;
    const route = event.rawPath;
    const headers = event.headers || {};
    if (route === '/api/config' && method === 'GET') return await json(200, {
      local: false, requiresAuth: true, bedrockEnabled: true, model: runtimeConfig.modelLabel,
      region: process.env.AWS_REGION, userPoolId: process.env.USER_POOL_ID, clientId: process.env.CLIENT_ID,
      persistence: 'workshop', sessionTtlHours: null
    });
    const jwt = headers['x-app-token'];
    if (!jwt) throw new AppError(401, 'LOGIN_REQUIRED', '워크숍 계정으로 로그인해 주세요.');
    let user;
    try { user = await verifier.verify(jwt); } catch { throw new AppError(401, 'TOKEN_EXPIRED', '로그인 유효기간이 지났어요. 다시 로그인해 주세요.'); }
    if (!user.origin_jti && !user.jti) throw new AppError(401, 'LOGIN_INSTANCE_MISSING', '이 로그인 세션을 확인하지 못했어요. 다시 로그인해 주세요.');
    const workshop = await store.workshop(user.sub);
    if (headers.origin && headers.origin !== process.env.PUBLIC_ORIGIN)
      throw new AppError(403, 'INVALID_ORIGIN', '허용되지 않은 요청 출처입니다.');
    if (route === '/api/me' && method === 'GET') return await json(200, { username: user['cognito:username'], endsAt: workshop.endsAt });
    let input = {};
    if (method === 'POST') {
      if (!headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.');
      const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(body) > 100000) throw new AppError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
      try { input = JSON.parse(body); } catch { throw new AppError(400, 'INVALID_JSON', '요청을 읽지 못했어요.'); }
    }
    if (route === '/api/sessions' && method === 'POST') {
      const token = randomBytes(32).toString('base64url'), id = randomUUID();
      const session = {
        pk: `SESSION#${id}`, id, ownerSub: user.sub, loginId: user.origin_jti || user.jti, tokenHash: digest(token),
        mode: 'bedrock', contractVersion: CONTRACT_VERSION, answers: {}, messages: [], step: 0, revision: 0,
        reviewed: false, createdAt: new Date().toISOString(), expiresAt: Math.floor(workshop.endsAt / 1000),
        attempts: 0, question: STEPS[0].prompt, suggestions: withDeferOption([]), receipts: []
      };
      await store.create(session);
      return await json(201, { session: publicSession(session), token });
    }
    const match = route?.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(answers|rewind|review))?$/);
    if (!match) throw new AppError(404, 'NOT_FOUND', '요청을 찾을 수 없어요.');
    let session = await store.get(`SESSION#${match[1]}`);
    checkSessionOwner(session, user, headers['x-session-token']);
    if (method === 'GET' && !match[2]) return await json(200, { session: publicSession(session) });
    if (method === 'DELETE' && !match[2]) { await store.remove(session); return await json(200, { deleted: true }); }
    if (method !== 'POST' || !match[2]) throw new AppError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.');
    const action = match[2];
    let text, fingerprint;
    if (action === 'answers') {
      text = validateText(input.text);
      if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new AppError(400, 'REQUEST_ID', '요청 ID가 필요합니다.');
      fingerprint = digest(JSON.stringify({ text: input.text, revision: input.revision }));
      const receipt = session.receipts.find(r => r.id === input.requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new AppError(409, 'REQUEST_REUSED', '요청 ID가 다른 답변에 재사용됐어요.');
        return await json(200, { session: publicSession(session), accepted: receipt.accepted });
      }
      if (session.step >= 7) throw new AppError(409, 'COMPLETE', 'PRD 초안을 검토해 주세요.');
    }
    if (session.revision !== input.revision) throw new AppError(409, 'STALE_REVISION', '대화 상태가 변경됐어요. 다시 확인해 주세요.');
    const requestId = input.requestId || randomUUID();
    session = await store.acquire(session, requestId, input.revision);
    held = { pk: session.pk, requestId };
    if (action === 'rewind') {
      if (!Number.isInteger(input.step) || input.step < 0 || input.step >= session.step) throw new AppError(400, 'INVALID_STEP', '수정할 완료 단계를 선택해 주세요.');
      for (let i = input.step; i < 7; i++) delete session.answers[STEPS[i].id];
      session.messages = session.messages.filter(m => m.role === 'user' ? m.step < input.step : m.step <= input.step);
      session.step = input.step; session.question = STEPS[input.step].prompt; session.suggestions = withDeferOption([]);
      session.productDoc = null; session.markdown = undefined; session.reviewed = false; session.receipts = [];
    } else if (action === 'review') {
      if (session.step !== 7) throw new AppError(409, 'INCOMPLETE', '모든 질문에 답한 뒤 PRD를 확정해 주세요.');
      if (typeof input.markdown !== 'string' || input.markdown.trim().length < 100 || input.markdown.length > 70000) throw new AppError(400, 'INVALID_DOCUMENT', 'PRD 내용을 확인해 주세요.');
      session.markdown = enforceWorkshopContract(input.markdown); session.reviewed = true;
    } else {
      await store.spend(user.sub);
      const wantsStream = (headers.accept || '').includes('text/event-stream');
      const controller = new AbortController();
      if (wantsStream) {
        open(200, 'text/event-stream; charset=utf-8');
        output.on('close', () => { if (!output.writableFinished) controller.abort(); });
        emit('status', { message: '답변을 읽고 있어요.' });
      }
      const reply = validateCoach(await coach({
        session: { answers: session.answers, question: session.question }, text, step: session.step, signal: controller.signal,
        ...(wantsStream ? { onDelta: data => {
          if (Date.now() >= workshop.endsAt) { controller.abort(); return; }
          emit('delta', data);
        } } : {})
      }), text);
      if (controller.signal.aborted) throw new AppError(499, 'CLIENT_DISCONNECTED', '연결이 종료되어 답변을 반영하지 않았어요.');
      await store.workshop(user.sub); // Expiry/revocation also gates an in-flight answer's commit.
      const step = session.step;
      const deferred = isDeferred(text) || reply.deferred === true;
      const answers = reply.accepted ? { ...session.answers, [STEPS[step].id]: {
        raw: text, value: deferred ? 'AI-DLC를 진행하면서 구체화할 예정.' : reply.summary, uncertain: reply.uncertain || deferred, deferred
      } } : session.answers;
      session.productDoc = reply.accepted && step === 6 ? validateProductDoc(reply.document, answers) : null;
      session.messages.push({ role: 'user', text, step, id: randomUUID() });
      session.messages.push({ role: 'assistant', text: reply.reflection, question: reply.question, step: reply.accepted ? step + 1 : step, id: randomUUID() });
      if (reply.accepted) { session.answers = answers; session.step++; }
      session.question = reply.question; session.suggestions = withDeferOption(reply.suggestions, session.step === 7);
      session.reviewed = false; session.markdown = undefined;
      session.receipts.push({ id: requestId, fingerprint, accepted: reply.accepted });
      session.revision++;
      await store.commit(session, requestId, input.revision); held = null;
      const result = { session: publicSession(session), accepted: reply.accepted };
      if (wantsStream) { emit('complete', result); output.end(); await finished(output); return; }
      return await json(200, result);
    }
    session.revision++;
    await store.workshop(user.sub);
    await store.commit(session, requestId, input.revision); held = null;
    return await json(200, { session: publicSession(session) });
  } catch (error) {
    const payload = { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '요청을 처리하지 못했어요. 잠시 후 다시 보내 주세요.' } };
    if (!error.status) console.error(JSON.stringify({ event: 'request_error', name: error.name, message: error.message?.slice(0, 300) }));
    if (output) { emit('failure', payload); output.end(); await finished(output).catch(() => {}); }
    else await json(error.status || 500, payload);
  } finally {
    if (held) await store.release(held.pk, held.requestId).catch(e => console.error(JSON.stringify({ event: 'lock_release_error', name: e.name })));
  }
});
