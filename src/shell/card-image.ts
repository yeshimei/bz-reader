/* ============================================================
 * bz-reader · 书摘卡转图片（shell/card-image.ts）
 *
 * 这个仓库没有任何 DOM → 图片的依赖（html2canvas 之类），
 * 年报海报到今天也只有「复制文字版」。所以这里用 canvas 2D 手绘：
 * 字体、行距、留白全部自己算，好处是无依赖、字体可控，
 * 代价是断行要自己写（中文没有空格，不能按 word 切）。
 *
 * 硬要求（1.0.0 真机反馈）：**图片必须和书摘卡预览长得一样**。
 * 所以这里不自己发明版式，而是照着 `styles/overlay.css` 的 `.bzs-qcard`
 * 规格画：颜色全部读宿主主题变量（--background-primary / --text-normal /
 * --text-faint / --background-modifier-border-hover / --interactive-accent），
 * 内边距、圆角、字号、行高按卡片宽度等比换算。换主题、换强调色，图与预览一起变。
 *
 * 断行与换算都是纯函数，画布只负责量宽度——这样排版规则能在 node 里测。
 * ============================================================ */

import { normalizeCardTemplate, type CardTemplate } from './card-template';

export interface QuoteCardImageInput {
  /** 引文正文 */
  text: string;
  /** 书名 / 作者 / 章节：预览里合成一行 `<书名> · <作者> · <章节>` */
  title?: string;
  author?: string;
  chapter?: string;
  /** 展示窗里选中的版式；不传/认不出都按经典出图 */
  template?: string;
}

/** 输出宽度（2× 出图，粘进笔记里也清楚） */
export const CARD_W = 720;
/** 预览卡片的参考宽度：`.bzs-quote-panel-body` 宽 max-content、上限
    min(480, 100vw-24)，减掉 10px 内边距＝卡片最多 460。图里所有尺寸都是
    「CSS 值 × CARD_W / BASE_W」，比例与长引文时预览的样子一致。 */
export const BASE_W = 460;
const F = CARD_W / BASE_W;

/**
 * 按可用宽度把文字切成行。
 *
 * 逐字累加而不是按空格切：中文正文里没有空格，按 word 切的结果是
 * 一整段挤成一行，或者被浏览器在标点处随机断开。
 *
 * @param maxWidth 行宽（px）
 * @param measure  量一段文字的宽度（画布：`ctx.measureText(s).width`）
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  const paras = text.replace(/\r\n/g, '\n').split('\n');
  for (const para of paras) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      const next = line + ch;
      /* line 为空时不换行：一个字符就比整行宽的情况（超窄卡）也得把它放出去，
         否则会死循环或丢字 */
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

const SERIF = '"Songti SC", "Noto Serif CJK SC", "SimSun", serif';
const SANS = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/* ─────────── 版式规格：照抄 overlay.css 的 .bzs-qcard 一族 ─────────── */

export interface CardTheme {
  /** 卡片底：预览是 --surface，这里取 --background-primary（两者只差 2%） */
  bg: string;
  /** 引文：--ink → --text-normal */
  ink: string;
  /** 出处：--t3 → --text-faint */
  meta: string;
  /** 描边：--line-2 → --background-modifier-border-hover */
  line: string;
  /** 强调色：--copper → --interactive-accent（用户自选色也走这一支） */
  copper: string;
}

/** 读不到主题时的兜底：浅色默认值，保证离开 Obsidian 也能出图 */
export const FALLBACK_THEME: CardTheme = {
  bg: '#ffffff',
  ink: '#1f1f23',
  meta: '#93939c',
  line: 'rgba(0, 0, 0, .18)',
  copper: '#9a7434',
};

/**
 * 宿主主题色。自定义属性可能是 `color-mix(...)`（--surface 就是），
 * canvas 不认，所以只取宿主那几支纯色变量——视觉差在 2% 以内。
 */
