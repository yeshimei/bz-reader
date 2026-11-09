import { describe, expect, it } from 'vitest';
import { ideaFitHeight } from '../src/shell/idea-grow';

/**
 * 想法输入框按内容撑高，但**有上限**。
 *
 * 撑高是每敲一个字都要走的路径，不能靠「量不准就先按内容来」——
 * 量不到高度时宁可不改（返回 null），也不要把框压成 0 高。
 */
describe('ideaFitHeight', () => {
  it('没到上限：按内容的高度', () => {
    expect(ideaFitHeight(120, 230)).toBe(120);
  });

  it('超过上限：停在上限（再长就让框自己滚）', () => {
    expect(ideaFitHeight(900, 230)).toBe(230);
    expect(ideaFitHeight(900, 180)).toBe(180);
  });

  it('正好等于上限：还是上限，不是「超了一点」', () => {
    expect(ideaFitHeight(230, 230)).toBe(230);
  });

  it('量不到内容高度（还没布局 / 隐藏）：不动它', () => {
    expect(ideaFitHeight(0, 230)).toBeNull();
    expect(ideaFitHeight(-5, 230)).toBeNull();
    expect(ideaFitHeight(Number.NaN, 230)).toBeNull();
  });

  it('上限读不到（样式表没给）：只按内容，不裁', () => {
    expect(ideaFitHeight(400, Number.NaN)).toBe(400);
    expect(ideaFitHeight(400, 0)).toBe(400);
  });

  it('小数取整：inline 高度写进 style 用整数', () => {
    expect(ideaFitHeight(94.6, 230)).toBe(95);
    expect(ideaFitHeight(94.2, 230)).toBe(94);
  });
});
