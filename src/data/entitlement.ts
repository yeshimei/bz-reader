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
 * 为什么授权状态存插件目录的 `data.json` 而不是业务 JSON（2026-11-04 改）：
 *   1. **不能进随库同步的那份**：一份码跟着库走到所有设备 = 一份授权无限
 *      复制，也违背 README 的「换电脑重新填一次激活码」。
 *   2. **不能只放 localStorage**：清缓存 / 重装 / iOS 回收存储都会把它
 *      干掉，付费用户某天打开发现变回基础版，还得翻邮件找码。文件不会
 *      被浏览器回收。
 *   3. 不污染 weave-data 同构的业务数据——`bz-reader/storage/bz-reader.json` 是
 *      用户会自己打开、复制、发给别人看的东西。
 *
 * localStorage 仍然写一份**镜像**：删掉插件目录重装时，data.json 没了而
 * 镜像还在。读取以 data.json 为准，只有它为空时才看镜像（见 load()）。
 *
 * 时钟回拨只做轻量识别：调时区、改系统时间都可能触发，所以要求
 * 「回拨超过 7 天」或「反复 3 次」才作废试用。规则要在设置页写出来，
 * 否则误伤之后没人能解释为什么试用没了。
 * ============================================================ */

import { locale, t, type Locale } from '../i18n';
import { planNameZh, type PlanGroupKey, type PlanKey } from '../i18n/plan';
import { compareVersions } from '../core/version';
import {
  isTrialCode,
  parseLicense,
  trialDaysLeft,
  verifyLicense,
  type LicenseFail,
  type LicensePayload,
} from './license';
import { ensureLatestVersion } from './plugin-update';
import { checkRevoked, revokedCode } from './revoked';
import type { BookFormat } from './schema';

/** 高级能力。只有能判断的地方才列进来，别造没人问的开关。 */
export type Cap =
  | 'poster' // 阅读海报（书摘图片 2026-11-10 下放基础版，不再需要能力位）
  | 'stats' // 阅读统计
  | 'crossSearch' // 跨书搜索
  /**
   * 划词 AI 2026-11-22 拆开卖：解释 / 翻译 / 摘要下放基础版，只剩追问收费。
   *
   * 这里不再留 `aiSel`——免费的行挂着能力位，弹层就会把人往一个已经
   * 不要钱的功能上引；追问有自己的 `aiAsk`，被拦时才能亮到正确那一行。
   */
  | 'ai' // 侧栏 AI：全书问答
  | 'aiAsk' // 划词追问：就这一段接着问
  | 'kb' // BZ AI 知识盒（划词录入 / 笔记当依据；行名按 bz 的文案）
  | 'fullFormats' // mobi / azw3 / fb2 / cbz（PDF 2026-11-10 起单列，见 pdf）
  | 'vertical' // 竖排（双栏已于 2026-11-05 下放基础版，不再挂在这个能力上）
  /**
   * 朗读 · 预生成（2026-11-14 分级）。
   *
   * 朗读本体已下放基础版：点一下就念、逐句高亮、自动翻页、导出本章音频
   * 都不设门。这道门只剩「整章预生成」——先把这一章的音频备好再听。
   */
  | 'tts'
  /** 朗读 · 整本预生成（2026-11-14）。与整章分开，弹层才能高亮对那一行 */
  | 'ttsBook'
  /* 并排对照 2026-11-22 下放基础版：两边各挂一套引擎，不产生额外成本，
     挡在门外只是把功能藏起来。 */
  /* 全书鸟瞰 2026-11-21 下放基础版：它只读画像做一张总览，不产生额外成本，
     留在 Cap 表里会让「基础版点不开鸟瞰」和对照表上那个勾对不上。 */
  | 'bilink' // 划线 → 双向链接
  /**
   * 引用页签（2026-11-12 从 bilink 拆出来）。
   *
   * 它列的是「笔记里指向本书具体位置的链接」，与「把划线做成链接」是两件事。
   * 以前两项共用 bilink：基础版点引用页签被拦，弹层点亮的却是双链那一行。
   * 授权判定不按能力位细分（有码全解锁），这里只负责让弹层高亮对得上
   * 用户刚点的那一行。
   */
  | 'cites'
  | 'aiChat' // AI 伴读：追问 / 导读 / 补全
  /**
   * AI 对话留档并导出至笔记（2026-11-16 从 aiChat 拆出来）。
   *
   * 两件事以前挤在 `aiChat` 一行：「边读边问、按章导读」讲的是伴读，
   * 「留档 + 导出到笔记」讲的是把聊过的东西留住。对照表定稿把它们写成
   * 两行之后，共用一道门就回到 2026-11-12 引用页签那个老毛病——
   * 点「导出到笔记」被拦，弹层点亮的是「AI 伴读」，用户看的不是自己刚点的那行。
   *
   * 授权判定不按能力位细分（有码全解锁），这里只负责高亮对得上。
   */
  | 'aiLog'
  | 'semantic' // 语义搜索：本书与全库，按意思找
  /* 剪藏成书 2026-11-22 下放基础版：把剪藏本合成 EPUB 本身不产生成本，
     挡在门外只是把功能藏起来。设置页那颗开关也不再显示「高级版」。 */
  /** 漫画模式（2026-11-15 从探索中转正）：分格、右到左、跨页 */
  | 'manga'
  /**
   * PDF 整段（2026-11-10）。
   *
   * 和别的 cap 不一样：它代表**一整段**，不是某颗按钮。原因是基础版
   * 根本进不了 PDF，缩略图 / 导出页图 / 反链这些动作对他们不存在，给每行
   * 各配一个能力位只是摆样子。除了扫描页识别（自己有 `pdfOcr`，按页计费），
   * 整段共用一个拦点（打开 PDF）——被拦时高亮段首那一行，用户就知道
   * 「PDF 这一整块要买」。
   */
  | 'pdf'
  /**
   * 扫描页识别（2026-11-15 从「探索中」转正）。
   *
   * 与 `pdf` 分开：它按页计费（视觉模型 / 外部 OCR 都是真金白银），
   * 用户在对照表里也该单独看见这一行。所有会发识别请求或改动识别结果的
   * 动作（单页 / 批量 / 整本 / 重试 / 连接测试 / 清除）都过这道门，
   * 读普通 PDF 不受影响。
   */
  | 'pdfOcr';
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
  /*
   * ↓ 2026-11-22 起多存的四笔，**全是观测数据，不是授权结论**。
   *
   * 授权真相仍然只看 `license` + 启动时那次真验签（`entitlement()` 里现算），
   * 所以手改这里的 `revoked` 不会解封——它只会让 bz 的统计看错一眼。
   * 反过来也不行：这里写 true 也不会凭空把人降级，判定仍走 data/revoked
   * 的本地标记。两边各自独立。
   *
   * 为什么非要落盘：bz 主插件的探针读的是这份 data.json，读不到内存。
   */
  /** 这枚码是否已被停用名单判死 */
  revoked: boolean;
  /** 被判死的时刻（0 = 没判死过） */
  revokedAt: number;
  /** 当前档位的成因：none / expired / revoked / invalid / ok */
  tierReason: string;
  /** 上次激活失败的原因（只记分类，绝不记码原文） */
  activateFail: string;
  /** 上次激活失败的时刻 */
  activateFailAt: number;
}

