import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { t } from '../src/i18n';
import {
  headerActionIds,
  headerActionSpec,
  headerActionsFor,
  headerActive,
  headerOverflowFor,
  availableActions,
  userFacingActionIds,
} from '../src/view/header-actions';

/**
 * 头栏动作。两条真机反馈：
 *   · 桌面端右侧明明放得下，却只露出 3 颗，其余折进 ⋮；
 *   · 翻到已经加过书签的页面，书签图标不亮——看不出「这一页签过了」。
 */
describe('剪藏本三颗（2026-11-13：底条改头栏 / ⋮；原文入口收进正文脚注）', () => {
  it('桌面剪藏本：三颗都进头栏，且排在普通动作之后', () => {
    const ids = headerActionsFor(false, null, false, false, true);
    expect(ids).toEqual(
      expect.arrayContaining(['clipSave', 'clipNote', 'clipPanel']),
    );
    /* 「原文」已从动作里去掉：正文末尾的脚注仍保留原链接，不占一颗图标 */
    expect(ids).not.toContain('clipSource');
    /* 别插到「目录 / 搜索 / 书签」前面——那三颗是任何一本书的前三位 */
    expect(ids.slice(0, 3)).toEqual(['toc', 'search', 'mark']);
    expect(ids.indexOf('clipSave')).toBeGreaterThan(ids.indexOf('library'));
  });

  it('手机剪藏本：三颗不进头栏（那 3 个名额留给目录/搜索/书签），只走 ⋮', () => {
    const shown = headerActionsFor(true, null, false, true, true);
    expect(shown).toEqual(['toc', 'search', 'mark']);
    const overflow = headerOverflowFor(true, null, false, true, true);
    expect(overflow).toEqual(
      expect.arrayContaining(['clipSave', 'clipNote', 'clipPanel']),
    );
    expect(overflow).not.toContain('clipSource');
  });

  it('不是剪藏本时三颗根本不提供（普通 EPUB / PDF 头栏不受影响）', () => {
    expect(availableActions(false, false, false)).not.toContain('clipSave');
    expect(headerActionsFor(false, null, false, false, false)).toEqual(
      headerActionIds(false),
    );
    expect(headerOverflowFor(false, null, false, false, false)).not.toContain('clipSource');
    const pdf = availableActions(false, true, false);
    expect(pdf).not.toContain('clipPanel');
  });

  it('剪藏三颗的标签走语言包，不另写一套中文字面量', () => {
    for (const id of ['clipSave', 'clipNote', 'clipPanel'] as const) {
      const spec = headerActionSpec(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.label).not.toMatch(/^\{|^clip\./);
      expect(spec.icon).toBeTruthy();
    }
    expect(headerActionSpec('clipPanel').label).toBe(t('clip.action.openClipbook'));
  });

  it('「生成摘要」第四颗：桌面进头栏、排在三颗之后（它改内容，不是离开这一章）', () => {
    const ids = headerActionsFor(false, null, false, false, true);
    expect(ids).toContain('clipSummary');
    expect(ids.indexOf('clipSummary')).toBeGreaterThan(ids.indexOf('clipPanel'));
    /* 普通书里不能冒出这颗：它只对剪藏本有意义 */
    expect(headerActionsFor(false, null, false, false, false)).not.toContain('clipSummary');
    expect(availableActions(false, false, false)).not.toContain('clipSummary');
  });

  it('手机上「生成摘要」也只走 ⋮，不占那 3 个名额', () => {
    expect(headerActionsFor(true, null, false, true, true)).toEqual(['toc', 'search', 'mark']);
    expect(headerOverflowFor(true, null, false, true, true)).toContain('clipSummary');
  });

  it('设置页不给用户排序这五颗（它们只在剪藏本里出现）', () => {
    expect(userFacingActionIds()).not.toContain('clipSummary');
  });
});

describe('headerActionIds', () => {
  it('移动端 3 颗（横向像素最贵）', () => {
    expect(headerActionIds(true)).toEqual(['toc', 'search', 'mark']);
  });

  it('桌面端默认十二颗（菜单里的功能都能摆出来，由用户自己收）', () => {
    expect(headerActionIds(false)).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'history',
      'para',
      'paraBook',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
  });

  it('两端的顺序一致：目录 → 搜索 → 书签 永远在最前', () => {
    expect(headerActionIds(false).slice(0, 3)).toEqual(headerActionIds(true));
  });
});

function book(): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '红楼梦' },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: { position: { percent: 0.1 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: {
      highlights: [],
      excerpts: [],
      bookmarks: [{ id: 'k1', cfi: 'cfi-1', percent: 10, chapterTitle: '第一回', label: '第一回', createdAt: 1 }],
    },
    addedAt: 1,
    updatedAt: 1,
  };
}

