/* ============================================================
 * bz-reader · 脚注浮层（ui/footnote.ts）
 *
 * 点正文里的注释号，在这里把那条注释读给你看，而不是把人甩到书末。
 *
 * 「读完再回来」是判断脚注设计好不好用的唯一标准：
 *   · 浮层贴着注释号，眼睛不用离开原来那一行；
 *   · 定位优先放在注释号**下方**——脚注号都在行内小字上，上方压着的
 *     是这一行正在读的字，往上弹等于遮住他刚读到的地方；
 *   · 内容再长也不改大小：高度封顶 42vh，内部滚动。
 *
 * 和标注浮层的分工：标注是「对这段文字做点什么」，脚注是「这段文字要
 * 告诉我点什么」。前者可编辑，后者只读，所以两套皮、两个文件。
 * ============================================================ */
import type { FootnoteInfo, Rect } from '../engine/host';
import { clear, el } from './dom';

export interface FootnoteDeps {
  onClose: () => void;
  /** 「跳到原文」：把读者送到注释所在的章节位置 */
  onJump: (href: string) => void;
}

export interface FootnoteLayer {
  root: HTMLElement;
  show: (info: FootnoteInfo) => void;
  hide: () => void;
  isOpen: () => boolean;
}

const GAP = 10;

export function createFootnoteLayer(deps: FootnoteDeps): FootnoteLayer {
  const root = el('div', 'bzr-fn');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '注释');

  let card: HTMLElement | null = null;
  let anchorRect: Rect | null = null;

  function place(): void {
    if (!card || !anchorRect) return;
    const frame = root.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const maxLeft = Math.max(GAP, root.clientWidth - w - GAP);
    const left = Math.min(maxLeft, Math.max(GAP, anchorRect.left - frame.left + anchorRect.width / 2 - w / 2));
    let top = anchorRect.top - frame.top + anchorRect.height + GAP;
    // 下方放不下才翻到上面：反过来会让「贴在注释号旁边」变成「压在正在读的那行上」
    if (top + h > root.clientHeight - GAP && anchorRect.top - frame.top - h - GAP > GAP) {
      top = anchorRect.top - frame.top - h - GAP;
    }
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function show(info: FootnoteInfo): void {
    clear(root);
    anchorRect = info.anchor;

    const box = el('div', 'bzr-fn-card');
    const head = el('div', 'bzr-fn-head');
    head.appendChild(el('span', 'bzr-fn-tag', '注释'));
    const close = el('button', 'bzr-fn-x', '×');
    close.type = 'button';
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭注释');
    close.addEventListener('click', () => hide());
    head.appendChild(close);

    const text = el('div', 'bzr-fn-text', info.text);

    const foot = el('div', 'bzr-fn-foot');
    const jump = el('button', 'bzr-fn-btn', '跳到原文');
    jump.type = 'button';
    jump.addEventListener('click', () => {
      const href = info.href;
      hide();
      deps.onJump(href);
    });
    foot.appendChild(jump);

    box.append(head, text, foot);
    box.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    box.addEventListener('click', (ev) => ev.stopPropagation());
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        hide();
      }
    });

    root.appendChild(box);
    card = box;
    root.classList.add('is-open');
    place();
  }

  function hide(): void {
    if (!root.classList.contains('is-open')) return;
    root.classList.remove('is-open');
    clear(root);
    card = null;
    anchorRect = null;
    deps.onClose();
  }

  return {
    root,
    show,
    hide,
    isOpen: () => root.classList.contains('is-open'),
  };
}
