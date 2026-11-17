/* ============================================================
 * bz-reader · 图片放大查看器（view/image-viewer-overlay.ts）
 *
 * 盖在阅读视图上的一层，不是宿主 Modal——它要活在阅读 tab 里，翻页/切书
 * 不该把它带偏。DOM 与手势在这里，纯状态计算在 view/image-viewer.ts。
 *
 * 「操作顺手」是这一版的重点（对照 omnibook 的蹩脚放大）：
 *   - 桌面白板式：滚轮缩放（以鼠标为锚点）、按住拖拽平移；不做双击
 *     （双击时第一次点就关层，是 1.0 的真机 bug，已去掉）
 *   - 手机：双指捏合、按住拖动、下滑关闭、左右滑翻图
 *   - 点图片本身不关；点空白 / 关闭键 / ESC / 下滑 都能关
 *   - 复制 / 保存 / 复位 / 连上 bz 才给的「存为图版」
 * ============================================================ */
import { t } from '../i18n';
import { notify } from '../core/notice';
import { escManager } from '../core/esc-manager';
import {
  closeOnSwipe,
  freePan,
  viewerActions,
  wheelZoom,
  zoomAtPointer,
  zoomLabel,
  type ViewerState,
} from './image-viewer';

export interface ViewerCallbacks {
  /** 存为图版：给了才显示那颗按钮；返回是否成功由调用方提示 */
  onPlate?: (src: string) => void;
  /** 复制降级：环境不支持 ClipboardItem 时，由调用方把图存进库并复制链接 */
  onCopy?: (src: string) => Promise<boolean>;
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
  /** 鼠标拖拽（桌面白板）：按下时的起点 + 当时的平移量 */
  private dragStart: { x: number; y: number; panX: number; panY: number } | null = null;

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
    /* 点空白关：点图片本身不关（桌面要在图上拖，手机点图也是看细节）。
       按钮自己 stopPropagation，不会被这里误关。 */
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    /* 桌面白板：滚轮缩放（以鼠标为锚点）+ 按住拖拽平移。
       不做双击——第一次点在这里是拖拽起点，不该把层关掉。 */
    this.root.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const from = this.state.zoom;
      const to = wheelZoom(from, ev.deltaY);
      if (to === from) return;
      const rect = this.root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      this.state.panX = zoomAtPointer(ev.clientX, cx, this.state.panX, from, to);
      this.state.panY = zoomAtPointer(ev.clientY, cy, this.state.panY, from, to);
      this.state.zoom = to;
      this.paint();
    }, { passive: false });

    this.img.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      this.dragStart = { x: ev.clientX, y: ev.clientY, panX: this.state.panX, panY: this.state.panY };
    });
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.bindTouch();
  }

  /** 鼠标拖拽：拖到哪就是哪（白板，不夹在视口内） */
  private onMouseMove = (ev: MouseEvent): void => {
    if (!this.dragStart) return;
    const dx = ev.clientX - this.dragStart.x;
    const dy = ev.clientY - this.dragStart.y;
    this.state.panX = freePan(this.dragStart.panX + dx, this.root.clientWidth, this.img.clientWidth);
    this.state.panY = freePan(this.dragStart.panY + dy, this.root.clientHeight, this.img.clientHeight);
    this.paint();
  };

  private onMouseUp = (): void => {
    this.dragStart = null;
  };

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
      } else if (ev.touches.length === 1 && this.touchStart) {
        /* 手机也跟桌面一样自由拖（白板）——不过 100% 时优先留给下滑关闭 /
           左右翻图，所以只有放大后才吞掉这一下手势。 */
        if (this.state.zoom > 1) {
          ev.preventDefault();
          const dx = ev.touches[0].clientX - this.touchStart.x;
          const dy = ev.touches[0].clientY - this.touchStart.y;
          this.state.panX = freePan(dx, this.root.clientWidth, this.img.clientWidth);
          this.state.panY = freePan(dy, this.root.clientHeight, this.img.clientHeight);
          this.paint();
        }
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
      case 'reset': return t('image.reset');
      default: return t('image.close');
    }
  }

  private act(act: string): void {
    if (act === 'close') return this.close();
    if (act === 'prev') return this.step(-1);
    if (act === 'next') return this.step(1);
    if (act === 'reset') {
      this.state.zoom = 1;
      this.state.panX = 0;
      this.state.panY = 0;
      this.paint();
      return;
    }
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
    /* Obsidian 这个环境常没有 ClipboardItem（真机实测报「不支持复制图片」）：
       降级给调用方存进库 + 复制链接，别让用户对着报错干瞪眼。 */
    if (!cp || typeof ClipboardItem === 'undefined') {
      if (this.callbacks.onCopy) {
        void this.callbacks.onCopy(src).then((ok) => {
          notify(ok ? t('image.copy.link') : t('image.copy.failed'), ok ? 'info' : 'error');
        });
      } else {
        notify(t('image.copy.failed'), 'error');
      }
      return;
    }
    void fetch(src)
      .then((r) => r.blob())
      .then((blob) => cp.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]))
      .then(() => notify(t('image.copied'), 'info'))
      .catch(() => {
        if (this.callbacks.onCopy) {
          void this.callbacks.onCopy(src).then((ok) => {
            notify(ok ? t('image.copy.link') : t('image.copy.failed'), ok ? 'info' : 'error');
          });
        } else {
          notify(t('image.copy.failed'), 'error');
        }
      });
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
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.root.remove();
    if (active === this) active = null;
  }
}
