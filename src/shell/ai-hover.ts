/* ============================================================
 * bz-reader · 工具条 AI 的悬停展开（shell/ai-hover.ts）
 *
 * 工具条上那颗 AI 以前只有「点」一条路：点一下才摊开上面那行
 * （解释 / 翻译 / 总结 / 追问 ｜ 插入到全书问答）。桌面上这多了一步，
 * 而那一行本来就摆在光标正上方——鼠标放上去就该出现。
 *
 * 三条硬规矩，全部落在纯函数里，方便单测：
 *   1. 只认真鼠标。手机上轻点也会先发一个 pointerenter，若跟着展开，
 *      「点一下开、再点一下关」就变成一次点击看到两个状态。
 *   2. 悬停只「确保打开」，不做 toggle。鼠标停在同一颗按钮上，
 *      pointerover 会反复进来；toggle 会让菜单自己闪个不停。
 *   3. 没买高级版时什么都不做。点按要弹解锁页是既有设计，
 *      但鼠标扫过去就蹦付费页，是最吓人的一种交互。
 *
 * 计时也在这里：进要有意图延迟（斜穿工具条不该抖出菜单），
 * 出要有宽限（从工具条斜着移进菜单不能算离开）。
 * ============================================================ */

/**
 * 离开「工具条 + 菜单」整块之后给多久宽限。
 *
 * 2026-11-16 作者定：移走就该收。只留这一点点时间跨过工具条与菜单之间
 * 那道 10px 的缝——留长了，人已经去看正文了菜单还挂着。
 */
export const AI_HOVER_GRACE = 110;

/** 进入时要有意图延迟：鼠标斜穿工具条不该把菜单抖出来 */
export const AI_HOVER_DELAY = 140;

/** 可取消的一次性延时（悬停进入用） */
export interface HoverIntent {
  arm(): void;
  cancel(): void;
}

export function makeHoverIntent(onFire: () => void, delay = AI_HOVER_DELAY): HoverIntent {
  let timer: number | null = null;
  const cancel = (): void => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };
  return {
    arm: () => {
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        onFire();
      }, delay);
    },
    cancel,
  };
}

export interface HoverOpenInput {
  /** 这台设备有真鼠标（触屏笔电用触摸时不算） */
  hoverCapable: boolean;
  /** PointerEvent.pointerType：mouse / pen / touch */
  pointerType?: string;
  /** 有没有划词 AI 的能力位 */
  entitled: boolean;
  /** 要问的那段原文 */
  text: string;
}

/** 这一次指针事件算不算「鼠标悬停」 */
export function isMouseHover(pointerType: string | undefined, hoverCapable: boolean): boolean {
  return hoverCapable && pointerType === 'mouse';
}

/** 悬停能不能直接把菜单摊开 */
export function aiHoverOpens(input: HoverOpenInput): boolean {
  return isMouseHover(input.pointerType, input.hoverCapable) && input.entitled && !!input.text.trim();
}

/** 工具条 / 菜单贴着的那个点（宿主视口坐标） */
export interface AiMenuAnchor {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

/**
 * 悬停打开的二级菜单收起来之后，退回哪一层（2026-11-16）。
 *
 * 从划线进来的有 `markId`：原地退回那条工具条，手不用重新找位置，
 * 视觉上也还是「同一处的东西」，不会突然空一块。
 * 从选区进来的没有「工具条这一层」可退——选区本身还在，重新划一下就有，
 * 这时返回 null，由调用方整块关掉。
 */
export function aiMenuFallback(
  o: { markId?: string; bookId?: string; anchor?: AiMenuAnchor } | null | undefined,
): { kind: 'hltools'; markId: string; bookId?: string; anchor?: AiMenuAnchor } | null {
  if (!o?.markId) return null;
  return { kind: 'hltools', markId: o.markId, bookId: o.bookId, anchor: o.anchor };
}

/**
 * 当前环境有没有真鼠标。
 *
 * 用 `(hover: hover) and (pointer: fine)` 而不是 `isMobileEnv()`：
 * 桌面把窗口拖窄、iPad 接鼠标都该按「有没有鼠标」算，
 * 而不是按「屏幕多宽、是不是移动端」算。
 */
export function hoverCapableNow(): boolean {
  try {
    return !!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  } catch {
    return false;
  }
}


