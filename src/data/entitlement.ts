/* ============================================================
 * bz-reader · 授权状态机（data/entitlement.ts）
 *
 * 三态：free / trial / paid。判定只看两件事——**活跃日数**和**激活码**。
 *
 * 2026-11-03 起**不对外提供试用**：底部 TRIAL_ACTIVE = false。活跃日统计、
 * 时钟回拨检测、trial 分支全部保留（数据还在记、改一个字就能恢复），只是
 * 不再生效、也不在任何界面出现「试用剩余 X 天」这类字。
 *
 * 为什么是「活跃日」不是「自然日」：
 *   自然日会因为出差、周末、生病白烧掉两三天，用户体感是「我还没怎么用
 *   就过期了」。活跃日只数「真的打开过的日子」，7 天就是 7 次真实使用。
 *
 * 为什么授权状态存 localStorage 而不是 storage/bz-reader.json：
 *   1. 插件目录是 per-vault 的，存 JSON 等于每个 vault 各试用一次；
 *   2. localStorage 跟插件目录无关，卸载重装插件不会清零（比重装就重置
 *      的试用更诚实）；
 *   3. 不污染 weave-data 同构的业务数据。
 *
 * 时钟回拨只做轻量识别：调时区、改系统时间都可能触发，所以要求
 * 「回拨超过 7 天」或「反复 3 次」才作废试用。规则要在设置页写出来，
 * 否则误伤之后没人能解释为什么试用没了。
 * ============================================================ */

import {
  parseLicense,
  parseToken,
  verifyLicense,
  verifyToken,
  type LicensePayload,
  type TokenPayload,
} from './license';

/** 高级能力。只有能判断的地方才列进来，别造没人问的开关。 */
export type Cap =
  | 'export' // 结构化导出 Markdown
  | 'card' // 书摘卡片
  | 'stats' // 阅读统计
  | 'crossSearch' // 跨书搜索
  | 'ai' // AI 摘要 / 释 / 译
  | 'fullFormats' // mobi / azw3 / fb2 / cbz
  | 'vertical' // 竖排 / 双栏
  | 'tts' // 朗读
  | 'parallel' // 并排 / 双语
  | 'bookmap' // 全书鸟瞰
  | 'bilink'; // 划线 → 双向链接
  // 'footnote' 已并入基础版（2026-11-03）：浮窗代码本来就在共享的 shell 里，
  // 留在 Cap 表里只会让设置页和对照表撒谎。

export type Tier = 'free' | 'trial' | 'paid';
export type Plan = 'lifetime' | 'year' | 'trial';

/** 试用长度：7 个活跃日。逻辑保留，但当前不对外发放（见 TRIAL_ACTIVE）。 */
export const TRIAL_DAYS = 7;

/**
 * 试用是否生效。
 *
 * 现在为 false：装完就是基础版，付费功能直接锁，界面上也一个字都不提试用。
 * 判定与计时代码全部保留——将来想恢复 7 天免费试用，把这里改成 true 即可，
 * 用户已经积累的活跃日会立刻接上。
 */
export const TRIAL_ACTIVE = false;

const LS_KEY = 'bzs-entitlement-v1';

/** 活跃日只留最近这么多天，够判断试用够没够，别无限长 */
const MAX_DAYS = 40;

interface Ent {
  /** 本机安装标识。不做设备上限，只用于将来「在线吊销」时认人 */
  installId: string;
  /** 有活动的日期（YYYY-MM-DD，本地时区），升序 */
  activeDays: string[];
  /** 见过的最大时间戳，用来识别时钟回拨 */
  lastSeenTs: number;
  /** 回拨次数 */
  clockAnomaly: number;
  /** 试用是否已被判废 */
  trialVoid: boolean;
  /**
   * 激活码原文。
   *
   * **只存码，不存结论**（plan / exp / name 一律从码里现解）：
   * 早先这三个字段是单独落盘的，于是「改 localStorage 把 exp 改成 0」
   * 就等于永久激活——连一枚真码都不需要。现在要伪造，只能造出一枚
   * 签名合法的码，而私钥不在插件里。
   */
  license: string;
  /** 上次验签时间，0 = 从没验过 */
  checkedTs: number;
  /**
   * 设备令牌原文（BZR3 码联网核销后拿到）。
   *
   * 和激活码同一条原则：只存原文、不存结论。kind / exp / iid 每次现解；
   * 启动时 verifyToken() 真验一次——手写一段 base64 塞进 localStorage 的
   * 假令牌会在那一步被清掉，退回基础版。
   */
  token: string;
  /** 令牌上次验签时间，0 = 没验过 */
  tokenCheckedTs: number;
}

