import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { aiSessions, seedAiSessions, type AiSession } from '../src/data/ai-session';
import { aiCardGet, aiCardKey, aiCardReset, aiCardSeed } from '../src/shell/ai-card';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';

/* ============================================================
 * AI 卡左下角的「清空这段对话」（2026-11-16）
 *
 * 1. 点一下先弹确认，不能一下就删；
 * 2. 取消 = 原地开回那张卡，什么都没动；
 * 3. 确认 = 卡片账本与落盘记录一起清，划线不碰，并且**开回同一张卡**
 *    （位置、定住、这条线的 markId 都要原样留着）。
 * ============================================================ */

const TEXT = '结婚仿佛金漆的鸟笼';
const KEY = aiCardKey('ai', 'follow', TEXT, 'm1');

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function session(): AiSession {
  return {
    id: 's1',
    bookId: 'b1',
    bookTitle: '围城',
    kind: 'follow',
    when: 1_700_000_000_000,
    markId: 'm1',
    turns: [
      { me: true, text: '那她为什么还是嫁了？' },
      { me: false, text: '因为她要的是一个去处。' },
    ],
  };
}

function card(): void {
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: {
      kind: 'ai',
      bookId: 'b1',
      text: TEXT,
      mode: 'follow',
      markId: 'm1',
      pinned: true,
      anchor: { left: 120, top: 240 },
    },
  });
}

beforeEach(() => {
  aiCardReset();
  seedAiSessions([session()]);
  aiCardSeed(KEY, {
    ask: '那她为什么还是嫁了？',
    text: '因为她要的是一个去处。',
    status: 'done',
    at: 1_700_000_000_000,
  });
  card();
});

afterEach(() => {
  aiCardReset();
  seedAiSessions([]);
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('AI 卡 · 清空对话', () => {
  it('点垃圾桶先弹二次确认', () => {
    dispatchAction('aifloatclear', el());

    const o = getState().overlay;
    expect(o?.kind).toBe('aiclear');
    expect(o?.text).toBe(TEXT);
    expect(o?.pinned).toBe(true);
    /* 没确认之前什么都不该动 */
    expect(aiSessions()).toHaveLength(1);
    expect(aiCardGet(KEY)).toBeTruthy();
  });

  it('取消：原地开回卡片，对话一条不少', () => {
    dispatchAction('aifloatclear', el());
    dispatchAction('aifloatclearcancel', el());

    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.markId).toBe('m1');
    expect(o?.pinned).toBe(true);
    expect(aiSessions()).toHaveLength(1);
    expect(aiCardGet(KEY)?.text).toBe('因为她要的是一个去处。');
  });

  it('确认：账本与落盘都清掉，但仍是同一张卡（位置 / 定住 / 划线都在）', async () => {
    dispatchAction('aifloatclear', el());
    dispatchAction('aifloatclearyes', el());
    await Promise.resolve();

    expect(aiCardGet(KEY)).toBeUndefined();
    expect(aiSessions()).toHaveLength(0);
    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.markId).toBe('m1');
    expect(o?.pinned).toBe(true);
    expect(o?.anchor).toEqual({ left: 120, top: 240 });
  });

  it('别的划线、别的档位不受牵连', async () => {
    const other: AiSession = { ...session(), id: 's2', markId: 'm2' };
    seedAiSessions([session(), other]);
    const otherKey = aiCardKey('ai', 'follow', TEXT, 'm2');
    aiCardSeed(otherKey, { ask: '另一条线', text: '另一份答案', status: 'done', at: 1 });

    dispatchAction('aifloatclear', el());
    dispatchAction('aifloatclearyes', el());
    await Promise.resolve();

    expect(aiSessions().map((s) => s.id)).toEqual(['s2']);
    expect(aiCardGet(otherKey)?.text).toBe('另一份答案');
  });
});
