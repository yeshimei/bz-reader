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
 * 2026-11-14 重排（作者定稿）：
 *   · 分组从七段改成八段，每段只讲一类事——阅读与书架 / 打开与导入 /
 *     PDF 阅读 / 笔记与导出 / 数据与搜索 / AI / 阅读方式 / 探索中；
 *   · 新增「本页反链」，与「文件自带批注」拆开（两件事、两个开关）；
 *   · 「AI 知识盒」按作者口径改叫「AI 知识库」，小字说清存什么；
 *   · 一批行名补上说明（全书鸟瞰、AI 全书问答、分类管理、并排对照）。
 * ============================================================ */
import { locale, type Locale } from './index';

export type PlanKey =
  /* ── 阅读与书架（免费） ── */
  | 'reading'
  | 'columns'
  | 'marks'
  | 'card'
  | 'inbookSearch'
  | 'back'
  | 'footnote'
  | 'classify'
  /* ── 打开与导入 ── */
  | 'formats'
  | 'clipEpub'
  /* ── PDF 阅读 ── */
  | 'pdfView'
  | 'pdfThumbs'
  | 'pdfLink'
  | 'pdfBacklink'
  | 'pdfAnnots'
  | 'pdfExport'
  /* ── 笔记与导出 ── */
  | 'bilink'
  | 'cites'
  | 'export'
  /* ── 数据与搜索 ── */
  | 'stats'
  | 'poster'
  | 'crossSearch'
  | 'semantic'
  /* ── AI ── */
  | 'aiSel'
  | 'aiBook'
  | 'aiChat'
  | 'kb'
  /* ── 阅读方式 ── */
  | 'vertical'
  | 'tts'
  | 'parallel'
  | 'bookmap'
  /* ── 探索中 ── */
  | 'pdfOcr'
  | 'pdfReflow'
  | 'manga'
  | 'transChapter'
  | 'review'
  | 'eink'
  | 'motion';

/**
 * 分组 id。和 `PlanKey` 是**两套命名空间**：这里是「段」，那里是「行」。
 * 名字刻意不重合，免得代码里 `PLAN_TABLE[0].key` 与 `PLAN_GROUPS[0].key`
 * 读起来像同一个东西。归属关系在 `data/entitlement.ts` 的 PLAN_GROUPS。
 */
