/* ============================================================
 * bz-reader · 功能对照表的八语言行名（i18n/plan.ts）
 *
 * 为什么是集中表而不是八份语言包：这 19 行是**成套**的清单，拆进
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
  | 'footnote'
  | 'formats'
  | 'bilink'
  | 'export'
  | 'card'
  | 'stats'
  | 'crossSearch'
  | 'aiSel'
  | 'aiBook'
  | 'vertical'
  | 'tts'
  | 'parallel'
  | 'bookmap'
  | 'vector'
  | 'kb';

const PLAN_TEXT: Record<PlanKey, Record<Locale, string>> = {
  reading: {
    zh: 'EPUB / TXT 阅读、翻页与排版',
    'zh-TW': 'EPUB / TXT 閱讀、翻頁與排版',
    en: 'EPUB / TXT reading, pagination, and typography',
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
    zh: '目录、书签、四色划线与想法',
    'zh-TW': '目錄、書籤、四色劃線與想法',
    en: 'Contents, bookmarks, four-color highlights, and notes',
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
  formats: {
    zh: 'mobi / azw3 / fb2 / 漫画',
    'zh-TW': 'mobi / azw3 / fb2 / 漫畫',
    en: 'mobi / azw3 / fb2 / comics',
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
    zh: '书摘图片',
    'zh-TW': '書摘圖片',
    en: 'Quote card images',
    ja: '引用カード画像',
    de: 'Zitatkarten als Bild',
    fr: 'Images de cartes de citation',
    es: 'Imágenes de tarjetas de cita',
    pt: 'Imagens de cartões de citação',
  },
  stats: {
    zh: '阅读统计、热力图与每本进度',
    'zh-TW': '閱讀統計、熱力圖與每本進度',
    en: 'Reading stats, heatmap, and per-book progress',
    ja: '読書統計・ヒートマップ・本ごとの進捗',
    de: 'Lesestatistik, Heatmap, Fortschritt pro Buch',
    fr: 'Statistiques, carte de chaleur, progression par livre',
    es: 'Estadísticas, mapa de calor y progreso por libro',
    pt: 'Estatísticas, mapa de calor e progresso por livro',
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
    zh: 'AI 解释 / 翻译 / 摘要',
    'zh-TW': 'AI 解釋 / 翻譯 / 摘要',
    en: 'AI explanations / translation / summaries',
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
  vector: {
    zh: '书籍本地化向量检索',
    'zh-TW': '書籍本地化向量檢索',
    en: 'Local vector search over the book',
    ja: '書籍のローカルベクトル検索',
    de: 'Lokale Vektorsuche im Buch',
    fr: 'Recherche vectorielle locale dans le livre',
    es: 'Búsqueda vectorial local en el libro',
    pt: 'Busca vetorial local no livro',
  },
  kb: {
    zh: '连接至 BZ AI 知识库',
    'zh-TW': '連接至 BZ AI 知識庫',
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

/** 测试与自检用：八种语言是否都填了 */
export const PLAN_TEXT_PACK = PLAN_TEXT;
