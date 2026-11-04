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
 * 空字符串，一律夹回可用范围——一个 baseUrl 少个 https:// 的代价是
 * 「AI 按钮点了没反应」，而用户不会想到去看设置。
 * ============================================================ */

import type { LanguagePref } from '../i18n';

export interface AiSettings {
  /** OpenAI 兼容根地址，不带结尾斜杠，例如 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
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

export function normalizeSettings(raw: unknown): ReaderSettings {
  const s = (raw ?? {}) as Partial<ReaderSettings>;
  const ai = (s.ai ?? {}) as Partial<AiSettings>;
  return {
    exportDir: cleanDir(str(s.exportDir, DEFAULT_SETTINGS.exportDir)),
    exportComments: s.exportComments !== false,
    importDir: cleanDir(str(s.importDir, DEFAULT_SETTINGS.importDir), DEFAULT_SETTINGS.importDir),
    /* 只认这三个值：手改坏的 JSON、旧版本没有这个字段、写了别的语言，都退回
       auto——宁可跟随宿主，也不要钉死一个用户没选过的语言。 */
    language: s.language === 'zh' || s.language === 'en' ? s.language : 'auto',
    ai: {
      baseUrl: cleanUrl(str(ai.baseUrl)),
      apiKey: str(ai.apiKey).trim(),
      model: str(ai.model).trim(),
    },
  };
}

/** AI 是否可用了：三样齐了才算配好，缺一样都不该把按钮点亮 */
export function aiReady(s: ReaderSettings): boolean {
  return !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
}
