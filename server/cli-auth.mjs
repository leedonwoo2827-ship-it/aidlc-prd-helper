// Local-only login management for the Claude Code / Codex CLIs, driven from the web UI.
// Only fixed commands run here; the only user input is the optional OAuth code, written to stdin.
import { spawn, exec } from 'node:child_process';
import { AppError } from './engine.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createCliAuth(provider) {
  const env = { ...process.env };
  if (provider === 'claude') delete env.ANTHROPIC_API_KEY;
  let pending = null;

  const runOnce = command => new Promise(resolve => {
    exec(command, { env, windowsHide: true, timeout: 30000 }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}` }));
  });
  const loginUrl = p => (p.output.match(/https:\/\/[^\s"'<>]+/) || [])[0] || null;
  function stop(p) {
    if (!p || p.done) return;
    p.done = true; p.ok = false; clearTimeout(p.timer);
    if (process.platform === 'win32') exec(`taskkill /pid ${p.child.pid} /T /F`, { windowsHide: true }, () => {});
    else p.child.kill();
  }
  const view = () => pending ? {
    active: !pending.done, url: loginUrl(pending), finished: pending.done, ok: pending.ok,
    needsCode: provider === 'claude'
  } : { active: false };

  async function status() {
    if (provider === 'claude') {
      const result = await runOnce('claude auth status --json');
      let info = {};
      try { info = JSON.parse(result.out.slice(result.out.indexOf('{'))); } catch {}
      return { loggedIn: info.loggedIn === true, account: info.email || '', plan: info.subscriptionType || '' };
    }
    const result = await runOnce('codex login status');
    const loggedIn = result.code === 0 && /logged in/i.test(result.out);
    return { loggedIn, account: loggedIn ? result.out.trim().replace(/^Logged in using\s*/i, '') : '', plan: '' };
  }

  async function login() {
    if (pending && !pending.done) return view();
    const command = provider === 'claude' ? 'claude auth login --claudeai' : 'codex login';
    const child = spawn(command, { shell: true, windowsHide: true, env });
    const p = { child, output: '', done: false, ok: null };
    pending = p;
    const collect = data => { p.output = (p.output + data).slice(-8000); };
    child.stdout.setEncoding('utf8').on('data', collect);
    child.stderr.setEncoding('utf8').on('data', collect);
    child.on('error', () => { p.done = true; p.ok = false; });
    child.on('close', code => { if (!p.done) { p.done = true; p.ok = code === 0; } clearTimeout(p.timer); });
    p.timer = setTimeout(() => stop(p), 10 * 60 * 1000);
    for (let i = 0; i < 40 && !loginUrl(p) && !p.done; i++) await sleep(200);
    return view();
  }

  async function submitCode(code) {
    if (provider !== 'claude') throw new AppError(400, 'NO_CODE', '이 방식은 코드 입력이 필요 없어요.');
    if (!pending || pending.done) throw new AppError(409, 'NO_LOGIN', '진행 중인 로그인이 없어요. 로그인을 다시 눌러 주세요.');
    const value = typeof code === 'string' ? code.trim() : '';
    if (!/^[A-Za-z0-9#_.~-]{10,1000}$/.test(value)) throw new AppError(400, 'INVALID_CODE', '코드 형식을 확인해 주세요.');
    pending.child.stdin.write(`${value}\n`);
    for (let i = 0; i < 75 && !pending.done; i++) await sleep(200);
    return view();
  }

  async function logout() {
    stop(pending);
    await runOnce(provider === 'claude' ? 'claude auth logout' : 'codex logout');
    return status();
  }

  return { provider, status, login, submitCode, logout, view, cancel: () => stop(pending) };
}
