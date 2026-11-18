import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight, DEFAULT_HIGHLIGHT_COLOR } from '../src/data/notes';
import { buildNotesBody, buildNotesMarkdown, EXPORT_MARK } from '../src/data/export';
import { DEFAULT_SETTINGS } from '../src/data/settings';

/**
 * 导出带上阅读追踪数据 + 划线时间戳（2026-11-18）。
 *
 * 以前书摘只有划线和书签，读多久、什么时候开始、读了几回、每章花多久全丢；
 * 划线本身存了 createdAt，导出时却只拿来排序。现在正文末尾多一块「阅读记录」，
 * 每条划线也带上创建时间。
 */
function trackedBook() {
  const book = makeBook('书/追踪.epub', 'epub');
  book.meta.title = '追踪测试书';
  book.reading.stats.startReadTime = Date.parse('2026-01-02T09:00:00+08:00');
  book.reading.stats.lastReadTime = Date.parse('2026-01-05T21:30:00+08:00');
  book.reading.stats.totalReadTime = 3725; // 62 分 5 秒
  book.reading.sessions = [
    { start: Date.parse('2026-01-02T09:00:00+08:00'), end: Date.parse('2026-01-02T09:30:00+08:00'), durationSeconds: 1800, percent: 0.3, chapterIndex: 0, chapterTitle: '第一章' },
    { start: Date.parse('2026-01-05T21:00:00+08:00'), end: Date.parse('2026-01-05T21:31:00+08:00'), durationSeconds: 1860, percent: 0.7, chapterIndex: 1, chapterTitle: '第二章' },
  ];
  book.reading.chapterSeconds = { '第一章': 1800, '第二章': 1925 };
  return book;
}

describe('导出阅读记录块', () => {
  it('有追踪数据时，正文末尾出现「阅读记录」小节', () => {
    const book = trackedBook();
    addHighlight(book, { text: '一句话', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body).toContain('## 阅读记录');
  });

  it('写入首读、末读、累计时长、会话数', () => {
    const book = trackedBook();
    addHighlight(book, { text: '一句话', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body).toContain('2026-01-02'); // 首读日期
    expect(body).toContain('2026-01-05'); // 末读日期
    expect(body).toMatch(/1 小时 2 分|62 分/); // 累计时长
    expect(body).toContain('2 次'); // 两次会话
  });

  it('每章时长列出', () => {
    const book = trackedBook();
    addHighlight(book, { text: '一句话', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body).toContain('第一章');
    expect(body).toContain('30 分');
  });

  it('完全没有追踪数据时，不写空的小节', () => {
    const book = makeBook('书/空.epub', 'epub');
    addHighlight(book, { text: '一句话', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body).not.toContain('## 阅读记录');
  });

  it('frontmatter 保持干净，追踪数据不堆进属性表', () => {
    const book = trackedBook();
    addHighlight(book, { text: '一句话', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    expect(EXPORT_MARK).toBe('<!-- bz-reader:export -->');
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).not.toContain('totalReadTime:');
    expect(md).not.toContain('sessions:');
  });
});

describe('划线创建时间戳', () => {
  it('每条划线带创建日期（默认带）', () => {
    const book = makeBook('书/时间.epub', 'epub');
    const h = addHighlight(book, { text: '带时间的划线', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    h.createdAt = Date.parse('2026-03-15T10:20:00+08:00');
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body).toMatch(/2026-03-15/);
  });

  it('关闭带想法开关不影响划线时间戳', () => {
    const book = makeBook('书/时间2.epub', 'epub');
    const h = addHighlight(book, { text: '带时间的划线2', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
    h.createdAt = Date.parse('2026-03-16T10:20:00+08:00');
    const body = buildNotesBody(book, { ...DEFAULT_SETTINGS, exportComments: false });
    expect(body).toMatch(/2026-03-16/);
  });
});
