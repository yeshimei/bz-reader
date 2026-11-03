/**
 * 文字浮层的定位串（纯函数，只读 window.innerWidth）。
 *
 * 单独成文件是为了能被 node 里的单测直接 import——overlay.ts 会带进
 * foliate 的 DOM 依赖，测试环境跑不起来。
 */
export function anchoredStyle(a?: { left: number; top: number }): string {
  const vw = window.innerWidth;
  const w = Math.min(360, vw - 24);
  if (!a || (!a.left && !a.top)) return `left:50%;top:72px;width:${w}px;transform:translateX(-50%)`;
  const left = Math.min(vw - w / 2 - 12, Math.max(w / 2 + 12, a.left));
  const above = a.top > 280;
  return `left:${Math.round(left)}px;top:${Math.round(above ? a.top - 14 : a.top + 26)}px;width:${w}px;transform:translate(-50%,${above ? '-100%' : '0'})`;
}
