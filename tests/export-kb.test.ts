import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight, setHighlightKb } from '../src/data/notes';
import { normalizeSettings } from '../src/data/settings';
import { buildNotesMarkdown } from '../src/data/export';

/**
 * 导出里的知识盒链接（2026-11-08）。
 *
 * 链接不再写进想法，但导出成 Markdown 时必须带上——否则用户把书摘导出到笔记库，
 * 「这段存过名词」这条信息就丢了。导出的是 Markdown，`[[…]]` 天然可点。
 */
function bookWithKb() {
  const book = makeBook('书/测试.epub', 'epub');
  book.notes = { highlights: [], excerpts: [], bookmarks: [] };
  const h = addHighlight(book, { text: '注意力是一种有限的资源', cfiRange: 'cfi-1', chapterTitle: '注意力' });
  setHighlightKb(book, h.id, { kind: 'term', path: '文献/心流.md', at: 1 });
  setHighlightKb(book, h.id, { kind: 'passage', path: '文献/注意力.md', at: 2 });
  return book;
}

describe('导出 · 知识盒链接', () => {
  const settings = normalizeSettings(null);

  it('名词与段落各一行，链接可点', () => {
    const md = buildNotesMarkdown(bookWithKb(), settings, 0);
    expect(md).toContain('知识盒（名词）：[[文献/心流|心流]]');
    expect(md).toContain('知识盒（段落）：[[文献/注意力|注意力]]');
  });

  it('没有链接的划线不冒出空行', () => {
    const book = makeBook('书/空.epub', 'epub');
    book.notes = { highlights: [], excerpts: [], bookmarks: [] };
    addHighlight(book, { text: '只有一句话', cfiRange: 'c', chapterTitle: '一' });
    const md = buildNotesMarkdown(book, settings, 0);
    expect(md).not.toContain('知识盒');
  });

  it('想法照旧导出，知识盒是额外的一行', () => {
    const book = bookWithKb();
    const h = book.notes.highlights[0];
    h.comment = '我的想法';
    const md = buildNotesMarkdown(book, settings, 0);
    expect(md).toContain('想法：我的想法');
    expect(md).toContain('知识盒（名词）');
  });
});
