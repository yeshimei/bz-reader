import { describe, expect, it } from 'vitest';
import { quoteRefMarkdown } from '../src/shell/render/quote-card';

describe('书摘卡的引用文本（存笔记 / 复制引用共用一份）', () => {
  it('一条引文 + 出处，与卡片上看到的一致', () => {
    expect(
      quoteRefMarkdown({ text: '给岁月以文明', title: '三体', author: '刘慈欣', chapter: '第一章' }),
    ).toBe('「给岁月以文明」\n— 三体 · 刘慈欣 · 第一章');
  });

  it('没有作者时不留空槽（不出现连续两个分隔点）', () => {
    expect(quoteRefMarkdown({ text: '句子', title: '书', author: '', chapter: '章' })).toBe(
      '「句子」\n— 书 · 章',
    );
  });

  it('章节缺失时用「未命名章节」，不写 undefined', () => {
    expect(quoteRefMarkdown({ text: '句子', title: '书' })).toBe('「句子」\n— 书 · 未命名章节');
  });

  it('正文两端空白去掉，避免引号里多出空格', () => {
    expect(quoteRefMarkdown({ text: '  句子 \n', title: '书', chapter: '章' })).toBe('「句子」\n— 书 · 章');
  });
});
