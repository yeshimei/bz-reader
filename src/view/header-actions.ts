/**
 * 阅读页头栏的动作清单与开关态（纯函数，node 里可直接测）。
 *
 * 为什么要单独抽出来：
 *   · 动作数量原来按 `isMobileShell()` 判——桌面验收时打开 force-mobile，
 *     桌面窗口也只露 3 颗，另外两颗（排版 / 并排对照）折进 ⋮，用户以为
 *     「放得下却收起来了」。数量只该看**真实承载**：手机 3 颗、桌面 5 颗。
 *   · 书签图标要「这一页签过了就亮」，判据是 `bookmarkAt(book, 当前 cfi)`；
 *     这段以前写在视图里、还被 `void on` 吞掉，测不到也修不掉。
 */
import { locale, type Locale } from '../i18n';
import { bookmarkAt } from '../data/notes';
import type { ReaderBook } from '../data/schema';

export type HeaderActionId =
  | 'toc'
  | 'search'
  | 'mark'
  | 'type'
  | 'para'
  | 'paraBook'
  | 'tts'
  | 'bookmap'
  | 'immersive'
  | 'library';

export interface HeaderActionSpec {
  id: HeaderActionId;
  icon: string;
  label: string;
}

/**
 * 顺序即视觉顺序，与阅读页标签菜单（`onPaneMenu`）的十项一一对应。
 * 菜单里始终保留全部十项；设置页只决定「外面露哪几颗、按什么顺序」。
 *
 * 只存 id 与图标；**标签按当前界面语言现取**（见 LABELS）。做成常量字符串
 * 的话，切语言后要重载插件才变——而这个列表就在设置页里，用户改完语言
 * 立刻看见它还是中文，会以为切换失败。
 */
const SPEC: ReadonlyArray<{ id: HeaderActionId; icon: string }> = [
  { id: 'toc', icon: 'list' },
  { id: 'search', icon: 'search' },
  { id: 'mark', icon: 'bookmark' },
  { id: 'type', icon: 'type' },
  { id: 'para', icon: 'columns-2' },
  { id: 'paraBook', icon: 'book' },
  { id: 'tts', icon: 'volume-2' },
  { id: 'bookmap', icon: 'map' },
  { id: 'immersive', icon: 'maximize' },
  { id: 'library', icon: 'library' },
];

/**
 * 十颗图标的标签，含内置单键提示（（s）、（b）…）。
 *
 * 集中表而不是八份语言包：这十个是成套的，漏翻一颗只会表现为「德语界面里
 * 某一颗图标的 tooltip 是中文」，tsc 看不出来。`Record<Locale, string>`
 * 把八种语言齐变成类型约束。
 *
 * 括号里的字母是阅读页内置单键，**各语言都保留原样**——那是物理键位，不翻译。
 */
