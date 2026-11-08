import { describe, expect, it, vi } from 'vitest';
import { hasLiveSelection } from '../src/engine/tap-gate';

/* 点按翻页前的那道闸：正文里还留着选中的字时，翻页要让路。
   2026-11-08 安卓反馈「选中，闪一下就没了」——当时这道闸顺手把选区也清了，
   用户长按选字的抬手动作正好被判成一次点按，刚选中的字当场消失。
   所以这里除了断言判定结果，还要钉住「一个字都不许动」。 */

function fakeDoc(sel: { isCollapsed: boolean } | null) {
  const removeAllRanges = vi.fn();
  const selection = sel ? { ...sel, removeAllRanges } : null;
  const doc = { getSelection: () => selection };
  return { doc, removeAllRanges };
}

describe('hasLiveSelection', () => {
  it('有选区时为真：这一下点按算「在看选中内容」，不翻页', () => {
    const { doc } = fakeDoc({ isCollapsed: false });
    expect(hasLiveSelection(doc as unknown as Document)).toBe(true);
  });

  it('选区已收起时为假：正常翻页', () => {
    const { doc } = fakeDoc({ isCollapsed: true });
    expect(hasLiveSelection(doc as unknown as Document)).toBe(false);
  });

  it('拿不到文档或选区时按「没有选区」处理，不抛错', () => {
    expect(hasLiveSelection(null)).toBe(false);
    expect(hasLiveSelection(undefined)).toBe(false);
    expect(hasLiveSelection({} as Document)).toBe(false);
    const { doc } = fakeDoc(null);
    expect(hasLiveSelection(doc as unknown as Document)).toBe(false);
  });

  it('只判断，不修改选区：选中之后抬手不能把字清掉', () => {
    const { doc, removeAllRanges } = fakeDoc({ isCollapsed: false });
    hasLiveSelection(doc as unknown as Document);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});
