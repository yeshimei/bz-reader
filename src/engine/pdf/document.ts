/* ============================================================
 * bz-reader · PDF 文档封装（engine/pdf/document.ts）
 *
 * 把 pdf.js 的 PDFDocumentProxy 收成「只做 PDF 该做的事」的一层：
 * 页尺寸、页文本、目录、元数据、渲染。视图层不直接碰 pdf.js。
 *
 * 三条约定：
 *  1. **页号一律 1 基**：对外 API 全用 1 基，内部减一。书架的「第几页」、
 *     深链 `#page=12`、状态栏都按人话走，只在 getPage 前 -1。
 *  2. **文本按页缓存**：一页几万字的大页不重复解析；搜索/朗读/导出共用。
 *  3. **渲染可取消**：滚动时旧页的渲染任务必须能 cancel，否则翻得快会
 *     把主线程排满。
 * ============================================================ */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from './pdfjs';
import { mapPdfOutline, synthPdfToc, type PdfTocItem } from './outline';
import { pageTextOf, type PdfTextItemLike } from './text';

export interface PdfPageSize {
  /** 1 缩放下的 CSS 像素宽高（已含页面旋转） */
  width: number;
  height: number;
}

export interface PdfDocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
}

/** pdf.js RenderTask 的最小面：视图层只需要取消与等待 */
export interface PdfRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class PdfDocument {
  readonly numPages: number;

  private readonly pages = new Map<number, Promise<unknown>>();
  private readonly texts = new Map<number, string>();
  private readonly sizes = new Map<number, PdfPageSize>();
  private tocCache: PdfTocItem[] | null = null;
  private metaCache: PdfDocMeta | null = null;
  private destroyed = false;

  private constructor(private readonly pdf: PDFDocumentProxy) {
    this.numPages = pdf.numPages;
  }

