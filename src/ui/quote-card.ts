/* ============================================================
 * bz-reader · 书摘卡片（ui/quote-card.ts）
 *
 * 把一条划线渲染成分享尺寸的 PNG：书名/章节/原文/想法/日期。
 * canvas 画，不走 DOM 截图——插件环境里没有 html2canvas，也
 * 不值得为一张卡片引一个 200KB 的依赖。
 *
 * 尺寸 720×N，内部按 2x 绘制：分享出去的图要经得起放大，
 * 360 逻辑宽在手机上刚好满屏。文字用逐字符换行（中文为主），
 * ASCII 连续段当一个词，不让英文单词被腰斩。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import type { ReaderSettings } from '../data/settings';
import { el } from './dom';
import { uiModal } from '../core/ui/modal';

const SCALE = 2;
const W = 720;
const PAD = 56;

export interface QuoteCardInput {
  bookTitle: string;
  author?: string;
  chapter?: string;
  text: string;
  comment?: string;
  createdAt: number;
  /** 阅读主题的色（resolveTheme 给的），卡片跟着主题走 */
  fg: string;
  bg: string;
  dark: boolean;
}

const BRAND = '#e67341';

/** 换行拆分：连续 ASCII（词/数字/标点）整段算一个 token，中文逐字 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  const isAscii = (c: string): boolean => /[\x20-\x7e]/.test(c);
  for (const ch of text) {
    if (isAscii(ch) === (buf.length > 0 && isAscii(buf[0]))) buf += ch;
    else {
      if (buf) tokens.push(buf);
      buf = ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of tokenize(text)) {
    if (token === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (ctx.measureText(line + token).width <= maxWidth) {
      line += token;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(token).width <= maxWidth) {
      line = token;
      continue;
    }
    // 单个 token 超宽（超长 URL）：逐字符硬拆
    let part = '';
    for (const ch of token) {
      if (ctx.measureText(part + ch).width > maxWidth) {
        lines.push(part);
        part = ch;
      } else part += ch;
    }
    line = part;
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, lines: string[], max: number, maxWidth: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  kept[max - 1] = `${last}…`;
  return kept;
}

export function renderQuoteCard(input: QuoteCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(SCALE, SCALE);

  const contentW = W - PAD * 2;
  const softFg = input.dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const uiFont = (size: number): string => `${size}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const serifFont = (size: number): string => `${size}px "Songti SC", "Noto Serif CJK SC", "SimSun", Georgia, serif`;

  // 先量后排：原文行数 → 想法行数 → 总高
  const quoteLines = (() => {
    ctx.font = serifFont(22);
    const raw = input.text.trim().split('\n');
    const lines = raw.flatMap((seg) => wrap(ctx, seg, contentW - 18));
    return ellipsize(ctx, lines, 16, contentW - 18);
  })();
  const commentLines = (() => {
    if (!input.comment?.trim()) return [] as string[];
    ctx.font = uiFont(17);
    return ellipsize(ctx, wrap(ctx, input.comment.trim(), contentW - 26), 5, contentW - 26);
  })();

  const quoteLH = 22 * 1.9;
  const commentLH = 17 * 1.7;
  const headH = 46;
  const quoteH = quoteLines.length * quoteLH;
  const commentH = commentLines.length ? commentLines.length * commentLH + 22 : 0;
  const footH = 54;
  const h = Math.round(headH + quoteH + commentH + footH + PAD * 1.4);

  canvas.width = W * SCALE;
  canvas.height = h * SCALE;
  canvas.style.width = '360px';
  ctx.scale(SCALE, SCALE);

  // 底
  ctx.fillStyle = input.bg;
  ctx.fillRect(0, 0, W, h);
  // 左缘品牌色窄条：只这一处强调色
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, 5, h);

  let y = PAD + 8;
  // 头行：书名 · 作者
  ctx.fillStyle = softFg;
  ctx.font = uiFont(13);
  const head = [input.bookTitle, input.author?.trim()].filter(Boolean).join(' · ');
  ctx.fillText(head, PAD, y, contentW);
  if (input.chapter?.trim()) {
    ctx.textAlign = 'right';
    ctx.fillText(input.chapter.trim(), W - PAD, y, contentW / 2);
    ctx.textAlign = 'left';
  }
  y += headH - 20;

  // 原文：衬线
  ctx.font = serifFont(22);
  ctx.fillStyle = input.fg;
  for (const line of quoteLines) {
    ctx.fillText(line, PAD + 18, y + quoteLH - 8);
    y += quoteLH;
  }
  // 想法：左侧品牌线 + 无衬线
  if (commentLines.length) {
    y += 10;
    ctx.fillStyle = BRAND;
    ctx.fillRect(PAD, y - 14, 3, commentLines.length * commentLH + 8);
    ctx.font = uiFont(17);
    ctx.fillStyle = softFg;
    for (const line of commentLines) {
      ctx.fillText(line, PAD + 16, y + commentLH - 12);
      y += commentLH;
    }
  }

  // 脚行：日期 · 出处
  const d = new Date(input.createdAt);
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  ctx.font = uiFont(13);
  ctx.fillStyle = softFg;
  ctx.fillText(`${date} · bz 阅读`, PAD, h - PAD);
  return canvas;
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画不出图片'))), 'image/png');
  });
}

async function copyImage(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await toBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function safePngName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '书摘';
  return `${s}-摘录`;
}

/** 存进书摘目录（settings.exportDir），同名往后让 */
export async function saveQuoteCard(
  app: App,
  book: ReaderBook,
  settings: ReaderSettings,
  canvas: HTMLCanvasElement,
): Promise<string> {
  const dir = settings.exportDir.replace(/^\/+|\/+$/g, '') || '书摘';
  const parts = dir.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!(await app.vault.adapter.exists(acc))) {
      await app.vault.adapter.mkdir(acc).catch(() => undefined);
    }
  }
  const base = safePngName(book.meta.title);
  const blob = await toBlob(canvas);
  const buf = await blob.arrayBuffer();
  let path = '';
  for (let n = 1; n <= 50; n += 1) {
    const name = n === 1 ? base : `${base} (${n})`;
    path = `${dir}/${name}.png`;
    if (!(await app.vault.adapter.exists(path))) break;
  }
  await app.vault.adapter.writeBinary(path, buf);
  return path;
}

