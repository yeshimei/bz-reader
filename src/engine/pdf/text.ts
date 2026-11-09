/* ============================================================
 * bz-reader · PDF 页文本（engine/pdf/text.ts）
 *
 * pdf.js 的 `getTextContent()` 给的是按绘制顺序排的碎 item，不是一段话。
 * 直接拼会出两种错：
 *   · 英文 item 之间本来有空格（pdf.js 会给一个 `str: ' '`），遇到没给的
 *     厂商就粘成 `Helloworld`；
 *   · 中文 item 按字拆，硬补空格会变成「中 文 阅 读」。
 *
 * 所以拼接规则看两侧字符：有一侧是 CJK 就不补空格；都是拉丁字母/数字
 * 又都不是空白才补。拼完统一把换行与连续空白压成一个空格——页文本用于
 * 搜索、朗读、AI 上下文，不需要保留排版换行。
 * ============================================================ */

/** pdf.js TextItem 里我们用得到的两个字段（其余是变换矩阵，不需要） */
export interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/** CJK 统一表意文字、假名、谚文、全角标点。任一侧命中就不补空格 */
const CJK_RE =
  /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;

function isCjk(ch: string): boolean {
  return ch !== '' && CJK_RE.test(ch);
}

function needsSpace(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (/\s/.test(prev) || /\s/.test(next)) return false;
  if (isCjk(prev) || isCjk(next)) return false;
  return true;
}

export function normalizeText(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n\t\u00a0\u3000]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function pageTextOf(items: readonly PdfTextItemLike[]): string {
  let out = '';
  for (const item of items ?? []) {
    const str = typeof item?.str === 'string' ? item.str : '';
    if (!str) continue;
    const prev = out.slice(-1);
    const next = str.charAt(0);
    if (out && needsSpace(prev, next)) out += ' ';
    out += str;
    /* hasEOL 是「这一项之后换行」。页文本不保留换行，只补一个分隔空格，
       否则英文跨行会粘成一个词，搜索命中会错位。 */
    if (item.hasEOL) out += ' ';
  }
  return normalizeText(out);
}

/**
 * 从页文本里截一段上下文。`start` / `end` 是页文本内的字符下标（含 end）。
 * 越界会夹到文本范围内；前后各取 `radius` 个字符，并归一空白。
 */
export function excerptAt(
  text: string,
  start: number,
  end: number,
  radius = 24,
): { pre: string; match: string; post: string } {
  const src = String(text ?? '');
  const len = src.length;
  const lo = Math.min(Math.max(0, Math.floor(Number.isFinite(start) ? start : 0)), len);
  const hi = Math.min(Math.max(lo, Math.floor(Number.isFinite(end) ? end : lo)), len);
  const r = Math.max(0, Math.floor(Number.isFinite(radius) ? radius : 0));
  return {
    pre: normalizeText(src.slice(Math.max(0, lo - r), lo)),
    match: normalizeText(src.slice(lo, hi)),
    post: normalizeText(src.slice(hi, Math.min(len, hi + r))),
  };
}
