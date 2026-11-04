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

/* 字体与强调色的档名走集中表（见下方 FONT_LABELS / ACCENT_LABELS）：成套选项
   不进主语言包，`Record<Locale, string>` 保证八种语言都齐。 */
import { locale, type Locale } from '../i18n';

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
export const TTS_RATE_RANGE = { min: 0.6, max: 2, step: 0.1 } as const;

/** 字体选项：值 → 注入 iframe 的 font-family；book = 不覆盖，跟随书自带 */
export const FONT_FAMILIES: Array<{ value: FontFamilyName; css: string }> = [
  { value: 'book', css: '' },
  { value: 'serif', css: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif' },
  { value: 'sans', css: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
];

/**
 * 强调色档位。
 *
 * 默认档不写死颜色，读宿主的 --interactive-accent——换 Obsidian 主题时
 * 阅读器的章题短线、首字、选中态跟着变，不会出现「紫主题配铜线」。
 * 自持的几档都给明暗两色：同一支朱砂在白底和炭底上不是一个明度。
 */
export const ACCENT_OPTIONS: Array<{ value: AccentName; css: string; dark: string }> = [
  { value: 'auto', css: '', dark: '' },
  { value: 'copper', css: '#9a7434', dark: '#c8a464' },
  { value: 'vermilion', css: '#b0452f', dark: '#d9705a' },
  { value: 'indigo', css: '#3f5b8f', dark: '#8aa7d6' },
  { value: 'moss', css: '#4c6b52', dark: '#93b79a' },
  { value: 'ink', css: '#2f3338', dark: '#c9d0d8' },
  { value: 'plum', css: '#8a3a4a', dark: '#d98a99' },
  { value: 'celadon', css: '#3f7474', dark: '#8fc6c6' },
];

/**
 * 字体档名与强调色档名走**集中表**，不进主语言包。
 *
 * 与颜色名同一个理由：成套的选项拆进八种语言后，「某个包漏翻一项」不会
 * 让 tsc 报错（key 还在），只会让德语用户在某一个档位上看到中文。
 * `Record<Locale, string>` 把「八种齐」变成类型约束。
 *
 * 宋体/黑体这类**中文字体名**对西文用户无意义，所以那边译成 Serif / Sans；
 * 日语仍用明朝体／ゴシック体（人家的书写习惯）。
 */
const FONT_LABELS: Record<FontFamilyName, Record<Locale, string>> = {
  book: {
    zh: '跟随书籍',
    'zh-TW': '跟隨書籍',
    en: 'Book default',
    ja: '書籍に合わせる',
    de: 'Buchschrift',
    fr: 'Texte du livre',
    es: 'Fuente del libro',
    pt: 'Fonte do livro',
  },
  serif: { zh: '宋体', 'zh-TW': '宋體', en: 'Serif', ja: '明朝体', de: 'Serif', fr: 'Serif', es: 'Serif', pt: 'Serif' },
  sans: { zh: '黑体', 'zh-TW': '黑體', en: 'Sans', ja: 'ゴシック体', de: 'Sans', fr: 'Sans', es: 'Sans', pt: 'Sans' },
};

const ACCENT_LABELS: Record<AccentName, Record<Locale, string>> = {
  /* 第一档跟着宿主的强调色走。文字点名 Obsidian：写「原生」看不出跟谁有关，
     写「跟随 Obsidian」与界面语言那一档同一套说法。 */
  auto: {
    zh: '跟随 Obsidian',
    'zh-TW': '跟隨 Obsidian',
    en: 'Follow Obsidian',
    ja: 'Obsidian に合わせる',
    de: 'Obsidian folgen',
    fr: 'Suivre Obsidian',
    es: 'Seguir Obsidian',
    pt: 'Seguir Obsidian',
  },
  copper: { zh: '铜金', 'zh-TW': '銅金', en: 'Copper', ja: '銅金', de: 'Kupfer', fr: 'Cuivre', es: 'Cobre', pt: 'Cobre' },
  vermilion: {
    zh: '朱砂',
    'zh-TW': '朱砂',
    en: 'Vermilion',
    ja: '朱砂',
    de: 'Zinnober',
    fr: 'Vermillon',
    es: 'Bermellón',
    pt: 'Vermelhão',
  },
  indigo: { zh: '黛蓝', 'zh-TW': '黛藍', en: 'Indigo', ja: '黛藍', de: 'Indigo', fr: 'Indigo', es: 'Índigo', pt: 'Anil' },
  moss: { zh: '苔青', 'zh-TW': '苔青', en: 'Moss', ja: '苔青', de: 'Moos', fr: 'Mousse', es: 'Musgo', pt: 'Musgo' },
  ink: { zh: '墨色', 'zh-TW': '墨色', en: 'Ink', ja: '墨色', de: 'Tusche', fr: 'Encre', es: 'Tinta', pt: 'Tinta' },
  plum: { zh: '绛紫', 'zh-TW': '絳紫', en: 'Plum', ja: '紅紫', de: 'Pflaume', fr: 'Prune', es: 'Ciruela', pt: 'Ameixa' },
  celadon: {
    zh: '天青',
    'zh-TW': '天青',
    en: 'Celadon',
    ja: '天青',
    de: 'Seladon',
    fr: 'Céladon',
    es: 'Celadón',
    pt: 'Celadon',
  },
};

/** 字体档名 → 当前界面语言的说法 */
export function fontLabel(value: FontFamilyName): string {
  return FONT_LABELS[value]?.[locale()] ?? FONT_LABELS[value]?.zh ?? String(value);
}

/** 强调色档名 → 当前界面语言的说法 */
export function accentLabel(value: AccentName): string {
  return ACCENT_LABELS[value]?.[locale()] ?? ACCENT_LABELS[value]?.zh ?? String(value);
}

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
 *
 * 「上下边距」撤档后老数据里可能还留着 marginY，normalizePrefs 会丢掉它。
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
