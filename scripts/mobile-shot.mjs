#!/usr/bin/env node
/**
 * 桌面端「移动形态」验收：把 Obsidian 摆成手机布局，截图。
 *
 * 真机一轮要打包、装机、截图，几分钟；移动端的样式与布局问题绝大多数能在这里
 * 先看出来。原理是 Obsidian 自带的 `app.emulateMobile(true)`——它把移动布局的
 * 标记写进 localStorage 再 reload，之后 `Platform.isMobile === true`，
 * `isMobileEnv()` / `isShellMobile()` 全部走真机分支（正文上下留白、弹层形态、
 * 两指手势都是移动端那一套），比单纯缩窗口 + `force-mobile` 更接近真机。
 *
 * 前置：Obsidian 桌面版要带调试端口启动——
 *   "D:\Apps\Obsidian\Obsidian.exe" --remote-debugging-port=9222
 * 已在运行的话先确认 http://127.0.0.1:9222/json/list 能列到页面。
 *
 * 用法：
 *   node scripts/mobile-shot.mjs --emulate on                 # 进入移动布局（会 reload）
 *   node scripts/mobile-shot.mjs --emulate off                # 退出
 *   node scripts/mobile-shot.mjs --reload                     # 重载 bz-reader 插件
 *   node scripts/mobile-shot.mjs .shot.png --eval="..."       # 截图（可先跑一段 JS）
 *
 * 参数：
 *   --vault=NAME    目标库（按窗口标题匹配，默认 "bz reader"）
 *   --size=WxH      视口，默认 390x844
 *   --dpr=N         像素比，默认 3（截图 ≈1170×2532，和主流手机一致）
 *   --eval=JS       截图前在页面里执行，可重复
 *   --wait=MS       执行 --eval 后等多久再截，默认 800
 *   --port=N        CDP 端口，默认 9222
 */
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const evals = argv.filter((a) => a.startsWith('--eval=')).map((a) => a.slice(7));
const out = argv.find((a) => !a.startsWith('--')) ?? null;
const port = Number(arg('port', 9222));
const vault = arg('vault', 'bz reader');
const [vw, vh] = arg('size', '390x844').split('x').map(Number);
const dpr = Number(arg('dpr', 3));
const wait = Number(arg('wait', 800));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.title.includes(vault));
  if (!page) throw new Error(`找不到库「${vault}」的窗口：Obsidian 要带 --remote-debugging-port=${port} 启动`);
  return page;
}

async function connect() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  return {
    send: (method, params = {}) =>
      new Promise((r) => {
        const id = ++seq;
        pending.set(id, r);
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'eval 失败');
  return r.result?.result?.value;
}

const emulate = arg('emulate', null);

if (emulate) {
  const cdp = await connect();
  await evaluate(cdp, `app.emulateMobile(${emulate === 'on'}); 1`);
  cdp.close();
  /* emulateMobile 会 reload 整个 app，等它回来再确认 */
  await sleep(9000);
  const back = await connect();
  const mobile = await evaluate(back, `app.isMobile`);
  back.close();
  console.log(`emulateMobile(${emulate === 'on'}) → isMobile=${mobile}`);
  process.exit(mobile === (emulate === 'on') ? 0 : 1);
}

if (argv.includes('--reload')) {
  const cdp = await connect();
  await evaluate(
    cdp,
    `(async () => { await app.plugins.disablePlugin('bz-reader'); await app.plugins.enablePlugin('bz-reader'); return 'ok'; })()`,
  );
  cdp.close();
  console.log('bz-reader 已重载');
  if (!out) process.exit(0);
}

const cdp = await connect();
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: vw,
  height: vh,
  deviceScaleFactor: dpr,
  mobile: false,
});
await sleep(300);

for (const js of evals) {
  const v = await evaluate(cdp, js);
  console.log('eval →', typeof v === 'string' ? v : JSON.stringify(v));
  await sleep(wait);
}

if (!out) {
  const state = await evaluate(
    cdp,
    `JSON.stringify({ vault: app.vault.getName(), mobile: app.isMobile, w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`,
  );
  console.log(state);
  cdp.close();
  process.exit(0);
}

const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(`已截图 ${out}`);
cdp.close();
