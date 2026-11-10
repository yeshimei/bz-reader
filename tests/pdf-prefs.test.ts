import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, normalizePrefs } from '../src/data/prefs';
import { resolveInitialZoom } from '../src/engine/pdf/fit';

describe('PDF 组的默认值', () => {
  it('没存过时给出「连续滚动 / 单页 / 显示批注 / 反链关 / 2 倍导出」', () => {
    expect(DEFAULT_PREFS.pdfZoom).toBe('auto');
    expect(DEFAULT_PREFS.pdfFlow).toBe('scroll');
    expect(DEFAULT_PREFS.pdfSpread).toBe(false);
    expect(DEFAULT_PREFS.pdfAnnots).toBe(true);
    expect(DEFAULT_PREFS.pdfBacklinks).toBe(false);
    expect(DEFAULT_PREFS.pdfExportScale).toBe(2);
  });

  it('空输入保留默认', () => {
    const p = normalizePrefs({});
    expect(p.pdfZoom).toBe('auto');
    expect(p.pdfFlow).toBe('scroll');
    expect(p.pdfSpread).toBe(false);
    expect(p.pdfAnnots).toBe(true);
    expect(p.pdfBacklinks).toBe(false);
    expect(p.pdfExportScale).toBe(2);
  });

  it('EPUB 的翻页不受影响：默认仍是分页', () => {
    expect(DEFAULT_PREFS.flow).toBe('paged');
    expect(normalizePrefs({}).flow).toBe('paged');
  });
});

describe('PDF 翻页与 EPUB 解耦', () => {
  it('老数据没有 PDF 专属项：继承原来的翻页值，不覆盖', () => {
    expect(normalizePrefs({ flow: 'paged' }).pdfFlow).toBe('paged');
    expect(normalizePrefs({ flow: 'scroll' }).pdfFlow).toBe('scroll');
    /* 继承是单向的：PDF 拿旧的翻页值，EPUB 那一项原样不动 */
    expect(normalizePrefs({ flow: 'paged' }).flow).toBe('paged');
  });

  it('存过 PDF 专属值之后，两边各走各的', () => {
    const p = normalizePrefs({ pdfFlow: 'paged', flow: 'scroll' });
    expect(p.pdfFlow).toBe('paged');
    expect(p.flow).toBe('scroll');
  });

  it('PDF 翻页值脏、又没有旧值可继承时，回到新的默认连续', () => {
    expect(normalizePrefs({ pdfFlow: 'nope' as never }).pdfFlow).toBe('scroll');
  });
});

describe('PDF 单页 / 双页', () => {
  it('只认显式 true，脏值当单页', () => {
    expect(normalizePrefs({ pdfSpread: true }).pdfSpread).toBe(true);
    expect(normalizePrefs({ pdfSpread: false }).pdfSpread).toBe(false);
    expect(normalizePrefs({ pdfSpread: 'yes' as never }).pdfSpread).toBe(false);
  });

  it('和 EPUB 的栏数互不相干', () => {
    const p = normalizePrefs({ pdfSpread: true, columns: 2 });
    expect(p.pdfSpread).toBe(true);
    expect(p.columns).toBe(2);
    /* 反方向同样不串：PDF 的单页不该被 EPUB 的双栏改掉 */
    expect(normalizePrefs({ pdfSpread: false, columns: 2 }).columns).toBe(2);
  });
});

describe('PDF 组的值校验', () => {
  it('缩放档只认四个合法值，其余回落自动', () => {
    expect(normalizePrefs({ pdfZoom: 'width' }).pdfZoom).toBe('width');
    expect(normalizePrefs({ pdfZoom: 'page' }).pdfZoom).toBe('page');
    expect(normalizePrefs({ pdfZoom: 'actual' }).pdfZoom).toBe('actual');
    expect(normalizePrefs({ pdfZoom: 'zoom' as never }).pdfZoom).toBe('auto');
  });

  it('文件批注仍然只认显式 false：默认开，藏起来要用户点头', () => {
    expect(normalizePrefs({}).pdfAnnots).toBe(true);
    expect(normalizePrefs({ pdfAnnots: false }).pdfAnnots).toBe(false);
    expect(normalizePrefs({ pdfAnnots: 'no' as never }).pdfAnnots).toBe(true);
  });

  it('反链开关只认显式 true：新默认关，老数据里开着的照旧开', () => {
    expect(normalizePrefs({}).pdfBacklinks).toBe(false);
    expect(normalizePrefs({ pdfBacklinks: true }).pdfBacklinks).toBe(true);
    expect(normalizePrefs({ pdfBacklinks: false }).pdfBacklinks).toBe(false);
    expect(normalizePrefs({ pdfBacklinks: 'no' as never }).pdfBacklinks).toBe(false);
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
