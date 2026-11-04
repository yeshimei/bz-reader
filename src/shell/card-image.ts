/* ============================================================
 * bz-reader · 书摘卡转图片（shell/card-image.ts）
 *
 * 这个仓库没有任何 DOM → 图片的依赖（html2canvas 之类），
 * 年报海报到今天也只有「复制文字版」。所以这里用 canvas 2D 手绘：
 * 字体、行距、留白全部自己算，好处是无依赖、字体可控，
 * 代价是断行要自己写（中文没有空格，不能按 word 切）。
 *
 * 断行是纯函数，画布只负责量宽度——这样排版规则能在 node 里测。
 * ============================================================ */

export interface QuoteCardImageInput {
  /** 引文正文 */
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
}

/** 卡片尺寸（2× 出图，粘进笔记里也清楚） */
export const CARD_W = 720;
const PAD = 56;
const TEXT_W = CARD_W - PAD * 2;

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

function pick2x(): number {
  /* 至少 2×：1× 出图在手机上一放大就糊。3× 以上没有意义，
     720 宽的卡乘 3 已经是 2160。 */
  return Math.min(3, Math.max(2, window.devicePixelRatio || 2));
}

/**
 * 把一张书摘卡画成 PNG。
 *
 * 版式：纸色底 + 左侧一条铜色竖线，引文衬线大字，落款是
 * 「章节 · 书名」和右下角一行小字。不做封面、不做统计数字——
 * 这些东西在手机上会挤掉引文本来的呼吸感。
 */
export async function renderQuoteCard(input: QuoteCardImageInput): Promise<Blob> {
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
  const lines = wrapText(input.text.trim(), TEXT_W, (s) => ctx.measureText(s).width);
  const lineCount = lines.length;

  const headH = input.title ? titleSize + 34 : 0;
  const bodyH = Math.max(lineH, lineCount * lineH);
  const footH = 52;
  const H = Math.max(420, PAD + headH + bodyH + 26 + footH + PAD);

  canvas.width = CARD_W * scale;
  canvas.height = H * scale;
  ctx.scale(scale, scale);

  /* 纸色底：纯白在深色主题的笔记里会亮得刺眼，米色更接近书页 */
  ctx.fillStyle = '#fbf9f4';
  ctx.fillRect(0, 0, CARD_W, H);

  /* 左侧铜色竖线：这是整张卡唯一的重色，位置和内边距对齐 */
  ctx.fillStyle = '#9a7434';
  ctx.fillRect(PAD - 24, PAD, 2, H - PAD * 2);

  let y = PAD;

  if (input.title) {
    setFont(titleSize, SERIF, '600');
    ctx.fillStyle = '#2b2620';
    ctx.textBaseline = 'top';
    ctx.fillText(input.title, PAD, y);
    y += titleSize + 34;
  }

  setFont(quote, SERIF);
  ctx.fillStyle = '#2b2620';
  ctx.textBaseline = 'top';
  for (const line of lines) {
    if (line) ctx.fillText(line, PAD, y);
    y += lineH;
  }

  y += 26;

  const from = [input.chapter, input.author].filter((s) => !!s && s.trim()).join(' · ');
  if (from) {
    setFont(metaSize, SANS);
    ctx.fillStyle = '#8a7f6d';
    ctx.fillText(`— ${from}`, PAD, y);
  }

  /* 右下角签名：和卡片一起被转发时，它是唯一能说明出处的标记 */
  setFont(12, SANS);
  ctx.fillStyle = '#a99d88';
  ctx.textAlign = 'right';
  ctx.fillText('bz 阅读', CARD_W - PAD, H - PAD - 14);
  ctx.textAlign = 'left';

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
