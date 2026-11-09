import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import type { MarkRow } from '../src/shell/domain';
import { noteCardHtml } from '../src/shell/render/notes';
import { viewSidebar } from '../src/shell/render/sidebar';

/**
 * 长想法会把侧栏撑出横向滚动条（真机反馈 2026-11-09）。
 *
 * 根因不是「没写 word-break」那么简单：想法那一行是 flex，内容是**裸文本**，
 * 浏览器把它包成匿名 flex item，`min-width: auto` 让一个不可断的长串（URL、
 * 连着的英文、长数字）把整行顶宽，侧栏就出现横向滚动条。
 *
 * 修法是给想法文字一个自己的块（.cmm），它才吃得到 `min-width: 0` 与
 * `overflow-wrap: anywhere`。footer 标签「想法」保持不缩。
 *
 * 这里钉结构：想法正文必须在那层可缩的块里，而不是裸文本。
 */

const LONG = 'https://example.com/' + 'a'.repeat(160);

function mark(comment: string): MarkRow {
  return {
    id: 'm1',
    bookId: 'b1',
    bookTitle: '测试书',
    bookAuthor: '某人',
    text: '假作真时真亦假',
    comment,
    color: 'amber',
    colorLabel: '琥珀',
    css: '#c8a260',
    chapterTitle: '第一回',
    chapterIndex: 0,
    createdAt: 1,
    cfiRange: 'epubcfi(/6/4!/2/2,/1:0,/1:6)',
  };
}

function book(comment: string): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '红楼梦', author: '曹雪芹' },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: { position: { percent: 0.1 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: {
      highlights: [
        {
          id: 'm1',
          text: '假作真时真亦假',
          comment,
          cfiRange: 'epubcfi(/6/4!/2/2,/1:0,/1:6)',
          chapterTitle: '第一回',
          color: 'amber',
          createdAt: 1,
        },
      ],
      excerpts: [],
      bookmarks: [],
    },
    addedAt: 1,
    updatedAt: 1,
  };
}

function sidebarHighlights(comment: string): string {
  return viewSidebar({
    book: book(comment),
    tab: 'highlights',
    toc: null,
    activeLabel: '',
    activeHref: '',
    aiLog: [],
    aiReady: false,
    aiProvider: '未配置',
  });
}

describe('超长想法 · 侧栏划线列表', () => {
  it('想法正文包在可缩的 .cmm 块里，不是裸文本', () => {
    const html = sidebarHighlights(LONG);
    expect(html).toContain('<span class="cmm">');
    expect(html).toContain(LONG);
  });

  it('「想法」这个标签留在外面，不与正文挤在同一个可断行块里', () => {
    const html = sidebarHighlights(LONG);
    const cm = html.slice(html.indexOf('class="cm"'));
    expect(cm.indexOf('<b>')).toBeLessThan(cm.indexOf('<span class="cmm">'));
  });

  it('没有想法时不出这个块（空评论不该留一个空 div）', () => {
    expect(sidebarHighlights('')).not.toContain('class="cmm"');
  });
});

describe('超长想法 · 笔记卡', () => {
  it('同一层可缩块也用在笔记卡上', () => {
    const html = noteCardHtml(mark(LONG));
    expect(html).toContain('<span class="cmm">');
    expect(html).toContain(LONG);
  });
});
