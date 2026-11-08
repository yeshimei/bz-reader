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
  /* 断句（B11）：补上英文句号。
     以前只认中文标点与 `!?`，一本英文书整页只有末尾那一个句号能断——
     两百多词的段落变成「一句」，念起来没有停顿，onChunk 也只回调一次
     （界面上「正在念这句」的高亮整段不动）。
     点后面必须跟空白或行尾才算句末：`3.14`、`e.g.x` 里的点不动，
     小数点不会被切碎。 */
  const tokens = clean.split(/([。！？!?；;\n]|\.(?=\s|$))/);
  const sentences: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const piece = `${tokens[i] ?? ''}${tokens[i + 1] ?? ''}`;
    if (piece.trim()) sentences.push(piece);
  }
  const merged: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    /* 不在这里 trim：句间的空格 / 换行是「两句之间的停顿」，并段时要留住，
       否则英文会念成 `sentence.Two`。整体 push 时再收尾。 */
    if (!raw.trim()) continue;
    if (buf && buf.length + raw.length > target) {
      merged.push(buf.trim());
      buf = raw;
    } else {
      buf += raw;
    }
  }
  if (buf.trim()) merged.push(buf.trim());

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

/** 站内语言（`zh` / `zh-TW` / `en` / 书里的 `language: en-US`）→ 朗读标签 */
export function normalizeSpeakLang(raw: string | null | undefined): string {
  const tag = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!tag) return '';
  /* 书的元数据可能是 ISO 639-2（`eng` / `zho`），语音合成只认 BCP-47 */
  const iso3: Record<string, string> = {
    eng: 'en',
    zho: 'zh-cn',
    chi: 'zh-cn',
    jpn: 'ja',
    kor: 'ko',
    deu: 'de',
    ger: 'de',
    fra: 'fr',
    fre: 'fr',
    spa: 'es',
    por: 'pt',
  };
  const base = iso3[tag] ?? tag;
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(base)) return '';
  if (base === 'zh' || base.startsWith('zh-')) {
    return /-(tw|hk|mo|hant)\b/.test(base) ? 'zh-TW' : 'zh-CN';
  }
  return base;
}

/** 这门语言用汉字/假名写，还是用拉丁字母写——用来判「界面语言靠不靠谱」 */
function isCjkLang(tag: string): boolean {
  const base = tag.split('-')[0] ?? '';
  return base === 'zh' || base === 'ja' || base === 'ko';
}

/**
 * 朗读语言（B11）：书的语言 → 界面语言 → 按内容猜。
 *
 * 以前只有「猜」：书里标了 `language` 也不用，中文书夹两句英文就容易被
 * 判成英文腔；而一本英文书遇到中文界面，又会被界面语言带偏。
 * 中间那一步因此加一道同文种校验——界面是中文、正文是英文时，拿 zh-CN
 * 去念英文比按内容猜成 en-US 更糟，这种情况直接跳过界面语言。
 */
export function speakLang(
  text: string,
  metaLanguage?: string | null,
  uiLocale?: string | null,
): string {
  const fromBook = normalizeSpeakLang(metaLanguage);
  if (fromBook) return fromBook;
  const guess = guessLang(text);
  const fromUi = normalizeSpeakLang(uiLocale);
  if (fromUi && isCjkLang(fromUi) === isCjkLang(guess)) return fromUi;
  return guess;
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
  /* 先掐掉上一段（B12）：某些 WebView（尤其 iOS 从后台回来）会在
     `cancel()` 里同步抛错，以前它把整个 speak() 带崩——用户点朗读，
     既没有声音也没有提示。队列没清干净不影响下面的 speak()，宿主自己会排。 */
  try {
    synth.cancel();
  } catch {
    /* 忽略：接着念新的一段 */
  }
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
    const u = new SpeechSynthesisUtterance(chunks[i]);
    u.lang = lang;
    u.rate = rate;
    u.onstart = () => {
      if (!stopped) opts.onChunk?.(i, chunks[i]);
    };
    // 单段出错也往下走：某一句念不出来不该让整页静音
    u.onend = () => play(i + 1);
    u.onerror = () => play(i + 1);
    synth.speak(u);
  };
  /* 首句必须离开当前调用栈（A-31）：iOS / WKWebView 在 `cancel()` 的同一个
     宏任务里紧接着 `speak()` 时会把这一句吞掉——用户点了朗读，没有声音，
     也没有任何报错。放进下一个宏任务之后，cancel 的异步收尾已经跑完。 */
  window.setTimeout(() => {
    if (!stopped) play(0);
  }, 0);

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
