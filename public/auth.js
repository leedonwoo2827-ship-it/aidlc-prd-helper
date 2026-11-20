let configuration = null;
let idToken = null;
let refreshToken = null;
let refreshPending = null;
let expirationTimer = null;
let onSignedOut = () => {};
const $ = selector => document.querySelector(selector);
function payload(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part));
}
async function cognito(flow, parameters) {
  const response = await fetch(`https://cognito-idp.${configuration.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ ClientId: configuration.clientId, AuthFlow: flow, AuthParameters: parameters })
  });
  const body = await response.json();
  if (!response.ok || !body.AuthenticationResult) throw new Error('계정이나 비밀번호를 확인해 주세요. 이용 기간이 끝난 계정은 진행자에게 문의해 주세요.');
  return body.AuthenticationResult;
}
function showLogin(message = '') {
  $('#login-screen').hidden = false;
  $('.shell').inert = true;
  $('#login-error').textContent = message;
  $('#login-error').hidden = !message;
  $('#logout-button').hidden = true;
  $('#login-username').focus();
}
export function signOut(message = '') {
  idToken = null; refreshToken = null;
  clearTimeout(expirationTimer);
  onSignedOut();
  showLogin(message);
}
export async function authHeaders() {
  if (!configuration?.requiresAuth) return {};
  if (!idToken) throw new Error('워크숍 계정으로 로그인해 주세요.');
  if (payload(idToken).exp * 1000 < Date.now() + 60000) {
    if (!refreshPending) refreshPending = cognito('REFRESH_TOKEN_AUTH', { REFRESH_TOKEN: refreshToken })
      .then(result => { idToken = result.IdToken; })
      .catch(() => { signOut('로그인이 만료됐어요. 다시 로그인해 주세요.'); throw new Error('로그인이 만료됐어요.'); })
      .finally(() => { refreshPending = null; });
    await refreshPending;
  }
  return { 'X-App-Token': idToken };
}
export async function payloadHeaders(encodedBody) {
  if (!configuration?.requiresAuth || encodedBody === undefined) return {};
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encodedBody));
  return { 'X-Amz-Content-Sha256': [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('') };
}
export function handleAuthError(code) {
  if (configuration?.requiresAuth && ['TOKEN_EXPIRED', 'WORKSHOP_EXPIRED', 'LOGIN_REQUIRED'].includes(code))
    signOut('워크숍 이용이 종료됐거나 로그인이 만료됐어요.');
}
export function configureAuth(config, onLogout) {
  configuration = config;
  onSignedOut = onLogout;
  if (!config.requiresAuth) return;
  $('.local-badge').innerHTML = '<span class="status-dot"></span><span id="account-label">워크숍 계정</span>';
  $('#logout-button').addEventListener('click', () => signOut());
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#login-submit'); button.disabled = true; button.textContent = '로그인 중…';
    $('#login-error').hidden = true;
    try {
      const result = await cognito('USER_PASSWORD_AUTH', {
        USERNAME: $('#login-username').value.trim(), PASSWORD: $('#login-password').value
      });
      idToken = result.IdToken; refreshToken = result.RefreshToken;
      $('#login-password').value = '';
      const response = await fetch('/api/me', { headers: { 'X-App-Token': idToken }, cache: 'no-store' });
      const me = await response.json();
      if (!response.ok) throw new Error(me.error?.message || '워크숍 계정을 확인하지 못했어요.');
      $('#account-label').textContent = me.username;
      $('#account-label').title = `이용 종료: ${new Date(me.endsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
      $('#login-screen').hidden = true; $('.shell').inert = false; $('#logout-button').hidden = false;
      expirationTimer = setTimeout(() => signOut('워크숍 이용 시간이 종료됐어요.'), Math.max(0, me.endsAt - Date.now()));
      $('#answer').focus();
    } catch (error) {
      idToken = null; refreshToken = null;
      $('#login-error').textContent = error.message; $('#login-error').hidden = false;
    } finally { button.disabled = false; button.textContent = '워크숍 시작하기'; }
  });
  showLogin();
}
