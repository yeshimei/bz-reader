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
 * 2026-11-21 重排（作者定稿）：
 *   · 分组从九段改成十段，段名压到 2–4 字——阅读 / 排版 / 导入 / PDF 阅读 /
 *     笔记 / 复习 / 数据 / AI / 听书 / 路线图；
 *   · 「排版」独立成段：单双栏、竖排、并排、全书鸟瞰收在一起；
 *   · 「复习」从路线图转正并独立成段，新增页签、按划线挑、按章生成、
 *     已在复习四行；
 *   · 全书鸟瞰下放基础版；
 *   · 行名保持原文，不再压缩或换词。
 *
 * 2026-11-26：新增「书架」与「统计」两段（共十三段），补 14 行；
 * 日德法西葡的 keepAwake / aiFollow / 漫画九行同时写成正式翻译，
 * 不再留英文占位。
 * ============================================================ */
import { locale, type Locale } from './index';

export type PlanKey =
  /* ── 书架（2026-11-26 新增段） ──
   * 书怎么管：信息与封面、归档、多分类。三件都免费，单独成段是为了
   * 不再把它们塞进「阅读」——那一段回答的是「打开一本书之后能做什么」。 */
  | 'shelfEdit'
  | 'archive'
  | 'multiShelf'
  /* ── 阅读（免费） ── */
  | 'reading'
  | 'keepAwake'
  | 'marks'
  | 'card'
  | 'cardTemplates'
  | 'imageViewer'
  | 'immersive'
  | 'inbookSearch'
  | 'back'
  | 'footnote'
  | 'classify'
  /* ── 排版 ── */
  | 'columns'
  | 'vertical'
  | 'parallel'
  | 'bookmap'
  /* ── 导入 ── */
  | 'formats'
  | 'clipEpub'
  /* ── PDF 阅读 ── */
  | 'pdfView'
  | 'pdfThumbs'
  | 'pdfLink'
  | 'pdfBacklink'
  | 'pdfAnnots'
  | 'pdfExport'
  /* 框选成图（2026-11-26）：与「导出整页」不是一回事——它把页内一块
     裁下来配引文，做成能直接贴进笔记的卡片。 */
  | 'pdfRegion'
  | 'pdfOcr'
  /* ── 笔记 ── */
  | 'bilink'
  | 'cites'
  | 'export'
  /* 导出模板（2026-11-26）：四档 + 自定义多行。导出本身仍免费，
     这一行只说明「拿得漂亮」的那一面。 */
  | 'exportTemplates'
  /* ── 复习（2026-11-21 独立成段） ──
   * 「复习」本身已上线，从路线图搬来这里；另外四行是这次新拆的入口：
   * 页签、按划线挑、按章生成、已在复习状态。 */
  | 'review'
  | 'reviewTab'
  | 'reviewMarks'
  | 'reviewChapter'
  | 'reviewPlanned'
  /* ── 统计（2026-11-26 从数据段拆出来） ──
   * 「读了多少」和「书怎么找」是两件事：前者是回顾，后者是检索与备份。
   * 拆开后统计段四行、数据段三行，各自的拦点与卖点也更好对上。 */
  | 'stats'
  | 'checkin'
  | 'poster'
  | 'weeklyPoster'
  /* ── 数据 ── */
  | 'crossSearch'
  | 'semantic'
  | 'backup'
  /* ── AI ──
   * 2026-11-16 作者定稿：AI 做了一大批增强（划词五项菜单与悬停展开、
   * 锚定追问浮框、划词会话留痕、侧栏问答历史、依据按章跳转、连接笔记
   * 浮层、书架对话页），表里原来四行装不下，拆成五行、一行只说一件事。
   * 「对话留档」与「伴读」以前同挤在 aiChat 一行，现在各占一行、
   * 各挂一个能力位（aiLog / aiChat），被拦时才亮得对。
   * 2026-11-22：解释 / 翻译 / 摘要下放基础版，追问单独成行（aiFollow）。 */
  | 'aiSel'
  | 'aiFollow'
  | 'aiBook'
  | 'aiLog'
  | 'aiChat'
  /* 补书目信息（2026-11-26）：按作者口径是基础版，不挂门禁。 */
  | 'aiMeta'
  | 'kb'
  /* ── 听书 ──
   * 2026-11-14 定稿：朗读本体下放基础版，收费的只剩「备材料」与「带走」。 */
  | 'tts'
  | 'ttsEngine'
  | 'ttsVoice'
  | 'ttsRate'
  /* 续听与缓存（2026-11-26）：朗读本体的一部分，两行都免费。 */
  | 'ttsResume'
  | 'ttsCache'
  | 'ttsChapter'
  | 'ttsWhole'
  | 'ttsOffline'
  /* ── 漫画（2026-11-22 独立成段）──
   * 原来是「排版」组里的一行「漫画模式：分格、右到左、跨页」。漫画能做的事
   * 远不止三件，一行塞不下也说不清「买了能多出哪几件事」。现在按
   * 打开 → 翻页 → 画面 → 逐格的顺序摊成九行，全部是高级版。 */
  | 'mangaOpen'
  | 'mangaInfo'
  | 'mangaDir'
  | 'mangaSpread'
  | 'mangaFlow'
  | 'mangaPanels'
  | 'mangaFit'
  | 'mangaTone'
  | 'mangaThumbs'
  /* ── 路线图 ── */
  | 'pdfReflow'
  | 'transChapter'
  | 'eink'
  | 'motion';

/**
 * 分组 id。和 `PlanKey` 是**两套命名空间**：这里是「段」，那里是「行」。
 * 名字刻意不重合，免得代码里 `PLAN_TABLE[0].key` 与 `PLAN_GROUPS[0].key`
 * 读起来像同一个东西。归属关系在 `data/entitlement.ts` 的 PLAN_GROUPS。
 */
export type PlanGroupKey =
  /* 书架（2026-11-26）：书怎么管，放在「阅读」之前。 */
  | 'shelf'
  | 'read'
  | 'layout'
  | 'import'
  | 'pdf'
  | 'manga'
  | 'notes'
  | 'review'
  /* 统计（2026-11-26）：从 data 拆出来，回顾与检索分开。 */
  | 'stats'
  | 'data'
  | 'ai'
  | 'voice'
  | 'roadmap';