export interface EntitlementView {
  tier: Tier;
  /** 高级功能是否可用（trial 与 paid 都为 true） */
  unlocked: boolean;
  /** 试用剩余天数（含今天）；非试用态为 0 */
  trialLeft: number;
  /** 已经用掉的活跃日 */
  trialUsed: number;
  plan?: Plan;
  exp: number;
  name?: string;
  license: string;
  /** 设备令牌原文；没有就是 '' */
  token: string;
  /** 令牌类型：通用码（试用）还是付费码 */
  kind?: 'universal' | 'paid';
  /** 试用是否因时钟异常被作废 */
  trialVoid: boolean;
  installId: string;
  days: string[];
}

let proBuild = false;
let cache: Ent | null = null;

/** 由 plugin.onload 注入：当前构建是不是 pro 包 */
export function setProBuild(v: boolean): void {
  proBuild = v;
}

function readLS(): string | null {
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeLS(raw: string): void {
  try {
    window.localStorage.setItem(LS_KEY, raw);
  } catch {
    /* 存不下不算错误：这次会话内仍用内存里的 cache */
  }
}

/**
 * 码 → payload 的内存缓存。
 *
 * can() 在每次重绘时都会被调用，而 parseLicense 里有 atob + JSON.parse；
 * 不缓存的话，一条 300 张卡片的重绘会白解 300 次同一枚码。
 */
const payloadCache = new Map<string, LicensePayload | null>();

function payloadOf(code: string): LicensePayload | null {
  if (!code) return null;
  const hit = payloadCache.get(code);
  if (hit !== undefined) return hit;
  const parsed = parseLicense(code)?.payload ?? null;
  payloadCache.set(code, parsed);
  return parsed;
}

/** 令牌 → payload 缓存，理由同上：can() 是同步的，每次重绘都会走到 */
const tokenCache = new Map<string, TokenPayload | null>();

function tokenOf(token: string): TokenPayload | null {
  if (!token) return null;
  const hit = tokenCache.get(token);
  if (hit !== undefined) return hit;
  const parsed = parseToken(token);
  tokenCache.set(token, parsed);
  return parsed;
}

function newInstallId(): string {
  // crypto.randomUUID 在桌面与移动端 Obsidian 都有；没有就退化成时间戳 + 随机
  try {
    return crypto.randomUUID();
  } catch {
    return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function defaults(): Ent {
  return {
    installId: newInstallId(),
    activeDays: [],
    lastSeenTs: 0,
    clockAnomaly: 0,
    trialVoid: false,
    license: '',
    checkedTs: 0,
    token: '',
    tokenCheckedTs: 0,
  };
}

function load(): Ent {
  if (cache) return cache;
  const d = defaults();
  const raw = readLS();
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<Ent>;
      if (typeof p.installId === 'string' && p.installId) d.installId = p.installId;
      if (Array.isArray(p.activeDays)) {
        d.activeDays = p.activeDays.filter((x): x is string => typeof x === 'string').sort().slice(-MAX_DAYS);
      }
      if (typeof p.lastSeenTs === 'number' && p.lastSeenTs > 0) d.lastSeenTs = p.lastSeenTs;
      if (typeof p.clockAnomaly === 'number') d.clockAnomaly = Math.max(0, p.clockAnomaly);
      if (p.trialVoid === true) d.trialVoid = true;
      if (typeof p.license === 'string') d.license = p.license;
      if (typeof p.checkedTs === 'number') d.checkedTs = p.checkedTs;
      if (typeof p.token === 'string') d.token = p.token;
      if (typeof p.tokenCheckedTs === 'number') d.tokenCheckedTs = p.tokenCheckedTs;
    } catch {
      /* 坏 JSON 就当没存过：宁可让老用户重新试用，也不要读出半条状态 */
    }
  }
  cache = d;
  return d;
}

function save(): void {
  if (cache) writeLS(JSON.stringify(cache));
}

/** 本机安装标识。核销时随请求发给服务端，用来去重与计数。 */
export function installId(): string {
  return load().installId;
}

/** 本地时区的 YYYY-MM-DD */
export function todayKey(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 记一次「今天用过了」。onload 调一次即可。
 * 顺带做时钟检查——这里是最早能拿到时间的地方。
 */
export function recordActivity(now = Date.now()): void {
  const e = load();
  const back = e.lastSeenTs - now;
  if (back > 12 * 3600_000) {
    e.clockAnomaly += 1;
    // 回拨超过 7 天，或反复三次：试用作废（仍可用已激活的码）
    if (back > 7 * 86_400_000 || e.clockAnomaly >= 3) e.trialVoid = true;
  }
  if (now > e.lastSeenTs) e.lastSeenTs = now;

  const key = todayKey(new Date(now));
  if (!e.activeDays.includes(key)) {
    e.activeDays.push(key);
    e.activeDays.sort();
    if (e.activeDays.length > MAX_DAYS) e.activeDays = e.activeDays.slice(-MAX_DAYS);
  }
  save();
}

/** 当前授权视图。同步——验签结果在 verify 之后写进来，别在这里做 async */
export function entitlement(now = Date.now()): EntitlementView {
  const e = load();
  const days = e.activeDays;
  const used = days.length;

  /* 三条来源，按优先级：
     1. v3 设备令牌（服务端签）——付费码给 paid，通用码给 trial
     2. v1/v2 老码（纯离线）——paid，已发出的码不作废
     3. 活跃日试用（TRIAL_ACTIVE，当前关闭，只留代码）

     同步判定只拆 payload，不验签；真验在启动时各做一次。
     所以「改 localStorage 伪造」挡不住同步读，但下次加载会被清掉。 */
  const payload = payloadOf(e.license);
  const codeExp = payload?.exp ?? 0;
  const codePaid = !!payload && payload.v !== 3 && e.checkedTs > 0 && (codeExp === 0 || codeExp > now);

  const tok = tokenOf(e.token);
  const tokenAlive =
    !!tok && e.tokenCheckedTs > 0 && tok.iid === e.installId && (tok.exp === 0 || tok.exp > now);
  const tokenPaid = tokenAlive && tok?.kind === 'paid';
  const tokenTrial = tokenAlive && tok?.kind === 'universal';

  // 第 1..TRIAL_DAYS 个活跃日都在试用内；第 TRIAL_DAYS+1 天开始结束
  // TRIAL_ACTIVE=false 时这一支永远不成立（试用不发放，但记录照旧）
  const trialAlive = TRIAL_ACTIVE && !e.trialVoid && used <= TRIAL_DAYS;
  const paid = codePaid || tokenPaid;
  const tier: Tier = paid ? 'paid' : tokenTrial || trialAlive ? 'trial' : 'free';

  /* 令牌试用按「到 exp 还剩几天」算；活跃日试用按已用天数算 */
  const left =
    tokenTrial && tok && tok.exp > 0
      ? Math.max(0, Math.ceil((tok.exp - now) / 86_400_000))
      : used <= 0
        ? TRIAL_DAYS
        : Math.max(0, TRIAL_DAYS - used + 1);

  const exp = tokenAlive && tok ? tok.exp : codeExp;

  return {
    tier,
    unlocked: tier !== 'free',
    trialLeft: tier === 'trial' ? left : 0,
    trialUsed: used,
    plan: tokenAlive && tok ? (tok.kind === 'paid' ? 'lifetime' : 'trial') : payload?.plan,
    exp,
    name: payload?.name,
    license: e.license,
    token: e.token,
    kind: tokenAlive && tok ? tok.kind : undefined,
    trialVoid: e.trialVoid,
    installId: e.installId,
    days,
  };
}

/**
 * 高级能力是否可用。
 *
 * 参数是「哪一样能力」，但**现在不按它细分**：卖的是买断制，付过一次就
 * 全部解锁，结论只看 `proBuild` + 授权状态。参数留着不是摆设——Cap 这张表
 * 本身在四处被用：设置页取名字、解锁层取文案、功能对照表取档位、动作取门槛
 * （`requireCap`）。真要按能力分级那天，改这一个函数就够。
 *
 * 基础版构建永远 false：包里根本没有高级模块（构建时就被换成空实现）。
 */
export function can(_cap: Cap): boolean {
  if (!proBuild) return false;
  return entitlement().unlocked;
}

/** 验签成功后写入。只存码——结论全部由码派生 */
export function setLicense(code: string): void {
  const e = load();
  const next = code.trim();
  /* 换了一枚码：旧令牌作废。同一枚码重新核销则保留，等 setToken 覆盖 */
  if (next !== e.license) {
    tokenCache.delete(e.token);
    e.token = '';
    e.tokenCheckedTs = 0;
  }
  e.license = next;
  e.checkedTs = next ? Date.now() : 0;
  payloadCache.delete(next);
  save();
}

/**
 * 启动时重验一遍码。
 *
 * 为什么非要有这一步：`entitlement()` 是**同步**的（can() 在每次重绘里调用），
 * 而 ECDSA 验签是异步的，所以运行期只能「拆 payload」不能「验签名」。
 * 于是「fake 一段 base64 的 {"v":2} 塞进 localStorage」就能骗过同步判定——
 * 这条不堵，前面那句「只存码不存结论」只是把门槛从改三个字段换成改一个字段。
 *
 * 堵法：每次加载异步真验一次。跑不过就清掉码，退回基础版。
 * 因为 localStorage 只在加载时读一次（之后走内存 cache），
 * 运行期改 localStorage 不会生效；要生效就得重载插件，而重载又会再验一次。
 *
 * 返回值给插件用来决定要不要通知界面重绘。
 */
export async function revalidateLicense(): Promise<boolean> {
  const e = load();
  if (!e.license) return false;
  const res = await verifyLicense(e.license);
  /* v3 码的 needRedeem 是正常状态（还没核销），不是「码坏了」——不能清 */
  if (res.ok || res.needRedeem) return false;
  clearCode();
  return true;
}

/** 只清激活码，不动令牌：v3 码过了兑换期，已发出的令牌还能走完 7 天 */
function clearCode(): void {
  const e = load();
  payloadCache.delete(e.license);
  e.license = '';
  e.checkedTs = 0;
  save();
}

/** 清掉激活码与令牌（退回免费判定） */
export function clearLicense(): void {
  clearCode();
  const e = load();
  tokenCache.delete(e.token);
  e.token = '';
  e.tokenCheckedTs = 0;
  save();
}

/** 核销成功后写入令牌。只存原文——结论全部由令牌派生 */
export function setToken(token: string): void {
  const e = load();
  tokenCache.delete(e.token);
  e.token = token.trim();
  e.tokenCheckedTs = e.token ? Date.now() : 0;
  save();
}

/** 清掉令牌（激活码留着，下次还能重新核销） */
export function clearToken(): void {
  const e = load();
  tokenCache.delete(e.token);
  e.token = '';
  e.tokenCheckedTs = 0;
  save();
}

/**
 * 启动时真验一遍令牌。理由同 revalidateLicense：
 * 同步判定只能拆 payload，手写的假令牌要在这里清掉。
 */
export async function revalidateToken(): Promise<boolean> {
  const e = load();
  if (!e.token) return false;
  const res = await verifyToken(e.token);
  if (res.ok) {
    /* 老版本或手工写入的状态可能没有 tokenCheckedTs：验过就补上，否则同步判定会当成没验过 */
    if (!e.tokenCheckedTs) {
      e.tokenCheckedTs = Date.now();
      save();
    }
    return false;
  }
  clearToken();
  return true;
}

/** 报错用的人话。 */
export function tierText(v: EntitlementView = entitlement()): string {
  if (v.tier === 'paid') {
    const who = v.name ? `（${v.name}）` : '';
    const until = v.exp ? `有效期到 ${new Date(v.exp).toLocaleDateString()}` : '永久有效';
    return `高级版已激活${who} · ${until}`;
  }
  if (v.tier === 'trial') {
    return v.trialLeft > 0 ? `试用中 · 还剩 ${v.trialLeft} 天` : '试用今天到期';
  }
  return '基础版';
}

/** 每个能力对应的卖点文案，解锁弹层与锁标 tooltip 共用 */
export const CAP_LABEL: Record<Cap, string> = {
  export: '把划线导出成结构化 Markdown',
  card: '把划线做成可分享的书摘卡片',
  stats: '阅读统计与热力图',
  crossSearch: '在所有书里搜索',
  ai: 'AI 摘要 · 解释 · 翻译',
  fullFormats: 'mobi / azw3 / fb2 / 漫画支持',
  vertical: '竖排与双栏',
  tts: '朗读',
  parallel: '原文与译文并排',
  bookmap: 'Book Map 全书鸟瞰',
  bilink: '把划线复制成双向链接',
};

/* ─────────── 发行信息（改这里就够了） ───────────
 * 购买与加群都走外链：Obsidian 商城不做内购，政策明确允许开发者在
 * 自己的渠道收款（只要 README 披露「完整功能需付费」）。
 * 价格只出现在商店页，不写进插件界面——面板里只有「去购买」。 */
export const PURCHASE_URL = 'https://afdian.com/a/bz-reader';
export const GROUP_URL = 'https://qm.qq.com/q/bzreader';

/* ─────────── 基础版 / 高级版功能对照 ───────────
 * 点任何付费按钮弹出的就是这张表。一屏讲完「差在哪」，
 * 比一段推销文案有效——用户自己会算。 */
export type PlanCell = 'yes' | 'no' | 'part';

export interface PlanRow {
  name: string;
  free: PlanCell;
  pro: PlanCell;
  /** 与 free/pro 并列的补充说明，例如「单条」「全部」 */
  note?: string;
  /** 这一行对应哪项能力：解锁弹层靠它高亮「你刚点的就是这个」 */
  cap?: Cap;
}

export const PLAN_TABLE: PlanRow[] = [
  { name: 'EPUB / TXT 阅读、翻页与排版', free: 'yes', pro: 'yes' },
  { name: '目录、书签、四色划线与想法', free: 'yes', pro: 'yes' },
  { name: '书内搜索（本章 / 全书）', free: 'yes', pro: 'yes' },
  /* 双向链接整条是高级版能力（copylink 走 requireCap('bilink')）。
     以前这里写「基础版：部分（仅单条）」，但那条免费路径 copylinkurl
     没有任何 UI 入口——表里承诺了，界面上找不到，比不给更糟。 */
  { name: '划线复制为双向链接（反链可见）', free: 'no', pro: 'yes', cap: 'bilink' },
  { name: '导出结构化 Markdown（按章节 + frontmatter）', free: 'no', pro: 'yes', cap: 'export' },
  { name: '书摘卡片（可分享图片）', free: 'no', pro: 'yes', cap: 'card' },
  { name: '阅读统计、热力图与每本进度', free: 'no', pro: 'yes', cap: 'stats' },
  { name: '跨书搜索', free: 'no', pro: 'yes', cap: 'crossSearch' },
  { name: 'AI 摘要 / 解释 / 翻译（自带 Key）', free: 'no', pro: 'yes', cap: 'ai' },
  { name: 'mobi / azw3 / fb2 / 漫画', free: 'no', pro: 'yes', cap: 'fullFormats' },
  { name: '竖排与双栏排版', free: 'no', pro: 'yes', cap: 'vertical' },
  { name: '朗读（TTS）', free: 'no', pro: 'yes', cap: 'tts' },
  { name: '原文与译文并排', free: 'no', pro: 'yes', cap: 'parallel' },
  { name: '脚注浮窗预览（不离开当前页）', free: 'yes', pro: 'yes' },
  { name: 'Book Map 全书鸟瞰', free: 'no', pro: 'yes', cap: 'bookmap' },
];
