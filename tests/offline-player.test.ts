/* ============================================================
 * bz-reader · 离线朗读播放器（tests/offline-player.test.ts）
 *
 * 用假 <audio> 跑状态机：真实播放器没法在 node 里出声，但「点下一句该
 * 跳到哪、正文改过之后该跳过哪几句、播到底该不该收尾」全是纯逻辑。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { OfflinePlayer, type OfflineAudioLike } from '../src/core/offline-player';
import { buildMarks, type OfflineMark } from '../src/core/offline-pack';

class FakeAudio implements OfflineAudioLike {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  played = 0;
  private listeners: Record<string, Array<() => void>> = {};

  play(): Promise<void> {
    this.paused = false;
    this.played++;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== listener);
  }

  fire(type: string): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn();
  }

  listenerCount(type: string): number {
    return (this.listeners[type] ?? []).length;
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const MARKS: OfflineMark[] = buildMarks(['甲', '乙', '丙'], [1000, 1000, 1000]);

interface Rig {
  player: OfflinePlayer;
  audio: FakeAudio;
  sentences: number[];
  ends: number;
  errors: unknown[];
  states: string[];
  loads: () => number;
  revoked: string[];
  play(): Promise<void>;
}

function rig(over: {
  marks?: OfflineMark[];
  align?: number[];
  audio?: FakeAudio;
  data?: ArrayBuffer;
} = {}): Rig {
  const audio = over.audio ?? new FakeAudio();
  const sentences: number[] = [];
  const revoked: string[] = [];
  let ends = 0;
  let errors: unknown[] = [];
  let loads = 0;
  const states: string[] = [];
  const player = new OfflinePlayer({
    marks: over.marks ?? MARKS,
    align: over.align ?? [0, 1, 2],
    loadAudio: async () => {
      loads++;
      return over.data ?? new Uint8Array([1, 2, 3]).buffer;
    },
    makeAudio: () => audio,
    makeUrl: () => 'blob:test',
    revokeUrl: (url) => revoked.push(url),
    onSentence: (i) => sentences.push(i),
    onState: (s) => states.push(s),
    onEnd: () => {
      ends++;
    },
    onError: (e) => errors.push(e),
  });
  return {
    player,
    audio,
    sentences,
    get ends() {
      return ends;
    },
    get errors() {
      return errors;
    },
    states,
    loads: () => loads,
    revoked,
    play: flush,
  };
}

describe('起播', () => {
  it('从第 0 句开始：seek 到 0，回调报第 0 句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    expect(r.audio.currentTime).toBe(0);
    expect(r.audio.played).toBe(1);
    expect(r.sentences).toEqual([0]);
    expect(r.player.stateName).toBe('playing');
  });

  it('从第 2 句开始：seek 到它的起点', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    expect(r.audio.currentTime).toBe(2);
    expect(r.sentences).toEqual([2]);
  });

  it('音频只在真正要播的时候读一次', async () => {
    const r = rig();
    expect(r.loads()).toBe(0);
    r.player.start(0);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.loads()).toBe(1);
  });

  it('整章一句能播的都没有：直接收尾，不报错', async () => {
    const r = rig({ align: [-1, -1, -1] });
    r.player.start(0);
    await r.play();
    expect(r.ends).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.loads()).toBe(0);
  });
});

describe('时间轴驱动高亮', () => {
  it('播到第二句时报第二句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.audio.currentTime = 1.2;
    r.audio.fire('timeupdate');
    expect(r.sentences).toEqual([0, 1]);
  });

  it('同一句里连续 timeupdate 不重复回调', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    for (const t of [0.1, 0.2, 0.9]) {
      r.audio.currentTime = t;
      r.audio.fire('timeupdate');
    }
    expect(r.sentences).toEqual([0]);
  });

  it('拖回上一句时高亮跟着回去', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    r.audio.currentTime = 0.4;
    r.audio.fire('timeupdate');
    expect(r.sentences).toEqual([2, 0]);
  });

  it('暂停后 timeupdate 不再改高亮', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.pause();
    r.audio.currentTime = 2.5;
    r.audio.fire('timeupdate');
    expect(r.sentences).toEqual([0]);
    expect(r.player.stateName).toBe('paused');
  });
});

describe('跳句', () => {
  it('下一句 seek 到下一段起点', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.audio.currentTime).toBe(1);
    expect(r.sentences).toEqual([0, 1]);
  });

  it('下一句会跳过正文里没有音频的句子', async () => {
    const r = rig({ align: [0, -1, 2] });
    r.player.start(0);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.sentences).toEqual([0, 2]);
  });

  it('上一句同样跳过没音频的句子', async () => {
    const r = rig({ align: [0, -1, 2] });
    r.player.start(2);
    await r.play();
    r.player.prev();
    await r.play();
    expect(r.sentences).toEqual([2, 0]);
  });

  it('最后一句再按下一句就收尾', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.ends).toBe(1);
  });

  it('第一句按上一句原地不动，不报错', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.prev();
    await r.play();
    expect(r.sentences).toEqual([0]);
    expect(r.ends).toBe(0);
  });
});

describe('播完一章', () => {
  it('中途 ended 自动接下一句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    expect(r.sentences).toEqual([0, 1]);
  });

  it('最后一句 ended 收尾', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    expect(r.ends).toBe(1);
    expect(r.player.stateName).toBe('idle');
  });
});

describe('暂停 / 继续 / 停止', () => {
  it('暂停后再继续，还从原位置播', async () => {
    const r = rig();
    r.player.start(1);
    await r.play();
    r.player.pause();
    r.audio.currentTime = 1.6;
    r.player.resume();
    expect(r.audio.played).toBe(2);
    expect(r.audio.currentTime).toBe(1.6);
  });

  it('停止会解绑事件、收回 blob', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.stop();
    expect(r.audio.paused).toBe(true);
    expect(r.revoked).toEqual(['blob:test']);
    expect(r.audio.listenerCount('timeupdate')).toBe(0);
    expect(r.player.stateName).toBe('idle');
  });

  it('停止后晚到的 ended 不再触发跳句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    const before = r.sentences.length;
    r.player.stop();
    r.audio.fire('ended');
    await r.play();
    expect(r.sentences.length).toBe(before);
  });
});

describe('语速', () => {
  it('设置后立刻作用到播放中的音频', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.setRate(1.5);
    expect(r.audio.playbackRate).toBe(1.5);
  });

  it('超出范围时夹到 0.6–2', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.setRate(9);
    expect(r.audio.playbackRate).toBe(2);
    r.player.setRate(0);
    expect(r.audio.playbackRate).toBe(0.6);
  });
});

describe('读音频失败', () => {
  it('读不到音频时报错并回到 idle，不卡在 loading', async () => {
    const r = rig({ marks: [], align: [] });
    r.player.start(0);
    await r.play();
    expect(r.ends).toBe(1);
  });
});
