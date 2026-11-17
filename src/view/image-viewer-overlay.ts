/* ============================================================
 * bz-reader · 图片放大查看器（view/image-viewer-overlay.ts）
 *
 * 盖在阅读视图上的一层，不是宿主 Modal——它要活在阅读 tab 里，翻页/切书
 * 不该把它带偏。DOM 与手势在这里，纯状态计算在 view/image-viewer.ts。
 *
 * 「操作顺手」是这一版的重点（对照 omnibook 的蹩脚放大）：
 *   - 点空白 / 关闭键 / ESC / 下滑 都能关
 *   - 双击缩放、捏合缩放、放大后拖动
 *   - 左右滑翻上一张 / 下一张（同一章内）
 *   - 复制 / 保存 / 连上 bz 才给的「存为图版」
 * ============================================================ */
import { t } from '../i18n';
import { notify } from '../core/notice';
import { escManager } from '../core/esc-manager';
import {
  clampPan,
  closeOnSwipe,
  nextZoom,
  viewerActions,
  zoomLabel,
  type ViewerState,
} from './image-viewer';

export interface ViewerCallbacks {
  /** 存为图版：给了才显示那颗按钮；返回是否成功由调用方提示 */
  onPlate?: (src: string) => void;
}

/** 当前浮层实例（同时只开一个） */
let active: ImageViewerOverlay | null = null;

/** 关闭当前图片查看器（切书/翻页/退出阅读视图时由 reader-view 调） */
export function closeImageViewer(): void {
  active?.close();
}

export function imageViewerOpen(): boolean {
  return !!active;
}

export class ImageViewerOverlay {
  private root: HTMLElement;
  private img: HTMLImageElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private state: ViewerState;
  private sources: string[];
  private callbacks: ViewerCallbacks;
  private escOff: () => void;
  private closed = false;

  /** 手势临时量 */
  private touchStart: { x: number; y: number } | null = null;
  private pinchStart: { dist: number; zoom: number } | null = null;

  constructor(hostEl: HTMLElement, src: string, images: string[], callbacks: ViewerCallbacks = {}) {
    this.sources = images.length ? images : [src];
    let index = this.sources.indexOf(src);
    if (index < 0) {
      this.sources = [src, ...images];
      index = 0;
    }
    this.state = { index, total: this.sources.length, zoom: 1, panX: 0, panY: 0 };
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'bzr-imgview';
    this.img = document.createElement('img');
    this.img.className = 'bzr-imgview-img';
    this.img.src = src;
    this.img.alt = '';
    this.label = document.createElement('div');
    this.label.className = 'bzr-imgview-label';
    this.bar = document.createElement('div');
    this.bar.className = 'bzr-imgview-bar';
    this.root.appendChild(this.img);
    this.root.appendChild(this.label);
    this.root.appendChild(this.bar);
    hostEl.appendChild(this.root);

    this.bind();
    this.paint();
    const esc = escManager.register('bzr-image-viewer', {
      isVisible: () => !this.closed,
      close: () => this.close(),
    });
    this.escOff = () => esc.unregister();
    active = this;
  }

