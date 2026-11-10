import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_TABLE, capLabel } from '../src/data/entitlement';

/**
 * 2026-11-10：书摘图片下放基础版，两版都能复制，图片一律带 bz reader 徽章。
 *
 * 这里钉住「门禁真的拆了」。只改对照表而把 requireCap 留着，是最容易漏的
 * 半吊子改动——用户看到两栏都打勾，点下去却弹付费窗。徽章是品牌署名，
 * 不是付费水印，所以绘制那条路径上也不该出现授权判断。
 */
const actions = readFileSync(new URL('../src/shell/actions.ts', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('../src/shell/overlay.ts', import.meta.url), 'utf8');
const cardImage = readFileSync(new URL('../src/shell/card-image.ts', import.meta.url), 'utf8');

describe('书摘图片 · 门禁已拆', () => {
  it('对照表两栏都打勾，这一行不再挂能力位', () => {
    const card = PLAN_TABLE.find((r) => r.key === 'card');
    expect(card?.free).toBe('yes');
    expect(card?.pro).toBe('yes');
    expect(card?.cap).toBeUndefined();
  });

  it('复制图片那个动作里没有 requireCap', () => {
    const at = actions.indexOf("case 'quotecopyimg'");
    expect(at).toBeGreaterThan(-1);
    expect(actions.slice(at, at + 600)).not.toContain('requireCap(');
  });

  it('书摘弹窗的「复制图片」按钮不再看 can(card)', () => {
    expect(overlay).toContain('data-act="quotecopyimg"');
    expect(overlay).not.toContain("can('card')");
  });

  it('徽章绘制路径上不查授权：所有人同一张图', () => {
    expect(cardImage).not.toContain('can(');
    expect(cardImage).not.toContain('entitlement');
  });

  it('阅读海报仍留在高级版，解锁弹窗说的是海报不是书摘', () => {
    const at = actions.indexOf("case 'poster'");
    expect(at).toBeGreaterThan(-1);
    expect(actions.slice(at, at + 120)).toContain("requireCap('poster')");
    /* 1.0.0 定稿把「周报 / 年报 / 体检」三种叫法统一成「阅读海报」：
       对照表行名与弹层卖点都得跟着这个说法走。 */
    const poster = PLAN_TABLE.find((r) => r.key === 'poster');
    expect(poster?.name).toBe('阅读海报：年度总结与数据长图');
    expect(capLabel('poster')).toContain('阅读');
    expect(capLabel('poster')).not.toContain('书摘');
  });
});
