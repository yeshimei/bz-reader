/* ============================================================
 * bz-reader · 插件设置（data/settings.ts）
 *
 * 与 prefs 分开：prefs 是「读的时候怎么显示」，改一次立刻见效、跟书无关；
 * settings 是「插件怎么工作」，属于配置而不是操作，改完不必马上重排版面。
 *
 * 落点也不一样（2026-11-04 改）：
 *   settings → `.obsidian/plugins/bz-reader/data.json`（设备本地配置）
 *   prefs    → `bz-reader/storage/bz-reader.json`（跟着库走，换设备还想保持手感）
 *
 * 为什么 AI Key 不进业务 JSON：用户会把 `bz-reader/storage/bz-reader.json` 发给
 * 别人看划线，顺手把自己的 API Key 一起发出去就不妙了。
 *
 * 所有取值同样过 normalizeSettings：手改坏的 JSON、旧版本留下的字段、
 * 空字符串，一律夹回可用范围——一个地址少个 https:// 的代价是
 * 「AI 按钮点了没反应」，而用户不会想到去看设置。
 *
 * 2026-11-11：AI 设置从「地址 / 密钥 / 模型」三件套改成分服务商存——选中哪家
 * 就用哪家的密钥与模型（切回来还是上次的值）。旧数据在这里一次性搬进「自定义」：
 * 老版本填的地址本来就是某个 OpenAI 兼容服务，正好对上自定义那一档。
 * ============================================================ */

import { isLocale, type LanguagePref } from '../i18n';
import {
  DEFAULT_AI_PROVIDER,
  aiProviderSpec,
  isAiProviderId,
  type AiProviderId,
} from './ai-providers';

export interface AiSettings {
  /**
   * 当前服务商（data/ai-providers 的注册表 id）。
   *
   * 选它就等于选了一组默认值：地址与默认模型由注册表给，用户只需要填密钥。
   * 存 id 而不是存地址，是为了让「切到智谱」这种操作不必让用户动手改三个框。
   */
  provider: AiProviderId;
  /** 自定义服务商的接口地址（仅 provider === 'custom' 时生效；其他家由注册表带） */
  baseUrl: string;
  /** 各服务商的密钥（键 = 服务商 id；空 = 没填） */
  keys: Partial<Record<AiProviderId, string>>;
  /** 各服务商的模型（键 = 服务商 id；空 = 用该服务商的默认模型） */
  models: Partial<Record<AiProviderId, string>>;
  /*
   * 这里**故意没有**嵌入模型。
   *
   * 2026-11-07 决策回摆：向量这一层归第二大脑（bz），模型名与嵌入都由它提供
   * （data/bz-bridge 的 bzEmbedder）。以前这里有一条 embedModel，用户填得和
   * bz 不一致时两边向量不在一个空间，检索会静默给错结果——界面一切正常，
   * 答案离谱。留一条能填错的字段就是留一个静默错误源。
   */
}

export interface ReaderSettings {
  /** 书摘导出目录（vault 相对路径，默认 `bz-reader/notes`） */
  exportDir: string;
  /** 导出时带上想法 */
  exportComments: boolean;
  /** 本地文件导入时写进哪个文件夹（vault 相对路径，默认 `bz-reader/books`；'/' = 库根目录） */
  importDir: string;
  /**
   * 界面语言：`auto` 跟随 Obsidian，`zh` / `en` 由用户在设置页手动指定。
   *
   * 放 settings（设备本地）而不是 prefs（跟库走）：语言是这台机器的偏好，
   * 换设备该用那台机器的设置，不该被同步过来的库改掉。
   */
  language: LanguagePref;
  ai: AiSettings;
  /*
   * 这里**故意没有**「连接至 BZ AI 知识库」开关。
   *
   * 2026-11-07 改成自动识别：检测到 bz（能力齐全）就连，检测不到就只用这本书。
   * 留一个开关等于让用户选「要不要让两个库连起来」，而这件事他自己判断不了
   * （连上有什么好处、会多发什么出去，比多一个勾选复杂得多）。
   * 判断在 data/bz-bridge 的 bzEntryReady / bzNotesReady，逐项降级。
   */
  /**
   * 「会把什么发给 AI」那份说明是否已经确认过。
   *
   * 记在这台机器上（settings 不跟库同步）：换台电脑第一次用知识库时
   * 再讲一遍是应该的，那个人没看过。
   */
  aiAck: boolean;
  /**
   * 调试日志：把触摸、选区、翻页、跳转写进数据目录的 `debug.json`。
   *
   * 只在排查「划词时页面乱跳」这类真机问题时要打开。默认关，关着时
   * 一个字节都不写（判断在 data/debug-log）。正式包里也留着——用户
   * 遇到问题时能自己开一次抓现场，比让他连着电脑看控制台现实。
   */
  debugLog: boolean;
  /*
   * 这里**故意没有** license。
   *
   * 2026-11-04 之前它同时写进 localStorage 和这份设置，但没有任何读取方，
   * 而 clearLicense() 只清前者——于是设置页输入框里还显示着激活码、状态行
   * 还写着「已激活」，can() 却是 false。授权只有一个真相：
   * data/entitlement.ts 的 Ent.license（存 data.json）。
   */
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  /* 三个目录都在库根的 `bz-reader/` 下，各占一个子目录（见 core/plugin-path.ts）。
     `notes` 是唯一要被用户当笔记编辑的：导出后它就归用户的笔记系统管了。 */
  exportDir: 'bz-reader/notes',
  exportComments: true,
  importDir: 'bz-reader/books',
  language: 'auto',
  ai: {
    provider: DEFAULT_AI_PROVIDER,
    baseUrl: '',
    keys: {},
    models: {},
  },
  aiAck: false,
  debugLog: false,
};

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * 去掉目录首尾斜杠，避免拼出 `//书摘//书.md` 这种路径；'/' 保留为库根目录。
 *
 * 与 core/plugin-path.ts 的 normalizeDataDir 同口径：按段过滤 `..` / `.` /
 * 点开头的隐藏目录。exportDir 是自由文本框，不拦的话 `../x` 会把笔记写到
 * 数据目录之外（随库同步来的 bz-reader.json 也能触发）。
 */
