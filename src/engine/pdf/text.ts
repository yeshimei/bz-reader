/* ============================================================
 * bz-reader · PDF 页文本（engine/pdf/text.ts）
 *
 * pdf.js 的 `getTextContent()` 给的是按绘制顺序排的碎 item，不是一段话。
 * 直接拼会出两种错：
 *   · 英文 item 之间本来有空格（pdf.js 会给一个 `str: ' '`），遇到没给的
 *     厂商就粘成 `Helloworld`；
 *   · 中文 item 按字拆，硬补空格会变成「中 文 阅 读」。
 *
 * 2026-11-10（fix/pdf-search）：只看「两侧是不是拉丁字母」不够。带字距
 * 调整（kerning）的 PDF 会把一个词切成好几块（`p` `a` `r` `i` `ty`），
 * 逐块补空格就把整页撕成 `p a r i t y`，搜索全篇搜不到。现在改成看每块
 * 字的坐标与字宽：同词内几乎贴着（实测 99% 在 ±0.05 字宽内），只有间隙
 * 超过约 0.15 字宽才补一个空格；纵坐标跳开半个字高算换行。
 * 没有坐标的 item（外部构造、老数据）退回原来的字符判断。
 *
 * 拼完统一把换行与连续空白压成一个空格——页文本用于搜索、朗读、AI 上下文，
 * 不需要保留排版换行。
 *
 * 另带一份 `layerIndex`：页文本里补出来的空格在文字层（DOM textContent）
 * 里并不存在，而划线、页内高亮存的是文字层字符位置。PDF 命中要写
 * `pdf/<页>/<起>-<止>` 时必须过这层映射，不能直接拿下标去用。
 * ============================================================ */

/** pdf.js TextItem 里我们用得到的字段（其余是字体与样式，不需要） */
export interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  /** 变换矩阵 [a, b, c, d, e, f]：a/b 是文字方向，e/f 是绘制原点 */
  transform?: number[];
  /** 这一项的宽度（与 transform 同一套单位） */
  width?: number;
  height?: number;
}

/** 页文本 + 「第 i 个字符在文字层里的下标」 */
export interface PdfPageTextLayout {
  text: string;
  layerIndex: number[];
}

/** CJK 统一表意文字、假名、谚文、全角标点。任一侧命中就不补空格 */
const CJK_RE =
  /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;

/** 词间空白的判定阈值：字号的 0.15（实测同词碎片都在 0.05 字宽以内） */
const SPACE_GAP_EM = 0.15;

/** 与上一项的横向错开超过半个字高就算换行 / 换列 */
const LINE_JUMP_EM = 0.5;

function isCjk(ch: string): boolean {
  return ch !== '' && CJK_RE.test(ch);
}

function needsSpace(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (/\s/.test(prev) || /\s/.test(next)) return false;
  if (isCjk(prev) || isCjk(next)) return false;
  return true;
}

/** 一项在页面上的位置、文字方向与字宽；缺一个就不猜（退回字符判断） */
interface GlyphGeometry {
  x: number;
  y: number;
  /** 文字方向单位向量（横排是 (1,0)，竖排 / 旋转页是别的） */
  dirX: number;
  dirY: number;
  width: number;
  size: number;
}

function geometryOf(item: PdfTextItemLike): GlyphGeometry | null {
  const t = item?.transform;
  if (!Array.isArray(t) || t.length < 6) return null;
  if (!t.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const width = item.width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0) return null;
  const [a, b, c, d, e, f] = t;
  const dirLen = Math.hypot(a, b);
  const size = Math.hypot(c, d);
  if (!(dirLen > 0.01) || !(size > 0.01)) return null;
  return { x: e, y: f, dirX: a / dirLen, dirY: b / dirLen, width, size };
}

/**
 * 两项之间该不该补空格：沿文字方向算「这一项走完之后离下一项起点还有多远」。
 * 换行（垂直方向错开半个字高）一律算一处分隔。
 */
function gapNeedsSpace(prev: GlyphGeometry, next: GlyphGeometry): boolean {
  const vx = next.x - prev.x;
  const vy = next.y - prev.y;
  const advance = vx * prev.dirX + vy * prev.dirY;
  const across = Math.abs(-vx * prev.dirY + vy * prev.dirX);
  if (across > Math.max(prev.size, next.size) * LINE_JUMP_EM) return true;
  return advance - prev.width > prev.size * SPACE_GAP_EM;
}

/** 压空白时同步压映射：连续空白只留一个空格，指向这段空白的第一个字符 */
function normalizeLayout(text: string, map: readonly number[]): PdfPageTextLayout {
  const chars: string[] = [];
  const layerIndex: number[] = [];
  let pendingSpace = false;
  let pendingFrom = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      if (chars.length && !pendingSpace) {
        pendingSpace = true;
        pendingFrom = map[i] ?? 0;
      }
      continue;
    }
    if (pendingSpace) {
      chars.push(' ');
      layerIndex.push(pendingFrom);
      pendingSpace = false;
    }
    chars.push(ch);
    layerIndex.push(map[i] ?? 0);
  }
  return { text: chars.join(''), layerIndex };
}

export function normalizeText(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n\t\u00a0\u3000]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * 一页文字的拼接结果 + 文字层映射。
 *
 * `layerIndex[i]` 是页文本第 i 个字符在文字层（DOM textContent）里的下标；
 * 补出来的空格指向它后面的真实字符，所以区间末尾要按「最后一个真实字符 + 1」
 * 取，别直接 `layerIndex[end]`。
 */
export function pageTextLayoutOf(items: readonly PdfTextItemLike[]): PdfPageTextLayout {
  const chars: string[] = [];
  const map: number[] = [];
  let layerPos = 0;
  let prevChar = '';
  let prevGeo: GlyphGeometry | null = null;

  for (const item of items ?? []) {
    const str = typeof item?.str === 'string' ? item.str : '';
    if (!str) continue;
    const geo = geometryOf(item);
    const first = str.charAt(0);
    let space = false;
    if (prevChar && !/\s/.test(prevChar) && !/\s/.test(first) && !isCjk(prevChar) && !isCjk(first)) {
      space = geo && prevGeo ? gapNeedsSpace(prevGeo, geo) : needsSpace(prevChar, first);
    }
    if (space) {
      chars.push(' ');
      map.push(layerPos);
    }
    for (let i = 0; i < str.length; i += 1) {
      chars.push(str.charAt(i));
      map.push(layerPos + i);
    }
    /* hasEOL 是「这一项之后换行」。页文本不保留换行，只补一个分隔空格，
       否则英文跨行会粘成一个词，搜索命中会错位。 */
    if (item.hasEOL) {
      chars.push(' ');
      map.push(layerPos + str.length);
    }
    layerPos += str.length;
    prevChar = str.charAt(str.length - 1);
    prevGeo = geo;
  }
  return normalizeLayout(chars.join(''), map);
}

export function pageTextOf(items: readonly PdfTextItemLike[]): string {
  return pageTextLayoutOf(items).text;
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
