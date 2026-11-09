import { describe, expect, it } from 'vitest';
import { hitChapterLabel } from '../src/engine/cross-search';

/* ============================================================
 * 全库搜索里「这条命中在书的哪儿」。
 *
 * 真机排查：全库搜 PDF 时每一条行首都只写「正文」——PDF 引擎不给章节名，
 * 只有 `pdf/<页>` 定位串。补上页码才看得出命中落在第几页。
 * ============================================================ */

describe('cross-search 命中行的位置标签', () => {
  it('EPUB 引擎给了章节名就原样用', () => {
    expect(hitChapterLabel({ cfi: 'epubcfi(/6/14!/4/2)', chapterLabel: '第三章' })).toBe('第三章');
  });

  it('PDF 的 `pdf/<页>` 定位串补成页码', () => {
    expect(hitChapterLabel({ cfi: 'pdf/2' })).toBe('第 2 页');
    expect(hitChapterLabel({ cfi: 'pdf/137/12-30' })).toBe('第 137 页');
  });

  it('认不出来的定位串返回空串，由界面退回「正文」', () => {
    expect(hitChapterLabel({ cfi: '' })).toBe('');
    expect(hitChapterLabel({ cfi: 'epubcfi(/6/14!/4/2)' })).toBe('');
  });
});
