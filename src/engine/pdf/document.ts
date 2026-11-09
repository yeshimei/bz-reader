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
import { rotateNormRect } from './locator';
import { mapFileAnnots, type PdfFileAnnot } from './annots';
import { labelsFromPdf } from './pagelabels';
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

/** 页面里的一个可点区域（内部链接）。rect 已换成「左上原点、0..1 比例」 */
export interface PdfPageLink {
  rect: { left: number; top: number; width: number; height: number };
  /** 目标页（1 基）；0 = 只有外部 URL，跳不了页 */
  page: number;
  url: string;
}

/** pdf.js 注解的最小面：只取链接需要的四个字段 */
interface PdfAnnotLike {
  subtype?: string;
  rect?: unknown;
  dest?: unknown;
  url?: unknown;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class PdfDocument {
  readonly numPages: number;

  private readonly pages = new Map<number, Promise<unknown>>();
  private readonly texts = new Map<number, string>();
  private readonly sizes = new Map<number, PdfPageSize>();
  private readonly links = new Map<string, PdfPageLink[]>();
  private readonly fileAnnots = new Map<string, PdfFileAnnot[]>();
  private labels: string[] | null | undefined;
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
      /* Obsidian 的 Electron 里 OffscreenCanvas 与 WebCodecs 的 ImageDecoder
         都存在但行为不保证（CSP / GPU 黑名单 / 权限域）。pdf.js 默认会优先
         走它们，失败时整页 render 直接 reject。这里强制退回普通 canvas +
         createImageBitmap，这是 Chromium 里最老、最稳的一条路。 */
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
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
   * 书的页码标签（`/PageLabels`）。
   *
   * 论文常见「前置页 i–xii、正文从 1 重新数」。返回 null = 这本没有页标签
   * （或整本都和物理页号一样），调用方退回物理页号即可。
   */
  async getPageLabels(): Promise<string[] | null> {
    if (this.labels !== undefined) return this.labels;
    try {
      this.labels = labelsFromPdf(await this.pdf.getPageLabels());
    } catch {
      this.labels = null;
    }
    return this.labels;
  }

  /**
   * 文件里自带的标注（别的软件画的高亮、下划线、便签）。
   *
   * 和 `getLinks` 一样按「页 + 旋转角」缓存：`rect` / `quadPoints` 是未旋转的
   * 用户坐标，页面一转，同一份数据算出来的比例就完全不同了。
   */
  async getFileAnnots(page: number, extraRotation = 0): Promise<PdfFileAnnot[]> {
    const n = Math.min(Math.max(1, Math.floor(page)), this.numPages);
    try {
      const p = await this.page(n);
      const rotate = rotationOf(p, extraRotation);
      const key = `${n}@${rotate}`;
      const cached = this.fileAnnots.get(key);
      if (cached) return cached;
      /* 分母用未旋转的 MediaBox：getViewport 的宽高已含 /Rotate，
         拿它当分母会把横置页的标注全部算错位（和链接同一个坑） */
      const box = (p.view as number[]) ?? [0, 0, 612, 792];
      const annots = (await p.getAnnotations({ intent: 'display' })) as unknown[];
      const out = mapFileAnnots(annots, { box, rotation: rotate });
      this.fileAnnots.set(key, out);
      return out;
    } catch {
      return [];
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
    extraRotation = 0,
  ): Promise<PdfRenderTask> {
    const p = await this.page(page);
    /* 高 DPI 走「viewport 直接放大」，不用 render 的 transform 参数：
       transform 会与 pdf.js 内部的 viewport.transform 叠乘，叠错时整页
       空白且不抛错。文字层仍按 cssScale 摆，与 canvas 的 CSS 尺寸对齐。 */
    const rotation = rotationOf(p, extraRotation);
    const base = p.getViewport({ scale: cssScale, rotation });
    /* 画布边长兜底：超过 8192 时 Chromium 会静默不画（或整块变空），
       降低像素倍率比让整页白屏好。 */
    const maxSide = 8192;
    const ratio = Math.max(1, Math.min(Math.max(1, dpr), maxSide / Math.max(1, Math.max(base.width, base.height))));
    const viewport = p.getViewport({ scale: cssScale * ratio, rotation });
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
  async renderTextLayer(
    page: number,
    container: HTMLElement,
    cssScale: number,
    extraRotation = 0,
  ): Promise<void> {
    const lib = await loadPdfjs();
    const p = await this.page(page);
    /* 文字层的旋转必须和 canvas 完全一致，差 90 度就是「字和画错位」 */
    const rotation = rotationOf(p, extraRotation);
    const viewport = p.getViewport({ scale: cssScale, rotation });
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
    return this.renderThumb(1, maxWidth);
  }

  /**
   * 页面里的超链接（目录跳转、交叉引用）。
   *
   * PDF 的 `annot.rect` 是**未旋转**的用户坐标：原点在左下、单位是 pt。
   * 这里换算成「左上原点、0..1 比例」，再按页面实际旋转角转一次，
   * 视图层套百分比就能画。目标页解析失败（外部 URL、坏 dest）返回 page=0。
   */
  async getLinks(page: number, extraRotation = 0): Promise<PdfPageLink[]> {
    const n = Math.min(Math.max(1, Math.floor(page)), this.numPages);
    const out: PdfPageLink[] = [];
    try {
      const p = await this.page(n);
      const rotate = rotationOf(p, extraRotation);
      const key = `${n}@${rotate}`;
      const cached = this.links.get(key);
      if (cached) return cached;
      /* 分母必须用未旋转的 MediaBox/CropBox：getViewport 的宽高已经含 /Rotate，
         拿它当分母会把横置页的链接全部算错位 */
      const box = (p.view as number[]) ?? [0, 0, 612, 792];
      const bw = Math.max(1, box[2] - box[0]);
      const bh = Math.max(1, box[3] - box[1]);
      const annots = (await p.getAnnotations({ intent: 'display' })) as PdfAnnotLike[];
      for (const annot of annots) {
        if (annot?.subtype !== 'Link') continue;
        const r = Array.isArray(annot.rect) ? annot.rect : null;
        if (!r || r.length !== 4) continue;
        const target = await this.resolveLinkPage(annot);
        const url = typeof annot.url === 'string' ? annot.url : '';
        if (!target && !url) continue;
        const [x1, y1, x2, y2] = r.map((v) => Number(v) || 0);
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const bottom = Math.min(y1, y2);
        const top = Math.max(y1, y2);
        const raw = {
          left: (left - box[0]) / bw,
          top: 1 - (top - box[1]) / bh,
          width: (right - left) / bw,
          height: (top - bottom) / bh,
        };
        if (!(raw.width > 0.0005 && raw.height > 0.0005)) continue;
        out.push({ rect: rotateNormRect(raw, rotate), page: target, url });
      }
      this.links.set(key, out);
    } catch {
      /* 链接是锦上添花：解析失败只会少几个热区，不该影响看页 */
    }
    return out;
  }

  /** 链接的 dest 可能是字符串（要再查一次）也可能是数组；解不出返回 0 */
  private async resolveLinkPage(annot: PdfAnnotLike): Promise<number> {
    const dest = annot.dest;
    if (!dest) return 0;
    try {
      const explicit = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || !explicit.length) return 0;
      const ref = explicit[0] as { num?: number; gen?: number } | number | null;
      if (ref && typeof ref === 'object') {
        const index = await this.pdf.getPageIndex(ref as never);
        return Number.isFinite(index) ? index + 1 : 0;
      }
      if (typeof ref === 'number') return Math.max(0, Math.floor(ref) + 1);
    } catch {
      /* 坏的 dest 很常见，静默 */
    }
    return 0;
  }

  /**
   * 高清位图（导出当前页用）。scale 是相对页面原始尺寸的倍数。
   * 和 renderThumb 分开：那个是 JPEG 0.82 的小图，导出的图要存进库里给人看。
   */
  async renderPng(page: number, scale = 2): Promise<Blob | null> {
    try {
      const target = Math.max(1, Math.min(this.numPages, Math.floor(page)));
      const canvas = document.createElement('canvas');
      const task = await this.renderPage(target, canvas, Math.max(0.5, Math.min(4, scale)), 1);
      await task.promise;
      return await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob), 'image/png');
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }

  /** 任意一页的缩略图（悬浮预览用）；取不到返回 null，别把整条链路拖挂 */
  async renderThumb(page: number, maxWidth = 600): Promise<Blob | null> {
    try {
      const target = Math.max(1, Math.min(this.numPages, Math.floor(page)));
      const size = await this.getPageSize(target);
      const scale = Math.min(2, Math.max(0.05, maxWidth / Math.max(1, size.width)));
      const canvas = document.createElement('canvas');
      const task = await this.renderPage(target, canvas, scale, 1);
      await task.promise;
      return await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
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
    this.links.clear();
    this.fileAnnots.clear();
    try {
      await this.pdf.destroy();
    } catch {
      /* 已经销毁过就算了 */
    }
  }
}

/**
 * 页面最终旋转角度 = 文件自带的 `/Rotate` + 用户选的额外角度。
 *
 * pdf.js 的 `getViewport({ rotation })` 是**绝对**角度而不是增量：
 * 直接把用户选的 90 传进去，会把本来就横置的页面掰正（扫描件常见 `/Rotate 90`）。
 */
function rotationOf(page: { rotate?: number }, extra: number): number {
  const base = Number(page?.rotate) || 0;
  const extraSafe = Number(extra) || 0;
  const sum = (base + extraSafe) % 360;
  return sum < 0 ? sum + 360 : sum;
}