export interface QuoteCardDeps {
  app: App;
  book: ReaderBook;
  settings: ReaderSettings;
  input: QuoteCardInput;
  onSaved?: (path: string) => void;
  onError?: (message: string) => void;
}

/** 渲染 + 预览弹窗（保存到书摘 / 复制图片） */
export function openQuoteCard(deps: QuoteCardDeps): void {
  const canvas = renderQuoteCard(deps.input);
  const root = el('div', 'bzr-qcard');
  const holder = el('div', 'bzr-qcard-view');
  holder.appendChild(canvas);
  const foot = el('div', 'bzr-qcard-foot');
  const save = el('button', 'bzr-btn is-primary', '保存到书摘');
  save.type = 'button';
  const copy = el('button', 'bzr-btn', '复制图片');
  copy.type = 'button';
  foot.append(save, copy);
  root.append(holder, foot);
  uiModal({
    content: root,
    className: 'bzr-qcard-popup',
    title: '书摘卡片',
    head: true,
    maxWidth: 420,
    autofocus: false,
  });
  save.addEventListener('click', () => {
    void saveQuoteCard(deps.app, deps.book, deps.settings, canvas)
      .then((path) => deps.onSaved?.(path))
      .catch((e: unknown) => deps.onError?.((e as Error)?.message || '保存失败'));
  });
  copy.addEventListener('click', () => {
    void copyImage(canvas)
      .then(() => deps.onSaved?.(''))
      .catch((e: unknown) => deps.onError?.((e as Error)?.message || '复制失败，可能是浏览器不给剪贴板权限'));
  });
}
