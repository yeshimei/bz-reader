/**
 * 引文校验（tests/ai-quote.test.ts）
 *
 * 模型最容易出的错不是「答错」，是「编一句原文」。这里锁三件事：
 * 抄对了要过、改标点要过、改写或整句编造要拦。
 */
import { describe, expect, it } from 'vitest';
import { extractQuotes, normalizeQuote, quoteCoverage, verifyQuotes } from '../src/data/ai-quote';

const corpus = '方鸿渐回国坐的船，是法国邮船白拉日隆子爵号。他在船上遇见了苏文纨。';

describe('取引文', () => {
  it('四种引号都认，去重保序', () => {
    expect(extractQuotes('甲说「白拉日隆子爵号」，乙说“苏文纨的那句话”，又说「白拉日隆子爵号」')).toEqual([
      '白拉日隆子爵号',
      '苏文纨的那句话',
    ]);
  });

  it('太短的引文不校验（「他」没有校验价值）', () => {
    expect(extractQuotes('他说「他」走了')).toEqual([]);
  });
});

describe('归一化', () => {
  it('标点空白全去掉，全半角统一', () => {
    expect(normalizeQuote('白拉日隆，子爵号！')).toBe('白拉日隆子爵号');
    expect(normalizeQuote('ＧＰＴ 4o')).toBe('gpt4o');
  });
});

describe('覆盖率', () => {
  it('一字不差 = 1', () => {
    expect(quoteCoverage('白拉日隆子爵号', corpus)).toBe(1);
  });

  it('换了标点仍是 1', () => {
    expect(quoteCoverage('白拉日隆，子爵号。', corpus)).toBe(1);
  });

  it('多一个「的」仍然很高', () => {
    expect(quoteCoverage('法国邮船白拉日隆的子爵号', corpus)).toBeGreaterThan(0.8);
  });

  it('整句改写掉到门槛以下', () => {
    expect(quoteCoverage('方鸿渐坐的是一艘法国邮轮', corpus)).toBeLessThan(0.8);
  });

  it('编造的引文接近 0', () => {
    expect(quoteCoverage('他坐的是北洋水师的定远舰', corpus)).toBeLessThan(0.3);
  });
});

describe('整段答案', () => {
  it('全部对得上时 bad = 0', () => {
    const report = verifyQuotes('船名是「白拉日隆子爵号」。', corpus);
    expect(report).toMatchObject({ total: 1, bad: 0 });
    expect(report.checks[0].ok).toBe(true);
  });

  it('混进一句编造的，只标那一句', () => {
    const report = verifyQuotes('船名是「白拉日隆子爵号」，同行的是「北洋水师定远舰」。', corpus);
    expect(report.total).toBe(2);
    expect(report.bad).toBe(1);
    expect(report.checks.find((c) => !c.ok)!.quote).toContain('定远舰');
  });

  it('答案里没有引文时返回零，不误报', () => {
    expect(verifyQuotes('书里没有提到。', corpus)).toEqual({ total: 0, bad: 0, checks: [] });
  });

  it('空依据：任何引文都算核不上', () => {
    expect(verifyQuotes('他说「白拉日隆子爵号」', '')).toMatchObject({ total: 1, bad: 1 });
  });
});
