import { afterEach, describe, expect, it } from 'vitest';
import {
  BASE_W,
  CARD_BADGE_TEXT,
  CARD_W,
  FALLBACK_THEME,
  SIG_H,
  SIG_LINE_W,
  cardBadgeY,
  cardSpec,
  drawCardBadge,
  drawTracked,
  hostTheme,
  renderQuoteCard,
  wrapText,
} from '../src/shell/card-image';

/**
 * 书摘卡转图片是 canvas 手绘的（项目里没有 DOM 截图库）。
 *
 * 两条硬要求用测试钉住：
 *   1. 图片必须和书摘卡预览长得一样——尺寸按 CARD_W / BASE_W 等比换算，
 *      颜色读宿主主题变量；
 *   2. 底部要有署名，但它是一行页脚，不是贴上去的胶囊标签。
 */
describe('wrapText', () => {
  /** 每个字符固定 10px，方便算出「一行几个字」 */
  const measure = (s: string): number => s.length * 10;

  it('短句不拆行', () => {
    expect(wrapText('假作真时真亦假', 200, measure)).toEqual(['假作真时真亦假']);
  });

  it('中文按字断行，不留下超宽的一行', () => {
    const lines = wrapText('假作真时真亦假无为有处有还无', 60, measure);
    expect(lines).toEqual(['假作真时真亦', '假无为有处有', '还无']);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(60);
  });

  it('按段落断开，空行保留', () => {
    expect(wrapText('一\n\n二', 100, measure)).toEqual(['一', '', '二']);
  });

  it('全是空白时给一个空行（不能返回空数组，画布会除零）', () => {
    expect(wrapText('   ', 100, measure)).toEqual(['']);
  });

  it('单个字符比一行还宽时也要有输出（不丢字）', () => {
    expect(wrapText('长', 0, measure)).toEqual(['长']);
  });
});

/** 假 ctx：记录每次绘制与当时的颜色 */
function fakeCtx() {
  const calls: Array<{ op: string; args: unknown[]; paint: string }> = [];
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 8 }),
    beginPath: () => calls.push({ op: 'beginPath', args: [], paint: '' }),
    closePath: () => calls.push({ op: 'closePath', args: [], paint: '' }),
    moveTo: (...a: unknown[]) => calls.push({ op: 'moveTo', args: a, paint: '' }),
    lineTo: (...a: unknown[]) => calls.push({ op: 'lineTo', args: a, paint: '' }),
    arcTo: (...a: unknown[]) => calls.push({ op: 'arcTo', args: a, paint: '' }),
    rect: (...a: unknown[]) => calls.push({ op: 'rect', args: a, paint: '' }),
    fill: () => calls.push({ op: 'fill', args: [], paint: String(ctx.fillStyle) }),
    stroke: () => calls.push({ op: 'stroke', args: [], paint: String(ctx.strokeStyle) }),
    setLineDash: (v: number[]) => calls.push({ op: 'setLineDash', args: [v], paint: '' }),
    fillRect: (...a: unknown[]) => calls.push({ op: 'fillRect', args: a, paint: String(ctx.fillStyle) }),
    fillText: (...a: unknown[]) => calls.push({ op: 'fillText', args: a, paint: String(ctx.fillStyle) }),
    scale: () => calls.push({ op: 'scale', args: [], paint: '' }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** 相对亮度，用来判「深底浅字」而不是认某个具体色值 */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, gr, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
}

describe('宿主主题', () => {
  it('没有 document（node / 导出脚本）时用兜底色，不抛错', () => {
    expect(hostTheme()).toEqual(FALLBACK_THEME);
  });
});

