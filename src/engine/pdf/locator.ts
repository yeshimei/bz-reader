/* ============================================================
 * bz-reader · PDF 定位串（engine/pdf/locator.ts）
 *
 * PDF 没有 EPUB 的 CFI，但全仓的「划线 / 书摘 / 深链 / 知识盒」都把定位
 * 存在 `cfiRange` 这一个字段里。与其给每一处加第二套类型，不如给 PDF
 * 造一个同形状的字符串定位：
 *
 *   pdf/12          整页（第 12 页，1 基）
 *   pdf/12/3-18     第 12 页里第 3–18 个字符（用于划线）
 *   pdf/12/r=…      第 12 页里的一块矩形（用于框选，见 PdfRectArea）
 *
 * 解析一律不抛错：外部链接、旧数据、用户手写都可能塞进任何字符串，
 * 认不出来就返回 null，由调用方决定退化成「打开第一页」还是「忽略」。
 * ============================================================ */

const PREFIX = 'pdf/';

/** 页面内的一块矩形，坐标是相对页宽高的比例（0..1），滚动缩放后仍然成立 */
export interface PdfRectArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfLocatorTarget {
  /** 1 基页码（展示口径；内部取页时再减一） */
  page: number;
  /** 页文本里的起始字符偏移 */
  start: number;
  /** 页文本里的结束字符偏移（含） */
  end: number;
  /** 框选区域；只有 `r=` 形式的定位串才有 */
  rect?: PdfRectArea;
}

/** 比例归一到 0..1，并保证 left+width / top+height 不越界 */
export function normalizePdfRect(rect: PdfRectArea): PdfRectArea {
  const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  const left = clamp01(rect?.left ?? 0);
  const top = clamp01(rect?.top ?? 0);
  let width = clamp01(rect?.width ?? 0);
  let height = clamp01(rect?.height ?? 0);
  if (left + width > 1) width = Math.max(0, 1 - left);
  if (top + height > 1) height = Math.max(0, 1 - top);
  return { left, top, width, height };
}

/** 非负整数：只认纯数字，`3.5` / `3a` / `+3` 一律不认 */
function nonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parsePdfLocator(value: string): PdfLocatorTarget | null {
  const s = String(value ?? '').trim();
  if (!s.startsWith(PREFIX)) return null;
  const rest = s.slice(PREFIX.length);
  const parts = rest.split('/');
  if (parts.length === 1) {
    const page = nonNegativeInt(parts[0]);
    return page && page > 0 ? { page, start: 0, end: 0 } : null;
  }
  if (parts.length !== 2) return null;
  const page = nonNegativeInt(parts[0]);
  if (!page || page <= 0) return null;
  /* 框选：`r=<左>,<上>,<宽>,<高>`，四个数都是 0..1 的比例 */
  if (parts[1].startsWith('r=')) {
    const nums = parts[1].slice(2).split(',').map((piece) => Number(piece.trim()));
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
    const rect = normalizePdfRect({
      left: nums[0],
      top: nums[1],
      width: nums[2],
      height: nums[3],
    });
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { page, start: 0, end: 0, rect };
  }
  const range = parts[1].split('-');
  if (range.length !== 2) return null;
  const start = nonNegativeInt(range[0]);
  const end = nonNegativeInt(range[1]);
  if (start === null || end === null) return null;
  return { page, start: Math.min(start, end), end: Math.max(start, end) };
}

export function isPdfLocator(value: string): boolean {
  return parsePdfLocator(value) !== null;
}

/** 归一：页码至少 1；区间端点非负且保证 start <= end */
export function encodePdfLocator(page: number, start?: number, end?: number): string {
  const raw = Number.isFinite(page) ? Math.floor(page) : 1;
  const p = Math.max(1, raw);
  if (start === undefined && end === undefined) return `${PREFIX}${p}`;
  const a = Math.max(0, Math.floor(Number.isFinite(start) ? (start as number) : 0));
  const b = Math.max(0, Math.floor(Number.isFinite(end) ? (end as number) : a));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${PREFIX}${p}/${lo}-${hi}`;
}

/** 只要页码（1 基）；认不出返回 null */
export function pdfLocatorPage(value: string): number | null {
  return parsePdfLocator(value)?.page ?? null;
}

/** 框选定位串：`pdf/<页>/r=<左>,<上>,<宽>,<高>`，四位小数够用且不会写成一长串 */
export function encodePdfRectLocator(page: number, rect: PdfRectArea): string {
  const raw = Number.isFinite(page) ? Math.floor(page) : 1;
  const p = Math.max(1, raw);
  const r = normalizePdfRect(rect);
  const fix = (n: number): string => n.toFixed(4);
  return `${PREFIX}${p}/r=${fix(r.left)},${fix(r.top)},${fix(r.width)},${fix(r.height)}`;
}

/**
 * 把「未旋转页面坐标」里的矩形换算到旋转后的坐标系。
 *
 * 归一化矩形存的是相对页面宽高的比例，页面一转，宽高互换、坐标轴也跟着转：
 * 左上角的小方块在转了 90° 之后应该出现在右上角。不换算的话，旋转后所有
 * 划线与框选都会跑到页面中间（真机上就是「转一下就全错位了」）。
 */
export function rotateNormRect(rect: PdfRectArea, deg: number): PdfRectArea {
  const d = (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;
  const { left: l, top: t, width: w, height: h } = normalizePdfRect(rect);
  if (d === 90) return normalizePdfRect({ left: 1 - t - h, top: l, width: h, height: w });
  if (d === 180) return normalizePdfRect({ left: 1 - l - w, top: 1 - t - h, width: w, height: h });
  if (d === 270) return normalizePdfRect({ left: t, top: 1 - l - w, width: h, height: w });
  return { left: l, top: t, width: w, height: h };
}

export function pdfPageLocator(page: number): string {
  return encodePdfLocator(page);
}
