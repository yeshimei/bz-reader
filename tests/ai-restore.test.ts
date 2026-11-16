import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { runAiForOverlay } from '../src/shell/overlay';
import { seedAiSessions, type AiSession } from '../src/data/ai-session';
import { aiCardGet, aiCardKey, aiCardReset } from '../src/shell/ai-card';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';

/* ============================================================
 * 关掉再打开：问过的对话要读得回来（2026-11-16 真机反馈）
 *
 * 追问面板打开时走的是「不发请求、只重画」那条路，而把落盘记录灌回卡片
 * 的那一步排在它后面——于是每次重开都是一张空卡，用户以为问过的问题
 * 丢了。这条断言锁住顺序：先恢复，再决定「这一档有没有新东西要发」。
 * ============================================================ */

const undoDom = installDomStub();

afterAll(() => undoDom());

afterEach(() => {
  aiCardReset();
  seedAiSessions([]);
  setState({ ...DEFAULT_SHELL_STATE });
});

const TEXT = '结婚仿佛金漆的鸟笼';

function past(patch: Partial<AiSession> = {}): AiSession {
  return {
    id: 's1',
    bookId: 'b1',
    bookTitle: '围城',
    kind: 'follow',
    when: 1_700_000_000_000,
    markId: 'm1',
    turns: [
      { me: true, text: '那她为什么还是嫁了？' },
      { me: false, text: '因为她要的不是爱情，是一个去处。' },
    ],
    ...patch,
  };
}

describe('追问卡 · 重新打开', () => {
  it('同一划线追问过的问答会被读回来，不是一张空卡', async () => {
    seedAiSessions([past()]);
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'follow', markId: 'm1' },
    });

    await runAiForOverlay();

    const entry = aiCardGet(aiCardKey('ai', 'follow', TEXT, 'm1'));
    expect(entry?.status).toBe('done');
    expect(entry?.ask).toBe('那她为什么还是嫁了？');
    expect(entry?.text).toBe('因为她要的不是爱情，是一个去处。');
  });

  it('没有那条记录：仍然是空卡，也不凭空发请求', async () => {
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'follow', markId: 'm1' },
    });

    await runAiForOverlay();

    expect(aiCardGet(aiCardKey('ai', 'follow', TEXT, 'm1'))).toBeUndefined();
  });

  it('各档各读各的：追问不去捡解释那条会话', async () => {
    seedAiSessions([past({ id: 's2', kind: 'explain' })]);
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'follow', markId: 'm1' },
    });

    await runAiForOverlay();

    expect(aiCardGet(aiCardKey('ai', 'follow', TEXT, 'm1'))).toBeUndefined();
  });
});
