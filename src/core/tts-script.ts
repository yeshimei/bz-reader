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
  /** 原段落标签（p / h2 / blockquote …），高亮定位用，可缺省 */
  tag?: string;
}

export interface ScriptSegment {
  kind: ScriptKind;
  text: string;
  /** 这段来自第几个 block（可能合并了多个） */
  blocks: number[];
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

/**
 * 按引号把一段文字拆成旁白 / 对话。
 *
 * 嵌套引号只认最外层：`他说：“她喊‘别走’。”` 整段都是对话，内层引号
 * 原样保留——拆进内层只会把同一句话切成两个音色，听起来像两个人抢话。
 */
export function splitQuotes(text: string): Array<{ kind: ScriptKind; text: string }> {
  const src = String(text ?? '');
  if (!src.trim()) return [];

  /* 段首破折号：整段对白，不用再找引号 */
  if (DASH_DIALOGUE.test(src)) {
    const body = src.replace(DASH_DIALOGUE, '').trim();
    return body ? [{ kind: 'dialogue', text: body }] : [];
  }

  const out: Array<{ kind: ScriptKind; text: string }> = [];
  const stack: string[] = [];
  let buf = '';
  let kind: ScriptKind = 'narration';

  const flush = (next: ScriptKind): void => {
    const body = buf.trim();
    if (body) out.push({ kind, text: body });
    buf = '';
    kind = next;
  };

  for (const ch of src) {
    const opening = OPENERS.has(ch);
    const closing = CLOSERS.has(ch);
    /* 中文引号成对，直接开；英文直引号只有「不在引号里」时才算开 */
    if (opening && !(ch === '"' && stack.length && stack[stack.length - 1] === '"')) {
      if (!stack.length) {
        flush('dialogue');
        /* 开引号本身不进朗读文本：念出来是多余的停顿。栈要记住它，
           否则英文直引号第二个会被当成又一个开头（整段都变对白）。 */
        stack.push(ch);
        continue;
      }
      /* 内层引号：保留字符，内容仍归外层 */
      stack.push(ch);
      buf += ch;
      continue;
    }
    if (closing && stack.length) {
      const top = stack[stack.length - 1];
      if (QUOTE_PAIRS[top] === ch) {
        stack.pop();
        if (!stack.length) {
          flush('narration');
          continue;
        }
        buf += ch;
        continue;
      }
    }
    buf += ch;
  }
  /* 引号没闭合：剩下的都算对话，不能让半句对白变旁白 */
  flush(stack.length ? 'dialogue' : 'narration');
  return out;
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
  const src = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < src.length; i += 1) {
    buf += src[i];
    if (!SENTENCE_END.test(src[i])) continue;
    while (i + 1 < src.length && SENTENCE_END.test(src[i + 1])) {
      buf += src[i + 1];
      i += 1;
    }
    const one = buf.trim();
    if (one && readable(one)) parts.push(one);
    buf = '';
  }
  const tail = buf.trim();
  if (tail && readable(tail)) parts.push(tail);
  return mergeShort(parts);
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

function mergeShort(parts: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (s.length < SHORT_SENTENCE || prev.length < SHORT_SENTENCE)) {
      out[out.length - 1] = prev + s;
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
    for (const piece of splitQuotes(block.text)) {
      for (const sentence of splitSentences(piece.text)) {
        out.push({ kind: piece.kind, text: sentence, blocks: [index] });
      }
    }
  });
  return out;
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
