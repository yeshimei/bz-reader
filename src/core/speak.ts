/* ============================================================
 * bz-reader · 朗读（core/speak.ts）
 *
 * 单独成模块是为了让调用方只依赖「念一段字」这个接口，不直接摸
 * speechSynthesis。**只有一个包**（完整功能版），能力门控在运行期由
 * 激活码决定：调用方先 `requireCap('tts')`，再调 `speak()`。
 *
 * （2026-11-04 修：这里原来写着「esbuild 在 base 构建时把这个文件换成空
 * 实现」——双包早撤了，那段注释会让人以为还有一条产线。）
 *
 * 2026-11-04 改（P2-11 + TTS 跟随阅读位置）：
 *   · 语言按内容猜，不再永远 zh-CN（读英文书是中文腔）；
 *   · 语速由 prefs.ttsRate 控制，不再写死 1；
 *   · 按句子切段排队，不再 slice(0, 4000) 把后半页丢掉；
 *   · 提供 onChunk / onEnd，调用方据此高亮当前句、念完自动翻页续读。
 * ============================================================ */

export interface SpeakOptions {
  /** 语速 0.6–2，默认 1 */
  rate?: number;
  /** 语言标签，不传按内容猜 */
  lang?: string;
  /** 念到第几段（0-based）时回调，用来做「正在念这句」 */
  onChunk?: (index: number, text: string) => void;
  /** 整段文字念完了（不是被打断） */
  onEnd?: () => void;
}

export interface SpeakHandle {
  stop(): void;
}

/** 单段上限。系统语音合成喂太长会卡住，也不是朗读该干的事。 */
const MAX_CHUNK = 4000;
/** 每段的目标长度：短句连读自然，太长会「一口气念不完」 */
const CHUNK_TARGET = 220;

/**
 * 按句末标点切段，再把短句并到目标长度。
 *
 * 以前整页 `slice(0, 4000)`：超过 4000 字的后半页直接不念，而且长文本
 * 在部分 WebView 上会「念到一半没声音」。
 */
export function splitForSpeech(text: string, target = CHUNK_TARGET): string[] {
  /* 只压横向空白，**保留换行**：TXT 里段落靠换行分，压成空格之后
     整页变成一句，念起来没有停顿。 */
  const clean = String(text || '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!clean) return [];
  const sentences = clean.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? [clean];
  const merged: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (buf && buf.length + s.length > target) {
      merged.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) merged.push(buf);

  // 单段仍超长（没有标点的长句）：硬切，保证每段都念得出来
  const out: string[] = [];
  for (const s of merged) {
    if (s.length <= MAX_CHUNK) {
      out.push(s);
      continue;
    }
    for (let i = 0; i < s.length; i += MAX_CHUNK) out.push(s.slice(i, i + MAX_CHUNK));
  }
  return out;
}

/** 按汉字占比猜语言：中文书里夹几个英文词不该切成英文腔 */
export function guessLang(text: string): string {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / Math.max(1, text.length) > 0.15 ? 'zh-CN' : 'en-US';
}

/**
 * 念一段文字。环境不支持朗读时返回 null（调用方据此提示）。
 *
 * 分段串行念（浏览器的 speechSynthesis 自带队列，但分段之后才能报
 * 「念到第几段」）。`stop()` 只是取消，不回调 `onEnd`——调用方自己复位。
 */
export function speak(text: string, opts: SpeakOptions = {}): SpeakHandle | null {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null;
  synth.cancel();
  const chunks = splitForSpeech(text);
  if (!chunks.length) return null;

  const rate = Math.min(2, Math.max(0.6, opts.rate ?? 1));
  const lang = opts.lang || guessLang(text);
  let stopped = false;

  const play = (i: number): void => {
    if (stopped) return;
    if (i >= chunks.length) {
      opts.onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(chunks[i]!);
    u.lang = lang;
    u.rate = rate;
    u.onstart = () => {
      if (!stopped) opts.onChunk?.(i, chunks[i]!);
    };
    // 单段出错也往下走：某一句念不出来不该让整页静音
    u.onend = () => play(i + 1);
    u.onerror = () => play(i + 1);
    synth.speak(u);
  };
  play(0);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      try {
        synth.cancel();
      } catch {
        /* 系统语音不可用时不该把翻页一起带崩 */
      }
    },
  };
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* 同上 */
  }
}
