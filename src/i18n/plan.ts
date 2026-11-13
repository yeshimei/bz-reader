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
  /* PDF 段（2026-11-10 新增，1.0.0 定稿压成五行）：以前只由「更多格式」
     一句话带过，用户看不出买高级版在 PDF 上还多了什么。 */
  | 'pdfView'
  | 'pdfThumbs'
  | 'pdfLink'
  | 'pdfAnnots'
  | 'pdfExport'
  | 'stats'
  | 'poster'
  | 'crossSearch'
  | 'semantic'
  | 'aiSel'
  | 'aiBook'
  | 'aiChat'
  | 'vertical'
  | 'tts'
  | 'parallel'
  | 'bookmap'
  | 'kb'
  /* 探索中（2026-11-11，2026-11-12 增至八项）：都还没实现，先占表尾八行；
     行内不标状态，靠段名说。 */
  | 'pdfOcr'
  | 'pdfReflow'
  | 'manga'
  | 'transChapter'
  | 'review'
  | 'eink'
  | 'motion'
  | 'clipEpub';

/**
 * 分组 id。和 `PlanKey` 是**两套命名空间**：这里是「段」，那里是「行」。
 * 名字刻意不重合，免得代码里 `PLAN_TABLE[0].key` 与 `PLAN_GROUPS[0].key`
 * 读起来像同一个东西。归属关系在 `data/entitlement.ts` 的 PLAN_GROUPS。
 */
export type PlanGroupKey = 'read' | 'output' | 'pdf' | 'insight' | 'ai' | 'advanced' | 'explore';

