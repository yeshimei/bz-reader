import { beforeEach, describe, expect, it } from 'vitest';
import type { AiSession } from '../src/data/ai-session';
import { seedAiSessions } from '../src/data/ai-session';
import {
  aiChatsOf,
  aiHistRows,
  loadAiChat,
  newAiChat,
  restoreAiChat,
  sessionToLog,
} from '../src/shell/ai-chat';
import { RT } from '../src/shell/runtime';

/* ============================================================
 * 侧栏对话的「读回来」（2026-11-16）
 *
 * 以前侧栏这份对话只活在 `RT.aiLog`：重启 Obsidian、或者换一本书再切回来
 * 就什么都不剩。这一组锁住读回来的三条口径：
 *   1. 只认侧栏这条链路（kind='book'），划词卡的会话不进侧栏；
 *   2. 换书才换对话，同书切页签 / 翻页不能重读（否则会吞掉刚问的那一轮）；
 *   3. 历史列表按时间倒序，当前那条标出来。
 * ============================================================ */

function session(patch: Partial<AiSession> = {}): AiSession {
  return {
    id: 'id-1',
    bookId: 'b1',
    bookTitle: '围城',
    kind: 'book',
    when: 1_700_000_000_000,
    turns: [
      { me: true, text: '这是谁说的？' },
      { me: false, text: '是汪太太说的。' },
    ],
    ...patch,
  };
}

beforeEach(() => {
  seedAiSessions([]);
  RT.aiLog = [];
  RT.aiChatId = '';
  RT.aiChatBook = '';
  RT.aiDraft = '';
  RT.aiCtx = [];
});

describe('会话 → 侧栏气泡', () => {
  it('问与答按顺序还原，AI 那条带标签', () => {
    const log = sessionToLog(session());
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ me: true, text: '这是谁说的？' });
    expect(log[1].me).toBe(false);
    expect(log[1].text).toBe('是汪太太说的。');
    expect(log[1].tag).toBeTruthy();
  });

  it('空白轮次跳过：不往界面上画空气泡', () => {
    const log = sessionToLog(
      session({ turns: [{ me: true, text: '问' }, { me: false, text: '  ' }] }),
    );
    expect(log).toHaveLength(1);
  });

  it('恢复的对话带来源行，半截答案带说明（2026-11-17）', () => {
    const log = sessionToLog(
      session({
        turns: [
          { me: true, text: '这是谁说的？' },
          {
            me: false,
            text: '是汪太太说的。',
            sources: [{ title: '第一章', bookId: 'b1', text: '汪太太' }],
            truncated: true,
          },
        ],
      }),
    );
    expect(log[1].sources?.[0].title).toBe('第一章');
    expect(log[1].warn).toBeTruthy();
    /* 完整答案不该凭空多一行说明 */
    const full = sessionToLog(session());
    expect(full[1].warn).toBeUndefined();
  });
});

describe('历史列表', () => {
  it('只列这本书的全书问答，划词卡的不进侧栏', () => {
    seedAiSessions([
      session({ id: 'a', bookId: 'b1' }),
      session({ id: 'b', bookId: 'b2' }),
      session({ id: 'c', bookId: 'b1', kind: 'explain' }),
    ]);
    const rows = aiHistRows(aiChatsOf('b1'), 'a');
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(rows[0].here).toBe(true);
  });

  it('首问太长要截断，轮数按「问」计数', () => {
    const long = '这句话到底是谁说的呢'.repeat(4);
    seedAiSessions([
      session({
        id: 'a',
        turns: [
          { me: true, text: long },
          { me: false, text: '答' },
          { me: true, text: '再问一句' },
          { me: false, text: '再答一句' },
        ],
      }),
    ]);
    const [row] = aiHistRows(aiChatsOf('b1'), '');
    expect(Array.from(row.head).length).toBeLessThanOrEqual(24);
    expect(row.head.endsWith('…')).toBe(true);
    expect(row.n).toBe(2);
    expect(row.when).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
  });
});

describe('读回来 / 新建', () => {
  it('换到这本书就读最近一条，同书再切不重读', () => {
    seedAiSessions([
      session({ id: 'old', when: 1_700_000_000_000 }),
      session({
        id: 'new',
        when: 1_700_000_100_000,
        turns: [{ me: true, text: '第二次问' }, { me: false, text: '第二次答' }],
      }),
    ]);

    expect(restoreAiChat('b1')).toBe(true);
    expect(RT.aiChatId).toBe('new');
    expect(RT.aiLog.at(-1)?.text).toBe('第二次答');

    /* 同一本书：用户在页签之间来回切，不能把刚问的那一轮吞掉 */
    RT.aiLog.push({ me: true, tag: '我', text: '刚打的' });
    expect(restoreAiChat('b1')).toBe(false);
    expect(RT.aiLog.at(-1)?.text).toBe('刚打的');
  });

  it('没有记录的书写入空对话，不报错', () => {
    expect(restoreAiChat('b9')).toBe(false);
    expect(RT.aiLog).toEqual([]);
    expect(RT.aiChatId).toBe('');
  });

  it('新建：视图清空、会话 id 清掉，下一次提问另起一条', () => {
    seedAiSessions([session({ id: 'a' })]);
    restoreAiChat('b1');
    expect(RT.aiChatId).toBe('a');

    newAiChat('b1');
    expect(RT.aiLog).toEqual([]);
    expect(RT.aiChatId).toBe('');
    /* 旧对话仍在记录里，历史列表找得回来 */
    expect(aiChatsOf('b1').map((s) => s.id)).toContain('a');
  });

  it('按 id 切到指定那条', () => {
    seedAiSessions([session({ id: 'a' }), session({ id: 'b', when: 1_700_000_050_000 })]);
    expect(loadAiChat('a')).toBe(true);
    expect(RT.aiChatId).toBe('a');
    expect(loadAiChat('nope')).toBe(false);
  });
});
