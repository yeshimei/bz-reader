import { describe, expect, it } from 'vitest';
import { CARD_BADGE_H, CARD_BADGE_TEXT, cardBadgeY, drawCardBadge, wrapText } from '../src/shell/card-image';

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
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args }),
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
});
