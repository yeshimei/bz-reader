/* ============================================================
 * bz-reader · 朗读脚本（core/tts-script.ts）
 *
 * 把一页正文切成「旁白 / 对话」两种段，交给语音层分配不同音色。
 *
 * 为什么单独成模块：切分规则是本功能里唯一**不依赖网络、也不依赖 DOM**
 * 的一层。它错的时候表现是「整页一个声音」「旁白被当成对白」，听完才
 * 发现，所以必须能在 node 里逐条断言。
 *
 * 2026-11-13 首版规则（按覆盖率排优先级）：
 *   1. 引号内 = 对话，引号外 = 旁白；中文「」『』“”，英文双引号；
 *   2. 段首破折号（—— / —）按中文小说的老排版习惯也算对话；
 *   3. 引号没闭合就当念到段尾（小说排版出错时不该整段变旁白）；
 *   4. 连续同角色的段合并到 240 字，少发请求、少花钱。
 *
 * 不做的事：不认说话人、不猜性别。那需要模型，见增强项，别在规则层
 * 堆启发式——猜错比不猜更糟。
 * ============================================================ */

export type ScriptKind = 'narration' | 'dialogue';

export interface ScriptBlock {
  /** 一段的纯文本（段落内不保留换行） */
  text: string;
  /**
   * 原始 textContent（2026-11-14）。
   *
   * 切句的 `at` / `len` 是相对**它**记的：`text` 把空白压成了一个空格，
   * 长度已经变了，拿它当偏移基准，DOM 那边一定对不上。给了 raw 就用 raw，
   * 没给就退回 text（老调用方 / 测试）。
   */
  raw?: string;
  /** 原段落标签（p / h2 / blockquote …），高亮定位用，可缺省 */
  tag?: string;
}

export interface ScriptSegment {
  kind: ScriptKind;
  text: string;
  /** 这段来自第几个 block（可能合并了多个） */
  blocks: number[];
  /**
   * 这一句在 `blocks[0]` 原始文本里的起点与长度（2026-11-14）。
   *
   * 高亮**只认这个**，不再拿 text 去 DOM 里搜：同一块里的重复短语、
   * 标点差异、正文改过，都会让文本搜索命到别处。区间是建脚本时算好的，
   * 播放时按块序号 + 字符偏移直接造 Range，没有第二种解释。
   */
  at: number;
  len: number;
}

/** 一段合并到多少字就断开。太长：首句要等整段合成完；太短：请求数爆炸。 */
export const SEGMENT_TARGET = 240;

/** DeepSeek TTS 支持的语种（官方文档，按 BCP-47 的主标签判断） */
const TTS_LANGS: readonly string[] = [
  'zh',
  'yue',
  'en',
  'ja',
  'ko',
  'ms',
  'ar',
  'id',
  'th',
  'vi',
];

/** 中文开引号 → 闭引号。英文直双引号在运行时按「成对翻转」处理。 */
const QUOTE_PAIRS: Record<string, string> = {
  '「': '」',
  '『': '』',
  '“': '”',
  '‘': '’',
  '"': '"',
};

/** 只把这些当开引号：单引号 `'` 会让英文缩写（don't）整段变对白 */
const OPENERS = new Set(Object.keys(QUOTE_PAIRS));
const CLOSERS = new Set(Object.values(QUOTE_PAIRS));

/** 段首破折号（中文小说里常见的对白排版） */
const DASH_DIALOGUE = /^\s*(?:——|—|--)\s*/;

/** 原文里的一段（相对整块原始文本） */
interface Span {
  at: number;
  len: number;
}

/** 两端去空白后的区间；全空白返回 null */
function trimSpan(src: string, at: number, end: number): Span | null {
  let a = at;
  let b = end;
  while (a < b && /\s/.test(src[a])) a += 1;
  while (b > a && /\s/.test(src[b - 1])) b -= 1;
  return b > a ? { at: a, len: b - a } : null;
}

/** 区间 → 可念文本：空白压成一个空格，两端不留 */
function speakable(src: string, span: Span): string {
  return src.slice(span.at, span.at + span.len).replace(/\s+/g, ' ').trim();
}

