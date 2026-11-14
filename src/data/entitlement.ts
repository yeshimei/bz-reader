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
import { parseLicense, verifyLicense, type LicenseFail, type LicensePayload } from './license';
import type { BookFormat } from './schema';

/** 高级能力。只有能判断的地方才列进来，别造没人问的开关。 */
export type Cap =
  | 'export' // 结构化导出 Markdown
  | 'poster' // 阅读海报（书摘图片 2026-11-10 下放基础版，不再需要能力位）
  | 'stats' // 阅读统计
  | 'crossSearch' // 跨书搜索
  | 'aiSel' // 划词 AI：解释 / 翻译 / 摘要（工具栏那颗）
  | 'ai' // 侧栏 AI：全书问答
  | 'kb' // BZ AI 知识盒（划词录入 / 笔记当依据；行名按 bz 的文案）
  | 'fullFormats' // mobi / azw3 / fb2 / cbz（PDF 2026-11-10 起单列，见 pdf）
  | 'vertical' // 竖排（双栏已于 2026-11-05 下放基础版，不再挂在这个能力上）
  | 'tts' // 朗读
  | 'parallel' // 并排 / 双语
  | 'bookmap' // 全书鸟瞰
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
  | 'aiChat' // AI 伴读：追问 / 导读 / 补全 / 对话存档
  | 'semantic' // 语义搜索：本书与全库，按意思找
  /** 剪藏成书（2026-11-13）：把剪藏本里的订阅文章合成 EPUB，进书架读 */
  | 'clipBook'
  /**
   * PDF 整段（2026-11-10）。
   *
   * 和别的 cap 不一样：它代表**一整段七行**，不是某颗按钮。原因是基础版
   * 根本进不了 PDF，缩略图 / 导出页图 / 反链这些动作对他们不存在，给每行
   * 各配一个能力位只是摆样子。整段共用一个拦点（打开 PDF）——被拦时高亮
   * 段首那一行，用户就知道「PDF 这一整块要买」。
   */
  | 'pdf';
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
  /** 赞助人码（payload.patron === true）：设置页「关于」条据此多画一枚徽章 */
  patron: boolean;
  license: string;
  /** 试用是否因时钟异常被作废 */
  trialVoid: boolean;
  installId: string;
  days: string[];
}

let proBuild = false;
let cache: Ent | null = null;

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

  /* 计划类型、到期、署名全部从码里现解。parseLicense 只拆 payload 不验签，
     真正的验签在激活那一刻与每次启动时做过（见 revalidateLicense），
     `verify` 就是那个结论——没验过、验不过都不放行。 */
  const payload = payloadOf(e.license);
  const exp = payload?.exp ?? 0;
  const verified = verifyState === 'ok';
  const paid = verified && !!payload && e.checkedTs > 0 && (exp === 0 || exp > now);

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
    patron: payload?.patron === true,
    license: e.license,
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
}

/**
 * 激活一个码：验签 → 通过才落盘。
 *
 * 书架设置页与壳层解锁层都必须走这一个入口。以前两条路各写各的：
 * 壳层会 setLicense，另一条只把码写进 settings，于是「界面显示已激活、
 * can() 仍为 false」——用户装好先去的那个入口恰好是坏的。
 */
export async function activateLicense(code: string): Promise<{ ok: boolean; message: string }> {
  const res = await verifyLicense(code);
  if (res.ok) setLicense(code);
  return { ok: res.ok, message: res.message };
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
    return { changed: false };
  }
  const res = await verifyLicense(e.license);
  if (res.ok) {
    verifyState = 'ok';
    return { changed: false };
  }
  if (res.reason === 'expired') {
    verifyState = 'ok';
    return { changed: false, reason: res.reason };
  }
  if (res.reason === 'invalid' || res.reason === 'format' || res.reason === 'no-pubkey') {
    verifyState = 'failed';
    clearLicense();
    return { changed: true, reason: res.reason };
  }
  verifyState = 'failed';
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
  return had;
}

