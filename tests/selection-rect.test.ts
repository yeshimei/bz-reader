import { describe, expect, it } from 'vitest';
import { unionClientRects } from '../src/engine/selection-rect';

/**
 * 选区 / 划线可能是多行，贴浮层要用整段的外接矩形：
 *   · 下方贴最后一行的底边，上方贴第一行的顶边；
 *   · 只取第一行会把下面几行盖住。
 * 坐标要按 iframe 在宿主里的位置与缩放换算（分页时 iframe 会被平移/缩放）。
 */
const geom = { left: 10, top: 20, scale: 2 };

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('unionClientRects', () => {
  it('多行取外接矩形，并换算到宿主坐标', () => {
    const out = unionClientRects([rect(0, 0, 100, 20), rect(20, 40, 80, 20)], geom);
    expect(out).toEqual({ left: 10, top: 20, width: 200, height: 120 });
  });

  it('单行原样换算', () => {
    const out = unionClientRects([rect(5, 6, 30, 10)], { left: 0, top: 0, scale: 1 });
    expect(out).toEqual({ left: 5, top: 6, width: 30, height: 10 });
  });

  it('没有矩形时返回零矩形（调用方退回兜底位置）', () => {
    expect(unionClientRects([], geom)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});
