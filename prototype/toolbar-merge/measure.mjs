/* 量定稿版的盒子：桌面上浮窗是否真在工具条上方、开面板时工具条有没有动；
   手机上弹窗是否独立居中偏上、工具条是否还贴着文字 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5310 + Math.floor(Math.random() * 60);
const CDP = 9510 + Math.floor(Math.random() * 60);
const PAGE_URL = `http://127.0.0.1:${PORT}/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  const f = path.join(dir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-measure-' + process.pid)}`,
  '--window-size=1440,980', PAGE_URL,
], { stdio: 'ignore' });
let page = null;
for (let i = 0; i < 60; i++) {
  try { const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); page = ts.find((t) => t.type === 'page' && t.url.startsWith(PAGE_URL)); if (page) break; } catch (e) {}
  await sleep(300);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await sleep(800);

const cases = [
  ['desktop-mark', `PROTO.set({vp:'desktop'});PROTO.demo('mark')`],
  ['desktop-idea', `PROTO.demo('idea')`],
  ['phone-sel', `PROTO.set({vp:'phone'});PROTO.demo('sel')`],
  ['phone-mark', `PROTO.demo('mark')`],
  ['phone-idea', `PROTO.demo('idea')`],
];
const snap = `(() => {
  const app=document.querySelector('#app'), st=document.querySelector('#stack'), dlg=document.querySelector('#dialog');
  const tb=document.querySelector('.toolbar'), fl=document.querySelector('.float'), pg=document.querySelector('#page');
  const r=(e)=>e&&!e.hidden?{x:Math.round(e.getBoundingClientRect().x),y:Math.round(e.getBoundingClientRect().y),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)}:null;
  const a=PROTO.state.anchor, appR=app.getBoundingClientRect();
  return {
    app:r(app), page:r(pg), stack:r(st), toolbar:r(tb), float:r(fl), dialog:r(dlg),
    anchor: a?{top:Math.round(a.top),h:Math.round(a.height)}:null,
    meanings: {
      toolbarBottomMinusAnchorTop: a&&tb?Math.round(tb.getBoundingClientRect().top - appR.top - (a.top-8)):null,
      floatAboveToolbar: !!(fl&&tb)&&fl.getBoundingClientRect().bottom<=tb.getBoundingClientRect().top+1,
      dialogCentered: !!(!dlg.hidden&&dlg)&&Math.abs((dlg.getBoundingClientRect().left-appR.left+dlg.getBoundingClientRect().width/2)-app.clientWidth/2)<2,
    },
    collapsed: PROTO.state.collapsed.slice(),
  };
})()`;

for (const [name, expr] of cases) {
  await ev(expr);
  await sleep(450);
  console.log(name, JSON.stringify(await ev(snap)));
}
ws.close(); edge.kill(); server.close(); process.exit(0);