/** 报错用的人话。对外只有两种状态——试用相关信息一律不出现。 */
export function tierText(v: EntitlementView = entitlement()): string {
  if (v.tier === 'paid') {
    const who = v.name ? t('tier.who', { name: v.name }) : '';
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
  export: {
    zh: '把整本摘录导出成 Markdown，每条都能点回原文',
    'zh-TW': '把整本摘錄匯出成 Markdown，每條都能點回原文',
    en: 'Export every excerpt as Markdown, each one links back to the page',
    ja: '抜粋を Markdown に書き出し、各項目から原文へ戻れる',
    de: 'Alle Exzerpte als Markdown exportieren, jeder Eintrag führt zur Stelle',
    fr: 'Exporter tous les extraits en Markdown, chacun ramène au texte',
    es: 'Exportar los extractos a Markdown, cada uno vuelve al texto',
    pt: 'Exportar os excertos em Markdown, cada um volta ao texto',
  },
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
    /* 1.0.0：行名从「阅读统计、打卡与目标」改成「数据面板」，卖点句也跟着
       改口径——这一块是概览、对比、趋势、节律、热力、目标、书籍明细、口径
       对照八块，只提打卡与目标会让人以为就这么点。 */
    zh: '时长、趋势、节律与每本书的明细，都在数据面板里',
    'zh-TW': '時長、趨勢、節律與每本書的明細，都在資料面板裡',
    en: 'Time, trends, rhythm and per-book detail, all in the stats panel',
    ja: '時間・推移・リズム・書籍ごとの内訳をデータパネルに',
    de: 'Zeit, Verlauf, Rhythmus und Details je Buch im Statistikpanel',
    fr: 'Temps, tendances, rythme et détail par livre dans le panneau de stats',
    es: 'Tiempo, tendencias, ritmo y detalle por libro en el panel de datos',
    pt: 'Tempo, tendências, ritmo e detalhe por livro no painel de dados',
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
  aiSel: {
    zh: '划词 AI：解释 · 翻译 · 摘要',
    'zh-TW': '劃詞 AI：解釋 · 翻譯 · 摘要',
    en: 'AI on a selection: explain · translate · summarize',
    ja: '選択範囲を AI で解説・翻訳・要約',
    de: 'KI zur Auswahl: erklären · übersetzen · zusammenfassen',
    fr: "IA sur une sélection : expliquer · traduire · résumer",
    es: 'IA sobre una selección: explicar · traducir · resumir',
    pt: 'IA sobre uma seleção: explicar · traduzir · resumir',
  },
  ai: {
    zh: 'AI 全书问答',
    'zh-TW': 'AI 全書問答',
    en: 'AI Q&A over the whole book',
    ja: 'AI 全書 Q&A',
    de: 'KI: Fragen zum ganzen Buch',
    fr: 'Questions IA sur tout le livre',
    es: 'Preguntas de IA sobre todo el libro',
    pt: 'Perguntas de IA sobre o livro inteiro',
  },
  /* AI 伴读（2026-11-11）：追问、导读、补全、对话存档共用一道门禁。 */
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
  tts: {
    zh: '让它念给你听，念完自动翻页',
    'zh-TW': '讓它念給你聽，念完自動翻頁',
    en: 'Have it read to you, turning pages on its own',
    ja: '読み上げ、読み終えたら自動で次のページへ',
    de: 'Vorlesen lassen, blättert selbst weiter',
    fr: 'Se faire lire, la page tourne toute seule',
    es: 'Que te lo lea, pasando de página solo',
    pt: 'Deixe ler para você, virando a página sozinho',
  },
  parallel: {
    /* 1.0.0：并排的是任意两本书、段落同步，不是「原文 + 译文」。 */
    zh: '两本书并排，段落跟着一起走',
    'zh-TW': '兩本書並排，段落跟著一起走',
    en: 'Two books side by side, scrolling in step',
    ja: '2 冊を並べ、段落が一緒に動く',
    de: 'Zwei Bücher nebeneinander, Absätze laufen mit',
    fr: 'Deux livres côte à côte, les paragraphes suivent',
    es: 'Dos libros en paralelo, los párrafos avanzan juntos',
    pt: 'Dois livros lado a lado, os parágrafos acompanham',
  },
  bookmap: {
    zh: '全书鸟瞰',
    'zh-TW': '全書鳥瞰',
    en: 'Book overview',
    ja: '全体マップ',
    de: 'Buchübersicht',
    fr: 'Vue d’ensemble du livre',
    es: 'Vista general del libro',
    pt: 'Visão geral do livro',
  },
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
  clipBook: {
    zh: '剪藏成书：把 bz 剪藏本里的订阅文章合成一本 EPUB，进书架读',
    'zh-TW': '剪藏成書：把 bz 剪藏本裡的訂閱文章合成一本 EPUB，進書架讀',
    en: 'Clipbook to EPUB: bind your bz subscription articles into one EPUB and read it on the shelf',
    ja: 'クリップブックを EPUB に：bz の購読記事を 1 冊の EPUB にまとめ、本棚で読む',
    de: 'Clipbook als EPUB: deine bz-Aboartikel in ein EPUB binden und im Regal lesen',
    fr: 'Le cahier de clips en EPUB : relier vos articles d’abonnement bz en un EPUB à lire dans la bibliothèque',
    es: 'Clipbook a EPUB: encuaderna tus artículos de suscripción de bz en un EPUB y léelo en el estante',
    pt: 'Clipbook em EPUB: encaderne os seus artigos de subscrição do bz num EPUB e leia-o na estante',
  },
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
  /* ── 阅读与书架：基础版八行，顺序按「打开 → 排版 → 标注 → 成图 → 找 → 回 → 注 → 书架」 ── */
  row('reading', 'yes', 'yes'),
  /* 分栏 2026-11-05 下放基础版：单独一行，免得用户以为双栏还要买 */
  row('columns', 'yes', 'yes'),
  row('marks', 'yes', 'yes'),
  /* 2026-11-09 书摘图片下放基础版（1.0.0 定稿），紧跟划线：它属于「读的
     时候就想要」的东西，排在付费段里会让人以为要买。 */
  row('card', 'yes', 'yes'),
  row('inbookSearch', 'yes', 'yes'),
  /* 2026-11-10 新增：跳转历史。PDF 早就有这条栈，EPUB 这次补上同一条，
     所以它是两栏都打勾的免费项——两个引擎共用一颗按钮。 */
  row('back', 'yes', 'yes'),
  row('footnote', 'yes', 'yes'),
  /* 2026-11-09 新增：分类管理（免费）——新建 / 改名 / 排序 / 删除分类、
     把书归入某一类，都不拦。 */
  row('classify', 'yes', 'yes'),
  /* ── 打开与导入：书从哪儿来 ──
   * 2026-11-10：PDF 不再由 formats 代表——它有自己的段（见下面的 pdfView…）。
   * 剪藏成书 2026-11-13 从「探索中」转正，与 formats 同类：都是「书怎么进来」。 */
  row('formats', 'no', 'yes', 'fullFormats'),
  row('clipEpub', 'no', 'yes', 'clipBook'),
  /* ── PDF 段：怎么读 → 怎么拿出来 ──
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
  /* ── 笔记与导出：读完怎么存 ──
   * 双向链接整条是高级版能力（copylink 走 requireCap('bilink')）。
   * 引用页签 2026-11-12 有独立能力位，点它被拦时点亮的是它自己那一行。 */
  row('bilink', 'no', 'yes', 'bilink'),
  row('cites', 'no', 'yes', 'cites'),
  row('export', 'no', 'yes', 'export'),
  /* ── 数据与搜索 ── */
  row('stats', 'no', 'yes', 'stats'),
  /* 2026-11-10 新增：阅读海报（poster 能力位一直有拦点，表里却一直没有行）。 */
  row('poster', 'no', 'yes', 'poster'),
  row('crossSearch', 'no', 'yes', 'crossSearch'),
  row('semantic', 'no', 'yes', 'semantic'),
  /* ── AI ── */
  row('aiSel', 'no', 'yes', 'aiSel'),
  row('aiBook', 'no', 'yes', 'ai'),
  row('aiChat', 'no', 'yes', 'aiChat'),
  /* 2026-11-09 起「向量检索」不再单列：整本索引是全书问答的前置步骤，
     建索引被拦时高亮的是「AI 全书问答」那一行（见 shell/actions.ts 的 indexCap）。
     2026-11-14：行名按作者口径从「AI 知识盒」改成「AI 知识库」。 */
  row('kb', 'no', 'yes', 'kb'),
  /* ── 阅读方式 ── */
  row('vertical', 'no', 'yes', 'vertical'),
  row('tts', 'no', 'yes', 'tts'),
  /* 1.0.0：并排的是任意两本书、段落同步，不是「原文 + 译文」。 */
  row('parallel', 'no', 'yes', 'parallel'),
  row('bookmap', 'no', 'yes', 'bookmap'),
  /* ── 探索中（2026-11-11，2026-11-12 增至七项） ──
   * 七项都还没实现：两版都不打勾、不挂能力位，状态由段名说。
   * 它们不进合计——图上的基础版与高级版项数只数打勾的行。 */
  row('pdfOcr', 'no', 'no'),
  row('pdfReflow', 'no', 'no'),
  row('manga', 'no', 'no'),
  row('transChapter', 'no', 'no'),
  row('review', 'no', 'no'),
  row('eink', 'no', 'no'),
  row('motion', 'no', 'no'),
];

/**
 * 对照表底部的合计：各档打勾的项数。
 *
 * 商品图上写的「8 项 / 31 项」不是手工维护的数字——它就是这张表里
 * `free === 'yes'` 与 `pro === 'yes'` 的行数。写死的话，下次加一行忘了改，
 * 弹层就会对外少报一项；这张表是用户决定要不要付钱的地方，数字得跟着表走。
 *
 * 「探索中」那七行两版都不打勾，所以天然不计入：不是特例，是同一条规则。
 * 反过来说，哪天给探索中的某项打了勾，它会自动进合计——这正是想要的。
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

/* ─────────── 对照表的分组（2026-11-14 重切） ───────────
 * 38 行一长串看不出结构：用户从上滚到下，只记得「很多功能」，分不清哪几行
 * 是一类。这里把同一批行按使用场景切成八段，渲染时插组标题——**行本身、
 * 勾叉、顺序都没变**，所以被拦时的高亮与滚动位置照旧。
 *
 * 两条约束：
 *   1. 组的先后就是表的先后，组内也按表序（测试 flatMap 展开后与 PLAN_TABLE
 *      逐项相等，谁插错位置都会红）；
 *   2. 组名不写在这个文件里——`data/` 有硬编码中文门禁，组名在
 *      `i18n/plan.ts` 的 PLAN_GROUP_TEXT，渲染走 planGroupLabel()。
 *
 * 切法每段只回答一个问题：
 *   · 阅读与书架：基础版够不够用（八行全打勾）；
 *   · 打开与导入：书从哪儿来（更多格式 + 剪藏成书）；
 *   · PDF 阅读：PDF 怎么读、怎么拿出来；
 *   · 笔记与导出：读完怎么存回笔记库；
 *   · 数据与搜索：回看读了多少、找回某句话；
 *   · AI：划词、全书问答、伴读、知识库；
 *   · 阅读方式：竖排、朗读、并排、鸟瞰；
 *   · 探索中：还没实现的七项，两版都不打勾，只作为路线图收尾。 */
export interface PlanGroup {
  key: PlanGroupKey;
  /** 这一段包含哪些行，按表里的顺序 */
  rows: PlanKey[];
}

export const PLAN_GROUPS: PlanGroup[] = [
  {
    key: 'read',
    rows: ['reading', 'columns', 'marks', 'card', 'inbookSearch', 'back', 'footnote', 'classify'],
  },
  {
    key: 'import',
    rows: ['formats', 'clipEpub'],
  },
  {
    key: 'pdf',
    rows: ['pdfView', 'pdfThumbs', 'pdfLink', 'pdfBacklink', 'pdfAnnots', 'pdfExport'],
  },
  {
    key: 'notes',
    rows: ['bilink', 'cites', 'export'],
  },
  {
    key: 'data',
    rows: ['stats', 'poster', 'crossSearch', 'semantic'],
  },
  {
    key: 'ai',
    rows: ['aiSel', 'aiBook', 'aiChat', 'kb'],
  },
  {
    key: 'modes',
    rows: ['vertical', 'tts', 'parallel', 'bookmap'],
  },
  /* 探索中放最后一段，只收还没实现的功能，两版都不打勾，也不参与
     「被拦时高亮」那一套。 */
  {
    key: 'explore',
    rows: ['pdfOcr', 'pdfReflow', 'manga', 'transChapter', 'review', 'eink', 'motion'],
  },
];
