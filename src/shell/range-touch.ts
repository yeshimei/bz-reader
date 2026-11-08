/* ============================================================
 * bz-reader · 移动端滑杆的触摸接管（shell/range-touch.ts）
 *
 * 为什么不用原生：`input[type=range]` 在触摸**按下**的瞬间就把值设成
 * 触点位置。设置页往下滚时手指扫过滑轨，页边距/字号就已经被改了
 * （2026-11-08 真机录屏）。`touch-action: pan-y` 这类 CSS 补救实测无效：
 * 值在 touchstart 就变了，轮不到滚动判定。
 *
 * 于是移动端把原生滑块的指针命中关掉（样式见 tokens 的 `.bzs-range`），
 * 由外面那层接手势：
 *   · 按下只记录，一个字节都不改；
 *   · 纵向移出死区 → 放弃本次手势，页面照常滚；
 *   · 横向移出死区 → 从按下时的值开始按位移增减；
 *   · 按下后原地抬起 → 按触点跳值（保留「点轨道」的习惯，但改成抬起才生效）。
 *
 * 桌面端（isMobileShell() 为假）完全不挂，鼠标手感与原生一致。
 * ============================================================ */
import { isMobileShell } from '../core/mobile';
import { decideRangeGesture, rangeValueFromDrag, rangeValueFromPoint } from './range-gesture';

const WRAP_SEL = '.bzs-range';

interface TouchState {
  input: HTMLInputElement;
  pointerId: number;
  startX: number;
  startY: number;
  /** 按下瞬间的值：横向拖动从这里起算，不跟触点位置 */
  startValue: number;
  /** 按下时量到的滑轨几何：拖动途中重绘也不影响换算 */
  left: number;
  width: number;
  dragging: boolean;
}

function rangeArgs(input: HTMLInputElement): { min: number; max: number; step: number } {
  return {
    min: Number(input.getAttribute('min') ?? 0),
    max: Number(input.getAttribute('max') ?? 100),
    step: Number(input.getAttribute('step') ?? 1),
  };
}

/**
 * 在一个容器上接管其中所有 `.bzs-range` 的触摸。
 *
 * 返回解绑函数；桌面端返回空函数。事件委托挂在容器上，容器里的 DOM
 * 重绘多少次都不用重挂；移动/抬起挂在 window 上，手指拖出滑块也不断。
 */
export function bindRangeTouch(root: HTMLElement): () => void {
  if (!isMobileShell()) return () => {};

  const win = root.ownerDocument?.defaultView ?? window;
  let st: TouchState | null = null;

  /** 写值并补一次 input；值没变（吸附回原位）就不派发 */
  const apply = (input: HTMLInputElement, value: number): boolean => {
    if (!Number.isFinite(value)) return false;
    if (Math.abs(input.valueAsNumber - value) < 1e-9) return false;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    const target = e.target as HTMLElement | null;
    const wrap = target?.closest?.(WRAP_SEL);
    if (!wrap || !root.contains(wrap)) return;
    const input = wrap.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input || input.disabled) return;
    const rect = input.getBoundingClientRect();
    st = {
      input,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startValue: input.valueAsNumber,
      left: rect.left,
      width: rect.width,
      dragging: false,
    };
  };

  const onMove = (e: PointerEvent): void => {
    if (!st || e.pointerId !== st.pointerId) return;
    if (!st.dragging) {
      const axis = decideRangeGesture(e.clientX - st.startX, e.clientY - st.startY);
      if (axis === 'pending') return;
      if (axis === 'scroll') {
        /* 页面要滚：这次手势到此为止。浏览器接管后还会补 pointercancel */
        st = null;
        return;
      }
      /* 把判定成功的位置当新起点：死区里的那几像素不折成值 */
      st.startX = e.clientX;
      st.startY = e.clientY;
      st.dragging = true;
      return;
    }
    const { min, max, step } = rangeArgs(st.input);
    apply(st.input, rangeValueFromDrag(st.startValue, e.clientX - st.startX, st.width, min, max, step));
  };

  const onUp = (e: PointerEvent): void => {
    if (!st || e.pointerId !== st.pointerId) return;
    const s = st;
    st = null;
    const { min, max, step } = rangeArgs(s.input);
    if (s.dragging) {
      /* 松手才收口：拖动中走 silent，不整页重绘（P1-09） */
      s.input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    /* 按下后原地抬起：按触点跳值。滚动会被浏览器取消，走不到这里。 */
    const v = rangeValueFromPoint(e.clientX, s.left, s.width, min, max, step);
    if (v === null) return;
    if (apply(s.input, v)) s.input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const onCancel = (e: PointerEvent): void => {
    if (st && e.pointerId === st.pointerId) st = null;
  };

  root.addEventListener('pointerdown', onDown);
  win.addEventListener('pointermove', onMove, { passive: true });
  win.addEventListener('pointerup', onUp);
  win.addEventListener('pointercancel', onCancel);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onCancel);
    st = null;
  };
}
