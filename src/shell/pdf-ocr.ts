/* ============================================================
 * bz-reader · 扫描页识别的编排（shell/pdf-ocr.ts）
 *
 * 引擎只会「把一页画成图」「把识别结果铺成文字层」，中间这段归这里：
 * 出图 → 调识别（DeepSeek 官方 OCR / 外部 OCR 服务）→ 落盘 → 灌回引擎。
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
import { recognizeViaHttp, recognizeViaVision, blobToDataUrl, bytesToBase64, mimeOf } from '../data/ai-vision';
import { readOcr, removeOcr, withOcrPage, writeOcr, type OcrFile } from '../data/pdf-ocr';
import type { OcrPage } from '../engine/pdf/ocr';
import { rotateNormRect } from '../engine/pdf/locator';
import { t } from '../i18n';
import type { ReaderSettings } from '../data/settings';
import { pdfOcrEngineOf, pdfOcrReady } from '../data/settings';

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
  /**
   * 还没认成的页（升序去重）。
   *
   * 记下来是为了「点得回去」：批量跑到第 7 页网络抖一下，用户不能只知道
   * 失败了，还得知道是哪几页、能一键重来（头栏「识别」菜单里的那一项）。
   */
  failed: number[];
  /**
   * 上一批是怎么结束的：正常跑完 / 被用户停掉 / 还没跑过。
   *
   * 底部控制条靠它决定终态说什么——「认完 20 页」和「已停止 · 认完 14 页」
   * 是两句不同的话，只靠 `running=false` 分不出来。
   */
  last: 'done' | 'stopped' | '';
}

export const IDLE_OCR_STATE: PdfOcrState = {
  running: false,
  page: 0,
  done: 0,
  total: 0,
  error: '',
  failed: [],
  last: '',
};

/** 往失败表里加一页（升序、去重） */
export function addFailedPage(list: readonly number[], page: number): number[] {
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n) || n < 1) return [...list];
  if (list.includes(n)) return [...list];
  return [...list, n].sort((a, b) => a - b);
}

/**
 * 这一批要认哪些页。
 *
 * 只看 `from` 往后：扫描书的用法是「读到哪儿认到哪儿」，回绕去补前面的页
 * 会让「从这页起」这个说法变得不成立。默认跳过已认过的页；`redo` 为真时
 * 整批重认（已认页也排进队列），但仍受这一批的页数上限约束。
 */
export function ocrQueue(
  total: number,
  from: number,
  existing: ReadonlySet<number>,
  limit = OCR_BATCH,
  redo = false,
): number[] {
  const last = Math.max(0, Math.floor(Number(total) || 0));
  const start = Math.min(last + 1, Math.max(1, Math.floor(Number(from) || 1)));
  /* 注意不能写 `Number(limit) || OCR_BATCH`：limit 传 0 会被当成「没给」，
     于是一次认 20 页——而调用方要的是「至少一页」 */
  const raw = Number(limit);
  const cap = Math.max(1, Math.floor(Number.isFinite(raw) ? raw : OCR_BATCH));
  const out: number[] = [];
  for (let page = start; page <= last && out.length < cap; page += 1) {
    if (!redo && existing.has(page)) continue;
    out.push(page);
  }
  return out;
}

/**
 * 确认弹窗要报的那笔账：这一批覆盖哪几页、已有多少、新的多少，
 * 以及「继续生成」「重新生成」各自会跑哪些页。
 *
 * 范围按真实存在的页算（书末不足 20 页时就是实际页数），两个按钮的
 * 页号都从这里出，弹窗上写的数字和实际跑的页不会各算一套。
 */
export interface OcrScopeStats {
  first: number;
  last: number;
  /** 这一批实际覆盖的页数 */
  total: number;
  existing: number;
  fresh: number;
  continuePages: number[];
  redoPages: number[];
  canContinue: boolean;
  canRedo: boolean;
}

