/* ============================================================
 * bz-reader · 功能对照表的八语言行名（i18n/plan.ts）
 *
 * 为什么是集中表而不是八份语言包：这 27 行是**成套**的清单，拆进
 * `<lang>.ts` 之后漏翻一条 tsc 看不出来（key 还在，值抄成中文），
 * 表现就是「德语界面的解锁弹层里孤零零一行中文」。
 * `Record<PlanKey, Record<Locale, string>>` 把「八种齐」变成类型约束。
 *
 * 与 `data/entitlement.ts` 的 `CAP_TEXT` 同一套做法：那边是卖点短句，
 * 这边是对照表行名，别混用——行名要短到能在窄屏表格里一行放下。
 *
 * 中文是基准：`PLAN_TABLE[].name` 直接取 `planNameZh(key)`，
 * 界面渲染取 `planLabel(key)`，两处不会各写一份中文。
 * ============================================================ */
import { locale, type Locale } from './index';

export type PlanKey =
  | 'reading'
  | 'columns'
  | 'marks'
  | 'inbookSearch'
  | 'back'
  | 'footnote'
  | 'classify'
  | 'formats'
  | 'bilink'
  | 'export'
  | 'card'
  /* PDF 段（2026-11-10）：以前只由「更多格式」一句话带过，用户看不出
     买高级版在 PDF 上还多了什么。七行按「怎么读 → 怎么拿出来」排。 */
  | 'pdfView'
  | 'pdfThumbs'
  | 'pdfLink'
  | 'pdfAutoLink'
  | 'pdfAnnots'
  | 'pdfExport'
  | 'pdfZoom'
  | 'stats'
  | 'crossSearch'
  | 'aiSel'
  | 'aiBook'
  | 'vertical'
  | 'tts'
  | 'parallel'
  | 'bookmap'
  | 'kb';

/**
 * 分组 id。和 `PlanKey` 是**两套命名空间**：这里是「段」，那里是「行」。
 * 名字刻意不重合，免得代码里 `PLAN_TABLE[0].key` 与 `PLAN_GROUPS[0].key`
 * 读起来像同一个东西。归属关系在 `data/entitlement.ts` 的 PLAN_GROUPS。
 */
export type PlanGroupKey = 'read' | 'output' | 'pdf' | 'insight' | 'ai' | 'advanced';

