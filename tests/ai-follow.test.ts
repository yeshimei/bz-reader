import { afterEach, describe, expect, it } from 'vitest';
import { buildMessages } from '../src/data/ai';
import {
  aiCardBegin,
  aiCardDone,
  aiCardFollowBegin,
  aiCardFollowDone,
  aiCardFollowFail,
  aiCardGet,
  aiCardKey,
  aiCardReset,
  followHistory,
} from '../src/shell/ai-card';

/**
 * 划词卡的「追问」（2026-11-10）。
 *
 * 原来卡片只能一问一答：想知道「那它跟前面那段什么关系」，只能在输入框里
 * 重新贴一遍原文。这一组锁住两件事——
 *
 *   1. **追问带原文、带刚才那份答案**：模型要知道你在追问哪一段；
 *   2. **追问不清掉初次答案**：账本里初次结果还在，重画、切档回来都得看得到。
 */

const TEXT = '划线原文一段';

afterEach(() => aiCardReset());

describe('buildMessages · follow', () => {
  it('原文进上下文，问题单独一条，顺序是原文在前', () => {
    const msgs = buildMessages({
      task: 'follow',
      text: '这句话为什么这么说？',
      context: '格物致知，知行合一。',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('原文');
    /* 原文放 system（整场对话的常量）而不是逐轮重发；只要它出现得比问题早 */
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('格物致知，知行合一。');
    expect(all).toContain('这句话为什么这么说？');
    expect(all.indexOf('格物致知')).toBeLessThan(all.indexOf('这句话为什么这么说'));
  });

  it('没有原文时说明只能凭问题作答，不假装有依据', () => {
    const msgs = buildMessages({ task: 'follow', text: '继续说说？' });
    expect(msgs[0]!.content).toContain('没有原文');
    expect(msgs.filter((m) => m.role === 'user').at(-1)!.content).not.toContain('【原文】');
  });

  it('历史按顺序带入，最多 6 条（和问全书同一口径）', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `追问历史第${i}条`,
    }));
    const msgs = buildMessages({ task: 'follow', text: '继续', context: '原文', history });
    const carried = msgs.filter((m) => m.content.startsWith('追问历史第'));
    expect(carried).toHaveLength(6);
    expect(carried[0]!.content).toBe('追问历史第4条');
  });

  it('原文超长时截断，不把整章塞进去', () => {
    const long = '很长'.repeat(6000);
    const msgs = buildMessages({ task: 'follow', text: '问题', context: long });
    const user = msgs.filter((m) => m.role === 'user').at(-1)!;
    expect(user.content.length).toBeLessThan(long.length);
  });
});

describe('账本 · 追问轮次', () => {
  it('追问不清掉初次答案', () => {
    const key = aiCardKey('ai', 'explain', TEXT);
    aiCardDone(key, '初次答案');
    aiCardFollowBegin(key);
    expect(aiCardGet(key)).toMatchObject({ status: 'busy', text: '初次答案' });
    expect(aiCardGet(key)?.turns ?? []).toHaveLength(0);
  });

  it('追问成功追加一轮，问题和答案都在', () => {
    const key = aiCardKey('ai', 'explain', TEXT);
    aiCardDone(key, '初次答案');
    aiCardFollowDone(key, '为什么？', '因为……');
    const turns = aiCardGet(key)!.turns!;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ q: '为什么？', a: '因为……' });
    expect(aiCardGet(key)!.text).toBe('初次答案');
  });

  it('追问失败留一条带原因的记录，不覆盖初次答案', () => {
    const key = aiCardKey('ai', 'explain', TEXT);
    aiCardDone(key, '初次答案');
    aiCardFollowBegin(key);
    aiCardFollowFail(key, '话说了一半', '接口 401');
    const turns = aiCardGet(key)!.turns!;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ q: '话说了一半', error: '接口 401' });
    expect(aiCardGet(key)!.text).toBe('初次答案');
  });

  it('不同档各记各的追问', () => {
    const explain = aiCardKey('ai', 'explain', TEXT);
    const translate = aiCardKey('ai', 'translate', TEXT);
    aiCardDone(explain, '解释');
    aiCardDone(translate, '译文');
    aiCardFollowDone(explain, '问解释', '答解释');
    expect(aiCardGet(explain)!.turns).toHaveLength(1);
    expect(aiCardGet(translate)!.turns ?? []).toHaveLength(0);
  });

  it('begin 仍然清空旧账（首次请求的行为不变）', () => {
    const key = aiCardKey('ai', 'explain', TEXT);
    aiCardFollowDone(key, '问', '答');
    aiCardBegin(key);
    expect(aiCardGet(key)).toMatchObject({ status: 'busy', text: '' });
    expect(aiCardGet(key)?.turns ?? []).toHaveLength(0);
  });
});

describe('followHistory', () => {
  it('把刚才那份答案放在历史最前面，让模型知道在追问什么', () => {
    const list = followHistory('初次答案', [{ q: '问一', a: '答一' }]);
    expect(list[0]).toEqual({ role: 'assistant', content: '初次答案' });
    expect(list[1]).toEqual({ role: 'user', content: '问一' });
    expect(list[2]).toEqual({ role: 'assistant', content: '答一' });
  });

  it('没有初次答案时只带轮次', () => {
    expect(followHistory('', [{ q: '问', a: '答' }])).toEqual([
      { role: 'user', content: '问' },
      { role: 'assistant', content: '答' },
    ]);
  });

  it('失败的轮次不进历史（没答出来，不该喂回去）', () => {
    const list = followHistory('初次', [{ q: '失败的一问', error: '接口 401', a: '' }]);
    expect(list.map((m) => m.content)).not.toContain('失败的一问');
  });
});
