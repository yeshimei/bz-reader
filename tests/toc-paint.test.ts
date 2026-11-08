import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToc, patchToc, setToc, subscribeToc, tocPaintMode } from '../src/view/toc-state';

/**
 * B10：侧栏重绘的最小代价。
 *
 * 侧栏订阅了目录快照，而快照每次 relocate 都会被 patch——翻一页、滚动一屏、
 * 窗口 resize 后重新定位都算。以前只要不在目录页签就整块 render：书签 / 划线 /
 * AI 页签跟着重建，滚动位置与正在输入的提问框都要靠额外机制抢回来，
 * 手机上每翻一页掉一次帧。
 */
describe('目录快照同值短路（B10）', () => {
  beforeEach(() => {
    clearToc();
  });

  it('值没变就不通知订阅者：翻一页但还在同一章时一次回调都不该有', () => {
    setToc({
      bookId: 'b1',
      bookTitle: '书',
      items: [{ label: '第一章', href: 'c1' }],
      activeLabel: '第一章',
      activeHref: 'c1',
      jump: () => undefined,
    });
    const seen = vi.fn();
    const off = subscribeToc(seen);

    patchToc({ activeLabel: '第一章', activeHref: 'c1' });
    expect(seen).not.toHaveBeenCalled();

    patchToc({ activeLabel: '第二章', activeHref: 'c2' });
    expect(seen).toHaveBeenCalledTimes(1);

    off();
  });
});

describe('重绘层级（B10）', () => {
  it('目录树换了：只能整棵重建', () => {
    expect(tocPaintMode({ sameTree: false, moved: false, onTocPage: true })).toBe('full');
    expect(tocPaintMode({ sameTree: false, moved: true, onTocPage: false })).toBe('full');
  });

  it('高亮没变：一行 DOM 都不用动', () => {
    expect(tocPaintMode({ sameTree: true, moved: false, onTocPage: true })).toBe('none');
  });

  it('高亮变了且在目录页签：只切高亮', () => {
    expect(tocPaintMode({ sameTree: true, moved: true, onTocPage: true })).toBe('row');
  });

  it('高亮变了但不在目录页签：什么也不画，切回去时全量渲染会带上', () => {
    expect(tocPaintMode({ sameTree: true, moved: true, onTocPage: false })).toBe('none');
  });
});
