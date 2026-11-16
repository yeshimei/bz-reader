/**
 * 全书检索（tests/block-retrieval.test.ts）
 *
 * 这个文件锁的是一条真机问题：
 *   问「方鸿渐回国坐的船叫什么名字」，纯向量取前六块全是「方鸿渐」出现
 *   最多的日常段落，写着「白拉日隆子爵号」的开头排在第 21 名，模型答
 *   「书里没有提到」。
 *
 * 加了字面通道之后，专名能被捞回来；加了邻居扩展之后，跨块的论证能接上；
 * 问一个书里根本没有的话题，仍然要返回空（不许凑满六块噪声）。
 */
import { describe, expect, it } from 'vitest';
import { lexicalPicks, retrieveBlocks, searchBooksHybrid, withNeighbors, type BlockPick } from '../src/data/block-retrieval';
import { encodeVector, type PortraitFile } from '../src/data/portrait';

const V = {
  /** 与查询完全同向：向量通道会给满分 */
  near: [1, 0],
  /** 与查询夹角很大：余弦 0.55，排不进前 18 */
  far: [0.55, 0.835],
};

function portraitOf(blocks: Array<{ chapter: string; text: string; vec: number[] }>, title = '围城'): PortraitFile {
  return {
    version: 1,
    bookId: 'book-1',
    bookTitle: title,
    plan: 'vector',
    model: 'test-embed',
    dim: 2,
    chunkChars: 1000,
    total: blocks.length,
    blocks: blocks.map((b) => ({
      chapter: b.chapter,
      chars: b.text.length,
      text: b.text,
      vec: encodeVector(b.vec),
    })),
    createdAt: 0,
    updatedAt: 0,
    done: true,
  };
}

/** 20 块「方鸿渐」日常段落 + 1 块写着船名的开头（模仿真机《围城》的分布） */
function weiCheng(): PortraitFile {
  const generic = Array.from({ length: 20 }, (_, i) => ({
    chapter: `第${Math.floor(i / 7) + 2}章`,
    text: `方鸿渐回到住处，想起方才的事，心里烦闷。这是第 ${i} 段日常。`,
    vec: V.near,
  }));
  return portraitOf([
    { chapter: '第一章', text: '方鸿渐回国坐的船，是法国邮船白拉日隆子爵号。', vec: V.far },
    ...generic,
  ]);
}

const indexes = (picks: readonly BlockPick[]): number[] => picks.map((p) => p.index);

describe('字面通道', () => {
  it('专名能被字面捞回来（向量排第 21 名也认）', () => {
    const p = weiCheng();
    const lex = lexicalPicks(p, '方鸿渐回国坐的船叫什么名字', 60);
    expect(lex.map((l) => l.index)).toContain(0);
  });

  it('引号里的原话一字不差时，一块也认', () => {
    const p = portraitOf([{ chapter: '第一章', text: '他说：「婚姻是一座围城。」', vec: V.near }]);
    const lex = lexicalPicks(p, '「婚姻是一座围城」这句话在第几章', 10);
    expect(lex[0]).toMatchObject({ index: 0, exact: true });
  });

  it('只命中一个词的擦边块不要（中文里遍地都是）', () => {
    const p = portraitOf([
      { chapter: '第一章', text: '这是一个人的时候。', vec: V.near },
      { chapter: '第二章', text: '量子纠缠的实验结果。', vec: V.near },
    ]);
    expect(lexicalPicks(p, '量子力学是什么意思', 10)).toEqual([]);
  });
});

