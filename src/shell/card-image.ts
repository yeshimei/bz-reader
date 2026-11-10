/* ============================================================
 * bz-reader · 书摘卡转图片（shell/card-image.ts）
 *
 * 这个仓库没有任何 DOM → 图片的依赖（html2canvas 之类），
 * 年报海报到今天也只有「复制文字版」。所以这里用 canvas 2D 手绘：
 * 字体、行距、留白全部自己算，好处是无依赖、字体可控，
 * 代价是断行要自己写（中文没有空格，不能按 word 切）。
 *
 * 断行与配色都是纯函数，画布只负责量宽度——这样排版规则能在 node 里测。
 * ============================================================ */

import { normalizeCardTemplate, type CardTemplate } from './card-template';

export interface QuoteCardImageInput {
  /** 引文正文 */
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
  /** 展示窗里选中的版式；不传/认不出都按经典出图 */
  template?: string;
}

/** 卡片尺寸（2× 出图，粘进笔记里也清楚） */
export const CARD_W = 720;
const PAD = 56;

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

/* ─────────── 四套配色 ───────────
 * 展示窗里能选四种版式，图片必须跟着变：2026-11-10 晚的真机反馈是
 * 「四个模板预览各不相同，复制出来永远是第一张」。所以配色不再是写死的
 * 米纸，而是跟模板一一对应的数据表，画布只按表取值。
 */
export interface CardPalette {
  /** 纸底 */
  paper: string;
  /** 引文 */
  ink: string;
  /** 出处那一行 */
  meta: string;
  /** 左侧竖条 / 细线 */
  accent: string;
  /** 信笺横线（只有 letter 用） */
  rule?: string;
  badgeBg: string;
  badgeBorder: string;
  badgeInk: string;
  /** 深底：文字描边、徽章配色都要跟着翻 */
  dark: boolean;
}

export const CARD_PALETTES: Record<CardTemplate, CardPalette> = {
  /** 经典：墨与铜，像从书里撕下来的一页 */
  classic: {
    paper: '#fbf9f4',
    ink: '#2b2620',
    meta: '#8a7f6d',
    accent: '#9a7434',
    badgeBg: '#f1e8d6',
    badgeBorder: '#cbb489',
    badgeInk: '#6f5a34',
    dark: false,
  },
  /** 信笺：白一点的横线纸，横线跟着正文行距走 */
  letter: {
    paper: '#fffdf7',
    ink: '#2b2620',
    meta: '#8a7f6d',
    accent: '#c0a97d',
    rule: '#e6decc',
    badgeBg: '#f6efdf',
    badgeBorder: '#d6c8ab',
    badgeInk: '#6f5a34',
    dark: false,
  },
  /** 夜读：深色底，夜里发出去不刺眼 */
  night: {
    paper: '#171513',
    ink: '#ece7dd',
    meta: '#a49b8b',
    accent: '#c39a4e',
    badgeBg: '#26242a',
    badgeBorder: '#4c4540',
    badgeInk: '#e4d9c2',
    dark: true,
  },
  /** 胶片：大留白 + 右侧竖排片名，像一张票根 */
  film: {
    paper: '#f5f2ea',
    ink: '#1f1c18',
    meta: '#7d7466',
    accent: '#9a7434',
    badgeBg: '#e8e0cf',
    badgeBorder: '#c9b189',
    badgeInk: '#5f4d2c',
    dark: false,
  },
};

/** 任意输入 → 配色；认不出的模板退回经典（和展示窗同一个判定） */
export function cardPaletteOf(template?: string): CardPalette {
  return CARD_PALETTES[normalizeCardTemplate(template)];
}

/* ─────────── 徽章 ─────────── */

/**
 * 插件名徽章。2026-11-10 起书摘图片下放基础版，两版出的是同一张图：
 * 这枚小标是署名，不是付费水印，所以不查授权、不做翻译（专名八语言同形）。
 */
export const CARD_BADGE_TEXT = 'bz reader';
export const CARD_BADGE_H = 30;
/** 徽章字号：14px 是「缩到手机相册缩略图还能认出字」的下限，
    再小就退化成一块看不出内容的色块。 */
const BADGE_FONT = 14;
/** 左侧铜条的宽度：它才是这枚徽章的识别点，比底色更早被眼睛抓到 */
const BADGE_BAR = 4;

/** 徽章固定在底部留白里，永远在引文与出处之后（纯函数，位置可断言） */
export function cardBadgeY(cardHeight: number): number {
  return cardHeight - PAD - CARD_BADGE_H;
}

/**
 * 一枚铜色描边胶囊：亮一档的纸底 + 左侧粗铜条 + 深棕字。
 *
 * 原来底色 #efe9dc 与纸底 #fbf9f4 只差一档、字色又偏浅，正文是纯黑，
 * 眼睛扫过整张图时这枚小标等于隐形——真机上被当成「没画徽章」。
 * 现在描一圈 1px 边、字色压深，缩图也认得出，高度仍只有正文的四分之一。
 * 配色跟着模板走：夜读深底上是浅字浅边，不会出现一块白补丁。
 */
