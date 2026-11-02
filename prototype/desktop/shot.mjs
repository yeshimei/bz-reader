/* 截图检查：书房三页 + 阅读 + 设置，用来看真实排版 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '.shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5201, CDP = 9335;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), 'bz-shot-' + process.pid)}`,
  '--window-size=1500,960', `http://127.0.0.1:${PORT}/index.html`,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 50; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    page = ts.find(t => t.type === 'page' && t.url.includes('index.html'));
    if (page) break;
  } catch (e) {}
  await sleep(300);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await sleep(1000);

const shots = [
  ['01-shelf', `S.tab='study';S.studyPage='library';render()`],
  ['02-stats', `S.studyPage='stats';render()`],
  ['03-notes', `S.studyPage='notes';render()`],
  ['04-reader', `goReader()`],
  ['05-settings', `openOverlay('settings')`],
  ['06-focus', `closeOverlay();S.focus=true;render()`],
];

for (const [name, expr] of shots) {
  await ev(expr);
  await sleep(420);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
}
ws.close(); edge.kill(); server.close();
process.exit(0);
