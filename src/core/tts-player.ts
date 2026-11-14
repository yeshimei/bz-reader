/* ============================================================
 * bz-reader · 朗读播放器（core/tts-player.ts）
 *
 * 把「一段一段的脚本」变成「一段一段的声音」。职责只有四件：
 *   1. 当前段合成好就播，播完自动接下一段；
 *   2. 持续把后面的段备好（不然每段之间都要等网络）；
 *   3. 暂停 / 继续 / 跳段 / 停止；
 *   4. 语速（DeepSeek 接口不支持，只能播放时变速）。
 *
 * 用 <audio> 而不是 Web Audio 的流式 PCM：听书要能变速、要能后台播放，
 * 流式那套两样都难做；代价是每段要等整段合成完，靠预取盖过去。
 *
 * 预取是「队列」而不是「播完一段催一段」（2026-11-14 改）：本地模型一句
 * 要合 3–8 秒、只听 2–3 秒，等上一段开声才去要下一段，实际缓冲只有一段，
 * 于是每次都卡。现在开声的同时就开始备，并一直把缓冲池填到 `bufferAhead`。
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
  /**
   * 缓冲深度：当前段之后最多备好几段。
   *
   * 云端按字数计费，备多了就是用户没听就先把钱花了，所以默认 3；本地
   * 免费，整页都备（`Infinity`）才是「读一句卡半天」的正解。
   */
  bufferAhead?: number;
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

/** 按段挑声音：角色标注（男女）需要逐段决定，不能只按旁白/对白两类 */
export type TtsVoicePicker = (segment: ScriptSegment) => TtsVoice;

interface Ready {
  url: string;
  audio: TtsAudioLike;
}

/** 默认缓冲深度：云端按字计费，备 3 段够盖住一次网络往返 */
const DEFAULT_AHEAD = 3;

/**
 * 同时在途的合成请求上限。
 *
 * 2 是「当前段 + 一段预取」：再多，本地服务也不会更快（它是串行的），
 * 云端则只多花钱、不多出缓冲。
 */
const MAX_INFLIGHT = 2;

