/* ============================================================
 * bz-reader · PDF 页缩略图面板（engine/pdf/thumbs.ts）
 *
 * 278 页的扫描书靠滚动条找一页太慢，给一张「页墙」直接点。
 *
 * 性能：不能一开面板就渲染 278 张。这里用 IntersectionObserver 懒加载——
 * 只有滚进可视区的缩略图才真的调 pdf.js 画，画完立刻释放 canvas。
 * ============================================================ */

import type { PdfDocument } from './document';

const THUMB_WIDTH = 120;

export interface PdfThumbPanelOptions {
  /** 点某页：跳过去并关闭面板 */
  onPick(page: number): void;
  /** 点右上角 ×（由宿主决定是收起面板还是整层关闭） */
  onClose(): void;
  label: string;
  closeLabel: string;
  /** 把一页拖出去（拖到笔记里生成链接）。没有就不给拖 */
  onDragPage?(page: number, ev: DragEvent): void;
}

export class PdfThumbPanel {
  private readonly doc: PdfDocument;
  private readonly opts: PdfThumbPanelOptions;
  private root: HTMLDivElement | null = null;
  private observer: IntersectionObserver | null = null;
  private readonly started = new Set<number>();
  private readonly urls: string[] = [];
  /** 当前正在读的页：面板里高亮它，打开时自动滚到它附近 */
  private current = 0;

  constructor(doc: PdfDocument, opts: PdfThumbPanelOptions) {
    this.doc = doc;
    this.opts = opts;
  }

  get isOpen(): boolean {
    return !!this.root;
  }

  /**
   * 跟随阅读位置。
   *
   * 278 页的书打开面板时人在第 150 页，不滚过去的话面板永远停在第 1 页，
   * 每次都要自己翻——「点一下就能跳」的便利等于没有。
   */
  setCurrent(page: number): void {
    const target = Math.max(1, Math.floor(page) || 1);
    if (!this.root || target === this.current) return;
    this.current = target;
    for (const node of Array.from(this.root.querySelectorAll<HTMLElement>('.bzr-pdf-thumb'))) {
      node.classList.toggle('is-current', Number(node.dataset.page) === target);
    }
    const cell = this.root.querySelector<HTMLElement>(`.bzr-pdf-thumb[data-page="${target}"]`);
    const grid = cell?.parentElement;
    if (!cell || !grid) return;
    /* 只在当前页已经滚出可视区时才动滚动条，否则每次翻页面板都跳一下 */
    const top = cell.offsetTop;
    if (top < grid.scrollTop || top + cell.offsetHeight > grid.scrollTop + grid.clientHeight) {
      grid.scrollTop = Math.max(0, top - grid.clientHeight / 3);
    }
  }

  open(host: HTMLElement): void {
    this.close();
    const root = createDiv();
    root.className = 'bzr-pdf-thumbs';

    const head = createDiv();
    head.className = 'bzr-pdf-thumbs-head';
    const title = createSpan();
    title.textContent = this.opts.label;
    const close = createEl('button');
    close.type = 'button';
    close.className = 'bzr-pdf-thumbs-close';
    close.textContent = '×';
    close.setAttribute('aria-label', this.opts.closeLabel);
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.opts.onClose();
    });
    head.append(title, close);

    const grid = createDiv();
    grid.className = 'bzr-pdf-thumbs-grid';

    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (page) void this.fill(page);
          }
        },
        { root: grid, rootMargin: '200px 0px' },
      );
    }

    const frag = createFragment();
    for (let page = 1; page <= this.doc.numPages; page += 1) {
      const cell = createEl('button');
      cell.type = 'button';
      cell.className = 'bzr-pdf-thumb';
      cell.dataset.page = String(page);
      const no = createSpan();
      no.className = 'bzr-pdf-thumb-no';
      no.textContent = String(page);
      const box = createSpan();
      box.className = 'bzr-pdf-thumb-box';
      cell.append(box, no);
      cell.addEventListener('click', () => {
        this.opts.onPick(page);
        this.close();
      });
      /* 拖到笔记里生成一条带页码的链接：拖拽本身由调用方填数据 */
      if (this.opts.onDragPage) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (ev) => this.opts.onDragPage?.(page, ev));
      }
      this.observer?.observe(cell);
      frag.appendChild(cell);
    }
    grid.appendChild(frag);
    root.append(head, grid);
    host.appendChild(root);
    this.root = root;
  }

  private async fill(page: number): Promise<void> {
    if (this.started.has(page)) return;
    this.started.add(page);
    const cell = this.root?.querySelector<HTMLElement>(`.bzr-pdf-thumb[data-page="${page}"]`);
    if (!cell) return;
    const blob = await this.doc.renderThumb(page, THUMB_WIDTH).catch(() => null);
    if (!blob || !this.root) return;
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    const box = cell.querySelector('.bzr-pdf-thumb-box');
    if (!box) return;
    const img = createEl('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    box.replaceChildren(img);
  }

  close(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.root?.remove();
    this.root = null;
    this.started.clear();
    this.current = 0;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
  }
}
