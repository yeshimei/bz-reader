import { describe, expect, it } from 'vitest';
import { excerptAt, pageTextOf } from '../src/engine/pdf/text';

describe('pdf page text', () => {
  it('按 item 拼接，英文缺空格时补一个', () => {
    expect(pageTextOf([{ str: 'Hello' }, { str: ' ' }, { str: 'world' }])).toBe('Hello world');
    expect(pageTextOf([{ str: 'Hello' }, { str: 'world' }])).toBe('Hello world');
  });

  it('中文之间不补空格', () => {
    expect(pageTextOf([{ str: '中' }, { str: '文' }])).toBe('中文');
    expect(pageTextOf([{ str: '中文' }, { str: '阅读' }])).toBe('中文阅读');
  });

  it('换行归一成空格，连续空白压成一个', () => {
    expect(pageTextOf([{ str: 'a', hasEOL: true }, { str: 'b' }])).toBe('a b');
    expect(pageTextOf([{ str: 'a   b' }, { str: '  c' }])).toBe('a b c');
  });

  it('空页返回空串', () => {
    expect(pageTextOf([])).toBe('');
    expect(pageTextOf([{ str: '' }])).toBe('');
    expect(pageTextOf([{ str: '   ' }])).toBe('');
  });

  it('摘录按 start/end 取上下文，并归一空白', () => {
    const text = '前面一句话。目标 词语 出现在这里，后面还有一句。';
    const got = excerptAt(text, text.indexOf('目标'), text.indexOf('目标') + 6, 6);
    expect(got.match).toBe('目标 词语');
    expect(got.pre.length).toBeLessThanOrEqual(6);
    expect(got.post.length).toBeLessThanOrEqual(6);
    expect(got.pre).not.toContain('\n');
  });

  it('越界区间会被夹到文本范围内', () => {
    const got = excerptAt('abc', -5, 99, 10);
    expect(got.match).toBe('abc');
    expect(got.pre).toBe('');
    expect(got.post).toBe('');
  });
});
