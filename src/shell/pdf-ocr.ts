/* ============================================================
 * bz-reader · 扫描页识别的编排（shell/pdf-ocr.ts）
 *
 * 引擎只会「把一页画成图」「把识别结果铺成文字层」，中间这段归这里：
 * 出图 → 调识别（视觉模型 / 外部 OCR 服务）→ 落盘 → 灌回引擎。
 *
 * 三条设计取舍：
 *  1. **按需、按批**：一次认一页，或从当前页起认 20 页。不默认整本——
 *     视觉识别按页计费，一本 300 页的书一声不吭就烧掉几百次请求不合适。
 *     用户读到哪儿认到哪儿，反而更符合「扫描书」的真实用法。
 *  2. **写盘串行**：识别可以并发取图，但落盘是一条链。同一份 JSON 被两个
 *     并发写覆盖，丢的是一整页的结果。
 *  3. **一页失败不拖垮一批**：记下错误继续下一页，最后统一报一句。
 * ============================================================ */

import type { App } from 'obsidian';
import { recognizeOnPage, recognizeViaHttp, blobToDataUrl, bytesToBase64, mimeOf } from '../data/ai-vision';
import { readOcr, removeOcr, withOcrPage, writeOcr, type OcrFile } from '../data/pdf-ocr';
import type { OcrPage } from '../engine/pdf/ocr';
import { rotateNormRect } from '../engine/pdf/locator';
import { t } from '../i18n';
import type { ReaderSettings } from '../data/settings';
import { pdfOcrEngineOf } from '../data/settings';

/** 一批认多少页 */
export const OCR_BATCH = 20;

/** 出图的目标宽度（像素）。1600 宽对正文页足够，base64 约 200–400 KB */
export const OCR_IMAGE_WIDTH = 1600;

export interface PdfOcrState {
  running: boolean;
  /** 正在认的页（1 基；没在跑是 0） */
  page: number;
  /** 这一批已经处理完的页数 */
  done: number;
  /** 这一批一共几页 */
  total: number;
  /** 这一批里失败的第一条原因（界面上只显示一句） */
  error: string;
}

export const IDLE_OCR_STATE: PdfOcrState = { running: false, page: 0, done: 0, total: 0, error: '' };

/**
 * 这一批要认哪些页。
 *
 * 只看 `from` 往后：扫描书的用法是「读到哪儿认到哪儿」，回绕去补前面的页
 * 会让「从这页起」这个说法变得不成立。已认过的页跳过（除非调用方传空集）。
 */
export function ocrQueue(
  total: number,
  from: number,
  existing: ReadonlySet<number>,
  limit = OCR_BATCH,
): number[] {
  const last = Math.max(0, Math.floor(Number(total) || 0));
  const start = Math.min(last + 1, Math.max(1, Math.floor(Number(from) || 1)));
  /* 注意不能写 `Number(limit) || OCR_BATCH`：limit 传 0 会被当成「没给」，
     于是一次认 20 页——而调用方要的是「至少一页」 */
  const raw = Number(limit);
  const cap = Math.max(1, Math.floor(Number.isFinite(raw) ? raw : OCR_BATCH));
  const out: number[] = [];
  for (let page = start; page <= last && out.length < cap; page += 1) {
    if (existing.has(page)) continue;
    out.push(page);
  }
  return out;
}

/** 引擎该报给界面的那一句话（标题栏 / 提示都能用） */
export function ocrProgressLabel(state: PdfOcrState): string {
  if (!state.running) return '';
  return `${state.done}/${state.total}`;
}

/** 差分引擎：识别结果攒着是要给用户看的，不是给日志看的 */
export function ocrChanged(a: PdfOcrState, b: PdfOcrState): boolean {
  return a.running !== b.running || a.page !== b.page || a.done !== b.done || a.total !== b.total || a.error !== b.error;
}

/**
 * 壳层要的那一小组能力。做成形状而不是直接依赖 PdfEngineHost：
 * 壳层不该认识 PDF 引擎类，EPUB 上这些全是 undefined。
 */
