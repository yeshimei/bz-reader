import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addBookmark, addHighlight, DEFAULT_HIGHLIGHT_COLOR } from '../src/data/notes';
import { buildNotesMarkdown, EXPORT_MARK, exportStampOf } from '../src/data/export';
import { DEFAULT_SETTINGS } from '../src/data/settings';

function bookWithNotes() {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.author = '作者甲';
  const h1 = addHighlight(book, { text: '第一章的划线', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
  addHighlight(book, { text: '第一章第二条', cfiRange: 'c1b', chapterIndex: 0, chapterTitle: '第一章', comment: '有意思' });
  const h3 = addHighlight(book, { text: '第二章的划线', cfiRange: 'c2', chapterIndex: 1, chapterTitle: '第二章' });
  addBookmark(book, { cfi: 'm1', percent: 0.42, chapterTitle: '第二章' });
  return { book, h1, h3 };
}

describe('标注导出成 Markdown', () => {
  it('frontmatter 带书名/作者/条数，正文带插件标记', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('title: "测试书"');
    expect(md).toContain('author: "作者甲"');
    expect(md).toContain('highlights: 3');
    expect(md).toContain('bookmarks: 1');
    expect(md).toContain(EXPORT_MARK);
    expect(exportStampOf(md)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('按章节分组，章节顺序不乱；想法压在引用下面', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    const atCh1 = md.indexOf('## 第一章');
    const atCh2 = md.indexOf('## 第二章');
    expect(atCh1).toBeGreaterThan(0);
    expect(atCh2).toBeGreaterThan(atCh1);
    expect(md).toContain('> 第一章第二条');
    expect(md).toContain('想法：有意思');
  });

  it('关掉「带想法」就只导原文引用', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, { ...DEFAULT_SETTINGS, exportComments: false });
    expect(md).not.toContain('想法：有意思');
    expect(md).toContain('> 第一章第二条');
  });

  it('没有划线也没有书签时不该生成空笔记（数据层返回 null 的依据）', () => {
    const book = makeBook('书/空书.epub', 'epub');
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('还没有划线或书签');
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe('amber');
  });

  it('多行摘录压平：换行压成空格后，中文之间不残留空格', () => {
    const book = makeBook('书/平.epub', 'epub');
    addHighlight(book, { text: '她转过身，\n没有回头', cfiRange: 'x' });
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('> 她转过身，没有回头');
  });
});
