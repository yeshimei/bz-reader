#!/usr/bin/env node
/**
 * scripts/community-review.mjs — 社区目录（community.obsidian.md）的登录、预览扫描与催检查
 *
 * 为什么要有它：上架的硬顺序是「推 master → Review branch 预览扫描 → 有 Error 就修 →
 * 打 tag 发 Release → 催 Check for new releases 并轮询到通过」。前两步和最后一步都在
 * 网页上，一次一次点很费手。这个脚本用本机 Edge 复用登录会话，把这三步变成一条命令。
 *
 * 官方没有提供 API/CLI，所有操作都在登录后的网页上；这里只做「点按钮 + 读结果」，
 * 走正常页面，不逆向接口、不并发刷请求。
 *
 * 用法：
 *   node scripts/community-review.mjs login                  # 首次：弹出 Edge，用 Obsidian 账号登录
 *   node scripts/community-review.mjs scan [--ref=master]    # 预览扫描（默认 master），有 Error 退出非零
 *   node scripts/community-review.mjs check [--timeout=600]  # 发 Release 后催目录检查，轮询到通过
 *   node scripts/community-review.mjs probe                  # 只打印页面控件（页面改版时排查用）
 *
 * 依赖：playwright-core 装在仓库外 `%LOCALAPPDATA%\bz-reader-community`，不碰项目 node_modules。
 * 登录态与浏览器 profile 也在那个目录（绝不入仓、不外传）。会话过期就重新 login。
 *
 * 设计取舍：
 *   · 默认有头：站点在 Cloudflare 后面，无头更容易被挑战；也方便你看它点了什么。
 *   · 只认文本不认 class：页面是 Next.js，class 名每次构建都变；按钮文字与 ARIA 稳定得多。
 *   · 找不到控件就报错退出，不静默成功——上架最怕「以为扫过了」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = 'https://community.obsidian.md';
const PLUGIN = 'bz-reader';
const DEPS = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'bz-reader-community',
);
const PROFILE = path.join(DEPS, 'edge-profile');
const SHOT = path.join(DEPS, 'last-shot.png');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

/* ── 小工具 ─────────────────────────────────────────────── */

const fail = (msg, code = 1) => {
  console.error(`\n✗ ${msg}`);
  process.exit(code);
};
const ok = (msg) => console.log(`✓ ${msg}`);
const step = (msg) => console.log(`\n▸ ${msg}`);

function arg(name, dflt = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

function loadChromium() {
  const require = createRequire(import.meta.url);
  const entry = path.join(DEPS, 'node_modules', 'playwright-core');
  try {
    return require(entry).chromium;
  } catch {
    fail(
      `没找到 playwright-core。先在仓库外装：\n` +
        `  npm install --prefix "${DEPS}" playwright-core\n` +
        `（只装这一次，以后直接跑本脚本。）`,
    );
  }
}

async function openBrowser({ headless = false } = {}) {
  const chromium = loadChromium();
  const executablePath = EDGE_CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!executablePath) fail('没找到系统 Edge，把 msedge.exe 路径写进 EDGE_CANDIDATES 再试。');
  fs.mkdirSync(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath,
    headless,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30_000);
  return { context, page };
}

/** 等页面进入登录后的 /account/ 区域；OAuth 会多次跳转，用轮询而不是单次 waitForURL */
async function waitLoggedIn(page, timeoutMs) {
  await page.waitForFunction(() => location.pathname.startsWith('/account/'), null, {
    timeout: timeoutMs,
    polling: 500,
  });
}

/** 页面可见文本（失败时截图留证） */
async function bodyText(page) {
  return page.evaluate(() => document.body.innerText || '');
}

async function shot(page) {
  try {
    await page.screenshot({ path: SHOT, fullPage: true });
    return SHOT;
  } catch {
    return '';
  }
}

/* ── login ──────────────────────────────────────────────── */

async function cmdLogin() {
  step('打开浏览器，请用 Obsidian 账号登录（登录后会自己继续）');
  const { context, page } = await openBrowser({ headless: false });
  try {
    await page.goto(`${BASE}/auth/login?returnTo=%2Faccount%2Fplugins%2F${PLUGIN}`, {
      waitUntil: 'domcontentloaded',
    });
    console.log('  · 账号密码 / 2FA 只在浏览器里输入，脚本不接触、不保存明文。');
    console.log('  · 登录完成后不要关窗口，等这一行变成 ✓。\n');
    await waitLoggedIn(page, 15 * 60 * 1000);
    ok('登录成功，会话已存在本机（下次 scan / check 直接复用）');
  } catch {
    const s = await shot(page);
    fail(`等了 15 分钟还没登录成功。${s ? `页面截图：${s}` : ''}`, 1);
  } finally {
    await context.close();
  }
}

