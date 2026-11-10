/**
 * 划线 → 复习卡的交付（data/review-deliver.ts）。
 *
 * 2026-11-11 起卡片不落文件：内容整份交给 bz 的复习计划。所以这里钉住的是
 * 「交出去的那份内容齐不齐」——少一样（原文、想法、出处、回源），复习时那
 * 一面就是空的，而用户已经把划线划掉了。
 */
import { describe, expect, it } from 'vitest';
import { CARD_TEXT_MAX, backlinkOf, cardKeyOf, cardOf } from '../src/data/review-deliver';
import type { Highlight, ReaderBook } from '../src/data/schema';

function book(over: Partial<ReaderBook> = {}): ReaderBook {
  return { id: 'b1', meta: { title: '围城' }, ...over } as unknown as ReaderBook;
}

function mark(over: Partial<Highlight> = {}): Highlight {
  return {
    id: 'hl-1',
    text: '红海早过了，船在印度洋面上开驶着',
    chapterTitle: '第一章',
    cfiRange: 'epubcfi(/6/14!/4/2)',
    createdAt: 1,
    ...over,
  } as Highlight;
}

describe('卡片钥匙', () => {
  it('按书 + 划线拼，一个库里唯一', () => {
    expect(cardKeyOf(book(), mark())).toBe('reader:b1:hl-1');
  });

  it('同一本书的另一条划线是另一把钥匙', () => {
    expect(cardKeyOf(book(), mark({ id: 'hl-2' }))).not.toBe(cardKeyOf(book(), mark()));
  });
});

describe('卡片内容', () => {
  it('原文、书名、章节、想法、回源一个不少', () => {
    const c = cardOf(book(), mark({ comment: '写的是闷热' }));
    expect(c.key).toBe('reader:b1:hl-1');
    expect(c.bookTitle).toBe('围城');
    expect(c.chapterTitle).toBe('第一章');
    expect(c.text).toContain('红海');
    expect(c.comment).toBe('写的是闷热');
    expect(c.backlink).toContain('obsidian://bz-reader');
    expect(c.backlink).toContain('cfi=');
  });

  it('没章节、没想法时不带空字段（复习时不该出现空行）', () => {
    const c = cardOf(book(), mark({ chapterTitle: '', comment: '   ' }));
    expect(c.chapterTitle).toBeUndefined();
    expect(c.comment).toBeUndefined();
  });

  it('超长划线截断，免得一张卡读起来像一篇文', () => {
    const c = cardOf(book(), mark({ text: '一'.repeat(CARD_TEXT_MAX + 200) }));
    expect(Array.from(c.text).length).toBe(CARD_TEXT_MAX + 1);
    expect(c.text.endsWith('…')).toBe(true);
  });

  it('没书名时用兜底名，不让卡片出现空标题', () => {
    const c = cardOf(book({ meta: { title: '' } as never }), mark());
    expect(c.bookTitle).toBe('未命名');
  });
});

describe('回源链接', () => {
  it('带 cfi 就落到那一句', () => {
    expect(backlinkOf(book(), mark())).toBe('obsidian://bz-reader?book=b1&cfi=epubcfi(%2F6%2F14!%2F4%2F2)');
  });

  it('没有 cfi 就退回这本书', () => {
    expect(backlinkOf(book(), mark({ cfiRange: '' }))).toBe('obsidian://bz-reader?book=b1');
  });

  it('书 id 会被转义，链接不会因为特殊字符断掉', () => {
    expect(backlinkOf(book({ id: 'a b&c' } as never), mark({ cfiRange: '' }))).toBe('obsidian://bz-reader?book=a%20b%26c');
  });
});
