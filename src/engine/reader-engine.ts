/* ============================================================
 * bz-reader · 阅读引擎接口（engine/reader-engine.ts）
 *
 * 阅读视图只认这一份接口：EPUB/TXT/CBZ 由 foliate 的 EngineHost 实现，
 * PDF 由 PdfEngineHost 实现。两者的「章节」语义不同（PDF 是页），但对
 * 视图层暴露同一组动作：翻页、跳转、搜索、标注、朗读取文。
 *
 * 这样做的理由：ReaderView 有 40 多处 `this.host.xxx`，把类型收成接口
 * 之后只需在创建处按格式选实现，业务分支能少一半。
 * ============================================================ */

import type { App } from 'obsidian';
import type { BookFormat } from '../data/schema';
import type { ReaderPrefs } from '../data/prefs';
import type { FoliateTOCItem } from '../types/foliate';
import type { HostAnnotation, MountOptions, SearchHit } from './host';
import { EngineHost } from './host';
import { PdfEngineHost } from './pdf/host';

/**
 * 跳转历史（「回到上一处」）。
 *
 * 2026-11-10 起两个引擎都有这条栈：PDF 本来就有（点目录 / 链接之前记一手），
 * EPUB 这次补上同一条。视图层只认这两个方法，不关心栈存在哪。
 *
 * 和 `pdfUi` 同一条约定：**现取，不缓存**——换书后旧对象作废。
 */
export interface HistoryUi {
  /** 回到上一处；没有历史时什么都不做 */
  back(): void;
  /** 有没有可退回的位置（头栏那颗图标据此决定亮不亮） */
  canBack(): boolean;
}

/**
 * PDF 独有的那套动作（头栏四颗图标里的三颗 + 排版面板 + 几条快捷键）。
 *
 * 不塞进 `ReaderEngine` 是因为 EPUB 上这些根本没有对应物：塞进去就得让
 * `EngineHost` 写十几个空实现，读代码的人分不清「没实现」和「故意不实现」。
 * 视图层按 `host.pdfUi?.` 取，没有就是这本不支持。
 *
 * 「回到上一处」曾经在这张表里，现在挪到 `HistoryUi`：EPUB 也要用。
 */
export interface PdfUi {
  rotation(): number;
  spread(): boolean;
  paged(): boolean;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  /** 转到指定角度（0 / 90 / 180 / 270） */
  rotate(deg: number): void;
  setSpread(on: boolean): void;
  setPaged(on: boolean): void;
  /**
   * 头栏「排版」：缩放 / 旋转 / 单双页 / 翻页四行。
   *
   * `anchor` 是那颗按钮的视口矩形（`getBoundingClientRect()`），给了就把
   * 面板贴着它弹；命令面板 / 快捷键 / ⋮ 菜单没有坐标，传 null 回 CSS 兜底位。
   */
  toggleLayout(anchor?: { left: number; top: number; width: number; height: number } | null): void;
  toggleThumbs(): void;
  /** 复制菜单；`anchor` 给了就贴着那颗按钮摆 */
  openCopyMenu(anchor?: { right: number; bottom: number } | null): void;
  exportPage(): void;
  /** 直接产出一条链接（快捷键用，不弹菜单） */
  copyLink(kind: 'page' | 'view' | 'embed' | 'marks'): void;
}

export interface ReaderEngine {
  /** PDF 走另一套渲染；视图层据此隐藏排版面板、改页码文案 */
  readonly isPdf: boolean;
  /**
   * PDF 是不是纯扫描件（首页没有文字层）。
   * 宿主拿它决定要不要先提醒一句「划词和搜索取不到文字」。
   */
  readonly isScanned?: boolean;
  readonly contentVertical: boolean;
  readonly contentRtl: boolean;
  readonly pageKey: string;
  readonly loadPhase: string;
  /** 诊断角标用的链路计数（EPUB 才真正累加；PDF 全 0） */
  readonly probe: { binds: number; taps: number; blocked: number };

  mount(container: HTMLElement, vaultPath: string, opts: MountOptions): Promise<void>;
  start(cfi?: string, fraction?: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goToPercent(fraction: number): Promise<void>;
  goToCfi(cfi: string): Promise<boolean>;
  goToHref(href: string): Promise<void>;
  goToChapter(title: string): Promise<boolean>;
  toc(): FoliateTOCItem[];
  currentChapterHref(): string;
  currentText(): string;
  exportChapters(opts?: {
    onProgress?: (done: number, total: number, title: string) => void;
    shouldStop?: () => boolean;
  }): Promise<Array<{ title: string; text: string }>>;
  search(kw: string, opts?: { shouldStop?: () => boolean }): Promise<SearchHit[]>;
  clearSearch(): void;
  /**
   * 只把词标在页面上，不再扫一遍。
   *
   * 从跨书搜索点一条结果跳过来时用：那一次搜索是在临时的离屏引擎里跑的，
   * 落到手上的书这里什么都没标，用户跳到那一页还得自己找那个词。
   * 只有 PDF 实现（EPUB 走 foliate 自己的 search）。
   * `locator` 是「点中的那一处」：同一页多处命中时，标出来的第一处要是它。
   */
  highlightQuery?(kw: string, locator?: string): void;
  setAnnotations(list: HostAnnotation[]): void;
  clearSelection(): void;
  refreshTheme(): void;
  applyPrefs(prefs: ReaderPrefs): void;
  pulseAt(cfi: string): Promise<void>;
  setViewportWidth(width: number, left?: number): void;
  /**
   * 正文右缘距阅读区右边的距离（px）。沉浸模式右下角的页码贴着这条线走。
   * 只有 EPUB/TXT/CBZ 实现；PDF 没有页码小字，不实现。
   */
  contentRightInset?(): number;
  /** 正文左缘距阅读区左边的距离（px）。沉浸模式左上角的章节名贴着这条线 */
  contentLeftInset?(): number;
  /** PDF 专用：还原上次的旋转角与双页排法。别的引擎不实现 */
  restorePdfView?(state: { rotation?: number; spread?: boolean } | null | undefined): void;
  /** PDF 专用动作集；EPUB/TXT/CBZ 没有 */
  readonly pdfUi?: PdfUi;
  /** 跳转历史。两个引擎都实现（EPUB 2026-11-10 补上） */
  readonly historyUi?: HistoryUi;
  destroy(): Promise<void>;
}

/**
 * 按格式造引擎。
 *
 * pdf.js 本身是懒加载的（见 engine/pdf/pdfjs.ts）：这里的静态 import 只把
 * PDF 宿主的薄壳带进来，EPUB 用户不会付 800KB 的解析钱。
 */
export function createEngine(format: BookFormat, app: App): ReaderEngine {
  return format === 'pdf' ? new PdfEngineHost(app) : new EngineHost(app);
}
