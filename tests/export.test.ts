import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { makeBook } from '../src/data/book-repo';
import { addBookmark, addHighlight, DEFAULT_HIGHLIGHT_COLOR } from '../src/data/notes';
import { buildNotesMarkdown, EXPORT_MARK, exportBookNotes, exportStampOf } from '../src/data/export';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { FakeAdapter } from './helpers/fake-adapter';

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

  it('书名/作者里的换行不能注入 frontmatter', () => {
    const { book } = bookWithNotes();
    book.meta.title = '正常书名"\nmalicious: 1\n---';
    book.meta.author = '作者\n注入';
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    /* 换行压平后整串仍在同一个引号里——不能变成新的 YAML 键或提前结束头部 */
    expect(md).toContain('title: "正常书名\\" malicious: 1 ---"');
    const front = md.slice(0, md.indexOf('\n---', 4));
    expect(front.split('\n').some((line) => line.startsWith('malicious:'))).toBe(false);
    expect(md.split('\n').some((line) => line.startsWith('注入'))).toBe(false);
  });

  it('frontmatter 写 bookId，同名书才认得出各自那份（A-16）', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain(`bookId: "${book.id}"`);
  });
});

describe('导出目标路径（A-16）', () => {
  function appWith(adapter: FakeAdapter): App {
    return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  }

  function bookNamed(title: string, path: string) {
    const b = makeBook(path, 'epub');
    b.meta.title = title;
    addHighlight(b, { text: '一句话', cfiRange: 'c1' });
    return b;
  }

  it('两本同名书导出到不同文件，不互相覆盖', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const a = bookNamed('同名书', '书/a.epub');
    const b = bookNamed('同名书', '书/b.epub');

    const ra = await exportBookNotes(app, a, DEFAULT_SETTINGS);
    const rb = await exportBookNotes(app, b, DEFAULT_SETTINGS);

    expect(ra?.path).toBe('bz-reader/notes/同名书.md');
    expect(rb?.path).toBe('bz-reader/notes/同名书 (2).md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toContain(`bookId: "${a.id}"`);
    expect(adapter.files.get('bz-reader/notes/同名书 (2).md')).toContain(`bookId: "${b.id}"`);
  });

  it('同一本书再导出：bookId 对得上就复用原路径，不堆 (2)(3)', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const a = bookNamed('同名书', '书/a.epub');

    const first = await exportBookNotes(app, a, DEFAULT_SETTINGS);
    addHighlight(a, { text: '第二条', cfiRange: 'c2' });
    const second = await exportBookNotes(app, a, DEFAULT_SETTINGS);

    expect(first?.path).toBe('bz-reader/notes/同名书.md');
    expect(second?.path).toBe('bz-reader/notes/同名书.md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toContain('第二条');
  });

  it('同名文件是别人的笔记（没有 bookId / 没有插件标记）：让开，不覆盖', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const mine = bookNamed('同名书', '书/a.epub');
    adapter.files.set('bz-reader/notes/同名书.md', '我自己的读书笔记，不能被插件冲掉');

    const r = await exportBookNotes(app, mine, DEFAULT_SETTINGS);

    expect(r?.path).toBe('bz-reader/notes/同名书 (2).md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toBe('我自己的读书笔记，不能被插件冲掉');
  });

  it('旧版导出（有插件标记但没有 bookId）也不能被当作同一本覆盖（A-16 的取舍）', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const mine = bookNamed('同名书', '书/a.epub');
    adapter.files.set(
      'bz-reader/notes/同名书.md',
      ['---', 'title: "同名书"', '---', EXPORT_MARK, '', '# 同名书'].join('\n'),
    );

    const r = await exportBookNotes(app, mine, DEFAULT_SETTINGS);

    expect(r?.path).toBe('bz-reader/notes/同名书 (2).md');
  });
});
