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
 * 2026-11-11 同日回摆：AI 配置还原成「地址 / 模型 / 密钥」三个自由输入框，
 * 不提供服务商选择。前一版按服务商存的结构（provider / keys[provider] /
 * models[provider]）在 normalizeSettings 里一次性搬回三件套——老 data.json
 * 升级后地址、密钥、模型都还在，不会因为换回自由输入而丢配置。
 * ============================================================ */

import { isLocale, type LanguagePref } from '../i18n';
import { normalizeFormat } from '../core/tts-local';
import type { LocalTtsSettings, OnlineTtsSettings } from '../core/tts-engine';
import { DEFAULT_CLIP_SCOPE, normalizeClipScope, type ClipScope } from './clip-epub/scope';

export interface AiSettings {
  /** OpenAI 兼容根地址，不带结尾斜杠，例如 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  /** 对话模型（压缩方案、提问、摘录） */
  model: string;
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
  /**
   * 本地语音服务（2026-11-14）。
   *
   * 和 `ai` 一样是「服务配置」，放 settings 不放 prefs：它跟着这台机器走，
   * 换台电脑该连那台机器的 127.0.0.1。音色不在这里——那是听感，跟书走，
   * 在 prefs.ttsVoiceLocal。
   */
  ttsLocal: LocalTtsSettings;
  /**
   * 在线语音服务（2026-11-14 从 AI 组独立出来）。
   *
   * 以前朗读借 `ai.baseUrl` 与 `ai.apiKey`，等于把「朗读用哪家」绑死在
   * 「AI 问答用哪家」上。现在自带地址 / 模型 / 密钥：两件事的账号未必
   * 相同，地址也可能是不同的代理。空地址 = 用 DeepSeek 官方默认。
   */
  ttsOnline: OnlineTtsSettings;
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
   * 「朗读会把正文发给语音服务」那条说明是否已经提示过。
   *
   * 与 aiAck 分开：AI 问答与朗读是两条独立的出网路径，用户可能只开其中
   * 一条。记在这台机器上（settings 不跟库同步），换台电脑再讲一遍。
   */
  ttsAck: boolean;
  /**
   * 朗读花掉的估算（2026-11-13）：计费字符与元。
   *
   * 只是**本地估算**，不是账单：按刊例价与送出的文本累加，缓存命中的
   * 也算进去了（宁可高估）。存在 settings（本机），不跟库同步。
   */
  ttsStats: { chars: number; cost: number };
  /**
   * 调试日志：把触摸、选区、翻页、跳转写进数据目录的 `debug.json`。
   *
   * 只在排查「划词时页面乱跳」这类真机问题时要打开。默认关，关着时
   * 一个字节都不写（判断在 data/debug-log）。正式包里也留着——用户
   * 遇到问题时能自己开一次抓现场，比让他连着电脑看控制台现实。
   */
  debugLog: boolean;
  /**
   * 剪藏本（2026-11-13）：书架里多一本固定入口的「剪藏成书」，内容实时读 bz
   * 剪藏本——不是快照、不生成文件。
   *
   * 默认**关**：这是要用户主动开的功能，不像知识盒那样检测到 bz 就自动连——
   * 书架突然多出一本不是自己放进去的书，比「没有这本书」更让人困惑。
   *
   * 开关只在检测到 bz 时出现（render/settings.ts 的 bz 组），
   * 但**值照常存**：拆了 bz 再装回来，用户上次的选择还在。关掉只是把它从书架
   * 移开，进度与每章时长留在数据里，再开还在。
   */
  clipBook: boolean;
  /**
   * 剪藏成书的「汇总范围」（2026-11-14）：这本书收哪些文章。
   *
   * 三档：全部 / 未读 / 今日+未读，默认**未读**——这是一本「活书」，
   * 每天打开都该是还没读的部分，把读过的几百篇一起塞进来只会让人找不到
   * 今天要读的那几篇。口径见 data/clip-epub/scope.ts（saved 算没读过）。
   */
  clipScope: ClipScope;
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
    baseUrl: '',
    apiKey: '',
    model: '',
  },
  /* 地址预填好：装机最常见的两种服务各给一条，用户照着改比从空框开始容易
     （2026-11-14 用户要求）。格式默认 mp3：本地一章 wav 要 290 MB，
     mp3 只要 48 MB，「预下载整章」这件事只有 mp3 才成立。 */
  ttsLocal: {
    url: 'http://127.0.0.1:8880',
    model: '',
    apiKey: '',
    format: 'mp3',
  },
  /* 预填 DeepSeek 官方地址；密钥默认空：老用户升级时由 normalizeSettings
     从 AI 组搬一份过来。 */
  ttsOnline: {
    url: 'https://api.deepseek.com',
    model: '',
    apiKey: '',
    format: 'mp3',
  },
  aiAck: false,
  ttsAck: false,
  ttsStats: { chars: 0, cost: 0 },
  debugLog: false,
  clipBook: false,
  clipScope: DEFAULT_CLIP_SCOPE,
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

/**
 * 2026-11-11 分服务商结构里写死的地址与默认模型，只用来搬旧数据。
 * 新配置本身不再认服务商，这张表也不会被设置页读取。
 */
