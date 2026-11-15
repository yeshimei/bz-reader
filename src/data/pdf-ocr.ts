/* ============================================================
 * bz-reader · 扫描页识别的落盘（data/pdf-ocr.ts）
 *
 * 一本书一个 JSON，按页存识别结果。和画像同一个理由：**跟库走、单独一个文件**，
 * 不进 `bz-reader.json`（那是要被 bz 读的数据契约，不该被几百页坐标撑大）。
 *
 * 为什么是「一本书一个文件」而不是「一页一个文件」：
 *   · 识别是逐页发生的，写完一页就要落盘（关掉就走、断了能续）；
 *   · 整本 300 页的行坐标约 1–2 MB，重写一次几十毫秒，比 300 次目录遍历稳；
 *   · 一页一个文件在同步盘上会产生几百个碎片，备份/迁移都会变慢。
 * 所以写入侧用「合并 + 原子写」：读回来 → 改一页 → 整份落盘。
 *
 * 识别结果本身的不变量（坐标怎么收、行怎么排）在 engine/pdf/ocr.ts；
 * 这里只管形状、版本与路径安全。
 * ============================================================ */

import type { App } from 'obsidian';
import { storageDirOf } from '../core/plugin-path';
import type { OcrEngine, OcrLine, OcrPage } from '../engine/pdf/ocr';
import { ocrPageChars, ocrPageEmpty } from '../engine/pdf/ocr';

export const OCR_VERSION = 1;

/** 数据目录下的子目录 */
export const OCR_DIR = 'ocr';

export interface OcrFile {
  version: 1;
  bookId: string;
  /**
   * 书的指纹（导入时算的那一份）。换了版本的 PDF 页尺寸会变，
   * 按旧尺寸算出来的比例坐标就不再成立——调用方据此整份作废。
   */
  fingerprint?: string;
  /** 最近一次识别用的引擎与模型（换模型时界面要能说清「这批是谁认的」） */
  engine: OcrEngine;
  model: string;
  /** 页号（1 基的字符串键）→ 那一页的结果 */
  pages: Record<string, OcrPage>;
  updatedAt: number;
}

const ENGINES: ReadonlySet<string> = new Set(['deepseek', 'vision', 'http', 'manual']);

function engineOf(value: unknown): OcrEngine {
  const s = String(value ?? '');
  return (ENGINES.has(s) ? s : 'manual') as OcrEngine;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 页号键只认正整数；别的一律丢掉 */
function pageKey(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 一条行：文本必有，位置可选（没有位置的页只能读不能划） */
function sanitizeLine(raw: unknown): OcrLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const text = String(item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!text) return null;
  const src = item.rect as Record<string, unknown> | undefined;
  const rect = src
    ? {
        left: Math.min(1, Math.max(0, num(src.left))),
        top: Math.min(1, Math.max(0, num(src.top))),
        width: Math.min(1, Math.max(0, num(src.width))),
        height: Math.min(1, Math.max(0, num(src.height))),
      }
    : null;
  const line: OcrLine = { text };
  if (rect && rect.width > 0 && rect.height > 0) line.rect = rect;
  const conf = Number(item.confidence);
  if (Number.isFinite(conf)) line.confidence = Math.min(1, Math.max(0, conf));
  return line;
}

/** 一页：全是坏行就当这页没认过 */
export function sanitizeOcrPage(raw: unknown): OcrPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const lines: OcrLine[] = [];
  for (const item of Array.isArray(src.lines) ? src.lines : []) {
    const line = sanitizeLine(item);
    if (line) lines.push(line);
  }
  const text = String(src.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200_000);
  /* layout 只在「明确标了 true、且每行都真有位置」时才成立：
     半层半文本会让字符偏移与 DOM 对不上，划线会落到别的行上 */
  const layout = src.layout === true && lines.length > 0 && lines.every((l) => !!l.rect);
  const page: OcrPage = {
    engine: engineOf(src.engine),
    model: String(src.model ?? '').slice(0, 200),
    at: num(src.at),
    layout,
    lines,
  };
  if (text) page.text = text;
  return ocrPageEmpty(page) ? null : page;
}

