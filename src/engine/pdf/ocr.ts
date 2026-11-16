/* ============================================================
 * bz-reader · 扫描页的文字（engine/pdf/ocr.ts）
 *
 * 扫描版 PDF 的页是一张位图，pdf.js 的 `getTextContent()` 给不出任何字：
 * 搜索、划词、划线、朗读、AI 取文全部断在「没有文字层」这一个点上。
 * 这里做的是**把识别出来的字变成和 pdf.js 文字层同构的东西**：
 *
 *   OcrPage.lines（按阅读顺序、归一化矩形）
 *     → 伪 TextItem（str / transform / width / hasEOL）
 *     → 复用 text.ts 的 pageTextLayoutOf
 *     → 得到与文字版完全一样的 text + layerIndex
 *
 * 同构是这个模块全部的意义：只要 `pageTextLayoutOf` 拿到的 items 顺序与
 * 页面上的 span 顺序一致，划线存的 `pdf/<页>/<起>-<止>`、搜索命中的
 * 字符区间、`rectsOfOffset` 的还原就都自动成立，视图层一行都不用改。
 *
 * 三条硬约定：
 *  1. **坐标一律 0..1、左上原点、未旋转**：和 `pdf/<页>/r=` 同一套坐标系，
 *     页面缩放、旋转都不用重算（旋转由调用方用 rotateNormRect 换算）。
 *  2. **行级粒度**：一行一个 span。词级太碎（滚动重建掉帧），页级太粗
 *     （整页高亮没有信息量）。行级刚好——pdf.js 自己也常按词拆，但我们
 *     不需要它的精细度。
 *  3. **不许猜坐标**：模型给了 0..1000 就按千分比收（它就是这么约定的），
 *     给了看不出量纲的像素值就拒绝并让整页退回「只有文本」。坐标猜错
 *     会让划线整体错位，比不能划线更糟。
 * ============================================================ */

import { normalizePdfRect, type PdfRectArea } from './locator';
import { normalizeText, pageTextLayoutOf, type PdfPageTextLayout, type PdfTextItemLike } from './text';

/** 一行识别结果。`rect` 缺失 = 这家识别方没给位置（整页将不能造层） */
export interface OcrLine {
  text: string;
  rect?: PdfRectArea;
  /** 0..1；模型没给就不填 */
  confidence?: number;
}

/**
 * 谁认的。
 *
 * `vision` 是 2026-11-15 之前「让聊天模型看图」那一档留下的历史值：
 * 已经落盘的识别结果还带着它，读回来不能当成损坏；新识别只写
 * `deepseek`（官方 OCR）或 `http`（自建服务）。
 */
export type OcrEngine = 'deepseek' | 'http' | 'vision' | 'manual';

export interface OcrPage {
  engine: OcrEngine;
  /** 用哪个模型 / 哪个服务认的。换了就提示重认（标注意义上还成立，位置可能变） */
  model: string;
  /** 识别时间（ms） */
  at: number;
  /**
   * 能不能造透明文字层。
   *
   * true = 每行都有位置，划词 / 划线 / 搜索高亮全通；
   * false = 只有文字，搜索、朗读、AI 取文能用，但**不能划词**。
   * 这个字段是给用户的诚实交代：模型没听话给坐标时，别假装能划。
   */
  layout: boolean;
  lines: OcrLine[];
  /** 纯文本兜底：识别方只回了一整段字、一行都拆不开的时候用它 */
  text?: string;
  /**
   * 这一页认过、但确实没有文字（空白页、纯图封面）。
   *
   * 单独标出来是为了「别为同一页反复付钱」：空结果如果不落盘，
   * 下一批又会把它排进队列，跑一次失败一次，条子上永远挂着「N 页没成功」。
   * 有它之后空页算正常结果，只是没有文字层，也不进失败表。
   */
  empty?: boolean;
}

