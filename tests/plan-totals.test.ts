import { describe, expect, it } from 'vitest';

/**
 * 对照表底部的合计（商品图上那两个数：8 项 / 31 项）。
 *
 * 这两个数不是手工维护的文案，而是「表里打勾的行数」。写死的话，下次
 * 加一行忘了改，弹层就会对外少报一项——这张表是用户决定要不要付钱的
 * 地方，数字必须跟着表走。
 *
 * 「探索中」那七行两版都不打勾，所以天然不计入：不是特例，是同一条规则。
 */

import { PLAN_GROUPS, PLAN_TABLE, planTotals } from '../src/data/entitlement';

describe('对照表合计', () => {
  it('基础版 8 项、高级版 31 项（新增本页反链）', () => {
    expect(planTotals()).toEqual({ free: 8, pro: 31 });
  });

  it('合计就是打勾的行数，不是总行数', () => {
    const t = planTotals();
    expect(t.free).toBe(PLAN_TABLE.filter((r) => r.free === 'yes').length);
    expect(t.pro).toBe(PLAN_TABLE.filter((r) => r.pro === 'yes').length);
    /* 目前有七行两版都不打勾（探索中七项） */
    expect(t.pro).toBeLessThan(PLAN_TABLE.length);
    expect(PLAN_TABLE.length).toBe(38);
    expect(PLAN_TABLE.length - t.pro).toBe(7);
  });

  it('探索中的七行两边都不打勾，所以不进合计', () => {
    const explore = new Set(PLAN_GROUPS.find((g) => g.key === 'explore')?.rows ?? []);
    const rows = PLAN_TABLE.filter((r) => explore.has(r.key));
    expect(rows.length).toBe(7);
    for (const r of rows) {
      expect(r.free, r.key).toBe('no');
      expect(r.pro, r.key).toBe('no');
    }
  });
});