const PLAN_TEXT: Record<PlanKey, Record<Locale, string>> = {
  reading: {
    zh: 'EPUB / TXT 阅读与排版',
    'zh-TW': 'EPUB / TXT 閱讀與排版',
    en: 'EPUB / TXT reading and typography',
    ja: 'EPUB / TXT の読書・ページ送り・組版',
    de: 'EPUB / TXT lesen, blättern, Satz einstellen',
    fr: 'Lecture EPUB / TXT, pagination et composition',
    es: 'Lectura EPUB / TXT, paginación y tipografía',
    pt: 'Leitura EPUB / TXT, paginação e tipografia',
  },
  columns: {
    zh: '单栏 / 双栏',
    'zh-TW': '單欄 / 雙欄',
    en: 'One or two columns',
    ja: '1 段 / 2 段組',
    de: 'Eine oder zwei Spalten',
    fr: 'Une ou deux colonnes',
    es: 'Una o dos columnas',
    pt: 'Uma ou duas colunas',
  },
  marks: {
    zh: '目录、书签、四色划线、想法',
    'zh-TW': '目錄、書籤、四色劃線、想法',
    en: 'Contents, bookmarks, four-color highlights, notes',
    ja: '目次・ブックマーク・4 色ハイライトとメモ',
    de: 'Inhalt, Lesezeichen, vier Markierungsfarben und Notizen',
    fr: 'Sommaire, signets, quatre couleurs de surlignage et notes',
    es: 'Índice, marcadores, cuatro colores de subrayado y notas',
    pt: 'Sumário, marcadores, quatro cores de destaque e notas',
  },
  inbookSearch: {
    zh: '书内搜索',
    'zh-TW': '書內搜尋',
    en: 'In-book search',
    ja: '本文内検索',
    de: 'Suche im Buch',
    fr: 'Recherche dans le livre',
    es: 'Búsqueda dentro del libro',
    pt: 'Pesquisa dentro do livro',
  },
  /* 2026-11-10 新增：跳转历史。
     PDF 早就有（点目录 / 链接跳走之前记一手，翻页不算）；EPUB 现在补上同一条。
     两边共用一个动作，所以它能进「阅读与书架」这一段，两栏都打勾。 */
  back: {
    zh: '回到上一处',
    'zh-TW': '回到上一處',
    en: 'Back to previous spot',
    ja: 'Back to previous spot',
    de: 'Back to previous spot',
    fr: 'Back to previous spot',
    es: 'Back to previous spot',
    pt: 'Back to previous spot',
  },
  footnote: {
    zh: '脚注浮窗预览',
    'zh-TW': '腳註浮窗預覽',
    en: 'Footnote preview in a popover',
    ja: '脚注のポップアップ表示',
    de: 'Fußnoten als Pop-up',
    fr: 'Aperçu des notes de bas de page',
    es: 'Vista previa de notas al pie',
    pt: 'Prévia das notas de rodapé',
  },
  /* 2026-11-09 新增：分类管理（免费）。八种语言都已写实（0.4.0 上架版）. */
  classify: {
    zh: '分类管理',
    'zh-TW': '分類管理',
    en: 'Shelf categories',
    ja: 'カテゴリ管理',
    de: 'Regal-Kategorien',
    fr: 'Gestion des catégories',
    es: 'Gestión de categorías',
    pt: 'Gestão de categorias',
  },
  formats: {
    /* 2026-11-09 改：只写**真机实测能打开**的格式。AZW / PRC / FBZ 看着像
       Kindle 家族，但 EXT_TO_FORMAT 里没有它们，写上去就是空头承诺。
       2026-11-10：PDF 从这一行挪进独立的「PDF 阅读」段——这一行只说「还能
       多开哪几种」，PDF 由下一段逐条讲它能做到什么，两处不再各说一半。
       括号在这里是「族 → 枚举」，不是行名解释，允许这一行例外。 */
    zh: 'Kindle 系（MOBI / AZW3）、FB2 与 CBZ 漫画',
    'zh-TW': 'Kindle 系（MOBI / AZW3）、FB2 與 CBZ 漫畫',
    en: 'Kindle family (MOBI / AZW3), FB2, and CBZ comics',
    ja: 'mobi / azw3 / fb2 / コミック',
    de: 'mobi / azw3 / fb2 / Comics',
    fr: 'mobi / azw3 / fb2 / BD',
    es: 'mobi / azw3 / fb2 / cómic',
    pt: 'mobi / azw3 / fb2 / quadrinhos',
  },
  bilink: {
    zh: '划线复制成双向链接',
    'zh-TW': '劃線複製成雙向連結',
    en: 'Copy highlights as wikilinks',
    ja: 'ハイライトを双方向リンクとしてコピー',
    de: 'Markierungen als Wikilink kopieren',
    fr: 'Copier les surlignages en wikiliens',
    es: 'Copiar subrayados como wikienlaces',
    pt: 'Copiar destaques como wikilinks',
  },
  export: {
    zh: '导出结构化 Markdown',
    'zh-TW': '匯出結構化 Markdown',
    en: 'Structured Markdown export',
    ja: '構造化 Markdown への書き出し',
    de: 'Strukturierter Markdown-Export',
    fr: 'Export Markdown structuré',
    es: 'Exportación a Markdown estructurado',
    pt: 'Exportação em Markdown estruturado',
  },
  card: {
    zh: '划线做成书摘图片',
    'zh-TW': '劃線做成書摘圖片',
    en: 'Highlights as quote card images',
    ja: '引用カード画像',
    de: 'Zitatkarten als Bild',
    fr: 'Images de cartes de citation',
    es: 'Imágenes de tarjetas de cita',
    pt: 'Imagens de cartões de citação',
  },
  /* ── PDF 段（2026-11-10） ──
   * 七行按「怎么读 → 怎么拿出来」排：
   *   pdfView    打开之后怎么翻（缩放 / 旋转 / 双页 / 滚动）
   *   pdfThumbs  278 页的书靠缩略图找页
   *   pdfLink    四种链接（页 / 视图 / 嵌入 / 本页标注）+ 显示文字四档
   *   pdfAutoLink 划完字自动把链接放进剪贴板（默认关）
   *   pdfAnnots  笔记引用了这一页 → 画出来；PDF 自带批注 → 点开读
   *   pdfExport  本页存成图片
   *   pdfZoom    下次打开这本书，还是上次的缩放与角度
   * 开发期只写实中文 / 繁体 / 英文，其余五种先放英文占位（见 AGENTS）。 */
  pdfView: {
    zh: '缩放、旋转、单双页与滚动',
    'zh-TW': '縮放、旋轉、單雙頁與捲動',
    en: 'Zoom, rotate, two-up, and scroll',
    ja: 'Zoom, rotate, two-up, and scroll',
    de: 'Zoom, rotate, two-up, and scroll',
    fr: 'Zoom, rotate, two-up, and scroll',
    es: 'Zoom, rotate, two-up, and scroll',
    pt: 'Zoom, rotate, two-up, and scroll',
  },
  pdfThumbs: {
    zh: '页缩略图',
    'zh-TW': '頁縮圖',
    en: 'Page thumbnails',
    ja: 'Page thumbnails',
    de: 'Page thumbnails',
    fr: 'Page thumbnails',
    es: 'Page thumbnails',
    pt: 'Page thumbnails',
  },
  pdfLink: {
    zh: '复制页链接',
    'zh-TW': '複製頁連結',
    en: 'Copy page links',
    ja: 'Copy page links',
    de: 'Copy page links',
    fr: 'Copy page links',
    es: 'Copy page links',
    pt: 'Copy page links',
  },
  pdfAutoLink: {
    zh: '划词自动复制链接',
    'zh-TW': '劃詞自動複製連結',
    en: 'Auto-copy links on selection',
    ja: 'Auto-copy links on selection',
    de: 'Auto-copy links on selection',
    fr: 'Auto-copy links on selection',
    es: 'Auto-copy links on selection',
    pt: 'Auto-copy links on selection',
  },
  pdfAnnots: {
    zh: '笔记反链与文件批注',
    'zh-TW': '筆記反鏈與檔案批註',
    en: 'Note backlinks and file annotations',
    ja: 'Note backlinks and file annotations',
    de: 'Note backlinks and file annotations',
    fr: 'Note backlinks and file annotations',
    es: 'Note backlinks and file annotations',
    pt: 'Note backlinks and file annotations',
  },
  pdfExport: {
    zh: '导出本页为图片',
    'zh-TW': '匯出本頁為圖片',
    en: 'Export a page as an image',
    ja: 'Export a page as an image',
    de: 'Export a page as an image',
    fr: 'Export a page as an image',
    es: 'Export a page as an image',
    pt: 'Export a page as an image',
  },
  pdfZoom: {
    zh: '开书缩放记忆',
    'zh-TW': '開書縮放記憶',
    en: 'Remember zoom per book',
    ja: 'Remember zoom per book',
    de: 'Remember zoom per book',
    fr: 'Remember zoom per book',
    es: 'Remember zoom per book',
    pt: 'Remember zoom per book',
  },
  stats: {
    /* 2026-11-09 改名：统计页早已不只是热力图 + 每本进度，还有 KPI、投入
       趋势、节律、年度目标与每日打卡。行名只留三块最显眼的，其余交给
       页面本身。八种语言都已写实（0.4.0 上架版）。 */
    zh: '阅读统计、打卡与目标',
    'zh-TW': '閱讀統計、打卡與目標',
    en: 'Reading stats, check-ins, and goals',
    ja: '読書統計・チェックイン・目標',
    de: 'Lesestatistik, Check-ins und Ziele',
    fr: 'Statistiques de lecture, pointages et objectifs',
    es: 'Estadísticas de lectura, registro diario y objetivos',
    pt: 'Estatísticas de leitura, check-ins e metas',
  },
  crossSearch: {
    zh: '跨书搜索',
    'zh-TW': '跨書搜尋',
    en: 'Cross-book search',
    ja: '本をまたぐ検索',
    de: 'Suche über alle Bücher',
    fr: 'Recherche dans tous les livres',
    es: 'Búsqueda entre libros',
    pt: 'Pesquisa entre livros',
  },
  aiSel: {
    zh: 'AI 解释、翻译与摘要',
    'zh-TW': 'AI 解釋、翻譯與摘要',
    en: 'Explain, translate, summarize a selection',
    ja: 'AI による解説 / 翻訳 / 要約',
    de: 'KI: Erklärungen / Übersetzung / Zusammenfassungen',
    fr: 'IA : explications / traduction / résumés',
    es: 'IA: explicaciones / traducción / resúmenes',
    pt: 'IA: explicações / tradução / resumos',
  },
  aiBook: {
    zh: 'AI 全书问答',
    'zh-TW': 'AI 全書問答',
    en: 'AI Q&A over the whole book',
    ja: 'AI 全書 Q&A',
    de: 'KI: Fragen zum ganzen Buch',
    fr: 'Questions IA sur tout le livre',
    es: 'Preguntas de IA sobre todo el libro',
    pt: 'Perguntas de IA sobre o livro inteiro',
  },
  vertical: {
    zh: '竖排排版',
    'zh-TW': '豎排排版',
    en: 'Vertical typesetting',
    ja: '縦組み',
    de: 'Vertikaler Satz',
    fr: 'Composition verticale',
    es: 'Composición vertical',
    pt: 'Composição vertical',
  },
  tts: {
    zh: '朗读',
    'zh-TW': '朗讀',
    en: 'Read aloud',
    ja: '読み上げ',
    de: 'Vorlesen',
    fr: 'Lecture vocale',
    es: 'Lectura en voz alta',
    pt: 'Leitura em voz alta',
  },
  parallel: {
    zh: '原文与译文并排',
    'zh-TW': '原文與譯文並排',
    en: 'Original and translation side by side',
    ja: '原文と訳文の並列表示',
    de: 'Original und Übersetzung nebeneinander',
    fr: 'Original et traduction côte à côte',
    es: 'Original y traducción en paralelo',
    pt: 'Original e tradução lado a lado',
  },
  bookmap: {
    zh: '全书鸟瞰',
    'zh-TW': '全書鳥瞰',
    en: 'Book overview',
    ja: '全体マップ',
    de: 'Buchübersicht',
    fr: "Vue d'ensemble du livre",
    es: 'Vista general del libro',
    pt: 'Visão geral do livro',
  },
  /* 2026-11-09 删：书籍本地化向量检索不再单独占一行——它是「AI 全书问答」
     的前置步骤，拆成两行只会让用户以为要买两次。能力本身还在（建索引仍
     走 requireCap('ai')），对照表不再承诺一项独立功能。 */
  kb: {
    zh: '接入 BZ AI 知识库',
    'zh-TW': '接入 BZ AI 知識庫',
    en: 'Connect to the BZ AI knowledge base',
    ja: 'BZ AI ナレッジベースに接続',
    de: 'Verbindung zur BZ-KI-Wissensdatenbank',
    fr: 'Connexion à la base de connaissances BZ AI',
    es: 'Conexión con la base de conocimiento BZ AI',
    pt: 'Conexão com a base de conhecimento BZ AI',
  },
};

