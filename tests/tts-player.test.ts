import { describe, expect, it, vi } from 'vitest';
import type { ScriptSegment } from '../src/core/tts-script';
import { TtsPlayer, type TtsAudioLike } from '../src/core/tts-player';

class FakeAudio implements TtsAudioLike {
  playbackRate = 1;
  paused = true;
  private handlers = new Map<'ended' | 'error', Set<() => void>>();
  constructor(readonly src: string) {}
  async play(): Promise<void> {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: 'ended' | 'error', fn: () => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: 'ended' | 'error', fn: () => void): void {
    this.handlers.get(type)?.delete(fn);
  }
  emit(type: 'ended' | 'error'): void {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
}

const segments: ScriptSegment[] = [
  { kind: 'narration', text: '他推开门。', blocks: [0] },
  { kind: 'dialogue', text: '谁？', blocks: [1] },
  { kind: 'narration', text: '一个女人的声音。', blocks: [2] },
];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function setup(
  opts: {
    text?: string;
    cached?: boolean;
    bufferAhead?: number;
    list?: ScriptSegment[];
    synth?: (text: string) => Promise<ArrayBuffer>;
  } = {},
) {
  const audios: FakeAudio[] = [];
  const synth = vi.fn(
    opts.synth ?? (async () => new Uint8Array(opts.text ? opts.text.length : 4).buffer),
  );
  const states: string[] = [];
  const onEnd = vi.fn();
  const onError = vi.fn();
  const revokeUrl = vi.fn();
  const player = new TtsPlayer(
    opts.list ?? segments,
    { narration: 'stella', dialogue: 'tide' },
    {
      synthesize: (text) => synth(text),
      cacheKey: (text, voice) => `${voice}|${text}`,
      ...(opts.cached
        ? { cache: { get: async () => new Uint8Array([1, 2]).buffer, put: async () => undefined } }
        : {}),
      ...(opts.bufferAhead !== undefined ? { bufferAhead: opts.bufferAhead } : {}),
      makeUrl: () => `blob:${audios.length}`,
      revokeUrl,
      makeAudio: (url) => {
        const a = new FakeAudio(url);
        audios.push(a);
        return a;
      },
      onState: (s) => states.push(s),
      onEnd,
      onError,
    },
  );
  return { player, audios, synth, states, onEnd, onError, revokeUrl };
}

describe('播放器状态机', () => {
  it('开始播放第一段，状态从 loading 到 playing', async () => {
    const { player, audios, states } = setup();
    player.start();
    await flush();
    expect(states).toContain('loading');
    expect(states).toContain('playing');
    expect(audios.some((a) => !a.paused)).toBe(true);
  });

  it('一段念完自动接下一段，最后一段念完回调 onEnd', async () => {
    const { player, audios, onEnd } = setup();
    player.start();
    await flush();
    for (let i = 0; i < segments.length; i++) {
      const current = audios.find((a) => !a.paused);
      expect(current).toBeTruthy();
      current!.emit('ended');
      /* 真实 <audio> 播完就停了；假对象手动标一下，下一步才能找到新的一段 */
      current!.paused = true;
      await flush();
    }
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('暂停后不再播放，继续后接着放', async () => {
    const { player, audios } = setup();
    player.start();
    await flush();
    const audio = audios.find((a) => !a.paused)!;
    player.pause();
    expect(audio.paused).toBe(true);
    player.resume();
    expect(audio.paused).toBe(false);
  });

  it('停止之后播完也不再往下接', async () => {
    const { player, audios, onEnd } = setup();
    player.start();
    await flush();
    const audio = audios.find((a) => !a.paused)!;
    player.stop();
    audio.emit('ended');
    await flush();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('换段时把语速应用到新音频', async () => {
    const { player, audios } = setup();
    player.setRate(1.4);
    player.start();
    await flush();
    expect(audios.find((a) => !a.paused)?.playbackRate).toBe(1.4);
  });
});

describe('播放器的缓存与失败', () => {
  it('缓存命中就不再请求合成', async () => {
    const { player, synth } = setup({ cached: true });
    player.start();
    await flush();
    expect(synth).not.toHaveBeenCalled();
  });

  it('合成失败回调 onError，并停下（不自动跳下一段）', async () => {
    const audios: FakeAudio[] = [];
    const synth = vi.fn(async () => {
      throw Object.assign(new Error('401'), { code: 'unauthorized' });
    });
    const onError = vi.fn();
    const player = new TtsPlayer(segments, { narration: 'stella', dialogue: 'tide' }, {
      synthesize: synth,
      makeUrl: () => 'blob:x',
      revokeUrl: () => undefined,
      makeAudio: (url) => {
        const a = new FakeAudio(url);
        audios.push(a);
        return a;
      },
      onError,
    });
    player.start();
    await flush();
    expect(onError).toHaveBeenCalledWith('unauthorized', expect.any(Error));
    expect(audios).toHaveLength(0);
  });
});

/* 一批更长的段：缓冲池的行为要跨过 3 段才看得出来 */
const many: ScriptSegment[] = Array.from({ length: 8 }, (_, i) => ({
  kind: 'narration' as const,
  text: `第 ${i + 1} 句。`,
  blocks: [i],
}));

describe('预取：开声前就把后面的音频备好', () => {
  it('开始播放时同时预取后面几段，不等第一段播完', async () => {
    const { player, synth, audios } = setup({ list: many });
    player.start();
    await flush();
    /* 默认缓冲 3 段：正在播的一段 + 备好三段 */
    expect(audios).toHaveLength(4);
    expect(synth).toHaveBeenCalledTimes(4);
  });

  it('bufferAhead 可调：云端只备 1 段', async () => {
    const { player, audios } = setup({ bufferAhead: 1 });
    player.start();
    await flush();
    expect(audios).toHaveLength(2);
  });

  it('整页缓冲（Infinity）把这一页全部备完', async () => {
    const { player, audios } = setup({ bufferAhead: Number.POSITIVE_INFINITY, list: many });
    player.start();
    await flush();
    await flush();
    expect(audios).toHaveLength(many.length);
  });

  it('念完一段立刻把缓冲补满', async () => {
    const { player, audios } = setup({ bufferAhead: 1 });
    player.start();
    await flush();
    expect(audios).toHaveLength(2);
    const cur = audios.find((a) => !a.paused)!;
    cur.emit('ended');
    cur.paused = true;
    await flush();
    expect(audios).toHaveLength(3);
  });

  it('暂停后不再发起新的合成', async () => {
    const { player, synth } = setup({ bufferAhead: 2, list: many });
    player.start();
    await flush();
    /* 缓冲 2 段 + 正在播的一段 */
    expect(synth.mock.calls.length).toBe(3);
    player.pause();
    await flush();
    expect(synth.mock.calls.length).toBe(3);
    /* 继续时缓冲还是满的，不该凭空多合一段 */
    player.resume();
    await flush();
    expect(synth.mock.calls.length).toBe(3);
  });

  it('继续之后念到下一段，仍然把缓冲补上', async () => {
    const { player, synth, audios } = setup({ bufferAhead: 1, list: many });
    player.start();
    await flush();
    expect(synth.mock.calls.length).toBe(2);
    const cur = audios.find((a) => !a.paused)!;
    player.pause();
    player.resume();
    cur.emit('ended');
    cur.paused = true;
    await flush();
    expect(synth.mock.calls.length).toBe(3);
  });

  it('停止后不再合成，已经备好的音频被释放', async () => {
    const { player, synth, revokeUrl } = setup({ bufferAhead: 2, list: many });
    player.start();
    await flush();
    const before = synth.mock.calls.length;
    player.stop();
    expect(revokeUrl.mock.calls.length).toBeGreaterThan(0);
    await flush();
    expect(synth.mock.calls.length).toBe(before);
    expect(player.stateName).toBe('idle');
  });

  it('后面某段被审核拒掉，不会把正在念的这段往前拽', async () => {
    const { player, onError } = setup({
      list: many.slice(0, 4),
      bufferAhead: Number.POSITIVE_INFINITY,
      synth: async (text) => {
        if (text === '第 3 句。') throw Object.assign(new Error('rejected'), { code: 'rejected' });
        return new Uint8Array(4).buffer;
      },
    });
    player.start();
    await flush();
    await flush();
    expect(player.currentIndex).toBe(0);
    expect(player.stateName).toBe('playing');
    expect(onError).toHaveBeenCalledWith('rejected', expect.any(Error));
  });
});
