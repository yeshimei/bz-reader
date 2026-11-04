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
export type AccentName = 'auto' | 'copper' | 'vermilion' | 'indigo' | 'moss' | 'ink' | 'plum' | 'celadon';
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
  /** 左右页边距：一行有多宽 */
  margin: number;
  /**
   * 上下页边距：一页有多满。
   *
   * 与 `margin` 分开是有理由的：手机上栏宽由屏幕决定（左右调不出花来），
   * 真正决定「一屏能放多少行」的是上下留白。以前上下写死在主题里
   * （桌面 28/40、手机 18/48），谁都觉得不对，但谁也改不了。
   */
  marginY: number;
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
  /**
   * 阅读页右上角图标的顺序与隐藏项（隐藏的收进 ⋮）。
   * 空数组 = 用默认顺序；只认 header-actions.ts 里那五个 id。
   */
  headerOrder: string[];
  headerHidden: string[];
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 18,
  /* 2.05 是定稿量出来的：2.0 在中文字里太挤，2.1 又散（ui-spec 的「尺寸口径」） */
  lineHeight: 2.05,
  margin: 32,
  /* 28 是原来桌面写死的那个上边距；手机端由 theme.ts 在底部再加一点，
     免得最后一行被宿主的悬浮导航条压住 */
  marginY: 28,
  fontFamily: 'book',
  align: 'justify',
  accent: 'copper',
  layout: 'horizontal',
  columns: 1,
  footnote: 'popup',
  ttsRate: 1,
  ttsFollow: true,
  flow: 'paged',
  headerOrder: [],
  headerHidden: [],
};

export const FONT_SIZE_RANGE = { min: 14, max: 30, step: 1 } as const;
/* 步长 0.05：定稿默认 2.05 就落在这条线上，step 0.1 会把它四舍五入成 2.1 */
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.4, step: 0.05 } as const;
export const MARGIN_RANGE = { min: 8, max: 120, step: 4 } as const;
/* 下限 0：有人就喜欢正文从顶边第一行开始（屏幕小的时候尤其） */
export const MARGIN_Y_RANGE = { min: 0, max: 120, step: 4 } as const;
export const TTS_RATE_RANGE = { min: 0.6, max: 2, step: 0.1 } as const;

/** 字体选项：值 → 注入 iframe 的 font-family；book = 不覆盖，跟随书自带 */
export const FONT_FAMILIES: Array<{ value: FontFamilyName; label: string; css: string }> = [
  { value: 'book', label: '跟随书籍', css: '' },
  { value: 'serif', label: '宋体', css: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif' },
  { value: 'sans', label: '黑体', css: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
];

/**
 * 强调色档位。
 *
 * 默认档不写死颜色，读宿主的 --interactive-accent——换 Obsidian 主题时
 * 阅读器的章题短线、首字、选中态跟着变，不会出现「紫主题配铜线」。
 * 自持的几档都给明暗两色：同一支朱砂在白底和炭底上不是一个明度。
 */
export const ACCENT_OPTIONS: Array<{ value: AccentName; label: string; css: string; dark: string }> = [
  { value: 'auto', label: '原生', css: '', dark: '' },
  { value: 'copper', label: '铜金', css: '#9a7434', dark: '#c8a464' },
  { value: 'vermilion', label: '朱砂', css: '#b0452f', dark: '#d9705a' },
  { value: 'indigo', label: '黛蓝', css: '#3f5b8f', dark: '#8aa7d6' },
  { value: 'moss', label: '苔青', css: '#4c6b52', dark: '#93b79a' },
  { value: 'ink', label: '墨色', css: '#2f3338', dark: '#c9d0d8' },
  { value: 'plum', label: '绛紫', css: '#8a3a4a', dark: '#d98a99' },
  { value: 'celadon', label: '天青', css: '#3f7474', dark: '#8fc6c6' },
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

/**
 * 按平台取偏好：桌面 `prefsDesktop`、移动 `prefsMobile`。
 *
 * 老数据只有一份全局 `prefs`——第一次读任一平台时先拿它当初始值，
 * 之后各写各的槽。这样升级不会突然把用户调好的字号清零。
 */
export function pickPrefs(data: unknown, mobile: boolean): ReaderPrefs {
  const d = (data ?? {}) as Record<string, unknown>;
  return normalizePrefs(d[mobile ? 'prefsMobile' : 'prefsDesktop'] ?? d.prefs ?? undefined);
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

/** 头栏图标 id 白名单（与 view/header-actions.ts 的 SPEC 对齐，这里不 import 视图层） */
const HEADER_IDS = [
  'toc',
  'search',
  'mark',
  'type',
  'para',
  'paraBook',
  'tts',
  'bookmap',
  'immersive',
  'library',
] as const;

function headerIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const item of list) {
    const id = String(item);
    if ((HEADER_IDS as readonly string[]).includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
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
    /* 按 0.05 取整：滑块步长与默认值都是这档，按 0.1 存会把 2.05 变成 2.1 */
    lineHeight:
      Math.round(clamp(p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, DEFAULT_PREFS.lineHeight) * 20) / 20,
    margin: Math.round(clamp(p.margin, MARGIN_RANGE.min, MARGIN_RANGE.max, DEFAULT_PREFS.margin)),
    marginY: Math.round(clamp(p.marginY, MARGIN_Y_RANGE.min, MARGIN_Y_RANGE.max, DEFAULT_PREFS.marginY)),
    fontFamily: family,
    align: p.align === 'left' ? 'left' : 'justify',
    accent,
    layout: p.layout === 'vertical' ? 'vertical' : 'horizontal',
    columns: p.columns === 2 ? 2 : 1,
    footnote: p.footnote === 'jump' ? 'jump' : 'popup',
    ttsRate: Math.round(clamp(p.ttsRate, TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, DEFAULT_PREFS.ttsRate) * 10) / 10,
    ttsFollow: p.ttsFollow !== false,
    flow: p.flow === 'scroll' ? 'scroll' : 'paged',
    headerOrder: headerIds(p.headerOrder),
    headerHidden: headerIds(p.headerHidden),
  };
}

/**
 * 授权门控后的排版偏好：竖排仍是高级能力，没解锁就按横排渲染。
 *
 * 双栏**不再参与门控**（2026-11-05 下放基础版）：分栏是版式的基础诉求，
 * 单栏/双栏在手机上都能用，没必要锁。`vertical` 这个能力名留着不动——
 * 改能力 id 会让已发出的激活码里那份 capability 清单对不上。
 *
 * 只改「实际生效的值」，不动用户存下来的偏好——到期降级后重新激活，
 * 原来的竖排会自动回来，不用再设一次。
 */
export function gatedPrefs(p: ReaderPrefs, unlocked: boolean): ReaderPrefs {
  return unlocked ? p : { ...p, layout: 'horizontal' };
}
