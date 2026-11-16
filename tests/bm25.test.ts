/**
 * 字面打分（tests/bm25.test.ts）
 *
 * 锁的是排序而不是具体分数：分数会随语料变，排序才是检索的承诺。
 * 另外锁两条容易踩的：章名字段权重、同分顺序稳定。
 */
import { describe, expect, it } from 'vitest';
import { bm25Rank, type Bm25DocInput } from '../src/data/bm25';

const doc = (key: string, body: string, chapter = '', weight = 1): Bm25DocInput => ({
  key,
  fields: [
    { text: chapter, weight: 2.5 },
    { text: body, weight },
  ],
});

describe('BM25+ 排序', () => {
  it('命中两次的块排在命中一次前面', () => {
    const hits = bm25Rank(
      [doc('a', '方鸿渐坐的船叫白拉日隆子爵号'), doc('b', '方鸿渐回家了'), doc('c', '天气很好')],
      ['白拉', '子爵'],
    );
    expect(hits[0].key).toBe('a');
    expect(hits.find((h) => h.key === 'c')).toBeUndefined();
  });

  it('一次都没命中的块不返回（上层靠它判「这本书没讲」）', () => {
    const hits = bm25Rank([doc('a', '天气很好')], ['白拉']);
    expect(hits).toEqual([]);
  });

  it('章名命中算数，且权重高于正文', () => {
    const inChapter = doc('a', '无关正文', '第三章 白拉日隆号');
    const inBody = doc('b', '第三章提到白拉日隆号');
    const hits = bm25Rank([inChapter, inBody], ['白拉']);
    expect(hits.map((h) => h.key)).toContain('a');
    /* 章名字段 2.5 倍权重：同一句话放章名里，分数应更高 */
    const a = hits.find((h) => h.key === 'a')!.score;
    const b = hits.find((h) => h.key === 'b')!.score;
    expect(a).toBeGreaterThan(b);
  });

  it('短块里的强命中不会被长块淹没（δ 的作用）', () => {
    const short = doc('short', '白拉日隆子爵号');
    const long = doc('long', `${'方鸿渐'.repeat(200)} 白拉日隆`);
    const hits = bm25Rank([short, long], ['白拉', '日隆', '子爵']);
    expect(hits[0].key).toBe('short');
  });

  it('同分时按 key 升序，结果可复现', () => {
    const hits = bm25Rank([doc('b', '同样的句子'), doc('a', '同样的句子')], ['同样']);
    expect(hits.map((h) => h.key)).toEqual(['a', 'b']);
  });

  it('命中词数单独报出来（上层用它挡擦边块）', () => {
    const hits = bm25Rank([doc('a', '白拉日隆子爵号'), doc('b', '白拉')], ['白拉', '日隆', '子爵']);
    expect(hits.find((h) => h.key === 'a')!.matched).toBe(3);
    expect(hits.find((h) => h.key === 'b')!.matched).toBe(1);
  });

  it('空词表 / 空文档不炸', () => {
    expect(bm25Rank([], ['白拉'])).toEqual([]);
    expect(bm25Rank([doc('a', '白拉')], [])).toEqual([]);
  });

  it('预切好的 tokens 与现切等价', () => {
    const a = bm25Rank([{ key: 'a', fields: [{ text: '知行合一', weight: 1 }] }], ['知行']);
    const b = bm25Rank([{ key: 'a', fields: [{ text: '', weight: 1, tokens: ['知行', '行合', '合一'] }] }], ['知行']);
    expect(a[0].score).toBeCloseTo(b[0].score, 10);
  });
});