export function hostTheme(): CardTheme {
  try {
    if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return FALLBACK_THEME;
    const cs = getComputedStyle(document.body);
    const pick = (name: string, fallback: string): string =>
      (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
      bg: pick('--background-primary', FALLBACK_THEME.bg),
      ink: pick('--text-normal', FALLBACK_THEME.ink),
      meta: pick('--text-faint', FALLBACK_THEME.meta),
      line: pick('--background-modifier-border-hover', FALLBACK_THEME.line),
      copper: pick('--interactive-accent', FALLBACK_THEME.copper),
    };
  } catch {
    return FALLBACK_THEME;
  }
}

/** 每种模板的尺寸与配色差异（数值与 overlay.css 一一对应，已乘缩放系数） */
export interface CardSpec {
  bg: string;
  ink: string;
  meta: string;
  /** 边框色，空串 = 不描边 */
  border: string;
  /** 上边线与下边线单独覆盖（胶片：上 2px 铜、下 1px 细线） */
  topBar?: string;
  bottomBar?: string;
  /** 卡片圆角（CSS 的 --r-card = 10px） */
  radius: number;
  padX: number;
  padY: number;
  font: number;
  lineH: number;
  /** 出处字距（CSS 的 letter-spacing .08em，胶片 .25em） */
  metaTrack: number;
  /** 信笺的横向纸线颜色 */
  rule?: string;
}

/** 卡片规格：四版共用一套换算，只覆盖差异项 */
export function cardSpec(template?: string, host: CardTheme = hostTheme()): CardSpec {
  const tpl: CardTemplate = normalizeCardTemplate(template);
  const base: CardSpec = {
    bg: host.bg,
    ink: host.ink,
    meta: host.meta,
    /* 经典卡在书摘面板里被压成 transparent（`.bzs-qcard:not([class*="tpl-"])`），
       不然会变成「卡中卡」；图片照办，只靠底色与圆角立住。 */
    border: '',
    radius: 10 * F,
    padX: 22 * F,
    padY: 20 * F,
    font: 16 * F,
    /* CSS 的 line-height: 2 → 32px */
    lineH: 32 * F,
    metaTrack: 0.08 * 11 * F,
  };
  if (tpl === 'letter') {
    /* 信笺：虚线框 + 27/28px 横线纸，正文 15px/28px */
    return { ...base, border: host.line, font: 15 * F, lineH: 28 * F, rule: host.line };
  }
  if (tpl === 'night') {
    /* 夜读：CSS 里是写死的深底浅字，不跟主题 */
    return { ...base, bg: '#171513', ink: '#efe6d6', meta: '#9c9384', border: '#3a342c' };
  }
  if (tpl === 'film') {
    /* 胶片：去框去圆角，上下两道线，正文 20px/1.9，大留白 */
    return {
      ...base,
      border: '',
      topBar: host.copper,
      bottomBar: host.line,
      radius: 0,
      padX: 8 * F,
      padY: 24 * F,
      font: 20 * F,
      lineH: 38 * F,
      metaTrack: 0.25 * 11 * F,
    };
  }
  return base;
}

/* ─────────── 底部署名（bz reader） ─────────── */

/**
 * 插件名。2026-11-10 起书摘图片下放基础版，两版出的是同一张图：
 * 这枚小标是署名，不是付费水印，所以不查授权、不做翻译（专名八语言同形）。
 */
export const CARD_BADGE_TEXT = 'bz reader';

/**
 * 署名不再是胶囊。
 *
 * 第一版做成「浅米底 + 铜边 + 粗体字」的胶囊，真机反馈两个字：难看
 * ——像贴在书页上的一张标签。改成页脚：一条铜色短横 + 一行浅色小字
 * （字距略宽），缩图里认得出，放大也不抢引文，和卡片其余部分一个语气。
 */
export const SIG_LINE_W = 18;
export const SIG_H = 22;
const SIG_FONT = 12 * F;
const SIG_TRACK = 1.4;

/** 署名贴着卡片底部内边距上沿（纯函数，位置可断言） */
export function cardBadgeY(cardHeight: number, padY: number): number {
  return cardHeight - padY - SIG_H;
}

