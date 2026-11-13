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

function setup(opts: { text?: string; cached?: boolean } = {}) {
  const audios: FakeAudio[] = [];
  const synth = vi.fn(async () => new Uint8Array(opts.text ? opts.text.length : 4).buffer);
  const states: string[] = [];
  const onEnd = vi.fn();
  const onError = vi.fn();
  const player = new TtsPlayer(
    segments,
    { narration: 'stella', dialogue: 'tide' },
    {
      synthesize: synth,
      cacheKey: (text, voice) => `${voice}|${text}`,
      ...(opts.cached
        ? { cache: { get: async () => new Uint8Array([1, 2]).buffer, put: async () => undefined } }
        : {}),
      makeUrl: () => `blob:${audios.length}`,
      revokeUrl: () => undefined,
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
  return { player, audios, synth, states, onEnd, onError };
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