export type PlanGroupKey =
  | 'read'
  | 'import'
  | 'pdf'
  | 'notes'
  | 'data'
  | 'ai'
  | 'modes'
  | 'explore';

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
    zh: '数据面板：时长、趋势、节律、书籍明细',
    'zh-TW': '資料面板：時長、趨勢、節律、書籍明細',
    en: 'Stats panel: time, trends, rhythm, per-book detail',
    ja: 'データパネル：時間・推移・リズム・書籍別の内訳',
    de: 'Statistikpanel: Zeit, Verlauf, Rhythmus, Details je Buch',
    fr: 'Panneau de stats : temps, tendances, rythme, détail par livre',
    es: 'Panel de datos: tiempo, tendencias, ritmo, detalle por libro',
    pt: 'Painel de dados: tempo, tendências, ritmo, detalhe por livro',
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
  /* ── AI ── */
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
    zh: 'AI 全书问答：先建索引，再问整本',
    'zh-TW': 'AI 全書問答：先建索引，再問整本',
    en: 'AI Q&A over the whole book: index first, then ask',
    ja: 'AI 全書 Q&A：索引を作ってから本全体に質問',
    de: 'KI: Fragen zum ganzen Buch — erst Index, dann fragen',
    fr: 'Questions IA sur tout le livre : index d’abord, puis questions',
    es: 'Preguntas de IA sobre todo el libro: primero el índice, luego preguntar',
    pt: 'Perguntas de IA sobre o livro inteiro: primeiro o índice, depois perguntar',
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
  /* 2026-11-14：按作者口径，「AI 知识盒」改叫「AI 知识库」；小字说清
     存哪三类（划线、想法、增量阅读），以及提问时会带上笔记。 */
  kb: {
    zh: 'AI 知识库：划线、想法、增量阅读存进去，提问带上笔记',
    'zh-TW': 'AI 知識庫：劃線、想法、增量閱讀存進去，提問帶上筆記',
    en: 'AI knowledge base: highlights, notes and incremental reading go in; answers use your notes',
    ja: 'AI ナレッジベース：ハイライト・メモ・インクリメンタルリーディングを保存、質問時にノートを参照',
    de: 'KI-Wissensbasis: Markierungen, Notizen und inkrementelles Lesen hinein, Antworten mit deinen Notizen',
    fr: 'Base de connaissances IA : surlignages, notes et lecture incrémentale y entrent, les réponses s’appuient dessus',
    es: 'Base de conocimiento IA: subrayados, notas y lectura incremental entran; las respuestas usan tus notas',
    pt: 'Base de conhecimento IA: destaques, notas e leitura incremental entram; as respostas usam suas notas',
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
  /* 朗读：这一行 2026-11-14 仍是高级版（点朗读、逐句高亮、自动翻页、
     导出音频这件在这一版是一整套能力；下放要等朗读增强合入后再谈）。 */
  tts: {
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
  /* ── 探索中（都还没实现，两版都不打勾） ── */
  pdfOcr: {
    zh: 'OCR 扫描件：像文字版一样选、搜、划',
    'zh-TW': 'OCR 掃描件：像文字版一樣選、搜、劃',
    en: 'OCR scans: select, search and highlight like text',
    ja: 'OCR スキャン：テキスト同様に選択・検索・ハイライト',
    de: 'OCR-Scans: auswählen, suchen und markieren wie Text',
    fr: 'OCR : sélectionner, chercher et surligner comme du texte',
    es: 'OCR: seleccionar, buscar y subrayar como texto',
    pt: 'OCR: selecionar, pesquisar e destacar como texto',
  },
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
  manga: {
    zh: '漫画模式：分格、右到左、跨页',
    'zh-TW': '漫畫模式：分格、右到左、跨頁',
    en: 'Manga mode: panels, right-to-left, spreads',
    ja: 'マンガモード：コマ割り・右から左・見開き',
    de: 'Manga-Modus: Panels, rechts nach links, Doppelseiten',
    fr: 'Mode manga : cases, droite à gauche, doubles pages',
    es: 'Modo manga: viñetas, derecha a izquierda, dobles páginas',
    pt: 'Modo mangá: quadros, direita para esquerda, páginas duplas',
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
 * 2026-11-14 按作者口径重切：每段只回答一个问题——基础版够不够、书怎么
 * 进来、PDF 怎么读、读完怎么存、怎么看数据、AI 能做什么、还有哪些读法、
 * 以后会做什么。组名同样是界面文案，走同一套八语言约束，
 * 别写回 `data/entitlement.ts`——那里有硬编码中文门禁。 */
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
  import: {
    zh: '打开与导入',
    'zh-TW': '開啟與匯入',
    en: 'Open & Import',
    ja: '開く・取り込む',
    de: 'Öffnen & Importieren',
    fr: 'Ouvrir & importer',
    es: 'Abrir e importar',
    pt: 'Abrir e importar',
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
  data: {
    zh: '数据与搜索',
    'zh-TW': '資料與搜尋',
    en: 'Data & Search',
    ja: 'データと検索',
    de: 'Daten & Suche',
    fr: 'Données & recherche',
    es: 'Datos y búsqueda',
    pt: 'Dados e busca',
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
  modes: {
    zh: '阅读方式',
    'zh-TW': '閱讀方式',
    en: 'Reading Modes',
    ja: '読み方',
    de: 'Lesarten',
    fr: 'Façons de lire',
    es: 'Formas de leer',
    pt: 'Formas de ler',
  },
  explore: {
    zh: '探索中',
    'zh-TW': '探索中',
    en: 'Explorations',
    ja: '探索中',
    de: 'In Erkundung',
    fr: 'En exploration',
    es: 'En exploración',
    pt: 'Em exploração',
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
