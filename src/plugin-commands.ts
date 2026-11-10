/* ============================================================
 * bz-reader · 命令注册表（src/plugin-commands.ts）
 *
 * 一张纯数据表：id 是稳定契约，key 是文案入口。分成两边是因为它们的变化
 * 节奏完全不同——id 一旦发出去（用户可能已经绑了快捷键）就再也不能改，
 * 文案却要随界面语言走。
 *
 * 表里只放「注册什么」，不放「怎么执行」：执行分派在 plugin.runCommandById，
 * 因为那需要插件实例。这样表可以在 node 里直接断言，不需要造一个插件。
 * ============================================================ */
import type { MsgKey } from './i18n/zh';
import type { ReaderCommand } from './view/reader-view';

export interface CommandSpec {
  /** Obsidian 命令 id（最终是 `bz-reader:<id>`） */
  id: string;
  /** 界面语言的文案 key */
  key: MsgKey;
  /**
   * 阅读器动作。有它 = 这条命令只在阅读页有意义（没开书时提示先开书）；
   * 没有 = 书架侧命令，随时可跑。
   */
  reader?: ReaderCommand;
}

/**
 * 注册顺序即命令面板里的默认顺序：书架六条在前，阅读相关的在后。
 *
 * 中文名带域前缀（`书架：` / `阅读：`）是原来的口径，语音与肌肉记忆都靠它；
 * 英文用 `Shelf:` / `Reader:` 对应，Obsidian 的搜索按空格分词，搜一个词
 * 就能把同一域的命令全过滤出来。
 */
export const COMMANDS: readonly CommandSpec[] = [
  /* ── 书架 ── */
  { id: 'open', key: 'cmd.open' },
  { id: 'continue', key: 'cmd.continue' },
  { id: 'import', key: 'cmd.import' },
  { id: 'notes', key: 'cmd.notes' },
  { id: 'stats', key: 'cmd.stats' },
  { id: 'prefs', key: 'cmd.prefs' },
  /* 按意思搜全库（2026-11-10）：书架侧命令，随时可跑；没建画像时面板会说明 */
  { id: 'semantic', key: 'cmd.semantic' },
  /* 问这摞书（2026-11-10）：选几本一起问，答案带出处 */
  { id: 'shelf-ask', key: 'cmd.shelfAsk' },
  /* 主题书单（2026-11-11）：给主题，检索找书，模型排路线，可存成笔记 */
  { id: 'route', key: 'cmd.route' },
  /* 写作素材包（2026-11-11）：主题词本地匹配划线，不调 AI */
  { id: 'materials', key: 'cmd.materials' },
  /* ── 阅读 ── */
  { id: 'search', key: 'cmd.search' },
  { id: 'sidebar', key: 'cmd.sidebar' },
  { id: 'page-next', key: 'cmd.pageNext', reader: 'next' },
  { id: 'page-prev', key: 'cmd.pagePrev', reader: 'prev' },
  { id: 'focus', key: 'cmd.focus', reader: 'focus' },
  { id: 'fullscreen', key: 'cmd.fullscreen', reader: 'fullscreen' },
  { id: 'bookmark', key: 'cmd.bookmark', reader: 'bookmark' },
  { id: 'typography', key: 'cmd.typography', reader: 'typography' },
  { id: 'bookmap', key: 'cmd.bookmap', reader: 'bookmap' },
  /* 本章导读（2026-11-11）：读中随手看一眼「这一章要带着什么读」 */
  { id: 'guide', key: 'cmd.guide', reader: 'guide' },
  { id: 'tts', key: 'cmd.tts', reader: 'tts' },
  /* ── PDF 专用 ──
   * 头栏图标与排版面板在手机上会折进 ⋮，命令面板是另一条稳定入口；
   * 放大 / 旋转这类高频动作也值得单独绑键。EPUB 上按下安静退出（见
   * ReaderView.runCommand 的 pdf-* 分流），不弹「不支持」。
   *
   * `pdf-back` 是例外（2026-11-10）：EPUB 也有跳转历史了，这条命令两边都生效。
   * id 仍保留 pdf- 前缀——改名会让用户已经绑好的快捷键静默失效。 */
  { id: 'pdf-zoom-in', key: 'cmd.pdfZoomIn', reader: 'pdf-zoom-in' },
  { id: 'pdf-zoom-out', key: 'cmd.pdfZoomOut', reader: 'pdf-zoom-out' },
  { id: 'pdf-fit-width', key: 'cmd.pdfFitWidth', reader: 'pdf-fit-width' },
  { id: 'pdf-fit-page', key: 'cmd.pdfFitPage', reader: 'pdf-fit-page' },
  { id: 'pdf-rotate', key: 'cmd.pdfRotate', reader: 'pdf-rotate' },
  { id: 'pdf-spread', key: 'cmd.pdfSpread', reader: 'pdf-spread' },
  { id: 'pdf-paged', key: 'cmd.pdfPaged', reader: 'pdf-paged' },
  { id: 'pdf-thumbs', key: 'cmd.pdfThumbs', reader: 'pdf-thumbs' },
  { id: 'pdf-copy-link', key: 'cmd.pdfCopyLink', reader: 'pdf-copy-link' },
  { id: 'pdf-export-page', key: 'cmd.pdfExportPage', reader: 'pdf-export-page' },
  { id: 'pdf-back', key: 'cmd.pdfBack', reader: 'pdf-back' },
  /* 排查用：手机上开不了控制台，这是唯一能把链路计数显示出来的入口。
     会话内生效、不落盘，重启自动关。 */
  { id: 'diag', key: 'cmd.diag' },
];
