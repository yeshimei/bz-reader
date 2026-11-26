import { describe, expect, it } from 'vitest';
import { compareMarkText, locatorOrderKey } from '../src/data/mark-order';

/**
 * 划线列表的「按原文」排序（2026-11-26）。
 *
 * 群友反馈：标注是按添加时间排的，同一章里后划的排在先划的前面，看着乱。
 * 设置里加了「划线排序」两档：按时间（默认，保持原样）/ 按原文。
 *
 * 这一层只做一件事：从已经存下来的定位串里算出「书里谁在前」。
 * 关键是**老数据也要能排**——用户已有的几十条线没有位置字段，
 * 唯一的线索就是 cfiRange，所以必须能从 CFI / PDF 定位串里读出来。
 */
describe('locatorOrderKey', () => {
  it('PDF 定位串取页号与字符起点', () => {
    expect(locatorOrderKey('pdf/12/3-18')).toEqual([12, 3]);
    /* 整页定位没有字符区间，起点按 0 算：同页的整页线与划线段谁前谁后
       由后续比较兜底，不会因此打乱页与页之间的大顺序 */
    expect(locatorOrderKey('pdf/12')).toEqual([12, 0]);
  });

  it('EPUB CFI 只取范围起点，终点不参与比较', () => {
    /* 范围形式 `path,start,end`：尾部终点只说明这条线有多长，
       拿它比较会让「长划线」永远排到「短划线」后面 */
    expect(locatorOrderKey('epubcfi(/6/4!/4/2/2,/1:0,/1:12)')).toEqual([6, 4, 4, 2, 2, 1, 0]);
    expect(locatorOrderKey('epubcfi(/6/4!/4/2/2,/1:100,/1:120)')).toEqual([6, 4, 4, 2, 2, 1, 100]);
  });

  it('方括号里的 id 不参与比较', () => {
    /* `[c01]` 是元素 id，里面的数字与「第几段」无关；带着它比会把
       第一章第 2 段排到第一章第 10 段后面 */
    expect(locatorOrderKey('epubcfi(/6/4!/4/2/2[c01]/1:0)')).toEqual([6, 4, 4, 2, 2, 1, 0]);
    expect(locatorOrderKey('epubcfi(/6/4!/4/2/2[c10]/1:0)')).toEqual([6, 4, 4, 2, 2, 1, 0]);
  });

  it('认不出的定位串返回 null', () => {
    expect(locatorOrderKey(undefined)).toBeNull();
    expect(locatorOrderKey('')).toBeNull();
    expect(locatorOrderKey('   ')).toBeNull();
    expect(locatorOrderKey('随便一句没有定位的话')).toBeNull();
    /* PDF 前缀但页号不合法（外部链接 / 手写数据）同样不猜 */
    expect(locatorOrderKey('pdf/abc')).toBeNull();
  });
});

describe('compareMarkText', () => {
  const mark = (cfiRange?: string, createdAt = 0) => ({ cfiRange, createdAt });

  it('同章内按原文先后，不受添加时间影响', () => {
    /* 后划的在第 2 段、先划的在第 40 段：按位置排，第 2 段必须在前 */
    const early = mark('epubcfi(/6/4!/4/2/2,/1:0,/1:12)', 2_000);
    const late = mark('epubcfi(/6/4!/4/2/2,/1:400,/1:412)', 1_000);
    expect(compareMarkText(early, late)).toBeLessThan(0);
    expect(compareMarkText(late, early)).toBeGreaterThan(0);
  });

  it('跨章时按书内路径比较', () => {
    const ch1 = mark('epubcfi(/6/4!/4/2/2,/1:400,/1:412)', 1_000);
    const ch2 = mark('epubcfi(/6/6!/4/2/2,/1:0,/1:12)', 2_000);
    expect(compareMarkText(ch1, ch2)).toBeLessThan(0);
  });

  it('PDF 按页号，同页再按字符起点', () => {
    const p10 = mark('pdf/10/20-30', 2_000);
    const p9 = mark('pdf/9/200-260', 1_000);
    expect(compareMarkText(p9, p10)).toBeLessThan(0);
    expect(compareMarkText(mark('pdf/10/2-10'), mark('pdf/10/20-30'))).toBeLessThan(0);
  });

  it('没有定位的排在最后', () => {
    const located = mark('epubcfi(/6/4!/4/2/2,/1:0,/1:12)', 9_000);
    const orphan = mark(undefined, 1_000);
    expect(compareMarkText(located, orphan)).toBeLessThan(0);
    expect(compareMarkText(orphan, located)).toBeGreaterThan(0);
  });

  it('都缺定位时退回添加时间，保证顺序稳定', () => {
    expect(compareMarkText(mark(undefined, 1_000), mark(undefined, 2_000))).toBeLessThan(0);
    expect(compareMarkText(mark(undefined, 2_000), mark(undefined, 1_000))).toBeGreaterThan(0);
  });
});
