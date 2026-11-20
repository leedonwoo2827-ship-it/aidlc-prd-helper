// Local CLI login controls (Claude Code / Codex) shown in the top bar.
const $ = (s, parent = document) => parent.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(route, body) {
  const res = await fetch(route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || '요청을 처리하지 못했어요.');
  return data;
}

export function initCliAuth(config) {
  const name = config.cliAuth === 'codex' ? 'Codex' : 'Claude';
  const badge = $('.local-badge');
  badge.classList.add('cli-badge');
  badge.innerHTML = '<span class="status-dot"></span><span id="cli-account">확인 중…</span>';
  const guide = $('.top-actions [data-action="guide"]');
  const make = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'button button-quiet cli-button'; b.textContent = label; b.title = title;
    guide.before(b); return b;
  };
  const refreshButton = make('새로고침', `${name} 로그인 상태 다시 확인`);
  const loginButton = make('로그인', `${name} 계정으로 로그인`);
  const logoutButton = make('로그아웃', `${name} 로그아웃`);
  const dialog = document.createElement('dialog');
  dialog.className = 'cli-dialog';
  document.body.append(dialog);
  let state = { loggedIn: false };
  let poll = null;

  function paint() {
    $('.status-dot', badge).classList.toggle('off', !state.loggedIn);
    $('#cli-account').textContent = state.loggedIn
      ? `${name} · ${state.account || '로그인됨'}${state.plan ? ` (${state.plan})` : ''}`
      : `${name} · 로그인 필요`;
    logoutButton.disabled = !state.loggedIn;
    const coach = $('#coach-status');
    if (coach) coach.textContent = state.loggedIn ? `${config.model} · 연결됨` : `${name} 로그인이 필요해요 (오른쪽 위 로그인)`;
  }
  async function refresh() {
    refreshButton.disabled = true;
    try { state = await call('/api/auth/status'); paint(); }
    catch (error) { $('#cli-account').textContent = `${name} · 상태 확인 실패`; }
    finally { refreshButton.disabled = false; }
    return state;
  }
  function stopPolling() { clearInterval(poll); poll = null; }
  function closeDialog() { stopPolling(); if (dialog.open) dialog.close(); }

  function renderDialog(login, message = '') {
    const link = login.url ? `<a class="button button-quiet cli-link" href="${esc(login.url)}" target="_blank" rel="noopener noreferrer">로그인 페이지 다시 열기 ↗</a>` : '';
    const codeForm = login.needsCode ? `
      <form class="cli-code-form">
        <label for="cli-code">브라우저 화면에 <b>코드</b>가 표시되면 복사해서 붙여 넣으세요.</label>
        <div class="cli-code-row"><input id="cli-code" autocomplete="off" spellcheck="false" placeholder="코드 붙여넣기">
        <button class="button button-primary" type="submit">확인</button></div>
      </form>` : '';
    dialog.innerHTML = `<div class="dialog-content">
      <div class="dialog-top"><h2>${name} 로그인</h2></div>
      <p>브라우저에 ${name} 로그인 창이 열렸어요. 로그인하고 <b>승인</b>을 누르면 이 화면이 자동으로 바뀝니다.</p>
      <p class="cli-note">${name === 'Claude' ? '"Claude account with subscription"(구독 계정)으로 로그인하세요.' : 'ChatGPT 계정으로 로그인하세요.'} 창이 안 열렸다면 아래 버튼을 누르세요.</p>
      ${link}${codeForm}
      <p class="cli-message" role="status">${esc(message)}</p>
      <div class="cli-actions"><button class="button button-quiet" type="button" data-cli="cancel">취소</button></div>
    </div>`;
    $('[data-cli="cancel"]', dialog).onclick = async () => { closeDialog(); await call('/api/auth/cancel', {}).catch(() => {}); refresh(); };
    const form = $('.cli-code-form', dialog);
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const code = $('#cli-code', dialog).value.trim();
      if (!code) return;
      $('.cli-message', dialog).textContent = '코드를 확인하고 있어요…';
      try {
        const { login: next } = await call('/api/auth/code', { code });
        if (next.finished && !next.ok) $('.cli-message', dialog).textContent = '로그인하지 못했어요. 취소 후 다시 시도해 주세요.';
        await check();
      } catch (error) { $('.cli-message', dialog).textContent = error.message; }
    };
  }
  async function check() {
    const current = await refresh();
    if (current.loggedIn && (!current.login?.active)) { closeDialog(); return true; }
    if (current.login?.finished && !current.login.ok && dialog.open) {
      stopPolling();
      $('.cli-message', dialog).textContent = '로그인이 끝나지 않았어요. 취소 후 다시 시도해 주세요.';
    }
    return false;
  }

  refreshButton.onclick = refresh;
  loginButton.onclick = async () => {
    if (state.loggedIn && !confirm(`이미 ${state.account || name} 계정으로 로그인되어 있어요.\n다른 계정으로 다시 로그인할까요?`)) return;
    loginButton.disabled = true;
    try {
      const { login } = await call('/api/auth/login', {});
      renderDialog(login, login.url ? '' : '로그인 창을 준비하고 있어요…');
      dialog.showModal();
      stopPolling();
      poll = setInterval(check, 3000);
    } catch (error) { alert(error.message); }
    finally { loginButton.disabled = false; }
  };
  logoutButton.onclick = async () => {
    if (!confirm(`${name}에서 로그아웃할까요?\n로그아웃하면 다시 로그인하기 전까지 코치를 쓸 수 없어요.`)) return;
    logoutButton.disabled = true;
    try { state = { ...(await call('/api/auth/logout', {})) }; paint(); }
    catch (error) { alert(error.message); }
    finally { refresh(); }
  };
  dialog.addEventListener('cancel', () => stopPolling());
  refresh();
}
