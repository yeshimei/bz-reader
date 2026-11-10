import { describe, expect, it } from 'vitest';
import { pickSemanticHits, searchablePortraits, type SemanticHit } from '../src/data/book-search';
import type { PortraitFile } from '../src/data/portrait';

/**
 * 跨书语义搜索（2026-11-10）。
 *
 * 真实检索要借 bz 的嵌入服务，node 里造不出来。这里钉两段能纯算的部分：
 *   1. **哪些画像能参与**——换过模型、没建完、压缩方案的都要挡掉，
 *      否则就是拿两套空间的向量互相检索（界面正常、结果全错）；
 *   2. **结果怎么收**——同一本书不刷屏、总数有上限、顺序不动。
 */

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '一本书',
    plan: 'vector',
    model: 'm1',
    chunkChars: 1000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 10, text: '正文' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

describe('searchablePortraits', () => {
  it('只留建完的向量画像，且模型与当前一致', () => {
    const list = [
      portrait({ bookId: 'ok' }),
      portrait({ bookId: 'compress', plan: 'compress' }),
      portrait({ bookId: 'old', model: 'm0' }),
      portrait({ bookId: 'half', done: false }),
      portrait({ bookId: 'nomodel', model: '' }),
    ];
    expect(searchablePortraits(list, 'm1').map((p) => p.bookId)).toEqual(['ok']);
  });

  it('当前模型名未知时一本都不给（不认识来源的向量不能假装可比）', () => {
    expect(searchablePortraits([portrait()], '')).toEqual([]);
  });
});

describe('pickSemanticHits', () => {
  const hit = (bookId: string, score: number): SemanticHit => ({
    bookId,
    title: bookId,
    chapter: '第一章',
    chunk: `${bookId} 的片段`,
    score,
  });

  it('同一本书最多留几条，顺序按分数保持', () => {
    const list = [hit('a', 0.9), hit('a', 0.8), hit('a', 0.7), hit('a', 0.6), hit('b', 0.5)];
    const out = pickSemanticHits(list, 2, 20);
    expect(out.map((h) => `${h.bookId}:${h.score}`)).toEqual(['a:0.9', 'a:0.8', 'b:0.5']);
  });

  it('总数有上限', () => {
    const list = Array.from({ length: 30 }, (_, i) => hit(`b${i}`, 1 - i / 100));
    expect(pickSemanticHits(list, 3, 20)).toHaveLength(20);
  });

  it('空输入返回空数组', () => {
    expect(pickSemanticHits([])).toEqual([]);
  });

  it('参数不合法时退回默认值（不返回 0 条）', () => {
    const list = [hit('a', 0.9), hit('b', 0.8)];
    expect(pickSemanticHits(list, 0, 0)).toHaveLength(2);
  });
});