const PLAN_TEXT: Record<PlanKey, Record<Locale, string>> = {
  reading: {
    /* 1.0.0 定稿：单栏/双栏、竖排各有自己的行，行名不再写「与排版」，
       只说「打开即读」——去掉与另外两行的重复。 */
    zh: 'EPUB / TXT 打开即读',
    'zh-TW': 'EPUB / TXT 開啟即讀',
    en: 'EPUB / TXT, open and read',
    ja: 'EPUB / TXT をすぐ読める',
    de: 'EPUB / TXT sofort lesbar',
    fr: 'EPUB / TXT prêts à lire',
    es: 'EPUB / TXT listos para leer',
    pt: 'EPUB / TXT prontos para ler',
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
    zh: '回到上一处：跳走之后一键回来',
    'zh-TW': '回到上一處：跳走之後一鍵回來',
    en: 'Back to your previous spot: one tap after any jump',
    ja: '前の位置に戻る：移動したあとワンタップで戻れる',
    de: 'Zur vorherigen Stelle zurück – nach jedem Sprung ein Klick',
    fr: 'Revenir à votre position précédente : un clic après un saut',
    es: 'Volver a la posición anterior: un toque tras cualquier salto',
    pt: 'Voltar à posição anterior: um toque depois de qualquer salto',
  },
  footnote: {
    zh: '脚注浮窗：小注不用离页',
    'zh-TW': '腳註浮窗：小註不用離頁',
    en: 'Footnotes in a popover: no need to leave the page',
    ja: '脚注ポップアップ：ページを離れずに読める',
    de: 'Fußnoten im Pop-up – ohne die Seite zu verlassen',
    fr: 'Notes de bas de page en bulle : sans quitter la page',
    es: 'Notas al pie en ventana: sin salir de la página',
    pt: 'Notas de rodapé em pop-up: sem sair da página',
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
  /* 1.0.0 定稿：引用页签归高级版（与双向链接共用一道门禁），所以这条注释
     也改回「两栏不都打勾」——上一版这里写着「免费」，和表里的 no/yes 打架。 */
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
    /* 只写**真机实测能打开**的格式。AZW（不带 3）/ PRC / FBZ 看着像 Kindle
       家族，但 EXT_TO_FORMAT 里没有它们，写上去就是空头承诺。
       1.0.0 定稿：这一行把高级版能多开的格式按「族名（枚举）」写全。
       括号在这里是「族 → 枚举」，不是行名解释，允许这一行例外。
       2026-11-10 用户改口径：PDF 也写进来——格式是卖点，一行里要能看全。
       下面「PDF 阅读」段讲的是打开以后能做什么（缩放/缩略图/页链接/导出），
       跟「能不能打开」不是同一件事，两处都出现不冲突。 */
    zh: 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫画、PDF',
    'zh-TW': 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫畫、PDF',
    en: 'Kindle family (MOBI / AZW3), FB2, CBZ comics, PDF',
    ja: 'Kindle 系（MOBI / AZW3）、FB2、CBZ コミック、PDF',
    de: 'Kindle-Familie (MOBI / AZW3), FB2, CBZ-Comics, PDF',
    fr: 'Famille Kindle (MOBI / AZW3), FB2, BD en CBZ, PDF',
    es: 'Familia Kindle (MOBI / AZW3), FB2, cómics en CBZ, PDF',
    pt: 'Família Kindle (MOBI / AZW3), FB2, quadrinhos em CBZ, PDF',
  },
  bilink: {
    /* 1.0.0 定稿：行名把「点得回来」这层意思说出来——只写「复制为双链」
       时，用户不知道笔记里的链接能跳回原文那句。 */
    zh: '划线存成双链：笔记里点回原文',
    'zh-TW': '劃線存成雙鏈：筆記裡點回原文',
    en: 'Highlights as wikilinks: click back from your notes',
    ja: 'ハイライトを双方向リンクに：ノートから原文へ',
    de: 'Markierungen als Wikilinks: aus der Notiz zur Stelle',
    fr: 'Surlignages en wikiliens : revenir au texte depuis la note',
    es: 'Subrayados como wikienlaces: volver al texto desde la nota',
    pt: 'Destaques como wikilinks: voltar ao texto pela nota',
  },
  export: {
    zh: '导出整本摘录：每条带双链',
    'zh-TW': '匯出整本摘錄：每條帶雙鏈',
    en: 'Export every excerpt, each with a wikilink',
    ja: '抜粋をまとめて書き出し、各項目に双方向リンク',
    de: 'Alle Exzerpte exportieren, jeweils mit Wikilink',
    fr: 'Exporter tous les extraits, chacun avec un wikilien',
    es: 'Exportar todos los extractos, cada uno con un wikienlace',
    pt: 'Exportar todos os excertos, cada um com um wikilink',
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
  /* ── PDF 段（2026-11-10，1.0.0 定稿压成五行） ──
   * 七行里「记住每本书的缩放」并进「PDF 阅读」、「划词自动复制」并进
   * 「复制页链接」——七行全打叉再全打勾，读起来像凑数，信息量也就是这五类。
   * 顺序仍是「怎么读 → 怎么拿出来」：
   *   pdfView    读：缩放 / 旋转 / 双页 / 滚动，每本记住视角
   *   pdfThumbs  找页：278 页的书靠缩略图
   *   pdfLink    拿出来：四种链接 + 划词自动复制
   *   pdfAnnots  看见：笔记引了这页 → 画出来；文件自带批注 → 点开读
   *   pdfExport  存下来：本页存成图片
   * 「能不能打开 PDF」由上一段 formats 那一行说，这里只讲能做到什么。 */
  pdfView: {
    zh: '打开 PDF：缩放、旋转、单双页、滚动，每本记住视角',
    'zh-TW': '開啟 PDF：縮放、旋轉、單雙頁、捲動，每本記住視角',
    en: 'Open a PDF: zoom, rotate, one or two pages, scroll; view remembered per book',
    ja: 'PDF を開く：ズーム・回転・見開き・スクロール、本ごとに表示を記憶',
    de: 'PDF öffnen: zoomen, drehen, Einzel- / Doppelseite, Scrollen; Ansicht pro Buch',
    fr: 'Ouvrir un PDF : zoom, rotation, page simple ou double, défilement ; vue mémorisée par livre',
    es: 'Abrir un PDF: zoom, rotación, una o dos páginas, desplazamiento; vista por libro',
    pt: 'Abrir um PDF: zoom, rotação, uma ou duas páginas, rolagem; vista por livro',
  },
  pdfThumbs: {
    zh: '页缩略图：几百页也能一屏找',
    'zh-TW': '頁縮圖：幾百頁也能一屏找',
    en: 'Page thumbnails: find a page in a long book',
    ja: 'ページサムネイル：長い本でも一画面で探せる',
    de: 'Seitenminiaturen: auch in langen Büchern schnell finden',
    fr: 'Miniatures : retrouver une page dans un long livre',
    es: 'Miniaturas: encontrar una página en un libro largo',
    pt: 'Miniaturas: achar uma página num livro longo',
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
  stats: {
    /* 1.0.0 定稿：原来写「阅读统计、打卡与目标」，把整块压成了两件小事。
       实际是完整数据面板——概览、对比、投入趋势、节律、140 天热力、
       年度目标、书籍明细、口径对照。行名取四块最显眼的，其余交给页面。 */
    zh: '数据面板：时长、趋势、节律、书籍明细',
    'zh-TW': '資料面板：時長、趨勢、節律、書籍明細',
    en: 'Stats panel: time, trends, rhythm, per-book detail',
    ja: 'データパネル：時間・推移・リズム・書籍別の内訳',
    de: 'Statistikpanel: Zeit, Verlauf, Rhythmus, Details je Buch',
    fr: 'Panneau de stats : temps, tendances, rythme, détail par livre',
    es: 'Panel de datos: tiempo, tendencias, ritmo, detalle por libro',
    pt: 'Painel de dados: tempo, tendências, ritmo, detalhe por livro',
  },
  /* 2026-11-10 新增：阅读海报。这个能力位一直有拦点、统计页也有入口，
     表里却没有行——用户买到了什么，看表看不出来。 */
  poster: {
    zh: '阅读海报：年度总结与数据长图',
    'zh-TW': '閱讀海報：年度總結與資料長圖',
    en: 'Reading poster: yearly recap and stats long image',
    ja: '読書ポスター：年間まとめとデータ長画像',
    de: 'Leseposter: Jahresrückblick und Daten-Langbild',
    fr: 'Affiche de lecture : bilan annuel et image longue',
    es: 'Póster de lectura: resumen anual e imagen larga',
    pt: 'Pôster de leitura: resumo anual e imagem longa',
  },
  crossSearch: {
    /* 1.0.0：界面里这一档叫「全库」，表里原来写「跨书搜索」，两边对齐。
       这版 PDF 正文也进索引，行名把这件事说出来。 */
    zh: '全库搜索：PDF 正文也搜得到',
    'zh-TW': '全庫搜尋：PDF 正文也搜得到',
    en: 'Whole-library search, PDF text included',
    ja: 'ライブラリ全体を検索：PDF 本文も対象',
    de: 'Bibliothek durchsuchen, PDF-Text inklusive',
    fr: 'Recherche dans toute la bibliothèque, texte des PDF inclus',
    es: 'Búsqueda en toda la biblioteca, texto de PDF incluido',
    pt: 'Pesquisa em toda a biblioteca, texto de PDF incluído',
  },
  /* 语义搜索（2026-11-11）：本书与全库都能按意思找。 */
  semantic: {
    zh: '语义搜索：本书与全库，按意思找',
    'zh-TW': '語意搜尋：本書與全庫，按意思找',
    en: 'Semantic search: this book or the whole shelf',
    ja: 'セマンティック検索：本書・本棚',
    de: 'Semantische Suche: Buch oder Regal',
    fr: 'Recherche sémantique : ce livre ou le rayon',
    es: 'Búsqueda semántica: este libro o el estante',
    pt: 'Busca semântica: este livro ou a estante',
  },
  aiSel: {
    zh: 'AI 解释、翻译与摘要：划词即用',
    'zh-TW': 'AI 解釋、翻譯與摘要：劃詞即用',
    en: 'Explain, translate, summarize a selection',
    ja: 'AI 解説・翻訳・要約：選択するだけ',
    de: 'KI: erklären, übersetzen, zusammenfassen — direkt zur Auswahl',
    fr: 'IA : expliquer, traduire, résumer une sélection',
    es: 'IA: explicar, traducir, resumir una selección',
    pt: 'IA: explicar, traduzir, resumir uma seleção',
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
  /* AI 伴读（2026-11-11）：追问、导读、补全、对话存档共用一道门禁。 */
  aiChat: {
    zh: 'AI 伴读：边读边问，按章导读',
    'zh-TW': 'AI 伴讀：邊讀邊問，按章導讀',
    en: 'AI companion: ask as you read, per-chapter guide',
    ja: 'AI 伴読：読みながら質問、章ごとのガイド',
    de: 'KI-Begleiter: beim Lesen fragen, Kapitelführer',
    fr: 'Compagnon IA : demandez en lisant, guide par chapitre',
    es: 'Compañero IA: pregunta mientras lees, guía por capítulo',
    pt: 'Companheiro IA: pergunte enquanto lê, guia por capítulo',
  },
  vertical: {
    /* 竖排只在 EPUB / TXT 生效：PDF 的排版来自文件本身，不参与竖排。 */
    zh: '竖排排版：EPUB / TXT',
    'zh-TW': '豎排排版：EPUB / TXT',
    en: 'Vertical typesetting: EPUB / TXT',
    ja: '縦組み：EPUB / TXT',
    de: 'Vertikaler Satz: EPUB / TXT',
    fr: 'Composition verticale : EPUB / TXT',
    es: 'Composición vertical: EPUB / TXT',
    pt: 'Composição vertical: EPUB / TXT',
  },
  tts: {
    /* 1.0.0：PDF 这版也能朗读，念完这一页会自动翻下一页接着念。 */
    zh: '朗读：EPUB、TXT 与 PDF，念完自动翻页',
    'zh-TW': '朗讀：EPUB、TXT 與 PDF，念完自動翻頁',
    en: 'Read aloud: EPUB, TXT and PDF, auto page-turn',
    ja: '読み上げ：EPUB・TXT・PDF、読み終えたら自動で次のページ',
    de: 'Vorlesen: EPUB, TXT und PDF, blättert automatisch weiter',
    fr: 'Lecture vocale : EPUB, TXT et PDF, page suivante automatique',
    es: 'Lectura en voz alta: EPUB, TXT y PDF, pasa de página sola',
    pt: 'Leitura em voz alta: EPUB, TXT e PDF, vira a página sozinha',
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
     让用户以为要买两次。
     2026-11-14：行名按 bz 的文案统一成「AI 知识盒」——bz 设置页里就叫
     这个，以前写「连接至 BZ AI 知识库」是另一套叫法，用户对不上。 */
  kb: {
    zh: 'AI 知识盒',
    'zh-TW': 'AI 知識盒',
    en: 'AI knowledge box',
    ja: 'AI ナレッジボックス',
    de: 'KI-Wissensbox',
    fr: 'Boîte à savoir IA',
    es: 'Caja de conocimiento IA',
    pt: 'Caixa de conhecimento IA',
  },
  /* ── 探索中（2026-11-11，2026-11-12 增至八项） ──
   * 八项都还没实现，先占表尾八行。行里不写「开发中」——状态由段名说，
   * 两版都不打勾，也不挂能力位。
   *
   * OCR 与 AI 视觉是两条技术路线、同一个目标：让扫描件拥有文字版的
   * 选中 / 搜索 / 划线体验；PDF 重排把固定版式变成流式；漫画模式补上
   * 分格 / 右到左 / 跨页；整章翻译做原文译文对照；复习是全文回顾 +
   * AI 抽认卡 + AI 出题；墨水屏优化把黑白对比拉高、翻页不闪；界面动效
   * 给翻页、切章与书架切换加过渡，且随时可关；剪藏成书把 bz 剪藏本里的
   * 文章合成一本 EPUB，进书架当普通书读。
   *
   * 八语言按日常开发规矩：zh / en 写实，其余六包占位（ja/de/fr/es/pt 放
   * 英文原文、zh-TW 放繁体）。准备上架那一版再统一补正式翻译。 */
  pdfOcr: {
    zh: 'PDF OCR+AI视觉：扫描件像文字版一样能选能搜能划',
    'zh-TW': 'PDF OCR+AI視覺：掃描件像文字版一樣能選能搜能劃',
    en: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
    ja: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
    de: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
    fr: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
    es: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
    pt: 'PDF OCR + AI vision: scanned pages work like text — select, search, highlight',
  },
  pdfReflow: {
    zh: 'PDF 重排：固定版式也能流式读',
    'zh-TW': 'PDF 重排：固定版式也能流式讀',
    en: 'PDF reflow: fixed layouts read as flowing text',
    ja: 'PDF reflow: fixed layouts read as flowing text',
    de: 'PDF reflow: fixed layouts read as flowing text',
    fr: 'PDF reflow: fixed layouts read as flowing text',
    es: 'PDF reflow: fixed layouts read as flowing text',
    pt: 'PDF reflow: fixed layouts read as flowing text',
  },
  manga: {
    zh: '漫画模式：分格、右到左、跨页',
    'zh-TW': '漫畫模式：分格、右到左、跨頁',
    en: 'Manga mode: panels, right-to-left, spreads',
    ja: 'Manga mode: panels, right-to-left, spreads',
    de: 'Manga mode: panels, right-to-left, spreads',
    fr: 'Manga mode: panels, right-to-left, spreads',
    es: 'Manga mode: panels, right-to-left, spreads',
    pt: 'Manga mode: panels, right-to-left, spreads',
  },
  transChapter: {
    zh: '整章翻译：原文译文对照读',
    'zh-TW': '整章翻譯：原文譯文對照讀',
    en: 'Chapter translation: source and translation side by side',
    ja: 'Chapter translation: source and translation side by side',
    de: 'Chapter translation: source and translation side by side',
    fr: 'Chapter translation: source and translation side by side',
    es: 'Chapter translation: source and translation side by side',
    pt: 'Chapter translation: source and translation side by side',
  },
  review: {
    zh: '复习：全文回顾，AI 生成抽认卡与题目',
    'zh-TW': '複習：全文回顧，AI 生成抽認卡與題目',
    en: 'Review: reread in full, with AI flashcards and quizzes',
    ja: 'Review: reread in full, with AI flashcards and quizzes',
    de: 'Review: reread in full, with AI flashcards and quizzes',
    fr: 'Review: reread in full, with AI flashcards and quizzes',
    es: 'Review: reread in full, with AI flashcards and quizzes',
    pt: 'Review: reread in full, with AI flashcards and quizzes',
  },
  eink: {
    zh: '墨水屏优化：黑白更清、翻页不闪',
    'zh-TW': '墨水屏優化：黑白更清、翻頁不閃',
    en: 'E Ink optimization: crisper black and white, no page-turn flashing',
    ja: 'E Ink optimization: crisper black and white, no page-turn flashing',
    de: 'E Ink optimization: crisper black and white, no page-turn flashing',
    fr: 'E Ink optimization: crisper black and white, no page-turn flashing',
    es: 'E Ink optimization: crisper black and white, no page-turn flashing',
    pt: 'E Ink optimization: crisper black and white, no page-turn flashing',
  },
  motion: {
    zh: '界面动效：翻页、切章与书架过渡，可随时关',
    'zh-TW': '介面動效：翻頁、切章與書架過渡，可隨時關',
    en: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
    ja: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
    de: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
    fr: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
    es: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
    pt: 'Interface motion: page turns, chapter changes and shelf transitions, can be turned off',
  },
  /* 2026-11-12 新增：把 bz 剪藏本的文章合成一本 EPUB，进书架当普通书读。
     走的是「一次生成、当书来读」，阅读体验（划线、想法、统计、AI）与普通
     EPUB 完全一致，不为剪藏单独做一套阅读界面。 */
  clipEpub: {
    zh: '剪藏成书：把剪藏本的文章合成 EPUB，在书架里读',
    'zh-TW': '剪藏成書：把剪藏本的文章合成 EPUB，在書架裡讀',
    en: 'Clipbook to EPUB: bind clipped articles into one EPUB and read it on the shelf',
    ja: 'クリップブックを EPUB に：クリップ記事を 1 冊の EPUB にまとめ、本棚で読む',
    de: 'Clipbook als EPUB: geclippte Artikel in ein EPUB binden und im Regal lesen',
    fr: 'Le cahier de clips en EPUB : relier les articles clippés en un EPUB à lire sur l’étagère',
    es: 'Clipbook a EPUB: encuaderna los artículos recortados en un EPUB y léelo en el estante',
    pt: 'Clipbook em EPUB: encaderne os artigos recortados num EPUB e leia-o na estante',
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
    /* 段标题只留「AI」（2026-11-10 用户定）：一屏里要一眼看出结构，标题越短
       越好。自备接口与密钥不在表头说——设置页的 AI 分组、`side.ai.notReady`
       与请求失败时的报错都在原地讲了，标题再重复一遍只是把表撑宽。 */
    zh: 'AI',
    'zh-TW': 'AI',
    en: 'AI',
    ja: 'AI',
    de: 'KI',
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
  /* 探索中（2026-11-11）：段名说明状态，行里不再重复「开发中」。
     英文用 Explorations 而不是 In development——它是栏目名，不是警告语。 */
  explore: {
    zh: '探索中',
    'zh-TW': '探索中',
    en: 'Explorations',
    ja: 'Explorations',
    de: 'Explorations',
    fr: 'Explorations',
    es: 'Explorations',
    pt: 'Explorations',
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
