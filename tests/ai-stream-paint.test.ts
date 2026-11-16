/**
 * 浮框流式补字（tests/ai-stream-paint.test.ts）
 *
 * 守三件事：
 *   1. 第一片字**立刻**出现（不是等 80ms 的节流）——那一片就是「已经开始了」
 *      的信号，晚一拍用户会以为没点动；
 *   2. 之后的字按节流合并，一轮里有几十片也只改一两次 DOM；
 *   3. 卡片被清掉（换档 / 关卡 / 清空对话）之后不再往一个死对话里写字。
 *
 * 与 `ai-stream.test.ts` 分工：那个测的是请求层怎么收流，这里测的是浮框
 * 那一行字怎么补。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAiStream } from '../src/shell/ai-stream';

interface FakeTx {
  textContent: string;
  dataset: Record<string, string>;
  removeAttribute(name: string): void;
  closest(): unknown;
}

function mount(): { root: ParentNode; tx: FakeTx; box: { scrollTop: number; scrollHeight: number } } {
  const box = {
    scrollTop: 0,
    scrollHeight: 420,
    querySelectorAll: () => [tx],
  };
  const tx: FakeTx = {
    textContent: '',
    dataset: {},
    removeAttribute: () => undefined,
    closest: () => box,
  };
  const root = {
    querySelector: () => box,
  } as unknown as ParentNode;
  return { root, tx, box };
}

describe('浮框流式补字', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('第一片字立刻画出来，不等节流', () => {
    const { root, tx } = mount();
    const stream = startAiStream((p) => p, root);
    stream.onDelta('流');
    expect(tx.textContent).toBe('流');
  });

  it('之后按 80ms 合并，一轮只在落地时改一次', () => {
    const { root, tx } = mount();
    let text = '';
    const stream = startAiStream((p) => (text += p), root);
    stream.onDelta('甲');
    expect(tx.textContent).toBe('甲');

    stream.onDelta('乙');
    stream.onDelta('丙');
    /* 还没到点：DOM 停在第一片，不乱跳 */
    expect(tx.textContent).toBe('甲');

    vi.advanceTimersByTime(80);
    expect(tx.textContent).toBe('甲乙丙');
  });

  it('前一片已经落地，后一片重新起算', () => {
    const { root, tx } = mount();
    let text = '';
    const stream = startAiStream((p) => (text += p), root);
    stream.onDelta('一');
    vi.advanceTimersByTime(200);
    stream.onDelta('二');
    vi.advanceTimersByTime(80);
    expect(tx.textContent).toBe('一二');
  });

  it('卡片被清掉（append 返回 null）就不再画', () => {
    const { root, tx } = mount();
    let alive = true;
    const stream = startAiStream((p) => (alive ? p : null), root);
    stream.onDelta('甲');
    expect(tx.textContent).toBe('甲');

    alive = false;
    stream.onDelta('乙');
    stream.onDelta('丙');
    vi.advanceTimersByTime(300);
    expect(tx.textContent).toBe('甲');
  });

  it('stop 之后还没落地的节流不再改 DOM', () => {
    const { root, tx } = mount();
    let text = '';
    const stream = startAiStream((p) => (text += p), root);
    stream.onDelta('甲');
    stream.onDelta('乙');
    stream.stop();
    vi.advanceTimersByTime(300);
    expect(tx.textContent).toBe('甲');
    /* 收尾时调用方用完整文本重绘，所以这里丢掉最后一片没有损失 */
    expect(stream.text()).toBe('甲乙');
  });

  it('画的时候顺手滚到底（长回答要跟着走）', () => {
    const { root, box } = mount();
    box.scrollHeight = 900;
    const stream = startAiStream((p) => p, root);
    stream.onDelta('字');
    expect(box.scrollTop).toBe(900);
  });
});
