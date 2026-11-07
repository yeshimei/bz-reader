/* 四版手机想法的截图：每版都拍 中部 / 顶部 / 底部 / 长想法 里的关键几张 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '.shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5210 + Math.floor(Math.random() * 80);
const CDP = 9410 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const f = path.join(dir, decodeURIComponent(p === '/' ? 'index.html' : p));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-idea-shot-' + process.pid)}`,
  '--window-size=1000,1000', `${BASE}/index.html`,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 60; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    page = ts.find((t) => t.type === 'page' && t.url.startsWith(BASE));
    if (page) break;
  } catch (e) { /* 浏览器还没起来 */ }
  await sleep(300);
}
if (!page) { console.error('没有找到页面'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) console.error('eval error:', r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');

const shots = [
  ['a-01-mid', 'a-bottom-card.html', `PROTO.scene('m1','center')`],
  ['a-02-bottom-long', 'a-bottom-card.html', `PROTO.scene('m4','bottom')`],
  ['a-03-top', 'a-bottom-card.html', `PROTO.scene('m1','top')`],
  ['b-01-mid', 'b-grouped-flip.html', `PROTO.scene('m1','center')`],
  ['b-02-top-flip', 'b-grouped-flip.html', `PROTO.scene('m1','top')`],
  ['b-03-bottom-flip', 'b-grouped-flip.html', `PROTO.scene('m3','bottom')`],
  ['b-04-long', 'b-grouped-flip.html', `PROTO.scene('m4','center')`],
  ['c-01-badge', 'c-badge-dialog.html', `PROTO.scene('m1','center')`],
  ['c-02-dialog', 'c-badge-dialog.html', `PROTO.scene('m1','center');setTimeout(()=>document.querySelector('#stack [data-act="idea"]').click(),120)`],
  ['d-01-strip-top', 'd-dock-strip.html', `PROTO.scene('m1','center')`],
  ['d-02-strip-flip', 'd-dock-strip.html', `PROTO.scene('m1','top')`],
  ['d-03-strip-long', 'd-dock-strip.html', `PROTO.scene('m4','center')`],
];

let current = '';
for (const [name, file, expr] of shots) {
  if (file !== current) {
    await send('Page.navigate', { url: `${BASE}/${file}?t=${Date.now()}` });
    await sleep(650);
    current = file;
  }
  const title = await ev('document.title');
  if (!String(title).includes('原型')) { console.error('页面没准备好:', name, title); continue; }
  await ev(expr);
  await sleep(650);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name, '·', await ev(`document.querySelector('#state').textContent`));
}

ws.close(); edge.kill(); server.close();
process.exit(0);
