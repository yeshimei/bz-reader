import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { headerActionIds, headerActive } from '../src/view/header-actions';

/**
 * 头栏动作。两条真机反馈：
 *   · 桌面端右侧明明放得下，却只露出 3 颗，其余折进 ⋮；
 *   · 翻到已经加过书签的页面，书签图标不亮——看不出「这一页签过了」。
 */
describe('headerActionIds', () => {
  it('移动端 3 颗（横向像素最贵）', () => {
    expect(headerActionIds(true)).toEqual(['toc', 'search', 'mark']);
  });

  it('桌面端 5 颗，排版与并排对照不折叠', () => {
    expect(headerActionIds(false)).toEqual(['toc', 'search', 'mark', 'type', 'para']);
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
