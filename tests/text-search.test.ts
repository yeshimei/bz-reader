import { describe, expect, it } from 'vitest';
import { toTextHits } from '../src/shell/text-search';

describe('正文搜索命中归一（toTextHits）', () => {
  it('excerpt 是 {pre, match, post} 时拼成一行（P3-23 的真实形状）', () => {
    const hits = toTextHits([
      { cfi: 'epubcfi(/6/4)', excerpt: { pre: '落霞与', match: '孤鹜', post: '齐飞' }, chapterLabel: '第一章', chapterIndex: 0 },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.excerpt).toBe('落霞与孤鹜齐飞');
    expect(hits[0]!.cfi).toBe('epubcfi(/6/4)');
    expect(hits[0]!.chapterLabel).toBe('第一章');
  });

  it('字符串 excerpt 原样保留', () => {
    expect(toTextHits([{ cfi: 'c', excerpt: '原句' }])[0]!.excerpt).toBe('原句');
  });

  it('没有 cfi 的命中丢掉（点了也没法跳）', () => {
    expect(toTextHits([{ cfi: '', excerpt: 'x' }, { cfi: 'ok', excerpt: 'y' }])).toHaveLength(1);
  });

  it('同一 cfi 只留第一条（引擎偶尔会给重复命中）', () => {
    const hits = toTextHits([
      { cfi: 'c', excerpt: 'a' },
      { cfi: 'c', excerpt: 'b' },
      { cfi: 'd', excerpt: 'c' },
    ]);
    expect(hits.map((h) => h.cfi)).toEqual(['c', 'd']);
    expect(hits[0]!.excerpt).toBe('a');
  });

  it('章节名缺失给空串，不显示 undefined', () => {
    expect(toTextHits([{ cfi: 'c', excerpt: 'x' }])[0]!.chapterLabel).toBe('');
  });

  it('最多 300 条：几百条命中不该把弹层撑爆', () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ cfi: `c${i}`, excerpt: `x${i}` }));
    expect(toTextHits(many)).toHaveLength(300);
  });

  it('PDF 同页多处命中：定位串带页内区间，各自成行', () => {
    /* 以前 PDF 命中的 cfi 只有 `pdf/3`：同一页不管几处，去重后只剩一条 */
    const hits = toTextHits([
      { cfi: 'pdf/3/0-6', excerpt: 'parity' },
      { cfi: 'pdf/3/40-46', excerpt: 'parity' },
    ]);
    expect(hits.map((h) => h.cfi)).toEqual(['pdf/3/0-6', 'pdf/3/40-46']);
  });
});