/**
 * 按引号切分，**保留每段在原文里的区间**。
 *
 * 规则与 `splitQuotes` 逐条相同，只是不返回字符串：给的是 `at` / `len`，
 * 由调用方自己决定要不要转成可念文本。引号本身不落在任何区间里。
 */
function splitQuoteSpans(src: string): Array<{ kind: ScriptKind } & Span> {
  if (!src.trim()) return [];

  /* 段首破折号：整段对白，不用再找引号 */
  const dash = src.match(DASH_DIALOGUE);
  if (dash) {
    const body = trimSpan(src, dash[0].length, src.length);
    if (!body || !speakable(src, body)) return [];
    return [{ kind: 'dialogue', ...body }];
  }

  const out: Array<{ kind: ScriptKind } & Span> = [];
  const stack: string[] = [];
  let kind: ScriptKind = 'narration';
  let from = 0;

  /* 一段结束：把 [from, to) 收成一条。开 / 闭引号自身落在区间外——
     念出来是多余的停顿；但原文里它们占着位置，所以下一段从 +1 起。 */
  const flush = (to: number): void => {
    const span = trimSpan(src, from, to);
    if (span && speakable(src, span)) out.push({ kind, ...span });
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const opening = OPENERS.has(ch);
    const closing = CLOSERS.has(ch);
    /* 中文引号成对，直接开；英文直引号只有「不在引号里」时才算开 */
    if (opening && !(ch === '"' && stack.length && stack[stack.length - 1] === '"')) {
      if (!stack.length) {
        flush(i);
        kind = 'dialogue';
        from = i + 1;
      }
      /* 内层引号留在本段里，字符照常算进区间 */
      stack.push(ch);
      continue;
    }
    if (closing && stack.length) {
      const top = stack[stack.length - 1];
      if (QUOTE_PAIRS[top] === ch) {
        stack.pop();
        if (!stack.length) {
          flush(i);
          kind = 'narration';
          from = i + 1;
        }
      }
    }
  }
  /* 引号没闭合：剩下的都算对话，不能让半句对白变旁白 */
  flush(src.length);
  return out;
}

/**
 * 按引号把一段文字拆成旁白 / 对话。
 *
 * 嵌套引号只认最外层：`他说：“她喊‘别走’。”` 整段都是对话，内层引号
 * 原样保留——拆进内层只会把同一句话切成两个音色，听起来像两个人抢话。
 */
export function splitQuotes(text: string): Array<{ kind: ScriptKind; text: string }> {
  const src = String(text ?? '');
  return splitQuoteSpans(src).map((p) => ({ kind: p.kind, text: speakable(src, p) }));
}

/**
 * 一段文字切成「一句一段」（朗读与高亮都以句为单位，2026-11-14）。
 *
 * 以前按 240 字合并成一块：一页只有两三段，播放条上的高亮只能框住整段，
 * 跨页的长段落还会把整段（含屏幕外的字）念出来。改成一句一次合成之后，
 * 高亮能跟着句子走，首句出声也更快；代价是请求数变多（每句一次），
 * 靠播放器的预取盖住。
 *
 * 句末标点跟在句尾；连续标点（「！？」「……」）一起收尾。太短的碎片
 * （少于 6 字，常见于「“是。”」）并进前一句，免得为两个字单跑一次请求。
 */
export function splitSentences(text: string): string[] {
  const src = String(text ?? '');
  const span = trimSpan(src, 0, src.length);
  if (!span) return [];
  return splitSentenceSpans(src, span).map((s) => s.text);
}

/** 同上，但返回区间：`at` / `len` 相对整块原始文本 */
function splitSentenceSpans(src: string, base: Span): Array<Span & { text: string }> {
  const end = base.at + base.len;
  const out: Array<Span & { text: string }> = [];

  const push = (a: number, b: number): void => {
    const span = trimSpan(src, a, b);
    if (!span) return;
    const text = speakable(src, span);
    if (!text || !readable(text)) return;
    out.push({ ...span, text });
  };

  let from = base.at;
  for (let i = base.at; i < end; i += 1) {
    if (!SENTENCE_END.test(src[i])) continue;
    /* 连续标点（「！？」「……」）一起收尾，不拆成两句 */
    while (i + 1 < end && SENTENCE_END.test(src[i + 1])) i += 1;
    push(from, i + 1);
    from = i + 1;
  }
  push(from, end);
  return mergeShortSpans(src, splitLongSpans(src, out));
}

