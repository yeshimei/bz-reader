import { describe, expect, it } from 'vitest';
import { revealScrollTop } from '../src/view/toc-reveal';

/**
 * 目录高亮行要自动滚进可视区（点第 12 篇后目录还停在第一屏，真机）。
 * 只算 scrollTop，不碰外层滚动。
 */
describe('revealScrollTop', () => {
  const view = { top: 100, bottom: 400 };

  it('当前行已经在可视区：一个像素都不动', () => {
    expect(revealScrollTop(50, { top: 120, bottom: 140 }, view)).toBe(50);
  });

  it('当前行在可视区上方：往上滚到留 8px 余量', () => {
    expect(revealScrollTop(200, { top: 80, bottom: 96 }, view)).toBe(200 - 28);
  });

  it('当前行在可视区下方：往下滚到留 8px 余量', () => {
    expect(revealScrollTop(0, { top: 380, bottom: 400 }, view)).toBe(8);
  });

  it('滚到顶部不出现负值', () => {
    expect(revealScrollTop(0, { top: 90, bottom: 100 }, view)).toBe(0);
  });
});
