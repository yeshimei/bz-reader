/* ============================================================
 * bz-reader · 功能对照表的八语言行名（i18n/plan.ts）
 *
 * 为什么是集中表而不是八份语言包：这些行是**成套**的清单，拆进
 * `<lang>.ts` 之后漏翻一条 tsc 看不出来（key 还在，值抄成中文），
 * 表现就是「德语界面的解锁弹层里孤零零一行中文」。
 * `Record<PlanKey, Record<Locale, string>>` 把「八种齐」变成类型约束。
 *
 * 与 `data/entitlement.ts` 的 `CAP_TEXT` 同一套做法：那边是卖点短句，
 * 这边是对照表行名，别混用——行名要短到能在窄屏表格里一行放下。
 *
 * 中文是基准：`PLAN_TABLE[].name` 直接取 `planNameZh(key)`，
 * 界面渲染取 `planLabel(key)`，两处不会各写一份中文。
 *
 * 1.0.0 上架版（2026-11-10）：新增「引用页签」（定稿归入高级版，排在
 * 双向链接下面、与它共用一道门禁），把一批行名改成与界面相同的说法，
 * 并把开发期留下的英文占位全部换成正式翻译。
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
  | 'cites'
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
    ja: '前の位置に戻る',
    de: 'Zur vorherigen Stelle zurück',
    fr: 'Revenir à la position précédente',
    es: 'Volver a la posición anterior',
    pt: 'Voltar à posição anterior',
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
  /* 2026-11-09 新增：分类管理（免费）。 */
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
  /* 2026-11-10 新增：引用页签。EPUB 与 PDF 的笔记反链都收在这里，且免费，
     所以两栏都打勾。行名不用括号——对照表有「短名」门禁，说明放在冒号后。 */
  cites: {
    zh: '引用页签：看哪些笔记引了这本书',
    'zh-TW': '引用頁籤：看哪些筆記引用了本書',
    en: 'Citations tab: see which notes cite this book',
    ja: '引用タブ：この本を引用したノート',
    de: 'Zitate-Tab: welche Notizen dieses Buch zitieren',
    fr: 'Onglet Citations : quelles notes citent ce livre',
    es: 'Pestaña Citas: qué notas citan este libro',
    pt: 'Aba Citações: quais notas citam este livro',
  },
  formats: {
    /* 只写**真机实测能打开**的格式。AZW / PRC / FBZ 看着像 Kindle 家族，
       但 EXT_TO_FORMAT 里没有它们，写上去就是空头承诺。
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
    zh: '划线复制为双向链接',
    'zh-TW': '劃線複製為雙向連結',
    en: 'Copy highlights as wikilinks',
    ja: 'ハイライトを双方向リンクとしてコピー',
    de: 'Markierungen als Wikilink kopieren',
    fr: 'Copier les surlignages en wikiliens',
    es: 'Copiar subrayados como wikienlaces',
    pt: 'Copiar destaques como wikilinks',
  },
  export: {
    zh: '导出整本摘录为 Markdown，每条带双链',
    'zh-TW': '匯出整本摘錄為 Markdown，每條帶雙鏈',
    en: 'Export every excerpt as Markdown, each with a wikilink',
    ja: '全ての抜粋を Markdown に書き出し、各項目に双方向リンク',
    de: 'Alle Exzerpte als Markdown exportieren, jeweils mit Wikilink',
    fr: 'Exporter tous les extraits en Markdown, chacun avec un wikilien',
    es: 'Exportar todos los extractos a Markdown, cada uno con un wikienlace',
    pt: 'Exportar todos os excertos em Markdown, cada um com um wikilink',
  },
  card: {
    /* 1.0.0 定稿：书摘图片下放基础版，两栏都打勾，图片一律带 bz reader
       徽章。行名保持不动（有测试钉住），别在名字里塞括号。 */
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
   *   pdfView    打开 PDF 本身 + 怎么翻（缩放 / 旋转 / 双页 / 滚动）
   *   pdfThumbs  278 页的书靠缩略图找页
   *   pdfLink    四种链接（页 / 视图 / 嵌入 / 本页标注）+ 显示文字四档
   *   pdfAutoLink 划完字自动把链接放进剪贴板（默认关）
   *   pdfAnnots  笔记引用了这一页 → 画出来；PDF 自带批注 → 点开读
   *   pdfExport  本页存成图片
   *   pdfZoom    下次打开这本书，还是上次的缩放与角度
   * 1.0.0 上架版已把开发期留下的五种英文占位换成正式翻译。 */
  pdfView: {
    zh: '打开 PDF：缩放、旋转、单双页与滚动',
    'zh-TW': '開啟 PDF：縮放、旋轉、單雙頁與捲動',
    en: 'Open PDFs: zoom, rotate, one- or two-page, and scroll',
    ja: 'PDF を開く：ズーム・回転・見開き・スクロール',
    de: 'PDF öffnen: zoomen, drehen, Einzelseite / Doppelseite, Scrollen',
    fr: 'Ouvrir un PDF : zoom, rotation, page simple / double et défilement',
    es: 'Abrir PDF: zoom, rotación, una o dos páginas y desplazamiento',
    pt: 'Abrir PDF: zoom, rotação, uma ou duas páginas e rolagem',
  },
  pdfThumbs: {
    zh: '页缩略图',
    'zh-TW': '頁縮圖',
    en: 'Page thumbnails',
    ja: 'ページのサムネイル',
    de: 'Seitenminiaturen',
    fr: 'Miniatures des pages',
    es: 'Miniaturas de páginas',
    pt: 'Miniaturas das páginas',
  },
  pdfLink: {
    zh: '复制页链接：页码 / 视图 / 嵌入 / 批注',
    'zh-TW': '複製頁連結：頁碼 / 檢視 / 嵌入 / 批註',
    en: 'Copy page links: page / view / embed / annotation',
    ja: 'ページリンクをコピー：ページ / ビュー / 埋め込み / 注釈',
    de: 'Seitenlinks kopieren: Seite / Ansicht / Einbettung / Anmerkung',
    fr: 'Copier les liens de page : page / vue / intégration / annotation',
    es: 'Copiar enlaces de página: página / vista / incrustación / anotación',
    pt: 'Copiar links de página: página / vista / incorporação / anotação',
  },
  pdfAutoLink: {
    zh: '划词自动复制页链接',
    'zh-TW': '劃詞自動複製頁連結',
    en: 'Auto-copy page links on selection',
    ja: '選択時にページリンクを自動コピー',
    de: 'Seitenlinks bei Auswahl automatisch kopieren',
    fr: 'Copier automatiquement le lien de page à la sélection',
    es: 'Copiar automáticamente el enlace de página al seleccionar',
    pt: 'Copiar automaticamente o link da página ao selecionar',
  },
  pdfAnnots: {
    zh: '本页反链与文件自带批注',
    'zh-TW': '本頁反鏈與檔案自帶批註',
    en: 'Backlinks on this page and annotations in the file',
    ja: 'このページへの被リンクとファイル内の注釈',
    de: 'Backlinks auf dieser Seite und Anmerkungen in der Datei',
    fr: 'Rétroliens sur cette page et annotations du fichier',
    es: 'Retroenlaces de esta página y anotaciones del archivo',
    pt: 'Retrolinks desta página e anotações do arquivo',
  },
  pdfExport: {
    zh: '导出本页为图片',
    'zh-TW': '匯出本頁為圖片',
    en: 'Export a page as an image',
    ja: 'このページを画像として書き出す',
    de: 'Seite als Bild exportieren',
    fr: 'Exporter une page en image',
    es: 'Exportar una página como imagen',
    pt: 'Exportar uma página como imagem',
  },
  pdfZoom: {
    zh: '记住每本书的缩放',
    'zh-TW': '記住每本書的縮放',
    en: 'Remember zoom per book',
    ja: '本ごとにズームを記憶',
    de: 'Zoom pro Buch merken',
    fr: 'Mémoriser le zoom par livre',
    es: 'Recordar el zoom de cada libro',
    pt: 'Lembrar o zoom de cada livro',
  },
  stats: {
    /* 统计页早已不只是热力图 + 每本进度，还有 KPI、投入趋势、节律、
       年度目标与每日打卡。行名只留三块最显眼的，其余交给页面本身。 */
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
    /* 1.0.0：界面里这一档叫「全库」，表里原来写「跨书搜索」，两边对齐。 */
    zh: '全库搜索',
    'zh-TW': '全庫搜尋',
    en: 'Search the whole library',
    ja: 'ライブラリ全体を検索',
    de: 'Die ganze Bibliothek durchsuchen',
    fr: 'Rechercher dans toute la bibliothèque',
    es: 'Buscar en toda la biblioteca',
    pt: 'Pesquisar em toda a biblioteca',
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
    /* 1.0.0：PDF 这版也能朗读，行名把三种格式说全。 */
    zh: '朗读 EPUB、TXT 与 PDF',
    'zh-TW': '朗讀 EPUB、TXT 與 PDF',
    en: 'Read EPUB, TXT and PDF aloud',
    ja: 'EPUB・TXT・PDF の読み上げ',
    de: 'EPUB, TXT und PDF vorlesen',
    fr: 'Lecture vocale EPUB, TXT et PDF',
    es: 'Lectura en voz alta de EPUB, TXT y PDF',
    pt: 'Leitura em voz alta de EPUB, TXT e PDF',
  },
  parallel: {
    /* 1.0.0：并排的是任意两本书、段落同步，不是「原文 + 译文」。 */
    zh: '与另一本书并排对照',
    'zh-TW': '與另一本書並排對照',
    en: 'Read two books side by side',
    ja: '別の本と並べて対照',
    de: 'Zwei Bücher nebeneinander lesen',
    fr: 'Lire deux livres côte à côte',
    es: 'Leer dos libros en paralelo',
    pt: 'Ler dois livros lado a lado',
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
  /* 向量检索不再单独占一行——它是「AI 全书问答」的前置步骤，拆成两行只会
     让用户以为要买两次。1.0.0 在行名里点明「需另装 bz」，免得看着像
     一项能单独买的功能。 */
  kb: {
    zh: '连接 BZ AI 知识库，需另装 bz',
    'zh-TW': '連接 BZ AI 知識庫，需另裝 bz',
    en: 'Connect to the BZ AI knowledge base; requires bz',
    ja: 'BZ AI ナレッジベースに接続、bz が必要',
    de: 'Mit der BZ-KI-Wissensdatenbank verbinden; bz erforderlich',
    fr: 'Se connecter à la base BZ AI ; nécessite bz',
    es: 'Conectar con la base de conocimiento BZ AI; requiere bz',
    pt: 'Conectar à base de conhecimento BZ AI; requer bz',
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
 * 一长串看不出结构，弹窗里按「阅读与书架 / 格式与导出 / PDF 阅读 /
 * 统计与检索 / AI / 进阶」分六段。组名同样是界面文案，走同一套八语言约束，
 * 别写回 `data/entitlement.ts`——那里有硬编码中文门禁。
 * 1.0.0 上架版已把开发期留下的英文占位换成正式翻译。 */
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
  /* **不能只写「PDF」**：上一段「更多格式」行名里原来就带 PDF 两个字，
     组名与它撞字时，表格按文字定位会把组标题认成那一行的一部分
     （自检直接红，真机上高亮也会跳段）。「更多格式」那行已同步去掉 PDF。 */
  pdf: {
    zh: 'PDF 阅读',
    'zh-TW': 'PDF 閱讀',
    en: 'PDF Reading',
    ja: 'PDF を読む',
    de: 'PDF lesen',
    fr: 'Lecture PDF',
    es: 'Lectura de PDF',
    pt: 'Leitura de PDF',
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
