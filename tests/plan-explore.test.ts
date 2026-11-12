import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK, planGroupLabel, planGroupNameZh, planLabel, planNameZh } from '../src/i18n/plan';

/**
 * 对照表 · 探索中段（2026-11-11，2026-11-12 增至八项）。
 *
 * 八项都还没实现、还在开发中：PDF OCR+AI 视觉把扫描件做到「像文字版」的
 * 选中 / 搜索 / 划线体验；PDF 重排把固定版式变成流式；漫画模式补上分格 /
 * 右到左 / 跨页；整章翻译做原文译文对照；复习支持全文回顾、AI 抽认卡与
 * AI 出题；墨水屏优化让黑白更清、翻页不闪；界面动效给翻页、切章与书架
 * 过渡，且可随时关；剪藏成书把 bz 剪藏本里的文章合成一本 EPUB，进书架
 * 当普通书读。
 *
 * 写进表里是为了让「高级版能力只增不减」有落点，但不能假装已经能用：
 *   · 八行两版都不打勾（free / pro 都是 no），也不挂能力位；
 *   · 段名「探索中」说明状态，行里不再加「开发中」小字；
 *   · 不进合计——图上基础版 8 项、高级版 29 项保持不变。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;
/** 简繁必然异形的字：繁中行名里出现任何一个就说明抄了简体。
    「可」简繁同形，列进来会把「可随时关」这种正确繁体判成错——检测器只收异形字。 */
const SIMPLIFIED = /[选线图复认与题扫样页读译对]/;
const EXPLORE_ROWS = [
  'pdfOcr',
  'pdfReflow',
  'manga',
  'transChapter',
  'review',
  'eink',
  'motion',
] as const;

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · 探索中段的位置与内容', () => {
  it('放在最末一段，只收七行（剪藏成书已实现转正），顺序固定', () => {
    const last = PLAN_GROUPS.at(-1);
    expect(last?.key).toBe('explore');
    expect(last?.rows).toEqual([...EXPLORE_ROWS]);
  });

  it('每行都是两版暂无：不打勾，也不挂能力位', () => {
    for (const key of EXPLORE_ROWS) {
      const r = row(key);
      expect(r, key).toBeTruthy();
      expect(r?.free, key).toBe('no');
      expect(r?.pro, key).toBe('no');
      expect(r?.cap, key).toBeUndefined();
    }
  });

  it('中文行名就是图上的那七行', () => {
    expect(planNameZh('pdfOcr')).toBe('PDF OCR+AI视觉：扫描件像文字版一样能选能搜能划');
    expect(planNameZh('pdfReflow')).toBe('PDF 重排：固定版式也能流式读');
    expect(planNameZh('manga')).toBe('漫画模式：分格、右到左、跨页');
    expect(planNameZh('transChapter')).toBe('整章翻译：原文译文对照读');
    expect(planNameZh('review')).toBe('复习：全文回顾，AI 生成抽认卡与题目');
    expect(planNameZh('eink')).toBe('墨水屏优化：黑白更清、翻页不闪');
    expect(planNameZh('motion')).toBe('界面动效：翻页、切章与书架过渡，可随时关');
  });

  it('段名叫「探索中」，且不和任何行名撞字', () => {
    expect(planGroupNameZh('explore')).toBe('探索中');
    const names = new Set(PLAN_TABLE.map((r) => r.name));
    expect(names.has('探索中')).toBe(false);
  });

  it('探索行不计入已实现项：基础版 8、高级版 30、共 37 行的口径不变', () => {
    /* 图上的合计只看已实现：高级版 30 个勾（剪藏成书 2026-11-13 转正）、\n       基础版 8 个勾。探索七行加进来之后，行数仍是 37。 */
    expect(PLAN_TABLE.filter((r) => r.pro === 'yes')).toHaveLength(30);
    expect(PLAN_TABLE.filter((r) => r.free === 'yes')).toHaveLength(8);
    expect(PLAN_TABLE).toHaveLength(37);
  });

  it('知识库之后是剪藏成书（已转正），再往后才是探索段', () => {
    const kbAt = PLAN_TABLE.findIndex((r) => r.key === 'kb');
    expect(kbAt).toBeGreaterThan(-1);
    expect(PLAN_TABLE.slice(kbAt + 1).map((r) => r.key)).toEqual(['clipEpub', ...EXPLORE_ROWS]);
  });
});

describe('对照表 · 探索中段八种语言', () => {
  it('段名与八行都填了八种语言，没有空串', () => {
    for (const l of LOCALES) {
      expect(String(PLAN_GROUP_TEXT_PACK.explore[l]).trim().length, l).toBeGreaterThan(0);
      for (const key of EXPLORE_ROWS) {
        expect(String(PLAN_TEXT_PACK[key][l]).trim().length, `${l} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      expect(CJK.test(PLAN_GROUP_TEXT_PACK.explore[l]), l).toBe(false);
      for (const key of EXPLORE_ROWS) {
        expect(CJK.test(PLAN_TEXT_PACK[key][l]), `${l} ${key}`).toBe(false);
      }
    }
  });

  it('繁中行名不用简体字', () => {
    for (const key of EXPLORE_ROWS) {
      expect(SIMPLIFIED.test(PLAN_TEXT_PACK[key]['zh-TW']), key).toBe(false);
    }
  });

  it('切到英文，段名与行名跟着换；切回中文恢复', () => {
    setLocale('en');
    expect(planGroupLabel('explore')).toBe('Explorations');
    expect(planLabel('pdfOcr')).toContain('OCR');
    expect(planLabel('pdfReflow')).toContain('reflow');
    expect(planLabel('manga')).toContain('Manga');
    expect(planLabel('transChapter')).toContain('translation');
    expect(planLabel('review')).toContain('Review');
    expect(planLabel('eink')).toContain('E Ink');
    expect(planLabel('motion')).toContain('motion');
    expect(planLabel('clipEpub')).toContain('EPUB');
    setLocale('zh');
    expect(planGroupLabel('explore')).toBe('探索中');
  });
});
