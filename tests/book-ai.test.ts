/**
 * 给 bz 的书籍出口（tests/book-ai.test.ts）
 *
 * 第二大脑显示「几本书、多少块」，以及在那边提问时把书的块并进依据。
 * 这里只锁纯计算：统计怎么加、跨书排序怎么排、不同维度要不要跳过。
 * 「开关关着就一条不给」由 isShared 把关，属于接线层（plugin.ts）。
 */
import { describe, expect, it } from 'vitest';
import { rankBlocks, summarizeBooks, summarizePortraits, type BookAiStats } from '../src/data/book-ai';
import { encodeVector, type PortraitBlock, type PortraitFile } from '../src/data/portrait';

function portrait(
  id: string,
  blocks: Array<Partial<PortraitBlock> & { chars?: number }>,
  extra: Partial<PortraitFile> = {},
): PortraitFile {
  return {
    version: 1,
    bookId: id,
    bookTitle: `书${id}`,
    plan: 'vector',
    model: 'embed-x',
    chunkChars: 1000,
    total: blocks.length,
    blocks: blocks.map((b) => ({ chapter: b.chapter ?? '第一章', chars: b.chars ?? 10, ...b })),
    createdAt: 1,
    updatedAt: 100,
    done: true,
    ...extra,
  };
}

describe('统计聚合', () => {
  it('空书架就是全零，不给 NaN', () => {
    expect(summarizePortraits([])).toEqual<BookAiStats>({ books: 0, blocks: 0, chars: 0, lastAt: null, models: [] });
  });

  it('块数、字数、最近时间、模型去重各算各的', () => {
    const s = summarizePortraits([
      portrait('a', [{ chars: 100 }, { chars: 200 }], { updatedAt: 50, model: 'm1' }),
      portrait('b', [{ chars: 300 }], { updatedAt: 900, model: 'm2' }),
      portrait('c', [{ chars: 1 }], { updatedAt: 10, model: 'm1' }),
    ]);
    expect(s.books).toBe(3);
    expect(s.blocks).toBe(4);
    expect(s.chars).toBe(601);
    expect(s.lastAt).toBe(900);
    expect(s.models.sort()).toEqual(['m1', 'm2']);
  });
});

describe('跨书排序', () => {
  const p1 = portrait('a', [
    { text: '甲', vec: encodeVector([1, 0]) },
    { text: '乙', vec: encodeVector([0, 1]) },
  ]);
  const p2 = portrait('b', [{ text: '丙', vec: encodeVector([0.9, 0.1]) }]);

  it('按相似度降序，跨书混排', () => {
    const hits = rankBlocks([1, 0], [p1, p2], 3);
    expect(hits.map((h) => h.chunk)).toEqual(['甲', '丙', '乙']);
    expect(hits[0]).toMatchObject({ bookId: 'a', title: '书a', chapter: '第一章' });
  });

  it('维度对不上就跳过：不同模型的向量不能硬算相似度', () => {
    const bad = portrait('c', [{ text: '丁', vec: encodeVector([1, 0, 0]) }]);
    const hits = rankBlocks([1, 0], [p1, bad], 5);
    expect(hits.map((h) => h.chunk)).not.toContain('丁');
  });

  it('维度相同但模型不同：旧向量照样不参与排序', () => {
    /* 换一个同为 2 维的嵌入模型，维度守卫拦不住；不按模型名挡的话，
       旧空间的向量会被算出一个看起来正常的分数，静默混进依据。 */
    const old = portrait('f', [{ text: '旧', vec: encodeVector([1, 0]) }], { model: 'embed-old' });
    const cur = portrait('g', [{ text: '新', vec: encodeVector([1, 0]) }], { model: 'embed-new' });
    const hits = rankBlocks([1, 0], [old, cur], 5, 'embed-new');
    expect(hits.map((h) => h.chunk)).toEqual(['新']);
  });

  it('压缩方案的画像不参与向量检索（它没有向量）', () => {
    const compress = portrait('d', [{ text: '要点', summary: 'x' }], { plan: 'compress' });
    const hits = rankBlocks([1, 0], [p1, compress], 5);
    expect(hits.map((h) => h.bookId)).not.toContain('d');
  });

  it('没有正文的块不进结果（空串会拼出一段没有内容的依据）', () => {
    const empty = portrait('e', [{ text: '   ', vec: encodeVector([1, 0]) }]);
    expect(rankBlocks([1, 0], [empty], 5)).toEqual([]);
  });

  it('topK 收口：要 2 条就只给 2 条', () => {
    expect(rankBlocks([1, 0], [p1, p2], 2)).toHaveLength(2);
  });
});

/**
 * 书籍清单（2026-11-08）：第二大脑的统计面板要把书并进来——「来源分布」里
 * 每本书一行、「最近向量化」里按时间与笔记混排。汇总数字（几本几块）不够，
 * 那边需要书名和各自的时间。
 */
describe('书籍清单', () => {
  it('空书架 → 空数组，不造一行空书', () => {
    expect(summarizeBooks([])).toEqual([]);
  });

  it('按最近更新时间降序，每本带书号/书名/块数/字数/时间/模型/方案', () => {
    const list = summarizeBooks([
      portrait('a', [{ chars: 100 }, { chars: 200 }], { updatedAt: 50, model: 'm1' }),
      portrait('b', [{ chars: 300 }], { updatedAt: 900, model: 'm2' }),
    ]);
    expect(list.map((b) => b.bookId)).toEqual(['b', 'a']);
    expect(list[0]).toEqual({
      bookId: 'b',
      title: '书b',
      blocks: 1,
      chars: 300,
      updatedAt: 900,
      model: 'm2',
      plan: 'vector',
    });
    expect(list[1]).toMatchObject({ blocks: 2, chars: 300 });
  });

  it('时间相同按书名排（同一次重建的几本书不随目录顺序乱跳）', () => {
    const list = summarizeBooks([
      portrait('z', [{ chars: 1 }], { bookTitle: '乙书', updatedAt: 100 }),
      portrait('y', [{ chars: 1 }], { bookTitle: '甲书', updatedAt: 100 }),
    ]);
    expect(list.map((b) => b.title)).toEqual(['甲书', '乙书']);
  });

  it('书名缺失给空串（界面兜底成「未命名」），不把 undefined/空值漏到界面上', () => {
    const list = summarizeBooks([portrait('x', [{ chars: 1 }], { bookTitle: '' })]);
    expect(list[0].title).toBe('');
  });
});