/** 带字距的绘制：字符逐个放（canvas 没有 letter-spacing），返回总宽 */
export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  track: number,
): number {
  let cx = x;
  const chars = Array.from(text);
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  return chars.length ? cx - track - x : 0;
}

/**
 * 画一行引文：`「` `」` 用铜色、其余用正文色。
 *
 * 按「段」而不是按字绘制——中文没有连字，英文单词也不该被拆散。
 * 预览用 `.q::before/::after` 把引号染成铜色，这里做同一件事。
 */
export function drawQuoteLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  ink: string,
  copper: string,
): void {
  let cx = x;
  let buf = '';
  let bufInk = '';
  const flush = (): void => {
    if (!buf) return;
    ctx.fillStyle = bufInk;
    ctx.fillText(buf, cx, y);
    cx += ctx.measureText(buf).width;
    buf = '';
  };
  for (const ch of Array.from(line)) {
    const isMark = ch === '「' || ch === '」';
    const want = isMark ? copper : ink;
    if (bufInk && want !== bufInk) flush();
    bufInk = want;
    buf += ch;
  }
  flush();
}

/**
 * 页脚署名：铜色短横 + bz reader。
 *
 * 颜色全取自主题（铜 = 强调色、字 = 出处色），深色主题与任何强调色下
 * 都不会突兀；不描边、不加底色。
 */
export function drawCardBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  host: CardTheme = FALLBACK_THEME,
): void {
  /* 短横压在文字中线偏下的位置，像印刷品的页码饰线 */
  ctx.fillStyle = host.copper;
  ctx.fillRect(x, Math.round(y + SIG_H / 2), SIG_LINE_W, 2);
  ctx.font = `500 ${SIG_FONT}px ${SANS}`;
  ctx.fillStyle = host.meta;
  ctx.textBaseline = 'middle';
  drawTracked(ctx, CARD_BADGE_TEXT, x + SIG_LINE_W + 8, y + SIG_H / 2, SIG_TRACK);
}

function pick2x(): number {
  /* 至少 2×：1× 出图在手机上一放大就糊。3× 以上没有意义，
     720 宽的卡乘 3 已经是 2160。 */
  return Math.min(3, Math.max(2, window.devicePixelRatio || 2));
}

/** 圆角矩形路径：手写，避免依赖各内核的 roundRect 差异 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!rr) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * 把一张书摘卡画成 PNG。
 *
 * 版式与 `overlay.css` 的 `.bzs-qcard` 一一对应：
 *   经典  主题底 + 1px 描边 + 圆角，衬线 16px/2，引号铜色；
 *   信笺  虚线框 + 每行一条纸纹线（27/28px）；
 *   夜读  深底浅字（CSS 里写死 #171513）；
 *   胶片  无框无圆角，上 2px 铜线、下 1px 细线，衬线 20px/1.9，大留白。
 * 出处一行是「书名 · 作者 · 章节」，与预览同一句；底部一行页脚署名。
 */