/** 对照表行名 → 当前界面语言的说法 */
export function planLabel(key: PlanKey): string {
  return PLAN_TEXT[key]?.[locale()] ?? PLAN_TEXT[key]?.zh ?? String(key);
}

/** 中文基准名。`PLAN_TABLE[].name` 与测试共用，避免两份中文不同步 */
export function planNameZh(key: PlanKey): string {
  return PLAN_TEXT[key].zh;
}

/* ─────────── 分组标题（2026-11-09 新增） ───────────
 * 27 行一长串看不出结构，弹窗里按「阅读与书架 / 格式与导出 / PDF 阅读 /
 * 统计与检索 / AI / 进阶」分六段。组名同样是界面文案，走同一套八语言约束，
 * 别写回 `data/entitlement.ts`——那里多一句中文就撞硬编码门禁。
 *
 * 开发期规则：只写实中文 / 繁体 / 英文，其余五种先放英文占位顶住类型，
 * 上架前统一换正式翻译。 */
const PLAN_GROUP_TEXT: Record<PlanGroupKey, Record<Locale, string>> = {
  read: {
    zh: '阅读与书架',
    'zh-TW': '閱讀與書架',
    en: 'Reading & Shelf',
    ja: '読書と本棚',
    de: 'Lesen & Regal',
    fr: 'Lecture & bibliothèque',
    es: 'Lectura y estantería',
    pt: 'Leitura e estante',
  },
  output: {
    zh: '格式与导出',
    'zh-TW': '格式與匯出',
    en: 'Formats & Export',
    ja: '形式と書き出し',
    de: 'Formate & Export',
    fr: 'Formats & export',
    es: 'Formatos y exportación',
    pt: 'Formatos e exportação',
  },
  /* 2026-11-10 新增。**不能只写「PDF」**：上一段「更多格式」行名里原来就带
     PDF 两个字，组名与它撞字时，表格按文字定位会把组标题认成那一行的一部分
     （自检直接红，真机上高亮也会跳段）。「更多格式」那行已同步去掉 PDF，
     这里仍加「阅读」两个字，读起来也更像一段而不是一个图标名。 */
  pdf: {
    zh: 'PDF 阅读',
    'zh-TW': 'PDF 閱讀',
    en: 'PDF Reading',
    ja: 'PDF Reading',
    de: 'PDF Reading',
    fr: 'PDF Reading',
    es: 'PDF Reading',
    pt: 'PDF Reading',
  },
  insight: {
    zh: '统计与检索',
    'zh-TW': '統計與搜尋',
    en: 'Stats & Search',
    ja: '統計と検索',
    de: 'Statistik & Suche',
    fr: 'Statistiques & recherche',
    es: 'Estadísticas y búsqueda',
    pt: 'Estatísticas e busca',
  },
  ai: {
    zh: 'AI',
    'zh-TW': 'AI',
    en: 'AI',
    ja: 'AI',
    de: 'AI',
    fr: 'IA',
    es: 'IA',
    pt: 'IA',
  },
  advanced: {
    zh: '进阶',
    'zh-TW': '進階',
    en: 'Advanced',
    ja: '上級',
    de: 'Fortgeschritten',
    fr: 'Avancé',
    es: 'Avanzado',
    pt: 'Avançado',
  },
};

/** 分组标题 → 当前界面语言的说法 */
export function planGroupLabel(key: PlanGroupKey): string {
  return PLAN_GROUP_TEXT[key]?.[locale()] ?? PLAN_GROUP_TEXT[key]?.zh ?? String(key);
}

/** 中文基准组名，测试与自检用 */
export function planGroupNameZh(key: PlanGroupKey): string {
  return PLAN_GROUP_TEXT[key].zh;
}

/** 测试与自检用：分组标题八种语言是否都填了 */
export const PLAN_GROUP_TEXT_PACK = PLAN_GROUP_TEXT;

/** 测试与自检用：八种语言是否都填了 */
export const PLAN_TEXT_PACK = PLAN_TEXT;
