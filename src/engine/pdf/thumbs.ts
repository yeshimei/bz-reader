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
}

export class PdfThumbPanel {
  private readonly doc: PdfDocument;
  private readonly opts: PdfThumbPanelOptions;
  private root: HTMLDivElement | null = null;
  private observer: IntersectionObserver | null = null;
  private readonly started = new Set<number>();
  private readonly urls: string[] = [];

  constructor(doc: PdfDocument, opts: PdfThumbPanelOptions) {
    this.doc = doc;
    this.opts = opts;
  }

  get isOpen(): boolean {
    return !!this.root;
  }

  open(host: HTMLElement): void {
    this.close();
    const root = document.createElement('div');
    root.className = 'bzr-pdf-thumbs';

    const head = document.createElement('div');
    head.className = 'bzr-pdf-thumbs-head';
    const title = document.createElement('span');
    title.textContent = this.opts.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bzr-pdf-thumbs-close';
    close.textContent = '×';
    close.setAttribute('aria-label', this.opts.closeLabel);
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.opts.onClose();
    });
    head.append(title, close);

    const grid = document.createElement('div');
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

    const frag = document.createDocumentFragment();
    for (let page = 1; page <= this.doc.numPages; page += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'bzr-pdf-thumb';
      cell.dataset.page = String(page);
      const no = document.createElement('span');
      no.className = 'bzr-pdf-thumb-no';
      no.textContent = String(page);
      const box = document.createElement('span');
      box.className = 'bzr-pdf-thumb-box';
      cell.append(box, no);
      cell.addEventListener('click', () => {
        this.opts.onPick(page);
        this.close();
      });
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
    const img = document.createElement('img');
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
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
  }
}
