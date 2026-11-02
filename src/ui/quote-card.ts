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
const PAD = 58;

/* 原型卡 340 逻辑宽的字号等比放大（×2.1）：
 * 题 20→42 · 作者 11→23 · 正文 15.5→32 · 想法 12.5→26 · 脚 10→21 */
const F_TITLE = 42;
const F_META = 23;
const F_QUOTE = 32;
const F_COMMENT = 26;
const F_FOOT = 21;
const QUOTE_LH = Math.round(F_QUOTE * 2.0);
const COMMENT_LH = Math.round(F_COMMENT * 1.8);

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

/** 铜金：卡面上唯一的强调色（左缘条、引号、想法区、印）。按明暗给两档 */
const BRAND_DARK = '#c8a464';
const BRAND_LIGHT = '#9a7434';

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

  const contentW = W - PAD * 2;
  const copper = input.dark ? BRAND_DARK : BRAND_LIGHT;
  const softFg = input.dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const uiFont = (size: number): string => `${size}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const serifFont = (size: number): string => `${size}px "Songti SC", "Noto Serif CJK SC", "SimSun", Georgia, serif`;

  // 先量后排：原文行数 → 想法行数 → 总高。原文收窄 72 是给「」留位
  const quoteLines = (() => {
    ctx.font = serifFont(F_QUOTE);
    const raw = input.text.trim().split('\n');
    const lines = raw.flatMap((seg) => wrap(ctx, seg, contentW - 72));
    return ellipsize(ctx, lines, 16, contentW - 72);
  })();
  const commentLines = (() => {
    if (!input.comment?.trim()) return [] as string[];
    ctx.font = uiFont(F_COMMENT);
    return ellipsize(ctx, wrap(ctx, input.comment.trim(), contentW - 10), 5, contentW - 10);
  })();

  const headH = 118;
  const quoteH = quoteLines.length * QUOTE_LH;
  // 想法块：24 压距 + 40 虚线后 + 40 标签行 + 正文
  const commentH = commentLines.length ? commentLines.length * COMMENT_LH + 104 : 0;
  // 脚块：56 压距 + 发丝线 + 34 + 基线区
  const footH = 156;
  const h = Math.round(headH + quoteH + commentH + footH);

  canvas.width = W * SCALE;
  canvas.height = h * SCALE;
  canvas.style.width = '360px';
  ctx.scale(SCALE, SCALE);

  // 底
  ctx.fillStyle = input.bg;
  ctx.fillRect(0, 0, W, h);
  // 左缘铜金窄条：卡面上唯一的装饰
  ctx.fillStyle = copper;
  ctx.fillRect(0, 0, 6, h);

  let y = PAD + 4;
  // 头部：书名衬线独占一行，作者小字距一行（原型 .qt / .qa），章节挂右侧
  ctx.font = serifFont(F_TITLE);
  ctx.fillStyle = input.fg;
  ctx.fillText(input.bookTitle, PAD, y + 40, contentW * 0.62);
  if (input.chapter?.trim()) {
    ctx.font = uiFont(F_META - 2);
    ctx.fillStyle = softFg;
    ctx.textAlign = 'right';
    ctx.fillText(input.chapter.trim().slice(0, 24), W - PAD, y + 37, contentW * 0.3);
    ctx.textAlign = 'left';
  }
  if (input.author?.trim()) {
    ctx.font = uiFont(F_META - 2);
    ctx.fillStyle = softFg;
    ctx.fillText(input.author.trim().split('').join(' '), PAD, y + 76, contentW * 0.72);
  }
  y += headH;

  // 原文：衬线 + 「」引号（铜金）——原型书摘卡的签名件
  ctx.font = serifFont(F_QUOTE);
  const qIndent = 44;
  ctx.fillStyle = copper;
  ctx.fillText('「', PAD, y + QUOTE_LH - 18);
  ctx.fillStyle = input.fg;
  for (const line of quoteLines) {
    ctx.fillText(line, PAD + qIndent, y + QUOTE_LH - 18);
    y += QUOTE_LH;
  }
  // 」贴在末行末尾，铜金
  const lastW = ctx.measureText(quoteLines[quoteLines.length - 1] || '').width;
  ctx.fillStyle = copper;
  ctx.fillText('」', PAD + qIndent + lastW + 6, y - 18);

  // 想法区：一条虚线与正文分开，「想 法」小字距标签起头
  if (commentLines.length) {
    y += 24;
    ctx.strokeStyle = copper;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    y += 40;
    ctx.font = uiFont(20);
    ctx.fillStyle = copper;
    ctx.fillText('想  法', PAD, y);
    y += 40;
    ctx.font = uiFont(F_COMMENT);
    ctx.fillStyle = softFg;
    for (const line of commentLines) {
      ctx.fillText(line, PAD, y + COMMENT_LH - 14);
      y += COMMENT_LH;
    }
  }

  // 脚行：一条铜金发丝线压顶，日期左 · 出处右邻印章 · 「印」字方框收尾
  y += 56;
  ctx.strokeStyle = copper;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const baseY = y + 36;
  const d = new Date(input.createdAt);
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
  ctx.font = uiFont(F_FOOT);
  ctx.fillStyle = softFg;
  ctx.fillText(`${d.getFullYear()} · ${pad2(d.getMonth() + 1)} · ${pad2(d.getDate())}`, PAD, baseY);
  if (input.chapter?.trim()) {
    ctx.textAlign = 'right';
    ctx.fillText(input.chapter.trim().slice(0, 18), W - PAD - 72, baseY, contentW / 3);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = copper;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.strokeRect(W - PAD - 56, baseY - 30, 46, 40);
  ctx.globalAlpha = 1;
  ctx.font = serifFont(26);
  ctx.fillStyle = copper;
  ctx.fillText('印', W - PAD - 46, baseY);
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
  const { popup } = uiModal({
    content: root,
    className: 'bzr-qcard-popup',
    title: '书摘卡片',
    head: true,
    maxWidth: 420,
    autofocus: false,
  });
  /* 弹窗外壳跟卡面同一个主题：弹窗挂在 body 下，不在 .bzr-reader 里，
   * 拿到的是 Obsidian 明暗的令牌——墨主题下会白一块，和卡面两个世界。
   * 直接把卡面同款色写到弹窗的令牌上，风格才算闭合（2026-11-03 用户反馈）。 */
  const input = deps.input;
  const dim = input.dark ? '237,228,212' : '44,37,25';
  const copper = input.dark ? BRAND_DARK : BRAND_LIGHT;
  const set = (name: string, value: string): void => popup.style.setProperty(name, value);
  set('--bzr-surface-2', input.bg);
  set('--bzr-surface-3', `rgba(${dim},0.08)`);
  set('--bzr-surface-sunken', `rgba(${dim},0.05)`);
  set('--bzr-border', `rgba(${dim},0.16)`);
  set('--bzr-border-strong', `rgba(${dim},0.3)`);
  set('--bzr-text-1', input.fg);
  set('--bzr-text-2', `rgba(${dim},0.75)`);
  set('--bzr-text-3', `rgba(${dim},0.5)`);
  set('--bzr-brand', copper);
  set('--bzr-brand-hover', input.dark ? '#d8b576' : '#8a6630');
  set('--bzr-on-brand', '#211c15');
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
