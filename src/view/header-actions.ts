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
import { locale, t, type Locale, type MsgKey } from '../i18n';
import { bookmarkAt } from '../data/notes';
import type { ReaderBook } from '../data/schema';

export type HeaderActionId =
  | 'toc'
  | 'search'
  | 'mark'
  | 'type'
  | 'thumb'
  | 'copy'
  | 'history'
  | 'export'
  | 'para'
  | 'paraBook'
  | 'tts'
  | 'bookmap'
  | 'guide'
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
const SPEC: ReadonlyArray<{ id: HeaderActionId; icon: string; labelKey?: MsgKey }> = [
  { id: 'toc', icon: 'list' },
  { id: 'search', icon: 'search' },
  { id: 'mark', icon: 'bookmark' },
  { id: 'type', icon: 'type' },
  /* thumb / copy / export 三颗只在 PDF 里出现（见 PDF_ONLY_ACTIONS）。
     history 夹在它们中间是为了 PDF 那一排的连贯性，但它本身对 EPUB 也成立
     （2026-11-10 起 EPUB 也有跳转历史）。顺序也照顾到手机：前 3 颗是
     目录 / 搜索 / 书签，其余进 ⋮，与「放不下就折起来」一致。 */
  { id: 'thumb', icon: 'layout-grid' },
  { id: 'copy', icon: 'copy' },
  { id: 'history', icon: 'undo-2' },
  { id: 'export', icon: 'download' },
  { id: 'para', icon: 'columns-2' },
  { id: 'paraBook', icon: 'book' },
  { id: 'tts', icon: 'volume-2' },
  { id: 'bookmap', icon: 'map' },
  /* 本章导读（2026-11-11）：与「全书鸟瞰」相邻，都是「先看个大概再读」。
     标签复用语言包里已有的 guide.title（八包齐全），不另抄一份。 */
  { id: 'guide', icon: 'book-open', labelKey: 'guide.title' },
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
const LABELS: Partial<Record<HeaderActionId, Record<Locale, string>>> = {
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
  thumb: {
    zh: '页缩略图',
    'zh-TW': '頁縮圖',
    en: 'Page thumbnails',
    ja: 'ページサムネイル',
    de: 'Seitenvorschau',
    fr: 'Vignettes des pages',
    es: 'Miniaturas de páginas',
    pt: 'Miniaturas das páginas',
  },
  copy: {
    zh: '复制链接（页 / 视图 / 嵌入 / 标注）',
    'zh-TW': '複製連結（頁 / 檢視 / 嵌入 / 標註）',
    en: 'Copy link (page / view / embed / marks)',
    ja: 'リンクをコピー（ページ / 表示 / 埋め込み / 注釈）',
    de: 'Link kopieren (Seite / Ansicht / Einbetten / Markierungen)',
    fr: 'Copier le lien (page / vue / intégration / annotations)',
    es: 'Copiar enlace (página / vista / incrustar / anotaciones)',
    pt: 'Copiar link (página / visualização / incorporar / anotações)',
  },
  history: {
    zh: '回到上一处',
    'zh-TW': '回到上一處',
    en: 'Back to previous spot',
    ja: '前の位置に戻る',
    de: 'Zurück zur letzten Stelle',
    fr: 'Revenir au point précédent',
    es: 'Volver al punto anterior',
    pt: 'Voltar ao ponto anterior',
  },
  export: {
    zh: '导出本页为图片',
    'zh-TW': '匯出本頁為圖片',
    en: 'Export page as image',
    ja: 'このページを画像で書き出す',
    de: 'Seite als Bild exportieren',
    fr: 'Exporter la page en image',
    es: 'Exportar la página como imagen',
    pt: 'Exportar a página como imagem',
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
  /* 有 labelKey 的（目前只有「本章导读」）直接读八语言包：
     `guide.title` 本来就是这句话，再在 LABELS 里抄一份只会两处走散。 */
  const spec = SPEC.find((s) => s.id === id);
  if (spec?.labelKey) return t(spec.labelKey);
  return LABELS[id]?.[locale()] ?? LABELS[id]?.zh ?? String(id);
}

/** 全部图标 id（也是默认顺序） */
export const HEADER_ACTION_IDS: HeaderActionId[] = SPEC.map((s) => s.id);

/**
 * 只对 PDF 有意义的图标。
 *
 * 单个功能包只有一份产物，所以这里不做「构建时裁掉」，而是**运行时按书过滤**：
 * 引擎不是 PDF 时这三颗一律不露（也不进 ⋮），用户配的顺序照样保留在偏好里，
 * 换回 PDF 时原位复现。
 *
 * 「回到上一处」2026-11-10 从这里移走了：EPUB 也补上了同一条跳转历史，
 * 两边共用一颗按钮。
 */
export const PDF_ONLY_ACTIONS: readonly HeaderActionId[] = ['thumb', 'copy', 'export'];

export function isPdfAction(id: HeaderActionId): boolean {
  return PDF_ONLY_ACTIONS.includes(id);
}

/**
 * 手机上不提供的动作（2026-11-11）。
 *
 * 和 PDF 那三颗同一个道理：只有一个包，所以不做构建裁剪，运行时按设备收起。
 *   · 并排对照 —— 屏幕一分为二，每边不到 200px，副卷还没有划词工具条；
 *   · 对照书籍 —— 只服务并排，并排没了它没有去处；
 *   · 朗读 —— 手机浏览器内核没有稳定的语音合成通道。
 *
 * 收在入口层而不是删功能：桌面端一颗不少，排序偏好里留着它们的位置，
 * 换回电脑原位复现。
 */
export const MOBILE_HIDDEN_ACTIONS: readonly HeaderActionId[] = ['para', 'paraBook', 'tts'];

export function isMobileHiddenAction(id: HeaderActionId): boolean {
  return MOBILE_HIDDEN_ACTIONS.includes(id);
}

/**
 * 这台设备上能用的动作（默认顺序）。
 *
 * 头栏、⋮ 菜单、设置页的图标列表都读它：三处各判一次的话，漏一处就是
 * 「头栏藏了、⋮ 里还在」——而手机上 ⋮ 才是主入口。
 */
export function availableActions(mobile: boolean, pdf = false): HeaderActionId[] {
  return HEADER_ACTION_IDS.filter(
    (id) => (pdf || !isPdfAction(id)) && !(mobile && isMobileHiddenAction(id)),
  );
}

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
 * 两个「手机」参数分工不同，别合并：
 *   @param mobile  **露几颗**只看真实设备（`isMobileEnv()`）。桌面窗口放得下
 *     12 颗，开了 force-mobile 验收也不该收成 3 颗——用户原话是「能放得下
 *     就别用下拉」。
 *   @param phoneForm  **有哪些动作**看手机形态（`isMobileShell()`）。桌面
 *     按手机形态验收时，本该和真机看到同一套入口，否则「隐藏生没生效」
 *     只能拿手机试。缺省跟 mobile 走（老调用点行为不变）。
 */
export function headerActionsFor(
  mobile: boolean,
  cfg?: HeaderCfg | null,
  pdf = false,
  phoneForm = mobile,
): HeaderActionId[] {
  const hidden = new Set(cfg?.hidden ?? []);
  const allowed = new Set(availableActions(phoneForm, pdf));
  const list = orderedIds(cfg).filter((id) => allowed.has(id) && !hidden.has(id));
  return mobile ? list.slice(0, 3) : list;
}

/** ⋮ 里的：显式隐藏的 + 移动端被名额挤出去的（不含这台设备不提供的） */
export function headerOverflowFor(
  mobile: boolean,
  cfg?: HeaderCfg | null,
  pdf = false,
  phoneForm = mobile,
): HeaderActionId[] {
  const shown = headerActionsFor(mobile, cfg, pdf, phoneForm);
  const allowed = new Set(availableActions(phoneForm, pdf));
  return orderedIds(cfg).filter((id) => allowed.has(id) && !shown.includes(id));
}

/** 不带用户配置时的默认清单（老入口，保留兼容） */
export function headerActionIds(mobile: boolean, pdf = false): HeaderActionId[] {
  return headerActionsFor(mobile, null, pdf);
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