/** 单句长度上限：一段几千字、一个句末标点都没有（排版差的 TXT / 网页正文）
 *  会整段发给服务——首句要等很久，本地模型还常常直接吐空。超过上限就按逗号、
 *  顿号、空白这些软边界再切，实在找不到才硬切。 */
const SENTENCE_MAX = SEGMENT_TARGET;
const SOFT_BREAKS = ['，', '、', '；', '：', ',', ';', '：', ' '];

function splitLongSpans(
  src: string,
  spans: Array<Span & { text: string }>,
): Array<Span & { text: string }> {
  const out: Array<Span & { text: string }> = [];
  for (const s of spans) {
    if (s.text.length <= SENTENCE_MAX) {
      out.push(s);
      continue;
    }
    const end = s.at + s.len;
    let from = s.at;
    while (from < end) {
      let cut = Math.min(end, from + SENTENCE_MAX);
      if (cut < end) {
        /* 在最后 40 字里往回找一个软边界，切在句子中间也不至于太生硬 */
        const tail = src.slice(Math.max(from + 1, cut - 40), cut);
        let best = -1;
        for (const ch of SOFT_BREAKS) best = Math.max(best, tail.lastIndexOf(ch));
        if (best >= 0) cut = Math.max(from + 1, cut - 40 + best + 1);
      }
      const span = trimSpan(src, from, cut);
      if (span) {
        const text = speakable(src, span);
        if (text && readable(text)) out.push({ ...span, text });
      }
      from = Math.max(cut, from + 1);
    }
  }
  return out;
}

/**
 * 这段有没有能念出声的字符。
 *
 * 2026-11-14 真机：EPUB 排版里常把「、」「——」「……」单放成一个段落，
 * 它们会被切句切成「一句」，发给语音服务后本地模型吐不出音频
 * （`no audio produced`），整章导出就断在这。没有字母 / 数字 / 汉字的
 * 碎片一律不念——它们本来也不是话。
 */
function readable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

const SENTENCE_END = /[。！？；!?;…]/;
const SHORT_SENTENCE = 6;

