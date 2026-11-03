import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight } from '../src/data/notes';
import { rawUrl, wikiLink, wikiLinkFor } from '../src/data/deeplink';

/**
 * 双链（wiki 链接）的格式：`[[地址|划线文字]]`。
 *
 * 地址 = `书名#章节`（没有章节时只有书名）。别名是用户划线 / 选中的那段字，
 * 不再是「书名 · 章节」——粘进笔记后，读到的应该是原文，而不是一句指路牌。
 */
function bookWithHighlight(text: string, chapterTitle?: string) {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.title = '测试书';
  const h = addHighlight(book, { text, cfiRange: 'epubcfi(/6/4)', chapterTitle });
  return { book, h };
}

describe('wikiLink · 划线双链', () => {
  it('地址是 书名#章节，别名是划线文字', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    expect(wikiLink(book, h)).toBe('[[测试书#第一章|她转过身，没有回头]]');
  });

  it('没有章节时地址只有书名，别名照样带上', () => {
    const { book, h } = bookWithHighlight('一句话');
    expect(wikiLink(book, h)).toBe('[[测试书|一句话]]');
  });

  it('多行划线压成一行，中文之间不额外留空格', () => {
    const { book, h } = bookWithHighlight('她转过身，\n没有回头', '第一章');
    expect(wikiLink(book, h)).toBe('[[测试书#第一章|她转过身，没有回头]]');
  });

  it('别名里的 | [ ] 被清掉，链接不会被截成两段', () => {
    const { book, h } = bookWithHighlight('A|B[C]D', '第一章');
    expect(wikiLink(book, h)).toBe('[[测试书#第一章|A B C D]]');
  });

  it('书名与章节里的 # | 不会把链接拆错位', () => {
    const book = makeBook('书/x.epub', 'epub');
    book.meta.title = 'A#B';
    const h = addHighlight(book, { text: '划线', cfiRange: 'c', chapterTitle: '一|二' });
    expect(wikiLink(book, h)).toBe('[[A B#一 二|划线]]');
  });

  it('划线文字为空时退回纯地址，不留下空别名', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    h.text = '   ';
    expect(wikiLink(book, h)).toBe('[[测试书#第一章]]');
  });
});

describe('wikiLinkFor · 划词双链', () => {
  it('直接拿选区文字与章名拼双链', () => {
    const book = makeBook('书/测试书.epub', 'epub');
    book.meta.title = '测试书';
    expect(wikiLinkFor(book, '第一章', '选中文字')).toBe('[[测试书#第一章|选中文字]]');
  });

  it('没有章名时地址只有书名', () => {
    const book = makeBook('书/测试书.epub', 'epub');
    book.meta.title = '测试书';
    expect(wikiLinkFor(book, '', '选中文字')).toBe('[[测试书|选中文字]]');
  });
});

describe('obsidian:// 位置链接不受影响', () => {
  it('rawUrl 仍指向协议，带 cfi 与原文片段', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const url = rawUrl(book, h);
    expect(url.startsWith('obsidian://bz-reader?')).toBe(true);
    expect(url).toContain('cfi=');
    expect(url).toContain('t=');
  });
});
