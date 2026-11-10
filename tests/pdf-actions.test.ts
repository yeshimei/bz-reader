/**
 * PDF 头栏动作：按钮先建、引擎后挂载（2026-11-10 真机截图发现的 bug）。
 *
 * 复现路径：阅读页按 EPUB 形态先建好那排头栏图标 → PDF 引擎 mount 完才
 * 补上四颗 → 复用按钮不重挂 click 监听。旧写法把当时的 `host.pdfUi`
 * （还是 undefined）闭包进 handler，于是四颗图标和「排版」全点了没反应。
 * 这条断言要求**点击时**再去取，而不是建按钮时取。
 */
import { describe, expect, it, vi } from 'vitest';
import { pdfActionRun } from '../src/view/pdf-actions';
import type { PdfUi } from '../src/engine/reader-engine';

function fakeUi() {
  const ui = {
    toggleLayout: vi.fn(),
    toggleThumbs: vi.fn(),
    openCopyMenu: vi.fn(),
    back: vi.fn(),
    exportPage: vi.fn(),
  };
  return ui as unknown as PdfUi & typeof ui;
}

describe('PDF 头栏动作晚挂载', () => {
  it('建按钮时还没有 PDF 视图，挂载之后同一批 handler 全部能用', () => {
    let current: PdfUi | undefined = undefined;
    const ui = fakeUi();
    const run = pdfActionRun(() => current, () => undefined);

    /* 引擎还没好：点了什么都不做，也不许抛 */
    expect(() => {
      run.type();
      run.thumb();
      run.copy(null);
      run.history();
      run.export();
    }).not.toThrow();
    expect(ui.toggleLayout).not.toHaveBeenCalled();

    /* 引擎就绪：同一个 run 对象，五个动作都要打到新视图上 */
    current = ui;
    const anchor = { right: 100, bottom: 40 };
    run.type();
    run.thumb();
    run.copy(anchor);
    run.history();
    run.export();
    expect(ui.toggleLayout).toHaveBeenCalledTimes(1);
    expect(ui.toggleThumbs).toHaveBeenCalledTimes(1);
    expect(ui.openCopyMenu).toHaveBeenCalledWith(anchor);
    expect(ui.back).toHaveBeenCalledTimes(1);
    expect(ui.exportPage).toHaveBeenCalledTimes(1);
  });

  it('换一本书（PDF → EPUB）之后，「排版」回到原来的面板而不是打旧视图', () => {
    let current: PdfUi | undefined = fakeUi();
    const typography = vi.fn();
    const run = pdfActionRun(() => current, typography);
    run.type();
    expect(typography).not.toHaveBeenCalled();

    current = undefined;
    run.type();
    expect(typography).toHaveBeenCalledTimes(1);
  });
});
