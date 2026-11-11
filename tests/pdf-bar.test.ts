import { describe, expect, it } from 'vitest';
import { PDF_BAR_ITEMS, PDF_LAYOUT_ROWS, PDF_ZOOM_MODES, zoomTargetPlan } from '../src/engine/pdf/panel';

/**
 * PDF 缩放与排版入口的分工（2026-11-10 真机反馈）。
 *
 * 右下角浮条只该管「放大看细节 + 跳页」；「适合宽度 / 适合页面」当年
 * 挤在浮条里，和头栏「排版」面板里的旋转 / 单双页 / 翻页分家，同一件
 * 版面的事一半在右下、一半在右上。所以：
 *   · 浮条不再有独立的宽 / 页两颗按钮；
 *   · 排版面板第一行就是缩放，三档（宽 / 页 / 实际大小）。
 */
describe('PDF 右下角浮条', () => {
  it('只留缩放三件套 + 页码 + 滑块', () => {
    expect(PDF_BAR_ITEMS).toEqual(['out', 'zoom', 'in', 'pageno', 'range']);
  });

  it('不再有「适合宽度 / 适合页面」两颗独立按钮', () => {
    expect(PDF_BAR_ITEMS).not.toContain('width');
    expect(PDF_BAR_ITEMS).not.toContain('page');
  });
});

describe('PDF 排版面板', () => {
  it('第一行是缩放，后面才是旋转 / 页面 / 翻页', () => {
    expect(PDF_LAYOUT_ROWS).toEqual(['zoom', 'rotate', 'pages', 'flow']);
  });

  it('缩放三档：适合宽度 / 适合页面 / 实际大小', () => {
    expect(PDF_ZOOM_MODES).toEqual(['width', 'page', 'actual']);
  });
});

describe('缩放档落到视图', () => {
  it('适合宽度 / 适合页面：交给适配计算，scale 留空', () => {
    expect(zoomTargetPlan('width')).toEqual({ fitMode: 'width', scale: null });
    expect(zoomTargetPlan('page')).toEqual({ fitMode: 'page', scale: null });
  });

  it('实际大小：直接 100%，且不再被窗口变化抢走', () => {
    expect(zoomTargetPlan('actual')).toEqual({ fitMode: 'none', scale: 1 });
  });
});