export function ocrScopeStats(
  total: number,
  from: number,
  existing: ReadonlySet<number>,
  limit = OCR_BATCH,
): OcrScopeStats {
  const pages = ocrQueue(total, from, new Set(), limit, true);
  const continuePages = pages.filter((page) => !existing.has(page));
  const already = pages.length - continuePages.length;
  return {
    first: pages[0] ?? 0,
    last: pages[pages.length - 1] ?? 0,
    total: pages.length,
    existing: already,
    fresh: continuePages.length,
    continuePages,
    redoPages: [...pages],
    canContinue: continuePages.length > 0,
    canRedo: already > 0,
  };
}

/**
 * 这一页是不是「认过了还要再认一次」。
 *
 * 认过的页重认会再发一次按页计费的请求，入口又散在菜单、命令、排版面板、
 * 区域工具条好几处，所以判定收在这里，由识别入口统一先问一句。
 */
export function ocrRedoNeedsConfirm(existing: ReadonlySet<number>, page: number): boolean {
  const n = Math.floor(Number(page));
  return Number.isFinite(n) && n >= 1 && existing.has(n);
}

/** 引擎该报给界面的那一句话（标题栏 / 提示都能用） */
export function ocrProgressLabel(state: PdfOcrState): string {
  if (!state.running) return '';
  return `${state.done}/${state.total}`;
}

/**
 * 常驻进度通知那句话（2026-11-15）。
 *
 * 一批 20 页要跑十几秒到几分钟，中途没有任何反馈时用户只会以为「点了没反应」。
 * 不跑就返回空串，调用方据此决定收不收这条通知。
 */
export function ocrProgressText(state: PdfOcrState): string {
  if (!state.running) return '';
  return t('notice.pdf.ocrRunning', {
    page: String(state.page),
    done: String(state.done),
    total: String(state.total),
  });
}

