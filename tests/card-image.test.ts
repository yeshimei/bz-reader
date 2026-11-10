import { afterEach, describe, expect, it } from 'vitest';
import {
  CARD_BADGE_H,
  CARD_BADGE_TEXT,
  CARD_PALETTES,
  CARD_W,
  cardBadgeY,
  cardPaletteOf,
  drawCardBadge,
  renderQuoteCard,
  wrapText,
} from '../src/shell/card-image';

/**
 * 书摘卡转图片是 canvas 手绘的——项目里没有任何 DOM 截图库
 * （poster 那张年报到今天也只有「复制文字版」）。
 *
 * 手绘唯一麻烦的地方是断行：中文没有空格，不能按 word 切。
 * 这里把断行抽成纯函数，画布只负责量宽度。
 */
describe('wrapText', () => {
  /** 每个字符固定 10px，方便算出「一行几个字」 */
  const measure = (s: string): number => s.length * 10;

  it('短句不拆行', () => {
    expect(wrapText('假作真时真亦假', 200, measure)).toEqual(['假作真时真亦假']);
  });

  it('中文按字断行，不留下超宽的一行', () => {
    /* 每字 10px、行宽 60px → 一行六个字 */
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

/** 只记录调用的假 ctx：node 里没有 canvas，但绘制指令本身能断言 */
function fakeCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args }),
    strokeRect: (...args: unknown[]) => calls.push({ op: 'strokeRect', args }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', args }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('书摘图片徽章 · 2026-11-10 下放基础版', () => {
  it('徽章就是插件名本身，不翻译、不加版本号', () => {
    expect(CARD_BADGE_TEXT).toBe('bz reader');
  });

  it('落在引文与出处之后的底部留白里，不压住正文', () => {
    const h = 520;
    const y = cardBadgeY(h);
    expect(y).toBeGreaterThan(h / 2);
    expect(y + CARD_BADGE_H).toBeLessThanOrEqual(h - 40);
  });

  it('任何人复制的图片都带徽章：绘制函数不看授权，也不写广告词', () => {
    const { ctx, calls } = fakeCtx();
    drawCardBadge(ctx, 300);
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual([CARD_BADGE_TEXT]);
    expect(calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(0);
  });

  it('徽章字号比引文小，不抢正文', () => {
    const { ctx } = fakeCtx();
    drawCardBadge(ctx, 300);
    expect(Number(ctx.font.match(/(\d+)px/)?.[1])).toBeLessThan(30);
  });

  it('徽章有描边：上一版只有一块与纸底几乎同色的底，缩图里等于没画', () => {
    const { ctx, calls } = fakeCtx();
    drawCardBadge(ctx, 300);
    expect(calls.some((c) => c.op === 'strokeRect')).toBe(true);
  });
});

/* ─────────── 模板 → 图片 ─────────── */

/** 假画布：把每次绘制的颜色一起记下来，才能断言「这张图是哪一版」 */
function fakeCanvas() {
  const ops: Array<{ op: string; args: unknown[]; paint: string }> = [];
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 8 }),
    setLineDash: (v: number[]) => ops.push({ op: 'setLineDash', args: [v], paint: '' }),
    fillRect: (...args: unknown[]) => ops.push({ op: 'fillRect', args, paint: String(ctx.fillStyle) }),
    strokeRect: (...args: unknown[]) => ops.push({ op: 'strokeRect', args, paint: String(ctx.strokeStyle) }),
    fillText: (...args: unknown[]) => ops.push({ op: 'fillText', args, paint: String(ctx.fillStyle) }),
    scale: () => {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'])),
  };
  return { canvas, ops, ctx };
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

/** 相对亮度，用来判「深底浅字」而不是认某个具体色值 */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, gr, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
}

