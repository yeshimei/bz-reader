import { describe, expect, it } from 'vitest';
import {
  AI_LOG_MARK,
  AI_MARK,
  aiAnswerBlock,
  aiConversationMarkdown,
  appendAiIdea,
  upsertAiLogBlock,
} from '../src/data/ai-save';

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

/* ============================================================
 * 对话归档的增量（2026-11-17 真机：同一场对话被完整追加两遍）
 *
 * 以前归档只做「读文件 → 末尾再接一段 → 写回」，点两次就是两份一模一样的
 * 对话。这里锁住：同一场对话只留一份、内容更新时原地替换、老格式里
 * 内容完全相同的重复段落也合并；另一场对话和用户手写的内容一律不动。
 * ============================================================ */
describe('对话归档 · 增量（upsertAiLogBlock）', () => {
  const turns = (ask: string, answer: string) => [
    { me: true, text: ask },
    { me: false, text: answer, sources: [{ title: '第一章', note: '第 1 块' }] },
  ];
  const convo = (ask: string, answer: string, chatId = 'id-1', day = '2026-11-17'): string =>
    aiConversationMarkdown({ bookTitle: '围城', day, chatId, turns: turns(ask, answer) });

  it('归档块带会话编号（之后再归档认得出是同一场）', () => {
    expect(convo('问', '答')).toContain('<!-- bz-reader:ai-log:id-1 -->');
    expect(
      aiConversationMarkdown({ bookTitle: '围城', day: '2026-11-17', turns: turns('问', '答') }),
    ).not.toContain('bz-reader:ai-log:id');
  });

  it('空文件：追加一段并保留文件头', () => {
    const out = upsertAiLogBlock('# 围城\n', convo('问一', '答一'), 'id-1');
    expect(out).toContain('# 围城');
    expect(out).toContain('## AI 对话');
    expect(out.trimEnd().endsWith(AI_LOG_MARK)).toBe(true);
  });

  it('同一场对话再归档一次：原地替换，不追加第二份', () => {
    const doc = `# 围城\n\n${convo('问一', '答一')}\n`;
    const out = upsertAiLogBlock(doc, convo('问一', '答一'), 'id-1');
    expect(out.split('## AI 对话')).toHaveLength(2);
    expect(out).toBe(doc);
  });

  it('同一场对话多了新轮次：文件里只剩最新一份', () => {
    const doc = `# 围城\n\n${convo('问一', '答一')}\n`;
    const out = upsertAiLogBlock(doc, convo('问一', '答一（改过）'), 'id-1');
    expect(out.split('## AI 对话')).toHaveLength(2);
    expect(out).toContain('答一（改过）');
    expect(out).not.toContain('答一\n');
  });

  it('老格式（没有会话编号）内容相同：合并成一份，不重复追加', () => {
    const old = convo('问一', '答一', '');
    const doc = `# 围城\n\n${old}\n\n${old}\n`;
    const out = upsertAiLogBlock(doc, convo('问一', '答一'), 'id-1');
    expect(out.split('## AI 对话')).toHaveLength(2);
    expect(out.split(AI_LOG_MARK)).toHaveLength(2);
  });

  it('另一场对话：追加在后面，前一段原样不动', () => {
    const doc = `# 围城\n\n${convo('问一', '答一', 'id-1')}\n`;
    const out = upsertAiLogBlock(doc, convo('另一个问题', '另一个回答', 'id-2'), 'id-2');
    expect(out.split('## AI 对话')).toHaveLength(3);
    expect(out).toContain('问一');
    expect(out).toContain('另一个问题');
  });

  it('用户手写的内容不动（只在文件末尾接新块）', () => {
    const doc = `# 围城\n\n我自己写的笔记，不要动。\n`;
    const out = upsertAiLogBlock(doc, convo('问一', '答一'), 'id-1');
    expect(out).toContain('我自己写的笔记，不要动。');
    expect(out).toContain('问一');
  });
});
