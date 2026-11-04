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

/**
 * 书页配色：只有一档「跟随 Obsidian」。
 *
 * 以前给过纸/墨/羊皮/苔/夜五套自持色板，装进 Obsidian 后全是噪音——
 * 用户换主题、切明暗，唯独阅读区还压着一块暖色，像贴了张别的软件的截图。
 * 现在底色与正文色直接取宿主的 --background-primary / --text-normal，
 * 明暗跟着宿主走；想区分「书」和「笔记」，靠的应该是强调色与版式，不是底色。
 */
/** 强调色：默认跟随宿主 accent，其余几档是自持色（明暗各一档） */
export type AccentName = 'auto' | 'copper' | 'vermilion' | 'indigo' | 'moss';
export type FontFamilyName = 'book' | 'serif' | 'sans';
export type TextAlign = 'left' | 'justify';
/** 竖排（writing-mode: vertical-rl）是东亚长文阅读的一等需求，不是装饰 */
export type LayoutMode = 'horizontal' | 'vertical';
export type ColumnCount = 1 | 2;
/** 脚注行为：上方浮窗先看一行注释，还是老实地跳到章末 */
export type FootnoteMode = 'popup' | 'jump';
/**
 * 翻页还是滚动。
 *
 * 分页是默认（书的感觉，也是移动端唯一顺手的模式）；
 * 滚动是桌面阅读的第一诉求——想往上回看两行，分页只能整页翻回去。
 */
export type FlowMode = 'paged' | 'scroll';

export interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  margin: number;
  fontFamily: FontFamilyName;
  align: TextAlign;
  /* 这里曾经有 theme：五套皮肤撤掉之后它只剩 'auto' 一个值，
     normalizePrefs 也只会写 'auto'。留着它就等于留一个永远是假的开关。 */
  /** 强调色：章题短线、壳层选中态与滑杆都用它 */
  accent: AccentName;
  /** 排版方向。竖排只影响书页内容，界面照旧横排 */
  layout: LayoutMode;
  /** 分页栏数。竖排时引擎强制单栏（竖排双栏的扫描顺序没人看得懂） */
  columns: ColumnCount;
  /**
   * 点注释号：上方浮窗或直接跳到章末。
   * 默认 **popup**：浮窗已并入基础版（2026-11-03），不再是付费项。
   */
  footnote: FootnoteMode;
  /**
   * 朗读语速（0.6–2）。1 是系统默认。
   *
   * 以前写死 `rate = 1`：读技术书嫌快、读小说嫌慢，用户没有任何办法。
   */
  ttsRate: number;
  /**
   * 朗读跟随阅读位置。
   *
   * 开（默认）：念完这一页自动翻下一页接着念；手动翻页 / 点正文时停下。
   * 关：只念当前页，念完就结束。
   */
  ttsFollow: boolean;
  /** 翻页 / 滚动（见 FlowMode） */
  flow: FlowMode;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 18,
  lineHeight: 2.0,
  margin: 32,
  fontFamily: 'book',
  align: 'justify',
  accent: 'copper',
  layout: 'horizontal',
  columns: 1,
  footnote: 'popup',
  ttsRate: 1,
  ttsFollow: true,
  flow: 'paged',
};

export const FONT_SIZE_RANGE = { min: 14, max: 30, step: 1 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.4, step: 0.1 } as const;
export const MARGIN_RANGE = { min: 8, max: 120, step: 4 } as const;
export const TTS_RATE_RANGE = { min: 0.6, max: 2, step: 0.1 } as const;

/** 字体选项：值 → 注入 iframe 的 font-family；book = 不覆盖，跟随书自带 */
export const FONT_FAMILIES: Array<{ value: FontFamilyName; label: string; css: string }> = [
  { value: 'book', label: '跟随书籍', css: '' },
  { value: 'serif', label: '宋体 / 衬线', css: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif' },
  { value: 'sans', label: '黑体 / 无衬线', css: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
];

/**
 * 强调色档位。
 *
 * 默认档不写死颜色，读宿主的 --interactive-accent——换 Obsidian 主题时
 * 阅读器的章题短线、首字、选中态跟着变，不会出现「紫主题配铜线」。
 * 自持的几档都给明暗两色：同一支朱砂在白底和炭底上不是一个明度。
 */
export const ACCENT_OPTIONS: Array<{ value: AccentName; label: string; css: string; dark: string }> = [
  { value: 'auto', label: '跟随 Obsidian', css: '', dark: '' },
  { value: 'copper', label: '铜金', css: '#9a7434', dark: '#c8a464' },
  { value: 'vermilion', label: '朱砂', css: '#b0452f', dark: '#d9705a' },
  { value: 'indigo', label: '黛蓝', css: '#3f5b8f', dark: '#8aa7d6' },
  { value: 'moss', label: '苔青', css: '#4c6b52', dark: '#93b79a' },
];

/**
 * 旧书页主题名 → 'auto'。
 *
 * 这些值还躺在用户的 bz-reader.json 里。以前是「不认识就跳默认」，
 * 现在默认就是 auto，所以只需要认出来别当成脏数据。留着这张表，
 * 是为了将来再加档时不用重蹈覆辙。
 */
export const LEGACY_THEMES: ReadonlySet<string> = new Set([
  'paper', 'ink', 'parchment', 'moss', 'night', 'light', 'sepia', 'green', 'dark',
]);

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizePrefs(raw: unknown): ReaderPrefs {
  const p = (raw ?? {}) as Partial<ReaderPrefs>;
  // 旧主题值（纸/墨/羊皮/苔/夜）不再辨认，统一并进 auto——见 LEGACY_THEMES
  const accent = ACCENT_OPTIONS.some((a) => a.value === p.accent) ? (p.accent as AccentName) : DEFAULT_PREFS.accent;
  const family = FONT_FAMILIES.some((f) => f.value === p.fontFamily)
    ? (p.fontFamily as FontFamilyName)
    : DEFAULT_PREFS.fontFamily;
  return {
    fontSize: Math.round(clamp(p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, DEFAULT_PREFS.fontSize)),
    lineHeight: Math.round(clamp(p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, DEFAULT_PREFS.lineHeight) * 10) / 10,
    margin: Math.round(clamp(p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max, DEFAULT_PREFS.margin)),
    fontFamily: family,
    align: p.align === 'left' ? 'left' : 'justify',
    accent,
    layout: p.layout === 'vertical' ? 'vertical' : 'horizontal',
    columns: p.columns === 2 ? 2 : 1,
    footnote: p.footnote === 'jump' ? 'jump' : 'popup',
    ttsRate: Math.round(clamp(p.ttsRate, TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, DEFAULT_PREFS.ttsRate) * 10) / 10,
    ttsFollow: p.ttsFollow !== false,
    flow: p.flow === 'scroll' ? 'scroll' : 'paged',
  };
}

/**
 * 授权门控后的排版偏好：竖排 / 双栏是高级能力，没解锁就按横排单栏渲染。
 *
 * 只改「实际生效的值」，不动用户存下来的偏好——到期降级后重新激活，
 * 原来的竖排 / 双栏会自动回来，不用再设一次。
 */
export function gatedPrefs(p: ReaderPrefs, unlocked: boolean): ReaderPrefs {
  return unlocked ? p : { ...p, layout: 'horizontal', columns: 1 };
}
