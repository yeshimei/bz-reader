import { describe, expect, it } from 'vitest';
import { AI_CONTEXT_LIMIT, aiScopeLabel, hitsToContext, isAiScope, sourcesOfHits } from '../src/data/ai-scope';

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