describe('本章导读入口', () => {
  it('头栏里有一枚「本章导读」：图标走 Obsidian 图标集，标签读八语言包', () => {
    const spec = headerActionSpec('guide');
    expect(spec.icon).toBe('book-open');
    expect(spec.label).toBe(t('guide.title'));
    expect(headerActionIds(false)).toContain('guide');
  });

  it('手机上它跟其它功能一样进 ⋮，不占前三颗的名额', () => {
    expect(headerActionIds(true)).not.toContain('guide');
    expect(headerOverflowFor(true, null)).toContain('guide');
  });
});

describe('headerActive', () => {
  it('这一页有书签 → 书签图标点亮', () => {
    expect(headerActive(book(), 'cfi-1', false).mark).toBe(true);
  });

  it('这一页没有书签 → 不亮', () => {
    expect(headerActive(book(), 'cfi-2', false).mark).toBe(false);
  });

  it('定位还没出来（cfi 为空）时不亮，避免每页都亮一下', () => {
    expect(headerActive(book(), '', false).mark).toBe(false);
  });

  it('没有书时不亮', () => {
    expect(headerActive(null, 'cfi-1', false).mark).toBe(false);
  });

  it('并排对照的开关态照旧透出', () => {
    expect(headerActive(book(), 'cfi-1', true).para).toBe(true);
  });
});

const cfg = (order: string[] = [], hidden: string[] = []) => ({ order, hidden });

/**
 * 用户可以把图标排序、把不用的收起来。移动端最多露 3 颗——
 * 收起来的（显式隐藏 + 被名额挤出的）都进 ⋮。
 */
describe('headerActionsFor：排序、隐藏与移动端上限', () => {
  it('桌面十二颗、移动三颗（与默认一致）', () => {
    expect(headerActionsFor(false, cfg())).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'history',
      'para',
      'paraBook',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
    expect(headerActionsFor(true, cfg())).toEqual(['toc', 'search', 'mark']);
  });

  it('自定义顺序生效，未列出的按默认顺序补在后面', () => {
    expect(headerActionsFor(false, cfg(['para', 'mark']))).toEqual([
      'para',
      'mark',
      'toc',
      'search',
      'type',
      'history',
      'paraBook',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
  });

  it('隐藏的不显示，但进 ⋮', () => {
    const c = cfg([], ['type']);
    expect(headerActionsFor(false, c)).not.toContain('type');
    expect(headerOverflowFor(false, c)).toContain('type');
  });

  it('移动端第四颗起进 ⋮（并排 / 对照书籍不进；朗读 2026-11-13 起保留）', () => {
    /* 手机上并排与对照书籍不出现，⋮ 里也不留——留一条点了没反应的条目
       比没有更糟。朗读换成音频播放后手机可用，不再收。 */
    expect(headerOverflowFor(true, cfg())).toEqual([
      'type',
      'history',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
  });

  it('不认识的 id 被忽略', () => {
    expect(headerActionsFor(false, cfg(['bogus', 'toc']))).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'history',
      'para',
      'paraBook',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
  });
});

/**
 * PDF 专属的三颗（2026-11-10）。
 *
 * 页缩略图 / 复制链接 / 导出页图 以前全挤在 PDF 右下角那条工具条里，
 * 翻页工具和「拿走内容」的动作混在一排。它们现在和目录、搜索一样挂在头栏，
 * 但**只对 PDF 出现**——EPUB 上多三颗点不动的图标就是噪声。
 *
 * 「回到上一处」不在这三颗里：2026-11-10 起 EPUB 也有同一条跳转历史，
 * 两边共用一颗按钮。
 */
describe('PDF 专属动作', () => {
  it('EPUB 里只出现「回到上一处」，其余三颗一颗都不出现', () => {
    const ids = headerActionsFor(false, null);
    expect(ids).toContain('history');
    expect(ids).not.toContain('thumb');
    expect(ids).not.toContain('copy');
    expect(ids).not.toContain('export');
    expect(ids).toEqual(headerActionIds(false));
  });

  it('PDF 里四颗都在，且排在排版之后', () => {
    const ids = headerActionsFor(false, null, true);
    expect(ids.slice(0, 8)).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'thumb',
      'copy',
      'history',
      'export',
    ]);
  });

  it('手机上仍然只露 3 颗，其余进 ⋮', () => {
    const shown = headerActionsFor(true, null, true);
    expect(shown).toHaveLength(3);
    const overflow = headerOverflowFor(true, null, true);
    expect(overflow).toContain('thumb');
    expect(overflow).toContain('export');
  });

  it('用户把它们收起来之后，PDF 里也不再露', () => {
    const cfg = { order: [], hidden: ['thumb', 'export'] };
    const ids = headerActionsFor(false, cfg, true);
    expect(ids).not.toContain('thumb');
    expect(ids).not.toContain('export');
    expect(headerOverflowFor(false, cfg, true)).toEqual(['thumb', 'export']);
  });
});