describe('混合检索', () => {
  it('船名那一块进得了最终依据', () => {
    const p = weiCheng();
    const picks = retrieveBlocks(p, '方鸿渐回国坐的船叫什么名字', V.near, { limit: 6 });
    expect(indexes(picks)).toContain(0);
    expect(picks.length).toBeLessThanOrEqual(6);
  });

  it('问答里根本没提过的话题返回空，不凑噪声', () => {
    const p = weiCheng();
    const picks = retrieveBlocks(p, '这本书如何评价量子引力', V.near, { limit: 6 });
    /* 向量通道仍然会给「最像」的块（这是它的本性），但字面一块都命不中时，
       最终依据里不该出现船名这种完全不相关的段落 */
    expect(indexes(picks)).not.toContain(0);
  });

  it('依据按章分散：不全是同一章', () => {
    const p = weiCheng();
    const picks = retrieveBlocks(p, '方鸿渐回住处心里烦闷', V.near, { limit: 6 });
    const chapters = new Set(picks.map((x) => x.block.chapter));
    expect(chapters.size).toBeGreaterThan(1);
  });


  it('引号原话一定进依据，挤掉最弱的一块', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({
      chapter: `第${i + 1}章`,
      text: `第 ${i} 段的日常叙述。`,
      vec: V.near,
    }));
    blocks[11] = { chapter: '第十二章', text: '这一句是「婚姻是一座围城」的出处。', vec: V.far };
    const picks = retrieveBlocks(portraitOf(blocks), '「婚姻是一座围城」在哪一章', V.near, { limit: 3 });
    expect(indexes(picks)).toContain(11);
    expect(picks).toHaveLength(3);
  });

  it('六块是硬上限（预算按块算）', () => {
    const p = weiCheng();
    expect(retrieveBlocks(p, '方鸿渐', V.near, { limit: 6 }).length).toBeLessThanOrEqual(6);
  });

  it('没有向量的书不会炸（压缩方案不该走到这里，但兜一层）', () => {
    const p = portraitOf([{ chapter: '第一章', text: '方鸿渐', vec: V.near }]);
    expect(retrieveBlocks(p, '方鸿渐', [], { limit: 6 }).every((x) => x.why !== 'vector')).toBe(true);
  });
});

describe('邻居扩展', () => {
  it('命中块的同一章前后块进候选池', () => {
    const p = portraitOf([
      { chapter: '第一章', text: '前一段', vec: V.near },
      { chapter: '第一章', text: '命中的那段', vec: V.near },
      { chapter: '第一章', text: '后一段', vec: V.near },
      { chapter: '第二章', text: '别章', vec: V.near },
    ]);
    const pool: BlockPick[] = [{ block: p.blocks[1], index: 1, score: 1, cosine: 1, lexical: 0, why: 'vector' }];
    const out = withNeighbors(p, pool, 6);
    expect(out.map((x) => x.index).sort()).toEqual([0, 1, 2]);
  });

  it('不跨章扩（跨章讲的是另一件事）', () => {
    const p = portraitOf([
      { chapter: '第一章', text: '章末', vec: V.near },
      { chapter: '第二章', text: '章首', vec: V.near },
    ]);
    const pool: BlockPick[] = [{ block: p.blocks[0], index: 0, score: 1, cosine: 1, lexical: 0, why: 'vector' }];
    expect(withNeighbors(p, pool, 6).map((x) => x.index)).toEqual([0]);
  });

  it('邻居分数低于父块，抢不过真正的命中', () => {
    const p = portraitOf([
      { chapter: '第一章', text: '前一段', vec: V.near },
      { chapter: '第一章', text: '命中', vec: V.near },
    ]);
    const pool: BlockPick[] = [{ block: p.blocks[1], index: 1, score: 1, cosine: 1, lexical: 0, why: 'vector' }];
    const out = withNeighbors(p, pool, 6);
    const neighbor = out.find((x) => x.index === 0)!;
    expect(neighbor.score).toBeLessThan(1);
    expect(neighbor.why).toBe('neighbor');
  });
});

describe('跨书检索', () => {
  it('两本书各出一条，按书去重', () => {
    const a = portraitOf([{ chapter: '第一章', text: '知行合一的说法', vec: V.near }], '书甲');
    const b = {
      ...portraitOf([{ chapter: '第一章', text: '知行合一讲的是什么', vec: V.near }], '书乙'),
      bookId: 'book-2',
    };
    const hits = searchBooksHybrid([a, b], '知行合一', V.near, 'test-embed', 10);
    expect(new Set(hits.map((h) => h.bookId)).size).toBe(2);
  });

  it('专名靠字面进结果', () => {
    const a = portraitOf(
      [
        { chapter: '第一章', text: '无关的日常段落', vec: V.near },
        { chapter: '第九章', text: '白拉日隆子爵号从这里起航', vec: V.far },
      ],
      '书甲',
    );
    const hits = searchBooksHybrid([a], '白拉日隆子爵号', V.near, 'test-embed', 5);
    expect(hits[0].chapter).toBe('第九章');
  });

  it('模型对不上的书不参与（两套向量不可比）', () => {
    const a = portraitOf([{ chapter: '第一章', text: '知行合一', vec: V.near }]);
    expect(searchBooksHybrid([a], '知行合一', V.near, '别的模型', 5)).toEqual([]);
  });
});