describe('书摘图片跟着模板出图', () => {
  const ALL = ['classic', 'letter', 'night', 'film'] as const;

  it('四种版式的纸底各不相同：换了模板，图不能还是第一张', () => {
    expect(new Set(ALL.map((t) => CARD_PALETTES[t].paper)).size).toBe(4);
  });

  it('夜读是深底浅字，其余三版是浅底深字', () => {
    for (const t of ALL) {
      const p = CARD_PALETTES[t];
      const dPaper = luma(p.paper);
      const dInk = luma(p.ink);
      if (t === 'night') {
        expect(dPaper, t).toBeLessThan(0.25);
        expect(dInk, t).toBeGreaterThan(0.7);
        expect(p.dark).toBe(true);
      } else {
        expect(dPaper, t).toBeGreaterThan(0.85);
        expect(dInk, t).toBeLessThan(0.3);
      }
      /* 正文与纸底必须拉得开，不能只是「差一点」 */
      expect(Math.abs(dPaper - dInk), t).toBeGreaterThan(0.5);
    }
  });

  it('认不出的模板退回经典（旧弹层状态、手改过的 mode 都不该白屏）', () => {
    expect(cardPaletteOf('nope')).toBe(CARD_PALETTES.classic);
    expect(cardPaletteOf(undefined)).toBe(CARD_PALETTES.classic);
    expect(cardPaletteOf('')).toBe(CARD_PALETTES.classic);
  });

  it('每版出图的第一笔底色就是它自己的纸色', async () => {
    for (const t of ALL) {
      const { canvas, ops } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ text: '读书是一次次离开自己。', title: '书名', template: t });
      expect(ops[0]?.op, t).toBe('fillRect');
      expect(ops[0]?.paint, t).toBe(CARD_PALETTES[t].paper);
      expect(ops[0]?.args[2], t).toBe(CARD_W);
    }
  });

  it('信笺画出横线，其余三版不画', async () => {
    for (const t of ALL) {
      const { canvas, ops } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ text: '一\n二\n三', template: t });
      const rules = ops.filter((o) => o.op === 'fillRect' && o.paint === CARD_PALETTES.letter.rule);
      /* classic/night/film 没有 rule 色，自然为 0 */
      expect(rules.length > 0, t).toBe(t === 'letter');
    }
  });

  it('胶片是票根：上下两道铜线，没有左侧竖线', async () => {
    const { canvas, ops } = fakeCanvas();
    stubCanvas(canvas);
    await renderQuoteCard({ text: '短句', title: '书名', template: 'film' });
    const lines = ops.filter((o) => o.op === 'fillRect');
    /* 上：2px 铜线；下：1px 浅铜线 */
    expect(lines.some((o) => o.paint === CARD_PALETTES.film.accent && o.args[3] === 2)).toBe(true);
    expect(lines.some((o) => o.paint === CARD_PALETTES.film.badgeBorder && o.args[3] === 1)).toBe(true);
    /* 经典版那条 2px 宽的左侧竖线不该出现（这里是 filler，宽度才是判据） */
    expect(lines.some((o) => o.args[2] === 2 && o.args[3] !== 2)).toBe(false);
  });

  it('信笺拉一圈虚线，其余三版不拉', async () => {
    for (const t of ALL) {
      const { canvas, ops } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ text: '一句话。', template: t });
      const dashed = ops.filter((o) => o.op === 'setLineDash' && Array.isArray(o.args[0]) && (o.args[0] as number[]).length > 0);
      expect(dashed.length > 0, t).toBe(t === 'letter');
    }
  });

  it('四版都带徽章，且徽章贴着同一处底部留白', async () => {
    for (const t of ALL) {
      const { canvas, ops } = fakeCanvas();
      stubCanvas(canvas);
      await renderQuoteCard({ text: '一句话。', title: '书名', template: t });
      const badge = ops.filter((o) => o.op === 'fillText' && o.args[0] === CARD_BADGE_TEXT);
      expect(badge.length, t).toBe(1);
      /* 夜读的徽章底色跟着翻深，不能是一块白补丁 */
      if (t === 'night') {
        const box = ops.filter((o) => o.op === 'fillRect' && o.paint === CARD_PALETTES.night.badgeBg);
        expect(box.length, t).toBe(1);
      }
    }
  });
});
