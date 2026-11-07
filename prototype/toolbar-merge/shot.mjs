/* 截图检查：定稿版（桌面 A + 浮窗在上 / 手机 B + 独立弹窗） */
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
const PAGE_URL = `http://127.0.0.1:${PORT}/index.html`;
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

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(edgePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-proto-shot-' + process.pid)}`,
  '--window-size=1440,980', PAGE_URL,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 60; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    page = ts.find((t) => t.type === 'page' && t.url.startsWith(PAGE_URL));
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await sleep(900);
const title = await ev('document.title');
console.log('page:', title, '|', PAGE_URL);
if (!String(title).includes('划词工具条')) { console.error('截到别的页面了，停'); process.exit(1); }

const base = (vp) => `try{window.getSelection().removeAllRanges()}catch(e){};PROTO.state.panel=null;PROTO.state.more=false;PROTO.state.mode='none';PROTO.state.markId=null;PROTO.set({vp:'${vp}'});`;

const shots = [
  ['01-desktop-select', base('desktop') + `PROTO.demo('sel')`],
  ['02-desktop-mark-idea', base('desktop') + `PROTO.demo('mark')`],
  ['03-desktop-idea', base('desktop') + `PROTO.demo('idea')`],
  ['04-desktop-quote', base('desktop') + `PROTO.demo('quote')`],
  ['05-desktop-delete', base('desktop') + `PROTO.demo('del')`],
  ['06-phone-select', base('phone') + `PROTO.demo('sel')`],
  ['07-phone-mark-idea', base('phone') + `PROTO.demo('mark')`],
  ['08-phone-idea', base('phone') + `PROTO.demo('idea')`],
  ['09-phone-more', base('phone') + `PROTO.demo('more')`],
  ['10-desktop-ink', base('desktop') + `document.documentElement.dataset.theme='ink';PROTO.demo('mark')`],
];

for (const [name, expr] of shots) {
  await ev(expr);
  await sleep(560);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
}

ws.close(); edge.kill(); server.close();
process.exit(0);