describe('版式规格跟预览对齐', () => {
  const host = FALLBACK_THEME;

  it('尺寸按卡片比例放大，不是随手定的数', () => {
    const s = cardSpec('classic', host);
    const f = CARD_W / BASE_W;
    expect(s.padX).toBeCloseTo(22 * f);
    expect(s.padY).toBeCloseTo(20 * f);
    expect(s.font).toBeCloseTo(16 * f);
    expect(s.lineH).toBeCloseTo(32 * f);
    expect(s.radius).toBeCloseTo(10 * f);
  });

  it('经典版：主题底、圆角、不描边（面板里它被压成 transparent）', () => {
    const s = cardSpec('classic', host);
    expect(s.bg).toBe(host.bg);
    expect(s.ink).toBe(host.ink);
    expect(s.border).toBe('');
    expect(s.radius).toBeGreaterThan(0);
  });

  it('信笺与夜读有描边，经典与胶片没有', () => {
    expect(cardSpec('letter', host).border).toBeTruthy();
    expect(cardSpec('night', host).border).toBeTruthy();
    expect(cardSpec('classic', host).border).toBe('');
    expect(cardSpec('film', host).border).toBe('');
  });

  it('信笺：字号与行高都比经典小一档（CSS 15px/28px）', () => {
    const base = cardSpec('classic', host);
    const letter = cardSpec('letter', host);
    expect(letter.font).toBeLessThan(base.font);
    expect(letter.lineH).toBeLessThan(base.lineH);
    expect(letter.rule).toBeTruthy();
  });

  it('夜读：深底浅字，与主题无关（CSS 里写死）', () => {
    const s = cardSpec('night', host);
    expect(luma(s.bg)).toBeLessThan(0.25);
    expect(luma(s.ink)).toBeGreaterThan(0.7);
  });

  it('胶片：无描边无圆角，上下两道线，字号最大、留白最大', () => {
    const film = cardSpec('film', host);
    const base = cardSpec('classic', host);
    expect(film.border).toBe('');
    expect(film.radius).toBe(0);
    expect(film.topBar).toBe(host.copper);
    expect(film.bottomBar).toBe(host.line);
    expect(film.font).toBeGreaterThan(base.font);
    expect(film.padY).toBeGreaterThan(base.padY);
  });

  it('认不出的模板退回经典', () => {
    expect(cardSpec('nope', host)).toEqual(cardSpec('classic', host));
    expect(cardSpec(undefined, host)).toEqual(cardSpec('classic', host));
  });
});

describe('底部署名', () => {
  it('就是插件名本身，不翻译、不加版本号', () => {
    expect(CARD_BADGE_TEXT).toBe('bz reader');
  });

  it('贴着底部内边距，落在卡片下方而不是正文里', () => {
    const y = cardBadgeY(520, 34);
    expect(y).toBeGreaterThan(520 / 2);
    expect(y + SIG_H).toBe(520 - 34);
  });

  it('是一行页脚：只有一条铜色短横 + 一行字，没有胶囊底色', () => {
    const { ctx, calls } = fakeCtx();
    drawCardBadge(ctx, 40, 300);
    const rects = calls.filter((c) => c.op === 'fillRect');
    expect(rects.length).toBe(1);
    expect(rects[0]?.paint).toBe(FALLBACK_THEME.copper);
    expect(rects[0]?.args[2]).toBe(SIG_LINE_W);
    /* 字距是逐字画的，拼回去还是完整插件名 */
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts.join('')).toBe(CARD_BADGE_TEXT);
  });

  it('字用出处色、短横用强调色：换主题不会跳出一块白补丁', () => {
    const { ctx, calls } = fakeCtx();
    drawCardBadge(ctx, 40, 300, { ...FALLBACK_THEME, copper: '#c39a4e', meta: '#a49b8b' });
    expect(calls.filter((c) => c.op === 'fillRect')[0]?.paint).toBe('#c39a4e');
    expect(calls.filter((c) => c.op === 'fillText')[0]?.paint).toBe('#a49b8b');
  });
});

