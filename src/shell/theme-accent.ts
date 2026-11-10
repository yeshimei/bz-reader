/* ============================================================
 * bz-reader · 壳层强调色（shell/theme-accent.ts）
 *
 * 弹窗挂在 body 上（uiModal），**不在 .bzs-shell 里**，所以拿不到壳层的
 * `--copper` 与 `data-bzaccent` 那套令牌——它们只看到宿主的
 * `--interactive-accent`。表现就是：设置里把强调色切到朱砂、靛蓝，
 * 弹窗还是主题那一抹紫。
 *
 * 这里把那一个值从壳层读出来（壳层已经把档位算成了具体颜色），打开弹窗时
 * 挂到 `--bzs-accent` 上；样式里写 `var(--bzs-accent, <宿主 accent>)`，
 * 读不到就退回宿主色——弹窗在别的宿主环境里也不会变成没颜色的字。
 *
 * 为什么读计算值而不是复制七个档的颜色：一份颜色两个地方写，改一处忘一处
 * 就是下一个人要查半天的「为什么弹窗颜色和设置页对不上」。
 * ============================================================ */

/** 弹窗上承载壳层强调色的变量名（support.css / changelog.css 都读它） */
export const ACCENT_VAR = '--bzs-accent';

/**
 * 当前壳层算出来的强调色（`#9a7434` / `rgb(...)`）。
 *
 * 读不到（没有壳层、没有样式引擎、测试桩）返回空串，调用方据此跳过设置：
 * 样式里的回退值会顶上，不需要在 JS 里再猜一个颜色。
 */
export function shellAccentColor(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string {
  const shell = doc?.querySelector?.<HTMLElement>('.bzs-shell');
  if (!shell) return '';
  if (typeof getComputedStyle !== 'function') return '';
  try {
    return String(getComputedStyle(shell).getPropertyValue('--copper') ?? '').trim();
  } catch {
    /* 宿主换主题会重建样式表，读的瞬间可能抛错：静默回退，不影响弹窗打开 */
    return '';
  }
}
