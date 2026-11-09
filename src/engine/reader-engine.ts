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
  setAnnotations(list: HostAnnotation[]): void;
  clearSelection(): void;
  refreshTheme(): void;
  applyPrefs(prefs: ReaderPrefs): void;
  pulseAt(cfi: string): Promise<void>;
  setViewportWidth(width: number, left?: number): void;
  /** PDF 专用：还原上次的旋转角与双页排法。别的引擎不实现 */
  restorePdfView?(state: { rotation?: number; spread?: boolean } | null | undefined): void;
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