function mergeShortSpans(
  src: string,
  parts: Array<Span & { text: string }>,
): Array<Span & { text: string }> {
  const out: Array<Span & { text: string }> = [];
  for (const s of parts) {
    const prev = out[out.length - 1];
    if (prev && (s.text.length < SHORT_SENTENCE || prev.text.length < SHORT_SENTENCE)) {
      /* 合并后区间连成一片：从上一句的起点到这一句的终点，中间的空白一起包进来 */
      const merged: Span = { at: prev.at, len: s.at + s.len - prev.at };
      out[out.length - 1] = { ...merged, text: speakable(src, merged) };
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * 一页正文 → 朗读脚本。
 *
 * 段落顺序即朗读顺序；同一段里旁白与对话交替时按出现顺序拆开；每种角色
 * 内部再按句切（见 splitSentences）。不跨角色合并——旁白和对白要让两把
 * 嗓子分开念。
 */
export function buildScript(
  blocks: readonly ScriptBlock[],
  _opts: { target?: number } = {},
): ScriptSegment[] {
  const out: ScriptSegment[] = [];
  blocks.forEach((block, index) => {
    const raw = String(block.raw ?? block.text ?? '');
    if (!raw) return;
    for (const piece of splitQuoteSpans(raw)) {
      for (const sentence of splitSentenceSpans(raw, piece)) {
        out.push({
          kind: piece.kind,
          text: sentence.text,
          blocks: [index],
          at: sentence.at,
          len: sentence.len,
        });
      }
    }
  });
  return out;
}

/**
 * 屏幕第一个字在整章正文里的位置：第几个块、块内第几个字符（2026-11-14）。
 *
 * 由引擎在「取这一页段落」的同一趟遍历里顺手记下来。和 `startPointOf` 那套
 * 文本搜索是两条路：这个不会因为页首是半截句、小标题、跨页段落而失手。
 */
export interface PageAnchor {
  block: number;
  offset: number;
}

/**
 * 页首锚点 → 整章脚本里从第几句、句内第几个字开始念。
 *
 * 只认块序号和字符偏移，不搜文本：`at` / `len` 是建脚本时按同一份原文算的，
 * 播放时按它们直接对位，没有第二种解释。
 *
 * 三种落空时给 null，交给调用方退回文本匹配：
 *   · 块序号对不上（正文改过、块结构变了）；
 *   · 偏移超出这一块最后一句；
 *   · 这个块一句都没切出来。
 *
 * 页首落在句子之间的空隙（引号、空白）时从下一句开头念——那半句本来
 * 就听不全，硬跳进去只会变成半截话。
 */
export function startFromAnchor(
  segments: readonly ScriptSegment[],
  blocks: readonly ScriptBlock[],
  anchor: PageAnchor,
): { index: number; skip: number } | null {
  const block = blocks[anchor.block];
  if (!block) return null;
  const raw = String(block.raw ?? block.text ?? '');
  const offset = Math.max(0, Math.min(Math.round(anchor.offset), raw.length));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.blocks.includes(anchor.block)) continue;
    /* 句间空隙：从下一句开头念 */
    if (offset < seg.at) return { index: i, skip: 0 };
    if (offset < seg.at + seg.len) {
      const skipped = raw.slice(seg.at, offset).replace(/\s+/g, '').length;
      return { index: i, skip: skipped };
    }
  }
  /* 落在该块最后一句之后（或这一块一句都没切出来）：交给文本兜底 */
  return null;
}

/**
 * 当前这一页该从整章脚本的第几句开始念（2026-11-14）。
 *
 * 离线包播的是整章 mp3，起点只能靠文本对。`pageText` 是屏幕上这一页裁出来的
 * 字：一个段落跨了两页时它只拿到后半截，`pageText.includes(整句)` 会全部
 * miss，起点掉回 0 —— 声音从章首开始，高亮却在当前页，谁看都觉得坏了。
 * 所以补一条「这一句包含页首」的判断：页首那十几个字一定落在这一句里。
 */
export function startIndexOf(
  segments: readonly { text: string }[],
  pageText: string,
): number {
  return startPointOf(segments, pageText).index;
}

/**
 * 同 `startIndexOf`，另外给出「这一页从这一句的第几个字开始」（2026-11-14）。
 *
 * 只给句子序号是不够的：段落跨页时，这一页常常从段落中间开始，而整句音频
 * 只能从句首放——用户听到的是上一页末尾那半句，观感就是「从整个段落的开头
 * 念」（真机反馈）。返回的 `skip` 让播放器按比例把这几百毫秒跳过去。
 */
export function startPointOf(
  segments: readonly { text: string }[],
  pageText: string,
): { index: number; skip: number } {
  const squash = (s: string): string => String(s ?? '').replace(/\s+/g, '');
  const page = squash(pageText);
  if (!page || !segments.length) return { index: 0, skip: 0 };
  /* 页首那十几个字一定落在某一句话里。先拿长片段找（最不容易撞车），
     找不到再缩短——短片段满书都是，一上来就用会配错句子。 */
  for (const n of [16, 12, 8, 6, 4, 3, 2]) {
    const head = page.slice(0, n);
    if (head.length < 2) continue;
    for (let i = 0; i < segments.length; i++) {
      const t = squash(segments[i]?.text ?? '');
      if (!t) continue;
      const pos = t.indexOf(head);
      if (pos >= 0) return { index: i, skip: pos };
    }
  }
  return { index: 0, skip: 0 };
}

/** 计费字符：官方口径「汉字算 2，其他算 1」 */
export function billedChars(text: string): number {
  let n = 0;
  for (const ch of String(text ?? '')) {
    n += /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch) ? 2 : 1;
  }
  return n;
}

/** 估算费用（元）。默认按刊例价 3 元 / 万计费字符；限时五折时传 1.5。 */
export function estimateCost(chars: number, yuanPer10k = 3): number {
  return (Math.max(0, chars) / 10000) * yuanPer10k;
}

/** DeepSeek TTS 认不认这门语言。`zh-CN` / `zh-TW` 都算 zh。 */
export function ttsLangSupported(lang: string | null | undefined): boolean {
  const base = String(lang ?? '')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return !!base && TTS_LANGS.includes(base);
}