/* ── probe（页面改版时用） ───────────────────────────────── */

async function cmdProbe() {
  const target = arg('url', `${BASE}/account/plugins/${PLUGIN}/review-branch`);
  const { context, page } = await openBrowser();
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/')) fail('登录态失效：先跑 `node scripts/community-review.mjs login`。');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const info = await page.evaluate(() => {
      const text = (el) => (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
      const describe = (el) => ({
        tag: el.tagName,
        cls: (el.getAttribute('class') || '').slice(0, 120),
        role: el.getAttribute('role') || '',
        aria: el.getAttribute('aria-label') || el.getAttribute('aria-expanded') || '',
        title: el.getAttribute('title') || '',
        href: el.getAttribute('href') || '',
        text: text(el).slice(0, 100),
      });
      /* 含 Commit 文本的行：往上找 5 层祖先，看哪一层可点 */
      const leaves = [...document.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && /Commit:/.test(el.textContent || ''),
      );
      const rows = leaves.slice(0, 2).map((el) => {
        const chain = [];
        let cur = el;
        for (let i = 0; i < 5 && cur; i += 1) {
          chain.push(describe(cur));
          cur = cur.parentElement;
        }
        return chain;
      });
      return {
        url: location.href,
        title: document.title,
        body: (document.body.innerText || '').slice(0, 3000),
        buttons: [...document.querySelectorAll('button, [role="button"]')]
          .map((el) => describe(el))
          .filter((x) => x.text || x.aria || x.title)
          .slice(0, 60),
        rows,
        inputs: [...document.querySelectorAll('input, select, textarea')].map((el) => ({
          tag: el.tagName,
          type: el.getAttribute('type') || '',
          placeholder: el.getAttribute('placeholder') || '',
          value: el.value || '',
        })),
      };
    });
    console.log(JSON.stringify(info, null, 2));
    const s = await shot(page);
    if (s) console.log(`\n截图：${s}`);
  } finally {
    await context.close();
  }
}

/** 列表第一条（可能是 Version 行或 Preview 行）的 commit 与状态 */
function latestReview(text) {
  const m = /Commit:\s*([0-9a-f]{6,})\s+(Pending|Completed|Failed|Passed)/i.exec(text);
  return m ? { commit: m[1], status: m[2] } : null;
}

/* ── scan（预览扫描） ────────────────────────────────────── */

/** 从 entry 页文本里取最新一条 Preview 的 commit 与状态（列表第一条） */
function latestPreview(text) {
  const m = /Preview[\s\S]{0,160}?Commit:\s*([0-9a-f]{6,})[\s\S]{0,20}?(Pending|Completed|Failed|Passed)/i.exec(
    text,
  );
  return m ? { commit: m[1], status: m[2] } : null;
}

/** 轮询列表，等最新一条 Preview 不再是 Pending；超时返回最后看到的状态。
 *  页面状态不会自己变（实测 2026-11-11）：每轮都要 reload 才看得到新状态。 */
async function waitPreviewDone(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    const hit = latestPreview(text);
    if (hit) {
      last = hit;
      if (!/pending/i.test(hit.status)) return hit;
    }
    await page.waitForTimeout(4000);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  return last;
}

/** 读展开后的扫描详情（Dependencies / Manifest / Releases / Source code / Build verification）。
 *  列表最新一条通常默认展开；没展开就点一下那一行。只截「分组标题」到下一个 Date 行之间，
 *  避免把历史记录或侧栏文字算进来。 */
async function readReviewDetail(page, commit) {
  const pick = async () => {
    const text = await bodyText(page);
    /* 分组标题是 CSS 大写（DEPENDENCIES 等），用大写精确匹配，避开侧栏小写的 releases */
    const start = text.search(/\b(DEPENDENCIES|MANIFEST|RELEASES|SOURCE CODE|BUILD VERIFICATION)\b/);
    if (start < 0) return '';
    const rest = text.slice(start);
    const end = rest.search(/\nDate:\s/);
    return end < 0 ? rest.slice(0, 6000) : rest.slice(0, end);
  };
  let detail = await pick();
  if (!detail) {
    await page
      .getByText(new RegExp(`Commit:\\s*${commit}`))
      .first()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(2000);
    detail = await pick();
  }
  return detail;
}

