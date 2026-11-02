/* ============================================================
 * bz-reader · 阅读偏好（data/prefs.ts）
 *
 * 全局一份，不按书分（用户调字号不是为了这一本书调的）。
 * 存进 ReaderData.prefs，跟书架同一份 JSON。
 *
 * 所有取值都夹在范围内再落盘：滑块拖出来的值、手改坏的 JSON、
 * 旧版本留下的字段，一律经过 normalizePrefs 才进系统——
 * 少这一步的表现是「字号 400px，整页一个字」。
 * ============================================================ */

export type ThemeName = 'auto' | 'light' | 'sepia' | 'green' | 'dark';
export type FontFamilyName = 'book' | 'serif' | 'sans';
export type TextAlign = 'left' | 'justify';
/** 竖排（writing-mode: vertical-rl）是东亚长文阅读的一等需求，不是装饰 */
export type LayoutMode = 'horizontal' | 'vertical';
export type ColumnCount = 1 | 2;

export interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  margin: number;
  fontFamily: FontFamilyName;
  align: TextAlign;
  theme: ThemeName;
  /** 排版方向。竖排只影响书页内容，界面照旧横排 */
  layout: LayoutMode;
  /** 分页栏数。竖排时引擎强制单栏（竖排双栏的扫描顺序没人看得懂） */
  columns: ColumnCount;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 18,
  lineHeight: 1.8,
  margin: 32,
  fontFamily: 'book',
  align: 'justify',
  theme: 'auto',
  layout: 'horizontal',
  columns: 1,
};

export const FONT_SIZE_RANGE = { min: 14, max: 30, step: 1 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.4, step: 0.1 } as const;
export const MARGIN_RANGE = { min: 8, max: 72, step: 4 } as const;

/** 字体选项：值 → 注入 iframe 的 font-family；book = 不覆盖，跟随书自带 */
export const FONT_FAMILIES: Array<{ value: FontFamilyName; label: string; css: string }> = [
  { value: 'book', label: '跟随书籍', css: '' },
  { value: 'serif', label: '宋体 / 衬线', css: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif' },
  { value: 'sans', label: '黑体 / 无衬线', css: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
];

export const THEME_OPTIONS: Array<{ value: ThemeName; label: string; bg: string; fg: string }> = [
  { value: 'auto', label: '跟随 Obsidian', bg: '', fg: '' },
  { value: 'light', label: '纸白', bg: '#ffffff', fg: '#1f1f1f' },
  { value: 'sepia', label: '米黄', bg: '#f6ecd8', fg: '#3b3226' },
  { value: 'green', label: '护眼', bg: '#e2efe2', fg: '#26382a' },
  { value: 'dark', label: '暗夜', bg: '#17191d', fg: '#c8ccd2' },
];

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizePrefs(raw: unknown): ReaderPrefs {
  const p = (raw ?? {}) as Partial<ReaderPrefs>;
  const theme = THEME_OPTIONS.some((t) => t.value === p.theme) ? (p.theme as ThemeName) : DEFAULT_PREFS.theme;
  const family = FONT_FAMILIES.some((f) => f.value === p.fontFamily)
    ? (p.fontFamily as FontFamilyName)
    : DEFAULT_PREFS.fontFamily;
  return {
    fontSize: Math.round(clamp(p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, DEFAULT_PREFS.fontSize)),
    lineHeight: Math.round(clamp(p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, DEFAULT_PREFS.lineHeight) * 10) / 10,
    margin: Math.round(clamp(p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max, DEFAULT_PREFS.margin)),
    fontFamily: family,
    align: p.align === 'left' ? 'left' : 'justify',
    theme,
    layout: p.layout === 'vertical' ? 'vertical' : 'horizontal',
    columns: p.columns === 2 ? 2 : 1,
  };
}
