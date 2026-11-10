import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { headerActionIds, headerActionsFor, headerActive, headerOverflowFor } from '../src/view/header-actions';

/**
 * 头栏动作。两条真机反馈：
 *   · 桌面端右侧明明放得下，却只露出 3 颗，其余折进 ⋮；
 *   · 翻到已经加过书签的页面，书签图标不亮——看不出「这一页签过了」。
 */
describe('headerActionIds', () => {
  it('移动端 3 颗（横向像素最贵）', () => {
    expect(headerActionIds(true)).toEqual(['toc', 'search', 'mark']);
  });

  it('桌面端默认十颗（菜单里的功能都能摆出来，由用户自己收）', () => {
    expect(headerActionIds(false)).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'para',
      'paraBook',
      'tts',
      'bookmap',
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
  it('桌面十颗、移动三颗（与默认一致）', () => {
    expect(headerActionsFor(false, cfg())).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'para',
      'paraBook',
      'tts',
      'bookmap',
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
      'paraBook',
      'tts',
      'bookmap',
      'immersive',
      'library',
    ]);
  });

  it('隐藏的不显示，但进 ⋮', () => {
    const c = cfg([], ['type']);
    expect(headerActionsFor(false, c)).not.toContain('type');
    expect(headerOverflowFor(false, c)).toContain('type');
  });

  it('移动端第四颗起进 ⋮', () => {
    expect(headerOverflowFor(true, cfg())).toEqual([
      'type',
      'para',
      'paraBook',
      'tts',
      'bookmap',
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
      'para',
      'paraBook',
      'tts',
      'bookmap',
      'immersive',
      'library',
    ]);
  });
});

/**
 * PDF 专属的四颗（2026-11-10）。
 *
 * 页缩略图 / 复制链接 / 回到上一处 / 导出页图 以前全挤在 PDF 右下角那条工具条里，
 * 翻页工具和「拿走内容」的动作混在一排。它们现在和目录、搜索一样挂在头栏，
 * 但**只对 PDF 出现**——EPUB 上多四颗点不动的图标就是噪声。
 */
describe('PDF 专属动作', () => {
  it('EPUB 里一颗都不出现，默认顺序也不变', () => {
    const ids = headerActionsFor(false, null);
    expect(ids).not.toContain('thumb');
    expect(ids).not.toContain('copy');
    expect(ids).not.toContain('history');
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
    const cfg = { order: [], hidden: ['thumb', 'history'] };
    const ids = headerActionsFor(false, cfg, true);
    expect(ids).not.toContain('thumb');
    expect(ids).not.toContain('history');
    expect(headerOverflowFor(false, cfg, true)).toEqual(['thumb', 'history']);
  });
});
