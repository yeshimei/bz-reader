import { describe, expect, it } from 'vitest';
import { AI_LOG_MARK, aiConversationMarkdown } from '../src/data/ai-save';

/**
 * 对话存档（2026-11-11）。
 *
 * 侧栏「问这本书」的多轮问答一直只活在内存（RT.aiLog），关掉插件就没了。
 * 这一层把它整理成一篇能存进库的 Markdown：谁问的、谁答的、依据是什么。
 *
 * 三条：
 *   1. 有标记（AI_LOG_MARK）：之后重新存档时认得出这是插件写的段落；
 *   2. 来源跟着答案走：脱离侧栏之后仍然知道「这一段出自哪一章」；
 *   3. 空对话返回空串：调用方据此不写盘、也不弹「已存档」。
 */

describe('aiConversationMarkdown', () => {
  const base = {
    bookTitle: '一本书',
    day: '2026-11-11',
    turns: [
      { me: true, text: '这本书讲了什么？' },
      { me: false, text: '讲了一个人在乱世里做选择。', sources: [{ title: '第一章', note: '第 1 块' }] },
    ],
  };

  it('标题带书名与日期，问与答按顺序写出', () => {
    const md = aiConversationMarkdown(base);
    expect(md).toContain('AI 对话 · 一本书 · 2026-11-11');
    expect(md).toContain('这本书讲了什么？');
    expect(md).toContain('讲了一个人在乱世里做选择。');
    expect(md.indexOf('这本书讲了什么')).toBeLessThan(md.indexOf('讲了一个人'));
  });

  it('答案的来源写在答案下面', () => {
    const md = aiConversationMarkdown(base);
    expect(md).toContain('来源');
    expect(md).toContain('第一章');
    expect(md).toContain('第 1 块');
  });

  it('末尾带标记', () => {
    const md = aiConversationMarkdown(base);
    expect(md.trimEnd().endsWith(AI_LOG_MARK)).toBe(true);
  });

  it('没有来源时不写来源行', () => {
    const md = aiConversationMarkdown({
      bookTitle: '一本书',
      day: '2026-11-11',
      turns: [{ me: false, text: '没有依据的回答' }],
    });
    expect(md).not.toContain('来源');
  });

  it('空对话 / 空白轮次返回空串', () => {
    expect(aiConversationMarkdown({ day: '2026-11-11', turns: [] })).toBe('');
    expect(aiConversationMarkdown({ day: '2026-11-11', turns: [{ me: true, text: '  ' }] })).toBe('');
  });

  it('没有书名时标题不出现空的书名段', () => {
    const md = aiConversationMarkdown({ day: '2026-11-11', turns: [{ me: true, text: '问' }] });
    expect(md).toContain('AI 对话 · 2026-11-11');
    expect(md).not.toContain('·  ·');
  });

  it('多轮问答全部保留', () => {
    const md = aiConversationMarkdown({
      day: '2026-11-11',
      turns: [
        { me: true, text: '第一问' },
        { me: false, text: '第一答' },
        { me: true, text: '第二问' },
        { me: false, text: '第二答' },
      ],
    });
    for (const s of ['第一问', '第一答', '第二问', '第二答']) expect(md).toContain(s);
  });
});
