/* ============================================================
 * bz-reader · 朗读播放器（core/tts-player.ts）
 *
 * 把「一段一段的脚本」变成「一段一段的声音」。职责只有四件：
 *   1. 当前段合成好就播，播完自动接下一段；
 *   2. 下一段提前合成（不然每段之间都停两秒等网络）；
 *   3. 暂停 / 继续 / 跳段 / 停止；
 *   4. 语速（DeepSeek 接口不支持，只能播放时变速）。
 *
 * 用 <audio> 而不是 Web Audio 的流式 PCM：听书要能变速、要能后台播放，
 * 流式那套两样都难做；代价是每段要等整段合成完，靠预取盖过去。
 *
 * 依赖全部注入（合成、缓存、audio 工厂）——这个类的状态机能在 node 里
 * 用假 audio 跑完，不需要真的出声。
 * ============================================================ */

import type { TtsErrorCode, TtsVoice } from './tts-api';
import type { ScriptSegment } from './tts-script';

export type TtsPlayerState = 'idle' | 'loading' | 'playing' | 'paused';

/** 只用到 <audio> 的这几个能力，假对象在测试里好造 */
export interface TtsAudioLike {
  playbackRate: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
  removeEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface TtsPlayerDeps {
  synthesize(text: string, voice: TtsVoice, signal: AbortSignal): Promise<ArrayBuffer>;
  cache?: {
    get(key: string): Promise<ArrayBuffer | null>;
    put(key: string, data: ArrayBuffer): Promise<void>;
  };
  cacheKey?: (text: string, voice: TtsVoice) => string;
  makeAudio?: (url: string) => TtsAudioLike;
  makeUrl?: (buf: ArrayBuffer) => string;
  revokeUrl?: (url: string) => void;
  onSegment?: (index: number, segment: ScriptSegment) => void;
  onState?: (state: TtsPlayerState, index: number) => void;
  onEnd?: () => void;
  onError?: (code: TtsErrorCode | 'audio', error: unknown) => void;
}

export interface TtsVoicePair {
  narration: TtsVoice;
  dialogue: TtsVoice;
}

interface Ready {
  url: string;
  audio: TtsAudioLike;
}

/** 预取几段。2 段够盖住一段合成的耗时，再多只是多花钱 */
const PREFETCH = 2;

function defaultMakeUrl(buf: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function defaultRevoke(url: string): void {
  URL.revokeObjectURL(url);
}

export class TtsPlayer {
  private readonly segments: readonly ScriptSegment[];
  private readonly voices: TtsVoicePair;
  private readonly deps: TtsPlayerDeps;
  private index = 0;
  private rate = 1;
  private state: TtsPlayerState = 'idle';
  /** 用户是否希望继续（暂停后为 false，stop 后为 false） */
  private wantPlay = false;
  /** 每次换段 / 停止 +1：旧请求回来时对不上就丢弃 */
  private token = 0;
  private ctrl: AbortController | null = null;
  private current: Ready | null = null;
  private endedHandler: (() => void) | null = null;
  private readonly ready = new Map<number, Ready>();
  private readonly pending = new Set<number>();

  constructor(segments: readonly ScriptSegment[], voices: TtsVoicePair, deps: TtsPlayerDeps) {
    this.segments = segments;
    this.voices = voices;
    this.deps = deps;
    const make = deps.makeAudio;
    if (!make) {
      deps.makeAudio = (url) => new Audio(url) as unknown as TtsAudioLike;
    }
    deps.makeUrl ??= defaultMakeUrl;
    deps.revokeUrl ??= defaultRevoke;
  }

  get total(): number {
    return this.segments.length;
  }

  get stateName(): TtsPlayerState {
    return this.state;
  }

  get currentIndex(): number {
    return this.index;
  }

  /** 从第一段（或指定段）开始 */
  start(index = 0): void {
    this.begin(index);
  }

  pause(): void {
    if (this.state !== 'playing' || !this.current) return;
    this.current.audio.pause();
    this.wantPlay = false;
    this.setState('paused');
  }

  resume(): void {
    if (this.state === 'paused' && this.current) {
      this.wantPlay = true;
      this.setState('playing');
      void this.current.audio.play().catch((e) => this.fail('audio', e, this.token));
      return;
    }
    if (this.state === 'idle') this.begin(this.index);
  }

  next(): void {
    if (this.index + 1 < this.segments.length) this.begin(this.index + 1);
  }

  prev(): void {
    this.begin(Math.max(0, this.index - 1));
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.6, Number.isFinite(rate) ? rate : 1));
    if (this.current) this.current.audio.playbackRate = this.rate;
  }

  stop(): void {
    this.wantPlay = false;
    this.token++;
    this.ctrl?.abort();
    this.ctrl = null;
    this.releaseAll();
    this.setState('idle');
  }