async function cmdScan() {
  const ref = arg('ref', 'master');
  const timeoutMs = Number(arg('timeout', '600')) * 1000;
  const { context, page } = await openBrowser();
  try {
    step(`预览扫描：${PLUGIN} @ ${ref}`);
    await page.goto(`${BASE}/account/plugins/${PLUGIN}/review-branch`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/')) fail('登录态失效：先跑 `node scripts/community-review.mjs login`。');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    /* 分支输入框：留空 = 默认分支；这里按 placeholder 找，找不到就按第一个文本框兜底 */
    const input = page.getByPlaceholder(/leave blank for default branch/i).first();
    const target = (await input.count()) ? input : page.locator('input[type="text"]').first();
    await target.fill(ref).catch(() => undefined);

    const runBtn = page.getByRole('button', { name: /run preview scan/i }).first();
    if (!(await runBtn.count())) {
      const s = await shot(page);
      fail(`没找到「Run preview scan」按钮（页面可能改版）。${s ? `截图：${s}` : ''}`, 2);
    }
    await runBtn.click();
    console.log('  · 已提交扫描，等它跑完（Pending → Completed，最长 ' + Math.round(timeoutMs / 60000) + ' 分钟）…');

    /* 提交后通常跳回 entry 页，列表第一条就是这次 Preview */
    const lookReady = page.waitForFunction(
      () => /preview/i.test(document.body.innerText || ''),
      null,
      { timeout: 60_000, polling: 1000 },
    );
    await lookReady.catch(() => undefined);

    const done = await waitPreviewDone(page, timeoutMs);
    if (!done) {
      const s = await shot(page);
      fail(`没在列表里找到这次预览扫描。${s ? `截图：${s}` : ''}`, 2);
    }
    if (/pending/i.test(done.status)) {
      const s = await shot(page);
      fail(`扫描一直停在 Pending（超过 ${Math.round(timeoutMs / 60000)} 分钟）。${s ? `截图：${s}` : ''}`, 2);
    }
    if (/failed/i.test(done.status)) {
      const detail = await readReviewDetail(page, done.commit);
      console.log(detail);
      fail(`扫描结果为 ${done.status}（commit ${done.commit}）。`, 3);
    }

    const detail = await readReviewDetail(page, done.commit);
    const s = await shot(page);
    console.log(`\n──── 扫描详情（${done.commit}，${done.status}）────`);
    console.log(detail || '(点击那条扫描后没读到详情，看截图)');
    console.log('────────────────────────────────');
    if (s) console.log(`截图：${s}`);

    const errors = (detail.match(/\bError\b/g) || []).length;
    const warnings = (detail.match(/\bWarning\b/g) || []).length;
    const recs = (detail.match(/\bRecommendation\b/g) || []).length;
    console.log(`Error ${errors} 处 · Warning ${warnings} 处 · Recommendation ${recs} 处`);
    if (errors > 0) fail('预览扫描有 Error，先按上面结果修，再重推重扫。', 3);
    ok(`预览扫描 ${done.commit} 没有 Error`);
  } finally {
    await context.close();
  }
}

/* ── latest（只读最近一次扫描结果，不提交） ──────────────── */

async function cmdLatest() {
  const timeoutMs = Number(arg('timeout', '600')) * 1000;
  const { context, page } = await openBrowser();
  try {
    await page.goto(`${BASE}/account/plugins/${PLUGIN}`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/')) fail('登录态失效：先跑 `node scripts/community-review.mjs login`。');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const done = await waitPreviewDone(page, timeoutMs);
    if (!done) fail('页面上没找到 Preview 记录。', 2);
    const detail = await readReviewDetail(page, done.commit);
    console.log(`最近一次预览：commit ${done.commit} · ${done.status}`);
    console.log(detail || '(没读到详情)');
    const errors = (detail.match(/\bError\b/g) || []).length;
    if (errors > 0) fail(`有 ${errors} 处 Error`, 3);
    ok('没有 Error');
  } finally {
    await context.close();
  }
}

/* ── report（点 Copy as Markdown 拿完整扫描报告） ─────────── */

async function cmdReport() {
  const limit = Number(arg('limit', '0')) || 0;
  const { context, page } = await openBrowser();
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => undefined);
    await page.goto(`${BASE}/account/plugins/${PLUGIN}`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/')) fail('登录态失效：先跑 `node scripts/community-review.mjs login`。');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const btns = page.locator('button[title="Copy as Markdown"]');
    const total = await btns.count();
    console.log(`Copy as Markdown 按钮：${total} 个`);
    if (!total) fail('没找到 Copy as Markdown 按钮（页面可能改版）。', 2);

    const n = limit ? Math.min(limit, total) : 1;
    const seen = new Set();
    for (let i = 0; i < n; i += 1) {
      const b = btns.nth(i);
      await b.scrollIntoViewIfNeeded().catch(() => undefined);
      await b.click().catch(() => undefined);
      await page.waitForTimeout(700);
      const md = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      if (!md) continue;
      const key = md.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`\n──── 报告 #${i + 1} ────`);
      console.log(md);
    }
    console.log('\n────────────────────────────');
    const all = [...seen].join('\n');
    const errors = (all.match(/\bError\b/g) || []).length;
    console.log(`去重后 ${seen.size} 份报告，Error ${errors} 处`);
    if (errors > 0) fail('报告里有 Error。', 3);
    ok('报告里没有 Error');
  } finally {
    await context.close();
  }
}

