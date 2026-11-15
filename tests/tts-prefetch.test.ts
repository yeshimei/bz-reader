import { describe, expect, it } from 'vitest';
import { prefetchPlan } from '../src/core/tts-prefetch';

/*
 * 预生成中断 / 关闭之后再点按钮，该问用户「继续还是重做」（2026-11-15）。
 * 判断本身是纯函数：缓存里已经备好几段、这一章共几段，决定弹哪个窗。
 */
describe('prefetchPlan', () => {
  it('一段都没备：走第一次的确认（收费 / 免费文案）', () => {
    expect(prefetchPlan(0, 120)).toEqual({ mode: 'fresh', cached: 0, total: 120, left: 120 });
  });

  it('备了一部分：给「继续」，并算出还剩几段', () => {
    expect(prefetchPlan(37, 120)).toEqual({ mode: 'resume', cached: 37, total: 120, left: 83 });
  });

  it('整章都备好了：等同于「重备」，问一句要不要重做', () => {
    expect(prefetchPlan(120, 120)).toEqual({ mode: 'rebuild', cached: 120, total: 120, left: 0 });
  });

  it('缓存里的键比段数还多（正文改短了）：按段数封顶，不报 130/120', () => {
    expect(prefetchPlan(130, 120)).toEqual({ mode: 'rebuild', cached: 120, total: 120, left: 0 });
  });

  it('空脚本：fresh，left 是 0 不是负数', () => {
    expect(prefetchPlan(0, 0)).toEqual({ mode: 'fresh', cached: 0, total: 0, left: 0 });
  });

  it('传进来的负数当 0：坏数据不该让进度条算出负剩余', () => {
    expect(prefetchPlan(-5, 10)).toEqual({ mode: 'fresh', cached: 0, total: 10, left: 10 });
  });
});
