/* 把定稿版真点一遍：桌面浮窗在上、手机弹窗独立、⋯ 收得起、开面板工具条不动 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5410 + Math.floor(Math.random() * 60);
const CDP = 9610 + Math.floor(Math.random() * 60);
const PAGE_URL = `http://127.0.0.1:${PORT}/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  const f = path.join(dir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-smoke-' + process.pid)}`,
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await sleep(800);

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push([ok ? 'PASS' : 'FAIL', name, ok ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`]);
};
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'no-el'; el.click(); return 'ok'; })()`);
const labels = () => ev(`[...document.querySelectorAll('#stack .toolbar .act')].map(b => b.textContent.trim())`);
const menuLabels = () => ev(`[...document.querySelectorAll('#stack .moremenu .mi')].map(b => b.textContent.trim())`);
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}; })()`);

await ev(`try{window.getSelection().removeAllRanges()}catch(e){}`);

/* ── 桌面 ── */
await ev(`PROTO.set({vp:'desktop'}); PROTO.demo('sel')`);
check('桌面划词：工具条出现', await ev(`!document.querySelector('#stack').hidden`), true);
check('桌面划词：A 全平铺，没有 ⋯', await labels(), ['想法', '书摘', 'AI', '双链', '复制']);
check('桌面划词：没有独立弹窗', await ev(`document.querySelector('#dialog').hidden`), true);

const selRect = await rect('mark[data-mark="m1"]');
await ev(`PROTO.demo('mark')`);
const tbBefore = await rect('#stack .toolbar');
check('桌面点划线：工具条贴在这条线上方', (await rect('#stack .toolbar')).b <= (await rect('mark[data-mark="m1"]')).t, true);

await click('#stack [data-act="idea"]');
const tbAfter = await rect('#stack .toolbar');
const floatRect = await rect('#stack .float');
check('桌面开想法：面板在工具条上方', floatRect.b <= tbAfter.t, true);
check('桌面开想法：工具条位置没动', tbAfter, tbBefore);
check('桌面开想法：工具条还在', await ev(`!!document.querySelector('#stack .toolbar')`), true);
check('桌面开想法：多了删除', await labels(), ['想法', '书摘', 'AI', '双链', '复制', '删除']);

await ev(`PROTO.demo('mark')`);
const bubble = await rect('#stack .float.thought');
check('桌面有想法：气泡在工具条上方', bubble.b <= (await rect('#stack .toolbar')).t, true);
check('桌面有想法：徽章是「想」', await ev(`document.querySelector('#stack .thought .seal').textContent`), '想');

/* ── 手机 ── */
await ev(`try{window.getSelection().removeAllRanges()}catch(e){}; PROTO.set({vp:'phone'}); PROTO.demo('sel')`);
await sleep(420);
check('手机划词：B，主路径 + ⋯', await labels(), ['想法', '书摘', 'AI', '⋯']);
check('手机划词：工具条在选区下方', (await rect('#stack .toolbar')).t >= (await rect('mark[data-mark="m1"]')).t, true);
check('手机划词：还没弹窗', await ev(`document.querySelector('#dialog').hidden`), true);

await ev(`PROTO.demo('idea')`);
await sleep(420);
const dlg = await rect('#dialog');
const tbPhone = await rect('#stack .toolbar');
const appBox = await rect('#app');
check('手机开想法：弹窗出现', await ev(`!document.querySelector('#dialog').hidden`), true);
check('手机开想法：工具条还在', await ev(`!document.querySelector('#stack').hidden`), true);
check('手机开想法：弹窗水平居中', Math.abs((dlg.l + dlg.w / 2) - (appBox.l + appBox.w / 2)) <= 2, true);
check('手机开想法：弹窗在上半屏', dlg.t < appBox.t + Math.round(appBox.h * 0.5), true);
check('手机开想法：弹窗不贴着工具条', Math.abs(dlg.b - tbPhone.t) > 40, true);

/* 放不下收起来：把手机压到 300 宽，AI 应该被收进 ⋯ */
await ev(`document.querySelector('#app').style.width='300px'; PROTO.set({vp:'phone'})`);
await sleep(400);
check('窄屏：有动作被收进 ⋯', await ev(`PROTO.state.collapsed.length > 0`), true);
check('窄屏：工具条上不再有 AI', (await labels()).includes('AI'), false);
await click('#stack [data-act="more"]');
check('窄屏：⋯ 菜单里有被收的动作', (await menuLabels()).includes('AI'), true);
await ev(`document.querySelector('#app').style.width=''; PROTO.set({vp:'phone'}); PROTO.demo('idea')`);
await sleep(400);

/* ── 删除与收尾 ── */
await ev(`PROTO.set({vp:'desktop'}); PROTO.demo('mark')`);
const tbDel = await rect('#stack .toolbar');
await click('#stack [data-act="del"]');
const confirmRect = await rect('#stack .float.confirm');
check('删除：确认条也在工具条上方', confirmRect.b <= (await rect('#stack .toolbar')).t, true);
const tbDel2 = await rect('#stack .toolbar');
check('删除：工具条不动（±1px 取整）', Math.abs(tbDel2.t - tbDel.t) <= 1, true);

await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
check('Esc：工具条收起', await ev(`document.querySelector('#stack').hidden`), true);
check('Esc：弹窗收起', await ev(`document.querySelector('#dialog').hidden`), true);
check('Esc：状态复位', await ev(`({mode:PROTO.state.mode,panel:PROTO.state.panel,collapsed:PROTO.state.collapsed.length})`), { mode: 'none', panel: null, collapsed: 0 });

for (const [s, n, d] of results) console.log(s.padEnd(5), n, '·', d);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
ws.close(); edge.kill(); server.close(); process.exit(failed ? 1 : 0);
