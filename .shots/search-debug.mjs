/* 活体调试 v2：任意 reader tab，抓搜索现场与异常 */
const CDP = 'http://127.0.0.1:9222';

const targets = await (await fetch(CDP + '/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pend = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') events.push('EXC: ' + String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 400));
  else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) events.push(m.params.type.toUpperCase() + ': ' + m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 找一个有书的 reader（不要求活动） */
console.log('readers:', await ev(`JSON.stringify([...document.querySelectorAll('.bzr-reader')].map(r => ({
  title: r.querySelector('.bzr-rhead-name')?.textContent || r.querySelector('[class*=name]')?.textContent || '?',
  hasView: !!r.querySelector('foliate-view'),
})))`));

const open = await ev(`(() => {
  const readers = [...document.querySelectorAll('.bzr-reader')].filter(r => r.querySelector('foliate-view'));
  const root = readers[readers.length - 1];
  if (!root) return 'no ready reader';
  root.closest('.workspace-leaf').view?.onPaneMenu?.(); // noop 探活
  const btn = [...root.querySelectorAll('.bzr-ric')].find(b => (b.title || '').includes('搜索'));
  if (!btn) return 'no search btn';
  btn.click();
  return 'opened: ' + (root.querySelector('.bzr-rhead-name')?.textContent || '?');
})()`);
console.log('open search:', open);
await sleep(500);
console.log('panel open:', await ev(`JSON.stringify([...document.querySelectorAll('.bzr-sb')].map(b => b.classList.contains('is-open')))`));

/* 找到开着的那块面板操作 */
const scopeOk = await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  if (!sb) return 'no open panel';
  const book = [...sb.querySelectorAll('.bzr-sb-scope button')].find(b => b.textContent === '全书');
  if (!book) return 'no book scope btn';
  book.click();
  return 'ok';
})()`);
console.log('scope->全书:', scopeOk);
await sleep(200);
console.log('type:', await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  const input = sb?.querySelector('input');
  if (!input) return 'no input';
  input.value = '干净';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`));

for (let i = 0; i < 12; i++) {
  await sleep(1000);
  const st = await ev(`(() => {
    const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
    if (!sb) return null;
    return JSON.stringify({
      status: sb.querySelector('.bzr-sb-status')?.textContent,
      count: sb.querySelector('.bzr-sb-count')?.textContent,
      rows: sb.querySelectorAll('.bzr-sb-hit').length,
      groups: sb.querySelectorAll('.bzr-sb-group').length,
    });
  })()`);
  console.log(`t+${i + 1}s`, st);
}

console.log('--- 本章 scope 重试 ---');
await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  if (!sb) return 'gone';
  [...sb.querySelectorAll('.bzr-sb-scope button')].find(b => b.textContent === '本章')?.click();
  const input = sb.querySelector('input');
  input.value = '干净';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(6000);
console.log('chapter:', await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  if (!sb) return 'gone';
  return JSON.stringify({ status: sb.querySelector('.bzr-sb-status')?.textContent, rows: sb.querySelectorAll('.bzr-sb-hit').length });
})()`));

/* 关掉面板，还你现场 */
await ev(`(() => { const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open')); sb?.querySelector('.bzr-sb-cancel')?.click(); })()`);

console.log('--- console 事件 ---');
for (const e of events.slice(0, 12)) console.log(e);
if (!events.length) console.log('(none)');
process.exit(0);
