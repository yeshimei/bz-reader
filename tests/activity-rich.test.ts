/**
 * 会话新字段：交互次数 / 听书秒数 / 按章计时（tests/activity-rich.test.ts）
 *
 * 三条都只影响「新产生的会话」：老会话没有这些字段，读侧按 0 处理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityTracker } from '../src/engine/activity';

const g = globalThis as { window?: unknown };

beforeEach(() => {
  g.window = { setInterval: () => 1, clearInterval: () => undefined };
});

afterEach(() => {
  delete g.window;
});

/** 把会话累计推到「够长、会被落盘」的程度 */
function makeLong(tracker: ActivityTracker): void {
  (tracker as unknown as { accumulated: number }).accumulated = 60_000;
}

describe('ActivityTracker · 交互次数', () => {
  it('连击只算一次（滚动事件的几十个 touch 不刷数据）', () => {
    const t = new ActivityTracker();
    t.begin(0);
    t.touch();
    t.touch();
    t.touch();
    makeLong(t);
    const s = t.end();
    expect(s?.turns).toBe(1);
  });

  it('间隔超过 1.5 秒的两次动作算两次', () => {
    const t = new ActivityTracker();
    t.begin(0);
    t.touch();
    (t as unknown as { lastTurnAt: number }).lastTurnAt = Date.now() - 2_000;
    t.touch();
    makeLong(t);
    expect(t.end()?.turns).toBe(2);
  });

  it('一次都没动过就不写这个字段', () => {
    const t = new ActivityTracker();
    t.begin(0);
    makeLong(t);
    expect(t.end()?.turns).toBeUndefined();
  });
});

describe('ActivityTracker · 听书秒数', () => {
  it('播放 - 暂停 的净时长进会话，且是有效时长的子集口径', () => {
    const t = new ActivityTracker();
    t.begin(0);
    makeLong(t);
    const now = Date.now();
    t.ttsPlay(now - 10_000);
    t.ttsPause(now - 4_000);
    expect(t.ttsSeconds).toBe(6);
    expect(t.end()?.ttsSeconds).toBe(6);
  });

  it('重复 play 不重置起点，重复 pause 不重复扣', () => {
    const t = new ActivityTracker();
    t.begin(0);
    makeLong(t);
    const now = Date.now();
    t.ttsPlay(now - 5_000);
    t.ttsPlay(now - 4_000);
    t.ttsPause(now - 3_000);
    t.ttsPause(now - 1_000);
    expect(t.ttsSeconds).toBe(2);
  });

  it('没听过就不写 ttsSeconds（老形状）', () => {
    const t = new ActivityTracker();
    t.begin(0);
    makeLong(t);
    expect(t.end()?.ttsSeconds).toBeUndefined();
  });

  it('新会话从 0 起算，不把上一段的听书时长带过去', () => {
    const t = new ActivityTracker();
    t.begin(0);
    const now = Date.now();
    t.ttsPlay(now - 3_000);
    t.ttsPause(now);
    makeLong(t);
    t.end();
    t.begin(0);
    expect(t.ttsSeconds).toBe(0);
    t.end();
  });
});

describe('ActivityTracker · 按章计时', () => {
  it('同一章的秒数攒在一起，切章结账后归零', () => {
    const t = new ActivityTracker();
    t.begin(0);
    t.setChapterKey('ch:1');
    const inner = t as unknown as { chapterAcc: number };
    inner.chapterAcc = 42;
    const tick = t.takeChapter();
    expect(tick).toEqual({ key: 'ch:1', seconds: 42 });
    expect(t.takeChapter()).toBeNull();
  });

  it('没有章 key 时不攒，也不产出账面', () => {
    const t = new ActivityTracker();
    t.begin(0);
    (t as unknown as { chapterAcc: number }).chapterAcc = 30;
    expect(t.takeChapter()).toBeNull();
  });

  it('不足 1 秒的零头不落账', () => {
    const t = new ActivityTracker();
    t.begin(0);
    t.setChapterKey('ch:0');
    (t as unknown as { chapterAcc: number }).chapterAcc = 0.4;
    expect(t.takeChapter()).toBeNull();
  });
});