export function drawCardBadge(
  ctx: CanvasRenderingContext2D,
  y: number,
  palette: CardPalette = CARD_PALETTES.classic,
): void {
  ctx.font = `600 ${BADGE_FONT}px ${SANS}`;
  const w = ctx.measureText(CARD_BADGE_TEXT).width + 30;
  ctx.fillStyle = palette.badgeBg;
  ctx.fillRect(PAD, y, w, CARD_BADGE_H);
  ctx.strokeStyle = palette.badgeBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD + 0.5, y + 0.5, w - 1, CARD_BADGE_H - 1);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(PAD, y, BADGE_BAR, CARD_BADGE_H);
  ctx.fillStyle = palette.badgeInk;
  ctx.textBaseline = 'middle';
  ctx.fillText(CARD_BADGE_TEXT, PAD + BADGE_BAR + 12, y + CARD_BADGE_H / 2);
}

function pick2x(): number {
  /* 至少 2×：1× 出图在手机上一放大就糊。3× 以上没有意义，
     720 宽的卡乘 3 已经是 2160。 */
  return Math.min(3, Math.max(2, window.devicePixelRatio || 2));
}

/**
 * 把一张书摘卡画成 PNG。
 *
 * 版式随展示窗里选的模板走：
 *   classic 纸色底 + 左侧铜线，衬线大字；
 *   letter  更白的横线纸，横线跟着行距；
 *   night   深底浅字，左线换成亮铜；
 *   film    去掉框，上下两道铜线，像一张票根。
 * 四版底部都有一枚 bz reader 徽章（署名，不是水印），位置一致。
 */
export async function renderQuoteCard(input: QuoteCardImageInput): Promise<Blob> {
  const tpl = normalizeCardTemplate(input.template);
  const p = CARD_PALETTES[tpl];
  const pad = tpl === 'film' ? 64 : PAD;
  const textW = CARD_W - pad * 2;

  const scale = pick2x();
  const canvas = createEl('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这个环境不支持 canvas，导不出图片');

  const quote = 30;
  const lineH = Math.round(quote * 1.95);
  const titleSize = 21;
  const metaSize = 15;

  const setFont = (size: number, family: string, weight = '400'): void => {
    ctx.font = `${weight} ${size}px ${family}`;
  };

  /* 先量一遍再定画布高度：canvas 尺寸定了就改不了，只能重画 */
  setFont(quote, SERIF);
  const lines = wrapText(input.text.trim(), textW, (s) => ctx.measureText(s).width);
  const lineCount = lines.length;

  const headH = input.title ? titleSize + 34 : 0;
  const bodyH = Math.max(lineH, lineCount * lineH);
  /* 底部多留一枚徽章的高度：它贴底，不随引文长短上下跳 */
  const H = Math.max(420, pad + headH + bodyH + 26 + metaSize + 16 + CARD_BADGE_H + PAD);

  canvas.width = CARD_W * scale;
  canvas.height = H * scale;
  ctx.scale(scale, scale);

  /* 底色随模板：深色底在深色主题的笔记里比米纸更稳 */
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, CARD_W, H);

  /* 信笺：展示窗是虚线框，图片上也拉一圈，缩图时版式认得出来 */
  if (tpl === 'letter') {
    ctx.strokeStyle = p.badgeBorder;
    ctx.lineWidth = 1;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([5, 5]);
    ctx.strokeRect(pad - 24 + 0.5, 24.5, CARD_W - (pad - 24) * 2 - 1, H - 32);
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  }

  /* 左侧铜色竖线：信笺用横线立版式、胶片用上下两道铜线，这两版不画 */
  if (tpl !== 'letter' && tpl !== 'film') {
    ctx.fillStyle = p.accent;
    ctx.fillRect(pad - 24, pad, 2, H - pad * 2);
  }

  let y = pad;

  if (input.title && tpl !== 'film') {
    setFont(titleSize, SERIF, '600');
    ctx.fillStyle = p.ink;
    ctx.textBaseline = 'top';
    ctx.fillText(input.title, pad, y);
    y += titleSize + 34;
  }

  /* 胶片：票根的两道铜线（上 2px 重、下 1px 轻），位置与展示窗一致 */
  if (tpl === 'film') {
    ctx.fillStyle = p.accent;
    ctx.fillRect(pad - 12, 38, CARD_W - (pad - 12) * 2, 2);
  }

  setFont(quote, SERIF);
  ctx.fillStyle = p.ink;
  ctx.textBaseline = 'top';
  for (const line of lines) {
    if (line) ctx.fillText(line, pad, y);
    /* 信笺：每行落款下方一条横线，宽度跨到右边界，像真的信纸 */
    if (tpl === 'letter') {
      ctx.fillStyle = p.rule ?? p.accent;
      ctx.fillRect(pad - 12, y + lineH - 7, CARD_W - pad - 4, 1);
      ctx.fillStyle = p.ink;
    }
    y += lineH;
  }

  y += 26;

  const from = [input.chapter, input.author].filter((s) => !!s && s.trim()).join(' · ');
  if (from) {
    setFont(metaSize, SANS);
    ctx.fillStyle = p.meta;
    ctx.textBaseline = 'top';
    ctx.fillText(`— ${from}`, pad, y);
  }

  /* 胶片的下线：徽章贴底，线在徽章下面 16px，不压署名 */
  if (tpl === 'film') {
    ctx.fillStyle = p.badgeBorder;
    ctx.fillRect(pad - 12, H - 30, CARD_W - (pad - 12) * 2, 1);
  }

  /* 徽章落在底部留白，跟出处不抢行；不查授权，两版出的是同一张图。 */
  drawCardBadge(ctx, cardBadgeY(H), p);

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