const PLAN_TEXT: Record<PlanKey, Record<Locale, string>> = {
  reading: {
    /* 单栏/双栏、竖排各有自己的行，行名不再写「与排版」，只说「打开即读」。 */
    zh: 'EPUB / TXT 打开即读',
    'zh-TW': 'EPUB / TXT 開啟即讀',
    en: 'EPUB / TXT, open and read',
    ja: 'EPUB / TXT をすぐ読める',
    de: 'EPUB / TXT sofort lesbar',
    fr: 'EPUB / TXT prêts à lire',
    es: 'EPUB / TXT listos para leer',
    pt: 'EPUB / TXT prontos para ler',
  },
  /* 2026-11-24 屏幕常亮从漫画抽成通用偏好，基础版也开。 */
  keepAwake: {
    zh: '阅读时屏幕常亮',
    'zh-TW': '閱讀時螢幕常亮',
    en: 'Keep the screen awake while reading',
    ja: '読書中は画面を消さない',
    de: 'Bildschirm beim Lesen anlassen',
    fr: 'Garder l’écran allumé pendant la lecture',
    es: 'Mantener la pantalla encendida al leer',
    pt: 'Manter a tela ligada durante a leitura',
  },
  columns: {
    zh: '单栏 / 双栏排版',
    'zh-TW': '單欄 / 雙欄排版',
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
  /* 跳转历史：PDF 与 EPUB 共用一颗按钮，两栏都打勾。 */
  back: {
    zh: '跳转历史：一键回到上一处',
    'zh-TW': '跳轉歷史：一鍵回到上一處',
    en: 'Jump history: one tap back to where you were',
    ja: '移動履歴：ワンタップで前の位置へ',
    de: 'Sprungverlauf – ein Klick zurück zur letzten Stelle',
    fr: 'Historique : un clic pour revenir à votre position',
    es: 'Historial: un toque para volver a donde estaba',
    pt: 'Histórico: um toque de volta ao ponto anterior',
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
  classify: {
    zh: '分类管理：自建分类归书',
    'zh-TW': '分類管理：自建分類歸書',
    en: 'Shelf categories: make your own and file books',
    ja: 'カテゴリ管理：自分で作って本を振り分け',
    de: 'Regal-Kategorien: eigene anlegen und Bücher einsortieren',
    fr: 'Catégories : créez les vôtres et rangez vos livres',
    es: 'Categorías: crea las tuyas y ordena tus libros',
    pt: 'Categorias: crie as suas e organize os livros',
  },
  formats: {
    /* 只写真机实测能打开的格式。1.0.0 定稿：按「族名（枚举）」写全，
       2026-11-10 用户改口径把 PDF 也写进来——格式是卖点，要一行看全。
       下面「PDF 阅读」段讲的是打开以后能做什么，不是同一件事。 */
    zh: 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫画、PDF',
    'zh-TW': 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫畫、PDF',
    en: 'Kindle family (MOBI / AZW3), FB2, CBZ comics, PDF',
    ja: 'Kindle 系（MOBI / AZW3）、FB2、CBZ コミック、PDF',
    de: 'Kindle-Familie (MOBI / AZW3), FB2, CBZ-Comics, PDF',
    fr: 'Famille Kindle (MOBI / AZW3), FB2, BD en CBZ, PDF',
    es: 'Familia Kindle (MOBI / AZW3), FB2, cómics en CBZ, PDF',
    pt: 'Família Kindle (MOBI / AZW3), FB2, quadrinhos em CBZ, PDF',
  },
  clipEpub: {
    /* 2026-11-12 新增、11-13 转正：把 bz 剪藏本的文章合成一本 EPUB。
       走「一次生成、当书来读」，阅读体验与普通 EPUB 完全一致。 */
    zh: '剪藏成书：剪藏本合成一本 EPUB',
    'zh-TW': '剪藏成書：剪藏本合成一本 EPUB',
    en: 'Clipbook to EPUB: bind clipped articles into one EPUB',
    ja: 'クリップブックを EPUB に：クリップ記事を 1 冊にまとめる',
    de: 'Clipbook als EPUB: geclippte Artikel in ein EPUB binden',
    fr: 'Le cahier de clips en EPUB : relier les articles clippés en un EPUB',
    es: 'Clipbook a EPUB: encuaderna los artículos recortados en un EPUB',
    pt: 'Clipbook em EPUB: encaderne os artigos recortados num EPUB',
  },
  /* ── PDF 段：怎么读 → 怎么拿出来 ── */
  pdfView: {
    zh: 'PDF 阅读：缩放、旋转、单双页、滚动',
    'zh-TW': 'PDF 閱讀：縮放、旋轉、單雙頁、捲動',
    en: 'Read PDFs: zoom, rotate, one or two pages, scroll',
    ja: 'PDF を読む：ズーム・回転・見開き・スクロール',
    de: 'PDF lesen: zoomen, drehen, Einzel- / Doppelseite, Scrollen',
    fr: 'Lire un PDF : zoom, rotation, page simple ou double, défilement',
    es: 'Leer un PDF: zoom, rotación, una o dos páginas, desplazamiento',
    pt: 'Ler um PDF: zoom, rotação, uma ou duas páginas, rolagem',
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
    zh: '复制页链接：页码、视图、嵌入、批注',
    'zh-TW': '複製頁連結：頁碼、檢視、嵌入、批註',
    en: 'Copy page links: page, view, embed, annotation',
    ja: 'ページリンクをコピー：ページ・ビュー・埋め込み・注釈',
    de: 'Seitenlinks kopieren: Seite, Ansicht, Einbettung, Anmerkung',
    fr: 'Copier les liens de page : page, vue, intégration, annotation',
    es: 'Copiar enlaces de página: página, vista, incrustación, anotación',
    pt: 'Copiar links de página: página, vista, incorporação, anotação',
  },
  /* 2026-11-14：从「本页反链与文件自带批注」拆出来。两件事各有一个开关：
     反链画的是笔记里指向这一页的链接，文件批注画的是 PDF 里别人标的东西。 */
  pdfBacklink: {
    zh: '本页反链：笔记引了这页就画出来',
    'zh-TW': '本頁反鏈：筆記引了這頁就畫出來',
    en: 'Page backlinks: notes citing this page show up on it',
    ja: 'このページへの被リンク：引用したノートを頁上に表示',
    de: 'Backlinks auf der Seite: Notizen, die sie zitieren, erscheinen darauf',
    fr: 'Rétroliens de page : les notes qui citent cette page s’affichent dessus',
    es: 'Retroenlaces: las notas que citan esta página se muestran en ella',
    pt: 'Retrolinks: as notas que citam esta página aparecem nela',
  },
  pdfAnnots: {
    zh: '文件自带批注：别人标的也能读',
    'zh-TW': '檔案自帶批註：別人標的也能讀',
    en: 'Annotations in the file: read what others marked',
    ja: 'ファイル内の注釈：他の人が引いた線も読める',
    de: 'Anmerkungen in der Datei: lesen, was andere markiert haben',
    fr: 'Annotations du fichier : lire ce que d’autres ont marqué',
    es: 'Anotaciones del archivo: leer lo que otros marcaron',
    pt: 'Anotações do arquivo: ler o que outros marcaram',
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
  /* ── 笔记与导出 ── */
  bilink: {
    zh: '划线存成双链：笔记里点回原文',
    'zh-TW': '劃線存成雙鏈：筆記裡點回原文',
    en: 'Highlights as wikilinks: click back from your notes',
    ja: 'ハイライトを双方向リンクに：ノートから原文へ',
    de: 'Markierungen als Wikilinks: aus der Notiz zur Stelle',
    fr: 'Surlignages en wikiliens : revenir au texte depuis la note',
    es: 'Subrayados como wikienlaces: volver al texto desde la nota',
    pt: 'Destaques como wikilinks: voltar ao texto pela nota',
  },
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
  /* ── 数据与搜索 ── */
  stats: {
    /* 2026-11-20：统计页扩成六页签的年度回顾，行名跟着从「明细」升到「回顾」 */
    zh: '统计回顾：字数速度、节律热力、分类与成就',
    'zh-TW': '統計回顧：字數速度、節律熱力、分類與成就',
    en: 'Stats recap: pace, rhythm heatmap, per-book ETA, badges',
    ja: '統計レビュー：読了速度、時間帯、分類と実績',
    de: 'Statistik: Lesetempo, Rhythmus, Kategorien und Abzeichen',
    fr: 'Statistiques : vitesse, rythme, catégories et badges',
    es: 'Estadísticas: ritmo, tendencias, categorías e insignias',
    pt: 'Estatísticas: velocidade, ritmo, categorias e conquistas',
  },
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
    zh: '全库搜索：按字面搜所有书，含 PDF',
    'zh-TW': '全庫搜尋：按字面搜所有書，含 PDF',
    en: 'Whole-library search: literal match, PDF text included',
    ja: 'ライブラリ全体を検索：文字どおり全冊、PDF 本文も対象',
    de: 'Bibliothek durchsuchen: wörtlich in allen Büchern, PDF-Text inklusive',
    fr: 'Recherche dans toute la bibliothèque, texte des PDF inclus',
    es: 'Búsqueda en toda la biblioteca, texto de PDF incluido',
    pt: 'Pesquisa em toda a biblioteca, texto de PDF incluído',
  },
  semantic: {
    zh: '语义搜索：按意思找，本书或全库',
    'zh-TW': '語意搜尋：按意思找，本書或全庫',
    en: 'Semantic search: by meaning, this book or the shelf',
    ja: 'セマンティック検索：意味で探す、本書でも本棚でも',
    de: 'Semantische Suche: nach Bedeutung, im Buch oder Regal',
    fr: 'Recherche sémantique : par le sens, ce livre ou le rayon',
    es: 'Búsqueda semántica: por significado, este libro o el estante',
    pt: 'Busca semântica: por significado, neste livro ou na estante',
  },
  /* ── AI ──
     2026-11-22：解释 / 翻译 / 摘要下放基础版（不再设门），「追问」单独
     成行、仍是高级版。行名里不再写「与追问」——那是另一行的事。 */
  aiSel: {
    zh: 'AI 解释、翻译、摘要：即划即用',
    'zh-TW': 'AI 解釋、翻譯、摘要：即劃即用',
    en: 'AI explain, translate and summarize: select and go',
    ja: 'AI 解説・翻訳・要約：選択するだけ',
    de: 'KI: erklären, übersetzen, zusammenfassen — direkt zur Auswahl',
    fr: 'IA : expliquer, traduire, résumer — sur une sélection',
    es: 'IA: explicar, traducir y resumir — sobre una selección',
    pt: 'IA: explicar, traduzir e resumir — numa seleção',
  },
  aiFollow: {
    zh: 'AI 追问：就这段接着问',
    'zh-TW': 'AI 追問：就這段接著問',
    en: 'AI follow-up: keep asking about this passage',
    /* 日德法西葡按仓库规矩先留英文占位，上架前统一翻 */
    ja: 'AI に追加質問：この一節について続けて聞く',
    de: 'KI-Nachfrage: zu dieser Stelle weiterfragen',
    fr: 'Question IA complémentaire : continuer sur ce passage',
    es: 'Pregunta IA de seguimiento: seguir sobre este pasaje',
    pt: 'Pergunta de IA: continuar sobre este trecho',
  },
  /* 2026-11-16：行名从「先建索引，再问整本」改成「四种依据都可添加进去」。
     索引仍然是内部步骤（建索引的入口没变），但卖点不是它——用户关心的是
     能往问题里塞什么：划线、正文、截图、笔记。 */
  aiBook: {
    zh: 'AI 全书问答：划线、正文、截图与笔记四种依据都可添加进去',
    'zh-TW': 'AI 全書問答：劃線、正文、截圖與筆記四種依據都可加入',
    en: 'AI Q&A over the whole book: highlights, page text, screenshots and notes as evidence',
    ja: 'AI 全書 Q&A：ハイライト・本文・スクリーンショット・ノートの 4 種を根拠に追加できる',
    de: 'KI: Fragen zum ganzen Buch — Markierungen, Seitentext, Screenshots und Notizen als Belege',
    fr: 'Questions IA sur tout le livre : surlignages, texte de la page, captures et notes comme sources',
    es: 'Preguntas IA sobre todo el libro: subrayados, texto de la página, capturas y notas como base',
    pt: 'Perguntas IA sobre o livro inteiro: destaques, texto da página, capturas e notas como base',
  },
  /* 2026-11-16 新增：对话留档 + 导出到笔记。与「伴读」分开写，
     挂自己的能力位 aiLog。 */
  aiLog: {
    zh: 'AI 对话留档并导出至笔记',
    'zh-TW': 'AI 對話留存並匯出至筆記',
    en: 'AI chats are kept and can be exported to a note',
    ja: 'AI の会話を保存し、ノートに書き出せる',
    de: 'KI-Gespräche bleiben erhalten und lassen sich als Notiz exportieren',
    fr: 'Les échanges IA sont conservés et exportables vers une note',
    es: 'Las conversaciones de IA se guardan y se pueden exportar a una nota',
    pt: 'As conversas de IA ficam guardadas e podem ser exportadas para uma nota',
  },
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
  /* 2026-11-14：按作者口径，「AI 知识盒」改叫「AI 知识库」。
     2026-11-16 作者定稿：行名改成「增量阅读、知识输入、整理与输出的闭环」——
     它讲的是这件事的完整路径，不再是三类条目的枚举。 */
  kb: {
    zh: 'AI 知识库：增量阅读、知识输入、整理与输出的闭环',
    'zh-TW': 'AI 知識庫：增量閱讀、知識輸入、整理與輸出的閉環',
    en: 'AI knowledge base: incremental reading, intake, and a loop from notes to output',
    ja: 'AI ナレッジベース：インクリメンタルリーディング・知識の取り込み・整理と出力の循環',
    de: 'KI-Wissensbasis: inkrementelles Lesen, Wissensinput und ein Kreislauf bis zur Ausgabe',
    fr: 'Base de connaissances IA : lecture incrémentale, entrée de connaissances et boucle jusqu’à la production',
    es: 'Base de conocimiento IA: lectura incremental, entrada de conocimiento y un ciclo hasta la salida',
    pt: 'Base de conhecimento IA: leitura incremental, entrada de conhecimento e um ciclo até a saída',
  },
  /* ── 朗读与听书（2026-11-14 定稿） ──
   * 五行免费：点一下就念，不花我们的钱，也不该设门；
   * 三行付费：整章 / 整本要先花时间备，离线书是把文件带走。 */
  tts: {
    zh: '朗读：EPUB、TXT、PDF，念完自动翻页',
    'zh-TW': '朗讀：EPUB、TXT、PDF，念完自動翻頁',
    en: 'Read aloud: EPUB, TXT and PDF, turns the page on its own',
    ja: '読み上げ：EPUB・TXT・PDF、読み終えたら自動で次ページ',
    de: 'Vorlesen: EPUB, TXT und PDF, blättert selbst weiter',
    fr: 'Lecture vocale : EPUB, TXT et PDF, tourne la page toute seule',
    es: 'Lectura en voz alta: EPUB, TXT y PDF, pasa de página sola',
    pt: 'Leitura em voz alta: EPUB, TXT e PDF, vira a página sozinha',
  },
  ttsEngine: {
    zh: '三种引擎：系统语音、在线、本地自建',
    'zh-TW': '三種引擎：系統語音、線上、本機自建',
    en: 'Three engines: system voice, online, self-hosted',
    ja: '3 つのエンジン：OS の音声・オンライン・自前サーバー',
    de: 'Drei Stimmen: System, online, selbst gehostet',
    fr: 'Trois moteurs : voix système, en ligne, auto-hébergé',
    es: 'Tres motores: voz del sistema, en línea, propio',
    pt: 'Três motores: voz do sistema, online, próprio',
  },
  ttsVoice: {
    zh: '音色与试听',
    'zh-TW': '音色與試聽',
    en: 'Voices and preview',
    ja: '声の選択と試聴',
    de: 'Stimmen und Probehören',
    fr: 'Voix et écoute',
    es: 'Voces y prueba',
    pt: 'Vozes e teste',
  },
  ttsRate: {
    zh: '语速与高亮跟随',
    'zh-TW': '語速與高亮跟隨',
    en: 'Speed and highlight follow',
    ja: '速度とハイライト追従',
    de: 'Tempo und mitlaufende Hervorhebung',
    fr: 'Vitesse et surlignage qui suit',
    es: 'Velocidad y resaltado que sigue',
    pt: 'Velocidade e destaque que acompanha',
  },
  ttsChapter: {
    zh: '整章预生成',
    'zh-TW': '整章預先產生',
    en: 'Pre-build the chapter',
    ja: '章をまとめて先に生成',
    de: 'Kapitel vorab erzeugen',
    fr: 'Pré-générer le chapitre',
    es: 'Pregenerar el capítulo',
    pt: 'Pré-gerar o capítulo',
  },
  ttsWhole: {
    zh: '整本预生成',
    'zh-TW': '整本預先產生',
    en: 'Pre-build the whole book',
    ja: '本全体を先に生成',
    de: 'Ganzes Buch vorab erzeugen',
    fr: 'Pré-générer tout le livre',
    es: 'Pregenerar el libro entero',
    pt: 'Pré-gerar o livro inteiro',
  },
  ttsOffline: {
    zh: '离线听书：mp3 拷进手机照样听',
    'zh-TW': '離線聽書：mp3 拷進手機照樣聽',
    en: 'Offline audio: copy the mp3s to your phone and keep listening',
    ja: 'オフライン再生：mp3 をスマホにコピーしても聴ける',
    de: 'Offline hören: MP3s aufs Handy kopieren und weiterhören',
    fr: 'Écoute hors ligne : copiez les mp3 sur le téléphone',
    es: 'Escucha sin conexión: copia los mp3 al móvil',
    pt: 'Escuta offline: copie os mp3 para o celular',
  },
  /* ── 阅读方式 ── */
  vertical: {
    zh: '竖排排版：EPUB / TXT',
    'zh-TW': '豎排排版：EPUB / TXT',
    en: 'Vertical typesetting: EPUB / TXT',
    ja: '縦組み：EPUB / TXT',
    de: 'Vertikaler Satz: EPUB / TXT',
    fr: 'Composition verticale : EPUB / TXT',
    es: 'Composición vertical: EPUB / TXT',
    pt: 'Composição vertical: EPUB / TXT',
  },
  parallel: {
    /* 并排的是任意两本书、段落同步，不是「原文 + 译文」。 */
    zh: '并排对照：与另一本书同步段落',
    'zh-TW': '並排對照：與另一本書同步段落',
    en: 'Side by side: two books, paragraphs in step',
    ja: '並べて対照：別の本と段落を同期',
    de: 'Nebeneinander: zwei Bücher, Absätze laufen mit',
    fr: 'Côte à côte : deux livres, paragraphes synchronisés',
    es: 'En paralelo: dos libros, párrafos sincronizados',
    pt: 'Lado a lado: dois livros, parágrafos sincronizados',
  },
  bookmap: {
    zh: '全书鸟瞰：各章划线数与一句话摘要',
    'zh-TW': '全書鳥瞰：各章劃線數與一句話摘要',
    en: 'Book overview: highlights per chapter, one-line summary',
    ja: '全体マップ：章ごとのハイライト数と一行要約',
    de: 'Buchübersicht: Markierungen je Kapitel, Ein-Satz-Zusammenfassung',
    fr: 'Vue d’ensemble : surlignages par chapitre, résumé en une ligne',
    es: 'Vista general: subrayados por capítulo, resumen en una línea',
    pt: 'Visão geral: destaques por capítulo, resumo em uma linha',
  },
  /* ── PDF 段最后一行（2026-11-15 从「探索中」转正） ── */
  pdfOcr: {
    zh: '扫描页识别：像文字版一样选、搜、划',
    'zh-TW': '掃描頁識別：像文字版一樣選、搜、劃',
    en: 'OCR scans: select, search and highlight like text',
    ja: 'OCR スキャン：テキスト同様に選択・検索・ハイライト',
    de: 'OCR-Scans: auswählen, suchen und markieren wie Text',
    fr: 'OCR : sélectionner, chercher et surligner comme du texte',
    es: 'OCR: seleccionar, buscar y subrayar como texto',
    pt: 'OCR: selecionar, pesquisar e destacar como texto',
  },
  /* ── 路线图（都还没实现，两版都不打勾） ── */
  pdfReflow: {
    zh: 'PDF 重排：固定版式变流式',
    'zh-TW': 'PDF 重排：固定版式變流式',
    en: 'PDF reflow: fixed layouts read as flowing text',
    ja: 'PDF リフロー：固定レイアウトを流し組みに',
    de: 'PDF-Reflow: feste Layouts als fließender Text',
    fr: 'Reflow PDF : les mises en page fixes deviennent du texte fluide',
    es: 'Reflujo de PDF: los diseños fijos pasan a texto fluido',
    pt: 'Reflow de PDF: layouts fixos viram texto fluido',
  },
  /* ── 漫画（2026-11-22 独立成段，九行）──
   * 顺序就是对照表的阅读顺序：怎么打开 → 方向 → 单双页 → 翻法 → 逐格 →
   * 画面 → 缩略图。简中 / 繁中 / 英三种先写实；日德法西葡沿用英文占位，
   * 按仓库规矩留到发版前统一翻（与上面的 cites 同一处理）。 */
  mangaOpen: {
    zh: 'CBZ / 文件夹打开即读',
    'zh-TW': 'CBZ / 資料夾開啟即讀',
    en: 'CBZ and folders, open and read',
    ja: 'CBZ / フォルダをそのまま開いて読める',
    de: 'CBZ und Ordner direkt öffnen und lesen',
    fr: 'CBZ et dossiers, ouvrir et lire directement',
    es: 'CBZ y carpetas, abrir y leer directamente',
    pt: 'CBZ e pastas, abrir e ler direto',
  },
  mangaInfo: {
    zh: 'ComicInfo 方向自动跟随',
    'zh-TW': 'ComicInfo 方向自動跟隨',
    en: 'Follows the reading direction in ComicInfo',
    ja: 'ComicInfo の読み方向に自動で従う',
    de: 'Liest die Leserichtung aus ComicInfo automatisch',
    fr: 'Suit automatiquement le sens de lecture de ComicInfo',
    es: 'Sigue automáticamente la dirección de lectura de ComicInfo',
    pt: 'Segue automaticamente a direção de leitura do ComicInfo',
  },
  mangaDir: {
    zh: '右到左 / 左到右',
    'zh-TW': '右到左 / 左到右',
    en: 'Right-to-left / left-to-right',
    ja: '右から左 / 左から右',
    de: 'Rechts nach links / links nach rechts',
    fr: 'Droite à gauche / gauche à droite',
    es: 'Derecha a izquierda / izquierda a derecha',
    pt: 'Direita para esquerda / esquerda para direita',
  },
  mangaSpread: {
    zh: '单页 / 双页，跨页自动拆合',
    'zh-TW': '單頁 / 雙頁，跨頁自動拆合',
    en: 'Single / double page, spreads split and rejoined',
    ja: '単ページ / 見開き、見開きの自動分割・結合',
    de: 'Einzel- / Doppelseite, Doppelseiten automatisch teilen und zusammenfügen',
    fr: 'Page simple / double, doubles pages découpées et réunies automatiquement',
    es: 'Página simple / doble, dobles páginas divididas y unidas automáticamente',
    pt: 'Página simples / dupla, páginas duplas divididas e reunidas automaticamente',
  },
  mangaFlow: {
    zh: '一屏一页 / 连续 / 条漫',
    'zh-TW': '一屏一頁 / 連續 / 條漫',
    en: 'One page / continuous / long strip',
    ja: '1 画面 1 ページ / 連続 / 縦スクロール',
    de: 'Eine Seite pro Bildschirm / fortlaufend / Webtoon-Streifen',
    fr: 'Une page par écran / continu / bande verticale',
    es: 'Una página por pantalla / continuo / tira vertical',
    pt: 'Uma página por tela / contínuo / tira vertical',
  },
  mangaPanels: {
    zh: '逐格读：自动分格、防剧透',
    'zh-TW': '逐格讀：自動分格、防劇透',
    en: 'Panel by panel: auto panels, spoiler-free',
    ja: 'コマごとに読む：自動コマ分割・ネタバレ防止',
    de: 'Panel für Panel: automatische Panels, spoilerfrei',
    fr: 'Case par case : découpage auto, sans spoiler',
    es: 'Viñeta a viñeta: división automática, sin spoilers',
    pt: 'Quadro a quadro: divisão automática, sem spoilers',
  },
  mangaFit: {
    zh: '六档适配 + 缩放拖动',
    'zh-TW': '六檔適配 + 縮放拖動',
    en: 'Six fit modes, zoom and pan',
    ja: '6 段階のフィット + ズームと移動',
    de: 'Sechs Anpassungsmodi, Zoom und Verschieben',
    fr: 'Six modes d’ajustement, zoom et déplacement',
    es: 'Seis modos de ajuste, zoom y arrastre',
    pt: 'Seis modos de ajuste, zoom e arrastar',
  },
  mangaTone: {
    zh: '裁白边、一键调色',
    'zh-TW': '裁白邊、一鍵調色',
    en: 'Trim margins, one-tap tone fix',
    ja: '白余白の切り取り、ワンタップ調色',
    de: 'Ränder beschneiden, Farbton mit einem Tipp',
    fr: 'Rogner les marges, correction des tons en un geste',
    es: 'Recortar márgenes, ajuste de tono en un toque',
    pt: 'Cortar margens, ajuste de tom com um toque',
  },
  mangaThumbs: {
    zh: '页缩略图、读到哪记住',
    'zh-TW': '頁縮圖、讀到哪記住',
    en: 'Page thumbnails, resume where you left',
    ja: 'ページサムネイル、読んだ位置を記憶',
    de: 'Seitenminiaturen, Leseposition merken',
    fr: 'Miniatures, reprise là où vous étiez',
    es: 'Miniaturas, retoma donde lo dejaste',
    pt: 'Miniaturas, retomar onde parou',
  },
  transChapter: {
    zh: '整章翻译：原文译文对照',
    'zh-TW': '整章翻譯：原文譯文對照',
    en: 'Chapter translation: source and translation side by side',
    ja: '章まるごと翻訳：原文と訳文を並べて',
    de: 'Kapitelübersetzung: Original und Übersetzung nebeneinander',
    fr: 'Traduction de chapitre : original et traduction côte à côte',
    es: 'Traducción de capítulo: original y traducción en paralelo',
    pt: 'Tradução de capítulo: original e tradução lado a lado',
  },
  review: {
    zh: '复习：全文回顾，AI 抽认卡与出题',
    'zh-TW': '複習：全文回顧，AI 抽認卡與出題',
    en: 'Review: reread in full, with AI flashcards and quizzes',
    ja: '復習：全文を振り返り、AI がカードと問題を作成',
    de: 'Wiederholen: den ganzen Text Revue passieren, KI-Karten und Fragen',
    fr: 'Révision : relire en entier, cartes et questions par l’IA',
    es: 'Repaso: releer completo, tarjetas y preguntas con IA',
    pt: 'Revisão: reler inteiro, cartões e questões com IA',
  },
  eink: {
    zh: '墨水屏：黑白更清、翻页不闪',
    'zh-TW': '墨水屏：黑白更清、翻頁不閃',
    en: 'E Ink: crisper black and white, no page-turn flashing',
    ja: 'E Ink：コントラスト向上、ページ切替でちらつかない',
    de: 'E Ink: klareres Schwarzweiß, kein Flackern beim Blättern',
    fr: 'E Ink : noir et blanc plus net, pas de clignotement en tournant',
    es: 'E Ink: blanco y negro más nítido, sin parpadeo al pasar página',
    pt: 'E Ink: preto e branco mais nítido, sem piscar ao virar',
  },
  motion: {
    zh: '界面动效：翻页与切章过渡，可关',
    'zh-TW': '介面動效：翻頁與切章過渡，可關',
    en: 'Interface motion: page turns and chapter changes, can be off',
    ja: 'UI アニメーション：ページ・章の切替演出、オフにもできる',
    de: 'Oberflächen-Animation: Blättern und Kapitelwechsel, abschaltbar',
    fr: 'Animations : changements de page et de chapitre, désactivables',
    es: 'Animación: cambios de página y capítulo, se puede desactivar',
    pt: 'Animação: trocas de página e capítulo, pode ser desligada',
  },
  /* ── 复习段新增四行（2026-11-21） ──
   * 原来「复习」只有路线图里一条总述。功能上线后拆成入口、两种挑法、
   * 已在复习状态四件事，一行只说一件事。 */
  reviewTab: {
    zh: '复习页签：挑内容、制卡、复习都在一起',
    'zh-TW': '複習頁籤：挑內容、製卡、複習都在一起',
    en: 'Review tab: pick, make cards and review in one place',
    ja: '復習タブ：選ぶ・カード作成・復習を 1 か所に',
    de: 'Wiederholen-Tab: auswählen, Karten erstellen und wiederholen an einem Ort',
    fr: 'Onglet Révision : choisir, créer des cartes et réviser au même endroit',
    es: 'Pestaña Repaso: elegir, crear tarjetas y repasar en un solo lugar',
    pt: 'Aba Revisão: escolher, criar cartões e revisar num só lugar',
  },
  reviewMarks: {
    zh: '划线挑重点：整本书的划线交给 AI 挑',
    'zh-TW': '劃線挑重點：整本書的劃線交給 AI 挑',
    en: 'Pick from highlights: hand the book’s highlights to AI',
    ja: 'ハイライトから選ぶ：本のハイライトを AI に渡す',
    de: 'Aus Markierungen wählen: die Markierungen des Buchs an die KI geben',
    fr: 'Choisir parmi les surlignages : confier ceux du livre à l’IA',
    es: 'Elegir entre subrayados: pasar los del libro a la IA',
    pt: 'Escolher entre destaques: entregar os do livro à IA',
  },
  reviewChapter: {
    zh: '按章生成卡片：AI 读正文挑重点',
    'zh-TW': '按章產生卡片：AI 讀正文挑重點',
    en: 'Cards by chapter: AI reads the text and picks key points',
    ja: '章ごとにカード生成：AI が本文を読んで要点を選ぶ',
    de: 'Karten je Kapitel: Die KI liest den Text und wählt Kernpunkte',
    fr: 'Cartes par chapitre : l’IA lit le texte et choisit les points clés',
    es: 'Tarjetas por capítulo: la IA lee el texto y elige lo clave',
    pt: 'Cartões por capítulo: a IA lê o texto e escolhe os pontos-chave',
  },
  reviewPlanned: {
    zh: '已在复习：划线标出，不重复排',
    'zh-TW': '已在複習：劃線標出，不重複排',
    en: 'Already in review: marked on the highlight, never queued twice',
    ja: '復習済み：ハイライトに表示、二重登録なし',
    de: 'Schon in Wiederholung: an der Markierung sichtbar, nie doppelt',
    fr: 'Déjà en révision : signalé sur le surlignage, jamais deux fois',
    es: 'Ya en repaso: marcado en el subrayado, sin duplicar',
    pt: 'Já em revisão: marcado no destaque, sem duplicar',
  },

  /* ── 2026-11-26 新增 14 行 ──
   * 作者逐条挑的「已经能用、但表里没写」的能力。八种语言一次写实，
   * 不留英文占位；行名同样守「窄屏一行放得下」与「不带括号」两条。 */
  shelfEdit: {
    zh: '书籍信息与封面：可改可还原',
    'zh-TW': '書籍資訊與封面：可改可還原',
    en: 'Book info and cover: edit, replace, restore',
    ja: '書誌情報と表紙：編集・差し替え・復元',
    de: 'Buchinfo & Cover: ändern, ersetzen, zurücksetzen',
    fr: 'Infos & couverture : modifier, remplacer, restaurer',
    es: 'Información y portada: editar, cambiar, restaurar',
    pt: 'Informações e capa: editar, trocar, restaurar',
  },
  archive: {
    zh: '归档：移出书架，数据全留',
    'zh-TW': '歸檔：移出書架，資料全留',
    en: 'Archive: off the shelf, data kept',
    ja: 'アーカイブ：本棚から外してもデータは残る',
    de: 'Archiv: vom Regal nehmen, Daten bleiben',
    fr: 'Archives : retirer du rayon, données conservées',
    es: 'Archivo: fuera del estante, datos intactos',
    pt: 'Arquivar: fora da estante, dados mantidos',
  },
  multiShelf: {
    zh: '多分类：一本书归多个分类',
    'zh-TW': '多分類：一本書歸多個分類',
    en: 'Multiple shelves: one book, many categories',
    ja: '複数カテゴリ：1 冊を複数の棚へ',
    de: 'Mehrere Kategorien: ein Buch, viele Regale',
    fr: 'Plusieurs catégories : un livre, plusieurs rayons',
    es: 'Varias categorías: un libro, varios estantes',
    pt: 'Várias categorias: um livro, várias estantes',
  },
  cardTemplates: {
    zh: '书摘卡四版式：经典、信笺、夜读、胶片',
    'zh-TW': '書摘卡四版式：經典、信箋、夜讀、膠片',
    en: 'Four quote-card styles: classic, letter, night, film',
    ja: '引用カード 4 種：クラシック・便箋・夜読・フィルム',
    de: 'Vier Zitatkarten-Stile: klassisch, Brief, Nacht, Film',
    fr: 'Quatre styles de carte citation : classique, lettre, nuit, film',
    es: 'Cuatro estilos de tarjeta: clásico, carta, noche, film',
    pt: 'Quatro estilos de cartão: clássico, carta, noite, filme',
  },
  imageViewer: {
    zh: '插图查看：缩放、拖动、翻页',
    'zh-TW': '插圖檢視：縮放、拖動、翻頁',
    en: 'Image viewer: zoom, pan, flip',
    ja: '画像ビューア：ズーム・移動・めくり',
    de: 'Bildbetrachter: zoomen, verschieben, blättern',
    fr: 'Visionneuse d’images : zoom, déplacement, navigation',
    es: 'Visor de imágenes: zoom, arrastrar, pasar',
    pt: 'Visualizador de imagens: zoom, arrastar, passar',
  },
  immersive: {
    zh: '沉浸模式：藏起上下栏',
    'zh-TW': '沉浸模式：藏起上下欄',
    en: 'Immersive mode: hide the top and bottom bars',
    ja: '没入モード：上下のバーを隠す',
    de: 'Fokusmodus: obere und untere Leiste ausblenden',
    fr: 'Mode immersif : masquer les barres haut et bas',
    es: 'Modo inmersivo: ocultar las barras superior e inferior',
    pt: 'Modo imersivo: ocultar as barras superior e inferior',
  },
  pdfRegion: {
    zh: '框选成图：框一块做成书摘卡',
    'zh-TW': '框選成圖：框一塊做成書摘卡',
    en: 'Region card: frame an area as a quote card',
    ja: '範囲を画像に：囲んだ範囲を引用カードへ',
    de: 'Bereich als Bild: Auswahl als Zitatkarte',
    fr: 'Zone en image : encadrer une zone en carte citation',
    es: 'Zona a imagen: enmarcar un área como tarjeta',
    pt: 'Região em imagem: enquadrar uma área como cartão',
  },
  exportTemplates: {
    zh: '导出模板：四档 + 自定义多行',
    'zh-TW': '匯出模板：四檔 + 自訂多行',
    en: 'Export templates: four presets + custom multiline',
    ja: '書き出しテンプレート：4 種 + カスタム複数行',
    de: 'Exportvorlagen: vier Presets + eigene Mehrzeiler',
    fr: 'Modèles d’export : quatre préréglages + multiligne',
    es: 'Plantillas de exportación: cuatro ajustes + multilínea',
    pt: 'Modelos de exportação: quatro predefinições + multilinha',
  },
  checkin: {
    zh: '每日目标与连续打卡',
    'zh-TW': '每日目標與連續打卡',
    en: 'Daily goal and streak',
    ja: '1 日の目標と連続記録',
    de: 'Tagesziel und Serie',
    fr: 'Objectif quotidien et série',
    es: 'Objetivo diario y racha',
    pt: 'Meta diária e sequência',
  },
  weeklyPoster: {
    zh: '周报长图：一周数据一张图',
    'zh-TW': '週報長圖：一週資料一張圖',
    en: 'Weekly poster: one week in one image',
    ja: '週報画像：1 週間を 1 枚に',
    de: 'Wochenposter: eine Woche auf einem Bild',
    fr: 'Affiche hebdo : une semaine en une image',
    es: 'Póster semanal: una semana en una imagen',
    pt: 'Pôster semanal: uma semana numa imagem',
  },
  backup: {
    zh: '备份与恢复：整份数据带走',
    'zh-TW': '備份與還原：整份資料帶走',
    en: 'Backup and restore: take all your data',
    ja: 'バックアップと復元：データを丸ごと持ち出せる',
    de: 'Sichern und wiederherstellen: alle Daten mitnehmen',
    fr: 'Sauvegarde et restauration : emporter toutes vos données',
    es: 'Copia y restauración: llévate todos tus datos',
    pt: 'Backup e restauração: leve todos os seus dados',
  },
  aiMeta: {
    zh: 'AI 补书目信息：简介、分类自动填',
    'zh-TW': 'AI 補書目資訊：簡介、分類自動填',
    en: 'AI book details: description and categories filled in',
    ja: 'AI 書誌補完：あらすじと分類を自動入力',
    de: 'KI-Buchinfos: Beschreibung und Kategorien automatisch',
    fr: 'Infos de livre par IA : description et catégories remplies',
    es: 'Datos del libro con IA: descripción y categorías',
    pt: 'Informações do livro com IA: descrição e categorias',
  },
  ttsResume: {
    zh: '朗读续听：关掉再开接着听',
    'zh-TW': '朗讀續聽：關掉再開接著聽',
    en: 'Resume listening: pick up where you stopped',
    ja: '読み上げ再開：閉じても続きから',
    de: 'Hörpause fortsetzen: weiter, wo du aufgehört hast',
    fr: 'Reprendre l’écoute : là où vous vous êtes arrêté',
    es: 'Reanudar la escucha: sigue donde lo dejaste',
    pt: 'Retomar a escuta: continue de onde parou',
  },
  ttsCache: {
    zh: '音频缓存：重听不重复合成',
    'zh-TW': '音訊快取：重聽不重複合成',
    en: 'Audio cache: replay without re-synthesizing',
    ja: '音声キャッシュ：聞き直しで再合成しない',
    de: 'Audio-Cache: erneut hören ohne neu zu erzeugen',
    fr: 'Cache audio : réécouter sans resynthétiser',
    es: 'Caché de audio: repetir sin volver a sintetizar',
    pt: 'Cache de áudio: ouvir de novo sem sintetizar',
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

/* ─────────── 分组标题 ───────────
 * 2026-11-21 按作者口径重切：段名压到 2–4 字，每段只回答一个问题——
 * 怎么读、字怎么放、书怎么进来、PDF 怎么读、读完怎么存、怎么复习、
 * 怎么看数据、AI 能做什么、怎么听、以后会做什么。组名同样是界面文案，
 * 走同一套八语言约束，别写回 `data/entitlement.ts`——那里有硬编码中文门禁。 */
const PLAN_GROUP_TEXT: Record<PlanGroupKey, Record<Locale, string>> = {
  /* 书架（2026-11-26）：段名两字，回答「书怎么管」，与「阅读」分开。 */
  shelf: {
    zh: '书架',
    'zh-TW': '書架',
    en: 'Shelf',
    ja: '本棚',
    de: 'Regal',
    fr: 'Rayon',
    es: 'Estante',
    pt: 'Estante',
  },
  read: {
    zh: '阅读',
    'zh-TW': '閱讀',
    en: 'Reading',
    ja: '読書',
    de: 'Lesen',
    fr: 'Lecture',
    es: 'Lectura',
    pt: 'Leitura',
  },
  layout: {
    zh: '排版',
    'zh-TW': '排版',
    en: 'Layout',
    ja: 'レイアウト',
    de: 'Layout',
    fr: 'Mise en page',
    es: 'Diseño',
    pt: 'Diagramação',
  },
  import: {
    zh: '导入',
    'zh-TW': '匯入',
    en: 'Import',
    ja: '取り込み',
    de: 'Import',
    fr: 'Importer',
    es: 'Importar',
    pt: 'Importar',
  },
  /* **不能只写「PDF」**：格式那行里有 PDF 两个字，组名与它撞字时容易被
     当成那一行的一部分；组名带「阅读」二字，且没有任何一行与组名同名。 */
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
  /* 漫画（2026-11-22 独立成段）：段名就「漫画」两个字。
     别写成「漫画模式」——每一行都是漫画，组名再带「模式」只是重复。 */
  manga: {
    zh: '漫画',
    'zh-TW': '漫畫',
    en: 'Manga',
    ja: 'マンガ',
    de: 'Manga',
    fr: 'Manga',
    es: 'Manga',
    pt: 'Mangá',
  },
  /* 段名不能只写「笔记」：PDF 段里有一行「本页反链：笔记引了这页就画出来」，
     组名与行名撞字会被当成那一行的一部分（渲染定位也会错位）。
     2026-11-21 用「笔记与导出」压到 5 字，仍是全表最长的一个段名。 */
  notes: {
    zh: '笔记与导出',
    'zh-TW': '筆記與匯出',
    en: 'Notes & Export',
    ja: 'ノートと書き出し',
    de: 'Notizen & Export',
    fr: 'Notes & export',
    es: 'Notas y exportación',
    pt: 'Notas e exportação',
  },
  /* 复习（2026-11-21）：从路线图转正后独立成段，五项都不设门。 */
  review: {
    zh: '复习',
    'zh-TW': '複習',
    en: 'Review',
    ja: '復習',
    de: 'Wiederholen',
    fr: 'Révision',
    es: 'Repaso',
    pt: 'Revisão',
  },
  /* 统计（2026-11-26）：从「数据」拆出来，回答「读了多少」。 */
  stats: {
    zh: '统计',
    'zh-TW': '統計',
    en: 'Stats',
    ja: '統計',
    de: 'Statistik',
    fr: 'Statistiques',
    es: 'Estadísticas',
    pt: 'Estatísticas',
  },
  data: {
    zh: '数据',
    'zh-TW': '資料',
    en: 'Data',
    ja: 'データ',
    de: 'Daten',
    fr: 'Données',
    es: 'Datos',
    pt: 'Dados',
  },
  ai: {
    /* 段标题只留「AI」：一屏里要一眼看出结构，标题越短越好。 */
    zh: 'AI',
    'zh-TW': 'AI',
    en: 'AI',
    ja: 'AI',
    de: 'KI',
    fr: 'IA',
    es: 'IA',
    pt: 'IA',
  },
  /* 听书（2026-11-14）：不叫「TTS」，那是行内话；用户要的是「能听」。 */
  voice: {
    zh: '听书',
    'zh-TW': '聽書',
    en: 'Listening',
    ja: '聴書',
    de: 'Hören',
    fr: 'Écoute',
    es: 'Escucha',
    pt: 'Escuta',
  },
  roadmap: {
    zh: '路线图',
    'zh-TW': '路線圖',
    en: 'Roadmap',
    ja: 'ロードマップ',
    de: 'Roadmap',
    fr: 'Feuille de route',
    es: 'Hoja de ruta',
    pt: 'Roteiro',
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
