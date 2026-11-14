import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, planGroupLabel, planGroupNameZh } from '../src/i18n/plan';

/**
 * 对照表分组（`PLAN_GROUPS`）。
 *
 * 28 行一长串看不清结构，弹窗要给「阅读与书架 / 格式与导出 / PDF 阅读 / 统计与
 * 检索 / AI / 进阶」六段。分组只描述**顺序与归属**，不改行本身：组里存的是行的
 * key，渲染时按组切表。所以这里钉三件事——每一行归且只归一组、组的先后就是表的
 * 先后、组名八种语言齐全。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

afterEach(() => setLocale('zh'));

describe('对照表分组 · 归属与顺序', () => {
  it('每一行按表里的顺序、不重不漏地分进各组', () => {
    const flat = PLAN_GROUPS.flatMap((g) => g.rows);
    expect(flat).toEqual(PLAN_TABLE.map((r) => r.key));
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('每组至少一行', () => {
    for (const g of PLAN_GROUPS) expect(g.rows.length, g.key).toBeGreaterThan(0);
  });

  it('组 key 不重复', () => {
    const keys = PLAN_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('组名不会和某一行同名，免得表里出现两行一样的字', () => {
    const rowNames = new Set(PLAN_TABLE.map((r) => r.name));
    for (const g of PLAN_GROUPS) expect(rowNames.has(planGroupNameZh(g.key)), g.key).toBe(false);
  });
});

describe('对照表分组 · 八种语言', () => {
  it('每个组都填了八种语言，没有空串', () => {
    for (const l of LOCALES) {
      for (const [key, pack] of Object.entries(PLAN_GROUP_TEXT_PACK)) {
        expect(String(pack[l]).trim().length, `${l} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('组名表的 key 与 PLAN_GROUPS 一一对应', () => {
    expect(Object.keys(PLAN_GROUP_TEXT_PACK).sort()).toEqual(PLAN_GROUPS.map((g) => g.key).sort());
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      for (const [key, pack] of Object.entries(PLAN_GROUP_TEXT_PACK)) {
        expect(CJK.test(pack[l]), `${l} ${key}：${pack[l]}`).toBe(false);
      }
    }
  });

  it('切换界面语言，组名跟着变；切回中文恢复', () => {
    expect(planGroupLabel('read')).toBe('阅读与书架');
    expect(planGroupNameZh('modes')).toBe('阅读方式');
    setLocale('en');
    expect(planGroupLabel('read')).toBe('Reading & Shelf');
    expect(planGroupLabel('data')).toBe('Data & Search');
    setLocale('zh');
    expect(planGroupLabel('modes')).toBe('阅读方式');
  });
});
