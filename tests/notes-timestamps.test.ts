import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import {
  addBookmark,
  addHighlight,
  removeBookmark,
  removeHighlight,
  removeHighlights,
  setHighlightColor,
  setHighlightComment,
} from '../src/data/notes';

/** 标注时间戳单独一支：进度翻页再也不能把它盖掉 */
function book(): ReturnType<typeof makeBook> {
  const b = makeBook('书/测试.epub', 'epub');
  b.updatedAt = 100;
  b.notesUpdatedAt = 1;
  return b;
}

function stampOf(b: ReturnType<typeof makeBook>): number {
  return (b as unknown as { notesUpdatedAt?: number }).notesUpdatedAt ?? 0;
}

describe('标注时间戳 notesUpdatedAt（A-15）', () => {
  it('新增划线同时写 notesUpdatedAt', () => {
    const b = book();
    addHighlight(b, { text: '划线', cfiRange: 'cfi' });
    expect(stampOf(b)).toBeGreaterThan(1);
  });

  it('改想法 / 改颜色都算标注变更', () => {
    const b = book();
    const h = addHighlight(b, { text: '划线', cfiRange: 'cfi' });
    b.notesUpdatedAt = 1;
    expect(setHighlightComment(b, h.id, '想法')).toBe(true);
    expect(stampOf(b)).toBeGreaterThan(1);

    b.notesUpdatedAt = 1;
    expect(setHighlightColor(b, h.id, 'green')).toBe(true);
    expect(stampOf(b)).toBeGreaterThan(1);
  });

  it('删一条 / 批量删都写 notesUpdatedAt', () => {
    const b = book();
    const one = addHighlight(b, { text: 'a', cfiRange: 'c1' });
    const two = addHighlight(b, { text: 'b', cfiRange: 'c2' });
    b.notesUpdatedAt = 1;
    expect(removeHighlight(b, one.id)).toBe(true);
    expect(stampOf(b)).toBeGreaterThan(1);

    b.notesUpdatedAt = 1;
    expect(removeHighlights(b, new Set([two.id]))).toBe(1);
    expect(stampOf(b)).toBeGreaterThan(1);
  });

  it('书签也属于标注：增删都写 notesUpdatedAt', () => {
    const b = book();
    const mark = addBookmark(b, { cfi: 'c', percent: 0.1 });
    expect(stampOf(b)).toBeGreaterThan(1);

    b.notesUpdatedAt = 1;
    expect(removeBookmark(b, mark.id)).toBe(true);
    expect(stampOf(b)).toBeGreaterThan(1);
  });

  it('没删到东西时不动 notesUpdatedAt（空操作不该制造同步冲突）', () => {
    const b = book();
    b.notesUpdatedAt = 5;
    expect(removeHighlight(b, 'missing')).toBe(false);
    expect(removeBookmark(b, 'missing')).toBe(false);
    expect(removeHighlights(b, new Set())).toBe(0);
    expect(stampOf(b)).toBe(5);
  });
});
