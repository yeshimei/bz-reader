/**
 * 检索切词（tests/text-terms.test.ts）
 *
 * 锁三件事：中文按二字组切、引号原话单独取出、虚词不占查询词表。
 * 这三条一起决定字面通道能不能把「白拉日隆子爵号」这种专名捞出来。
 */
import { describe, expect, it } from 'vitest';
import { countMatchedTerms, normalizeQuery, queryTerms, quotedSpans, tokenize } from '../src/data/text-terms';

describe('切词', () => {
  it('中文按二字组切，重叠一格', () => {
    expect(tokenize('知行合一')).toEqual(['知行', '行合', '合一']);
  });

  it('西文与数字按词切，大小写归一', () => {
    expect(tokenize('GPT-4o 与 1984')).toEqual(['gpt', '4o', '1984', '与']);
  });

  it('中英混排两边都切（数字单独成词，与汉字不拼）', () => {
    const out = tokenize('读 Deep Work 第3章');
    expect(out).toContain('deep');
    expect(out).toContain('work');
    expect(out).toContain('3');
    expect(out).toContain('第');
  });

  it('单字连续段保留单字（否则一个字的问题切不出词）', () => {
    expect(tokenize('他')).toEqual(['他']);
  });

  it('空串与纯标点切出空表', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('——，。！')).toEqual([]);
  });
});

describe('归一化', () => {
  it('全角转半角、压空白、转小写', () => {
    expect(normalizeQuery('  ＧＰＴ   4O ')).toBe('gpt 4o');
  });
});

describe('引号原话', () => {
  it('四种引号都认，内容归一化', () => {
    expect(quotedSpans('书里说「知行合一」')).toEqual(['知行合一']);
    expect(quotedSpans('所谓“格物致知”')).toEqual(['格物致知']);
    expect(quotedSpans('英文 "Deep Work" 怎么说')).toEqual(['deep work']);
  });

  it('单字引文不算（没有检索价值）', () => {
    expect(quotedSpans('他说「他」')).toEqual([]);
  });

  it('《书名》也算点名', () => {
    expect(quotedSpans('和《围城》比')).toContain('围城');
  });
});

describe('查询词表', () => {
  it('去掉纯虚词的二字组', () => {
    const terms = queryTerms('这本书里什么是知行合一');
    expect(terms).not.toContain('什么');
    expect(terms).not.toContain('这本');
    expect(terms).toContain('知行');
    expect(terms).toContain('合一');
  });

  it('单字虚词也不进词表', () => {
    expect(queryTerms('GPT 与 1984')).not.toContain('与');
  });

  it('整句都是虚词时退回全量，不给空词表', () => {
    expect(queryTerms('这是怎么回事').length).toBeGreaterThan(0);
  });

  it('词表去重且保序', () => {
    const terms = queryTerms('船 船 船');
    expect(terms.filter((t) => t === '船').length).toBeLessThanOrEqual(1);
  });
});

describe('命中计数', () => {
  it('按去重后的查询词数', () => {
    expect(countMatchedTerms(tokenize('白拉日隆子爵号'), ['白拉', '子爵', '不存在'])).toBe(2);
    expect(countMatchedTerms([], ['白拉'])).toBe(0);
  });
});
