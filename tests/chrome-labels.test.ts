import { describe, expect, it } from 'vitest';
import { chromeLabelMode } from '../src/view/chrome-labels';

/**
 * 两角小字该露哪一条（2026-11-12 用户要求）。
 *
 * 非全屏：章节名改成只出现在头栏（且与原来的左上角同色），左上角不再重复；
 * 全屏：头栏藏起来了，章节名回到左上角；右下角页码两种模式都留。
 * 手机非全屏本来就不露两角（头栏有标题、底栏有进度），这里一并钉住。
 */

describe('两角小字的显示口径', () => {
  it('桌面非全屏：只留页码，章节名交给头栏', () => {
    expect(chromeLabelMode({ immersive: false, mobileShell: false, pdf: false })).toEqual({
      chapter: false,
      page: true,
    });
  });

  it('桌面全屏：章节名回到左上角，页码照旧', () => {
    expect(chromeLabelMode({ immersive: true, mobileShell: false, pdf: false })).toEqual({
      chapter: true,
      page: true,
    });
  });

  it('手机非全屏：两角都不露', () => {
    expect(chromeLabelMode({ immersive: false, mobileShell: true, pdf: false })).toEqual({
      chapter: false,
      page: false,
    });
  });

  it('手机全屏：两角都露', () => {
    expect(chromeLabelMode({ immersive: true, mobileShell: true, pdf: false })).toEqual({
      chapter: true,
      page: true,
    });
  });

  it('PDF 不画两角（右下角已有页码浮条）', () => {
    expect(chromeLabelMode({ immersive: true, mobileShell: false, pdf: true })).toEqual({
      chapter: false,
      page: false,
    });
  });
});