/** 整本：坏页丢掉，剩几页算几页；连 pages 都没有给空壳（书开着但一页没认） */
export function sanitizeOcrFile(raw: unknown, bookId: string): OcrFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const pages: Record<string, OcrPage> = {};
  const srcPages = src.pages && typeof src.pages === 'object' ? (src.pages as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(srcPages)) {
    const page = pageKey(key);
    if (!page) continue;
    const hit = sanitizeOcrPage(value);
    if (hit) pages[String(page)] = hit;
  }
  const out: OcrFile = {
    version: OCR_VERSION,
    bookId: String(src.bookId || bookId),
    engine: engineOf(src.engine),
    model: String(src.model ?? '').slice(0, 200),
    pages,
    updatedAt: num(src.updatedAt),
  };
  const fp = String(src.fingerprint ?? '').trim();
  if (fp) out.fingerprint = fp.slice(0, 200);
  return out;
}

export function ocrDir(): string {
  return `${storageDirOf()}/${OCR_DIR}`;
}

export function ocrPath(bookId: string): string {
  const id = String(bookId ?? '').trim();
  /* 只做防御：路径分隔符、冒号、通配符全部换掉。`..` 留着也无害——
     它已经被连成文件名的一部分，不再是独立路径段，跳不出去。 */
  const safe = id.replace(/[\\/:*?"<>|]/g, '_') || 'unknown';
  return `${ocrDir()}/${safe}.json`;
}

export function emptyOcrFile(bookId: string): OcrFile {
  return { version: OCR_VERSION, bookId, engine: 'manual', model: '', pages: {}, updatedAt: 0 };
}

export function ocrPageAt(file: OcrFile | null | undefined, page: number): OcrPage | null {
  if (!file) return null;
  const key = String(Math.max(1, Math.floor(Number(page) || 1)));
  return file.pages[key] ?? null;
}

/** 有识别的页，按页号升序 */
export function ocrPages(file: OcrFile | null | undefined): Array<{ page: number; ocr: OcrPage }> {
  if (!file) return [];
  return Object.entries(file.pages)
    .map(([key, ocr]) => ({ page: Number(key), ocr }))
    .filter((row) => Number.isFinite(row.page) && row.page > 0)
    .sort((a, b) => a.page - b.page);
}

export function ocrChars(file: OcrFile | null | undefined): number {
  return ocrPages(file).reduce((sum, row) => sum + ocrPageChars(row.ocr), 0);
}

/**
 * 写一页，返回新文件（不改入参）。
 *
 * `null` 表示「这本书还没有文件」——调用方直接用返回值即可，不必先造空壳。
 * 文件头跟着最后一页的引擎与模型走：一份文件里混着两个模型的结果时，
 * 界面显示最近那次，用户点「重认」会整页替换，不会产生两套坐标。
 */
export function withOcrPage(
  file: OcrFile | null | undefined,
  bookId: string,
  page: number,
  ocr: OcrPage,
): OcrFile {
  const base = file ?? emptyOcrFile(bookId);
  const key = String(Math.max(1, Math.floor(Number(page) || 1)));
  return {
    ...base,
    bookId: base.bookId || bookId,
    engine: ocr.engine,
    model: ocr.model,
    pages: { ...base.pages, [key]: ocr },
    updatedAt: Date.now(),
  };
}

/** 读：没有、坏了、没有 adapter 都返回 null（坏文件不删，留着能查） */
export async function readOcr(app: App | null | undefined, bookId: string): Promise<OcrFile | null> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return null;
  try {
    const path = ocrPath(bookId);
    if (!(await adapter.exists(path))) return null;
    return sanitizeOcrFile(JSON.parse(await adapter.read(path)), bookId);
  } catch {
    return null;
  }
}

/**
 * 写：原子写（`.tmp` → rename）。rename 不支持（移动端 SAF）时退回直接写。
 * 与画像同一条路——半截 JSON 等于整本白认。
 */
export async function writeOcr(app: App | null | undefined, file: OcrFile): Promise<boolean> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return false;
  const dir = ocrDir();
  const path = ocrPath(file.bookId);
  const tmp = `${path}.tmp`;
  const body = JSON.stringify({ ...file, version: OCR_VERSION, updatedAt: Date.now() });
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(tmp, body);
    try {
      await adapter.rename(tmp, path);
    } catch {
      await adapter.write(path, body);
      await adapter.remove(tmp).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export async function removeOcr(app: App | null | undefined, bookId: string): Promise<boolean> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return false;
  try {
    const path = ocrPath(bookId);
    if (!(await adapter.exists(path))) return false;
    await adapter.remove(path);
    return true;
  } catch {
    return false;
  }
}
