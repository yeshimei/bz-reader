/**
 * 商品图生成器（assets/plan-compare/shop.mjs）
 *
 * 和 draw.py 那张纸感长图不是同一套版式：这张照插件内「解锁」弹层的视觉
 * （深色高级版列头、整列淡铜底、铜色分组小字、灰勾 / 金勾），专门给爱发电
 * 商品详情用——买家在商店里看到的版式，和装完插件点开「高级版」时看到的一致。
 *
 * 数据与弹层同源：读 plan.json（由 data.ts 从 src/data/entitlement.ts 导出）。
 * 先跑一遍 draw.py 文件头那两条命令，再跑这条：
 *
 *   node assets/plan-compare/shop.mjs
 *
 * 产物：docs/images/plan-compare-shop.png（@2x）
 * 依赖：本机 Edge；没有就改 EDGE 或设 BZ_EDGE 环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const DATA = path.join(here, 'plan.json');
const HTML = path.join(here, '.shop.html');
const OUT = path.join(ROOT, 'docs', 'images', 'plan-compare-shop.png');

const plan = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const TICK =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.6 10.6 8 15 16.4 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DASH =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const cell = (v, pro) => {
  const cls = 'c' + (pro ? ' pro' : '');
  const inner = v === 'yes' ? `<span class="cell y">${TICK}</span>` : `<span class="cell n">${DASH}</span>`;
  return `<b class="${cls}">${inner}</b>`;
};

const rows = plan.groups
  .map((g) => {
    const head = `<div class="bzs-plan-row is-group"><span>${g.name}</span><b class="c"></b><b class="c pro"></b></div>`;
    const body = g.rows
      .map(
        (r) => `<div class="bzs-plan-row">
        <span>${r.name}</span>
        ${cell(r.free, false)}${cell(r.pro, true)}
      </div>`,
      )
      .join('');
    return head + body;
  })
  .join('');

const total = `<div class="bzs-plan-row is-total">
  <span>合计</span>
  <b class="c"><b>${plan.totals.free}</b><em>项</em></b>
  <b class="c pro"><b>${plan.totals.pro}</b><em>项</em></b>
</div>`;

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>bz Reader · 基础版 / 高级版</title>
<style>
  :root {
    --ink: #141416;
    --copper: #9a7434;
    --copper-soft: color-mix(in srgb, #9a7434 8%, transparent);
    --line: rgba(0,0,0,.1);
    --line-soft: rgba(0,0,0,.06);
    --t3: #93939c;
    --plan-head-bg: #2b261e;
    --plan-head-fg: #f2e6cb;
    --plan-head-sub: rgba(201,164,99,.85);
    --pcol: 104px;
    --sans: "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    --serif: Georgia, "Noto Serif SC", "Songti SC", serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f4f1ea; padding: 44px; display: flex; justify-content: center; font: 400 14px/1.5 var(--sans); color: var(--ink); }
  .sheet { width: 820px; background: #fff; border: 1px solid rgba(0,0,0,.1); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.08); padding: 22px 40px 18px; }

  .bzs-plan-row, .bzs-plan-head { display: grid; grid-template-columns: minmax(0,1fr) var(--pcol) var(--pcol); align-items: stretch; }
  .bzs-plan-row { border-bottom: 1px solid var(--line-soft); }
  .bzs-plan-row:last-child { border-bottom: 0; }
  .bzs-plan-row > span, .bzs-plan-row > b, .bzs-plan-head > span, .bzs-plan-head > b { display: flex; align-items: center; min-width: 0; padding: 4.5px 8px; }
  .bzs-plan-row > span, .bzs-plan-head > span { padding-left: 6px; padding-right: 12px; }
  .bzs-plan-row > span { font-size: 13px; line-height: 1.45; }
  .bzs-plan-row > .c, .bzs-plan-head > .c { justify-content: center; }
  .bzs-plan-row > .c.pro, .bzs-plan-head > .c.pro { background: var(--copper-soft); }

  .bzs-plan-head { border-bottom: 2px solid var(--line); }
  .bzs-plan-head > span { font-size: 10.5px; letter-spacing: .18em; color: var(--t3); padding-top: 10px; padding-bottom: 9px; }
  .bzs-plan-head > .c { flex-direction: column; gap: 3px; font-size: 12px; font-weight: 500; letter-spacing: .04em; padding-top: 9px; padding-bottom: 9px; }
  .bzs-plan-head > .c small { font-size: 9.5px; font-weight: 400; letter-spacing: .05em; color: var(--t3); }
  .bzs-plan-head > .c.pro { background: var(--plan-head-bg); color: var(--plan-head-fg); }
  .bzs-plan-head > .c.pro small { color: var(--plan-head-sub); }

  .bzs-plan-row.is-group { border-bottom: 0; }
  .bzs-plan-row.is-group > span { padding: 13px 12px 5px 6px; font-size: 10.5px; font-weight: 600; letter-spacing: .16em; color: var(--copper); }
  .bzs-plan-row.is-group > .c { padding: 0; }

  .cell { display: flex; align-items: center; justify-content: center; }
  .cell svg { display: block; width: 15px; height: 15px; }
  .cell.y { color: color-mix(in srgb, var(--ink) 42%, transparent); }
  .cell.pro.y { color: var(--copper); }
  .cell.n { color: color-mix(in srgb, var(--ink) 22%, transparent); }

  .bzs-plan-row.is-total { border-top: 2px solid var(--line); border-bottom: 0; }
  .bzs-plan-row.is-total > span { font-size: 10.5px; letter-spacing: .18em; color: var(--t3); padding-top: 13px; padding-bottom: 15px; }
  .bzs-plan-row.is-total > .c { gap: 4px; padding-top: 11px; padding-bottom: 13px; }
  .bzs-plan-row.is-total > .c b { font: 500 22px/1.1 var(--serif); }
  .bzs-plan-row.is-total > .c em { font-style: normal; font-size: 10.5px; letter-spacing: .08em; color: var(--t3); }
  .bzs-plan-row.is-total > .c.pro b { color: var(--copper); }
</style>
</head><body>
  <div class="sheet">
    <div class="bzs-plan-head">
      <span>功能</span>
      <b class="c">基础版<small>免费 · 不限时</small></b>
      <b class="c pro">高级版<small>一次买断 · 永久</small></b>
    </div>
    <div class="bzs-plan">
      ${rows}
      ${total}
    </div>
  </div>
</body></html>`;

fs.writeFileSync(HTML, page, 'utf8');

const EDGE =
  process.env.BZ_EDGE ||
  [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('找不到 Edge，请用 BZ_EDGE 指定 msedge.exe 路径');
  process.exit(1);
}

const SCALE = 2;
const CDP = 9371;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${path.join(os.tmpdir(), 'bz-shop-' + process.pid)}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    pathToFileURL(HTML).href,
  ],
  { stdio: 'ignore' },
);

let target = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.url.includes('.shop.html'));
    if (target) break;
  } catch {
    /* Edge 还没起来 */
  }
  await sleep(150);
}
if (!target) {
  edge.kill();
  console.error('Edge 没起来');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await ev('document.fonts.ready.then(() => true)');

const size = JSON.parse(
  await ev(`JSON.stringify({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`),
);
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: size.w, height: size.h, scale: SCALE },
});
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log(`saved ${OUT}  ${size.w * SCALE}x${size.h * SCALE}`);

fs.unlinkSync(HTML);
ws.close();
edge.kill();
process.exit(0);
