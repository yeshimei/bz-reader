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
import { parseLicense, verifyLicense, type LicenseFail, type LicensePayload } from './license';

/** 高级能力。只有能判断的地方才列进来，别造没人问的开关。 */
export type Cap =
  | 'export' // 结构化导出 Markdown
  | 'card' // 书摘卡片
  | 'stats' // 阅读统计
  | 'crossSearch' // 跨书搜索
  | 'ai' // AI 回答 / 摘要 / 解释 / 翻译
  | 'fullFormats' // mobi / azw3 / fb2 / cbz
  | 'vertical' // 竖排（双栏已于 2026-11-05 下放基础版，不再挂在这个能力上）
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
  /** 试用是否因时钟异常被作废 */
  trialVoid: boolean;
  installId: string;
  days: string[];
}

let proBuild = false;
let cache: Ent | null = null;

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
     真正的验签在激活那一刻做过一次；这里要的是「结论无法被外部改写」，
     而不是「每次都重验」——后者是异步的，can() 是同步的。 */
  const payload = payloadOf(e.license);
  const exp = payload?.exp ?? 0;
  const paid = !!payload && e.checkedTs > 0 && (exp === 0 || exp > now);

  // 第 1..TRIAL_DAYS 个活跃日都在试用内；第 TRIAL_DAYS+1 天开始结束
  // TRIAL_ACTIVE=false 时这一支永远不成立（试用不发放，但记录照旧）
  const trialAlive = TRIAL_ACTIVE && !e.trialVoid && used <= TRIAL_DAYS;
  const tier: Tier = paid ? 'paid' : trialAlive ? 'trial' : 'free';

  const left = used <= 0 ? TRIAL_DAYS : Math.max(0, TRIAL_DAYS - used + 1);

  return {
    tier,
    unlocked: tier !== 'free',
    trialLeft: tier === 'trial' ? left : 0,
    trialUsed: used,
    plan: payload?.plan,
    exp,
    name: payload?.name,
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
 *                                 完全不动，沿用上次结论
 *
 * 返回值给插件用来决定要不要通知界面重绘。
 */
export async function revalidateLicense(): Promise<{ changed: boolean; reason?: LicenseFail }> {
  const e = load();
  if (!e.license) return { changed: false };
  const res = await verifyLicense(e.license);
  if (res.ok) return { changed: false };
  if (res.reason === 'invalid' || res.reason === 'format' || res.reason === 'no-pubkey') {
    clearLicense();
    return { changed: true, reason: res.reason };
  }
  return { changed: false, reason: res.reason };
}

/** 清掉激活码（退回免费判定） */
export function clearLicense(): void {
  const e = load();
  payloadCache.delete(e.license);
  e.license = '';
  e.checkedTs = 0;
  save();
}

/** 报错用的人话。对外只有两种状态——试用相关信息一律不出现。 */
export function tierText(v: EntitlementView = entitlement()): string {
  if (v.tier === 'paid') {
    const who = v.name ? t('tier.who', { name: v.name }) : '';
    const until = v.exp ? t('tier.until', { date: new Date(v.exp).toLocaleDateString() }) : t('tier.forever');
    return t('tier.paid', { who, until });
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
    zh: '把划线导出成结构化 Markdown',
    'zh-TW': '把劃線匯出成結構化 Markdown',
    en: 'Export highlights as structured Markdown',
    ja: 'ハイライトを構造化 Markdown に書き出す',
    de: 'Markierungen als strukturiertes Markdown exportieren',
    fr: 'Exporter les surlignages en Markdown structuré',
    es: 'Exportar los subrayados como Markdown estructurado',
    pt: 'Exportar destaques como Markdown estruturado',
  },
  card: {
    zh: '把划线做成可分享的书摘卡片',
    'zh-TW': '把劃線做成可分享的書摘卡片',
    en: 'Turn highlights into shareable quote cards',
    ja: 'ハイライトを共有できる引用カードにする',
    de: 'Markierungen in teilbare Zitatkarten verwandeln',
    fr: 'Transformer les surlignages en cartes de citation partageables',
    es: 'Convertir los subrayados en tarjetas de cita para compartir',
    pt: 'Transformar destaques em cartões de citação compartilháveis',
  },
  stats: {
    zh: '阅读统计与热力图',
    'zh-TW': '閱讀統計與熱力圖',
    en: 'Reading stats and heatmap',
    ja: '読書統計とヒートマップ',
    de: 'Lesestatistik und Heatmap',
    fr: 'Statistiques de lecture et carte de chaleur',
    es: 'Estadísticas de lectura y mapa de calor',
    pt: 'Estatísticas de leitura e mapa de calor',
  },
  crossSearch: {
    zh: '在所有书里搜索',
    'zh-TW': '在所有書裡搜尋',
    en: 'Search across every book',
    ja: 'すべての本を横断検索',
    de: 'Alle Bücher durchsuchen',
    fr: 'Rechercher dans tous les livres',
    es: 'Buscar en todos los libros',
    pt: 'Pesquisar em todos os livros',
  },
  ai: {
    zh: 'AI 回答 · 摘要 · 解释 · 翻译',
    'zh-TW': 'AI 回答 · 摘要 · 解釋 · 翻譯',
    en: 'AI answers · summaries · explanations · translation',
    ja: 'AI による回答・要約・解説・翻訳',
    de: 'KI-Antworten · Zusammenfassungen · Erklärungen · Übersetzung',
    fr: 'Réponses, résumés, explications et traductions par IA',
    es: 'Respuestas, resúmenes, explicaciones y traducción con IA',
    pt: 'Respostas, resumos, explicações e tradução com IA',
  },
  fullFormats: {
    zh: 'mobi / azw3 / fb2 / 漫画支持',
    'zh-TW': 'mobi / azw3 / fb2 / 漫畫支援',
    en: 'mobi / azw3 / fb2 / comic support',
    ja: 'mobi / azw3 / fb2 / コミック対応',
    de: 'mobi / azw3 / fb2 / Comic-Unterstützung',
    fr: 'Prise en charge mobi / azw3 / fb2 / BD',
    es: 'Compatibilidad con mobi / azw3 / fb2 / cómic',
    pt: 'Suporte a mobi / azw3 / fb2 / quadrinhos',
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
  tts: { zh: '朗读', 'zh-TW': '朗讀', en: 'Read aloud', ja: '読み上げ', de: 'Vorlesen', fr: 'Lecture vocale', es: 'Lectura en voz alta', pt: 'Leitura em voz alta' },
  parallel: {
    zh: '原文与译文并排',
    'zh-TW': '原文與譯文並排',
    en: 'Original and translation side by side',
    ja: '原文と訳文を並べて表示',
    de: 'Original und Übersetzung nebeneinander',
    fr: 'Original et traduction côte à côte',
    es: 'Original y traducción en paralelo',
    pt: 'Original e tradução lado a lado',
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
    zh: '把划线复制成双向链接',
    'zh-TW': '把劃線複製成雙向連結',
    en: 'Copy a highlight as a bidirectional link',
    ja: 'ハイライトを双方向リンクとしてコピー',
    de: 'Markierung als bidirektionalen Link kopieren',
    fr: 'Copier un surlignage en lien bidirectionnel',
    es: 'Copiar un subrayado como enlace bidireccional',
    pt: 'Copiar um destaque como link bidirecional',
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
 * 购买链接是**商品直链**（/item/…），不是店铺主页：主页还要再点一次，
 * 手机端更是容易停在动态流里找不到下单入口。 */
export const PURCHASE_URL = 'https://afdian.com/item/6f17bf10d7e311f1b8735254001e7c00';
/** 交流群群号：UI 直接显示、点击复制。短链（qm.qq.com/q/…）实测 404，不再用。 */
export const GROUP_ID = '1130883117';
/** 仓库地址：关于条与更新日志弹窗共用一份，改这里就够 */
export const REPO_URL = 'https://github.com/yeshimei/bz-reader';

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
  /* 分栏 2026-11-05 下放基础版：单独一行，免得用户以为双栏还要买 */
  { name: '单栏 / 双栏', free: 'yes', pro: 'yes' },
  { name: '目录、书签、四色划线与想法', free: 'yes', pro: 'yes' },
  { name: '书内搜索', free: 'yes', pro: 'yes' },
  /* 脚注和上面的书本能力同属基础版，排在一起；别让它跟付费项混在表尾 */
  { name: '脚注浮窗预览', free: 'yes', pro: 'yes' },
  /* 双向链接整条是高级版能力（copylink 走 requireCap('bilink')）。
     以前这里写「基础版：部分（仅单条）」，但那条免费路径 copylinkurl
     没有任何 UI 入口——表里承诺了，界面上找不到，比不给更糟。 */
  { name: '划线复制为双向链接', free: 'no', pro: 'yes', cap: 'bilink' },
  { name: '导出结构化 Markdown', free: 'no', pro: 'yes', cap: 'export' },
  { name: '书摘卡片', free: 'no', pro: 'yes', cap: 'card' },
  { name: '阅读统计、热力图与每本进度', free: 'no', pro: 'yes', cap: 'stats' },
  { name: '跨书搜索', free: 'no', pro: 'yes', cap: 'crossSearch' },
  { name: 'AI 回答 / 摘要 / 解释 / 翻译', free: 'no', pro: 'yes', cap: 'ai' },
  { name: 'mobi / azw3 / fb2 / 漫画', free: 'no', pro: 'yes', cap: 'fullFormats' },
  { name: '竖排排版', free: 'no', pro: 'yes', cap: 'vertical' },
  { name: '朗读', free: 'no', pro: 'yes', cap: 'tts' },
  { name: '原文与译文并排', free: 'no', pro: 'yes', cap: 'parallel' },
  { name: '全书鸟瞰', free: 'no', pro: 'yes', cap: 'bookmap' },
];