describe('drawTracked', () => {
  it('逐字绘制并返回总宽（canvas 没有 letter-spacing）', () => {
    const { ctx, calls } = fakeCtx();
    /* 每字 8px、字距 2px → 3 个字 = 8*3 + 2*2 = 28 */
    expect(drawTracked(ctx, 'abc', 10, 100, 2)).toBe(28);
    expect(calls.filter((c) => c.op === 'fillText').length).toBe(3);
  });
});

/* ─────────── 完整出图 ─────────── */

function fakeCanvas() {
  const { ctx, calls } = fakeCtx();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'])),
  };
  return { canvas, calls };
}

const g = globalThis as unknown as {
  createEl?: (tag: string) => unknown;
  window?: unknown;
};
let restore: (() => void) | null = null;

function stubCanvas(canvas: unknown): void {
  const prevEl = g.createEl;
  const prevWin = g.window;
  g.createEl = () => canvas;
  g.window = { devicePixelRatio: 2 };
  restore = () => {
    g.createEl = prevEl;
    g.window = prevWin;
  };
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe('出图与预览一致', () => {
  const ALL = ['classic', 'letter', 'night', 'film'] as const;
  const input = { text: '读书是一次次离开自己。', title: '书名', author: '作者', chapter: '第一章' };

  it('底色取模板自己的底色', async () => {
    for (const t of ALL) {
      const { canvas, calls } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ ...input, template: t });
      const bg = calls.find((c) => c.op === 'fill')?.paint;
      expect(bg, t).toBe(cardSpec(t).bg);
    }
  });

  it('引号是铜色的，分别落在首行前与末行后', async () => {
    const { canvas, calls } = fakeCanvas();
    stubCanvas(canvas);
    await renderQuoteCard({ ...input, template: 'classic' });
    const copper = calls.filter((c) => c.op === 'fillText' && c.paint === FALLBACK_THEME.copper);
    expect(copper.map((c) => String(c.args[0])).join('')).toBe('「」');
  });

  it('出处与预览同一句话：书名 · 作者 · 章节', async () => {
    const { canvas, calls } = fakeCanvas();
    stubCanvas(canvas);
    await renderQuoteCard({ ...input, template: 'classic' });
    /* 出处是逐字带字距画的，拼回去才是一整句 */
    const metaText = calls
      .filter((c) => c.op === 'fillText')
      .map((c) => String(c.args[0]))
      .join('')
      .replace(/\s+/g, '');
    expect(metaText).toContain('书名·作者·第一章');
  });

  it('信笺与夜读描边，经典与胶片不描（与面板一致）', async () => {
    for (const t of ALL) {
      const { canvas, calls } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ ...input, template: t });
      const want = t === 'letter' || t === 'night';
      expect(calls.some((c) => c.op === 'stroke'), t).toBe(want);
    }
  });

  it('信笺画虚线框，其余三版不画', async () => {
    for (const t of ALL) {
      const { canvas, calls } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ ...input, template: t });
      const dashed = calls.some(
        (c) => c.op === 'setLineDash' && Array.isArray(c.args[0]) && (c.args[0] as number[]).length > 0,
      );
      expect(dashed, t).toBe(t === 'letter');
    }
  });

  it('胶片上边线是 2px 铜线', async () => {
    const { canvas, calls } = fakeCanvas();
    stubCanvas(canvas);
    await renderQuoteCard({ ...input, template: 'film' });
    const bars = calls.filter((c) => c.op === 'fillRect' && c.paint === FALLBACK_THEME.copper);
    expect(bars.some((b) => b.args[3] === 2)).toBe(true);
  });

  it('四版底部都有署名', async () => {
    for (const t of ALL) {
      const { canvas, calls } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ ...input, template: t });
      const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])).join('');
      expect(texts, t).toContain(CARD_BADGE_TEXT);
    }
  });

  it('引文正文完整出现在图里，没有被引号挤掉字', async () => {
    const { canvas, calls } = fakeCanvas();
    stubCanvas(canvas);
    await renderQuoteCard({ ...input, template: 'classic' });
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.join('')).toContain('读书是一次次离开自己。');
  });
});
