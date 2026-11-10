import { describe, expect, it } from 'vitest';
import { buildMessages } from '../src/data/ai';

/**
 * 两个新任务（2026-11-10）：
 *   · probe —— 每日回顾里「问问 AI」，基于一条划线 + 当时写的想法，出一个追问；
 *   · quiz  —— 复习卡要的自测题，只出题、不答题。
 *
 * 两个都是「让模型说话前先约束住」：只要一个问题，别客套、别解释、
 * 更别替用户回答问题。prompt 一旦松掉，卡片里就会出现一段散文。
 */

describe('buildMessages · probe', () => {
  it('原文与当时的想法都进上下文，系统提示要求只给一个问题', () => {
    const msgs = buildMessages({
      task: 'probe',
      text: '格物致知，知行合一。',
      context: '我觉得这句话在讲实践。',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('问题');
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('格物致知，知行合一。');
    expect(all).toContain('我觉得这句话在讲实践。');
    expect(all.indexOf('格物致知')).toBeLessThan(all.indexOf('我觉得这句话'));
  });

  it('没有想法时不写「当时的想法」那一节', () => {
    const msgs = buildMessages({ task: 'probe', text: '原文一段', context: '' });
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).not.toContain('当时的想法');
    expect(all).toContain('原文一段');
  });

  it('原文超长时截断，不把整章塞进去', () => {
    const long = '很长'.repeat(3000);
    const msgs = buildMessages({ task: 'probe', text: long });
    const all = msgs.map((m) => m.content).join('\n');
    expect(all.length).toBeLessThan(long.length);
  });
});

describe('buildMessages · quiz', () => {
  it('只出题：系统提示说明是自测题', () => {
    const msgs = buildMessages({ task: 'quiz', text: '格物致知。' });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('自测');
    expect(msgs.at(-1)!.content).toContain('格物致知');
  });

  it('带想法时一起给，题目能贴着读者的理解出', () => {
    const msgs = buildMessages({ task: 'quiz', text: '原文', context: '我猜这是在说实践' });
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('我猜这是在说实践');
  });
});
