import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_LIMIT,
  aiScopeLabel,
  hitsToContext,
  isAiScope,
  joinScopeContext,
  sourcesOfBlocks,
  sourcesOfHits,
} from '../src/data/ai-scope';

const hit = (title: string, chunk: string, path = `笔记/${title}.md`) => ({ title, chunk, path, score: 0.5 });

describe('AI 回答依据：三档', () => {
  it('只认三种取值（手改坏的 JSON 不该把界面卡在空档）', () => {
    expect(isAiScope('screen')).toBe(true);
    expect(isAiScope('brain')).toBe(true);
    expect(isAiScope('book')).toBe(true);
    expect(isAiScope('whole')).toBe(false);
    expect(isAiScope(null)).toBe(false);
  });

  it('三档各有各的说法', () => {
    expect(aiScopeLabel('screen')).toBe('当前这一屏');
    expect(aiScopeLabel('brain')).toBe('连接 AI 知识库');
    expect(aiScopeLabel('book')).toBe('全书');
  });
});

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
    expect(AI_CONTEXT_LIMIT).toBeLessThanOrEqual(12000);
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

/**
 * 决策 8 / 3.2：知识库与全书两档也要带「当前这一屏」。
 *
 * 这条以前是整体覆盖——切到全书之后，用户指着屏幕问「这段什么意思」，
 * 模型只看得到检索出来的八块，看不到那一段。修法是拼接而不是替换，
 * 所以上限要重新分配：这一屏固定留一小块，其余让给依据。
 */
describe('依据 + 当前这一屏', () => {
  it('两段都在，这一屏在前（用户问的就是它）', () => {
    const out = joinScopeContext('【笔记】\n检索到的东西', '屏幕上这一段');
    expect(out.indexOf('屏幕上这一段')).toBeLessThan(out.indexOf('检索到的东西'));
    expect(out).toContain('【当前这一屏】');
  });

  it('没有依据时只剩这一屏，不留空标题', () => {
    const out = joinScopeContext('', '屏幕上这一段');
    expect(out.trim()).toBe('屏幕上这一段');
  });

  it('没有这一屏时原样返回依据（不硬造一段空的）', () => {
    expect(joinScopeContext('【笔记】\n检索到的东西', '  ')).toBe('【笔记】\n检索到的东西');
  });

  it('总长不超上限：这一屏吃定额，依据吃剩下的', () => {
    const out = joinScopeContext('依'.repeat(9000), '屏'.repeat(5000), 6000);
    expect(out.length).toBeLessThanOrEqual(6000);
    expect(out).toContain('屏'.repeat(10));
  });

  it('这一屏自己超长时按定额截，不把依据挤没', () => {
    const out = joinScopeContext('依据', '屏'.repeat(5000), 6000);
    expect(out).toContain('依据');
    expect(out.length).toBeLessThan(6000);
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

/**
 * 上限是硬承诺，不是「一般情况下能守住」。
 *
 * 两种情况以前会漏：这一屏为空时依据整段原样返回（9000 字也照发）；
 * limit 被调得比这一屏的定额（1200）还小时，单这一屏就顶穿了。
 * 生产调用是 6000 + 非空这一屏，所以没露出来——但参数摆在那儿就会被传。
 */
describe('拼接 · 上限的边界', () => {
  it('这一屏为空：依据也要截到上限', () => {
    const out = joinScopeContext('依'.repeat(9000), '', 6000);
    expect(out.length).toBeLessThanOrEqual(6000);
  });

  it('上限小到装不下这一屏的定额时，定额跟着收', () => {
    const out = joinScopeContext('依据', '屏'.repeat(500), 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('上限为 0 时给空串，不给半句话', () => {
    expect(joinScopeContext('依据', '屏幕', 0)).toBe('');
  });
});
