import { describe, expect, it } from 'vitest';
import { jumpKey, pickChapterHit, toTextHits } from '../src/shell/text-search';

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

/* ============================================================
 * 依据 → 书内搜索词（2026-11-17 真机：依据跳转全错）
 *
 * 画像块的原文是「段落 + 换行」连起来的，引擎搜索的 haystack 也是
 * 文本节点原样拼接。以前这里把换行压成空格，needle 与 haystack 从
 * 第一个换行起就对不上；搜不到就退化成「全书第一次出现」，章也错了。
 * ============================================================ */
describe('依据原文 → 搜索词（jumpKey）', () => {
  it('保留原文换行，不把段落接缝压成空格', () => {
    const kw = jumpKey('围城\n钱锺书 著\n人民文学出版社');
    expect(kw).not.toContain(' ');
    expect(kw).toBe('人民文学出版社');
  });

  it('第一行太短（章节标题）就跳过去，取真正能定位的一行', () => {
    expect(jumpKey('序\n这是正文的第一段，写了很长很长的一段话。')).toBe(
      '这是正文的第一段，写了很长很长的一段话。',
    );
  });

  it('去掉首尾的引号与省略号（摘录常从半句引文开始）', () => {
    expect(jumpKey('「这是七月下旬，合中国旧历的三伏」')).toBe('这是七月下旬，合中国旧历的三伏');
    expect(jumpKey('……这是七月下旬')).toBe('这是七月下旬');
  });

  it('每一行都太短时取最长的那行，总比空着好', () => {
    expect(jumpKey('围城\n序\n附录')).toBe('围城');
  });

  it('超长行截到上限，不把 emoji 从中间切开', () => {
    const kw = jumpKey('一'.repeat(60), 8);
    expect(Array.from(kw)).toHaveLength(8);
    expect(kw).toBe('一'.repeat(8));
  });

  it('空串 / 只有空白返回空串（调用方据此落到章首）', () => {
    expect(jumpKey('')).toBe('');
    expect(jumpKey('  \n  ')).toBe('');
  });
});

describe('依据该落到哪一条命中（pickChapterHit）', () => {
  const hit = (cfi: string, chapterLabel: string) => ({ cfi, excerpt: '', chapterLabel, chapterIndex: 0 });

  it('章名精确匹配优先于「包含」（序 vs 序言）', () => {
    expect(pickChapterHit([hit('a', '序言'), hit('b', '序')], '序')?.cfi).toBe('b');
  });

  it('章名对不上（老记录 / 目录改名）才退回第一条', () => {
    expect(pickChapterHit([hit('a', '第一章'), hit('b', '第二章')], '第三章')?.cfi).toBe('a');
  });

  it('没有命中时返回 undefined', () => {
    expect(pickChapterHit([], '第一章')).toBeUndefined();
  });
});
