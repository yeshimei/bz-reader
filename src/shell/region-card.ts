/* ============================================================
 * bz-reader · 框选区域存成图片书摘（shell/region-card.ts）
 *
 * 和「书摘卡」（card-image.ts）不是一回事：那边画的是纯文字，这边要
 * 先把页面上框住的那一块裁下来，再把引文与页码放在下面。
 *
 * 三条约束：
 *  1. **裁切坐标要跟着旋转走**：区域定位串存的是未旋转页面坐标，页图是
 *     显示方向出的；不换算，转着看的页裁出来是歪的（与 OCR 那条同一套）。
 *  2. **卡片宽度固定**：截图按比例缩放，长截图封顶后在框内居中，不撑爆卡片。
 *  3. **不依赖主题变量也能出图**：读不到宿主颜色时用黑底白字兜底，
 *     图是给笔记用的，不该因为主题变量缺失就出不来。
 * ============================================================ */

import { rotateNormRect, type PdfRectArea } from '../engine/pdf/locator';

/** 卡片宽（2× 出图，与书摘卡同一档） */
export const REGION_CARD_W = 720;
/** 左右内边距 */
const PAD = 24;
/** 截图最大高度：再长就按高缩，避免一张图占满整屏 */
const SHOT_MAX_H = 520;
/** 引文最多几行 */
const QUOTE_LINES = 4;

export interface RegionShotSize {
  width: number;
  height: number;
}

/**
 * 截图在卡片里的显示尺寸。
 *
 * 先按可用宽度铺满；高度超过上限时改按高度缩，宽度随之变小（居中）。
 */
export function regionShotSize(
  cropW: number,
  cropH: number,
  availW = REGION_CARD_W - PAD * 2,
  maxH = SHOT_MAX_H,
): RegionShotSize {
  const w = Math.max(1, Number.isFinite(cropW) ? cropW : 1);
  const h = Math.max(1, Number.isFinite(cropH) ? cropH : 1);
  const byW = availW / w;
  const byH = maxH / h;
  const scale = Math.min(byW, byH);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** 区域（未旋转页面坐标）→ 显示方向的实际裁切框（0..1） */
export function regionCropRect(rect: PdfRectArea, rotation: number): PdfRectArea {
  return rotateNormRect(rect, rotation);
}

/**
 * 引文压成几行。
 *
 * 用 canvas 量宽，和 card-image.ts 的断行同一套思路：中文没有空格，
 * 按字符累加才不会在标点处随机断。
 */
export function clampQuoteLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = QUOTE_LINES,
): string[] {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const out: string[] = [];
  let line = '';
  for (const ch of raw) {
    const next = line + ch;
    if (line && measure(next) > maxWidth) {
      out.push(line);
      line = ch;
      if (out.length >= maxLines) break;
    } else line = next;
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length >= maxLines) {
    /* 被截断时最后一行补省略号：让人知道图里不是全文 */
    const last = out[maxLines - 1] ?? '';
    if (raw.length > out.join('').length) out[maxLines - 1] = `${last}…`;
  }
  return out;
}

export interface RegionCardInput {
  /** 整页图（显示方向） */
  image: Blob;
  /** 区域（未旋转页面坐标） */
  rect: PdfRectArea;
  /** 出图时的显示角度 */
  rotation: number;
  /** 引文（区域里的识别文字；空 = 只出截图） */
  quote?: string;
  /** 书名 / 页码，合成一行脚注 */
  title?: string;
  page: number;
}

interface CardColors {
  bg: string;
  ink: string;
  faint: string;
  accent: string;
}

function readColors(): CardColors {
  const pick = (name: string, fallback: string): string => {
    try {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  };
  return {
    bg: pick('--background-primary', '#ffffff'),
    ink: pick('--text-normal', '#222222'),
    faint: pick('--text-faint', '#888888'),
    accent: pick('--interactive-accent', '#c8a24a'),
  };
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/** 画一张「截图 + 引文 + 页码」的卡片，返回 PNG */
export async function renderRegionCard(input: RegionCardInput): Promise<Blob> {
  const img = await loadImage(input.image);
  const crop = regionCropRect(input.rect, input.rotation);
  const sw = Math.max(1, Math.round(crop.width * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.height * img.naturalHeight));
  const sx = Math.round(crop.left * img.naturalWidth);
  const sy = Math.round(crop.top * img.naturalHeight);
  const shot = regionShotSize(sw, sh);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  const colors = readColors();

  const quoteFont = 17;
  const quoteLineH = 30;
  const maxQuoteW = REGION_CARD_W - PAD * 2;
  ctx.font = `${quoteFont}px serif`;
  const lines = clampQuoteLines(input.quote ?? '', maxQuoteW, (s) => ctx.measureText(s).width);
  const quoteH = lines.length * quoteLineH;
  const footH = 28;
  const H = PAD + shot.height + (lines.length ? 18 + quoteH : 0) + footH + PAD;

  const scale = 2;
  canvas.width = REGION_CARD_W * scale;
  canvas.height = Math.round(H) * scale;
  ctx.scale(scale, scale);

  /* 底 */
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, REGION_CARD_W, H);

  /* 截图：居中，细边框 */
  const ix = Math.round((REGION_CARD_W - shot.width) / 2);
  ctx.drawImage(img, sx, sy, sw, sh, ix, PAD, shot.width, shot.height);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ix + 0.5, PAD + 0.5, shot.width - 1, shot.height - 1);

  /* 引文 */
  let y = PAD + shot.height + 18;
  if (lines.length) {
    ctx.font = `${quoteFont}px serif`;
    ctx.textBaseline = 'top';
    for (const line of lines) {
      ctx.fillStyle = colors.ink;
      ctx.fillText(line, PAD, y);
      y += quoteLineH;
    }
  }

  /* 脚注：书名 · 第 N 页 */
  const foot = [input.title?.trim(), `P${Math.max(1, Math.round(input.page))}`].filter(Boolean).join(' · ');
  ctx.font = `12px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.faint;
  ctx.fillText(foot, PAD, H - PAD - 14);
  /* 右侧一枚小记号，和书摘卡一样属于署名 */
  ctx.fillStyle = colors.accent;
  ctx.fillRect(REGION_CARD_W - PAD - 3, H - PAD - 14, 3, 12);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('export failed'));
    }, 'image/png');
  });
}

/** 出图并写剪贴板 */
export async function copyRegionCard(input: RegionCardInput): Promise<void> {
  const blob = await renderRegionCard(input);
  const nav = navigator as Navigator & { clipboard?: Clipboard };
  if (!nav.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('clipboard unsupported');
  }
  await nav.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