export interface EntitlementView {
  tier: Tier;
  /** 高级功能是否可用（trial 与 paid 都为 true） */
  unlocked: boolean;
  /**
   * 这枚码验过签了没有。
   *
   * `entitlement()` 是同步的，只能拆 payload 不能验签；而 payload 是码里的
   * 明文，手写一段 `{"v":2}` 的 base64 就能骗过同步判定。所以「有码、有
   * payload、checkedTs > 0」这一组条件必须再加一道「启动时真的验过了」。
   *   · pending：还没验（启动后、revalidateLicense 返回前）
   *   · ok：签名有效（过期也算 ok——码是真的，放不放行由 exp 说）
   *   · failed：验不过 / 验签环境异常
   */
  verify: 'pending' | 'ok' | 'failed';
  /** 试用剩余天数（含今天）；非试用态为 0 */
  trialLeft: number;
  /** 已经用掉的活跃日 */
  trialUsed: number;
  plan?: Plan;
  exp: number;
  name?: string;
  /**
   * 这枚码是不是试用码（payload.plan === 'trial'）。
   *
   * 与 `tier` 分开存：试用码解锁后 tier 仍是 paid（码是真的、在有效期内），
   * 但界面必须说「试用」而不是「高级版已激活」，否则用户以为已经买断。
   */
  trial: boolean;
  /** 试用剩余天数（向上取整）；非试用 / 已过期 / 无到期时间为 0 */
  trialDaysLeft: number;
  /** 线上最新版（试用判定与更新提醒共用）；空 = 还没拿到 */
  latestVer: string;
  /**
   * 试用码的「必须最新版」判定（2026-11-22）。
   *
   *   none      不是试用码，或已确认当前就是最新版
   *   outdated  线上有新版本 → 锁高级功能，提示先更新
   *   unknown   还没拿到线上版本（离线 / 两个源都不通）→ 锁，提示联网
   *
   * 三种情况都**保留码**：更新完 / 网络恢复后下次启动自动恢复，
   * 用户不用重新找码。
   */
  trialBlock: 'none' | 'outdated' | 'unknown';
  /** 赞助人码（payload.patron === true）：设置页「关于」条据此多画一枚徽章 */
  patron: boolean;
  license: string;
  /**
   * 这枚码已进停用名单（2026-11-22）。
   *
   * 与 `expired` 不同：过期是「时间到了」，停用是「作者叫停了」。两者都不
   * 放行，但码的处理相反——过期保留码等续费，停用也保留码等解封，只有
   * 「签名是假的」才清码。判定来源是本地那份停用标记（`data/revoked`），
   * 同步可读，所以每帧都能算。
   */
  revoked: boolean;
  /** 码号（payload.id）：停用提示与申诉时报这个，不报码原文 */
  licenseId?: string;
  /** 试用是否因时钟异常被作废 */
  trialVoid: boolean;
  installId: string;
  days: string[];
}

let proBuild = false;
let cache: Ent | null = null;

/**
 * 当前插件版本。由 plugin.onload 尽早注入，试用码的「必须最新版」判定靠它。
 *
 * 空串 = 拿不到版本（开发构建、纯函数测试）：**此时不判版本**，否则所有
 * 试用码都会变成「不是最新版」。真机上 onload 第一步就注入，不存在空窗。
 */
let pluginVersion = '';

/**
 * 线上最新版。由 `ensureLatestVersion()` 在启动 / 激活 / 更新检查时写入，
 * 更新提醒与试用判定共用同一份缓存（见 data/plugin-update）。
 */
let latestVersion = '';

/** 注入最新版（测试与启动流程用） */
export function setLatestVersion(v: string): void {
  latestVersion = String(v || '').trim();
}

/**
 * 验签状态。**每次进程启动从 pending 开始**——不给「沿用上次结论」留口子：
 * 以前 env-error 会保留上一次的成功结论，于是「让 WebCrypto 抖一下」就等于
 * 永久解锁。现在只有真的验过才放行。
 */
let verifyState: EntitlementView['verify'] = 'pending';

/**
 * 存储后端。由 plugin.onload 注入，指向 `data.json` 的 `entitlement` 字段。
 *
 * 两个方法都是**同步**的：`entitlement()` 在每次重绘里被调用，等不了 await。
 * 宿主的做法是启动时 `await loadData()` 把整份配置读进内存，之后
 * `write()` 只改内存对象，真正的落盘由宿主自己防抖。
 */
export interface EntBackend {
  /** 读原始快照（对象或 JSON 字符串都行；null / 坏数据由这里兜） */
  read(): unknown;
  /** 写原始快照。宿主负责落盘，这里不 await */
  write(raw: unknown): void;
}

let backend: EntBackend | null = null;

/**
 * 换后端（也用来在测试里隔离）。
 *
 * 传 null 退回「只写 localStorage」的老行为——基础版构建和纯函数测试用得上。
 */
export function setEntBackend(b: EntBackend | null): void {
  backend = b;
  cache = null;
  payloadCache.clear();
  /* 换后端 = 换了一份授权来源（启动 / 测试隔离）：验签结论不能跟着串过去 */
  verifyState = 'pending';
}

/** 由 plugin.onload 注入：当前构建是不是 pro 包 */
export function setProBuild(v: boolean): void {
  proBuild = v;
}

/**
 * 由 plugin.onload 注入：当前插件版本（`manifest.version`）。
 *
 * 不用 `setProBuild` 那种「变了要清缓存」的处理：版本只影响试用码的判定，
 * `entitlement()` 每次重算都会读它，改了下一帧就生效（测试里靠这条断言
 * 「升级到下一个小版本立刻降级」）。
 */
export function setPluginVersion(v: string): void {
  pluginVersion = String(v || '').trim();
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
    revoked: false,
    revokedAt: 0,
    tierReason: '',
    activateFail: '',
    activateFailAt: 0,
  };
}

/**
 * 把一份原始快照灌进 `d`。读到东西返回 true。
 *
 * 兼容三种来源：data.json 里的对象、localStorage 里的 JSON 字符串、
 * 以及手改坏了的半截数据。任何一个字段类型不对就单独忽略，不整体丢弃——
 * 「码还在但活跃日坏了」不该让用户重新激活。
 */
function applyEnt(d: Ent, raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return false;
  let p: Partial<Ent> | null = null;
  try {
    p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<Ent>;
  } catch {
    return false;
  }
  if (!p || typeof p !== 'object') return false;
  if (typeof p.installId === 'string' && p.installId) d.installId = p.installId;
  if (Array.isArray(p.activeDays)) {
    d.activeDays = p.activeDays.filter((x): x is string => typeof x === 'string').sort().slice(-MAX_DAYS);
  }
  if (typeof p.lastSeenTs === 'number' && p.lastSeenTs > 0) d.lastSeenTs = p.lastSeenTs;
  if (typeof p.clockAnomaly === 'number') d.clockAnomaly = Math.max(0, p.clockAnomaly);
  if (p.trialVoid === true) d.trialVoid = true;
  if (typeof p.license === 'string') d.license = p.license;
  if (typeof p.checkedTs === 'number') d.checkedTs = p.checkedTs;
  /* 观测字段：类型不对就当没见过，不猜 */
  if (typeof p.revoked === 'boolean') d.revoked = p.revoked;
  if (typeof p.revokedAt === 'number' && p.revokedAt > 0) d.revokedAt = p.revokedAt;
  if (typeof p.tierReason === 'string') d.tierReason = p.tierReason.slice(0, 12);
  if (typeof p.activateFail === 'string') d.activateFail = p.activateFail.slice(0, 12);
  if (typeof p.activateFailAt === 'number' && p.activateFailAt > 0) d.activateFailAt = p.activateFailAt;
  return true;
}

/**
 * 读状态。优先 `data.json`，它为空时才看 localStorage 镜像。
 *
 * 顺序不能反：镜像可能是一年前的旧码（用户换了码、重装过），
 * 拿它覆盖文件里的真值等于把「已续费」回滚成「已过期」。
 */
function load(): Ent {
  if (cache) return cache;
  const d = defaults();
  const fromFile = backend ? applyEnt(d, backend.read()) : false;
  if (!fromFile) {
    // data.json 里没有（全新用户 / 删了插件目录重装）：镜像兜一次
    const raw = readLS();
    if (raw) applyEnt(d, raw);
  }
  cache = d;
  return d;
}

