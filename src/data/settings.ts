/* ============================================================
 * bz-reader · 插件设置（data/settings.ts）
 *
 * 与 prefs 分开：prefs 是「读的时候怎么显示」，改一次立刻见效、跟书无关；
 * settings 是「插件怎么工作」，属于配置而不是操作，改完不必马上重排版面。
 * 两者都在同一份 bz-reader.json 里，少一个文件少一个丢的地方。
 *
 * 所有取值同样过 normalizeSettings：手改坏的 JSON、旧版本留下的字段、
 * 空字符串，一律夹回可用范围——一个 baseUrl 少个 https:// 的代价是
 * 「AI 按钮点了没反应」，而用户不会想到去看设置。
 * ============================================================ */

export interface AiSettings {
  /** OpenAI 兼容根地址，不带结尾斜杠，例如 https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ReaderSettings {
  /** 书摘导出目录（vault 相对路径） */
  exportDir: string;
  /** 导出时带上想法 */
  exportComments: boolean;
  /** 本地文件导入时写进哪个文件夹（vault 相对路径；'/' = 库根目录） */
  importDir: string;
  ai: AiSettings;
  /** 激活码原文（pro 版才看它） */
  license: string;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  exportDir: '书摘',
  exportComments: true,
  importDir: 'Books',
  ai: {
    baseUrl: '',
    apiKey: '',
    model: '',
  },
  license: '',
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
    ai: {
      baseUrl: cleanUrl(str(ai.baseUrl)),
      apiKey: str(ai.apiKey).trim(),
      model: str(ai.model).trim(),
    },
    license: str(s.license).trim(),
  };
}

/** AI 是否可用了：三样齐了才算配好，缺一样都不该把按钮点亮 */
export function aiReady(s: ReaderSettings): boolean {
  return !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
}