export interface PdfOcrHostLike {
  readonly isScanned: boolean;
  ocrOf(page: number): OcrPage | null;
  ocrStats(): { done: number; total: number };
  applyOcr(pages: Record<string, OcrPage> | null): void;
  applyOcrPage(page: number, ocr: OcrPage | null): void;
  textOfPage(page: number): Promise<string>;
}

export interface PdfOcrDeps {
  app: App | null;
  /** 当前这本书（没开就是 null） */
  book: () => { id: string } | null;
  /** 当前 PDF 宿主（不是 PDF 就是 null） */
  host: () => PdfOcrHostLike | null;
  /** 现取设置：设置页改完不用重开书 */
  settings: () => ReaderSettings;
  /** 出图（一页 → 位图 + 出图时的显示角度 + 像素宽高）。由引擎实现，壳层不认识 pdf.js */
  image: (
    page: number,
    maxWidth: number,
  ) => Promise<{ blob: Blob; rotation: number; width: number; height: number } | null>;
  onProgress?: (state: PdfOcrState) => void;
  notify?: (message: string, kind?: 'info' | 'error' | 'success') => void;
}

/** 一页识别出来的原始结果 → 落盘形状 */
export function toOcrPage(
  parsed: { lines: OcrPage['lines']; layout: boolean; text: string },
  engine: OcrPage['engine'],
  model: string,
): OcrPage {
  const page: OcrPage = { engine, model, at: Date.now(), layout: parsed.layout, lines: parsed.lines };
  if (parsed.text) page.text = parsed.text;
  return page;
}

/**
 * 把「显示方向」量出来的坐标反算回未旋转页面坐标。
 *
 * 出图时视图可能转着 90°（扫描件横着存很常见）。识别结果是在那个方向上量的，
 * 直接存进去的话，用户转回 0° 一看，整页划线是歪的。存统一口径（未旋转），
 * 渲染时再按当前角度转回来——和 `pdf/<页>/r=` 完全一致。
 */
export function unrotateOcrPage(page: OcrPage, rotation: number): OcrPage {
  const deg = (((Math.round((Number(rotation) || 0) / 90) * 90) % 360) + 360) % 360;
  if (!deg) return page;
  return {
    ...page,
    lines: page.lines.map((line) => (line.rect ? { ...line, rect: rotateNormRect(line.rect, -deg) } : line)),
  };
}

