import { describe, expect, it } from 'vitest';
import { buildReviewCard } from '../src/data/review-card';

/**
 * 复习卡带一道自测题（2026-11-10）。
 *
 * 现有卡片是「标题 + 一行原文 + 出处」：复习时扫一眼点「容易」，
 * 主动回忆被跳过了。带一道题之后，复习的顺序变成「先看题 → 自己想 →
 * 再看原文自评」——题目必须在原文引用**之前**，否则答案先露了。
 */

const base = {
  bookTitle: '一本书',
  bookId: 'b1',
  highlightId: 'h1',
  text: '格物致知，知行合一。',
  chapterTitle: '第一章',
  backlink: '[[一本书#^h1]]',
  createdAt: 0,
};

describe('buildReviewCard · 自测题', () => {
  it('题目在原文引用之前，标记仍在最后', () => {
    const md = buildReviewCard({ ...base, question: '什么是格物致知？' });
    expect(md).toContain('想一想');
    expect(md).toContain('什么是格物致知？');
    const ask = md.indexOf('想一想');
    const quote = md.indexOf('格物致知，知行合一。');
    const mark = md.indexOf('<!-- bz-reader:review-card -->');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(quote);
    expect(quote).toBeLessThan(mark);
  });

  it('没有题目时不多出一节（老卡片的版式不变）', () => {
    const md = buildReviewCard({ ...base });
    expect(md).not.toContain('想一想');
    expect(md).toContain('格物致知，知行合一。');
  });

  it('题目里的换行被压平（中文之间不留空格），不破坏标题层级', () => {
    const md = buildReviewCard({ ...base, question: '第一行\n第二行' });
    /* oneLine 的老口径：中文之间的换行直接吃掉，英文单词之间才留空格 */
    expect(md).toContain('第一行第二行');
    expect(md).not.toMatch(/^第一行$/m);
  });

  it('空白题目当成没有', () => {
    const md = buildReviewCard({ ...base, question: '   ' });
    expect(md).not.toContain('想一想');
  });
});
