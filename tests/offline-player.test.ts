/* ============================================================
 * bz-reader · 离线朗读播放器（tests/offline-player.test.ts）
 *
 * 用假 <audio> 跑状态机：真实播放器没法在 node 里出声，但「点下一句该
 * 跳到哪、正文改过之后该跳过哪几句、播到底该不该收尾」全是纯逻辑。
 *
 * 2026-11-14 换成「一句一个音频对象」之后，起播不再靠 currentTime：
 * 清单里每句有精确字节区间，播放器切出那一句单独建 <audio> 从 0 播完，
 * 再接下一句。所以断言看的是「现在放的是第几句」，不是秒数。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { OfflinePlayer, type OfflineAudioLike } from '../src/core/offline-player';
import { buildMarks, type OfflineMark } from '../src/core/offline-pack';

class FakeAudio implements OfflineAudioLike {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  played = 0;
  readyState = 4;
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

const TEXTS = ['甲', '乙', '丙'];
const MS = [1000, 1000, 1000];
/** 每句在章文件里的精确字节区间：拼文件的时候量的 */
const SLICES = [
  { off: 0, bytes: 3 },
  { off: 3, bytes: 3 },
  { off: 6, bytes: 3 },
];
const MARKS: OfflineMark[] = buildMarks(TEXTS, MS, SLICES);
/** 老包 / wav 包没有区间：退回整章播放 + 时间轴高亮 */
const PLAIN_MARKS: OfflineMark[] = buildMarks(TEXTS, MS);
const DATA = new Uint8Array(9).buffer;

interface Rig {
  player: OfflinePlayer;
  readonly audio: FakeAudio;
  audios: FakeAudio[];
  sentences: number[];
  readonly ends: number;
  readonly errors: unknown[];
  states: string[];
  loads: () => number;
  revoked: string[];
  urls: number[];
  play(): Promise<void>;
}

function rig(over: {
  marks?: OfflineMark[];
  align?: number[];
  audio?: FakeAudio;
  data?: ArrayBuffer;
  plain?: boolean;
  /** 模拟读盘抛错：文件没拷全、权限不够等 */
  loadError?: unknown;
} = {}): Rig {
  const audios: FakeAudio[] = [];
  const sentences: number[] = [];
  const revoked: string[] = [];
  const urls: number[] = [];
  let ends = 0;
  const errors: unknown[] = [];
  let loads = 0;
  const states: string[] = [];
  const player = new OfflinePlayer({
    marks: over.marks ?? (over.plain ? PLAIN_MARKS : MARKS),
    align: over.align ?? [0, 1, 2],
    loadAudio: async () => {
      loads++;
      if (over.loadError !== undefined) throw over.loadError;
      return over.data ?? DATA;
    },
    makeAudio: () => {
      const a = over.audio ?? new FakeAudio();
      audios.push(a);
      return a;
    },
    makeUrl: (buf) => {
      urls.push(buf.byteLength);
      return 'blob:test';
    },
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
    get audio() {
      return audios[audios.length - 1];
    },
    audios,
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
    urls,
    play: flush,
  };
}

describe('逐句起播', () => {
  it('从第 0 句开始：只把第 0 句的字节交给 audio，回调报第 0 句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    expect(r.urls).toEqual([3]);
    expect(r.audio.currentTime).toBe(0);
    expect(r.audio.played).toBe(1);
    expect(r.sentences).toEqual([0]);
    expect(r.player.stateName).toBe('playing');
  });

  it('从第 2 句开始：只切第 2 句，不会从章首念', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    expect(r.urls).toEqual([3]); /* 仍是「一句」的长度，不是整章 */
    expect(r.audio.currentTime).toBe(0);
    expect(r.player.textIndex).toBe(2);
    expect(r.sentences).toEqual([2]);
  });

  it('整章音频只读一次：换句不重复读盘', async () => {
    const r = rig();
    expect(r.loads()).toBe(0);
    r.player.start(0);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.loads()).toBe(1);
  });

  it('不看 readyState：音频一建出来就响', async () => {
    const audio = new FakeAudio();
    audio.readyState = 0;
    const r = rig({ audio });
    r.player.start(2);
    await r.play();
    expect(audio.played).toBe(1);
    expect(r.sentences).toEqual([2]);
  });

  it('起播后被叫停，之后不再偷偷播起来', async () => {
    const r = rig();
    r.player.start(1);
    await r.play();
    r.player.stop();
    await r.play();
    expect(r.audio.played).toBe(1);
  });

  it('句内偏移被忽略：一句一个文件，没有中间起播', async () => {
    /* 段落跨页时最多差一句开头，但绝不会退回章首 */
    const r = rig();
    r.player.start(1, 500);
    await r.play();
    expect(r.audio.currentTime).toBe(0);
    expect(r.player.textIndex).toBe(1);
    expect(r.sentences).toEqual([1]);
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

describe('逐句接龙', () => {
  it('一句播完自动接下一句，每次都是一句的新音频', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    expect(r.sentences).toEqual([0, 1]);
    expect(r.urls).toEqual([3, 3]);
    expect(r.player.textIndex).toBe(1);
  });

  it('最后一句播完收尾', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    expect(r.ends).toBe(1);
    expect(r.player.stateName).toBe('idle');
  });

  it('逐句模式下 timeupdate 不把高亮拉回章首', async () => {
    const r = rig();
    r.player.start(2);
    await r.play();
    r.audio.currentTime = 0.2;
    r.audio.fire('timeupdate');
    expect(r.sentences).toEqual([2]);
  });
});

