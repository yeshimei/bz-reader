/* 截图检查：AI 浮卡三档（桌面 / 手机 / 墨色 / 分段 / 基础版） */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '.shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5410 + Math.floor(Math.random() * 80);
const CDP = 9710 + Math.floor(Math.random() * 80);
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
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-proto-aimodes-' + process.pid)}`,
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
await sleep(1100);
const title = await ev('document.title');
console.log('page:', title, '|', PAGE_URL);

const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click()`;
const setSeg = (set, v) => click(`.seg[data-set="${set}"] button[data-v="${v}"]`);

const shots = [
  ['01-desktop-explain', `${setSeg('vp','desktop')};${setSeg('theme','paper')};${setSeg('style','a')};${setSeg('tier','pro')};${click('.mode[data-mode="explain"]')}`],
  ['02-desktop-translate', `${setSeg('vp','desktop')};${click('.mode[data-mode="translate"]')}`],
  ['03-desktop-summary', `${setSeg('vp','desktop')};${click('.mode[data-mode="summary"]')}`],
  ['04-desktop-segmented', `${setSeg('style','b')};${click('.mode[data-mode="translate"]')}`],
  ['05-desktop-ink', `${setSeg('style','a')};${setSeg('theme','ink')};${click('.mode[data-mode="explain"]')}`],
  ['06-phone-explain', `${setSeg('theme','paper')};${setSeg('vp','phone')};${click('.mode[data-mode="explain"]')}`],
  ['07-phone-translate', `${click('.mode[data-mode="translate"]')}`],
  ['08-desktop-free', `${setSeg('vp','desktop')};${setSeg('tier','free')};${click('.mode[data-mode="translate"]')}`],
];

for (const [name, expr] of shots) {
  await ev(expr);
  await sleep(780);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
}

ws.close(); edge.kill(); server.close();
process.exit(0);
