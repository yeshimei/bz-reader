/* 在《我的天才女友》上实测全书搜「干净」 */
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pend = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') events.push('EXC:' + String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('open:', await ev(`(() => {
  const leaves = app.workspace.getLeavesOfType('bz-reader-view');
  const target = leaves.find(l => (l.containerEl.querySelector('.bzr-rhead-name')?.textContent || '').includes('天才女友'));
  if (!target) return 'no leaf';
  app.workspace.setActiveLeaf(target, { focus: true });
  const root = target.containerEl.querySelector('.bzr-reader');
  const btn = [...root.querySelectorAll('.bzr-ric')].find(b => (b.title || '').includes('搜索'));
  btn?.click();
  return 'ok';
})()`));
await sleep(400);
await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  [...sb.querySelectorAll('.bzr-sb-scope button')].find(b => b.textContent === '全书')?.click();
  return 'ok';
})()`);
await sleep(200);
await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  const input = sb.querySelector('input');
  input.value = '干净';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  const st = await ev(`(() => {
    const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
    return JSON.stringify({ status: sb?.querySelector('.bzr-sb-status')?.textContent, rows: sb?.querySelectorAll('.bzr-sb-hit').length, groups: sb?.querySelectorAll('.bzr-sb-group').length });
  })()`);
  console.log('t+' + (i + 1) + 's', st);
}
const sample = await ev(`(() => {
  const sb = [...document.querySelectorAll('.bzr-sb')].find(b => b.classList.contains('is-open'));
  return JSON.stringify([...sb.querySelectorAll('.bzr-sb-hit')].slice(0, 3).map(r => r.textContent.slice(0, 50)));
})()`);
console.log('sample:', sample);
console.log('exceptions:', events.length ? events.slice(0, 5) : '(none)');
process.exit(0);
