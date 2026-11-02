/* Obsidian 内嵌原型冒烟：起本地静态服务 + Edge headless CDP，检查关键交互是否真能跑。
   用法：node prototype/desktop/smoke.mjs（不依赖项目其它包） */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199, CDP = 9333;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'bz-smoke-' + process.pid);
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1440,900',
  `http://127.0.0.1:${PORT}/index.html`,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 50; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    page = ts.find(t => t.type === 'page' && t.url.includes('index.html')) || ts.find(t => t.type === 'page');
    if (page) break;
  } catch (e) {}
  await sleep(300);
}
if (!page) { console.error('SMOKE FAIL: 无法连接无头浏览器'); edge.kill(); server.close(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ timeout: true }); } }, 12000);
});
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'unknown') };
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await sleep(900);

const pick = `(()=>{const p=document.querySelector('.para');if(!p)return;const tn=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode();if(!tn)return;const r=document.createRange();r.setStart(tn,0);r.setEnd(tn,Math.min(10,tn.length));const s=window.getSelection();s.removeAllRanges();s.addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));showSelbar();})()`;

const steps = [
  { name:'宿主骨架四件', test:`!!document.querySelector('.app') && !!document.querySelector('.ribbon') && !!document.querySelector('.lefts') && !!document.querySelector('.tabbar') && !!document.querySelector('.statusbar')` },
  { name:'ribbon 七个入口', test:`document.querySelectorAll('.ribbon .rib').length===7` },
  { name:'中心两个 tab', test:`document.querySelectorAll('.tabbar .tab').length===2` },
  { name:'书房默认落在书库', test:`S.tab==='study' && S.studyPage==='library' && !!document.querySelector('.cont2') && document.querySelectorAll('.bkcard').length>=8` },
  { name:'书房三页导航', test:`document.querySelectorAll('.stunav button').length===3` },
  { name:'切到笔记页', act:`document.querySelector('[data-act="study"][data-p="notes"]').click()`, test:`S.studyPage==='notes' && document.querySelectorAll('.ncard').length>=8` },
  { name:'切到统计页', act:`document.querySelector('[data-act="study"][data-p="stats"]').click()`, test:`document.querySelectorAll('.kpis .k').length===4 && document.querySelectorAll('.heat i').length===140` },
  { name:'书库开详情弹层', act:`document.querySelector('[data-act="study"][data-p="library"]').click();document.querySelector('.bkcard').click()`, test:`!!document.querySelector('.detail h2')` },
  { name:'详情里进阅读 tab', act:`document.querySelector('#overlayRoot [data-act="openbook"]').click()`, test:`S.tab==='reader' && !!document.querySelector('.reader') && document.querySelectorAll('.para').length>=2 && !S.overlay` },
  { name:'tab 高亮跟随书名', test:`document.querySelector('.tab.on')?.textContent.includes(S.books.find(b=>b.id===S.bookId).title)` },
  { name:'翻页改进度', act:`document.querySelector('[data-act="next"]').click()`, test:`document.querySelector('.rfoot .pct')?.textContent.length>0` },
  { name:'左侧栏目录', act:`document.querySelector('[data-act="sbtab"][data-tab="toc"]').click()`, test:`document.querySelectorAll('.chaprow').length>=6` },
  { name:'记书签', act:`document.querySelector('[data-act="addbookmark"]').click()`, test:`document.querySelectorAll('.mkrow').length>=1` },
  { name:'划词浮层', act: pick, test:`!!document.getElementById('selbar')` },
  { name:'划线写入', act:`document.querySelector('#selbar [data-act="selpen"]').click()`, test:`S.marks['b1'].length>=9` },
  { name:'搜索（/）', act:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))`, test:`!!document.querySelector('[data-role="searchkw"]')` },
  { name:'本书命中', act:`(()=>{const i=document.querySelector('[data-role="searchkw"]');i.value='山月';i.dispatchEvent(new Event('input',{bubbles:true}));})()`, test:`document.querySelectorAll('#hitlist .hit').length>0` },
  { name:'全库范围切换', act:`document.querySelector('[data-act="searchscope"][data-v="all"]').click()`, test:`document.querySelector('[data-act="searchscope"][data-v="all"]').classList.contains('on')` },
  { name:'命中跳回阅读', act:`document.querySelector('#hitlist .hit').click()`, test:`S.tab==='reader' && !S.overlay` },
  { name:'Book Map', act:`document.querySelector('[data-act="bookmap"]').click()`, test:`document.querySelectorAll('.bmap .row').length>=6` },
  { name:'关层并切书房笔记', act:`document.querySelector('[data-act="close"]').click();document.querySelector('[data-act="tab"][data-go="study"]').click();document.querySelector('[data-act="study"][data-p="notes"]').click()`, test:`S.studyPage==='notes' && S.tab==='study'` },
  { name:'导出 Markdown', act:`document.querySelector('[data-act="export"]').click()`, test:`document.querySelector('.md')?.textContent.includes('摘录')` },
  { name:'关层后笔记仍在', act:`document.querySelector('[data-act="close"]').click()`, test:`document.querySelectorAll('.ncard').length>=8` },
  { name:'设置面板（原生形态）', act:`document.querySelector('[data-act="rib"][data-go="settings"]').click()`, test:`!!document.querySelector('.obs-set') && document.querySelectorAll('.oset-side button').length===7` },
  { name:'设置即时生效', act:`(()=>{const r=document.querySelector('[data-role="set"][data-k="size"]');r.value=22;r.dispatchEvent(new Event('input',{bubbles:true}));})()`, test:`S.settings.size===22 && getComputedStyle(document.querySelector('#app')).getPropertyValue('--rd-size').trim()==='22px'` },
  { name:'关闭设置', act:`document.querySelector('[data-act="close"]').click()`, test:`!S.overlay` },
  { name:'主题切换', act:`document.querySelector('[data-act="rib"][data-go="theme"]').click()`, test:`document.documentElement.dataset.theme==='paper'` },
  { name:'进专注模式', act:`document.querySelector('[data-act="tab"][data-go="reader"]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}))`, test:`document.querySelector('.app').classList.contains('focus')` },
  { name:'退出专注', act:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}))`, test:`!document.querySelector('.app').classList.contains('focus')` },
  { name:'侧栏收起（s）', act:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))`, test:`S.leftOpen===false && document.querySelector('.lefts').classList.contains('hide')` },
  { name:'侧栏展开（s）', act:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))`, test:`S.leftOpen===true && !document.querySelector('.lefts').classList.contains('hide')` },
  { name:'帮助导览 12 项', act:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'?',bubbles:true}))`, test:`document.querySelectorAll('.tour button').length===12` },
  { name:'关层并重新划词', act:`document.querySelector('[data-act="close"]').click();` + pick, test:`!!document.getElementById('selbar')` },
  { name:'想法编辑器五类', act:`document.querySelector('#selbar [data-act="selidea"]').click()`, test:`document.querySelectorAll('.types button').length===5 && !!document.querySelector('[data-role="idea"]')` },
  { name:'想法落库', act:`(()=>{const t=document.querySelector('[data-role="idea"]');t.value='原型里写下的想法';})();document.querySelector('[data-act="ideasave"]').click()`, test:`S.marks['b1'].some(m=>m.comment==='原型里写下的想法')` },
  { name:'标注卡改色', act:`document.querySelector('[data-act="sbtab"][data-tab="highlights"]').click();document.querySelector('.hlit').click();document.querySelector('[data-act="hlcolor"][data-v="vermilion"]').click()`, test:`S.marks['b1'][0].color==='vermilion'` },
  { name:'书摘卡', act:`document.querySelector('[data-act="close"]').click();` + pick + `;document.querySelector('#selbar [data-act="selquote"]').click()`, test:`!!document.querySelector('.qcard .q')` },
  { name:'AI 问答', act:`document.querySelector('[data-act="close"]').click();` + pick + `;document.querySelector('#selbar [data-act="selai"]').click()`, test:`!!document.querySelector('.ai-body')` },
  { name:'AI 换问法', act:`document.querySelector('[data-act="aimode"][data-v="翻译"]').click()`, test:`document.querySelector('.mhead b').textContent.includes('翻译')` },
  { name:'词典与生词本', act:`document.querySelector('[data-act="close"]').click();` + pick + `;document.querySelector('#selbar [data-act="seldict"]').click();document.querySelector('[data-act="dictsave"]').click()`, test:`S.vocab.length>=1` },
  { name:'段落翻译', act: pick + `;document.querySelector('#selbar [data-act="seltranslate"]').click()`, test:`!!document.querySelector('.mbody .ai-quote')` },
  { name:'导入示例书落回书房', act:`document.querySelector('[data-act="close"]').click();document.querySelector('[data-act="rib"][data-go="import"]').click();document.querySelector('[data-act="addsample"]').click()`, test:`S.books.length>=9 && S.tab==='study' && S.studyPage==='library'` },
  { name:'页面浏览器', act:`document.querySelector('[data-act="openbook"]').click();document.querySelector('[data-act="film"]').click()`, test:`document.querySelectorAll('.film button').length>=18` },
  { name:'胶片跳页', act:`document.querySelector('.film button:nth-child(4)').click()`, test:`S.chapter===1 && S.page===0` },
  { name:'并排对照阅读', act:`document.querySelector('[data-act="parallel"]').click()`, test:`document.querySelectorAll('.parallel .sheet').length===2` },
  { name:'竖排与滚动模式', act:`document.querySelector('[data-act="typography"]').click();document.querySelector('[data-act="set"][data-k="mode"][data-v="scroll"]').click();document.querySelector('[data-act="toggle"][data-k="vertical"]').click();document.querySelector('[data-act="close"]').click()`, test:`S.settings.mode==='scroll' && S.settings.vertical===true && !!document.querySelector('.sheet.vertical')` },
  { name:'朗读条开关', act:`document.querySelector('[data-act="tts"]').click()`, test:`!!document.querySelector('.ttsbar') && RT.tts===true` },
  { name:'朗读关闭', act:`document.querySelector('[data-act="tts"]').click()`, test:`RT.tts===false` },
  { name:'每日回顾翻卡', act:`document.querySelector('[data-act="tab"][data-go="study"]').click();document.querySelector('[data-act="study"][data-p="notes"]').click();document.querySelector('[data-act="reviewnext"]').click()`, test:`S.reviewIdx===1` },
  { name:'主题三档循环', act:`document.querySelector('[data-act="rib"][data-go="theme"]').click();document.querySelector('[data-act="rib"][data-go="theme"]').click()`, test:`document.documentElement.dataset.theme==='ink'` },
  { name:'关 tab 回落到另一个', act:`document.querySelector('[data-act="tab"][data-go="study"]').click();document.querySelector('.tab.on .x').click()`, test:`S.tab==='reader'` },
];

let pass = 0;
for (const s of steps) {
  if (s.act) { const a = await ev(s.act); if (a && a.__err) console.log('  ACT ERROR', s.name, a.__err); await sleep(130); }
  const v = await ev(`(()=>{try{return !!(${s.test})}catch(e){return 'ERR:'+e.message}})()`);
  const ok = v === true;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}${ok ? '' : '  → ' + JSON.stringify(v)}`);
}
console.log(`\n${pass}/${steps.length} 通过 · 运行时异常 ${errors.length} 条`);
errors.slice(0, 8).forEach(e => console.log('  EXCEPTION', e.slice(0, 240)));

ws.close(); edge.kill(); server.close();
process.exit(pass === steps.length && errors.length === 0 ? 0 : 1);