/**
 * 存状态。**两边都写**：data.json 是真相，localStorage 是删插件目录
 * 重装后的兜底。写文件失败不抛——宿主那边还有自己的告警。
 */
function save(): void {
  if (!cache) return;
  const snap: Ent = { ...cache, activeDays: [...cache.activeDays] };
  try {
    backend?.write(snap);
  } catch {
    /* 宿主写内存失败不该拦住翻页 */
  }
  writeLS(JSON.stringify(snap));
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

  const payload = payloadOf(e.license);
  const exp = payload?.exp ?? 0;
  const verified = verifyState === 'ok';
  /* 试用码要求当前必须是最新版（2026-11-22）：最新版是联网拿的，
     拿不到（离线 / 两个源都不通）也锁——否则拔网就能让落后版本继续用。
     只有验过的码才判；插件版本未知（开发构建 / 纯函数测试）时不判。 */
  const trial = isTrialCode(payload);
  const trialLeft = trial ? trialDaysLeft(exp, now) : 0;
  const outdated =
    verified && trial && !!pluginVersion && !!latestVersion && compareVersions(pluginVersion, latestVersion) < 0;
  const trialBlock: EntitlementView['trialBlock'] = !trial
    ? 'none'
    : outdated
      ? 'outdated'
      : !latestVersion
        ? 'unknown'
        : 'none';
  /* 停用名单命中：签名仍然是真的，只是作者叫停了这枚码。与过期同一档处理——
     保留码、只降级，解封后下次启动自动恢复，用户不用翻邮件重新找码。 */
  const revoked = !!e.license && revokedCode() === e.license;
  const paid =
    verified &&
    !!payload &&
    e.checkedTs > 0 &&
    (exp === 0 || exp > now) &&
    !revoked &&
    trialBlock === 'none';

  // 第 1..TRIAL_DAYS 个活跃日都在试用内；第 TRIAL_DAYS+1 天开始结束
  // TRIAL_ACTIVE=false 时这一支永远不成立（试用不发放，但记录照旧）
  const trialAlive = TRIAL_ACTIVE && !e.trialVoid && used <= TRIAL_DAYS;
  /* 没有「开发构建强制基础版」这一层了（2026-11-12）：那条命令改成真降级
     （清码），授权判定只剩真实码这一个真相。否则覆盖一旦生效就再也解不掉，
     重新填码也不认——就是这次修的 bug。 */
  const tier: Tier = paid ? 'paid' : trialAlive ? 'trial' : 'free';

  const left = used <= 0 ? TRIAL_DAYS : Math.max(0, TRIAL_DAYS - used + 1);

  return {
    tier,
    unlocked: tier !== 'free',
    verify: verifyState,
    trialLeft: tier === 'trial' ? left : 0,
    trialUsed: used,
    plan: payload?.plan,
    exp,
    name: payload?.name,
    trial,
    trialDaysLeft: trialLeft,
    latestVer: latestVersion,
    trialBlock,
    patron: payload?.patron === true,
    license: e.license,
    revoked,
    licenseId: typeof payload?.id === 'string' ? payload.id : undefined,
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
  e.license = code.trim();
  e.checkedTs = e.license ? Date.now() : 0;
  payloadCache.delete(e.license);
  /* activateLicense 只在验签通过后调这里，所以此刻结论就是 ok */
  verifyState = 'ok';
  save();
  refreshFacts();
}

/* ── 授权事实（2026-11-22，给 bz 的探针读）───────────────────────────
 * 这四笔**只影响统计**，不参与任何放行判定：授权真相仍是「码 + 启动时真验签」，
 * 停用真相仍是 data/revoked 的本地标记。两边各自独立，手改这里既解不了封，
 * 也不会把人误降级——但会让看板看错，所以只在真发生时才写。
 */

/** 当前档位成因：没码 / 到期 / 被封 / 码坏了 / 正常 */
function tierReasonNow(): string {
  const e = load();
  if (!e.license) return 'none';
  const v = entitlement();
  if (v.revoked) return 'revoked';
  if (v.verify !== 'ok' || !v.licenseId && !v.plan) {
    /* 验签没过、解不开：码本身不可信。老码 BZR1 没有 id 但有 plan，别误判 */
    if (v.verify !== 'ok') return 'invalid';
  }
  if (v.exp && Date.now() > v.exp) return 'expired';
  return 'ok';
}

/**
 * 重算并落盘档位成因与停用标记。
 *
 * 在几个「授权可能刚变过」的节点调：激活成功、启动重验、名单核对回来。
 * 变了才写盘——`entitlement()` 每次重绘都会调，不能顺手就存。
 */
export function refreshFacts(): void {
  const e = load();
  const reason = tierReasonNow();
  const revoked = entitlement().revoked;
  if (e.tierReason === reason && e.revoked === revoked) return;
  e.tierReason = reason;
  e.revoked = revoked;
  save();
}

/**
 * 命中停用名单：记一笔。
 *
 * `revokedAt` 只认第一次——探针要算「封了几天还没掉」，每次核对都刷新时刻
 * 会让这个数永远是 0 天。
 */
export function noteRevoked(): void {
  const e = load();
  if (!e.license) return;
  const needSave = !e.revoked || e.tierReason !== 'revoked' || !e.revokedAt;
  e.revoked = true;
  if (!e.revokedAt) e.revokedAt = Date.now();
  e.tierReason = 'revoked';
  if (needSave) save();
}

/** 解封：清掉停用标记（版本号在 data/revoked 那边留着，不影响这里） */
export function clearRevokedMark(): void {
  const e = load();
  if (!e.revoked && !e.revokedAt) return;
  e.revoked = false;
  e.revokedAt = 0;
  save();
}

/**
 * 记一次激活失败。传空串 = 清空（激活成功时调）。
 *
 * 只记分类，**绝不记码原文**：这份 data.json 会被同库的 bz 读走。
 */
export function noteActivateFail(fail: string): void {
  const e = load();
  if (!fail) {
    if (!e.activateFail && !e.activateFailAt) return;
    e.activateFail = '';
    e.activateFailAt = 0;
    save();
    return;
  }
  e.activateFail = fail.slice(0, 12);
  e.activateFailAt = Date.now();
  save();
}

/**
 * 激活一个码：验签 → 联网核对停用名单 → 试用码再核最新版 → 通过才落盘。
 *
 * 2026-11-22 起**第一次激活必须联网核对一次**：离线签名只能证明「这枚码
 * 是作者发的」，证明不了「它现在还有效」。试用码还多一道：必须是最新版
 * 才能激活——拉不到最新版就明确要求联网，不悄悄放行。
 * 已经激活过的用户不受影响：启动时拉不到名单照常可用（见 plugin.onload）。
 *
 * 命中停用 / 不是最新版时**都不清码**：只降级 + 记本地标记。更新完 /
 * 解封后下次启动自动恢复，用户不必翻邮件重新找码。
 */
export async function activateLicense(
  code: string,
): Promise<{ ok: boolean; message: string; revoked?: boolean }> {
  const res = await verifyLicense(code);
  if (!res.ok) {
    /* 只记分类给探针看：格式不对让他检查粘贴，其余都算「码不认」 */
    noteActivateFail(res.reason === 'expired' ? 'expired' : res.reason === 'format' ? 'format' : 'invalid');
    return { ok: false, message: res.message };
  }

  const clean = code.trim();
  /* 本地已判死的码：断网也贴不回来，不必再等一次网络 */
  if (revokedCode() === clean) {
    noteActivateFail('revoked');
    return { ok: false, message: t('license.revoked'), revoked: true };
  }

  const verdict = await checkRevoked(clean);
  if (verdict === 'hit') {
    noteActivateFail('revoked');
    noteRevoked();
    return { ok: false, message: t('license.revoked'), revoked: true };
  }
  if (verdict === 'unknown') {
    noteActivateFail('offline');
    return { ok: false, message: t('license.needOnline') };
  }

  /* 试用码必须是最新版。跟停用名单分开报：一个是「这码被叫停」，
     一个是「码没问题，你先把插件更新了」。 */
  if (isTrialCode(res.payload)) {
    const latest = await ensureLatestVersion();
    if (latest) setLatestVersion(latest);
    if (!latest) return { ok: false, message: t('license.needLatest') };
    if (pluginVersion && compareVersions(pluginVersion, latest) < 0) {
      return { ok: false, message: t('license.outdated', { now: pluginVersion, latest }) };
    }
  }

  noteActivateFail('');
  setLicense(clean);
  return { ok: true, message: res.message };
}

/**
 * 启动时重验一遍码。
 *
 * 为什么非要有这一步：`entitlement()` 是**同步**的（can() 在每次重绘里调用），
 * 而 ECDSA 验签是异步的，所以运行期只能「拆 payload」不能「验签名」。
 * 于是「fake 一段 base64 的 {"v":2} 塞进 localStorage」就能骗过同步判定——
 * 这条不堵，前面那句「只存码不存结论」只是把门槛从改三个字段换成改一个字段。
 *
 * 堵法：每次加载异步真验一次。
 * 因为授权状态只在加载时读一次（之后走内存 cache），运行期改
 * data.json / localStorage 不会生效；要生效就得重载插件，而重载又会再验一次。
 *
 * **失败不能一律清码**（2026-11-04 改）：
 *   invalid / format / no-pubkey → 这枚码本身是假的，清掉
 *   expired                     → 签名是真的，只是到期。保留码只降级
 *                                 （entitlement() 自己按 exp 算），续费后
 *                                 不用重新找码
 *   env-error                   → 验签环境抖了（WebCrypto 缺失 / 抛错），
 *                                 码不动，但**也不放行**（`verify: failed`）：
 *                                 沿用上次「已激活」的结论等于给伪造开了扇门
 *
 * 返回值给插件用来决定要不要通知界面重绘。
 */
export async function revalidateLicense(): Promise<{ changed: boolean; reason?: LicenseFail }> {
  const e = load();
  if (!e.license) {
    /* 没码就没有要验的东西：这不是「验不过」，别让界面显示「授权异常」 */
    verifyState = 'ok';
    refreshFacts();
    return { changed: false };
  }
  const res = await verifyLicense(e.license);
  if (res.ok) {
    /* 试用码要联网确认最新版。等这一次：`can()` 首帧就要正确结论，
       先放行再锁会闪一下；永久码不走这里，启动不受影响。 */
    if (isTrialCode(res.payload)) {
      const latest = await ensureLatestVersion();
      if (latest) setLatestVersion(latest);
    }
    verifyState = 'ok';
    refreshFacts();
    return { changed: false };
  }
  /* 过期是「码是真的、只是现在不可用」：保留码、只降级。
     续费后下次启动自动恢复。 */
  if (res.reason === 'expired') {
    verifyState = 'ok';
    refreshFacts();
    return { changed: false, reason: res.reason };
  }
  if (res.reason === 'invalid' || res.reason === 'format' || res.reason === 'no-pubkey') {
    verifyState = 'failed';
    clearLicense();
    refreshFacts();
    return { changed: true, reason: res.reason };
  }
  verifyState = 'failed';
  refreshFacts();
  return { changed: false, reason: res.reason };
}

/**
 * 清掉激活码（退回免费判定）。
 *
 * 返回清之前**有没有码**——测试库的「切换为基础版」用它区分「真降级了」
 * 与「本来就是基础版」。没码也照写一遍：镜像和文件两边保持一致，不给
 * 旧码留复活的机会。
 */
export function clearLicense(): boolean {
  const e = load();
  const had = e.license !== '';
  payloadCache.delete(e.license);
  e.license = '';
  e.checkedTs = 0;
  save();
  /* 码没了，档位成因跟着变「没码」；停用标记也一并清干净 */
  clearRevokedMark();
  refreshFacts();
  return had;
}

/** 报错用的人话。对外只有两种状态——试用相关信息一律不出现。 */
export function tierText(v: EntitlementView = entitlement()): string {
  /* 停用优先于「基础版」：用户手里明明有一枚签名合法的码，只说「基础版」
     会让他以为插件坏了。这里报码号，方便他申诉时直接报这个号。 */
  if (v.revoked) {
    const id = v.licenseId ? t('tier.revokedId', { id: v.licenseId }) : '';
    return t('tier.revoked', { id });
  }
  /* 试用码要先于「基础版」判断：码还在、只是过期或不是最新版，说「基础版」
     会让用户以为码丢了。过期排在最前面——时间到了比版本更根本。 */
  if (v.trial && v.exp && v.exp <= Date.now()) {
    return t('tier.trialExpired', { date: new Date(v.exp).toLocaleDateString() });
  }
  if (v.trialBlock === 'outdated') {
    return t('tier.trialOutdated', { now: pluginVersion, latest: v.latestVer });
  }
  if (v.trialBlock === 'unknown') {
    return t('tier.trialNeedLatest');
  }
  if (v.tier === 'paid') {
    const who = v.name ? t('tier.who', { name: v.name }) : '';
    /* 试用码单独一段：说「高级版已激活」等于告诉用户已经买断了。 */
    if (v.trial) {
      return t('tier.trial', { who, days: v.trialDaysLeft });
    }
    const until = v.exp ? t('tier.until', { date: new Date(v.exp).toLocaleDateString() }) : t('tier.forever');
    /* 赞助人码多一段身份说明（商品页承诺的那句），模板单独一条，避免在
       句子中间插词——八种语言的语序不同。 */
    return t(v.patron ? 'tier.paidPatron' : 'tier.paid', { who, until });
  }
  return t('tier.base');
}

/**
 * 每个能力对应的卖点文案，解锁弹层与锁标 tooltip 共用。
 *
 * 走**集中表**而不是八份语言包：十一条是成套的卖点清单，漏翻一条只会表现
 * 为「德语界面的解锁弹层里有一行中文」，tsc 看不出来。`Record<Locale, string>`
 * 让「八种齐」变成类型约束——这张表是用户决定要不要付钱的地方，不能有洞。
 */
const CAP_TEXT: Record<Cap, Record<Locale, string>> = {
  poster: {
    /* 2026-11-10：书摘图片下放基础版，这枚能力位改归「阅读海报」专用
       （统计页的数据长图 + 年度海报浮层）。以前两者共用 card，解锁弹窗会
       说「书摘图片」——书摘免费之后那就是谎话。 */
    zh: '把一年的阅读做成一张图',
    'zh-TW': '把一年的閱讀做成一張圖',
    en: 'Turn a year of reading into one image',
    ja: '一年の読書を 1 枚の画像に',
    de: 'Ein Lesejahr als ein Bild',
    fr: 'Une année de lecture en une image',
    es: 'Un año de lectura en una imagen',
    pt: 'Um ano de leitura numa imagem',
  },
  stats: {
    /* 1.0.0：行名从「阅读统计、打卡与目标」改成「数据面板」；
       2026-11-20 统计页扩成概览 / 时间 / 书 / 笔记 / 成就 / 数据六页签，
       卖点句跟着换成真正在卖的东西——字数速度、24 小时节律、年热力、预计读完与徽章。 */
    zh: '字数速度、24 小时节律、年度热力、预计读完与 18 枚成就',
    'zh-TW': '字數速度、24 小時節律、年度熱力、預計讀完與 18 枚成就',
    en: 'Reading pace, 24-hour rhythm, yearly heatmap, finish dates, 18 badges',
    ja: '読了速度、24時間リズム、年間ヒートマップ、完了予定と18の実績',
    de: 'Lesetempo, 24-Stunden-Rhythmus, Jahres-Heatmap, Fertigstellung und 18 Abzeichen',
    fr: 'Vitesse de lecture, rythme sur 24 h, heatmap annuelle, dates de fin et 18 badges',
    es: 'Ritmo de lectura, ritmo por hora, mapa anual, fechas de fin y 18 insignias',
    pt: 'Velocidade de leitura, ritmo por hora, mapa anual, previsão e 18 conquistas',
  },
  crossSearch: {
    zh: '在所有书里搜索，PDF 正文也算',
    'zh-TW': '在所有書裡搜尋，PDF 正文也算',
    en: 'Search across every book, PDF text included',
    ja: 'すべての本を横断検索、PDF 本文も対象',
    de: 'Alle Bücher durchsuchen, PDF-Text inklusive',
    fr: 'Rechercher dans tous les livres, texte des PDF inclus',
    es: 'Buscar en todos los libros, texto de PDF incluido',
    pt: 'Pesquisar em todos os livros, texto de PDF incluído',
  },
  /* 语义搜索（2026-11-11）：本书与全库两个入口共用一道门禁。 */
  semantic: {
    zh: '本书与全库，按意思找',
    'zh-TW': '本書與全庫，按意思找',
    en: 'By meaning, in this book or the shelf',
    ja: '意味で検索、本書でも本棚でも',
    de: 'Nach Bedeutung suchen, im Buch oder Regal',
    fr: 'Par le sens, dans ce livre ou le rayon',
    es: 'Por significado, en este libro o el estante',
    pt: 'Por significado, neste livro ou na estante',
  },
  /* 划词追问（2026-11-22 从 aiSel 拆出来）。解释 / 翻译 / 摘要已下放
     基础版，这道门只管「在答案底下接着问那几句」；卖点句要说清买了能
     多出什么，不能只写「追问」两个字。 */
  aiAsk: {
    zh: '就这一段接着问，答完还能追问几轮',
    'zh-TW': '就這一段接著問，答完還能追問幾輪',
    en: 'Keep asking about this passage, round after round',
    ja: 'この一節について続けて質問、何度でも',
    de: 'Zu dieser Stelle weiterfragen, Runde für Runde',
    fr: 'Continuer à poser des questions sur ce passage, tour après tour',
    es: 'Seguir preguntando sobre este pasaje, ronda tras ronda',
    pt: 'Continuar perguntando sobre este trecho, rodada após rodada',
  },
  ai: {
    /* 2026-11-16：照对照表新行名的口径，把四种依据在卖点里点出来。 */
    zh: '划线、正文、截图与笔记都能当依据，答案遍及全书',
    'zh-TW': '劃線、正文、截圖與筆記都能當依據，答案遍及全書',
    en: 'Highlights, page text, screenshots and notes as evidence, answered from the whole book',
    ja: 'ハイライト・本文・スクリーンショット・ノートを根拠に、本全体から回答',
    de: 'Markierungen, Seitentext, Screenshots und Notizen als Belege, Antwort aus dem ganzen Buch',
    fr: 'Surlignages, texte, captures et notes comme sources, réponse sur tout le livre',
    es: 'Subrayados, texto, capturas y notas como base, respuesta de todo el libro',
    pt: 'Destaques, texto, capturas e notas como base, resposta do livro inteiro',
  },
  /* AI 伴读（2026-11-11）：追问、导读、补全共用一道门禁。
     2026-11-16：对话留档与导出拆去 aiLog，这枚只剩「边读边问」本身。 */
  aiChat: {
    zh: '边读边问，按章导读',
    'zh-TW': '邊讀邊問，按章導讀',
    en: 'Ask as you read, with a per-chapter guide',
    ja: '読みながら質問、章ごとのガイド',
    de: 'Beim Lesen fragen, mit Kapitelführer',
    fr: 'Demandez en lisant, guide par chapitre',
    es: 'Pregunta mientras lees, guía por capítulo',
    pt: 'Pergunte enquanto lê, guia por capítulo',
  },
  /* AI 对话留档（2026-11-16）：划词卡与侧栏问答都落在本地会话文件里，
     关掉再点那条线还能接着聊，也能把整段导出进笔记。 */
  aiLog: {
    zh: '聊过的都留着：关掉能接着问，也能导出成笔记',
    'zh-TW': '聊過的都留著：關掉能接著問，也能匯出成筆記',
    en: 'Every chat is kept: pick it up later, or export it into a note',
    ja: '会話は残る：あとから続きを聞けるし、ノートにも書き出せる',
    de: 'Jedes Gespräch bleibt: später weiterfragen oder als Notiz exportieren',
    fr: 'Chaque échange reste : reprenez plus tard ou exportez-le dans une note',
    es: 'Cada conversación queda: retómala luego o expórtala a una nota',
    pt: 'Cada conversa fica: retome depois ou exporte para uma nota',
  },
  /* 2026-11-09 删：书籍本地化向量检索不再单列，也不再有 cap——建索引被拦时
     高亮「AI 全书问答」。能力本身还在（侧栏 AI 页签），只是不再作为一项
     独立的付费开关对外承诺。 */
  /* 2026-11-14：行名按 bz 的文案统一成「AI 知识盒」（bz 设置页里就叫这个，
     以前这里写「连接至 BZ AI 知识库」是另一套叫法，用户对不上）。 */
  kb: {
    zh: '用 BZ AI 知识库里的笔记一起回答',
    'zh-TW': '用 BZ AI 知識庫裡的筆記一起回答',
    en: 'Answer with notes from your BZ AI knowledge base',
    ja: 'BZ AI ナレッジベースのノートも参考に回答',
    de: 'Antworten unter Einbeziehung der Notizen aus der BZ-KI-Wissensbasis',
    fr: 'Répondre en s’appuyant aussi sur les notes de la base de connaissances BZ AI',
    es: 'Responder usando también las notas de la base de conocimiento BZ AI',
    pt: 'Responder usando também as notas da base de conhecimento BZ AI',
  },
  fullFormats: {
    /* 2026-11-10：PDF 从这条卖点里摘出去了——它在对照表里有自己的段
       （cap 'pdf'），锁标 tooltip 不该再把用户往「更多格式」引。
       1.0.0：与 formats 那一行同口径（族名 + 枚举）。 */
    zh: 'Kindle 系、FB2 与漫画格式',
    'zh-TW': 'Kindle 系、FB2 與漫畫格式',
    en: 'Kindle family, FB2 and comics',
    ja: 'Kindle 系・FB2・コミック',
    de: 'Kindle-Familie, FB2 und Comics',
    fr: 'Famille Kindle, FB2 et BD',
    es: 'Familia Kindle, FB2 y cómics',
    pt: 'Família Kindle, FB2 e quadrinhos',
  },
  vertical: {
    zh: '竖排排版',
    'zh-TW': '豎排排版',
    en: 'Vertical typesetting',
    ja: '縦組み',
    de: 'Vertikaler Satz',
    fr: 'Composition verticale',
    es: 'Composición vertical',
    pt: 'Composição vertical',
  },
  /* 2026-11-14 分级：朗读本体下放基础版，这道门只剩「整章预生成」。
     卖点句跟着改口径——被拦的用户点的是浮条上那颗「预生成」。 */
  tts: {
    zh: '整章先备好，点开就是声音，不用一句一句等',
    'zh-TW': '整章先備好，點開就是聲音，不用一句一句等',
    en: 'Build the chapter first, then listen without waiting between sentences',
    ja: '章を先に生成、文ごとの待ち時間なしで聴ける',
    de: 'Kapitel vorab erzeugen, hören ohne Warten zwischen den Sätzen',
    fr: 'Pré-générez le chapitre, écoutez sans attendre entre les phrases',
    es: 'Genera el capítulo antes y escucha sin esperas entre frases',
    pt: 'Gere o capítulo antes e ouça sem esperar entre as frases',
  },
  /* 整本预生成（2026-11-14）：只有本地引擎能整本备，卖点是「路上听」。 */
  ttsBook: {
    zh: '整本一次备完，路上从头听到尾',
    'zh-TW': '整本一次備完，路上從頭聽到尾',
    en: 'Build the whole book in one go, listen all the way through',
    ja: '本全体を一度に生成、移動中も最初から最後まで',
    de: 'Das ganze Buch auf einmal, durchhören von Anfang bis Ende',
    fr: 'Tout le livre en une fois, à écouter de bout en bout',
    es: 'Todo el libro de una vez, para escuchar del tirón',
    pt: 'O livro inteiro de uma vez, para ouvir do começo ao fim',
  },
  /* 并排对照 2026-11-22 下放基础版：不再为它保留卖点条目。 */
  bilink: {
    zh: '把划线存成双链，笔记里点得回来',
    'zh-TW': '把劃線存成雙鏈，筆記裡點得回來',
    en: 'Save a highlight as a wikilink you can click back from',
    ja: 'ハイライトを双方向リンクに、ノートから原文へ戻れる',
    de: 'Markierung als Wikilink speichern, aus der Notiz zurück zur Stelle',
    fr: 'Enregistrer un surlignage en wikilien, cliquable depuis la note',
    es: 'Guardar el subrayado como wikienlace, clicable desde la nota',
    pt: 'Salvar o destaque como wikilink, clicável da nota',
  },
  /* 引用页签（2026-11-12）：它列的是笔记里的反链，和「把划线做成双链」是
     两件事。八包里先写实简中 / 繁中 / 英三种；日德法西葡沿用英文占位，
     按仓库规矩留到发版前统一翻。 */
  cites: {
    zh: '哪些笔记引了这本书，按页聚在一起',
    'zh-TW': '哪些筆記引了這本書，按頁聚在一起',
    en: 'Which notes cite this book, grouped by page',
    ja: 'Which notes cite this book, grouped by page',
    de: 'Which notes cite this book, grouped by page',
    fr: 'Which notes cite this book, grouped by page',
    es: 'Which notes cite this book, grouped by page',
    pt: 'Which notes cite this book, grouped by page',
  },
  /* PDF 整段的卖点（2026-11-10）。基础版点开 PDF 时弹层第一句就是它，
     所以不能只写「PDF」两个字——用户要立刻知道买了能多出哪几件事。 */
  pdf: {
    zh: 'PDF：缩放旋转、复制页链接、笔记反链与导出页图',
    'zh-TW': 'PDF：縮放旋轉、複製頁連結、筆記反鏈與匯出頁圖',
    en: 'PDF: zoom, page links, note backlinks, and page export',
    ja: 'PDF：ズーム、ページリンク、ノートの被リンク、ページの画像書き出し',
    de: 'PDF: zoomen, Seitenlinks, Notiz-Backlinks und Seitenexport',
    fr: 'PDF : zoom, liens de page, rétroliens et export de page',
    es: 'PDF: zoom, enlaces de página, retroenlaces y exportar páginas',
    pt: 'PDF: zoom, links de página, retrolinks e exportar páginas',
  },
  /* 扫描页识别的卖点（2026-11-15 转正）。被拦时弹层第一句就是它：
     用户点的是「识别这页」，得立刻知道买了能拿到什么。 */
  pdfOcr: {
    zh: '扫描页识别：扫描件也像文字版一样选、搜、划',
    'zh-TW': '掃描頁識別：掃描件也像文字版一樣選、搜、劃',
    en: 'OCR for scanned pages: select, search, and highlight them like real text',
    ja: 'スキャンページ認識：スキャンした本も文字版と同じように選択・検索・ハイライト',
    de: 'Gescannte Seiten erkennen: auswählen, suchen und markieren wie echter Text',
    fr: 'OCR des pages scannées : les sélectionner, les rechercher et les surligner comme du texte',
    es: 'OCR de páginas escaneadas: seleccionarlas, buscarlas y resaltarlas como texto',
    pt: 'OCR de páginas digitalizadas: selecioná-las, pesquisá-las e destacá-las como texto',
  },
  /* 漫画模式的卖点（2026-11-15 从路线图转正）。分格、右到左、跨页拆合
     三件事都有运行期实现，被拦时弹层第一句就是它。 */
  manga: {
    zh: '漫画模式：分格逐格读、右到左翻页、跨页自动拆合',
    'zh-TW': '漫畫模式：分格逐格讀、右到左翻頁、跨頁自動拆合',
    en: 'Manga mode: panel-by-panel, right-to-left, auto split spreads',
    ja: 'マンガモード：コマごとに読む、右から左へ、見開きを自動分割',
    de: 'Manga-Modus: Panel für Panel, rechts nach links, Doppelseiten automatisch teilen',
    fr: 'Mode manga : case par case, droite à gauche, doubles pages découpées automatiquement',
    es: 'Modo manga: viñeta a viñeta, derecha a izquierda, dobles páginas divididas',
    pt: 'Modo mangá: quadro a quadro, direita para esquerda, páginas duplas divididas',
  },
  /* 剪藏成书 2026-11-22 下放基础版：不再为它保留卖点条目。 */
};

/** 能力卖点 → 当前界面语言的说法 */
export function capLabel(cap: Cap): string {
  return CAP_TEXT[cap]?.[locale()] ?? CAP_TEXT[cap]?.zh ?? String(cap);
}

/** 兼容旧调用：`CAP_LABEL[cap]` 已删除——静态中文做不到随语言切换，一律用 capLabel() */

/* ─────────── 发行信息（改这里就够了） ───────────
 * 购买与加群都走外链：Obsidian 商城不做内购，政策明确允许开发者在
 * 自己的渠道收款（只要 README 披露「完整功能需付费」）。
 * 价格只出现在商店页，不写进插件界面——面板里只有「去购买」。
 * 购买链接指向在售店铺页，不是店铺首页或聚合页：少一跳，
 * 手机端就不会停在商品列表里找不到下单入口。 */
export const PURCHASE_URL = 'https://wzyp.cn/shop/IFCEI5I3';
/**
 * 海外购买地址：Creem 商店（2026-11-23 起）。
 * 解锁弹层只一颗「去购买」：简体中文走 PURCHASE_URL，其余语言走这里。
 * 按界面语言机械分流，不再让用户手选地区。
 */
export const PURCHASE_URL_INTL = 'https://www.creem.io/stores/baizai';
/** 交流群群号：UI 直接显示、点击复制。短链（qm.qq.com/q/…）实测 404，不再用。 */
export const GROUP_ID = '1130883117';
/** 仓库地址：关于条与更新日志弹窗共用一份，改这里就够 */
export const REPO_URL = 'https://github.com/yeshimei/bz-reader';

/* ─────────── 基础版 / 高级版功能对照 ───────────
 * 点任何付费按钮弹出的就是这张表。一屏讲完「差在哪」，
 * 比一段推销文案有效——用户自己会算。 */
export type PlanCell = 'yes' | 'no' | 'part';

export interface PlanRow {
  /** 行名 id：八语言文案在 i18n/plan.ts 的集中表里 */
  key: PlanKey;
  /** 中文基准名（= planNameZh(key)），测试与自检用；界面渲染走 planLabel(key) */
  name: string;
  free: PlanCell;
  pro: PlanCell;
  /** 与 free/pro 并列的补充说明，例如「单条」「全部」 */
  note?: string;
  /** 这一行对应哪项能力：解锁弹层靠它高亮并滚到「你刚点的就是这个」 */
  cap?: Cap;
}

/** 只在这里拼一次中文名：表和语言包共用同一个真源 */
function row(key: PlanKey, free: PlanCell, pro: PlanCell, cap?: Cap): PlanRow {
  return { key, name: planNameZh(key), free, pro, cap };
}

export const PLAN_TABLE: PlanRow[] = [
  /* ── 阅读：基础版七行，顺序按「打开 → 标注 → 成图 → 找 → 回 → 注 → 分类」 ──
   * 2026-11-21 重排：单栏 / 双栏挪去「排版」段——它和竖排、并排是同一类事，
   * 留在阅读段里会让人以为「阅读基础能力」，其实只是排版的一种。 */
  row('reading', 'yes', 'yes'),
  /* 2026-11-09 书摘图片下放基础版（1.0.0 定稿），紧跟划线：它属于「读的
     时候就想要」的东西，排在付费段里会让人以为要买。 */
  row('marks', 'yes', 'yes'),
  row('card', 'yes', 'yes'),
  row('inbookSearch', 'yes', 'yes'),
  /* 2026-11-10 新增：跳转历史。PDF 早就有这条栈，EPUB 这次补上同一条，
     所以它是两栏都打勾的免费项——两个引擎共用一颗按钮。 */
  row('back', 'yes', 'yes'),
  row('footnote', 'yes', 'yes'),
  /* 2026-11-09 新增：分类管理（免费）——新建 / 改名 / 排序 / 删除分类、
     把书归入某一类，都不拦。 */
  row('classify', 'yes', 'yes'),
  /* ── 排版：一屏里怎么放字 ──
   * 2026-11-21 单独成段：单双栏（免费）、竖排、并排、鸟瞰原来散在「阅读」与
   * 「阅读方式」两段。全书鸟瞰同日下放基础版：它只读画像做一张总览，
   * 不产生额外成本，挂在高级版里与「只增不减」的承诺也说不通。 */
  row('columns', 'yes', 'yes'),
  row('vertical', 'no', 'yes', 'vertical'),
  /* 1.0.0：并排的是任意两本书、段落同步，不是「原文 + 译文」。
     2026-11-22 下放基础版：两边各挂一套引擎，不产生额外成本。 */
  row('parallel', 'yes', 'yes'),
  row('bookmap', 'yes', 'yes'),
  /* 漫画模式 2026-11-22 从路线图转正后**独立成段**（见下面 pdfOcr 之后的
     九行）。这里不再留一行「漫画模式」——九行才说得清它到底能做什么。 */
  /* ── 导入：书从哪儿来 ──
   * 2026-11-10：PDF 不再由 formats 代表——它有自己的段（见下面的 pdfView…）。
   * 剪藏成书 2026-11-13 从「探索中」转正，与 formats 同类：都是「书怎么进来」。 */
  row('formats', 'no', 'yes', 'fullFormats'),
  /* 剪藏成书 2026-11-22 下放基础版：书怎么进来，不该再分两种价钱。 */
  row('clipEpub', 'yes', 'yes'),
  /* ── PDF 阅读：怎么读 → 怎么拿出来 ──
   * 只有段首那行挂 cap：整段共用一个拦点（打开 PDF）。给每行各配一个能力位
   * 是摆样子——基础版根本进不了 PDF，那些能力位在运行期永远不会被抛出。 */
  row('pdfView', 'no', 'yes', 'pdf'),
  row('pdfThumbs', 'no', 'yes'),
  row('pdfLink', 'no', 'yes'),
  /* 2026-11-14：从「本页反链与文件自带批注」拆出来。两件事各有一个开关
     （prefs.pdfBacklinks / prefs.pdfAnnots），一行说两件事读着别扭。 */
  row('pdfBacklink', 'no', 'yes'),
  row('pdfAnnots', 'no', 'yes'),
  row('pdfExport', 'no', 'yes'),
  /* 2026-11-15：扫描页识别从「探索中」转正。它按页计费（视觉模型 / 外部
     OCR 都要钱），所以单独一行、单独一个能力位；拦点只放在「识别」上，
     读普通 PDF 不受影响。 */
  row('pdfOcr', 'no', 'yes', 'pdfOcr'),
  /* ── 漫画（2026-11-22 从「排版」组里单独拆出来）──
   * 原来只有一行「漫画模式：分格、右到左、跨页」，塞不进漫画实际能做的事，
   * 也说不清「买了能多出哪几件事」。现在按 打开 → 方向 → 单双页 → 翻法 →
   * 逐格 → 画面 → 缩略图 摊成九行。
   * 只有段首挂 cap：基础版根本进不了漫画（openBook 里 requireCap('manga')），
   * 后面八行各配一个能力位在运行期永远不会被抛出——与 PDF 段同一处理。 */
  row('mangaOpen', 'no', 'yes', 'manga'),
  row('mangaInfo', 'no', 'yes'),
  row('mangaDir', 'no', 'yes'),
  row('mangaSpread', 'no', 'yes'),
  row('mangaFlow', 'no', 'yes'),
  row('mangaPanels', 'no', 'yes'),
  row('mangaFit', 'no', 'yes'),
  row('mangaTone', 'no', 'yes'),
  row('mangaThumbs', 'no', 'yes'),
  /* ── 笔记：读完怎么存回笔记库 ──
   * 双向链接整条是高级版能力（copylink 走 requireCap('bilink')）。
   * 引用页签 2026-11-12 有独立能力位，点它被拦时点亮的是它自己那一行。 */
  row('bilink', 'no', 'yes', 'bilink'),
  row('cites', 'no', 'yes', 'cites'),
  /* 导出整本摘录 2026-11-22 下放基础版。但「从双链点回原书」仍由 bilink
     管着（openFromTarget 带定位参数时拦）：导出免费，跳回原文付费。 */
  row('export', 'yes', 'yes'),
  /* ── 复习（2026-11-21 独立成段） ──
   * Reader 负责「挑内容」，复习本身由 bz Review 承接：页签嵌入、按划线挑、
   * 按章生成卡片、已在复习状态。五件事都不设门——复习入口全在基础版，
   * 装不装 Review 由用户决定，这里不额外收一道钱。 */
  row('review', 'yes', 'yes'),
  row('reviewTab', 'yes', 'yes'),
  row('reviewMarks', 'yes', 'yes'),
  row('reviewChapter', 'yes', 'yes'),
  row('reviewPlanned', 'yes', 'yes'),
  /* ── 数据：回看读了多少、找回某句话 ── */
  row('stats', 'no', 'yes', 'stats'),
  /* 2026-11-10 新增：阅读海报（poster 能力位一直有拦点，表里却一直没有行）。 */
  row('poster', 'no', 'yes', 'poster'),
  row('crossSearch', 'no', 'yes', 'crossSearch'),
  row('semantic', 'no', 'yes', 'semantic'),
  /* ── AI ──
   * 2026-11-16 作者定稿：这一轮 AI 的增强（划词五项菜单与悬停展开、锚定
   * 追问浮框、划词会话留痕、侧栏问答历史与等待态、依据按章跳转、连接笔记
   * 浮层、书架对话页）原来全被埋在四行旧行名下面，看不出贵在哪儿。
   * 现在拆成五行，一行只说一件事，「对话留档」与「伴读」各挂自己的能力位。 */
  /* 2026-11-22：解释 / 翻译 / 摘要下放基础版；追问单独一行、仍是高级版。
     追问要带上下文、要多轮，和「让 AI 解释一下」是两件事；共用一个勾，
     用户看不出买了能多出哪一下。 */
  row('aiSel', 'yes', 'yes'),
  row('aiFollow', 'no', 'yes', 'aiAsk'),
  row('aiBook', 'no', 'yes', 'ai'),
  /* 对话留档 2026-11-16 从 aiChat 拆出来：点「导出到笔记」被拦时，
     弹层要亮的是这一行，不是「AI 伴读」。 */
  row('aiLog', 'no', 'yes', 'aiLog'),
  row('aiChat', 'no', 'yes', 'aiChat'),
  /* 2026-11-09 起「向量检索」不再单列：整本索引是全书问答的前置步骤，
     建索引被拦时高亮的是「AI 全书问答」那一行（见 shell/actions.ts 的 indexCap）。
     2026-11-14：行名按作者口径从「AI 知识盒」改成「AI 知识库」。 */
  row('kb', 'no', 'yes', 'kb'),
  /* ── 听书（2026-11-14 从「阅读方式」里拆出来，单独成段） ──
   * 分档口径一句话：**免费听一页，收费听整本**。
   * 前四行两版都打勾——点一下就念、三种引擎、音色与试听、语速与高亮跟随：
   * 它们都不花我们的钱（用的是用户自己的 key 或自己的机器），把用户挡在
   * 门外只是把功能藏起来。后三行要先花时间备材料（整章 / 整本）或者把
   * 文件带走（离线书），才是高级版。
   *
   * 「导出本章音频」2026-11-14 决定不上表：功能照旧（免费、不设门），
   * 但对照表里不列——它是一次性动作，讲出来只会让表格变长。 */
  row('tts', 'yes', 'yes'),
  row('ttsEngine', 'yes', 'yes'),
  row('ttsVoice', 'yes', 'yes'),
  row('ttsRate', 'yes', 'yes'),
  row('ttsChapter', 'no', 'yes', 'tts'),
  row('ttsWhole', 'no', 'yes', 'ttsBook'),
  /* 离线听书没有自己的按钮：它是整本预生成的产物，被拦时整本那一行已经亮着，
     再给它一个能力位只是摆样子。 */
  row('ttsOffline', 'no', 'yes'),
  /* ── 路线图（2026-11-11 起叫「探索中」，2026-11-21 改叫「路线图」） ──
   * 四项都还没实现：两版都不打勾、不挂能力位，状态由段名说。
   * 它们不进合计——图上的基础版与高级版项数只数打勾的行。
   * 「复习」2026-11-21 已上线、「漫画」2026-11-22 从路线图转正，
   * 两条都搬去上面的正式段，不再留在这里。 */
  row('pdfReflow', 'no', 'no'),
  row('transChapter', 'no', 'no'),
  row('eink', 'no', 'no'),
  row('motion', 'no', 'no'),
];

/**
 * 对照表底部的合计：各档打勾的项数。
 *
 * 商品图上写的「18 项 / 44 项」不是手工维护的数字——它就是这张表里
 * `free === 'yes'` 与 `pro === 'yes'` 的行数。写死的话，下次加一行忘了改，
 * 弹层就会对外少报一项；这张表是用户决定要不要付钱的地方，数字得跟着表走。
 *
 * 「路线图」那五行两版都不打勾，所以天然不计入：不是特例，是同一条规则。
 * 反过来说，哪天给路线图里的某项打了勾，它会自动进合计——这正是想要的。
 */
export function planTotals(): { free: number; pro: number } {
  return {
    free: PLAN_TABLE.filter((r) => r.free === 'yes').length,
    pro: PLAN_TABLE.filter((r) => r.pro === 'yes').length,
  };
}

/**
 * 打不开一本书时，解锁弹层该把视线引到哪一段。
 *
 * 2026-11-10 之前一律是 `fullFormats`，「更多格式」那一行同时替 PDF 说话；
 * PDF 单独成段之后，点开 PDF 还被高亮到「格式与导出」就错位了——用户明明
 * 点的是 PDF，弹层却指着一行说他刚才想开 Kindle。
 *
 * 返回值直接当 `overlay: { kind: 'unlock', mode }` 用，所以只承认真能对上
 * 一段的两个值；调用方只在「这本书打不开」时问它，基础格式不该走到这里。
 */
export function unlockModeFor(format: BookFormat): 'pdf' | 'fullFormats' {
  return format === 'pdf' ? 'pdf' : 'fullFormats';
}

/* ─────────── 对照表的分组（2026-11-21 重切） ───────────
 * 49 行一长串看不出结构：用户从上滚到下，只记得「很多功能」，分不清哪几行
 * 是一类。这里把同一批行按使用场景切成十段，渲染时插组标题——**行本身、
 * 勾叉、顺序都没变**，所以被拦时的高亮与滚动位置照旧。
 *
 * 两条约束：
 *   1. 组的先后就是表的先后，组内也按表序（测试 flatMap 展开后与 PLAN_TABLE
 *      逐项相等，谁插错位置都会红）；
 *   2. 组名不写在这个文件里——`data/` 有硬编码中文门禁，组名在
 *      `i18n/plan.ts` 的 PLAN_GROUP_TEXT，渲染走 planGroupLabel()。
 *
 * 切法每段只回答一个问题，段名压到 2–4 字：
 *   · 阅读：基础版够不够用（七行全打勾）；
 *   · 排版：字怎么放（单双栏免费，竖排 / 并排 / 鸟瞰）；
 *   · 导入：书从哪儿来（更多格式 + 剪藏成书）；
 *   · PDF 阅读：PDF 怎么读、怎么拿出来；
 *   · 漫画：CBZ 怎么打开、怎么翻、怎么逐格看（2026-11-22 独立成段，九行）；
 *   · 笔记：读完怎么存回笔记库；
 *   · 复习：挑内容、制卡、复习（2026-11-21 独立，五项全免费）；
 *   · 数据：回看读了多少、找回某句话；
 *   · AI：划词、全书问答、伴读、知识库；
 *   · 听书：朗读、三台引擎、音色、语速、预生成与离线书；
 *   · 路线图：还没实现的四项，两版都不打勾，只作为收尾。 */
export interface PlanGroup {
  key: PlanGroupKey;
  /** 这一段包含哪些行，按表里的顺序 */
  rows: PlanKey[];
}

export const PLAN_GROUPS: PlanGroup[] = [
  {
    key: 'read',
    rows: ['reading', 'marks', 'card', 'inbookSearch', 'back', 'footnote', 'classify'],
  },
  {
    key: 'layout',
    rows: ['columns', 'vertical', 'parallel', 'bookmap'],
  },
  {
    key: 'import',
    rows: ['formats', 'clipEpub'],
  },
  {
    key: 'pdf',
    rows: ['pdfView', 'pdfThumbs', 'pdfLink', 'pdfBacklink', 'pdfAnnots', 'pdfExport', 'pdfOcr'],
  },
  /* 漫画（2026-11-22）：从「排版」里拆出来单独一段，排在 PDF 之后——
     两者都是「按格式的阅读段」，紧挨着读下来顺。 */
  {
    key: 'manga',
    rows: [
      'mangaOpen',
      'mangaInfo',
      'mangaDir',
      'mangaSpread',
      'mangaFlow',
      'mangaPanels',
      'mangaFit',
      'mangaTone',
      'mangaThumbs',
    ],
  },
  {
    key: 'notes',
    rows: ['bilink', 'cites', 'export'],
  },
  {
    key: 'review',
    rows: ['review', 'reviewTab', 'reviewMarks', 'reviewChapter', 'reviewPlanned'],
  },
  {
    key: 'data',
    rows: ['stats', 'poster', 'crossSearch', 'semantic'],
  },
  {
    key: 'ai',
    /* 2026-11-16：五行。对话留档排在伴读之前——它是「问完之后」的去处，
       与上一行「问的时候带什么」顺着读下来。
       2026-11-22：追问从划词那一行拆出来，六行。 */
    rows: ['aiSel', 'aiFollow', 'aiBook', 'aiLog', 'aiChat', 'kb'],
  },
  {
    key: 'voice',
    rows: ['tts', 'ttsEngine', 'ttsVoice', 'ttsRate', 'ttsChapter', 'ttsWhole', 'ttsOffline'],
  },
  /* 路线图放最后一段，只收还没实现的路线项，两版都不打勾，也不参与
     「被拦时高亮」那一套。 */
  {
    key: 'roadmap',
    rows: ['pdfReflow', 'transChapter', 'eink', 'motion'],
  },
];