function defaultMakeUrl(buf: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function defaultRevoke(url: string): void {
  URL.revokeObjectURL(url);
}

export class TtsPlayer {
  private readonly segments: readonly ScriptSegment[];
  private readonly voices: TtsVoicePair | TtsVoicePicker;
  private readonly deps: TtsPlayerDeps;
  private readonly buffer: number;
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
  /** 这一轮里已知备不出来的段（审核拒 / 合不出来）：预取别死循环重试 */
  private readonly skipped = new Set<number>();
  /** 在途合成数（当前段也算），用来卡住并发上限 */
  private inflight = 0;

  private readonly makeAudio: (url: string) => TtsAudioLike;
  private readonly makeUrl: (buf: ArrayBuffer) => string;
  private readonly revokeUrl: (url: string) => void;

  constructor(segments: readonly ScriptSegment[], voices: TtsVoicePair | TtsVoicePicker, deps: TtsPlayerDeps) {
    this.segments = segments;
    this.voices = voices;
    this.deps = deps;
    const ahead = deps.bufferAhead;
    this.buffer = ahead === undefined ? DEFAULT_AHEAD : ahead === Infinity ? Infinity : Math.max(1, ahead);
    this.makeAudio = deps.makeAudio ?? ((url) => new Audio(url) as unknown as TtsAudioLike);
    this.makeUrl = deps.makeUrl ?? defaultMakeUrl;
    this.revokeUrl = deps.revokeUrl ?? defaultRevoke;
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
      /* 暂停期间没有新请求，这里把缓冲补回去 */
      this.fill();
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
    this.skipped.clear();
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
    this.prune(index);
    /* 轮到这一段就重新试一次：预取时失败过，不代表它一定念不出来 */
    this.skipped.delete(index);
    this.setState('loading');
    /* 先起火再发声：预取和当前段并行，不要等第一段开始播才去要第二段 */
    this.fill();

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
      this.fill();
    });
  }

  private voiceOf(seg: ScriptSegment): TtsVoice {
    if (typeof this.voices === 'function') return this.voices(seg);
    return seg.kind === 'dialogue' ? this.voices.dialogue : this.voices.narration;
  }

  private async acquire(index: number, token: number): Promise<Ready | null> {
    this.inflight++;
    try {
      return await this.acquireInner(index, token);
    } finally {
      this.inflight = Math.max(0, this.inflight - 1);
    }
  }

  private async acquireInner(index: number, token: number): Promise<Ready | null> {
    const ready = this.ready.get(index);
    if (ready) {
      this.ready.delete(index);
      return ready;
    }
    const seg = this.segments[index];
    if (!seg) return null;
    const voice = this.voiceOf(seg);
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
      const url = this.makeUrl(buf);
      const audio = this.makeAudio(url);
      return { url, audio };
    } catch (e) {
      if (token !== this.token) return null;
      const code = (e as { code?: TtsErrorCode })?.code ?? 'http';
      this.skipped.add(index);
      /* 内容审核拒了这一段：跳过它继续念，别让整页哑掉。
         审核是逐段命中的，后面几段通常没问题。 */
      if (code === 'rejected') {
        this.deps.onError?.(code, e);
        if (index === this.index && this.wantPlay) this.begin(index + 1);
        return null;
      }
      /* 预取失败不打断正在念的这一段，也不弹提示（整页预取会弹满屏）；
         轮到它时 `begin` 会重试一次，那时再失败才算真失败。 */
      if (index === this.index) this.fail(code, e, token);
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

  /**
   * 把缓冲池填到 `bufferAhead`。
   *
   * 一次只起一个（并发上限 2，当前段占掉一个），成功一个再补一个：
   * 这样缓冲是「连续供水」，不是一次性发一堆请求。
   */
  private fill(): void {
    const token = this.token;
    while (this.wantPlay && this.state !== 'paused' && this.inflight < MAX_INFLIGHT) {
      const next = this.nextToFetch();
      if (next < 0) break;
      this.pending.add(next);
      void this.acquire(next, token)
        .then((got) => {
          if (!got) return;
          if (token !== this.token) {
            this.dispose(got);
            return;
          }
          this.ready.set(next, got);
          this.prune(this.index);
        })
        .catch(() => undefined)
        .finally(() => {
          this.pending.delete(next);
          if (token === this.token) this.fill();
        });
    }
  }

  /** 下一个该备的段；都已经备好或已知备不出来就返回 -1 */
  private nextToFetch(): number {
    const start = Math.max(this.index + 1, 0);
    const end = Math.min(this.segments.length - 1, this.index + this.buffer);
    for (let i = start; i <= end; i++) {
      if (this.ready.has(i) || this.pending.has(i) || this.skipped.has(i)) continue;
      return i;
    }
    return -1;
  }

  /**
   * 丢掉窗口外的缓冲：跳段 / 往回跳之后不该继续占内存。
   *
   * 窗口是 `[index, index + buffer]`：`index` 这一项要留着——它很可能
   * 就是预取准备好的当前段，丢掉等于白合一遍。
   */
  private prune(index: number): void {
    const keepTo = this.buffer === Infinity ? Number.POSITIVE_INFINITY : index + this.buffer;
    for (const [i, r] of this.ready) {
      if (i < index || i > keepTo) {
        this.ready.delete(i);
        this.dispose(r);
      }
    }
  }

  private fail(code: TtsErrorCode | 'audio', error: unknown, token: number): void {
    if (token !== this.token) return;
    this.wantPlay = false;
    this.token++;
    this.ctrl?.abort();
    this.ctrl = null;
    this.releaseAll();
    this.skipped.clear();
    this.setState('idle');
    this.deps.onError?.(code, error);
  }

  private finish(): void {
    this.wantPlay = false;
    this.releaseAll();
    this.skipped.clear();
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
    this.revokeUrl(ready.url);
  }

  private setState(state: TtsPlayerState): void {
    this.state = state;
    this.deps.onState?.(state, this.index);
  }
}
