import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK, planGroupLabel, planGroupNameZh, planLabel, planNameZh } from '../src/i18n/plan';

/**
 * 对照表 · 路线图段（2026-11-11 叫「探索中」，2026-11-21 改叫「路线图」）。
 *
 * 还剩五项没实现：PDF 重排把固定版式变成流式；漫画模式补上分格 / 右到左 /
 * 跨页；整章翻译做原文译文对照；墨水屏优化让黑白更清、翻页不闪；界面动效
 * 给翻页、切章与书架过渡，且可随时关。
 *
 * 写进表里是为了让「高级版能力只增不减」有落点，但不能假装已经能用：
 *   · 五行两版都不打勾（free / pro 都是 no），也不挂能力位；
 *   · 段名「路线图」说明状态，行里不再加「开发中」小字；
 *   · 不进合计——图上基础版 18 项、高级版 44 项。
 *
 * 「复习」2026-11-21 已上线，从这一段搬去独立的「复习」段，这里不再列。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;
/** 简繁必然异形的字：繁中行名里出现任何一个就说明抄了简体。
    「可」简繁同形，列进来会把「可随时关」这种正确繁体判成错——检测器只收异形字。 */
const SIMPLIFIED = /[选线图复认与题扫样页读译对]/;
const ROADMAP_ROWS = ['pdfReflow', 'manga', 'transChapter', 'eink', 'motion'] as const;

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · 路线图段的位置与内容', () => {
  it('放在最末一段，只收五行，顺序固定', () => {
    const last = PLAN_GROUPS.at(-1);
    expect(last?.key).toBe('roadmap');
    expect(last?.rows).toEqual([...ROADMAP_ROWS]);
  });

  it('每行都是两版暂无：不打勾，也不挂能力位', () => {
    for (const key of ROADMAP_ROWS) {
      const r = row(key);
      expect(r, key).toBeTruthy();
      expect(r?.free, key).toBe('no');
      expect(r?.pro, key).toBe('no');
      expect(r?.cap, key).toBeUndefined();
    }
  });

  it('中文行名就是图上的那五行', () => {
    expect(planNameZh('pdfReflow')).toBe('PDF 重排：固定版式变流式');
    expect(planNameZh('manga')).toBe('漫画模式：分格、右到左、跨页');
    expect(planNameZh('transChapter')).toBe('整章翻译：原文译文对照');
    expect(planNameZh('eink')).toBe('墨水屏：黑白更清、翻页不闪');
    expect(planNameZh('motion')).toBe('界面动效：翻页与切章过渡，可关');
  });

  it('段名叫「路线图」，且不和任何行名撞字', () => {
    expect(planGroupNameZh('roadmap')).toBe('路线图');
    const names = new Set(PLAN_TABLE.map((r) => r.name));
    expect(names.has('路线图')).toBe(false);
  });

  it('路线行不计入已实现项：基础版 18、高级版 44、共 49 行', () => {
    expect(PLAN_TABLE.filter((r) => r.pro === 'yes')).toHaveLength(44);
    expect(PLAN_TABLE.filter((r) => r.free === 'yes')).toHaveLength(18);
    expect(PLAN_TABLE).toHaveLength(49);
  });

  it('知识库之后是听书段，再往后才是路线图', () => {
    const kbAt = PLAN_TABLE.findIndex((r) => r.key === 'kb');
    expect(kbAt).toBeGreaterThan(-1);
    expect(PLAN_TABLE.slice(kbAt + 1).map((r) => r.key)).toEqual([
      'tts',
      'ttsEngine',
      'ttsVoice',
      'ttsRate',
      'ttsChapter',
      'ttsWhole',
      'ttsOffline',
      ...ROADMAP_ROWS,
    ]);
  });
});

describe('对照表 · 路线图段八种语言', () => {
  it('段名与五行都填了八种语言，没有空串', () => {
    for (const l of LOCALES) {
      expect(String(PLAN_GROUP_TEXT_PACK.roadmap[l]).trim().length, l).toBeGreaterThan(0);
      for (const key of ROADMAP_ROWS) {
        expect(String(PLAN_TEXT_PACK[key][l]).trim().length, `${l} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      expect(CJK.test(PLAN_GROUP_TEXT_PACK.roadmap[l]), l).toBe(false);
      for (const key of ROADMAP_ROWS) {
        expect(CJK.test(PLAN_TEXT_PACK[key][l]), `${l} ${key}`).toBe(false);
      }
    }
  });

  it('繁中行名不用简体字', () => {
    for (const key of ROADMAP_ROWS) {
      expect(SIMPLIFIED.test(PLAN_TEXT_PACK[key]['zh-TW']), key).toBe(false);
    }
  });

  it('切到英文，段名与行名跟着换；切回中文恢复', () => {
    setLocale('en');
    expect(planGroupLabel('roadmap')).toBe('Roadmap');
    expect(planLabel('pdfReflow')).toContain('reflow');
    expect(planLabel('manga')).toContain('Manga');
    expect(planLabel('transChapter')).toContain('translation');
    expect(planLabel('eink')).toContain('E Ink');
    expect(planLabel('motion')).toContain('motion');
    expect(planLabel('clipEpub')).toContain('EPUB');
    setLocale('zh');
    expect(planGroupLabel('roadmap')).toBe('路线图');
  });
});
