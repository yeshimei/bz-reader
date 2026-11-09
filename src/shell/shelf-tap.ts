/**
 * 分类管理：把「打开」提前到手指抬起的那一刻（2026-11-09）。
 *
 * 为什么需要这一层：分类管理只能从 Obsidian 原生菜单进入
 * （书卡 ⋯ →「归入分类…」→「分类管理 / 新建分类…」）。菜单项的
 * click 回调里 `input.focus()` 在手机上只给光标、不给键盘——宿主那边
 * 的点击在 iOS 上不算「用户亲手操作」，系统拒绝弹软键盘。touchend 才是
 * 真手势。
 *
 * 但「touchend 里只叫键盘」也不行（第一版就是这么写的）：iOS 会先
 * 把页面滚/缩到键盘上方，随后宿主那次 click 落在错位的地方、甚至不再
 * 派发——WebKit r188405 记录过同一现象（于是 r243044 加了「touch 被
 * 页面 preventDefault 才补发键盘信息」的条件）。真机表现就是「键盘闪
 * 一下又收回去，弹窗永远不出来」。
 *
 * 所以现在这一下由我们**接管**：
 *   1. 认出点的是哪个菜单项（见 {@link shelfTapFrom}）；
 *   2. `preventDefault()` 掉默认行为——宿主的 click 不再执行，也就不会
 *      错位；WebKit 那条「handled 才补发键盘信息」的条件同时满足；
 *   3. 回调里自己关菜单、自己打开弹层，并在同一手势栈里把焦点交给输入框。
 * 菜单项的 `onClick` 仍保留给桌面：那边没有触摸，走正常点击。
 *
 * 菜单项由宿主画，我们能控制的只有标题：标题里塞一个带标记的 span，
 * 手指抬起时顺着事件目标找到它，就知道该打开哪一形态。标记不参与视觉。
 *
 * 只负责「认出点的是哪一项」和「绑定/解绑触摸监听」；打开动作由调用点
 * 决定，免得这里反过来依赖壳层状态。
 */
import { TAP_LONG_PRESS_MS, TAP_SLOP_PX, isTap } from '../core/tap';

/** 菜单项标题上的标记属性（值见 {@link ShelfTapTag}） */
export const SHELF_TAP_ATTR = 'data-bzr-shelftap';
/** 从某本书「新建分类…」时带上书 id，建完把书放进去 */
export const SHELF_TAP_BOOK_ATTR = 'data-bzr-book';

/** 手指按下后最多算「没动」的位移（px）——与全站点按判定同一套（core/tap） */
const TAP_SLOP = TAP_SLOP_PX;
/** 按下到抬起超过这么久就不算点选（长按另有意图） */
const TAP_MS = TAP_LONG_PRESS_MS;

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
 * 判定本体在 `core/tap.ts`：位移与时长阈值全站只有一份。
 */
export function isShelfTapStill(
  start: { x: number; y: number; at: number },
  end: { x: number; y: number; at: number },
  maxDist = TAP_SLOP,
): boolean {
  return isTap(start, end, { maxDistance: maxDist, maxMs: TAP_MS });
}

/**
 * 在文档上挂一次触摸识别，点中带标记的菜单项就回调。
 *
 * 用捕获阶段：宿主在菜单项上也有自己的监听，谁先谁后不受我们控制；
 * 捕获从外往里走，能保证在宿主的 click 之前拿到这一下。
 *
 * `touchend` 必须是**非 passive**：document 级的触摸监听在 iOS 上默认
 * 是 passive 的，那种监听里调 `preventDefault()` 是空操作，拦不住宿主
 * 那次 click——真机上就表现为「键盘闪一下、弹窗不出来」。
 *
 * 返回解绑函数，菜单关闭（或下一次打开菜单）时调用，避免监听叠在一起。
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
    if (!tap) return;
    /* 接管这一下：宿主的 click 不能再跑一次——iOS 上键盘弹起会让页面
       移动，那次 click 可能落到别的菜单项上（见文件头）。 */
    e.preventDefault();
    onTap(tap);
  };

  const onCancel = (): void => {
    start = null;
  };

  doc.addEventListener('touchstart', onStart, { capture: true, passive: true });
  doc.addEventListener('touchend', onEnd, { capture: true, passive: false });
  doc.addEventListener('touchcancel', onCancel, { capture: true });
  return () => {
    doc.removeEventListener('touchstart', onStart, { capture: true });
    doc.removeEventListener('touchend', onEnd, { capture: true });
    doc.removeEventListener('touchcancel', onCancel, { capture: true });
  };
}