/* ── check（发 Release 后催目录检查） ─────────────────────── */

async function cmdCheck() {
  const timeoutMs = Number(arg('timeout', '600')) * 1000;
  const { context, page } = await openBrowser();
  try {
    step(`催目录检查：${PLUGIN}`);
    await page.goto(`${BASE}/account/plugins/${PLUGIN}`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/')) fail('登录态失效：先跑 `node scripts/community-review.mjs login`。');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const btn = page.getByRole('button', { name: /check for new releases/i }).first();
    if (await btn.count()) {
      await btn.click();
      console.log('  · 已点 Check for new releases');
    } else {
      /* 菜单里的同名项：先点 ... 再找 */
      const more = page.getByRole('button', { name: /more|\.\.\./i }).first();
      if (await more.count()) await more.click().catch(() => undefined);
      const item = page.getByText(/check for new releases/i).first();
      if (await item.count()) {
        await item.click();
        console.log('  · 已从菜单点 Check for new releases');
      } else {
        const s = await shot(page);
        fail(`没找到「Check for new releases」（页面可能改版）。${s ? `截图：${s}` : ''}`, 2);
      }
    }

    const before = latestReview(await bodyText(page))?.commit ?? '';
    if (before) console.log(`  · 点击前列表第一条：${before}`);

    /* 页面不会自己刷新：每轮 reload 一次，等列表第一条换成新 commit 且跑完 */
    const deadline = Date.now() + timeoutMs;
    let done = null;
    let last = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(4000);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      last = await bodyText(page);
      const hit = latestReview(last);
      if (hit && hit.commit !== before && !/pending/i.test(hit.status)) {
        done = hit;
        break;
      }
      if (hit && hit.commit === before) process.stdout.write('  · 目录还没发现新 Release…\n');
    }

    const s = await shot(page);
    if (!done) {
      console.log('\n──── 条目当前状态（节选）────');
      console.log(last.slice(0, 4000));
      console.log('────────────────────────────');
      if (s) console.log(`截图：${s}`);
      fail(`等了 ${Math.round(timeoutMs / 60000)} 分钟目录还没发现新 Release。先确认 Release 已正式发布，再点一次 check。`, 4);
    }

    const detail = await readReviewDetail(page, done.commit);
    console.log(`\n──── 最新一次目录扫描（${done.commit}，${done.status}）────`);
    console.log(detail || '(没读到详情，看截图)');
    console.log('────────────────────────────');
    if (s) console.log(`截图：${s}`);

    if (/failed/i.test(done.status)) fail(`目录扫描失败（commit ${done.commit}）。`, 3);
    const errors = (detail.match(/\bError\b/g) || []).length;
    console.log(`Error ${errors} 处`);
    if (errors > 0) fail('目录扫描有 Error，按上面结果改代码、涨补丁号重发（不挪已发 tag）。', 3);
    ok(`目录已扫描通过（commit ${done.commit}）`);
  } finally {
    await context.close();
  }
}

/* ── 入口 ───────────────────────────────────────────────── */

const cmd = process.argv[2] || '';
const run = () =>
  cmd === 'login'
    ? cmdLogin()
    : cmd === 'probe'
      ? cmdProbe()
      : cmd === 'scan'
        ? cmdScan()
        : cmd === 'latest'
          ? cmdLatest()
          : cmd === 'report'
            ? cmdReport()
            : cmd === 'check'
              ? cmdCheck()
              : fail(
                  '用法：node scripts/community-review.mjs <login|scan|latest|report|check|probe> [--ref=master] [--timeout=600]',
                );

run().catch((e) => fail(e?.stack || String(e), 1));