  static async load(data: Uint8Array): Promise<PdfDocument> {
    const lib = await loadPdfjs();
    /* data 会被 pdf.js 接管（可能 transfer 走），调用方传进来的必须是副本 */
    const task = lib.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      /* 不指定 cMapUrl / standardFontDataUrl：插件发布只有三件套，
         没有地方放 PDF 的 CMap 与标准字体文件。现代 PDF 带 ToUnicode，
         中文能出字；缺字体时 pdf.js 会退回系统字体并 warn。 */
    });
    const pdf = await task.promise;
    return new PdfDocument(pdf);
  }

  private async page(page: number): Promise<import('pdfjs-dist').PDFPageProxy> {
    const n = Math.min(Math.max(1, Math.floor(page)), this.numPages);
    let hit = this.pages.get(n);
    if (!hit) {
      hit = this.pdf.getPage(n) as Promise<unknown>;
      this.pages.set(n, hit);
    }
    return (await hit) as import('pdfjs-dist').PDFPageProxy;
  }

  async getPageSize(page: number): Promise<PdfPageSize> {
    const n = Math.min(Math.max(1, Math.floor(page)), this.numPages);
    const cached = this.sizes.get(n);
    if (cached) return cached;
    const p = await this.page(n);
    const vp = p.getViewport({ scale: 1 });
    const size = { width: Math.max(1, vp.width), height: Math.max(1, vp.height) };
    this.sizes.set(n, size);
    return size;
  }

  /** 页文本（已归一空白）。失败返回空串：一页解析失败不该拖垮搜索 */
  async getText(page: number): Promise<string> {
    const n = Math.min(Math.max(1, Math.floor(page)), this.numPages);
    const cached = this.texts.get(n);
    if (cached !== undefined) return cached;
    try {
      const p = await this.page(n);
      const content = await p.getTextContent();
      const text = pageTextOf((content?.items ?? []) as PdfTextItemLike[]);
      this.texts.set(n, text);
      return text;
    } catch {
      this.texts.set(n, '');
      return '';
    }
  }

  /** 已解析过的页文本（同步取，供 currentText 用） */
  cachedText(page: number): string {
    return this.texts.get(page) ?? '';
  }

  async getMetadata(): Promise<PdfDocMeta> {
    if (this.metaCache) return this.metaCache;
    let info: Record<string, unknown> = {};
    let metadata: { get?: (key: string) => unknown } | null = null;
    try {
      const got = await this.pdf.getMetadata();
      info = (got?.info ?? {}) as Record<string, unknown>;
      metadata = (got?.metadata ?? null) as { get?: (key: string) => unknown } | null;
    } catch {
      /* 坏元数据不影响打开 */
    }
    const pick = (key: string): string => {
      try {
        return textOf(metadata?.get?.(key));
      } catch {
        return '';
      }
    };
    const meta: PdfDocMeta = {
      title: pick('dc:title') || textOf(info.Title),
      author: pick('dc:creator') || textOf(info.Author),
      subject: pick('dc:description') || textOf(info.Subject),
      keywords: textOf(info.Keywords),
      creator: pick('xmp:CreatorTool') || textOf(info.Creator),
      producer: textOf(info.Producer),
      creationDate: pick('xmp:CreateDate') || textOf(info.CreationDate),
    };
    this.metaCache = meta;
    return meta;
  }

  async getToc(): Promise<PdfTocItem[]> {
    if (this.tocCache) return this.tocCache;
    /** 大纲节点的最小面：dest 指向页，items 是子树 */
    type RawNode = { title?: string; dest?: unknown; items?: RawNode[] };
    let outline: RawNode[] = [];
    try {
      const raw = (await this.pdf.getOutline()) as unknown;
      outline = Array.isArray(raw) ? (raw as RawNode[]) : [];
    } catch {
      outline = [];
    }
    if (!outline.length) {
      this.tocCache = synthPdfToc(this.numPages);
      return this.tocCache;
    }
    /* dest 可能是命名目标（字符串）或 [页引用, ...]，都要异步解析；
       mapPdfOutline 是同步的，所以先把 dest → 页号全部算好。 */
    const resolved = new Map<unknown, number | null>();
    const walk = async (nodes: RawNode[]): Promise<void> => {
      for (const node of nodes) {
        if (node.dest !== undefined && node.dest !== null && !resolved.has(node.dest)) {
          resolved.set(node.dest, await this.resolveDest(node.dest));
        }
        if (node.items?.length) await walk(node.items);
      }
    };
    await walk(outline);
    this.tocCache = mapPdfOutline(outline, (dest) => resolved.get(dest) ?? null);
    return this.tocCache;
  }

  private async resolveDest(dest: unknown): Promise<number | null> {
    try {
      let explicit: unknown[] | null = null;
      if (typeof dest === 'string') explicit = await this.pdf.getDestination(dest);
      else if (Array.isArray(dest)) explicit = dest;
      if (!explicit?.length) return null;
      const index = await this.pdf.getPageIndex(explicit[0] as never);
      return Number.isFinite(index) ? index + 1 : null;
    } catch {
      return null;
    }
  }

  /**
   * 把一页画进 canvas。`cssScale` 是页面在屏幕上的缩放，`dpr` 只用来提
   * 高画布内部分辨率——文字层仍按 cssScale 摆，两者不能混。
   */
  async renderPage(
    page: number,
    canvas: HTMLCanvasElement,
    cssScale: number,
    dpr = 1,
  ): Promise<PdfRenderTask> {
    const p = await this.page(page);
    const ratio = Math.max(1, dpr);
    /* 高 DPI 走「viewport 直接放大」，不用 render 的 transform 参数：
       transform 会与 pdf.js 内部的 viewport.transform 叠乘，叠错时整页
       空白且不抛错。文字层仍按 cssScale 摆，与 canvas 的 CSS 尺寸对齐。 */
    const viewport = p.getViewport({ scale: cssScale * ratio });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.max(1, Math.round(viewport.width / ratio))}px`;
    canvas.style.height = `${Math.max(1, Math.round(viewport.height / ratio))}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 不可用');
    /* 只传 canvasContext（pdf.js 默认 canvas = canvasContext.canvas）。
       多传一个 canvas 参数会让依赖追踪器走另一条分支；foliate 的 PDF
       实现就是只传 canvasContext，这条路径最稳。 */
    const task = p.render({ canvasContext: ctx, viewport } as unknown as Parameters<typeof p.render>[0]);
    return task as unknown as PdfRenderTask;
  }

  /** 在容器里铺透明文字层（选择、搜索高亮、朗读都靠它） */
  async renderTextLayer(page: number, container: HTMLElement, cssScale: number): Promise<void> {
    const lib = await loadPdfjs();
    const p = await this.page(page);
    const viewport = p.getViewport({ scale: cssScale });
    container.style.setProperty('--scale-factor', String(cssScale));
    const layer = new lib.TextLayer({
      textContentSource: await p.getTextContent(),
      container,
      viewport,
    });
    await layer.render();
  }

  /** 封面：首页按宽度缩放的位图。取不到返回 null */
  async renderCover(maxWidth = 600): Promise<Blob | null> {
    try {
      const size = await this.getPageSize(1);
      const scale = Math.min(2, Math.max(0.1, maxWidth / Math.max(1, size.width)));
      const canvas = document.createElement('canvas');
      const task = await this.renderPage(1, canvas, scale, 1);
      await task.promise;
      return await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86);
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pages.clear();
    this.texts.clear();
    this.sizes.clear();
    try {
      await this.pdf.destroy();
    } catch {
      /* 已经销毁过就算了 */
    }
  }
}