const LABELS: Record<HeaderActionId, Record<Locale, string>> = {
  toc: {
    zh: '目录（s）',
    'zh-TW': '目錄（s）',
    en: 'Contents (s)',
    ja: '目次（s）',
    de: 'Inhalt (s)',
    fr: 'Sommaire (s)',
    es: 'Índice (s)',
    pt: 'Sumário (s)',
  },
  search: { zh: '搜索', 'zh-TW': '搜尋', en: 'Search', ja: '検索', de: 'Suche', fr: 'Rechercher', es: 'Buscar', pt: 'Pesquisar' },
  mark: {
    zh: '记书签（b）',
    'zh-TW': '記書籤（b）',
    en: 'Bookmark (b)',
    ja: 'ブックマーク（b）',
    de: 'Lesezeichen (b)',
    fr: 'Signet (b)',
    es: 'Marcador (b)',
    pt: 'Marcador (b)',
  },
  type: {
    zh: '排版（t）',
    'zh-TW': '排版（t）',
    en: 'Typography (t)',
    ja: '組版（t）',
    de: 'Typografie (t)',
    fr: 'Typographie (t)',
    es: 'Tipografía (t)',
    pt: 'Tipografia (t)',
  },
  para: {
    zh: '并排对照',
    'zh-TW': '並排對照',
    en: 'Side by side',
    ja: '並べて表示',
    de: 'Nebeneinander',
    fr: 'Côte à côte',
    es: 'En paralelo',
    pt: 'Lado a lado',
  },
  paraBook: {
    zh: '对照书籍',
    'zh-TW': '對照書籍',
    en: 'Compare book',
    ja: '比較する本',
    de: 'Vergleichsbuch',
    fr: 'Livre de comparaison',
    es: 'Libro de comparación',
    pt: 'Livro de comparação',
  },
  tts: {
    zh: '朗读（r）',
    'zh-TW': '朗讀（r）',
    en: 'Read aloud (r)',
    ja: '読み上げ（r）',
    de: 'Vorlesen (r)',
    fr: 'Lire à voix haute (r)',
    es: 'Leer en voz alta (r)',
    pt: 'Ler em voz alta (r)',
  },
  bookmap: {
    zh: '全书鸟瞰（m）',
    'zh-TW': '全書鳥瞰（m）',
    en: 'Book overview (m)',
    ja: '全体マップ（m）',
    de: 'Buchübersicht (m)',
    fr: 'Vue d’ensemble (m)',
    es: 'Vista general (m)',
    pt: 'Visão geral (m)',
  },
  immersive: {
    zh: '沉浸模式',
    'zh-TW': '沉浸模式',
    en: 'Immersive mode',
    ja: '没入モード',
    de: 'Immersivmodus',
    fr: 'Mode immersif',
    es: 'Modo inmersivo',
    pt: 'Modo imersivo',
  },
  library: {
    zh: '返回书架',
    'zh-TW': '返回書架',
    en: 'Back to shelf',
    ja: '本棚に戻る',
    de: 'Zurück zum Regal',
    fr: 'Retour à la bibliothèque',
    es: 'Volver a la estantería',
    pt: 'Voltar à estante',
  },
};

/** 图标标签 → 当前界面语言的说法 */
export function headerActionLabel(id: HeaderActionId): string {
  return LABELS[id]?.[locale()] ?? LABELS[id]?.zh ?? String(id);
}

/** 全部图标 id（也是默认顺序） */
export const HEADER_ACTION_IDS: HeaderActionId[] = SPEC.map((s) => s.id);

export interface HeaderCfg {
  order: string[];
  hidden: string[];
}

function orderedIds(cfg?: HeaderCfg | null): HeaderActionId[] {
  const wanted = (cfg?.order ?? []).filter((id): id is HeaderActionId =>
    (HEADER_ACTION_IDS as string[]).includes(id),
  );
  const rest = HEADER_ACTION_IDS.filter((id) => !wanted.includes(id));
  return [...wanted, ...rest];
}

/**
 * 外露的图标：用户顺序 → 去掉显式隐藏的 → 移动端最多 3 颗。
 *
 * @param mobile 真实移动端（`isMobileEnv()`，**不是** `isMobileShell()`——
 *   后者含桌面验收用的 force-mobile，会让桌面也折起来）
 */
export function headerActionsFor(mobile: boolean, cfg?: HeaderCfg | null): HeaderActionId[] {
  const hidden = new Set(cfg?.hidden ?? []);
  const list = orderedIds(cfg).filter((id) => !hidden.has(id));
  return mobile ? list.slice(0, 3) : list;
}

/** ⋮ 里的：显式隐藏的 + 移动端被名额挤出去的 */
export function headerOverflowFor(mobile: boolean, cfg?: HeaderCfg | null): HeaderActionId[] {
  const shown = headerActionsFor(mobile, cfg);
  return orderedIds(cfg).filter((id) => !shown.includes(id));
}

/** 不带用户配置时的默认清单（老入口，保留兼容） */
export function headerActionIds(mobile: boolean): HeaderActionId[] {
  return headerActionsFor(mobile, null);
}

export function headerActionSpec(id: HeaderActionId): HeaderActionSpec {
  const spec = SPEC.find((s) => s.id === id) ?? SPEC[0];
  return { id: spec.id, icon: spec.icon, label: headerActionLabel(spec.id) };
}

export interface HeaderActive {
  /** 当前页是否已有一枚书签（决定书签图标亮不亮） */
  mark: boolean;
  /** 并排对照开着 */
  para: boolean;
}

export function headerActive(book: ReaderBook | null, cfi: string, parallelOn: boolean): HeaderActive {
  return {
    mark: !!book && !!cfi && !!bookmarkAt(book, cfi),
    para: parallelOn,
  };
}
