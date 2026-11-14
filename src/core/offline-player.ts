/* ============================================================
 * bz-reader · 离线朗读播放器（core/offline-player.ts）
 *
 * 和 TtsPlayer 的区别：那个是「一段一个 blob，播完接下一段」，这个是
 * 「整章一个文件，靠时间轴推算现在念到哪一句」。
 *
 * 为什么要单独一个播放器而不是改造 TtsPlayer：整章连续播没有「合成」
 * 这一步，也没有预取、没有逐段失败重试；反过来它多了 seek、时间轴同步、
 * 跳句时要跨过「没有音频的句子」。两套状态机揉在一起，谁都不好读。
 *
 * 依赖全部注入（audio 工厂、URL 工厂），所以能在 node 里用假 audio 跑完，
 * 不需要真出声。
 * ============================================================ */

import { markIndexAt, type OfflineMark } from './offline-pack';


export type OfflineState = 'idle' | 'loading' | 'playing' | 'paused';



/** 只用到 <audio> 的这几个能力，假对象在测试里好造 */
export interface OfflineAudioLike {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  /** HAVE_NOTHING=0 … HAVE_ENOUGH_DATA=4；没实现就当成已就绪 */
  readyState?: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate' | 'loadedmetadata', listener: () => void): void;
  removeEventListener(type: 'ended' | 'error' | 'timeupdate' | 'loadedmetadata', listener: () => void): void;
}

export interface OfflinePlayerDeps {
  makeAudio: (url: string) => OfflineAudioLike;
  /** 读整章音频。第一次真正播放时才调用。 */
  loadAudio: () => Promise<ArrayBuffer>;
  makeUrl?: (buf: ArrayBuffer) => string;
  revokeUrl?: (url: string) => void;
  /**
   * 正文第 i 句对应清单里的第几段；-1 表示这句正文没有对应音频
   * （正文改过、或者这章重导过一部分）。
   */
  align: readonly number[];
  marks: readonly OfflineMark[];
  /** 现在念到正文第几句 */
  onSentence?: (textIndex: number) => void;
  onState?: (state: OfflineState) => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

function defaultMakeUrl(buf: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
}

function defaultRevoke(url: string): void {
  URL.revokeObjectURL(url);
}

export class OfflinePlayer {
  private readonly deps: OfflinePlayerDeps;
  private readonly marks: readonly OfflineMark[];
  private readonly align: readonly number[];
  /** 清单序号 → 正文序号。同一条音频可能对应多个正文句子时取第一个。 */
  private readonly back = new Map<number, number>();
  /** 正文里「有音频」的句子序号，按顺序 */
  private readonly audible: number[] = [];
  private audio: OfflineAudioLike | null = null;
  private url = '';
  /** 整章原始音频：逐句切分用，release 之后也留着，别重复读盘 */
  private buf: ArrayBuffer | null = null;
  /** 清单里有没有精确的逐句字节区间；null = 还没判定过 */
  private sliceMode: boolean | null = null;
  private state: OfflineState = 'idle';
  private wantPlay = false;
  private rate = 1;
  /** 当前正文句子序号；-1 表示还没开始 */
  private at = -1;
  private endedHandler: (() => void) | null = null;
  private tickHandler: (() => void) | null = null;

  constructor(deps: OfflinePlayerDeps) {
    this.deps = deps;
    this.marks = deps.marks;
    this.align = deps.align;
    this.align.forEach((mark, text) => {
      if (mark < 0 || mark >= this.marks.length) return;
      if (!this.back.has(mark)) this.back.set(mark, text);
      this.audible.push(text);
    });
  }

  get stateName(): OfflineState {
    return this.state;
  }

  get textIndex(): number {
    return this.at;
  }

  get total(): number {
    return this.align.length;
  }

  /** 这句正文有没有声音 */
  hasAudio(textIndex: number): boolean {
    const mark = this.align[textIndex];
    return mark !== undefined && mark >= 0 && mark < this.marks.length;
  }

  /**
   * 开始播（从第 textIndex 句起；找不到有音频的句子就从第一句能听到的开始）。
   *
   * `offsetMs`：从这一句的第几毫秒开始。段落跨页时，屏幕上这一页往往从
   * 段落中间起，整句音频只能从句首放——把多出来的那点尾巴跳掉，用户听到的
   * 才是「屏幕上第一个字」。
   */
  start(textIndex = 0, offsetMs = 0): void {
    const index = this.nextAudible(textIndex, 1);
    if (index < 0) {
      this.finish();
      return;
    }
    this.wantPlay = true;
    this.at = index;
    this.setState('loading');
    void this.ensure(index).then((ok) => {
      if (!ok || !this.wantPlay) return;
      this.playFrom(index, index === textIndex ? offsetMs : 0);
    });
  }

  pause(): void {
    if (this.state !== 'playing' || !this.audio) return;
    this.audio.pause();
    this.wantPlay = false;
    this.setState('paused');
  }

  resume(): void {
    if (this.state === 'paused' && this.audio) {
      this.wantPlay = true;
      this.setState('playing');
      void this.audio.play().catch((e) => this.fail(e));
      return;
    }
    if (this.state === 'idle' && this.at >= 0) this.start(this.at);
  }

  /** 下一句；跳过正文里没有音频的句子 */
  next(): void {
    const index = this.nextAudible(this.at + 1, 1);
    if (index < 0) {
      this.finish();
      return;
    }
    this.jump(index);
  }

