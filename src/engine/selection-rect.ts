/**
 * 选区几何（纯函数）。
 *
 * `range.getClientRects()` 给的是 iframe 自己的坐标，而浮层挂在宿主文档上。
 * 分页时 iframe 会被整体平移、可能还带缩放——不换算就会「和文字差很远」。
 * 这里只做两件事：取所有行的外接矩形 + 乘上 iframe 的位置与缩放。
 *
 * 单独成文件是为了能在 node 里直接测：host.ts 拖进 foliate，测试环境 import 就炸。
 */
export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FrameGeom {
  left: number;
  top: number;
  scale: number;
}

export interface UnionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EMPTY: UnionRect = { left: 0, top: 0, width: 0, height: 0 };

/** 多行矩形 → 宿主坐标里的外接矩形 */
export function unionClientRects(rects: readonly ClientRect[], geom: FrameGeom): UnionRect {
  if (!rects.length) return { ...EMPTY };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return {
    left: geom.left + left * geom.scale,
    top: geom.top + top * geom.scale,
    width: (right - left) * geom.scale,
    height: (bottom - top) * geom.scale,
  };
}
