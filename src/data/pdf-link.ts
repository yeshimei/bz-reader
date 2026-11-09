/* ============================================================
 * bz-reader · PDF++ 链接格式（data/pdf-link.ts）
 *
 * PDF++（RyotaUshio/obsidian-pdf-plus，MIT）不自己渲染 PDF，它增强
 * Obsidian 原生 PDF 视图，并把「页 + 页内位置」写进链接：
 *
 *   [[paper.pdf#page=3]]
 *   [[paper.pdf#page=3&selection=0,1,2,3&color=yellow]]
 *   [[paper.pdf#page=3&rect=10,20,30,40&color=red]]
 *   [[paper.pdf#page=3&offset=12,34,1.5]]
 *
 *   selection = <起始 textDiv 下标>,<起始字符偏移>,<结束 textDiv 下标>,<结束字符偏移>
 *   rect      = <left>,<top>,<width>,<height>（PDF 页面坐标系，非屏幕像素）
 *   offset    = <left>,<top>,<zoom>（Obsidian 原生 PDF 视图的滚动/缩放）
 *
 * 我们的 PDF 引擎用 `pdf/<页>/<起>-<止>` 做内部定位，但**读取**别人的链接时
 * 要能认出这几种形状——否则从 PDF++、从 Obsidian 原生 PDF 复制出来的链接，
 * 点进 bz 阅读器就只会打开第一页。
 * ============================================================ */

export interface PdfLinkSelection {
  beginIndex: number;
  beginOffset: number;
  endIndex: number;
  endOffset: number;
}

export interface PdfLinkRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfLinkOffset {
  left: number | null;
  top: number | null;
  zoom: number | null;
}

export interface PdfLinkTarget {
  /** 1 基页码 */
  page: number;
  selection?: PdfLinkSelection;
  rect?: PdfLinkRect;
  color?: string;
  offset?: PdfLinkOffset;
  /**
   * 本插件自己的精确定位串（`pdf/5/12-30`、`pdf/5/r=…`）。
   *
   * 塞进同一个 hash 的 `bzr=` 参数里：PDF++ 和 Obsidian 原生视图都不认这个
   * 参数、会忽略它，我们自己的阅读器拿它就能一次跳到那一句；filename 换成
   * 原生视图打开时，退化成只认 `page=` 也不至于打不开。
   */
  locator?: string;
}

function int(raw: string | null): number | null {
  if (raw === null || !/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function num(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function split4(raw: string): number[] | null {
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const out = parts.map((p) => int(p));
  if (out.some((n) => n === null)) return null;
  return out as number[];
}

/** 解析 `page=3&selection=...` / `#page=3&rect=...`；认不出返回 null */
export function parsePdfLinkHash(hash: string): PdfLinkTarget | null {
  const raw = String(hash ?? '').trim().replace(/^#/, '');
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const page = int(params.get('page'));
  if (page === null || page < 1) return null;

  const target: PdfLinkTarget = { page };
  const selection = params.get('selection');
  if (selection) {
    const nums = split4(selection);
    if (nums) {
      target.selection = {
        beginIndex: nums[0],
        beginOffset: nums[1],
        endIndex: nums[2],
        endOffset: nums[3],
      };
    }
  }
  const rect = params.get('rect');
  if (rect) {
    const nums = split4(rect);
    if (nums) target.rect = { left: nums[0], top: nums[1], width: nums[2], height: nums[3] };
  }
  const color = params.get('color');
  if (color && /^[a-z0-9-]{1,32}$/i.test(color)) target.color = color;
  const offset = params.get('offset');
  if (offset) {
    const parts = offset.split(',');
    if (parts.length === 3) {
      target.offset = { left: num(parts[0]), top: num(parts[1]), zoom: num(parts[2]) };
    }
  }
  const locator = params.get('bzr');
  if (locator) {
    try {
      const decoded = decodeURIComponent(locator);
      /* 只收本插件自己的定位串：别的插件也可能往 URL 里塞 bzr */
      if (/^pdf\/\d+(?:\/|$)/.test(decoded)) target.locator = decoded;
    } catch {
      /* 半截编码，忽略 */
    }
  }
  return target;
}

/** 生成 PDF++ 兼容的哈希（不带 `#` 前缀以外的多余内容） */
export function buildPdfLinkHash(target: PdfLinkTarget): string {
  const parts = [`page=${Math.max(1, Math.floor(target.page))}`];
  if (target.selection) {
    const s = target.selection;
    parts.push(`selection=${s.beginIndex},${s.beginOffset},${s.endIndex},${s.endOffset}`);
  }
  if (target.rect) {
    const r = target.rect;
    parts.push(`rect=${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`);
  }
  if (target.color) parts.push(`color=${target.color}`);
  if (target.offset) {
    const o = target.offset;
    parts.push(`offset=${o.left ?? ''},${o.top ?? ''},${o.zoom ?? ''}`);
  }
  if (target.locator) parts.push(`bzr=${encodeURIComponent(target.locator)}`);
  return `#${parts.join('&')}`;
}

/**
 * 生成 PDF++ 子路径（不带 `#`）：`page=3&selection=…&rect=…&color=…&bzr=…`
 *
 * 四种消费方都能吃：
 *   · Obsidian 原生 PDF 视图 —— 只认 `page=`
 *   · PDF++ —— 认 `page/selection/rect/color`
 *   · 本插件 —— 优先用 `bzr=` 精确定位，没有就退回页码 + 原文片段
 *   · 别的 Markdown 工具 —— 当普通锚点，不会打不开
 */
export function pdfSubpathOf(input: {
  page: number;
  selection?: PdfLinkSelection;
  rect?: PdfLinkRect;
  color?: string;
  locator?: string;
}): string {
  return buildPdfLinkHash(input).slice(1);
}

/** 链接里的位置是否足够具体（只有页码 = 整页） */
export function hasPdfLinkPreciseTarget(target: PdfLinkTarget): boolean {
  return !!target.selection || !!target.rect;
}