  prev(): void {
    const index = this.nextAudible(this.at - 1, -1);
    if (index < 0) return;
    this.jump(index);
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.6, Number.isFinite(rate) ? rate : 1));
    if (this.audio) this.audio.playbackRate = this.rate;
  }

  stop(): void {
    this.wantPlay = false;
    this.release();
    this.setState('idle');
  }

  /** 给测试与「用户手动拖进度条」用：外部改了 currentTime 之后重新对齐 */
  syncFromAudio(): void {
    this.tick();
  }

  private jump(index: number): void {
    this.at = index;
    void this.ensure(index).then((ok) => {
      if (!ok) return;
      this.playFrom(index);
    });
  }

  /**
   * 播第 index 句：**一句一个音频对象**。
   *
   * 清单在导出时记下了每句的精确字节区间（拼 mp3 时量的，起点天然是帧头），
   * 这里把它切出来单独建一个 `<audio>` 从 0 播完，再接下一句。没有 seek、
   * 没有整章时间轴、没有「按码率猜位置」——这正是社区里 TTS 插件的结构
   * （narrate 的 blobs[index]、read-aloud 的 AudioBufferSourceNode）。
   *
   * `offsetMs` 保留只是为了兼容调用方：一句一个文件后无法从句中间起播，
   * 最多差一句的开头，比「从章首念」强得多。
   */
  private playFrom(index: number, _offsetMs = 0): void {
    const mark = this.marks[this.align[index]];
    if (!mark) {
      this.fail(new Error('no mark for sentence'));
      return;
    }
    const bytes = this.sentenceBytes(mark) ?? this.buf;
    if (!bytes || !bytes.byteLength) {
      this.fail(new Error('offline audio is empty'));
      return;
    }
    this.at = index;
    this.setState('playing');
    this.deps.onSentence?.(index);
    this.release();
    this.url = (this.deps.makeUrl ?? defaultMakeUrl)(bytes);
    this.audio = this.deps.makeAudio(this.url);
    this.bind();
    const audio = this.audio;
    audio.playbackRate = this.rate;
    void audio.play().catch((e) => this.fail(e));
  }

  /** 这一句在章文件里的字节片段；没有精确区间就给 null（退回整章播放） */
  private sentenceBytes(mark: OfflineMark): ArrayBuffer | null {
    const buf = this.buf;
    if (!buf || !this.sliceMode) return null;
    const off = mark.off ?? 0;
    const bytes = mark.bytes ?? 0;
    if (!(bytes > 0) || off < 0 || off + bytes > buf.byteLength) return null;
    return buf.slice(off, off + bytes);
  }

  /**
   * 第一次真正播时读整章音频，并判定这一章能不能逐句切。
   *
   * 逐句区间是 v3 清单才有的；老包 / wav 包没有，就整章一次播完，高亮
   * 仍按时间轴推（tick）。两种包都能用，不会把用户旧包判成坏文件。
   */
  private async ensure(_index: number): Promise<boolean> {
    try {
      /* 已经读过一次就复用：换句不该再读一遍整章 */
      if (!this.buf) this.buf = await this.deps.loadAudio();
      if (!this.buf.byteLength) throw new Error('empty audio');
      if (this.sliceMode === null) {
        this.sliceMode = this.marks.some(
          (m) => (m.bytes ?? 0) > 0 && (m.off ?? 0) >= 0 && (m.off ?? 0) + (m.bytes ?? 0) <= this.buf!.byteLength,
        );
      }
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  private bind(): void {
    const audio = this.audio;
    if (!audio) return;
    this.endedHandler = (): void => {
      if (!this.wantPlay) return;
      /* 整章模式下这已经是章尾，再跳只会从头重放一遍 */
      if (!this.sliceMode) {
        this.finish();
        return;
      }
      const index = this.nextAudible(this.at + 1, 1);
      if (index < 0) this.finish();
      else this.jump(index);
    };
    this.tickHandler = (): void => this.tick();
    audio.addEventListener('ended', this.endedHandler);
    audio.addEventListener('timeupdate', this.tickHandler);
    audio.addEventListener('error', () => this.fail(new Error('audio playback failed')));
  }

  private tick(): void {
    if (!this.audio || this.state !== 'playing') return;
    /* 逐句模式下高亮由 onSentence 驱动；再按时间轴推只会把它拉回章首 */
    if (this.sliceMode) return;
    const mark = markIndexAt(this.marks, this.audio.currentTime * 1000);
    if (mark < 0) return;
    const text = this.back.get(mark);
    if (text === undefined || text === this.at) return;
    this.at = text;
    this.deps.onSentence?.(text);
  }

  /** 从 from 起按 dir 找第一个「有音频」的正文句子 */
  private nextAudible(from: number, dir: 1 | -1): number {
    const list = this.audible;
    if (!list.length) return -1;
    if (dir > 0) {
      for (const i of list) if (i >= from) return i;
      return -1;
    }
    for (let k = list.length - 1; k >= 0; k--) if (list[k] <= from) return list[k];
    return -1;
  }

  private fail(error: unknown): void {
    this.wantPlay = false;
    this.release();
    this.setState('idle');
    this.deps.onError?.(error);
  }

  private finish(): void {
    this.wantPlay = false;
    this.release();
    this.setState('idle');
    this.deps.onEnd?.();
  }

  private release(): void {
    if (this.audio) {
      if (this.endedHandler) this.audio.removeEventListener('ended', this.endedHandler);
      if (this.tickHandler) this.audio.removeEventListener('timeupdate', this.tickHandler);
      this.endedHandler = null;
      this.tickHandler = null;
      try {
        this.audio.pause();
      } catch {
        /* 已经释放过的音频再 pause 会抛，忽略 */
      }
      this.audio = null;
    }
    if (this.url) {
      (this.deps.revokeUrl ?? defaultRevoke)(this.url);
      this.url = '';
    }
  }

  private setState(state: OfflineState): void {
    this.state = state;
    this.deps.onState?.(state);
  }
}
