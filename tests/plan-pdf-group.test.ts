import { afterEach, describe, expect, it } from 'vitest';
import { capLabel, PLAN_GROUPS, PLAN_TABLE, unlockModeFor } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK, planGroupLabel, planGroupNameZh, planNameZh } from '../src/i18n/plan';

/**
 * 高级版对照表 · PDF 段（2026-11-10）。
 *
 * 以前 PDF 只在「更多格式」那一行里被一句「PDF、Kindle 系…」带过，用户看不出
 * 买高级版在 PDF 上还多了什么。现在 PDF 单独成一段，逐行列出真能做的事。
 *
 * 两条硬约束：
 *   · 组名不能只写「PDF」——「更多格式」那行的正文里就有「PDF」，表格按文字
 *     定位时会把组标题认成那一行的一部分，高亮与自检都会错位；
 *   · 整段共用一个拦点（打开 PDF）。基础版根本进不了 PDF，缩略图 / 导出这些
 *     按钮对他们不存在，给每行各配一个能力位只是摆样子。
 */

const PDF_ROWS = ['pdfView', 'pdfThumbs', 'pdfLink', 'pdfAutoLink', 'pdfAnnots', 'pdfExport', 'pdfZoom'] as const;
const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · PDF 段的位置与内容', () => {
  it('PDF 自成一段，紧跟格式与导出之后', () => {
    const keys = PLAN_GROUPS.map((g) => g.key);
    expect(keys).toContain('pdf');
    expect(keys.indexOf('pdf')).toBe(keys.indexOf('output') + 1);
  });

  it('七行按顺序、不多不少', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'pdf');
    expect(g?.rows).toEqual([...PDF_ROWS]);
  });

  it('七行都是基础版没有、高级版才有', () => {
    for (const key of PDF_ROWS) {
      const r = row(key);
      expect(r, key).toBeTruthy();
      expect(r?.free, key).toBe('no');
      expect(r?.pro, key).toBe('yes');
    }
  });

  it('整段共用一个拦点：只有第一行挂能力位', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'pdf');
    const rows = (g?.rows ?? []).map((k) => row(k));
    expect(rows[0]?.cap).toBe('pdf');
    for (const r of rows.slice(1)) expect(r?.cap, r?.key).toBeUndefined();
  });

  it('组名叫「PDF 阅读」：只写 PDF 会和更多格式那行撞字', () => {
    expect(planGroupNameZh('pdf')).toBe('PDF 阅读');
    expect(planGroupLabel('pdf')).toBe('PDF 阅读');
    setLocale('en');
    expect(planGroupLabel('pdf')).toBe('PDF Reading');
  });

  it('被拦时那句卖点也是 PDF 专用，不借用「更多格式」', () => {
    expect(capLabel('pdf')).toContain('PDF');
    expect(capLabel('pdf')).not.toContain('更多格式');
  });

  it('点开 PDF 被拦：高亮引到 PDF 段，其余格式仍走更多格式那一行', () => {
    expect(unlockModeFor('pdf')).toBe('pdf');
    expect(unlockModeFor('mobi')).toBe('fullFormats');
    expect(unlockModeFor('azw3')).toBe('fullFormats');
    expect(unlockModeFor('fb2')).toBe('fullFormats');
    expect(unlockModeFor('cbz')).toBe('fullFormats');
  });
});

describe('对照表 · 更多格式不再替 PDF 说话', () => {
  it('中文行名里没有 PDF 了', () => {
    expect(row('formats')?.name).not.toContain('PDF');
  });

  it('八种语言的这一行都不再提 pdf', () => {
    for (const l of LOCALES) {
      expect(PLAN_TEXT_PACK.formats[l], l).not.toMatch(/pdf/i);
    }
  });
});

describe('对照表 · 回到上一处是基础版能力', () => {
  it('两栏都打勾，且不挂能力位', () => {
    const back = row('back');
    expect(back).toBeTruthy();
    expect(back?.free).toBe('yes');
    expect(back?.pro).toBe('yes');
    expect(back?.cap).toBeUndefined();
  });

  it('归在阅读与书架段，EPUB 与 PDF 共用同一颗按钮', () => {
    const read = PLAN_GROUPS.find((g) => g.key === 'read');
    expect(read?.rows).toContain('back');
  });
});

describe('对照表 · PDF 段八种语言', () => {
  it('组名与七行都填了，没有空串', () => {
    for (const l of LOCALES) {
      expect(String(PLAN_GROUP_TEXT_PACK.pdf[l]).trim().length, l).toBeGreaterThan(0);
      for (const key of PDF_ROWS) {
        expect(String(PLAN_TEXT_PACK[key][l]).trim().length, `${l} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      expect(CJK.test(PLAN_GROUP_TEXT_PACK.pdf[l]), l).toBe(false);
      for (const key of PDF_ROWS) {
        expect(CJK.test(PLAN_TEXT_PACK[key][l]), `${l} ${key}`).toBe(false);
      }
    }
  });

  it('繁体行名不用简体字', () => {
    const SIMPLIFIED = /[读写页缩图关双页]|复制|链接|笔记|导出/;
    /* 直接按词表查：繁中这七行里不该出现这些简体字形 */
    for (const key of PDF_ROWS) {
      expect(SIMPLIFIED.test(PLAN_TEXT_PACK[key]['zh-TW']), key).toBe(false);
    }
    expect(planGroupNameZh('pdf')).toBe('PDF 阅读');
    expect(PLAN_GROUP_TEXT_PACK.pdf['zh-TW']).toBe('PDF 閱讀');
  });

  it('切到英文，行名跟着换', () => {
    setLocale('en');
    expect(planNameZh('pdfView')).toBe('缩放、旋转、单双页与滚动');
    expect(PLAN_TEXT_PACK.pdfView.en).toBe('Zoom, rotate, two-up, and scroll');
    setLocale('zh');
  });
});
