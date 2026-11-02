import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import {
  addBookmark,
  addHighlight,
  bookmarkAt,
  findHighlight,
  removeHighlight,
  setHighlightComment,
  toggleBookmark,
} from '../src/data/notes';

/** notes() 对缺数组的旧数据要补齐——用裸对象模拟老版本落盘 */
function oldBook() {
  const b = makeBook('书/测试.epub', 'epub');
  b.notes = { highlights: [], excerpts: [], bookmarks: [] };
  return b;
}

describe('划线与镜像摘录（highlight 主本，excerpt 镜像）', () => {
  it('addHighlight 同步出一条同 id 的 excerpt', () => {
    const book = oldBook();
    const h = addHighlight(book, { text: '第一段划线', cfiRange: 'epubcfi(/6/4)' });
    expect(book.notes.highlights).toHaveLength(1);
    expect(book.notes.excerpts).toHaveLength(1);
    expect(book.notes.excerpts[0].id).toBe(h.id);
    expect(book.notes.excerpts[0].text).toBe('第一段划线');
  });

  it('改想法后镜像跟着更新，清空想法镜像也清空', () => {
    const book = oldBook();
    const h = addHighlight(book, { text: '划线', cfiRange: 'cfi' });
    setHighlightComment(book, h.id, '我的想法');
    expect(book.notes.excerpts[0].comment).toBe('我的想法');
    setHighlightComment(book, h.id, '   ');
    expect(book.notes.excerpts[0].comment).toBeUndefined();
    expect(book.notes.highlights[0].comment).toBeUndefined();
  });

  it('删划线删掉一对（bz 侧想法数读 excerpts，漏删就是幽灵计数）', () => {
    const book = oldBook();
    const h = addHighlight(book, { text: '划线', cfiRange: 'cfi' });
    expect(removeHighlight(book, h.id)).toBe(true);
    expect(book.notes.highlights).toHaveLength(0);
    expect(book.notes.excerpts).toHaveLength(0);
    expect(removeHighlight(book, h.id)).toBe(false);
  });

  it('findHighlight 认 id 也认 cfiRange（点划线走 cfi，侧栏删除走 id）', () => {
    const book = oldBook();
    const h = addHighlight(book, { text: '划线', cfiRange: 'epubcfi(/6/8)' });
    expect(findHighlight(book, h.id)?.text).toBe('划线');
    expect(findHighlight(book, 'epubcfi(/6/8)')?.id).toBe(h.id);
  });

  it('文本超长截断到 5000，别把 JSON 撑爆', () => {
    const book = oldBook();
    const h = addHighlight(book, { text: '字'.repeat(6000), cfiRange: 'cfi' });
    expect(h.text.length).toBe(5000);
  });

  it('书签开关：同 CFI 再点一次是移除', () => {
    const book = oldBook();
    const input = { cfi: 'epubcfi(/6/4!page1)', percent: 0.5 };
    const added = toggleBookmark(book, input);
    expect(added).toBeDefined();
    expect(bookmarkAt(book, input.cfi)).toBeDefined();
    const removed = toggleBookmark(book, input);
    expect(removed).toBeUndefined();
    expect(bookmarkAt(book, input.cfi)).toBeUndefined();
  });

  it('addBookmark 的 percent 夹在 0..1', () => {
    const book = oldBook();
    expect(addBookmark(book, { cfi: 'c', percent: 3 }).percent).toBe(1);
    expect(addBookmark(book, { cfi: 'c', percent: -1 }).percent).toBe(0);
  });
});
