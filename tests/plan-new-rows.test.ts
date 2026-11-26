import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE, planTotals } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK } from '../src/i18n/plan';
import type { PlanKey } from '../src/i18n/plan';

/**
 * 对照表 · 2026-11-26 新增 14 行。
 *
 * 这一轮只做「把已经能用的东西写进表」，不改任何功能的收费范围：
 *   · 书架段单独成段：书籍信息与封面、归档、多分类，全免费；
 *   · 阅读段补四行：书摘卡四版式、插图查看、沉浸模式；
 *   · PDF 段补框选成图；笔记段补导出模板；
 *   · 统计从数据段拆出来：统计回顾、每日打卡、阅读海报、周报长图；
 *   · 数据段只留全库搜索、语义搜索、备份恢复；
 *   · AI 段补「补书目信息」，按作者口径是基础版；
 *   · 听书段补朗读续听与音频缓存。
 *
 * 段内只有第一行挂能力位：整段共用一个拦点，后面的行只负责在对照表里
 * 说清「买了能多出哪几件事」。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

const NEW_ROWS: readonly PlanKey[] = [
  'shelfEdit',
  'archive',
  'multiShelf',
  'cardTemplates',
  'imageViewer',
  'immersive',
  'pdfRegion',
  'exportTemplates',
  'checkin',
  'weeklyPoster',
  'backup',
  'aiMeta',
  'ttsResume',
  'ttsCache',
];

const NAMES: Partial<Record<PlanKey, string>> = {
  shelfEdit: '书籍信息与封面：可改可还原',
  archive: '归档：移出书架，数据全留',
  multiShelf: '多分类：一本书归多个分类',
  cardTemplates: '书摘卡四版式：经典、信笺、夜读、胶片',
  imageViewer: '插图查看：缩放、拖动、翻页',
  immersive: '沉浸模式：藏起上下栏',
  pdfRegion: '框选成图：框一块做成书摘卡',
  exportTemplates: '导出模板：四档 + 自定义多行',
  checkin: '每日目标与连续打卡',
  weeklyPoster: '周报长图：一周数据一张图',
  backup: '备份与恢复：整份数据带走',
  aiMeta: 'AI 补书目信息：简介、分类自动填',
  ttsResume: '朗读续听：关掉再开接着听',
  ttsCache: '音频缓存：重听不重复合成',
};

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · 新增 14 行的位置', () => {
  it('十三个段，书架在最前，统计与数据分开', () => {
    expect(PLAN_GROUPS.map((g) => g.key)).toEqual([
      'shelf',
      'read',
      'layout',
      'import',
      'pdf',
      'manga',
      'notes',
      'review',
      'stats',
      'data',
      'ai',
      'voice',
      'roadmap',
    ]);
  });

  it('书架段三行，全免费', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'shelf');
    expect(g?.rows).toEqual(['shelfEdit', 'archive', 'multiShelf']);
    for (const k of g?.rows ?? []) {
      expect(row(k)?.free, k).toBe('yes');
      expect(row(k)?.pro, k).toBe('yes');
      expect(row(k)?.cap, k).toBeUndefined();
    }
  });

  it('阅读段按「读 → 标注 → 成图 → 看图 → 沉浸 → 找 → 回 → 注 → 分类」排', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'read');
    expect(g?.rows).toEqual([
      'reading',
      'keepAwake',
      'marks',
      'card',
      'cardTemplates',
      'imageViewer',
      'immersive',
      'inbookSearch',
      'back',
      'footnote',
      'classify',
    ]);
    for (const k of ['cardTemplates', 'imageViewer', 'immersive']) {
      expect(row(k)?.free, k).toBe('yes');
      expect(row(k)?.pro, k).toBe('yes');
      expect(row(k)?.cap, k).toBeUndefined();
    }
  });

  it('PDF 段八行，框选成图在导出页图之后，不另挂能力位', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'pdf');
    expect(g?.rows).toEqual([
      'pdfView',
      'pdfThumbs',
      'pdfLink',
      'pdfBacklink',
      'pdfAnnots',
      'pdfExport',
      'pdfRegion',
      'pdfOcr',
    ]);
    const r = row('pdfRegion');
    expect(r?.free).toBe('no');
    expect(r?.pro).toBe('yes');
    expect(r?.cap).toBeUndefined();
  });

  it('笔记段在导出之后补模板一行人', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'notes');
    expect(g?.rows).toEqual(['bilink', 'cites', 'export', 'exportTemplates']);
    expect(row('exportTemplates')?.free).toBe('yes');
    expect(row('exportTemplates')?.pro).toBe('yes');
  });

  it('统计独立成段：回顾、打卡、海报、周报', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'stats');
    expect(g?.rows).toEqual(['stats', 'checkin', 'poster', 'weeklyPoster']);
    expect(row('checkin')?.free).toBe('no');
    expect(row('checkin')?.pro).toBe('yes');
    expect(row('checkin')?.cap).toBeUndefined();
    expect(row('weeklyPoster')?.free).toBe('no');
    expect(row('weeklyPoster')?.pro).toBe('yes');
    expect(row('weeklyPoster')?.cap).toBeUndefined();
  });

  it('数据段只剩搜索与备份，备份免费', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'data');
    expect(g?.rows).toEqual(['crossSearch', 'semantic', 'backup']);
    expect(row('backup')?.free).toBe('yes');
    expect(row('backup')?.pro).toBe('yes');
    expect(row('backup')?.cap).toBeUndefined();
  });

  it('AI 段补补书目信息，按作者口径是基础版、不挂门禁', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'ai');
    expect(g?.rows).toEqual(['aiSel', 'aiFollow', 'aiBook', 'aiLog', 'aiChat', 'aiMeta', 'kb']);
    const r = row('aiMeta');
    expect(r?.free).toBe('yes');
    expect(r?.pro).toBe('yes');
    expect(r?.cap).toBeUndefined();
  });

  it('听书段在语速之后补续听与缓存，两行都免费', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'voice');
    expect(g?.rows).toEqual([
      'tts',
      'ttsEngine',
      'ttsVoice',
      'ttsRate',
      'ttsResume',
      'ttsCache',
      'ttsChapter',
      'ttsWhole',
      'ttsOffline',
    ]);
    for (const k of ['ttsResume', 'ttsCache']) {
      expect(row(k)?.free, k).toBe('yes');
      expect(row(k)?.pro, k).toBe('yes');
      expect(row(k)?.cap, k).toBeUndefined();
    }
  });

  it('中文行名与作者定稿一字不差', () => {
    for (const k of NEW_ROWS) expect(row(k)?.name, k).toBe(NAMES[k]);
  });
});

describe('对照表 · 新增行的八种语言', () => {
  it('每行八种语言都填了，没有空串', () => {
    for (const l of LOCALES) {
      for (const k of NEW_ROWS) {
        expect(String(PLAN_TEXT_PACK[k][l]).trim().length, `${l} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('拉丁语系没有汉字，繁中没有简体字', () => {
    for (const l of LATIN) {
      for (const k of NEW_ROWS) {
        expect(CJK.test(PLAN_TEXT_PACK[k][l]), `${l} ${k}：${PLAN_TEXT_PACK[k][l]}`).toBe(false);
      }
    }
    const SIMPLIFIED = /[书归档说话图页读写关闭备恢复听声缓存类]/;
    for (const k of NEW_ROWS) {
      expect(SIMPLIFIED.test(PLAN_TEXT_PACK[k]['zh-TW']), `${k}：${PLAN_TEXT_PACK[k]['zh-TW']}`).toBe(false);
    }
  });

  it('两个新段名八种语言齐全', () => {
    for (const l of LOCALES) {
      expect(String(PLAN_GROUP_TEXT_PACK.shelf[l]).trim().length, l).toBeGreaterThan(0);
      expect(String(PLAN_GROUP_TEXT_PACK.stats[l]).trim().length, l).toBeGreaterThan(0);
    }
  });
});

describe('对照表 · 合计', () => {
  it('基础版 34 项、高级版 69 项，全表 73 行', () => {
    expect(planTotals()).toEqual({ free: 34, pro: 69 });
    expect(PLAN_TABLE).toHaveLength(73);
    expect(PLAN_TABLE.length - planTotals().pro).toBe(4);
  });
});