export class PdfOcrRunner {
  private state: PdfOcrState = { ...IDLE_OCR_STATE };
  private ctrl: AbortController | null = null;
  /** 这本书的识别结果（内存里一份，避免每页都读盘） */
  private file: OcrFile | null = null;
  private fileBookId = '';
  /** 写盘串行链 */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PdfOcrDeps) {}

  getState(): PdfOcrState {
    return this.state;
  }

  /** 开书：读盘并灌给引擎。已经有识别结果的页立刻能划词 */
  async load(): Promise<OcrFile | null> {
    const book = this.deps.book();
    const host = this.deps.host();
    if (!book) return null;
    if (this.fileBookId !== book.id) {
      this.file = await readOcr(this.deps.app, book.id);
      this.fileBookId = book.id;
    }
    host?.applyOcr(this.file?.pages ?? null);
    return this.file;
  }

  /** 换书：把内存里那份丢掉 */
  reset(): void {
    this.file = null;
    this.fileBookId = '';
    this.state = { ...IDLE_OCR_STATE };
  }

  /** 已经认过的页号集合（算队列用） */
  recognized(): Set<number> {
    return new Set(Object.keys(this.file?.pages ?? {}).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0));
  }

  /** 清掉这本书的识别结果（连引擎里的层一起撤） */
  async clear(): Promise<void> {
    const book = this.deps.book();
    if (!book) return;
    await removeOcr(this.deps.app, book.id);
    this.file = null;
    this.fileBookId = book.id;
    this.deps.host()?.applyOcr(null);
    this.deps.notify?.(t('notice.pdf.ocrCleared'), 'info');
  }

  cancel(): void {
    this.ctrl?.abort();
    this.ctrl = null;
    this.setState({ ...this.state, running: false, page: 0 });
  }

  /**
   * 认一页。返回是否成功。
   *
   * 失败只记原因、不抛：整批跑一半因为第 7 页网络抖一下就全停，
   * 用户还得从头再来一遍。
   */
  async runPage(page: number): Promise<boolean> {
    const host = this.deps.host();
    const book = this.deps.book();
    if (!host || !book) {
      this.deps.notify?.(t('notice.pdf.ocrOnly'), 'info');
      return false;
    }
    const settings = this.deps.settings();
    const engine = pdfOcrEngineOf(settings);
    try {
      const shot = await this.deps.image(page, OCR_IMAGE_WIDTH);
      if (!shot?.blob) throw new Error(t('notice.pdf.ocrNoImage'));
      const blob = shot.blob;
      let ocr: OcrPage;
      if (engine === 'http') {
        const mime = mimeOf(blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const parsed = await recognizeViaHttp({
          url: settings.pdfOcrUrl,
          image: bytesToBase64(bytes),
          mime,
          width: shot.width,
          height: shot.height,
        });
        ocr = unrotateOcrPage(toOcrPage(parsed, 'http', 'http'), shot.rotation);
      } else {
        const image = await blobToDataUrl(blob);
        const parsed = await recognizeOnPage(settings, { image, page });
        ocr = unrotateOcrPage(toOcrPage(parsed, 'vision', settings.ai.model || 'vision'), shot.rotation);
      }
      this.file = withOcrPage(this.file, book.id, page, ocr);
      await this.persist();
      this.deps.host()?.applyOcrPage(page, ocr);
      return true;
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      this.setState({ ...this.state, error: message });
      return false;
    }
  }

  /**
   * 从 `from` 起认一批（默认 20 页）。
   *
   * 已认过的页跳过：用户点第二次不该为同一页再付一次钱。要重认某一页，
   * 用 `runPage`（工具栏那颗「重认本页」）。
   */
  async runBatch(from: number, limit = OCR_BATCH): Promise<void> {
    const host = this.deps.host();
    const book = this.deps.book();
    if (!host || !book) {
      this.deps.notify?.(t('notice.pdf.ocrOnly'), 'info');
      return;
    }
    if (this.state.running) {
      this.deps.notify?.(t('notice.pdf.ocrBusy'), 'info');
      return;
    }
    const total = host.ocrStats().total || 0;
    const queue = ocrQueue(total, from, this.recognized(), limit);
    if (!queue.length) {
      this.deps.notify?.(t('notice.pdf.ocrNothing'), 'info');
      return;
    }
    this.ctrl = new AbortController();
    const ctrl = this.ctrl;
    this.setState({ running: true, page: queue[0]!, done: 0, total: queue.length, error: '' });
    try {
      for (const page of queue) {
        if (ctrl.signal.aborted) break;
        this.setState({ ...this.state, page });
        const ok = await this.runPage(page);
        if (!ok && ctrl.signal.aborted) break;
        this.setState({ ...this.state, done: this.state.done + 1 });
        /* 让出一帧：整批是长任务，不给界面喘气就会「点了没反应、停不下来」 */
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      const failed = this.state.error;
      this.ctrl = null;
      this.setState({ ...this.state, running: false, page: 0 });
      if (ctrl.signal.aborted) this.deps.notify?.(t('notice.pdf.ocrStopped'), 'info');
      else if (failed) this.deps.notify?.(t('notice.pdf.ocrBatchFailed', { why: failed }), 'error');
      else this.deps.notify?.(t('notice.pdf.ocrBatchDone', { n: String(this.state.done) }), 'success');
    }
  }

  private setState(next: PdfOcrState): void {
    if (!ocrChanged(this.state, next)) return;
    this.state = next;
    this.deps.onProgress?.(next);
  }

  /** 落盘串起来：并发的识别结果不能互相覆盖 */
  private persist(): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    const task = this.writing.then(() => writeOcr(this.deps.app, file)).catch(() => undefined);
    this.writing = task;
    return task.then(() => undefined);
  }
}