describe('跳句', () => {
  it('下一句跳到下一句，跳过没音频的句子', async () => {
    const r = rig({ align: [0, -1, 2] });
    r.player.start(0);
    await r.play();
    r.player.next();
    await r.play();
    expect(r.sentences).toEqual([0, 2]);
    expect(r.player.textIndex).toBe(2);
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

describe('暂停 / 继续 / 停止', () => {
  it('暂停后再继续，还从原位置播', async () => {
    const r = rig();
    r.player.start(1);
    await r.play();
    r.player.pause();
    r.player.resume();
    expect(r.audio.played).toBe(2);
  });

  it('停止会解绑事件、收回 blob', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.stop();
    expect(r.audio.paused).toBe(true);
    expect(r.revoked.length).toBeGreaterThan(0);
    expect(r.audio.listenerCount('timeupdate')).toBe(0);
    expect(r.player.stateName).toBe('idle');
  });

  it('停止后晚到的 ended 不再触发跳句', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.stop();
    r.audio.fire('ended');
    await r.play();
    expect(r.sentences).toEqual([0]);
  });
});

describe('语速', () => {
  it('设置后立刻作用到播放中的音频', async () => {
    const r = rig();
    r.player.start(0);
    await r.play();
    r.player.setRate(1.5);
    expect(r.audio.playbackRate).toBe(1.5);
    r.player.setRate(9);
    expect(r.audio.playbackRate).toBe(2);
    r.player.setRate(0.1);
    expect(r.audio.playbackRate).toBe(0.6);
  });
});

describe('老包 / wav 包（没有逐句区间）', () => {
  it('整章一次播完，高亮按时间轴推', async () => {
    const r = rig({ plain: true });
    r.player.start(0);
    await r.play();
    expect(r.urls).toEqual([DATA.byteLength]);
    r.audio.currentTime = 1.2;
    r.audio.fire('timeupdate');
    expect(r.sentences).toEqual([0, 1]);
  });

  it('整章播完就收尾，不会从头重放', async () => {
    const r = rig({ plain: true });
    r.player.start(0);
    await r.play();
    r.audio.fire('ended');
    await r.play();
    expect(r.ends).toBe(1);
    expect(r.urls).toEqual([DATA.byteLength]);
  });

  it('逐句区间越界：当作没有区间，退回整章播放', async () => {
    const r = rig({ data: new Uint8Array(2).buffer });
    r.player.start(0);
    await r.play();
    expect(r.urls).toEqual([2]);
    expect(r.sentences).toEqual([0]);
  });
});

describe('读音频失败', () => {
  it('读盘抛错时报错并回到 idle，不卡在 loading', async () => {
    const r = rig({ loadError: new Error('read failed') });
    r.player.start(0);
    await r.play();
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.player.stateName).toBe('idle');
    expect(r.loads()).toBe(1);
  });

  it('读出来是空文件：同样报错并回到 idle', async () => {
    const r = rig({ data: new ArrayBuffer(0) });
    r.player.start(0);
    await r.play();
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.player.stateName).toBe('idle');
  });
});

describe('清单和音频不是同一份（同步只落半个文件 / 中途换过包）', () => {
  it('只有部分区间越界时也报错，不把整章当这一句反复放', async () => {
    /* 6 字节：前两句能切、第三句越界。sliceMode 已经判成 true，
       旧逻辑会退回整章缓冲，用户听到同一章循环几十遍 */
    const r = rig({ data: new Uint8Array(6).buffer });
    r.player.start(2);
    await r.play();
    expect(r.errors.length).toBe(1);
    expect(r.urls).toEqual([]);
    expect(r.player.stateName).toBe('idle');
  });
});

describe('暂停 / 停止之后不再自己开播', () => {
  it('读盘途中按停止，跳句的回调回来不建 audio', async () => {
    /* 读整章要几十毫秒到几秒，这中间用户点停止；旧逻辑 jump 的回调
       只判「读成功了」，回来照样 playFrom，停了又自己响起来 */
    let release: (b: ArrayBuffer) => void = () => undefined;
    const pending = new Promise<ArrayBuffer>((resolve) => {
      release = resolve;
    });
    const audios: FakeAudio[] = [];
    const player = new OfflinePlayer({
      marks: MARKS,
      align: [0, 1, 2],
      loadAudio: () => pending,
      makeAudio: () => {
        const a = new FakeAudio();
        audios.push(a);
        return a;
      },
      makeUrl: () => 'blob:test',
      revokeUrl: () => undefined,
    });
    player.start(0);
    player.next();
    player.stop();
    release(DATA);
    await flush();
    await flush();
    expect(audios.length).toBe(0);
    expect(player.stateName).not.toBe('playing');
  });
});
