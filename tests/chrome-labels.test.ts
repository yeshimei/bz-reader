import { describe, expect, it } from 'vitest';
import { chromeLabelMode } from '../src/view/chrome-labels';

/**
 * 两角小字该露哪一条（2026-11-12 用户要求）。
 *
 * 非全屏：章节名改成只出现在头栏（且与原来的左上角同色），左上角不再重复；
 * 桌面页码搬进宿主状态栏，正文里不再画。
 * 状态栏被用户在设置里关掉：页码退回正文右下角，不能凭空消失。
 * 全屏：头栏、状态栏都藏起来了，章节名回左上角、页码回右下角。
 * 手机没有宿主状态栏，口径不变（只有全屏露两角）。
 */

describe('两角小字的显示口径', () => {
  it('桌面非全屏 + 状态栏在：两角都不露（章节名在头栏，页码在状态栏）', () => {
    expect(
      chromeLabelMode({ immersive: false, mobileShell: false, pdf: false, statusBar: true }),
    ).toEqual({ chapter: false, page: false });
  });

  it('桌面非全屏 + 状态栏被关掉：页码退回正文右下角', () => {
    expect(
      chromeLabelMode({ immersive: false, mobileShell: false, pdf: false, statusBar: false }),
    ).toEqual({ chapter: false, page: true });
  });

  it('桌面全屏：章节名回左上角、页码回右下角（状态栏此时被藏）', () => {
    expect(
      chromeLabelMode({ immersive: true, mobileShell: false, pdf: false, statusBar: true }),
    ).toEqual({ chapter: true, page: true });
    expect(
      chromeLabelMode({ immersive: true, mobileShell: false, pdf: false, statusBar: false }),
    ).toEqual({ chapter: true, page: true });
  });

  it('手机非全屏：两角都不露（没有状态栏这一路）', () => {
    expect(
      chromeLabelMode({ immersive: false, mobileShell: true, pdf: false, statusBar: false }),
    ).toEqual({ chapter: false, page: false });
  });

  it('手机全屏：两角都露', () => {
    expect(
      chromeLabelMode({ immersive: true, mobileShell: true, pdf: false, statusBar: false }),
    ).toEqual({ chapter: true, page: true });
  });

  it('PDF 不画两角（右下角已有页码浮条）', () => {
    expect(
      chromeLabelMode({ immersive: true, mobileShell: false, pdf: true, statusBar: true }),
    ).toEqual({ chapter: false, page: false });
  });
});
