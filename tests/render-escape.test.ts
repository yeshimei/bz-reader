import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { DEFAULT_SHELL_STATE } from '../src/shell/state';
import type { BookRow } from '../src/shell/adapt';
import type { MarkRow } from '../src/shell/domain';
import { viewLibrary } from '../src/shell/render/study';
import { viewNotes } from '../src/shell/render/notes';
import { viewSidebar } from '../src/shell/render/sidebar';
import { footnoteCardHtml } from '../src/shell/reader-cards';
import { ideaSheetHtml } from '../src/shell/idea-sheet';
import { esc } from '../src/shell/render/html';

/* ============================================================
 * 拼 HTML 的唯一一道闸：esc。
 *
 * 这一组的共同前提是「书名 / 章节名 / id 是任意字符串」——它们来自 EPUB
 * 内部、用户改的书名、bz 同步回来的数据，没有一条是我们造的。
 * 断言看的是**渲染结果里不能出现未转义的尖括号与引号**，不是某个实现细节。
 * ============================================================ */

const POISON = '<img src=x onerror=alert(1)>';
const QUOTE_ID = 'x" onmouseover="alert(1)';

function row(patch: Partial<BookRow> = {}): BookRow {
  return {
    id: 'b1',
    title: '红楼梦',
    author: '曹雪芹',
    percent: 8,
    status: 'reading',
    fav: false,
    minutes: 12,
    lastText: '今天',
    lastTs: 1,
    shelf: '全部',
    format: 'EPUB',
    coverUrl: null,
    bg: '#4a3a28',
    fg: '#e9dcc3',
    glyph: '红',
    chapterTitle: '第一回',
    noteCount: 3,
    ...patch,
  };
}

function mark(id = 'm1', patch: Partial<MarkRow> = {}): MarkRow {
  return {
    id,
    bookId: 'b1',
    bookTitle: '一本测试书',
    bookAuthor: '作者',
    text: `划线 ${id}`,
    comment: '',
    color: 'amber',
    colorLabel: '琥珀',
    css: '#e8b53a',
    chapterTitle: '第一章',
    chapterIndex: 0,
    createdAt: 1,
    cfiRange: `cfi-${id}`,
    ...patch,
  };
}

function sidebarBook(): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '红楼梦', author: '曹雪芹' },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: { position: { percent: 0.1 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: {
      highlights: [
        {
          id: QUOTE_ID,
          text: '假作真时真亦假',
          cfiRange: 'cfi-1',
          chapterTitle: '第一回',
          color: 'amber',
          createdAt: 1,
        },
      ],
      excerpts: [],
      bookmarks: [
        { id: QUOTE_ID, label: '书签', chapterTitle: '第一回', percent: 0.2, createdAt: 1, cfi: 'cfi-2' },
      ],
    },
    addedAt: 1,
    updatedAt: 1,
  };
}

describe('书库页：章节名是任意字符串（D1）', () => {
  /* 「继续阅读」那一行把章节名塞进 t() 的占位符再拼进 HTML。
     漏转义时，书里一个 <img onerror> 就能在书架上执行。 */
  it('章节名里的标签被转义，不会真的变成节点', () => {
    const out = viewLibrary({
      rows: [row({ chapterTitle: POISON })],
      total: 1,
      state: DEFAULT_SHELL_STATE,
      libraryKey: 'k',
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});

describe('笔记页：data-* 里的 id（D2）', () => {
  it('标注 id 带引号也不会截断属性、不会多长出一个事件属性', () => {
    const out = viewNotes({
      marks: [mark(QUOTE_ID)],
      filter: 'all',
      kw: '',
      reviewIdx: 0,
      select: true,
      picked: [],
    });
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain('&quot; onmouseover=&quot;');
  });
});

describe('侧栏：书签与划线的 id（D2）', () => {
  const view = (tab: 'bookmarks' | 'highlights'): string =>
    viewSidebar({
      book: sidebarBook(),
      tab,
      toc: null,
      activeLabel: '',
      activeHref: '',
      aiLog: [],
      aiReady: false,
    });

  it('书签行的 data-id 转义', () => {
    const out = view('bookmarks');
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain('&quot; onmouseover=&quot;');
  });

  it('划线行的 data-id 转义', () => {
    const out = view('highlights');
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain('&quot; onmouseover=&quot;');
  });
});

describe('浮卡里的引文（D8：转义只留一份）', () => {
  it('脚注与想法输入条都把尖括号转义掉', () => {
    expect(footnoteCardHtml(POISON)).not.toContain('<img');
    expect(footnoteCardHtml(POISON)).toContain('&lt;img');
    expect(ideaSheetHtml({ markId: 'm1', bookId: 'b1', value: POISON })).toContain('&lt;img');
  });

  it('esc 的四个字符都转', () => {
    expect(esc(`<&">`)).toBe('&lt;&amp;&quot;&gt;');
    expect(esc(null)).toBe('');
  });

  /* 静态护栏：转义实现不许再分叉。以前 reader-cards / text-toolbar /
     idea-sheet 各抄一份，改一处漏两处时，注入就落在漏掉的那份上。 */
  it('三处浮卡模块不再自己定义 esc', () => {
    for (const f of ['reader-cards.ts', 'text-toolbar.ts', 'idea-sheet.ts']) {
      const src = readFileSync(resolve(__dirname, '../src/shell', f), 'utf8');
      expect(src, f).not.toMatch(/function esc\s*\(/);
      expect(src, f).toContain("from './render/html'");
    }
  });
});