function cleanDir(v: string, fallback = DEFAULT_SETTINGS.exportDir): string {
  const s = v.replace(/\\/g, '/').trim();
  if (s === '/') return '/';
  const segs = s
    .split('/')
    .map((x) => x.trim())
    .filter((x) => !!x && x !== '.' && x !== '..' && !x.startsWith('.'));
  return segs.join('/') || fallback;
}

function cleanUrl(v: string): string {
  const s = v.trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** 只收认识的服务商 id、只收非空字符串：手改坏的 JSON 不该把对象带进请求里 */
function cleanProviderMap(raw: unknown): Partial<Record<AiProviderId, string>> {
  const out: Partial<Record<AiProviderId, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAiProviderId(k)) continue;
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) out[k] = s;
  }
  return out;
}

/**
 * AI 设置收口（含 v0.1 一次性搬家）。
 *
 * 判据是「有没有 provider 字段」：有 = 新结构；没有 = 旧版三件套
 * （baseUrl / apiKey / model）。旧数据里填了地址的，说明他在用一个 OpenAI
 * 兼容服务——整份搬进「自定义」，升级后按钮照样能点。旧数据只有密钥、
 * 没填地址的，留作 DeepSeek 的密钥（他们多半就是想用 DeepSeek，只是没填完）。
 */
function normalizeAi(raw: unknown): AiSettings {
  const ai = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const legacy = !('provider' in ai);
  const baseUrl = cleanUrl(str(ai.baseUrl));
  const provider: AiProviderId = isAiProviderId(ai.provider)
    ? ai.provider
    : legacy && baseUrl
      ? 'custom'
      : DEFAULT_AI_PROVIDER;
  const keys = cleanProviderMap(ai.keys);
  const models = cleanProviderMap(ai.models);
  if (legacy) {
    const legacyKey = str(ai.apiKey).trim();
    const legacyModel = str(ai.model).trim();
    const slot: AiProviderId = provider === 'custom' ? 'custom' : 'deepseek';
    if (legacyKey) keys[slot] = legacyKey;
    if (legacyModel) models[slot] = legacyModel;
  }
  return { provider, baseUrl, keys, models };
}

export function normalizeSettings(raw: unknown): ReaderSettings {
  const s = (raw ?? {}) as Partial<ReaderSettings>;
  return {
    exportDir: cleanDir(str(s.exportDir, DEFAULT_SETTINGS.exportDir)),
    exportComments: s.exportComments !== false,
    importDir: cleanDir(str(s.importDir, DEFAULT_SETTINGS.importDir), DEFAULT_SETTINGS.importDir),
    /* 只认八种语言 + auto：手改坏的 JSON、旧版本没有这个字段、写了别的语言，
       都退回 auto——宁可跟随宿主，也不要钉死一个用户没选过的语言。 */
    language: isLocale(s.language) ? s.language : 'auto',
    ai: normalizeAi(s.ai),
    aiAck: s.aiAck === true,
    debugLog: s.debugLog === true,
  };
}

/** 一次请求要用的真实配置（服务商表 + 用户填的值合出来的结果） */
export interface ResolvedAi {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 把设置解析成「这次请求实际用哪个地址、密钥、模型」。
 *
 * 这是全仓唯一的解析口：aiAsk 发请求、设置页画「获取模型」按钮、
 * 各处的可用判断都从这里取，禁止在别处再拼一遍。模型留空 = 用该服务商
 * 的注册表默认（这正是「只填密钥就能用」成立的原因）。
 */
export function resolveAi(s: ReaderSettings): ResolvedAi {
  const spec = aiProviderSpec(s.ai.provider);
  /* keys/models 用 ?. 防御：设置页之外还会有测试或旧对象直接拼 ReaderSettings */
  return {
    provider: spec.id,
    baseUrl: spec.endpoint || s.ai.baseUrl,
    apiKey: (s.ai.keys?.[spec.id] ?? '').trim(),
    model: ((s.ai.models?.[spec.id] ?? '') || spec.model).trim(),
  };
}

/**
 * AI 是否可用：当前服务商地址与模型齐备，密钥按该家要求（Ollama 本地、
 * 无鉴权的自建服务可以留空）。缺一样都不该把按钮点亮。
 */
export function aiReady(s: ReaderSettings): boolean {
  const spec = aiProviderSpec(s.ai.provider);
  const r = resolveAi(s);
  return !!r.baseUrl && !!r.model && (!!r.apiKey || !spec.keyRequired);
}

/* 建索引要不要「嵌入配好了」这个判断？不用了：嵌入由第二大脑提供，
   能不能借到看 data/bz-bridge 的 bzEmbedder（它连 bz 在不在一起答）。
   设置里已经没有嵌入模型这一项，再留一个 embedReady() 只会让人以为这里还有。 */
