import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, normalizePrefs } from '../src/data/prefs';
import { resolveInitialZoom } from '../src/engine/pdf/fit';

describe('PDF 组的默认值', () => {
  it('没存过时给出「自动缩放 / 显示批注 / 高亮反链 / 2 倍导出」', () => {
    expect(DEFAULT_PREFS.pdfZoom).toBe('auto');
    expect(DEFAULT_PREFS.pdfAnnots).toBe(true);
    expect(DEFAULT_PREFS.pdfBacklinks).toBe(true);
    expect(DEFAULT_PREFS.pdfExportScale).toBe(2);
  });

  it('空输入保留默认', () => {
    const p = normalizePrefs({});
    expect(p.pdfZoom).toBe('auto');
    expect(p.pdfAnnots).toBe(true);
    expect(p.pdfBacklinks).toBe(true);
    expect(p.pdfExportScale).toBe(2);
  });
});

describe('PDF 组的值校验', () => {
  it('缩放档只认四个合法值，其余回落自动', () => {
    expect(normalizePrefs({ pdfZoom: 'width' }).pdfZoom).toBe('width');
    expect(normalizePrefs({ pdfZoom: 'page' }).pdfZoom).toBe('page');
    expect(normalizePrefs({ pdfZoom: 'actual' }).pdfZoom).toBe('actual');
    expect(normalizePrefs({ pdfZoom: 'zoom' as never }).pdfZoom).toBe('auto');
  });

  it('两个开关只认显式 false，脏值当作开着', () => {
    expect(normalizePrefs({ pdfAnnots: false }).pdfAnnots).toBe(false);
    expect(normalizePrefs({ pdfAnnots: 'no' as never }).pdfAnnots).toBe(true);
    expect(normalizePrefs({ pdfBacklinks: false }).pdfBacklinks).toBe(false);
    expect(normalizePrefs({ pdfBacklinks: 0 as never }).pdfBacklinks).toBe(true);
  });

  it('导出倍率被夹在 1～3 且取整', () => {
    expect(normalizePrefs({ pdfExportScale: 3 }).pdfExportScale).toBe(3);
    expect(normalizePrefs({ pdfExportScale: 0 }).pdfExportScale).toBe(1);
    expect(normalizePrefs({ pdfExportScale: 9 }).pdfExportScale).toBe(3);
    expect(normalizePrefs({ pdfExportScale: 2.4 }).pdfExportScale).toBe(2);
  });
});

describe('resolveInitialZoom', () => {
  it('自动：窄屏才适合宽度，宽屏按原大', () => {
    expect(resolveInitialZoom('auto', true)).toBe('width');
    expect(resolveInitialZoom('auto', false)).toBe('actual');
  });

  it('显式档位不看屏宽', () => {
    expect(resolveInitialZoom('width', false)).toBe('width');
    expect(resolveInitialZoom('page', true)).toBe('page');
    expect(resolveInitialZoom('actual', true)).toBe('actual');
  });
});