const LEGACY_AI_PROVIDERS: Record<string, { endpoint: string; model: string }> = {
  deepseek: { endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  'zhipu-plan': { endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5.3-flash' },
  ollama: { endpoint: 'http://localhost:11434/v1', model: 'llama3.1' },
};

/** 从按服务商分存的对象里取一项；非字符串、空串都当没填 */
function providerValue(raw: unknown, id: string): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const v = (raw as Record<string, unknown>)[id];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * AI 设置收口（含两次结构变更的搬家）。
 *
 * 判据是「有没有 provider 字段」：没有 = 旧版三件套（baseUrl / apiKey / model），
 * 有 = 2026-11-11 的分服务商结构。后者把当时选中的那一家搬回三件套：
 *   · custom（以及认不出的 id）用旧 baseUrl 与 keys.custom / models.custom；
 *   · 三家预设用当时写死的地址与默认模型，模型没填过就补默认值——不补的话
 *     升级后 aiReady 会突然变 false，用户以为配置丢了。
 */
function normalizeAi(raw: unknown): AiSettings {
  const ai = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const provider = str(ai.provider).trim();
  if (!provider) {
    return {
      baseUrl: cleanUrl(str(ai.baseUrl)),
      apiKey: str(ai.apiKey).trim(),
      model: str(ai.model).trim(),
    };
  }
  const preset = LEGACY_AI_PROVIDERS[provider];
  const customOnly = !preset;
  return {
    baseUrl: preset ? preset.endpoint : cleanUrl(str(ai.baseUrl)),
    apiKey: providerValue(ai.keys, provider) || (customOnly ? providerValue(ai.keys, 'custom') : ''),
    model:
      providerValue(ai.models, provider) ||
      preset?.model ||
      (customOnly ? providerValue(ai.models, 'custom') : ''),
  };
}

/**
 * 本地服务地址。
 *
 * 和 `cleanUrl` 分开：那边是云端 API，少个协议就补 https；本地服务默认
 * 是明文 http（127.0.0.1:8880 / 192.168.1.9:8080），补 https 只会连不上。
 * 已经写了协议的照原样，不替人改。
 */
function cleanLocalUrl(v: string): string {
  const s = v.trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

function normalizeTtsLocal(raw: unknown): LocalTtsSettings {
  /* 整份配置都没有（全新安装）= 用预填的地址；用户自己清空则保持空 */
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS.ttsLocal };
  const o = raw as Record<string, unknown>;
  return {
    url: cleanLocalUrl(str(o.url)),
    model: str(o.model).trim(),
    apiKey: str(o.apiKey).trim(),
    format: normalizeFormat(o.format),
  };
}

/**
 * 在线语音设置（2026-11-14）。
 *
 * 地址按云端口径补 https（用户的在线服务基本都是域名，不是本机回环）；
 * 例外是内网网关写的 192.168.x.x —— 那种补 https 会连不上，所以和本地
 * 一样：没写协议时，本机 / 内网地址补 http，其余补 https。
 *
 * `fallback` 只在**这份配置根本不存在**时用（老版本升级）：把 AI 组当时的
 * 地址与密钥搬一份过来，否则升级后点朗读直接变「未配置」——这是事故。
 * 用户之后主动清空地址不会再次被搬回来（对象存在就不搬）。
 */
function normalizeTtsOnline(raw: unknown, fallback: AiSettings): OnlineTtsSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      /* AI 组填过就沿用它，没填过就预填官方地址，别留一个空框 */
      url: cleanServiceUrl(fallback.baseUrl) || DEFAULT_SETTINGS.ttsOnline.url,
      model: '',
      apiKey: fallback.apiKey,
      format: 'mp3',
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    url: cleanServiceUrl(str(o.url)),
    model: str(o.model).trim(),
    apiKey: str(o.apiKey).trim(),
    format: normalizeFormat(o.format),
  };
}

/** 在线服务地址：本机 / 内网补 http，公网域名补 https */
function cleanServiceUrl(v: string): string {
  const s = v.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s);
  return `${local ? 'http' : 'https'}://${s}`;
}

export function normalizeSettings(raw: unknown): ReaderSettings {
  const s = (raw ?? {}) as Partial<ReaderSettings>;
  const ai = normalizeAi(s.ai);
  return {
    exportDir: cleanDir(str(s.exportDir, DEFAULT_SETTINGS.exportDir)),
    exportComments: s.exportComments !== false,
    importDir: cleanDir(str(s.importDir, DEFAULT_SETTINGS.importDir), DEFAULT_SETTINGS.importDir),
    /* 只认八种语言 + auto：手改坏的 JSON、旧版本没有这个字段、写了别的语言，
       都退回 auto——宁可跟随宿主，也不要钉死一个用户没选过的语言。 */
    language: isLocale(s.language) ? s.language : 'auto',
    ai,
    ttsLocal: normalizeTtsLocal(s.ttsLocal),
    ttsOnline: normalizeTtsOnline(s.ttsOnline, ai),
    aiAck: s.aiAck === true,
    ttsAck: s.ttsAck === true,
    ttsStats: {
      chars: Math.max(0, Math.round(Number(s.ttsStats?.chars) || 0)),
      cost: Math.max(0, Number(s.ttsStats?.cost) || 0),
    },
    debugLog: s.debugLog === true,
    /* 缺字段（旧版本没有它）= 关：剪藏成书要人主动开，不能靠缺省值替人选 */
    clipBook: s.clipBook === true,
    /* 缺字段（1.3.1 之前没有）= 未读：这是用户定的默认值，不是「没选」 */
    clipScope: normalizeClipScope(s.clipScope),
  };
}

/** AI 是否可用了：三样齐了才算配好，缺一样都不该把按钮点亮 */
export function aiReady(s: ReaderSettings): boolean {
  return !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
}

/* 建索引要不要「嵌入配好了」这个判断？不用了：嵌入由第二大脑提供，
   能不能借到看 data/bz-bridge 的 bzEmbedder（它连 bz 在不在一起答）。
   设置里已经没有嵌入模型这一项，再留一个 embedReady() 只会让人以为这里还有。 */
