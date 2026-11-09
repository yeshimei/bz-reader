import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 解锁弹层的分组渲染。
 *
 * 分组是**纯展示**：`PLAN_TABLE` 一行没动，`overlayUnlock` 按 `PLAN_GROUPS`
 * 的顺序插组标题。所以这里钉的是「插入的位置对不对」——每个行都落在自己那段的
 * 标题之后、下一段标题之前；组标题本身不能带勾位（否则读起来像一项功能）。
 *
 * 另一件事：空的勾位以前写的是「—」字符，靠 `text-align` 居中，和 SVG 勾
 * 不同心（72px 列里偏左 29px）。现在改成空格子，横线交给 CSS 画。
 */

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    entitlement: () => ({
      tier: 'free' as const,
      unlocked: false,
      trialLeft: 0,
      trialUsed: 0,
      exp: 0,
      license: '',
      trialVoid: false,
      installId: 'test',
      days: [],
    }),
  };
});

import { PLAN_GROUPS } from '../src/data/entitlement';
import { setLocale } from '../src/i18n';
import { planGroupNameZh, planNameZh } from '../src/i18n/plan';
import { overlayUnlock } from '../src/shell/overlay';

afterEach(() => setLocale('zh'));

const groupRow = /<div class="bzs-plan-row is-group"><span>([^<]*)<\/span><\/div>/g;

describe('解锁弹层 · 分组', () => {
  it('五个组标题全部渲染，顺序与 PLAN_GROUPS 一致', () => {
    const html = overlayUnlock();
    const names = [...html.matchAll(groupRow)].map((m) => m[1]);
    expect(names).toEqual(PLAN_GROUPS.map((g) => planGroupNameZh(g.key)));
  });

  it('每一行都落在自己那段的标题之后、下一段标题之前', () => {
    const html = overlayUnlock();
    for (let i = 0; i < PLAN_GROUPS.length; i += 1) {
      const g = PLAN_GROUPS[i];
      const start = html.indexOf(planGroupNameZh(g.key));
      const next = PLAN_GROUPS[i + 1];
      const end = next ? html.indexOf(planGroupNameZh(next.key)) : html.length;
      expect(start, g.key).toBeGreaterThan(-1);
      for (const key of g.rows) {
        const at = html.indexOf(planNameZh(key));
        expect(at, `${g.key} / ${key}`).toBeGreaterThan(start);
        expect(at, `${g.key} / ${key}`).toBeLessThan(end);
      }
    }
  });

  it('组标题不带勾位，读起来不像一项功能', () => {
    const html = overlayUnlock();
    const rows = html.match(groupRow) ?? [];
    expect(rows).toHaveLength(PLAN_GROUPS.length);
    for (const r of rows) expect(r).not.toContain('<i');
  });

  it('空勾位不再写字符「—」，交给 CSS 画', () => {
    const html = overlayUnlock();
    expect(html).toContain('<i class="n"></i>');
    expect(html).not.toContain('—');
  });

  it('换到英文界面，组标题也跟着换', () => {
    setLocale('en');
    const html = overlayUnlock();
    expect(html).toContain('Reading &amp; Shelf');
    expect(html).toContain('Advanced');
    expect(html).not.toContain('阅读与书架');
  });
});
