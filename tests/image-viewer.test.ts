/**
 * 图片查看器的纯逻辑（tests/image-viewer.test.ts）
 *
 * 查看器的 DOM/手势挂真机，状态计算抽纯函数在这里钉死：
 * 缩放档位循环、平移边界、翻图边界、下滑关闭阈值、按钮显隐。
 */
import { describe, expect, it } from 'vitest';
import {
  clampPan,
  closeOnSwipe,
  nextZoom,
  viewerActions,
  zoomLabel,
  type ViewerState,
} from '../src/view/image-viewer';

const base: ViewerState = { index: 0, total: 1, zoom: 1, panX: 0, panY: 0 };

describe('图片查看器', () => {
  it('双击缩放：1 → 2 → 1（不做无限放大）', () => {
    expect(nextZoom(1)).toBe(2);
    expect(nextZoom(2)).toBe(1);
  });

  it('缩放档显示整数百分比', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(2)).toBe('200%');
  });

  it('平移被夹在画面内：内容没放大时不能拖', () => {
    expect(clampPan(999, 1000, 1000)).toBe(0);
    expect(clampPan(-999, 1000, 1000)).toBe(0);
    expect(clampPan(500, 1000, 2000)).toBe(500);
    expect(clampPan(900, 1000, 2000)).toBe(500);
    expect(clampPan(-900, 1000, 2000)).toBe(-500);
  });

  it('下滑关闭：明显向下且比横向为主；小幅移动不算', () => {
    expect(closeOnSwipe(0, 180)).toBe(true);
    expect(closeOnSwipe(20, 180)).toBe(true);
    expect(closeOnSwipe(180, 40)).toBe(false);
    expect(closeOnSwipe(0, 40)).toBe(false);
    expect(closeOnSwipe(0, -180)).toBe(false);
  });

  it('只有一张图时不显示前后翻页', () => {
    const acts = viewerActions({ ...base, total: 1 }, { bzPlate: false });
    expect(acts).toEqual(['copy', 'save', 'close']);
  });

  it('多张图：前翻/后翻按边界显隐', () => {
    expect(viewerActions({ ...base, total: 3 }, { bzPlate: false })).toContain('next');
    expect(viewerActions({ ...base, index: 1, total: 3 }, { bzPlate: false })).toContain('prev');
    expect(viewerActions({ ...base, index: 2, total: 3 }, { bzPlate: false })).not.toContain('next');
    expect(viewerActions({ ...base, index: 0, total: 3 }, { bzPlate: false })).not.toContain('prev');
  });

  it('存为图版：只在 bz 连上时给', () => {
    expect(viewerActions(base, { bzPlate: true })).toContain('plate');
    expect(viewerActions(base, { bzPlate: false })).not.toContain('plate');
  });
});