export async function renderQuoteCard(input: QuoteCardImageInput): Promise<Blob> {
  const tpl = normalizeCardTemplate(input.template);
  const host = hostTheme();
  const spec = cardSpec(tpl, host);

  const scale = pick2x();
  const canvas = createEl('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这个环境不支持 canvas，导不出图片');

  const setFont = (size: number, family: string, weight = '400'): void => {
    ctx.font = `${weight} ${size}px ${family}`;
  };

  /* 引号跟着文字一起排：预览里 `「` `」` 是铜色的行内引号，不是缩进。
     所以把两枚引号并进正文再断行，绘制时按段换色——断行结果与浏览器一致。 */
  setFont(spec.font, SERIF);
  const innerW = CARD_W - spec.padX * 2;
  const quoted = `「${input.text.trim()}」`;
  const lines = wrapText(quoted, innerW, (s) => ctx.measureText(s).width);

  const bodyH = lines.length * spec.lineH;
  const from = [input.title, input.author, input.chapter]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const metaGap = from ? 14 * F : 0;
  /* 出处也可能很长（书名 + 作者 + 章节），跟预览一样折行，不硬挤成一行 */
  setFont(11 * F, SANS);
  const measureMeta = (s: string): number =>
    Array.from(s).reduce((w, ch) => w + ctx.measureText(ch).width + spec.metaTrack, 0);
  const metaLines = from ? wrapText(from, innerW, measureMeta) : [];
  const metaLineH = 11 * F * 1.5;
  const metaH = metaLines.length * metaLineH;
  /* 署名上方留一段空气：它属于页脚，不跟出处挤在一起 */
  const sigGap = 22;
  /* 高度跟着内容走（预览卡片也是内容撑开的），只兜一个下限，
     免得一行短句被压成一条横幅 */
  const H = Math.max(220, spec.padY + bodyH + metaGap + metaH + sigGap + SIG_H + spec.padY);

  canvas.width = CARD_W * scale;
  canvas.height = H * scale;
  ctx.scale(scale, scale);

  /* 卡片本体：底 + 描边 + 圆角，与预览的 .bzs-qcard 一致 */
  roundRectPath(ctx, 0.5, 0.5, CARD_W - 1, H - 1, spec.radius);
  ctx.fillStyle = spec.bg;
  ctx.fill();
  if (spec.border) {
    ctx.strokeStyle = spec.border;
    ctx.lineWidth = 1;
    /* 信笺：CSS 用 border-style: dashed */
    if (tpl === 'letter' && typeof ctx.setLineDash === 'function') ctx.setLineDash([5, 5]);
    ctx.stroke();
    if (tpl === 'letter' && typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  }
  /* 胶片：上 2px 铜线、下 1px 细线（CSS 的 border-top / border-bottom） */
  if (spec.topBar) {
    ctx.fillStyle = spec.topBar;
    ctx.fillRect(0, 0, CARD_W, 2);
  }
  if (spec.bottomBar) {
    ctx.fillStyle = spec.bottomBar;
    ctx.fillRect(0, H - 1, CARD_W, 1);
  }

  /* 正文：引号用铜色，其余用正文色，逐段绘制（不额外缩进） */
  setFont(spec.font, SERIF);
  ctx.textBaseline = 'top';
  let y = spec.padY;
  for (const line of lines) {
    if (line) drawQuoteLine(ctx, line, spec.padX, y, spec.ink, host.copper);
    /* 信笺：每条正文线下面压一条纸纹线，与 CSS 的 27/28px 重复渐变对齐 */
    if (tpl === 'letter') {
      ctx.fillStyle = spec.rule ?? spec.border;
      ctx.fillRect(spec.padX, y + spec.lineH - 7, CARD_W - spec.padX * 2, 1);
    }
    y += spec.lineH;
  }

  /* 出处：预览是「书名 · 作者 · 章节」，字距略宽 */
  if (metaLines.length) {
    setFont(11 * F, SANS);
    ctx.textBaseline = 'top';
    let my = y + metaGap;
    for (const ml of metaLines) {
      if (ml) {
        ctx.fillStyle = spec.meta;
        drawTracked(ctx, ml, spec.padX, my, spec.metaTrack);
      }
      my += metaLineH;
    }
  }

  /* 页脚署名：贴底部内边距，与卡片其余部分同一个语气 */
  drawCardBadge(ctx, spec.padX, cardBadgeY(H, spec.padY), host);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('导出图片失败'));
    }, 'image/png');
  });
}

/**
 * 把书摘卡复制到剪贴板。
 *
 * Electron 支持 ClipboardItem；不支持时抛错，由调用方提示
 * ——静默失败最糟，用户会以为复制成功了。
 */
export async function copyQuoteCardImage(input: QuoteCardImageInput): Promise<void> {
  const blob = await renderQuoteCard(input);
  const nav = navigator as Navigator & { clipboard?: Clipboard };
  if (!nav.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('这个环境不支持复制图片');
  }
  await nav.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