  private begin(index: number): void {
    if (!this.segments.length) {
      this.finish();
      return;
    }
    if (index < 0) index = 0;
    if (index >= this.segments.length) {
      this.finish();
      return;
    }
    this.wantPlay = true;
    this.index = index;
    this.token++;
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    const token = this.token;
    this.releaseCurrent();
    this.setState('loading');

    void this.acquire(index, token).then((got) => {
      if (!got) return;
      if (token !== this.token || !this.wantPlay) {
        this.dispose(got);
        return;
      }
      this.current = got;
      got.audio.playbackRate = this.rate;
      this.bindEnded(got, index);
      this.setState('playing');
      this.deps.onSegment?.(index, this.segments[index]);
      void got.audio.play().catch((e) => this.fail('audio', e, token));
      this.prefetch(index + 1);
    });
  }

  private async acquire(index: number, token: number): Promise<Ready | null> {
    const ready = this.ready.get(index);
    if (ready) {
      this.ready.delete(index);
      return ready;
    }
    const seg = this.segments[index];
    if (!seg) return null;
    const voice = seg.kind === 'dialogue' ? this.voices.dialogue : this.voices.narration;
    const key = this.deps.cacheKey?.(seg.text, voice) ?? `${voice}|${seg.text.length}`;
    try {
      let buf: ArrayBuffer | null = null;
      if (this.deps.cache) {
        buf = await this.deps.cache.get(key).catch(() => null);
      }
      if (!buf) {
        buf = await this.deps.synthesize(seg.text, voice, this.ctrl?.signal ?? new AbortController().signal);
        if (token !== this.token) return null;
        if (this.deps.cache && this.deps.cacheKey) {
          void this.deps.cache.put(key, buf).catch(() => undefined);
        }
      }
      const url = (this.deps.makeUrl ?? defaultMakeUrl)(buf);
      const audio = (this.deps.makeAudio as (u: string) => TtsAudioLike)(url);
      return { url, audio };
    } catch (e) {
      if (token !== this.token) return null;
      const code = (e as { code?: TtsErrorCode })?.code ?? 'http';
      if (code === 'rejected') {
        /* 内容审核拒了这一段：跳过它继续念，别让整页哑掉。
           审核是逐段命中的，后面几段通常没问题。 */
        this.deps.onError?.(code, e);
        if (token === this.token && this.wantPlay) this.begin(index + 1);
        return null;
      }
      this.fail(code, e, token);
      return null;
    }
  }

  private bindEnded(ready: Ready, index: number): void {
    const onEnded = (): void => {
      if (this.index !== index || !this.wantPlay) return;
      this.releaseCurrent();
      this.begin(index + 1);
    };
    this.endedHandler = onEnded;
    ready.audio.addEventListener('ended', onEnded);
    ready.audio.addEventListener('error', () => this.fail('audio', new Error('audio playback failed'), this.token));
  }

  private prefetch(index: number): void {
    if (index >= this.segments.length || this.ready.has(index) || this.pending.has(index)) return;
    const token = this.token;
    this.pending.add(index);
    void this.acquire(index, token)
      .then((got) => {
        this.pending.delete(index);
        if (!got) return;
        if (token !== this.token) {
          this.dispose(got);
          return;
        }
        this.ready.set(index, got);
        /* 只留 current + 1 段：预取太多会让暂停后还在后台烧钱 */
        for (const [i, r] of this.ready) {
          if (i > this.index + PREFETCH) {
            this.ready.delete(i);
            this.dispose(r);
          }
        }
      })
      .catch(() => this.pending.delete(index));
  }

  private fail(code: TtsErrorCode | 'audio', error: unknown, token: number): void {
    if (token !== this.token) return;
    this.wantPlay = false;
    this.token++;
    this.ctrl?.abort();
    this.ctrl = null;
    this.releaseAll();
    this.setState('idle');
    this.deps.onError?.(code, error);
  }

  private finish(): void {
    this.wantPlay = false;
    this.releaseAll();
    this.setState('idle');
    this.deps.onEnd?.();
  }

  private releaseCurrent(): void {
    if (!this.current) return;
    if (this.endedHandler) {
      this.current.audio.removeEventListener('ended', this.endedHandler);
      this.endedHandler = null;
    }
    this.current.audio.pause();
    this.dispose(this.current);
    this.current = null;
  }

  private releaseAll(): void {
    this.releaseCurrent();
    for (const r of this.ready.values()) this.dispose(r);
    this.ready.clear();
    this.pending.clear();
  }

  private dispose(ready: Ready): void {
    try {
      ready.audio.pause();
    } catch {
      /* 已经释放过的音频再 pause 会抛，忽略 */
    }
    (this.deps.revokeUrl ?? defaultRevoke)(ready.url);
  }

  private setState(state: TtsPlayerState): void {
    this.state = state;
    this.deps.onState?.(state, this.index);
  }
}