/** 解析模型返回之后的形状；`text` 是「一行都拆不出来」时的整段兜底 */
export interface ParsedOcr {
  lines: OcrLine[];
  layout: boolean;
  text: string;
}

/** 页面尺寸（pt，1 缩放）——识别时的页面没变，结果才还能用 */
export interface OcrPageSize {
  width: number;
  height: number;
}

/** 0..1000 是视觉模型最常见的坐标口径；超过它就必须有参照尺寸 */
const THOUSAND = 1000;

/** 四角坐标的键名（其余一律按「左上 + 宽高」收） */
const CORNER_KEYS = new Set(['bbox', 'bounds', 'rect', 'quad', 'polygon']);

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** 比例收 6 位小数：落盘与比较都稳，1e-6 远小于一个像素 */
function roundRect(rect: PdfRectArea): PdfRectArea {
  const fix = (n: number): number => Math.round(n * 1e6) / 1e6;
  return { left: fix(rect.left), top: fix(rect.top), width: fix(rect.width), height: fix(rect.height) };
}

/** 把「扁平的数数组」或「点数组」拍成扁平数数组；有一个不是数就返回 null */
function flatNums(value: unknown[]): number[] | null {
  const out: number[] = [];
  for (const item of value) {
    if (Array.isArray(item)) {
      for (const v of item) {
        const n = num(v);
        if (n === null) return null;
        out.push(n);
      }
      continue;
    }
    const n = num(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** 从一堆候选键里取四个数；认不出来返回 null */
function boxOf(raw: Record<string, unknown>): { nums: number[]; corners: boolean } | null {
  for (const [key, value] of Object.entries(raw)) {
    const k = key.toLowerCase();
    if (k !== 'box' && k !== 'bbox' && k !== 'bounds' && k !== 'rect' && k !== 'quad' && k !== 'polygon') continue;
    if (!Array.isArray(value)) continue;
    const flat = flatNums(value);
    if (!flat) continue;
    /* 四边形：Umi-OCR 给 `[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]`（四点数组），
       PaddleOCR 给扁平八个数。两种都拍成八个数，取外包矩形。
       只取前四个数会把框算成「左上点 + 右上点当宽高」，整页歪到右上角。 */
    const bounds = polygonBounds(flat);
    if (bounds) return { nums: bounds, corners: true };
    if (flat.length < 4) continue;
    return { nums: flat.slice(0, 4), corners: CORNER_KEYS.has(k) };
  }
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w ?? raw.width);
  const h = num(raw.h ?? raw.height);
  if (x !== null && y !== null && w !== null && h !== null) {
    return { nums: [x, y, w, h], corners: false };
  }
  return null;
}

/**
 * 八个数（或更多、偶数）按「点序列」收成轴对齐外包矩形 `[minX,minY,maxX,maxY]`。
 *
 * 不够八个点就返回 null，交给「左上 + 宽高」那条路——这正是
 * `[x,y,w,h]` 与 `[[x1,y1],[x2,y2]…]` 唯一能区分开的地方。
 */
function polygonBounds(flat: readonly number[]): number[] | null {
  if (flat.length < 8 || flat.length % 2 !== 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    xs.push(flat[i]);
    ys.push(flat[i + 1]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * PaddleOCR 一类自建服务把一行回成 `[box, [text, score]]` 或 `[box, text]`。
 *
 * 这种数组项没法套 `.text` / `.box` 的键名，单独收一条。box 可以是
 * 四点数组、扁平八个数，也可以是 `[x,y,w,h]`。
 */
function pairLine(raw: readonly unknown[]): { text: string; box: { nums: number[]; corners: boolean } } | null {
  if (raw.length < 2) return null;
  const box = raw[0];
  const rest = raw[1];
  if (!Array.isArray(box)) return null;
  const flat = flatNums(box);
  if (!flat) return null;
  const text = typeof rest === 'string' ? textOf(rest) : Array.isArray(rest) ? textOf(rest[0]) : '';
  if (!text) return null;
  const bounds = polygonBounds(flat);
  if (bounds) return { text, box: { nums: bounds, corners: true } };
  if (flat.length < 4) return null;
  return { text, box: { nums: flat.slice(0, 4), corners: false } };
}

/**
 * 坐标量纲：归一化 / 像素（必须给参照尺寸）/ 千分比。
 *
 * **先认归一化，再认像素**：像素坐标不可能整条框都落在 0..1 里（那是一个
 * 亚像素的框），而 0..1 的服务很常见。反过来的话，只要调用方带了出图宽高，
 * 比例坐标就会被再除一遍宽高，缩到 0.0006——划线整体贴到左上角。
 *
 * 像素与 0..1000 千分比在带参照尺寸时仍会撞车（2026-11-16）：像素坐标
 * 不可能超出图宽高的一成多，超了就只能来自千分比服务。小于图宽的千分比
 * 仍无法与像素区分，协议上暂按像素收；要彻底解决得让调用方显式声明单位。
 * 三个都认不出来就返回 null —— 宁可这行没有位置，也不按错的量纲摆。
 */
function scaleOf(nums: readonly number[], ref?: OcrPageSize): 'normalized' | 'thousand' | 'pixels' | null {
  const max = Math.max(...nums.map((n) => Math.abs(n)));
  if (max <= 1.0001) return 'normalized';
  if (ref && ref.width > 0 && ref.height > 0) {
    if (max > Math.max(ref.width, ref.height) * 1.15 && max <= THOUSAND) return 'thousand';
    return 'pixels';
  }
  if (max <= THOUSAND) return 'thousand';
  return null;
}

/**
 * 一条原始识别结果 → OcrLine。认不出位置或文字为空返回 null。
 *
 * 两种形状都收：对象（`{text, box}`）与 PaddleOCR 的
 * `[box, [text, score]]` 二元组。
 *
 * `ref` 是识别时那张图的像素宽高：只有给了它，像素坐标才会被接受。
 */
export function normalizeOcrLine(raw: unknown, ref?: OcrPageSize): OcrLine | null {
  if (!raw || typeof raw !== 'object') return null;
  let text = '';
  let box: { nums: number[]; corners: boolean } | null = null;
  let confidence: number | null = null;
  if (Array.isArray(raw)) {
    const pair = pairLine(raw);
    if (!pair) return null;
    text = pair.text;
    box = pair.box;
    confidence = num(Array.isArray(raw[1]) ? (raw[1] as unknown[])[1] : null);
  } else {
    const item = raw as Record<string, unknown>;
    text = textOf(item.text ?? item.content ?? item.value ?? item.line ?? item.str);
    if (!text) return null;
    box = boxOf(item);
    confidence = num(item.confidence ?? item.score ?? item.prob);
  }
  if (!box) return null;
  const scale = scaleOf(box.nums, ref);
  if (!scale) return null;

  let [a, b, c, d] = box.nums;
  if (scale === 'thousand') {
    a /= THOUSAND;
    b /= THOUSAND;
    c /= THOUSAND;
    d /= THOUSAND;
  } else if (scale === 'pixels' && ref) {
    a /= ref.width;
    c /= ref.width;
    b /= ref.height;
    d /= ref.height;
  }

  /* 四角坐标换成「左上 + 宽高」；负宽高（模型偶尔给反向）折成正的 */
  const left = box.corners ? Math.min(a, c) : Math.min(a, a + c);
  const top = box.corners ? Math.min(b, d) : Math.min(b, b + d);
  const width = box.corners ? Math.abs(c - a) : Math.abs(c);
  const height = box.corners ? Math.abs(d - b) : Math.abs(d);
  /* 收到 6 位小数再存：千分比折算是 0.1/1000 这种无限循环，不收敛的话
     落盘 JSON 里全是 0.19999999999999998，locator 也会跟着变长 */
  const rect = roundRect(normalizePdfRect({ left, top, width, height }));
  if (rect.width <= 0 || rect.height <= 0) return null;

  const out: OcrLine = { text, rect };
  if (confidence !== null) out.confidence = Math.min(1, Math.max(0, confidence > 1 ? confidence / 100 : confidence));
  return out;
}

/** 竖直重叠达到较矮那个的多大比例才算同一行（和 rects.ts 同一套口径） */
const ROW_OVERLAP = 0.5;

/**
 * 按阅读顺序排：先按上边界聚行，行内从左到右。
 *
 * 只做单栏。双栏论文会把左右两栏串成一行——这是已知限制，不在这里做
 * 分栏检测：分栏判错的代价（整段顺序散架）比串行更大。
 */
export function orderOcrLines(lines: readonly OcrLine[]): OcrLine[] {
  const items = lines
    .filter((line) => line && line.rect && line.text.trim())
    .map((line) => ({ ...line, text: line.text.trim(), rect: { ...line.rect! } }))
    .sort((x, y) => x.rect.top - y.rect.top || x.rect.left - y.rect.left);
  if (items.length <= 1) return items;

  const rows: OcrLine[][] = [];
  let rowTop = 0;
  let rowBottom = 0;
  for (const item of items) {
    const rect = item.rect;
    const bottom = rect.top + rect.height;
    if (rows.length) {
      const overlap = Math.min(bottom, rowBottom) - Math.max(rect.top, rowTop);
      const shorter = Math.min(rect.height, rowBottom - rowTop);
      if (overlap > 0 && overlap >= shorter * ROW_OVERLAP) {
        rows[rows.length - 1].push(item);
        rowBottom = Math.max(rowBottom, bottom);
        continue;
      }
    }
    rows.push([item]);
    rowTop = rect.top;
    rowBottom = bottom;
  }

  const out: OcrLine[] = [];
  for (const row of rows) {
    row.sort((x, y) => x.rect!.left - y.rect!.left);
    out.push(...row);
  }
  return out;
}

/** 占位行高：没有位置的行走这条，只为了让行与行之间判成「换行」 */
const FALLBACK_LINE_H = 0.02;

/**
 * 行 → 伪 TextItem。
 *
 * 每行 `hasEOL: true`：行与行之间在页文本里补一个空格，英文跨行才不会
 * 粘成一个词；DOM 里 span 之间不插任何字符，所以补出来的空格在
 * `layerIndex` 里指向下一行的起点——这正是 `pdfHitLocator` 与划线偏移
 * 需要的关系。
 */
export function ocrLinesToItems(lines: readonly OcrLine[]): PdfTextItemLike[] {
  const ordered = orderOcrLines(lines);
  const out: PdfTextItemLike[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i];
    const rect = line.rect ?? { left: 0.05, top: Math.min(0.95, 0.05 + i * FALLBACK_LINE_H), width: 0.9, height: FALLBACK_LINE_H };
    const height = Math.max(0.005, rect.height);
    out.push({
      str: line.text,
      hasEOL: true,
      /* 横排：a=1,b=0 是文字方向；c=0,d=行高是字号；e/f 是原点。
         这套单位只用于「两项之间该不该补空格」的比较，不参与定位。 */
      transform: [1, 0, 0, height, rect.left, rect.top],
      width: Math.max(0, rect.width),
      height,
    });
  }
  return out;
}

/** 整页文本 + 文字层映射（与文字版同一套结构） */
export function ocrPageTextLayout(page: OcrPage): PdfPageTextLayout {
  if (page.lines?.length) return pageTextLayoutOf(ocrLinesToItems(page.lines));
  const text = normalizeText(page.text ?? '');
  return { text, layerIndex: [] };
}

export function ocrPageText(page: OcrPage): string {
  return ocrPageTextLayout(page).text;
}

/** 识别出来的字数（不含补出来的空格）——书架与统计用 */
export function ocrPageChars(page: OcrPage): number {
  return ocrPageText(page).replace(/\s+/g, '').length;
}

export function ocrPageEmpty(page: OcrPage | null | undefined): boolean {
  if (!page) return true;
  return !page.lines?.length && !String(page.text ?? '').trim();
}

/**
 * 抽样出来的几段页文本都为空 → 这本是扫描件。
 *
 * 不能只看首页：很多书第一页是封面图、第二页开始才是字；反过来也有
 * 「封面有字、正文全是图」的。抽样首页 / 中间 / 末页三处，三处都没字
 * 才判扫描件。样本为空（一页都没取到）不判——不知道就别乱说。
 */
export function looksScanned(samples: readonly string[]): boolean {
  if (!samples.length) return false;
  return samples.every((text) => !String(text ?? '').trim());
}

/** 扫描件判定的抽样页号（1 基，去重后升序） */
export function scanSamplePages(total: number): number[] {
  const last = Math.max(1, Math.floor(Number(total) || 1));
  const picks = [1, Math.ceil(last / 2), last];
  return [...new Set(picks.map((n) => Math.min(last, Math.max(1, n))))].sort((a, b) => a - b);
}

/* ─────────── 模型返回的解析 ─────────── */

/** 从一段可能带围栏 / 前言 / 总结的文字里抠出 JSON */
export function extractJson(raw: string): unknown {
  const src = String(raw ?? '').trim();
  if (!src) return null;
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(src);
  const body = (fenced?.[1] ?? src).trim();
  const tries = [body];
  const firstBrace = body.indexOf('{');
  const firstBracket = body.indexOf('[');
  const start = firstBrace < 0 ? firstBracket : firstBracket < 0 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start > 0) tries.push(body.slice(start));
  if (start >= 0) {
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (end > start) tries.push(body.slice(start, end + 1));
  }
  for (const candidate of tries) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      /* 试下一种 */
    }
  }
  return null;
}

/** 从对象里拿行数组：`lines` / `blocks` / `items` / 裸数组都认 */
function linesOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['lines', 'blocks', 'items', 'results', 'data']) {
    const hit = obj[key];
    if (Array.isArray(hit)) return hit as unknown[];
  }
  return null;
}