  private bind(): void {
    /* 点空白关（不是点图本身、不是点按钮） */
    this.root.addEventListener('click', (ev) => {
      const el = ev.target as HTMLElement;
      if (el === this.root || el === this.img) this.close();
    });
    /* 双击缩放 */
    this.img.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      this.state.zoom = nextZoom(this.state.zoom);
      this.state.panX = 0;
      this.state.panY = 0;
      this.paint();
    });
    this.bindTouch();
  }

  private bindTouch(): void {
    this.root.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 2) {
        this.pinchStart = { dist: this.pinchDist(ev), zoom: this.state.zoom };
        this.touchStart = null;
      } else if (ev.touches.length === 1) {
        this.touchStart = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        this.pinchStart = null;
      }
    }, { passive: true });

    this.root.addEventListener('touchmove', (ev) => {
      if (ev.touches.length === 2 && this.pinchStart) {
        ev.preventDefault();
        const ratio = this.pinchDist(ev) / this.pinchStart.dist;
        this.state.zoom = this.pinchStart.zoom * ratio;
        this.paint();
      } else if (ev.touches.length === 1 && this.touchStart && this.state.zoom > 1) {
        ev.preventDefault();
        const dx = ev.touches[0].clientX - this.touchStart.x;
        const dy = ev.touches[0].clientY - this.touchStart.y;
        this.state.panX = clampPan(dx, this.root.clientWidth, this.img.clientWidth);
        this.state.panY = clampPan(dy, this.root.clientHeight, this.img.clientHeight);
        this.paint();
      }
    }, { passive: false });

    this.root.addEventListener('touchend', (ev) => {
      if (ev.changedTouches.length !== 1 || !this.touchStart) {
        this.touchStart = null;
        this.pinchStart = null;
        return;
      }
      const dx = ev.changedTouches[0].clientX - this.touchStart.x;
      const dy = ev.changedTouches[0].clientY - this.touchStart.y;
      this.touchStart = null;
      this.pinchStart = null;
      if (this.state.zoom <= 1 && closeOnSwipe(dx, dy)) {
        this.close();
      } else if (this.state.zoom <= 1 && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) {
        this.step(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  private pinchDist(ev: TouchEvent): number {
    const a = ev.touches[0];
    const b = ev.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  }

  private step(delta: number): void {
    const next = this.state.index + delta;
    if (next < 0 || next >= this.state.total) return;
    this.state.index = next;
    this.state.zoom = 1;
    this.state.panX = 0;
    this.state.panY = 0;
    this.img.src = this.sources[next];
    this.paint();
  }

  private paint(): void {
    const s = this.state;
    this.img.style.setProperty('transform', `translate(${s.panX}px, ${s.panY}px) scale(${s.zoom})`);
    this.label.textContent = `${zoomLabel(s.zoom)}  ·  ${s.index + 1}/${s.total}`;
    this.bar.replaceChildren();
    const acts = viewerActions(s, { bzPlate: !!this.callbacks.onPlate });
    for (const act of acts) {
      const btn = document.createElement('button');
      btn.className = `bzr-imgview-btn is-${act}`;
      btn.appendChild(Object.assign(document.createElement('span'), {
        className: 'bzs-sr-only',
        textContent: this.labelOf(act),
      }));
      btn.textContent = this.labelOf(act);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.act(act);
      });
      this.bar.appendChild(btn);
    }
  }

  private labelOf(act: string): string {
    switch (act) {
      case 'prev': return t('image.prev');
      case 'next': return t('image.next');
      case 'copy': return t('image.copy');
      case 'save': return t('image.save');
      case 'plate': return t('image.plate');
      default: return t('image.close');
    }
  }

  private act(act: string): void {
    if (act === 'close') return this.close();
    if (act === 'prev') return this.step(-1);
    if (act === 'next') return this.step(1);
    const src = this.sources[this.state.index];
    if (act === 'copy') {
      this.copy(src);
    } else if (act === 'save') {
      this.save(src);
    } else if (act === 'plate') {
      this.callbacks.onPlate?.(src);
    }
  }

  private copy(src: string): void {
    const cp = (navigator as Navigator & { clipboard?: { write: (items: ClipboardItem[]) => Promise<void> } }).clipboard;
    if (!cp || typeof ClipboardItem === 'undefined') {
      notify(t('image.copy.failed'), 'error');
      return;
    }
    void fetch(src)
      .then((r) => r.blob())
      .then((blob) => cp.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]))
      .then(() => notify(t('image.copied'), 'info'))
      .catch(() => notify(t('image.copy.failed'), 'error'));
  }

  private save(src: string): void {
    const a = document.createElement('a');
    a.href = src;
    a.download = `bz-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    notify(t('image.saved'), 'info');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.escOff();
    this.root.remove();
    if (active === this) active = null;
  }
}
