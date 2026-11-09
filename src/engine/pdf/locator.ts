/* ============================================================
 * bz-reader · PDF 定位串（engine/pdf/locator.ts）
 *
 * PDF 没有 EPUB 的 CFI，但全仓的「划线 / 书摘 / 深链 / 知识盒」都把定位
 * 存在 `cfiRange` 这一个字段里。与其给每一处加第二套类型，不如给 PDF
 * 造一个同形状的字符串定位：
 *
 *   pdf/12          整页（第 12 页，1 基）
 *   pdf/12/3-18     第 12 页里第 3–18 个字符（用于划线）
 *
 * 解析一律不抛错：外部链接、旧数据、用户手写都可能塞进任何字符串，
 * 认不出来就返回 null，由调用方决定退化成「打开第一页」还是「忽略」。
 * ============================================================ */

const PREFIX = 'pdf/';

export interface PdfLocatorTarget {
  /** 1 基页码（展示口径；内部取页时再减一） */
  page: number;
  /** 页文本里的起始字符偏移 */
  start: number;
  /** 页文本里的结束字符偏移（含） */
  end: number;
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

export function pdfPageLocator(page: number): string {
  return encodePdfLocator(page);
}
