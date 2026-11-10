import { describe, expect, it } from 'vitest';
import { AI_MARK, aiAnswerBlock, appendAiIdea } from '../src/data/ai-save';

/**
 * AI 答案落库（2026-11-10）。
 *
 * 原来「存为笔记」只是往导出文件尾部追加 `## AI 回答` + 正文：没有出处，
 * 没有任务标记，也认不出这段是模型写的还是用户写的。这一组锁住三件事：
 * 出处可追、标记认得出、重复点不会越存越多。
 */

describe('aiAnswerBlock', () => {
  it('带任务名、日期、出处引用与末尾标记', () => {
    const md = aiAnswerBlock({
      task: 'explain',
      quote: '格物致知，知行合一。',
      answer: '王阳明认为知与行是一件事。',
      day: '2026-11-10',
    });
    expect(md).toContain('## AI 回答');
    expect(md).toContain('解释');
    expect(md).toContain('2026-11-10');
    expect(md).toContain('「格物致知，知行合一。」');
    expect(md).toContain('王阳明认为知与行是一件事。');
    expect(md.trimEnd().endsWith(AI_MARK)).toBe(true);
  });

  it('没有原文时不造引用行', () => {
    const md = aiAnswerBlock({ task: 'follow', answer: '继续答', day: '2026-11-10' });
    expect(md).not.toContain('「');
    expect(md).toContain('继续答');
  });

  it('超长原文只留一截，不整段抄进笔记', () => {
    const md = aiAnswerBlock({ task: 'summarize', quote: '长'.repeat(500), answer: '摘要', day: '2026-11-10' });
    expect(md).toContain('…');
    expect(md.length).toBeLessThan(300);
  });

  it('空答案返回空串（调用方据此不写盘）', () => {
    expect(aiAnswerBlock({ task: 'explain', answer: '   ', day: '2026-11-10' })).toBe('');
  });

  it('同一段答案重复生成，标记只出现一次', () => {
    const once = aiAnswerBlock({ task: 'explain', answer: '答', day: '2026-11-10' });
    expect(once.split(AI_MARK)).toHaveLength(2);
  });
});

describe('appendAiIdea', () => {
  it('没有想法时直接写成一条 AI 想法', () => {
    expect(appendAiIdea(undefined, '这是答案')).toBe('AI：这是答案');
  });

  it('已有想法时追加在后面，不覆盖原文', () => {
    const out = appendAiIdea('我原来的想法', '这是答案');
    expect(out.startsWith('我原来的想法')).toBe(true);
    expect(out).toContain('AI：这是答案');
  });

  it('同一段答案重复追加不会翻倍', () => {
    const once = appendAiIdea('想法', '答案');
    expect(appendAiIdea(once, '答案')).toBe(once);
  });

  it('空答案不动原文', () => {
    expect(appendAiIdea('想法', '  ')).toBe('想法');
    expect(appendAiIdea(undefined, '')).toBe('');
  });
});
