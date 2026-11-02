/* CDP 截图：连上 Obsidian 的调试端口，把阅读界面的几个状态拍下来。
   注意：文档里可能同时挂着好几个阅读 leaf，所有选择器必须限定在
   .workspace-leaf.is-active 里，否则点到的是藏在非活动 tab 里的那一个。 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const OUT = 'D:/Obsidian/bz-reader/.shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page' && /obsidian/i.test(t.url + t.title)) || targets.find((t) => t.type === 'page');
if (!page) { console.error('找不到页面目标', targets); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const send = (method, params = {}) =>
  new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};
await send('Page.enable');
const shot = async (name) => {
  await send('Page.bringToFront', {});
  await sleep(250);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  if (!r.result?.data) { console.error(name, '截图失败', r); return; }
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('✓', name);
};

const R = `.workspace-leaf.is-active .bzr-reader`;
const q = (sel) => `document.querySelector('.workspace-leaf.is-active ${sel}')`;

/* 等 bz-reader 出现；先关掉可能挡在下面的 bz 主插件开机弹窗 */
const closePopups = async () => {
  await evalJs(`(function(){
    document.querySelector('.modal-close-button')?.click();
    const k = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    document.body.dispatchEvent(k);
    return true;
  })()`);
  await sleep(600);
};
await closePopups();
await closePopups();

/* 把「排版测试」那条阅读 leaf 切到前台（活动 leaf 可能停在别处） */
await evalJs(`(async function(){
  const leaves = window.app.workspace.getLeavesOfType('bz-reader-view');
  const target = leaves.find((l) => l.view?.currentBookId === 'b1yz3sgl') || leaves[0];
  if (!target) return 'no-leaf';
  await window.app.workspace.revealLeaf(target);
  return 'ok';
})()`);
await sleep(800);

let ready = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!${q('.bzr-stage foliate-view')}`)) { ready = true; break; }
  await evalJs(`(async function(){
    const leaves = window.app.workspace.getLeavesOfType('bz-reader-view');
    const target = leaves.find((l) => l.view?.currentBookId === 'b1yz3sgl') || leaves[0];
    if (target) await window.app.workspace.revealLeaf(target);
  })()`);
  await sleep(2000);
}
if (!ready) { console.error('120s 内阅读视图没起来'); process.exit(1); }
await sleep(4000); // 等章节渲染与字体稳定

await shot('01-read-ink');
console.log('active book =', await evalJs(`${q('.bzr-rhead-name')}?.textContent`));

/* 排版面板 */
await evalJs(`${q('.bzr-ric[title="排版"]')}.click()`);
await sleep(500);
console.log('prefs open?', await evalJs(`${q('.bzr-prefs')}?.classList.contains('is-open')`));
await shot('02-prefs-ink');

/* 切纸主题（面板开着，正好看亮色下两件套） */
await evalJs(`${q('.bzr-swatches button[title="纸"]')?.click()}`);
await sleep(800);
console.log('theme bg =', await evalJs(`${R}?.style.getPropertyValue('--rear-bg')`));
await shot('03-paper-prefs');

await evalJs(`${q('.bzr-ric[title="排版"]')}.click()`);
await sleep(400);
await shot('04-paper-read');

/* 全屏态幽灵进度 */
await evalJs(`${R}.classList.add('is-bare')`);
await sleep(400);
await shot('05-paper-bare');
await evalJs(`${R}.classList.remove('is-bare')`);

/* 搜索面板 */
await evalJs(`${q('.bzr-ric[title^="搜索"]').click()}`);
await sleep(600);
await shot('06-search-paper');

/* 收尾：回墨主题、关搜索 */
await evalJs(`${q('.bzr-ric[title^="搜索"]')?.click()}`);
await evalJs(`${q('.bzr-swatches button[title="墨"]')?.click()}`);
await sleep(300);

ws.close();
console.log('完成');
process.exit(0);
