/* ============================================================
 * bz-reader · 标注浮层（ui/annot.ts）
 *
 * 两块东西，同一套皮：
 *  ① 划完词浮出来的小条：四个色点 + 「想法」；
 *  ② 点中已有划线浮出来的卡片：原文 + 想法输入 + 换色 + 删除。
 *
 * 为什么不做成 Modal / 底部 sheet：划词的位置就是用户眼睛的位置，
 * 让人为了标一句再跑到屏幕另一头去确认，划线这件事就废了。所以它必须
 * 贴在选区上方，两边都不挡正文。
 *
 * 位置用 `transform: translate()` 而不是 top/left：浮层跟着选区挪的时候
 * 只走合成层，不触发布局。engine 给的是宿主视口坐标，这里换成「相对阅读
 * 根节点」的坐标，侧栏开合、页面滚动都不会让它飘走。
 * ============================================================ */
import type { Rect, SelectionInfo } from '../engine/host';
import type { Highlight } from '../data/schema';
import { HIGHLIGHT_COLORS, type HighlightColorName } from '../data/notes';
import { clear, el } from './dom';

export interface AnnotDeps {
  /** 划词条里点了颜色 */
  onCreate: (input: { color: HighlightColorName; comment?: string }) => void;
  onChangeColor: (id: string, color: HighlightColorName) => void;
  onChangeComment: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export interface AnnotLayer {
  root: HTMLElement;
  /** 划词条：贴在选区上方 */
  showForSelection: (sel: SelectionInfo) => void;
  /** 已有划线的卡片 */
  showForHighlight: (highlight: Highlight, anchor: Rect) => void;
  hide: () => void;
  isOpen: () => boolean;
  /** 当前是「卡片」形态（写想法 / 看已有划线），不是那条小色条 */
  isCard: () => boolean;
  /** 直接清空，不回调 onClose（换书、关书时用） */
  reset: () => void;
}

const GAP = 8;

export function createAnnotLayer(deps: AnnotDeps): AnnotLayer {
  const root = el('div', 'bzr-annot');
  root.setAttribute('role', 'dialog');
  let host: HTMLElement | null = null;
  let mode: 'create' | 'edit' | null = null;
  let current: Highlight | null = null;
  let picked: HighlightColorName = 'amber';
  let anchorRect: Rect | null = null;
  let commentTimer: number | null = null;
  /** 当前划词条对应的原文（展开「想法」时要把它显示出来） */
  let selectedText = '';

  const dots = (value: HighlightColorName, onPick: (c: HighlightColorName) => void): HTMLElement => {
    const box = el('div', 'bzr-annot-dots');
    for (const c of HIGHLIGHT_COLORS) {
      const b = el('button', c.value === value ? 'is-on' : '');
      b.type = 'button';
      b.title = c.label;
      b.setAttribute('aria-label', `用${c.label}色标`);
      b.style.setProperty('--c', c.css);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        for (const other of Array.from(box.children)) other.classList.remove('is-on');
        b.classList.add('is-on');
        onPick(c.value);
      });
      box.appendChild(b);
    }
    return box;
  };

  function place(): void {
    if (!host || !anchorRect) return;
    const frame = root.getBoundingClientRect(); // 层铺满阅读区，它的 rect 就是参考系
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    const maxLeft = Math.max(GAP, root.clientWidth - w - GAP);
    const left = Math.min(maxLeft, Math.max(GAP, anchorRect.left - frame.left + anchorRect.width / 2 - w / 2));
    let top = anchorRect.top - frame.top - h - GAP;
    if (top < GAP) top = anchorRect.top - frame.top + anchorRect.height + GAP; // 上方放不下就翻到下面
    host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function mount(node: HTMLElement, kind: 'create' | 'edit'): void {
    clear(root);
    root.appendChild(node);
    host = node;
    mode = kind;
    root.classList.add('is-open'); // 先进 DOM 才能量到尺寸
    place();
  }

  function hide(): void {
    if (!mode) return;
    flushComment();
    reset();
    deps.onClose();
  }

  function reset(): void {
    if (commentTimer !== null) {
      window.clearTimeout(commentTimer);
      commentTimer = null;
    }
    mode = null;
    current = null;
    host = null;
    anchorRect = null;
    clear(root);
    root.classList.remove('is-open', 'is-card');
  }

  /** 想法是边打边存的：用户不会记得点保存，关掉就当没写是最伤的 */
  function flushComment(): void {
    if (commentTimer !== null) {
      window.clearTimeout(commentTimer);
      commentTimer = null;
    }
    const ta = root.querySelector<HTMLTextAreaElement>('textarea.bzr-annot-ta');
    if (!ta || !current) return;
    if (ta.value !== (current.comment ?? '')) deps.onChangeComment(current.id, ta.value);
  }

  /* ── ① 划词条 ── */

  function openSelection(sel: SelectionInfo): void {
    reset();
    selectedText = sel.text;
    anchorRect = sel.anchor;
    picked = 'amber';

    const bar = el('div', 'bzr-annot-bar');
    bar.appendChild(
      dots(picked, (c) => {
        picked = c;
        hide(); // 先收浮层再落数据：落数据会重画覆盖层，浮层还在就会抢焦点
        deps.onCreate({ color: c });
      }),
    );
    bar.appendChild(el('span', 'bzr-annot-sep'));
    const think = el('button', 'bzr-annot-think', '想法');
    think.type = 'button';
    think.addEventListener('click', (ev) => {
      ev.stopPropagation();
      compose();
    });
    bar.appendChild(think);
    bar.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    mount(bar, 'create');
  }

  /** 划词条 → 「写想法」的展开态：同一块浮层里长出输入框，不另开一个 */
  function compose(): void {
    const card = el('div', 'bzr-annot-card');
    const quote = el('blockquote', 'bzr-annot-quote', selectedText);
    const ta = el('textarea', 'bzr-annot-ta');
    ta.placeholder = '写点想法…';
    ta.rows = 3;
    const foot = el('div', 'bzr-annot-foot');
    foot.appendChild(
      dots(picked, (c) => {
        picked = c;
      }),
    );
    foot.appendChild(el('span', 'bzr-annot-sp'));
    const cancel = el('button', 'bzr-annot-btn', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => hide());
    const save = el('button', 'bzr-annot-btn is-primary', '保存');
    save.type = 'button';
    save.addEventListener('click', () => {
      const comment = ta.value;
      const color = picked;
      hide();
      deps.onCreate({ color, comment });
    });
    foot.append(cancel, save);
    card.append(quote, ta, foot);
    card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    card.addEventListener('keydown', (ev) => {
      // 焦点在输入框里时，阅读视图那条全局 ESC 会被「输入中」判据挡掉，
      // 所以这里自己接一次：写想法写到一半想撤，ESC 就该收掉浮层
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        hide();
      }
    });
    mount(card, 'create');
    root.classList.add('is-card');
    window.setTimeout(() => ta.focus(), 0);
  }

  /* ── ② 已有划线的卡片 ── */

  function openHighlight(highlight: Highlight, anchor: Rect): void {
    reset();
    current = highlight;
    anchorRect = anchor;
    picked = (highlight.color as HighlightColorName) ?? 'amber';

    const card = el('div', 'bzr-annot-card');
    const quote = el('blockquote', 'bzr-annot-quote', highlight.text);
    const ta = el('textarea', 'bzr-annot-ta');
    ta.placeholder = '写点想法…';
    ta.rows = 3;
    ta.value = highlight.comment ?? '';
    ta.addEventListener('input', () => {
      if (commentTimer !== null) window.clearTimeout(commentTimer);
      commentTimer = window.setTimeout(() => {
        commentTimer = null;
        if (current) deps.onChangeComment(current.id, ta.value);
      }, 600);
    });

    const foot = el('div', 'bzr-annot-foot');
    foot.appendChild(
      dots(picked, (c) => {
        picked = c;
        deps.onChangeColor(highlight.id, c);
      }),
    );
    foot.appendChild(el('span', 'bzr-annot-sp'));
    const del = el('button', 'bzr-annot-btn is-danger', '删除');
    del.type = 'button';
    del.addEventListener('click', () => {
      const id = highlight.id;
      hide();
      deps.onRemove(id);
    });
    foot.appendChild(del);
    card.append(quote, ta, foot);
    card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        hide();
      }
    });
    mount(card, 'edit');
    root.classList.add('is-card');
  }

  return {
    root,
    showForSelection: openSelection,
    showForHighlight: openHighlight,
    hide,
    isOpen: () => mode !== null,
    isCard: () => root.classList.contains('is-card'),
    reset,
  };
}