/** 差分引擎：识别结果攒着是要给用户看的，不是给日志看的 */
export function ocrChanged(a: PdfOcrState, b: PdfOcrState): boolean {
  return (
    a.running !== b.running ||
    a.page !== b.page ||
    a.done !== b.done ||
    a.total !== b.total ||
    a.error !== b.error ||
    a.last !== b.last ||
    a.failed.join(',') !== b.failed.join(',')
  );
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
  /* 空白页也落盘（打 empty 标记）：不然下一批又把它排进队列，跑一次失败一次 */
  if (!page.lines.length && !page.text?.trim()) page.empty = true;
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
    /* 没在跑就不动状态：命令面板里那条「停止识别」和底部条的按钮都可能
       在空闲时被点到，以前照样置 last='stopped'，条子会弹「已停止 · 认完 0 页」 */
    if (!this.state.running) return;
    this.ctrl?.abort();
    this.ctrl = null;
    /* `last` 立刻改成 stopped：批量那条 finally 还要等当前这一页收尾，
       条子得马上变成「已停止」，不能等几秒后才动 */
    this.setState({ ...this.state, running: false, page: 0, last: 'stopped' });
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
    /* 配置没齐时先给一句「去哪填」，不要把空请求发出去再让接口报 401 */
    if (!pdfOcrReady(settings)) {
      const message = engine === 'http' ? t('notice.pdf.ocrNoUrl') : t('notice.pdf.ocrNoKey');
      this.setState({ ...this.state, error: message });
      this.deps.notify?.(message, 'info');
      return false;
    }
    const signal = this.ctrl?.signal;
    try {
      const shot = await this.deps.image(page, OCR_IMAGE_WIDTH);
      if (!shot?.blob) throw new Error(t('notice.pdf.ocrNoImage'));
      const blob = shot.blob;
      let ocr: OcrPage;
      if (engine === 'http') {
        const mime = mimeOf(blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const parsed = await recognizeViaHttp({
          url: settings.pdfOcr.url,
          image: bytesToBase64(bytes),
          mime,
          width: shot.width,
          height: shot.height,
          signal,
        });
        ocr = unrotateOcrPage(toOcrPage(parsed, 'http', 'http'), shot.rotation);
      } else {
        /* 看图通道：DeepSeek 的聊天接口能按 prompt 给每行坐标（官方
           `/tools/ocr` 对单页图只回整页一个框，划词做不了）。图片转
           dataURL 后进 `image_url`，与普通问答共用同一个请求层。 */
        const image = await blobToDataUrl(blob);
        const parsed = await recognizeViaVision(
          {
            baseUrl: settings.pdfOcr.baseUrl,
            apiKey: settings.pdfOcr.apiKey,
            model: settings.pdfOcr.model,
          },
          image,
          { signal, timeoutMs: 180_000 },
        );
        ocr = unrotateOcrPage(toOcrPage(parsed, 'deepseek', settings.pdfOcr.model), shot.rotation);
      }
      this.file = withOcrPage(this.file, book.id, page, ocr);
      await this.persist();
      this.deps.host()?.applyOcrPage(page, ocr);
      /* 手动重认成功：这一页从「失败表」里摘掉，菜单上别再喊重试 */
      if (this.state.failed.includes(page)) {
        this.setState({ ...this.state, failed: this.state.failed.filter((n) => n !== page) });
      }
      return true;
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      this.setState({ ...this.state, error: message, failed: addFailedPage(this.state.failed, page) });
      return false;
    }
  }

  /**
   * 从 `from` 起认一批（默认 20 页）：跳过已认页、往后补足页额。
   * 这是命令入口原来的语义；确认卡那条路走 `runPages`（页号说一不二）。
   */
  async runBatch(from: number, limit = OCR_BATCH, redo = false): Promise<boolean> {
    const total = this.deps.host()?.ocrStats().total || 0;
    return this.runPages(ocrQueue(total, from, this.recognized(), limit, redo));
  }

  /**
   * 按给定页号跑一批：确认卡上报了哪几页，实际就跑哪几页。
   *
   * 「继续生成」给的是这批里还没认的页，「重新生成」给的是整批页号
   * （已认页也照认、覆盖）。这里既不往后补页，也不擅自跳过已认页，
   * 免得弹窗写「新 17 页」、后台却跑了 20 页。
   */
  async runPages(pages: readonly number[]): Promise<boolean> {
    if (this.state.running) {
      this.deps.notify?.(t('notice.pdf.ocrBusy'), 'info');
      return false;
    }
    const host = this.deps.host();
    const book = this.deps.book();
    if (!host || !book) {
      this.deps.notify?.(t('notice.pdf.ocrOnly'), 'info');
      return false;
    }
    const total = host.ocrStats().total || 0;
    const queue = [...pages].filter((n) => Number.isInteger(n) && n >= 1 && n <= total);
    if (!queue.length) {
      this.deps.notify?.(t('notice.pdf.ocrNothing'), 'info');
      return false;
    }
    await this.runQueue(queue);
    return true;
  }

  /**
   * 重试上一批没认成的页（头栏「识别」菜单里那一项）。
   *
   * 只认失败的那几页，不重扫整批：重扫等于把已经付过钱的页再付一遍。
   */
  async retryFailed(): Promise<boolean> {
    if (this.state.running) {
      this.deps.notify?.(t('notice.pdf.ocrBusy'), 'info');
      return false;
    }
    if (!this.deps.host() || !this.deps.book()) {
      this.deps.notify?.(t('notice.pdf.ocrOnly'), 'info');
      return false;
    }
    const pages = [...this.state.failed];
    if (!pages.length) {
      this.deps.notify?.(t('notice.pdf.ocrRetryNothing'), 'info');
      return false;
    }
    await this.runQueue(pages);
    return true;
  }

  /** 跑一串页：进度、取消、失败收集都在这里，runBatch 与 retryFailed 共用 */
  private async runQueue(pages: readonly number[]): Promise<void> {
    const queue = [...pages];
    if (!queue.length) return;
    this.ctrl = new AbortController();
    const ctrl = this.ctrl;
    this.setState({
      running: true,
      page: queue[0],
      done: 0,
      total: queue.length,
      error: '',
      failed: [],
      last: '',
    });
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
      const failedPages = this.state.failed;
      const why = this.state.error;
      this.ctrl = null;
      this.setState({
        ...this.state,
        running: false,
        page: 0,
        last: ctrl.signal.aborted ? 'stopped' : 'done',
      });
      /* 进度与结果都交给底部控制条了：这里只留「为什么失败」这种
         条子上放不下的详情，免得每次都弹两条说同一件事 */
      if (!ctrl.signal.aborted && failedPages.length && why) {
        this.deps.notify?.(t('notice.pdf.ocrBatchFailed', { why }), 'error');
      }
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
