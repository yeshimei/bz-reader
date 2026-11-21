import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE, capLabel, planTotals } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK, planGroupNameZh } from '../src/i18n/plan';

/**
 * 对照表 · 朗读与听书段（2026-11-14 定稿）。
 *
 * 分档口径一句话：**免费听一页，收费听整本**。
 *   · 点一下就念、三种引擎、音色试听、语速与高亮跟随 → 两版都打勾；
 *   · 整章预生成、整本预生成、离线听书 → 只有高级版。
 *
 * 两张门：整章预生成挂 `tts`，整本预生成挂 `ttsBook`。离线听书没有自己的
 * 按钮（它是整本预生成的产物），跟着整本那一行高亮。
 * 「导出本章音频」免费且不上表：一次性的动作，列进对比只让表格变长。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

/** 四行免费：朗读本体往下都是「点一下就有」的东西 */
const FREE_ROWS = ['tts', 'ttsEngine', 'ttsVoice', 'ttsRate'] as const;
/** 三行付费：都要先花时间备材料，或者把文件带走 */
const PAID_ROWS = ['ttsChapter', 'ttsWhole', 'ttsOffline'] as const;

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · 朗读与听书段', () => {
  it('独立成段，夹在 AI 与路线图之间，七行顺序固定', () => {
    expect(PLAN_GROUPS.map((g) => g.key)).toEqual([
      'read',
      'layout',
      'import',
      'pdf',
      'notes',
      'review',
      'data',
      'ai',
      'voice',
      'roadmap',
    ]);
    const g = PLAN_GROUPS.find((x) => x.key === 'voice');
    expect(g?.rows).toEqual([...FREE_ROWS, ...PAID_ROWS]);
    expect(planGroupNameZh('voice')).toBe('听书');
  });

  it('朗读本体下放基础版：四行两版都打勾，也不挂能力位', () => {
    for (const k of FREE_ROWS) {
      const r = row(k);
      expect(r, k).toBeTruthy();
      expect(r?.free, k).toBe('yes');
      expect(r?.pro, k).toBe('yes');
      expect(r?.cap, k).toBeUndefined();
    }
  });

  it('预生成与离线听书留在高级版，各自能被高亮', () => {
    expect(row('ttsChapter')?.cap).toBe('tts');
    expect(row('ttsWhole')?.cap).toBe('ttsBook');
    /* 离线包是整本预生成的产物，没有自己的按钮：跟着整本那一行亮 */
    expect(row('ttsOffline')?.cap).toBeUndefined();
    for (const k of PAID_ROWS) {
      const r = row(k);
      expect(r?.free, k).toBe('no');
      expect(r?.pro, k).toBe('yes');
    }
  });

  it('排版段收四行：单双栏、竖排、并排与鸟瞰，不再重复收朗读', () => {
    const layout = PLAN_GROUPS.find((g) => g.key === 'layout');
    expect(layout?.rows).toEqual(['columns', 'vertical', 'parallel', 'bookmap']);
  });

  it('合计 18 / 44，全表 49 行', () => {
    expect(planTotals()).toEqual({ free: 18, pro: 44 });
    expect(PLAN_TABLE).toHaveLength(49);
  });

  it('导出本章音频不上表：功能照旧，只是不列在对比里', () => {
    expect(PLAN_TABLE.some((r) => r.key === ('ttsExport' as string))).toBe(false);
  });

  it('八种语言都填了，拉丁语系没有汉字', () => {
    for (const l of LOCALES) {
      expect(String(PLAN_GROUP_TEXT_PACK.voice[l]).trim().length, l).toBeGreaterThan(0);
      for (const k of [...FREE_ROWS, ...PAID_ROWS]) {
        expect(String(PLAN_TEXT_PACK[k][l]).trim().length, `${l} ${k}`).toBeGreaterThan(0);
      }
    }
    for (const l of LATIN) {
      expect(CJK.test(PLAN_GROUP_TEXT_PACK.voice[l]), l).toBe(false);
      for (const k of [...FREE_ROWS, ...PAID_ROWS]) {
        expect(CJK.test(PLAN_TEXT_PACK[k][l]), `${l} ${k}`).toBe(false);
      }
    }
  });

  it('被拦时弹层说的是「整本」，不是另一件事', () => {
    expect(capLabel('ttsBook')).toContain('整本');
  });
});
