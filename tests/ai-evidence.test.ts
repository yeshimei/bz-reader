/**
 * 回答依据的拼装（tests/ai-evidence.test.ts）
 *
 * 2026-11-07 去掉「三档」之后，一次提问的依据是固定两段：
 *   1. 这本书自己的块（必须有）；
 *   2. bz 知识库的笔记（只在共享开关打开、且 bz 可用时才有）。
 *
 * 这文件锁的是纯计算：怎么拼、怎么截、来源怎么标、谁先谁后。
 * 取数据的过程（读画像、调嵌入、调 bz）在 shell/actions.ts，不在测试范围。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_LIMIT,
  hitsToContext,
  mergeEvidence,
  sourcesOfBlocks,
  sourcesOfHits,
  type AiEvidence,
} from '../src/data/ai-evidence';

const hit = (title: string, chunk: string, path = `笔记/${title}.md`) => ({ title, chunk, path, score: 0.5 });

describe('检索命中 → 上下文', () => {
  it('空结果就是空串（不塞一句「没有找到」，那会被当成资料发给模型）', () => {
    expect(hitsToContext([])).toBe('');
    expect(hitsToContext([hit('空', '   ')])).toBe('');
  });

  it('按相关度顺序拼，标题单独一行', () => {
    const ctx = hitsToContext([hit('心流', '注意力是有限的'), hit('深度工作', '专注需要整块时间')]);
    expect(ctx.indexOf('心流')).toBeLessThan(ctx.indexOf('深度工作'));
    expect(ctx).toContain('【心流】\n注意力是有限的');
    expect(ctx).toContain('【深度工作】\n专注需要整块时间');
  });

  it('超长时截断，总量不超过上限', () => {
    const big = Array.from({ length: 12 }, (_, i) => hit(`笔记${i}`, '字'.repeat(1200)));
    const ctx = hitsToContext(big, 3000);
    expect(ctx.length).toBeLessThanOrEqual(3000);
    expect(ctx.length).toBeGreaterThan(2000);
  });

  it('最后一条塞不下半句以上就整条丢掉（半句话更容易带偏）', () => {
    const ctx = hitsToContext([hit('甲', '字'.repeat(100)), hit('乙', '字'.repeat(500))], 130);
    expect(ctx).toContain('甲');
    expect(ctx).not.toContain('乙');
    expect(ctx.length).toBeLessThanOrEqual(130);
  });

  it('默认上限够放几条笔记，但不是无限', () => {
    expect(AI_CONTEXT_LIMIT).toBeGreaterThanOrEqual(4000);
    expect(AI_CONTEXT_LIMIT).toBeLessThanOrEqual(14000);
  });
});

describe('检索命中 → 来源列表', () => {
  it('带路径的能点开，标题缺省用路径', () => {
    const src = sourcesOfHits([hit('心流', '注意力'), { title: '', chunk: 'x', path: '笔记/无题.md', score: 0.1 }]);
    expect(src[0]).toMatchObject({ title: '心流', path: '笔记/心流.md' });
    expect(src[1]).toMatchObject({ title: '笔记/无题.md', path: '笔记/无题.md' });
  });

  it('最多列五条：来源是佐证，不是第二份结果列表', () => {
    const many = Array.from({ length: 9 }, (_, i) => hit(`n${i}`, 'x'));
    expect(sourcesOfHits(many)).toHaveLength(5);
  });
});

describe('全书来源可点', () => {
  const blk = (chapter: string, index: number) => ({ chapter, index });

  it('每条都带书号，标题是章名，副标题是第几块', () => {
    const src = sourcesOfBlocks('b1', [blk('第一章', 0), blk('第二章', 7)]);
    expect(src[0]).toMatchObject({ title: '第一章', bookId: 'b1', note: '第 1 块' });
    expect(src[1]).toMatchObject({ title: '第二章', bookId: 'b1', note: '第 8 块' });
  });

  it('没章名时给一个能看的名字，但不给空标题', () => {
    const src = sourcesOfBlocks('b1', [blk('', 0)]);
    expect(src[0].title).toBe('本章');
    expect(src[0].bookId).toBe('b1');
  });

  it('最多列五条', () => {
    const many = Array.from({ length: 9 }, (_, i) => blk(`章${i}`, i));
    expect(sourcesOfBlocks('b1', many)).toHaveLength(5);
  });
});

describe('书 + 笔记：合并依据', () => {
  const book: AiEvidence = {
    context: '【第一章】\n书里的内容',
    sources: [{ title: '第一章', bookId: 'b1', note: '第 1 块' }],
  };
  const notes: AiEvidence = {
    context: '【心流】\n我自己的笔记',
    sources: [{ title: '心流', path: '笔记/心流.md' }],
  };

  it('两段都在：书在前，笔记在后（书是本体，笔记是补充）', () => {
    const out = mergeEvidence(book, notes);
    expect(out).not.toBeNull();
    expect(out!.context.indexOf('书里的内容')).toBeLessThan(out!.context.indexOf('我自己的笔记'));
  });

  it('来源分开标：书带书号、笔记带路径，界面据此走两套打开方式', () => {
    const out = mergeEvidence(book, notes)!;
    expect(out.sources[0]).toMatchObject({ bookId: 'b1' });
    expect(out.sources[1]).toMatchObject({ path: '笔记/心流.md' });
  });

  it('只有书 / 只有笔记时各自原样返回', () => {
    expect(mergeEvidence(book, null)!.context).toBe(book.context);
    expect(mergeEvidence(null, notes)!.context).toBe(notes.context);
  });

  it('两段都没有 = 没有依据（调用方据此说一句人话，而不是发空请求）', () => {
    expect(mergeEvidence(null, null)).toBe(null);
    expect(mergeEvidence({ context: '  ', sources: [] }, null)).toBe(null);
  });

  it('合并后总长仍守上限：笔记吃书剩下的额度', () => {
    const bigBook: AiEvidence = { context: '书'.repeat(5000), sources: [] };
    const bigNotes: AiEvidence = { context: '笔'.repeat(5000), sources: [] };
    const out = mergeEvidence(bigBook, bigNotes, 6000)!;
    expect(out.context.length).toBeLessThanOrEqual(6000);
    expect(out.context).toContain('书'.repeat(10));
    expect(out.context).toContain('笔'.repeat(10));
  });

  it('额度被书吃光时，笔记整段不要（不留半句）', () => {
    const out = mergeEvidence({ context: '书'.repeat(6000), sources: [] }, notes, 6000)!;
    expect(out.context).not.toContain('我自己的笔记');
  });

  it('来源最多八条，书在前', () => {
    const many = (n: number, tag: string): AiEvidence => ({
      context: tag,
      sources: Array.from({ length: n }, (_, i) => ({ title: `${tag}${i}`, bookId: tag === '书' ? 'b1' : undefined, path: tag === '记' ? `n/${i}.md` : undefined })),
    });
    const out = mergeEvidence(many(6, '书'), many(6, '记'))!;
    expect(out.sources).toHaveLength(8);
    expect(out.sources[0].title).toBe('书0');
  });
});
