import { describe, expect, it } from 'vitest';

/**
 * 对照表底部的合计（商品图上那两个数：18 项 / 44 项）。
 *
 * 这两个数不是手工维护的文案，而是「表里打勾的行数」。写死的话，下次
 * 加一行忘了改，弹层就会对外少报一项——这张表是用户决定要不要付钱的
 * 地方，数字必须跟着表走。
 *
 * 「探索中」那六行两版都不打勾，所以天然不计入：不是特例，是同一条规则。
 */

import { PLAN_GROUPS, PLAN_TABLE, planTotals } from '../src/data/entitlement';

describe('对照表合计', () => {
  it('基础版 18 项、高级版 44 项（复习五项转正、全书鸟瞰下放后）', () => {
    expect(planTotals()).toEqual({ free: 18, pro: 44 });
  });

  it('合计就是打勾的行数，不是总行数', () => {
    const t = planTotals();
    expect(t.free).toBe(PLAN_TABLE.filter((r) => r.free === 'yes').length);
    expect(t.pro).toBe(PLAN_TABLE.filter((r) => r.pro === 'yes').length);
    /* 目前有五 行两版都不打勾（路线图五项） */
    expect(t.pro).toBeLessThan(PLAN_TABLE.length);
    expect(PLAN_TABLE.length).toBe(49);
    expect(PLAN_TABLE.length - t.pro).toBe(5);
  });

  it('路线图的五行两边都不打勾，所以不进合计', () => {
    const roadmap = new Set(PLAN_GROUPS.find((g) => g.key === 'roadmap')?.rows ?? []);
    const rows = PLAN_TABLE.filter((r) => roadmap.has(r.key));
    expect(rows.length).toBe(5);
    for (const r of rows) {
      expect(r.free, r.key).toBe('no');
      expect(r.pro, r.key).toBe('no');
    }
  });
});