/** 整页兜底文本：`text` / `content` / 直接一个字符串 */
function pageTextOf(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'plainText', 'text_content']) {
    if (typeof obj[key] === 'string') return String(obj[key]).replace(/\s+/g, ' ').trim();
  }
  return '';
}

/**
 * 识别结果（模型原文或 OCR 服务响应）→ 可直接落盘的结构。
 *
 * `layout` 的判定很严：**只要有一行没有位置，整页就不造层**。半层半文本
 * 会让字符偏移与 DOM 对不上，划线就会落到别的行上——比不能划更糟。
 */
export function parseOcrJson(raw: string, ref?: OcrPageSize): ParsedOcr {
  return parseOcrValue(extractJson(raw), ref);
}

/** 已经是对象的响应（外部 OCR 服务直接回 JSON）走这条 */
export function parseOcrValue(value: unknown, ref?: OcrPageSize): ParsedOcr {
  if (value === null || value === undefined) return { lines: [], layout: false, text: '' };
  const list = linesOf(value);
  const fallback = pageTextOf(value);
  if (!list) return { lines: [], layout: false, text: fallback };

  const lines: OcrLine[] = [];
  let placed = 0;
  for (const item of list) {
    const hit = normalizeOcrLine(item, ref);
    if (hit) {
      lines.push(hit);
      placed += 1;
      continue;
    }
    /* 有字没位置：文本留着（搜索、朗读还能用），位置交给 layout=false 交代 */
    const text = textOf((item as Record<string, unknown> | null)?.text ?? (item as Record<string, unknown> | null)?.content);
    if (text) lines.push({ text });
  }
  const layout = lines.length > 0 && placed === lines.length && lines.every((l) => !!l.rect);
  return { lines, layout, text: lines.length ? '' : fallback };
}
