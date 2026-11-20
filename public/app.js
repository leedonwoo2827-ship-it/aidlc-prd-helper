import { STEPS, EXAMPLES, EXAMPLE_ANSWERS, draftMarkdown, sectionsFromAnswers } from './shared.js';
import { CONTRACT_MARKDOWN, enforceWorkshopContract } from './workshop.js';
import { configureAuth, authHeaders, payloadHeaders, handleAuthError } from './auth.js';
const $ = (s, parent = document) => parent.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  spark: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z"/>',
  document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3M12 16h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  'arrow-up-right': '<path d="M6 18 18 6M7 6h11v11"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 9v10M3 8l9 4 9-4M7 5.8l9 5"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/><path d="M8 10h7M8 14h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 22V3c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5ZM13 20h7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M5 3v7a3 3 0 0 0 6 0V3M8 3v18M17 3v8h3M20 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  book: '<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15"/>',
  home: '<path d="m3 10 9-7 9 7v11H3V10ZM9 21v-8h6v8"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 8 4 4-4 4M13 16h5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.document}</svg>`;
function hydrateIcons(parent = document) {
  parent.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
let session = null;
let token = null; // Deliberately memory-only: every tab/reload gets a distinct conversation.
let busy = false;
let view = 'preview';
let editing = false;
let customMarkdown = null;
let pendingRequest = null;
let toastTimer;
let config = { bedrockEnabled: false };
const modelLabel = () => config.model || 'Bedrock';
let sessionGeneration = 0;
let activeAnswerController = null;
const currentMarkdown = () => enforceWorkshopContract(customMarkdown ?? session?.markdown ?? draftMarkdown({}))
  .replace(/- 문서 상태: [^\n]*/, `- 문서 상태: ${session?.reviewed ? '사용자 검토 완료' : '검토 전 초안'}`);

function showError(message) { $('#error').textContent = message; $('#error').hidden = !message; }
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}
async function api(route, { method = 'GET', body } = {}) {
  const auth = route === '/api/config' ? {} : await authHeaders();
  const encoded = body ? JSON.stringify(body) : undefined;
  const response = await fetch(route, {
    method, cache: 'no-store',
    headers: { ...auth, ...(await payloadHeaders(encoded)), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Session-Token': token } : {}) },
    ...(body ? { body: encoded } : {})
  });
  const data = await response.json();
  if (!response.ok) { handleAuthError(data.error?.code); throw Object.assign(new Error(data.error?.message || '요청을 처리하지 못했어요.'), { code: data.error?.code }); }
  return data;
}
async function streamAnswer(route, body) {
  const encoded = JSON.stringify(body);
  activeAnswerController = new AbortController();
  const pending = document.createElement('div');
  pending.className = 'message message-user pending-message';
  pending.innerHTML = `<div class="user-bubble">${esc(body.text)}</div>`;
  const bubble = document.createElement('div');
  bubble.className = 'message pending-message streaming-message';
  bubble.setAttribute('aria-live', 'off');
  bubble.innerHTML = '<div class="assistant-label">PRD 코치 <span>응답 작성 중</span></div><p class="assistant-reflection"></p><p class="assistant-question"></p>';
  $('#thinking')?.remove();
  $('#messages').append(pending, bubble);
  $('#suggestions').hidden = true;
  scrollChat();
  const response = await fetch(route, {
    method: 'POST', cache: 'no-store',
    headers: { ...(await authHeaders()), ...(await payloadHeaders(encoded)), 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Session-Token': token },
    body: encoded, signal: activeAnswerController.signal
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json();
    if (!response.ok) { handleAuthError(data.error?.code); throw Object.assign(new Error(data.error?.message || '응답을 받지 못했어요.'), { code: data.error?.code }); }
    return data; // An idempotent replay may already be complete.
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const type = frame.split('\n').find(l => l.startsWith('event: '))?.slice(7);
        const data = JSON.parse(frame.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n'));
        if (type === 'delta' && ['reflection', 'question'].includes(data.field)) {
          const scroll = $('#chat-scroll');
          const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
          $(`.assistant-${data.field}`, bubble).textContent = data.text;
          if (nearBottom) scrollChat();
        } else if (type === 'complete') result = data;
        else if (type === 'failure') { handleAuthError(data.error.code); throw Object.assign(new Error(data.error.message), { code: data.error.code }); }
      }
      if (done) break;
    }
  } finally { await reader.cancel(); }
  if (!result) throw new Error('응답 연결이 중단됐어요. 입력은 유지했으니 다시 보내 주세요.');
  return result;
}
function setBusy(value) {
  busy = value; $('#answer').disabled = value;
  $('[data-action="new"]').disabled = value;
  $('#send-button').disabled = value || $('#answer').value.trim().length < 2 || session?.step === STEPS.length;
  $('#send-button').innerHTML = value ? '<span class="spinner"></span>답변 정리 중' : `${session ? '답변 보내기' : '대화 시작하기'}${icon('arrow')}`;
  $('#suggestions').querySelectorAll('button').forEach(b => { b.disabled = value; });
  $('#steps').querySelectorAll('button').forEach((b, i) => { b.disabled = value || !session || i >= session.step; });
  $('#copy-button').disabled = value || !session?.step;
  $('#download-button').disabled = value || !session?.step;
  $('#edit-button').disabled = value || (session?.step ?? 0) < 7;
  const thinking = $('#thinking');
  if (value && !thinking) {
    const el = document.createElement('div'); el.id = 'thinking'; el.className = 'thinking';
    el.innerHTML = '<span class="spinner"></span><span>답변을 읽고, 다음 질문을 준비하고 있어요.</span>'; $('#messages').append(el); scrollChat();
  } else if (!value) thinking?.remove();
}
function scrollChat() { requestAnimationFrame(() => { $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight; }); }
function renderSteps() {
  const index = session?.step ?? 0;
  $('#steps').innerHTML = STEPS.map((step, i) =>
    `<button class="step ${i < index ? 'complete' : i === index ? 'active' : ''}" data-step="${i}" ${i >= index || busy ? 'disabled' : ''} ${i === index ? 'aria-current="step"' : ''} aria-label="${i + 1}. ${step.label}${i < index ? ', 완료, 수정하기' : ''}"><span class="step-num">${i < index ? icon('check') : i + 1}</span><span>${esc(step.short)}</span></button>${i < 6 ? `<span class="step-chevron">${icon('chevron')}</span>` : ''}`).join('');
  $('#phase-label').textContent = session?.reviewed ? 'PRD 검토 완료' : index === 7 ? '마지막으로 문서를 확인해요' : session ? `${index + 1} / 7 · ${STEPS[index].label}` : '아이디어에서 시작해요';
  $('#mobile-count').textContent = `${index}/7`;
}
function renderMessages() {
  $('#welcome').hidden = !!session;
  if (!session) { $('#messages').innerHTML = ''; return; }
  $('#messages').innerHTML =
    `<div class="session-context"><span>로컬 MVP · 단일 유닛</span><span>${esc(modelLabel())}</span></div>` +
    session.messages.map(m => m.role === 'user'
      ? `<div class="message message-user"><div class="user-bubble">${esc(m.text)}</div></div>`
      : `<div class="message"><div class="assistant-label">PRD 코치 <span>${m.step < 7 ? `${m.step + 1} / 7 · ${esc(STEPS[m.step].label)}` : '답변 정리 완료'}</span></div><p class="assistant-reflection">${esc(m.text)}</p>${m.step < 7 ? `<p class="assistant-question">${esc(m.question)}</p>` : ''}</div>`).join('');
  $('#review-card').hidden = session.step < STEPS.length;
  const reviewButton = $('[data-action="review"]');
  reviewButton.disabled = session.reviewed;
  reviewButton.innerHTML = `${icon('check')}${session.reviewed ? '내용 검토 완료' : '내용 확인하고 확정하기'}`;
  if (session.step < 7) $('#input-label').textContent = STEPS[session.step].label;
  else $('#input-label').textContent = '답변이 모두 모였어요';
  $('#answer').placeholder = session.step < 7 ? STEPS[session.step].hint : 'PRD를 검토한 뒤 내려받아 주세요.';
  $('#answer-form').hidden = session.step === 7;
  $('#coach-status').textContent = `${modelLabel()} · 대화 중`;
}
function renderSuggestions() {
  const suggestions = session?.suggestions ?? [];
  $('#suggestions').hidden = !suggestions.length || session?.step === 7;
  $('#suggestions').innerHTML = `<div class="suggestion-label">${icon('spark')}이렇게 답해 볼까요 <span>· 선택 후 수정할 수 있어요</span></div><div class="suggestion-buttons">${suggestions.map((s, i) => `<button class="suggestion-chip" type="button" data-suggestion="${i}" ${busy ? 'disabled' : ''}>${esc(s)}</button>`).join('')}</div>`;
}
// No HTML from the model or user is inserted as markup. This deliberately small Markdown renderer
// escapes first and supports only headings, lists, quotations and paragraphs.
function markdownHtml(text) {
  const inline = line => esc(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let listOpen = false;
  const output = [];
  for (const line of text.split('\n')) {
    const list = /^- (.*)$/.exec(line);
    if (list) { if (!listOpen) output.push('<ul>'); listOpen = true; output.push(`<li>${inline(list[1])}</li>`); continue; }
    if (listOpen) { output.push('</ul>'); listOpen = false; }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) { const level = Math.min(heading[1].length + 1, 4); output.push(`<h${level}>${esc(heading[2])}</h${level}>`); }
    else if (line.startsWith('> ')) output.push(`<blockquote>${esc(line.slice(2))}</blockquote>`);
    else if (line.trim() && !/^<!-- workshop-contract:(start|end) -->$/.test(line)) output.push(`<p>${inline(line)}</p>`);
  }
  if (listOpen) output.push('</ul>');
  return `<div class="rendered-markdown">${output.join('')}</div>`;
}
function renderDocument() {
  const count = session?.step ?? 0;
  const answers = session?.answers ?? {};
  $('#document-status').textContent = editing ? '수정한 내용이 내려받는 문서에 반영돼요' : session?.reviewed ? '검토를 마친 문서예요' : count ? '대화에서 정리한 내용을 담았어요' : '대화하며 한 장씩 채워져요';
  const badge = $('#document-state');
  badge.textContent = editing ? '직접 수정 중' : session?.reviewed ? '검토 완료' : count === 7 ? '검토 전 초안' : count ? `${count}/7 작성` : '작성 전';
  badge.classList.toggle('ready', !!session?.reviewed);
  $('#document-progress').textContent = `${count} / 7`;
  $('#copy-button').disabled = count === 0 || busy;
  $('#download-button').disabled = count === 0 || busy;
  $('#edit-button').disabled = count < 7 || busy;
  $('#edit-button').innerHTML = icon(editing ? 'check' : 'edit');
  $('#edit-button').setAttribute('aria-label', editing ? 'PRD 수정 마치기' : 'PRD 직접 수정');
  $('#download-button').innerHTML = `${icon('download')}<span>${session?.reviewed ? 'PRD 내려받기' : '초안 내려받기'}</span>`;
  $('#filename').textContent = session?.reviewed ? 'prd.md' : 'prd-draft.md';
  if (customMarkdown || session?.step === 7) $('#document-content').innerHTML = markdownHtml(currentMarkdown());
  else $('#document-content').innerHTML = `
    <div class="paper-head"><span>PRODUCT REQUIREMENTS DOCUMENT</span>${icon('document')}</div>
    <h2>${answers.idea ? '워크숍 MVP 요구사항' : '우리 팀의 다음 제품'}</h2>
    <p class="paper-subtitle">${count ? '대화에서 정리한 워크숍 요구사항' : '아이디어를 적으면 첫 문장이 채워집니다.'}</p>
    <div class="paper-meta"><span>로컬 빌드·실행 MVP</span><span>단일 Unit of Work</span></div>
    ${sectionsFromAnswers(answers).map((s, i) => `<section class="prd-section"><h3><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</h3>${s.value ? `<p>${esc(s.value)}</p>${answers[STEPS[i].id]?.uncertain ? `<span class="uncertain-note">${answers[STEPS[i].id]?.deferred ? 'AI-DLC 진행 중 구체화' : '확인 필요'}</span>` : ''}` : `<p class="awaiting">${i === 0 ? '대화에서 제품 아이디어를 들려주세요' : '대화하며 함께 정할 내용이에요'}</p><div class="awaiting-line"></div>${i < 3 ? '<div class="awaiting-line short"></div>' : ''}`}</section>`).join('')}
    <details class="contract-preview"><summary>공통 원칙과 기본 제외 항목</summary>${markdownHtml(CONTRACT_MARKDOWN)}</details>
    <div class="paper-note">${icon('lock')}확인하지 않은 내용은 확정하지 않고, 확인 필요로 남겨요.</div>`;
  $('#document-content').hidden = view === 'markdown';
  $('#markdown-editor').hidden = view !== 'markdown';
  if (document.activeElement !== $('#markdown-editor')) $('#markdown-editor').value = currentMarkdown();
  $('#markdown-editor').readOnly = !editing;
  $('[data-action="preview"]').classList.toggle('active', view === 'preview');
  $('[data-action="markdown"]').classList.toggle('active', view === 'markdown');
  $('[data-action="preview"]').setAttribute('aria-pressed', view === 'preview');
  $('[data-action="markdown"]').setAttribute('aria-pressed', view === 'markdown');
}
function render() { document.body.classList.toggle('has-session', !!session); renderSteps(); renderMessages(); renderSuggestions(); renderDocument(); }
function fillInput(text) {
  $('#answer').value = text; $('#answer').dispatchEvent(new Event('input')); $('#answer').focus();
  $('#answer-form').scrollIntoView({ block: 'nearest' });
}
function openDialog(html) { $('#dialog-body').innerHTML = html; $('#dialog').showModal(); }
function dialogTop(title) { return `<div class="dialog-top"><h2>${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="닫기">${icon('close')}</button></div>`; }
function closeDialog() { $('#dialog').close(); }
function showGuide() {
  openDialog(`<div class="dialog-content">${dialogTop('워크숍 전에, 일곱 번의 대화')}
    <p>제품 아이디어가 막연해도 시작할 수 있어요. 코치와 하나씩 정리하고, 이번 워크숍에서 만들 범위를 정하세요.</p>
    <div class="dialog-list">
      <div><span class="dialog-number">1</span><div><b>아이디어를 한두 문장으로</b>해결하고 싶은 불편함을 적어 주세요. 목표는 로컬에서 빌드·실행하는 단일 유닛 MVP예요.</div></div>
      <div><span class="dialog-number">2</span><div><b>답변에 이어지는 질문과 제안</b>코치가 답변을 되짚고 다음 질문을 해요. 추천 말풍선은 입력창에 넣은 뒤 수정할 수 있어요.</div></div>
      <div><span class="dialog-number">3</span><div><b>범위를 확인하고 PRD 내려받기</b>미정 항목은 AI-DLC에서 구체화하도록 남겨요. 기본 제외 항목과 단일 유닛 원칙은 모든 PRD에 유지됩니다.</div></div>
    </div><p class="dialog-note">${config.requiresAuth ? '공유 워크숍 계정으로 로그인해도 대화는 이 로그인과 탭에만 연결돼요. 계정은 정해진 종료 시각에 사용할 수 없게 됩니다.' : '로컬에서는 로그인 없이 탭마다 독립된 대화를 시작해요.'} 이 탭을 닫거나 새로고침하면 다시 연결할 수 없어요. 먼저 문서를 내려받아 주세요.</p>
    <div class="dialog-actions"><button class="button button-primary" data-action="close-dialog">대화로 돌아가기${icon('arrow')}</button></div></div>`);
}
function showSample() {
  const answers = Object.fromEntries(STEPS.map((s, i) => [s.id, { raw: EXAMPLE_ANSWERS[i], value: EXAMPLE_ANSWERS[i], uncertain: false }]));
  openDialog(`<div class="dialog-content">${dialogTop('이런 PRD를 만들 수 있어요')}<span class="sample-badge">가상의 카페 재고 관리 · 문서 예시</span><div class="sample-document paper">${markdownHtml(draftMarkdown(answers, { mode: 'demo', createdAt: '예시 문서', productDoc: { title:'카페 재고 관리 MVP', functionalRequirements:[{text:'재료 목록 조회, 입출고 수량 기록, 현재 재고와 이력 확인.',sources:[4]}], nonFunctionalRequirements:[], acceptanceCriteria:[{text:EXAMPLE_ANSWERS[6],sources:[7]}], outOfScope:[], openQuestions:[] } }))}</div><div class="dialog-actions"><button class="button button-primary" data-action="close-dialog">내 아이디어로 돌아가기${icon('arrow')}</button></div></div>`);
}
function switchMobile(showDoc) {
  $('.workbench').classList.toggle('show-document', showDoc);
  $('#chat-tab').setAttribute('aria-selected', !showDoc); $('#doc-tab').setAttribute('aria-selected', showDoc);
}
async function newConversation() {
  if (session) await api(`/api/sessions/${session.id}`, { method: 'DELETE' });
  session = null; token = null; customMarkdown = null; pendingRequest = null; editing = false; view = 'preview';
  sessionGeneration++;
  closeDialog(); $('#answer-form').hidden = false; $('#review-card').hidden = true; $('#answer').value = '';
  $('#char-count').textContent = '0'; $('#input-label').textContent = '만들고 싶은 제품이나 해결할 문제';
  $('#answer').placeholder = '예: 매번 엑셀로 정리하는 재고를 쉽게 관리하고 싶어요.';
  $('#coach-status').textContent = `${modelLabel()} · 사용 설정됨`; showError(''); render(); setBusy(false); switchMobile(false);
}

$('#examples').innerHTML = EXAMPLES.map((e, i) => `<button class="example-chip" data-example="${i}">${icon(e.icon)}<span>${esc(e.label)}</span><small>${esc(e.industry)}</small></button>`).join('');
hydrateIcons(); render();
$('#answer').addEventListener('input', () => {
  $('#char-count').textContent = $('#answer').value.length;
  $('#send-button').disabled = busy || $('#answer').value.trim().length < 2;
  showError('');
});
$('#answer').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('#send-button').disabled) $('#answer-form').requestSubmit(); }
});
$('#markdown-editor').addEventListener('input', () => {
  if (!editing) return;
  customMarkdown = $('#markdown-editor').value;
  // A local edit invalidates the user's previous approval until re-confirmed.
  if (session) session.reviewed = false;
  renderMessages(); renderDocument();
});
$('#answer-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy || !$('#answer').value.trim()) return;
  const generation = sessionGeneration;
  const text = $('#answer').value.trim(); showError(''); setBusy(true);
  try {
    if (!session) {
      const result = await api('/api/sessions', { method: 'POST', body: {} });
      if (generation !== sessionGeneration) return;
      session = result.session; token = result.token; render(); setBusy(true);
    }
    if (!pendingRequest || pendingRequest.text !== text || pendingRequest.revision !== session.revision) pendingRequest = { text, revision: session.revision, requestId: crypto.randomUUID() };
    const result = await streamAnswer(`/api/sessions/${session.id}/answers`, pendingRequest);
    if (generation !== sessionGeneration) return;
    session = result.session; pendingRequest = null; customMarkdown = null;
    $('#answer').value = ''; $('#char-count').textContent = '0'; render(); scrollChat();
    if (session.step === 7) toast('PRD 초안이 모였어요. 내용을 확인해 주세요.');
  } catch (error) {
    if (generation !== sessionGeneration) return;
    document.querySelectorAll('.pending-message').forEach(el => el.remove());
    renderSuggestions();
    showError(error.message);
    if (error.code === 'STALE_REVISION' && session) {
      try { session = (await api(`/api/sessions/${session.id}`)).session; render(); pendingRequest = null; } catch {}
    }
  } finally { if (generation === sessionGeneration) { activeAnswerController = null; setBusy(false); if (session?.step !== 7) $('#answer').focus(); } }
});
document.addEventListener('click', async e => {
  const button = e.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.example !== undefined) return fillInput(EXAMPLES[Number(button.dataset.example)].text);
  if (button.dataset.suggestion !== undefined) return fillInput(session.suggestions[Number(button.dataset.suggestion)]);
  if (button.dataset.step !== undefined) {
    const step = Number(button.dataset.step);
    if (busy || !session?.answers[STEPS[step].id]) return;
    return openDialog(`<div class="dialog-content">${dialogTop(`${STEPS[step].label} 수정`)}<p>이 답변을 바꾸면 이후 답변을 다시 확인해요. 수정 전 문서를 보관하려면 먼저 초안을 내려받아 주세요.</p><label for="edit-answer" class="small-label">수정할 답변</label><textarea id="edit-answer" class="edit-answer" maxlength="2000">${esc(session.answers[STEPS[step].id].raw)}</textarea><div class="dialog-actions"><button class="button button-quiet" data-action="close-dialog">취소</button><button class="button button-primary" data-action="rewind" data-index="${step}">이 단계부터 다시 답하기${icon('arrow')}</button></div></div>`);
  }
  try {
    switch (button.dataset.action) {
      case 'guide': showGuide(); break;
      case 'boundaries': openDialog(`<div class="dialog-content">${dialogTop('이번 워크숍의 공통 범위')}${markdownHtml(CONTRACT_MARKDOWN)}<div class="dialog-actions"><button class="button button-primary" data-action="close-dialog">확인했어요</button></div></div>`); break;
      case 'sample': showSample(); break;
      case 'close-dialog': closeDialog(); break;
      case 'mobile-chat': switchMobile(false); break;
      case 'mobile-doc': switchMobile(true); break;
      case 'preview': view = 'preview'; editing = false; renderDocument(); break;
      case 'markdown': view = 'markdown'; renderDocument(); break;
      case 'edit':
        editing = !editing; view = editing ? 'markdown' : 'preview';
        renderDocument(); if (editing) $('#markdown-editor').focus(); else toast('수정한 초안을 반영했어요. 내용을 확인하고 확정해 주세요.'); break;
      case 'copy':
        await navigator.clipboard.writeText(currentMarkdown()); toast('PRD Markdown을 복사했어요.'); break;
      case 'download': {
        const text = currentMarkdown();
        const blob = new Blob(['\uFEFF', text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = session.reviewed ? 'prd.md' : 'prd-draft.md';
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(session.reviewed ? '검토한 PRD를 내려받았어요.' : '검토 전 초안을 내려받았어요.'); break;
      }
      case 'review': {
        if (busy || session?.step !== 7) break;
        button.disabled = true;
        let markdown = currentMarkdown();
        markdown = markdown.replace('- 문서 상태: 검토 전 초안', '- 문서 상태: 사용자 검토 완료');
        const result = await api(`/api/sessions/${session.id}/review`, { method: 'POST', body: { revision: session.revision, markdown } });
        session = result.session; customMarkdown = session.markdown; editing = false; view = 'preview'; render();
        toast('PRD를 확정했어요. Markdown으로 내려받을 수 있어요.'); switchMobile(true); break;
      }
      case 'new':
        if (!session) { fillInput(''); break; }
        openDialog(`<div class="dialog-content">${dialogTop('새로운 아이디어로 시작하기')}<p>현재 대화는 종료돼요. 필요한 PRD는 먼저 내려받아 주세요.</p><div class="dialog-actions"><button class="button button-quiet" data-action="close-dialog">대화 유지</button><button class="button button-primary" data-action="confirm-new">새 대화 시작</button></div></div>`); break;
      case 'confirm-new': await newConversation(); break;
      case 'rewind': {
        const text = $('#edit-answer').value.trim();
        if (text.length < 2) { $('#edit-answer').focus(); toast('수정할 답변을 2자 이상 적어 주세요.'); break; }
        const result = await api(`/api/sessions/${session.id}/rewind`, { method: 'POST', body: { revision: session.revision, step: Number(button.dataset.index) } });
        session = result.session; customMarkdown = null; pendingRequest = null; editing = false; view = 'preview';
        closeDialog(); render(); switchMobile(false); fillInput(text); setBusy(false); scrollChat(); break;
      }
    }
  } catch (error) { toast(error.message); if (session) render(); }
});
$('#dialog').addEventListener('click', e => { if (e.target === $('#dialog')) closeDialog(); });
window.addEventListener('beforeunload', e => { if (session?.step > 0 && !session.reviewed) { e.preventDefault(); e.returnValue = ''; } });
try {
  config = await api('/api/config');
  configureAuth(config, () => {
    sessionGeneration++; activeAnswerController?.abort(); activeAnswerController = null;
    session = null; token = null; customMarkdown = null; pendingRequest = null; editing = false; view = 'preview';
    $('#answer').value = ''; $('#char-count').textContent = '0'; $('#answer-form').hidden = false; $('#review-card').hidden = true;
    $('#input-label').textContent = '만들고 싶은 제품이나 해결할 문제';
    $('#answer').placeholder = '예: 매번 엑셀로 정리하는 재고를 쉽게 관리하고 싶어요.';
    render(); setBusy(false); switchMobile(false);
  });
  $('#coach-status').textContent = config.bedrockEnabled ? `${modelLabel()} · 사용 설정됨` : 'Bedrock 연결이 필요해요';
  if (!config.bedrockEnabled) showError('진행자에게 Bedrock 연결 상태를 확인해 주세요.');
} catch { showError('로컬 서버에 연결하지 못했어요. 서버를 실행한 뒤 새로고침해 주세요.'); }
