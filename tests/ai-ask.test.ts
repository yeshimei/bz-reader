import { describe, expect, it } from 'vitest';
import { ASK_CONTEXT_LIMIT, buildMessages, clipContext } from '../src/data/ai';

/**
 * 侧栏 AI 页签的「问这本书」原来走的是划线的 explain prompt——
 * 「解释下面这段划线内容里的关键名词，不超过 120 字」。
 * 问题是：一个字的正文都没发过去，也没有多轮。
 *
 * 这组断言锁住三件事：上下文真的进了 prompt、问题与正文分得开、
 * 多轮只带最近几条。
 */
describe('clipContext', () => {
  it('短于上限时原样返回', () => {
    expect(clipContext('一千个字'.repeat(10))).toBe('一千个字'.repeat(10));
  });

  it('超长时保留末尾（读到哪儿最重要），前面标省略', () => {
    const long = 'A'.repeat(ASK_CONTEXT_LIMIT) + 'B'.repeat(500);
    const out = clipContext(long);
    expect(out.length).toBeLessThanOrEqual(ASK_CONTEXT_LIMIT + 2);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('B')).toBe(true);
  });

  it('空白压缩掉（原文里的换行会干扰模型读段落）', () => {
    expect(clipContext('第一段\n\n第二段')).toBe('第一段 第二段');
  });
});

describe('buildMessages · ask', () => {
  const base = { task: 'ask' as const, text: '这本书的主角是谁？' };

  it('带书名与章节：system 里要出现书名', () => {
    const msgs = buildMessages({ ...base, title: '红楼梦', chapter: '第一回', context: '甄士隐梦幻识通灵' });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('红楼梦');
    expect(msgs[0]!.content).toContain('第一回');
  });

  it('依据与问题分开，问题在后面', () => {
    const msgs = buildMessages({ ...base, context: '贾雨村风尘怀闺秀' });
    const user = msgs.filter((m) => m.role === 'user').at(-1)!;
    expect(user.content).toContain('贾雨村风尘怀闺秀');
    expect(user.content.indexOf('贾雨村风尘怀闺秀')).toBeLessThan(user.content.indexOf('这本书的主角是谁？'));
  });

  it('没有依据时不编造上下文，并说明只能凭问题回答', () => {
    const msgs = buildMessages(base);
    expect(msgs[0]!.content).toContain('没有取到可用的依据');
    expect(msgs.filter((m) => m.role === 'user').at(-1)!.content).not.toContain('【依据】');
  });

  it('多轮：历史里的问答按顺序带上，最多 6 条', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `历史第${i}条`,
    }));
    const msgs = buildMessages({ ...base, history });
    const carried = msgs.filter((m) => m.content.startsWith('历史第'));
    expect(carried).toHaveLength(6);
    expect(carried[0]!.content).toBe('历史第4条');
  });
});

describe('buildMessages · 老任务', () => {
  it('explain 保持原来的口径（回归）', () => {
    const msgs = buildMessages({ task: 'explain', text: '格物致知' });
    expect(msgs.at(-1)!.content).toContain('解释');
    expect(msgs.at(-1)!.content).toContain('格物致知');
  });

  it('translate 按内容定方向', () => {
    expect(buildMessages({ task: 'translate', text: 'hello world' }).at(-1)!.content).toContain('中文');
    expect(buildMessages({ task: 'translate', text: '你好世界' }).at(-1)!.content).toContain('English');
  });

  it('summarize 只给摘要', () => {
    expect(buildMessages({ task: 'summarize', text: '很长的一段' }).at(-1)!.content).toContain('摘要');
  });
});
