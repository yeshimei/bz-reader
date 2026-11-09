/* ============================================================
 * bz-reader · PDF 自带标注（engine/pdf/annots.ts）
 *
 * 读者在 Acrobat / Preview / Obsidian 原生视图里画过高亮的 PDF，打开时
 * 那些标注应该看得见——否则「换了个阅读器，批注全消失」，用户会以为文件坏了。
 *
 * 这里把 pdf.js 的 annotation 数据换算成「左上原点、0..1 比例」的矩形，
 * 和划线、反链、选区共用同一套坐标系（页内百分比），滚动缩放都不用重算。
 *
 * 三个真机上容易错的点：
 *  1. `rect` / `quadPoints` 是**未旋转**的用户坐标，原点在左下、单位 pt；
 *  2. 一段跨行划词的 `quadPoints` 是一条里塞了多个四边形（8 个数一个）；
 *  3. `color` 是 0..1 的浮点三元组，不是十六进制字符串。
 * ============================================================ */

import { rotateNormRect, type PdfRectArea } from './locator';

export type PdfFileAnnotKind = 'highlight' | 'underline' | 'strike' | 'squiggly' | 'box' | 'note';

export interface PdfFileAnnot {
  kind: PdfFileAnnotKind;
  /** 页内矩形（已按页面旋转角换算） */
  rects: PdfRectArea[];
  /** 十六进制色；文件没写颜色时为空串，由样式给默认色 */
  color: string;
  /** 批注正文 */
  contents: string;
  /** 批注作者（PDF 的 /T） */
  author: string;
}

/** PDF 的 subtype → 我们的类型。Popup / Link / Widget 等一律不收 */
const KINDS: Readonly<Record<string, PdfFileAnnotKind>> = {
  Highlight: 'highlight',
  Underline: 'underline',
  StrikeOut: 'strike',
  Squiggly: 'squiggly',
  Square: 'box',
  Circle: 'box',
  FreeText: 'box',
  Text: 'note',
  Note: 'note',
};

/** 归一化之后面积小于这个数就丢掉：多半是零宽的装饰线或坏数据 */
const MIN_AREA = 1e-5;

interface AnnotLike {
  subtype?: unknown;
  rect?: unknown;
  quadPoints?: unknown;
  color?: unknown;
  contents?: unknown;
  title?: unknown;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 0..1 浮点三元组 → `#rrggbb`；已经是字符串就原样返回（校验过才用） */
function toHex(color: unknown): string {
  if (typeof color === 'string') return /^#[0-9a-f]{3,8}$/i.test(color.trim()) ? color.trim() : '';
  if (!Array.isArray(color) || color.length < 3) return '';
  const hex = color
    .slice(0, 3)
    .map((v) => Math.round(Math.min(1, Math.max(0, num(v))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/**
 * 一条注解的一条矩形 → 归一化。
 *
 * 分母用未旋转的 MediaBox（`box`），和 `document.getLinks` 同一套算法；
 * 换算完再按页面旋转角转一次，视图层套百分比就是对的。
 */
function toRect(
  xs: readonly number[],
  ys: readonly number[],
  box: readonly number[],
  rotation: number,
): PdfRectArea | null {
  const [bx, by, bx2, by2] = [num(box[0]), num(box[1]), num(box[2]), num(box[3])];
  const width = Math.max(1, bx2 - bx);
  const height = Math.max(1, by2 - by);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const bottom = Math.min(...ys);
  const top = Math.max(...ys);
  const raw = {
    left: (left - bx) / width,
    top: 1 - (top - by) / height,
    width: (right - left) / width,
    height: (top - bottom) / height,
  };
  if (!(raw.width > 0 && raw.height > 0)) return null;
  const normalized = rotateNormRect(
    {
      left: Math.min(1, Math.max(0, raw.left)),
      top: Math.min(1, Math.max(0, raw.top)),
      width: Math.min(1, Math.max(0, raw.width)),
      height: Math.min(1, Math.max(0, raw.height)),
    },
    rotation,
  );
  if (normalized.width * normalized.height < MIN_AREA) return null;
  return normalized;
}

/** `quadPoints` → 一个或多个四边形矩形；格式不对返回空数组 */
function quadRects(quadPoints: unknown, box: readonly number[], rotation: number): PdfRectArea[] {
  if (!Array.isArray(quadPoints) || quadPoints.length < 8) return [];
  const out: PdfRectArea[] = [];
  for (let i = 0; i + 8 <= quadPoints.length; i += 8) {
    const xs = [quadPoints[i], quadPoints[i + 2], quadPoints[i + 4], quadPoints[i + 6]].map(num);
    const ys = [quadPoints[i + 1], quadPoints[i + 3], quadPoints[i + 5], quadPoints[i + 7]].map(num);
    const rect = toRect(xs, ys, box, rotation);
    if (rect) out.push(rect);
  }
  return out;
}

/**
 * 一页的 pdf.js 注解 → 可画的标注。
 *
 * 坏数据（缺 rect、类型不认识、面积为零）一律跳过：这些标注画不出来，
 * 但一条坏数据不该让整页的标注都消失。
 */
export function mapFileAnnots(
  annots: ReadonlyArray<unknown>,
  opts: { box: readonly number[]; rotation?: number },
): PdfFileAnnot[] {
  const box = opts.box?.length === 4 ? opts.box : [0, 0, 612, 792];
  const rotation = num(opts.rotation);
  const out: PdfFileAnnot[] = [];
  for (const item of annots ?? []) {
    const annot = (item ?? null) as AnnotLike | null;
    if (!annot || typeof annot !== 'object') continue;
    const kind = KINDS[String(annot.subtype ?? '')];
    if (!kind) continue;
    const rects = quadRects(annot.quadPoints, box, rotation);
    if (!rects.length) {
      const r = annot.rect;
      if (!Array.isArray(r) || r.length !== 4) continue;
      const rect = toRect([num(r[0]), num(r[2])], [num(r[1]), num(r[3])], box, rotation);
      if (rect) rects.push(rect);
    }
    if (!rects.length) continue;
    out.push({
      kind,
      rects,
      color: toHex(annot.color),
      contents: typeof annot.contents === 'string' ? annot.contents.trim() : '',
      author: typeof annot.title === 'string' ? annot.title.trim() : '',
    });
  }
  return out;
}
