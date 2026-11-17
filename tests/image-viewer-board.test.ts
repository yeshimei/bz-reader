/**
 * 白板式图片查看器的纯计算（tests/image-viewer-board.test.ts）
 *
 * 桌面端交互：滚轮缩放（以鼠标位置为锚点）、按住拖拽平移、不再双击。
 * 这几个算式抽纯函数钉死——锚点算错的表现是「滚轮一滚，图就跑偏」。
 */
import { describe, expect, it } from 'vitest';
import {
  wheelZoom,
  zoomAtPointer,
  freePan,
  needsReset,
  viewerActions,
  type ViewerState,
} from '../src/view/image-viewer';

const base: ViewerState = { index: 0, total: 1, zoom: 1, panX: 0, panY: 0 };

describe('滚轮缩放', () => {
  it('向上滚放大、向下滚缩小，夹在 1×–4×', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
    expect(wheelZoom(0.2, -100)).toBe(1);
    expect(wheelZoom(9, 100)).toBe(4);
  });

  it('以鼠标为锚点：缩放后鼠标下的那一点图片内容不动', () => {
    /* 视口中心 (500,400)，鼠标在 (600,400)，放大前后该点对应的图片坐标要一致。
       图片坐标 = (屏幕点 - 中心 - pan) / zoom。 */
    const zoom = 1;
    const panX = 0;
    const mouseX = 600;
    const centerX = 500;
    const before = (mouseX - centerX - panX) / zoom;
    const next = 2;
    const moved = zoomAtPointer(mouseX, centerX, panX, zoom, next);
    const after = (mouseX - centerX - moved) / next;
    expect(after).toBeCloseTo(before, 5);
  });

  it('放大时 pan 往反方向走（鼠标右侧放大，图往左让）', () => {
    expect(zoomAtPointer(600, 500, 0, 1, 2)).toBeLessThan(0);
    expect(zoomAtPointer(400, 500, 0, 1, 2)).toBeGreaterThan(0);
  });
});

describe('自由拖拽', () => {
  it('白板模式：拖到哪就是哪，不再夹在视口内', () => {
    expect(freePan(0, 100, 200)).toBe(0);
    expect(freePan(9999, 100, 200)).toBe(9999);
    expect(freePan(-9999, 100, 200)).toBe(-9999);
  });

  it('拖过或缩放过才需要「复位」', () => {
    expect(needsReset(base)).toBe(false);
    expect(needsReset({ ...base, panX: 30 })).toBe(true);
    expect(needsReset({ ...base, panY: -20 })).toBe(true);
    expect(needsReset({ ...base, zoom: 2 })).toBe(true);
  });

  it('按钮：有位移时多一颗复位', () => {
    const plain = viewerActions(base, { bzPlate: false });
    const moved = viewerActions({ ...base, zoom: 2 }, { bzPlate: false });
    expect(plain).not.toContain('reset');
    expect(moved).toContain('reset');
  });
});
