import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight } from '../src/data/notes';
import { linkOfMark, linkOfText, rawUrl } from '../src/data/deeplink';

/**
 * 划线链接：`[划线文字](obsidian://bz-reader?…)`。
 *
 * 不再是 `[[书名#章节|…]]`：wiki 链接只能指向笔记，点不到原文；
 * Markdown 链接里塞 obsidian:// 定位串，点一下直接回到那句话。
 * 别名始终是划线原文，出处信息都在协议参数里。
 */
function bookWithHighlight(text: string, chapterTitle?: string) {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.title = '测试书';
  const h = addHighlight(book, { text, cfiRange: 'epubcfi(/6/4)', chapterTitle });
  return { book, h };
}

/** 从 `[文字](url)` 里取出 URL，顺便验证结构完整 */
function urlOf(link: string): URL {
  const m = link.match(/^\[[^\]]*\]\((.+)\)$/);
  expect(m, `不是合法的行内链接：${link}`).not.toBeNull();
  return new URL(m![1]);
}

describe('linkOfMark · 划线链接', () => {
  it('别名是划线原文，地址是 obsidian:// 定位串', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const link = linkOfMark(book, h);
    expect(link.startsWith('[她转过身，没有回头](obsidian://bz-reader?')).toBe(true);
    const url = urlOf(link);
    expect(url.searchParams.get('book')).toBe(book.id);
    expect(url.searchParams.get('cfi')).toBe('epubcfi(/6/4)');
    expect(url.searchParams.get('c')).toBe('第一章');
  });

  it('多行划线压成一行，中文之间不额外留空格', () => {
    const { book, h } = bookWithHighlight('她转过身，\n没有回头', '第一章');
    expect(linkOfMark(book, h)).toContain('[她转过身，没有回头](');
  });

  it('别名里的方括号被清掉，链接不会被提前闭合', () => {
    const { book, h } = bookWithHighlight('A]B[C', '第一章');
    expect(linkOfMark(book, h).startsWith('[A B C](')).toBe(true);
  });

  it('竖线是原文的一部分，不该被吃掉', () => {
    const { book, h } = bookWithHighlight('A|B', '第一章');
    expect(linkOfMark(book, h).startsWith('[A|B](')).toBe(true);
  });

  it('划线文字为空时用书名当链接文字', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    h.text = '   ';
    expect(linkOfMark(book, h).startsWith('[《测试书》](')).toBe(true);
  });

  it('没有 cfi 也能生成链接（只带书名与原文片段）', () => {
    const book = makeBook('书/无定位.epub', 'epub');
    const h = addHighlight(book, { text: '没有定位的划线' });
    const url = urlOf(linkOfMark(book, h));
    expect(url.searchParams.get('cfi')).toBeNull();
    expect(url.searchParams.get('t')).toBe('没有定位的划线');
  });
});

describe('linkOfText · 划词链接', () => {
  it('拿选区文字与 cfi 拼链接', () => {
    const book = makeBook('书/测试书.epub', 'epub');
    book.meta.title = '测试书';
    const link = linkOfText(book, {
      text: '选中文字',
      cfiRange: 'epubcfi(/6/8)',
      chapterTitle: '第一章',
    });
    expect(link.startsWith('[选中文字](obsidian://')).toBe(true);
    const url = urlOf(link);
    expect(url.searchParams.get('book')).toBe(book.id);
    expect(url.searchParams.get('cfi')).toBe('epubcfi(/6/8)');
    expect(url.searchParams.get('c')).toBe('第一章');
  });

  it('与划线走同一套清洗：多行压平、方括号清掉', () => {
    const book = makeBook('书/测试书.epub', 'epub');
    const link = linkOfText(book, { text: '上句，\n下句]', cfiRange: 'c' });
    expect(link.startsWith('[上句，下句](')).toBe(true);
  });
});

describe('obsidian:// 位置链接参数', () => {
  it('rawUrl 仍带 book / cfi / 原文片段 / 章节', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const url = new URL(rawUrl(book, h));
    expect(url.protocol).toBe('obsidian:');
    expect(url.searchParams.get('book')).toBe(book.id);
    expect(url.searchParams.get('t')).toBe('她转过身，没有回头');
    expect(url.searchParams.get('c')).toBe('第一章');
  });
});
