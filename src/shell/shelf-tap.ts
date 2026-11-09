/**
 * 分类管理：把「打开」提前到手指抬起的那一刻（2026-11-09）。
 *
 * 为什么需要这一层：分类管理只能从 Obsidian 原生菜单进入
 * （书卡 ⋯ →「归入分类…」→「分类管理 / 新建分类…」）。菜单项的
 * click 回调里 `input.focus()` 在手机上只给光标、不给键盘——宿主那边
 * 的点击在两端都不算「用户亲手操作」，系统拒绝弹软键盘。touchend 才是
 * 真手势，在这一刻把弹层画出来并聚焦，键盘就跟着起来了。
 *
 * 菜单项由宿主画，我们能控制的只有标题：标题里塞一个带标记的 span，
 * 手指抬起时顺着事件目标找到它，就知道该打开哪一形态。标记不参与视觉。
 *
 * 只负责「认出点的是哪一项」和「绑定/解绑触摸监听」；打开动作由调用点
 * 决定，免得这里反过来依赖壳层状态。
 */

/** 菜单项标题上的标记属性（值见 {@link ShelfTapTag}） */
export const SHELF_TAP_ATTR = 'data-bzr-shelftap';
/** 从某本书「新建分类…」时带上书 id，建完把书放进去 */
export const SHELF_TAP_BOOK_ATTR = 'data-bzr-book';

/** 手指按下后最多算「没动」的位移（px） */
const TAP_SLOP = 10;
/** 按下到抬起超过这么久就不算点选（长按另有意图） */
const TAP_MS = 600;

/** 标记值：打开名单，或从一本书新建 */
export type ShelfTapTag = 'manage' | 'new';

/** 触摸点解析出来的结果 */
export type ShelfTap = { mode: 'manage' } | { mode: 'new'; bookId?: string };

/** 标记值 → 认识的形态；别的值（或空）一律不认 */
export function shelfTapOf(raw: string | null): ShelfTapTag | null {
  return raw === 'manage' || raw === 'new' ? raw : null;
}

function tapOfElement(el: Element): ShelfTap | null {
  const kind = shelfTapOf(el.getAttribute?.(SHELF_TAP_ATTR) ?? null);
  if (kind === 'manage') return { mode: 'manage' };
  if (kind === 'new') {
    return { mode: 'new', bookId: el.getAttribute?.(SHELF_TAP_BOOK_ATTR) || undefined };
  }
  return null;
}

/**
 * 触摸目标 → 该打开哪一种分类管理。
 *
 * 手指可能落在标题文字上，也可能落在左边图标那一侧：后者不在标记
 * 的祖先链里，所以先往上找标记，找不到再回到同一个 `.menu-item` 里
 * 从标题上取。都不是就返回 null，菜单照常交给宿主。
 */
export function shelfTapFrom(target: Element | null): ShelfTap | null {
  if (!target) return null;
  let el: Element | null = target;
  while (el) {
    const hit = tapOfElement(el);
    if (hit) return hit;
    el = el.parentElement;
  }
  const item = target.closest?.('.menu-item') ?? null;
  if (!item) return null;
  const marked = item.querySelector?.(`[${SHELF_TAP_ATTR}]`) ?? null;
  return marked ? tapOfElement(marked) : null;
}

/**
 * 从按下到抬起算不算「点了一下」。
 *
 * 菜单里手指稍微滑一下就松手很常见（想滚动、想取消），不能把这些当成
 * 点中——否则会在用户没想打开的时候把弹层顶出来。长按同理。
 */
export function isShelfTapStill(
  start: { x: number; y: number; at: number },
  end: { x: number; y: number; at: number },
  maxDist = TAP_SLOP,
): boolean {
  if (![start.x, start.y, end.x, end.y, start.at, end.at].every(Number.isFinite)) return false;
  if (end.at - start.at >= TAP_MS) return false;
  return Math.abs(end.x - start.x) < maxDist && Math.abs(end.y - start.y) < maxDist;
}

/**
 * 在文档上挂一次触摸识别，点中带标记的菜单项就回调。
 *
 * 用捕获阶段：宿主在菜单项上也有自己的监听，谁先谁后不受我们控制；
 * 捕获从外往里走，能保证在宿主的 click 之前拿到这一下。返回解绑函数，
 * 菜单关闭（或下一次打开菜单）时调用，避免监听叠在一起。
 */
export function bindShelfTap(doc: Document, onTap: (tap: ShelfTap) => void): () => void {
  let start: { x: number; y: number; at: number } | null = null;

  const onStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) {
      start = null;
      return;
    }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
  };

  const onEnd = (e: TouchEvent): void => {
    const s = start;
    start = null;
    if (!s) return;
    const t = e.changedTouches[0];
    if (!t) return;
    if (!isShelfTapStill(s, { x: t.clientX, y: t.clientY, at: Date.now() })) return;
    const tap = shelfTapFrom(e.target as Element | null);
    if (tap) onTap(tap);
  };

  const onCancel = (): void => {
    start = null;
  };

  doc.addEventListener('touchstart', onStart, { capture: true, passive: true });
  doc.addEventListener('touchend', onEnd, { capture: true });
  doc.addEventListener('touchcancel', onCancel, { capture: true });
  return () => {
    doc.removeEventListener('touchstart', onStart, { capture: true });
    doc.removeEventListener('touchend', onEnd, { capture: true });
    doc.removeEventListener('touchcancel', onCancel, { capture: true });
  };
}

/** 预热后留多少时间给弹层接管焦点；到点还停在这一格就收回去 */
const WARM_GRACE_MS = 600;

/**
 * 一只 1px、透明、不进 Tab 序的输入框——只负责把软键盘叫起来。
 *
 * 不能 display:none（那样焦点拿不到、键盘也不弹）；也不能太显眼。
 * 放在 body 上而不是弹层容器里：弹层每次重画都会整棵换掉 DOM，带着它
 * 一起换会把刚弹起来的键盘又弄丢。
 */
function makeWarmInput(): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.tabIndex = -1;
  el.autocomplete = 'off';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-role', 'bzr-kb-warm');
  el.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;border:0;padding:0;margin:0;font-size:16px;pointer-events:none;';
  return el;
}

/**
 * 在真实手势里先把软键盘叫起来（2026-11-09）。
 *
 * 手机上程序化聚焦只有在「用户手势的同一口气」里才允许弹键盘；宿主菜单的
 * click 回调不算，所以只给光标。手指抬起（touchend）时聚焦这只隐藏输入框，
 * 键盘就起来了；随后宿主的 click 打开分类管理、把焦点交给真正的输入框，
 * 键盘保持不落。用户看到的就是「点一下分类管理，键盘自己弹出来」。
 *
 * 用户中途取消（点了又滑走、或弹层没打开）时，一只键盘举着会挡住菜单：
 * 到点若焦点还在这里就主动 blur 并移除，让它自己落回去。
 */
export function warmKeyboard(): void {
  if (typeof document === 'undefined') return;
  const input = makeWarmInput();
  document.body.appendChild(input);
  input.focus({ preventScroll: true });
  window.setTimeout(() => {
    if (document.activeElement === input) {
      input.blur();
      window.setTimeout(() => input.remove(), 0);
      return;
    }
    input.remove();
  }, WARM_GRACE_MS);
}
