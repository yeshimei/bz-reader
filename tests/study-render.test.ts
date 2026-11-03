import { describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { DEFAULT_SHELL_STATE } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';

/**
 * 书架排序控件：原来是一个原生 `<select>`，展开后是系统的白底蓝条，
 * 跟壳层的纸色按钮完全两套长相（真机截图里最扎眼的一处）。
 * 现在改成和旁边「封面墙 / 列表」同一颗 chip，点开走宿主原生菜单。
 */
function row(patch: Partial<BookRow> = {}): BookRow {
  return {
    id: 'b1',
    title: '红楼梦',
    author: '曹雪芹',
    percent: 8,
    status: 'reading',
    fav: false,
    minutes: 12,
    lastText: '今天',
    lastTs: 1,
    shelf: '全部',
    format: 'EPUB',
    coverUrl: null,
    bg: '#4a3a28',
    fg: '#e9dcc3',
    glyph: '红',
    chapterTitle: '第一回',
    noteCount: 3,
    ...patch,
  };
}

function html(sort: 'recent' | 'title' | 'progress' = 'recent'): string {
  return viewLibrary({
    rows: [row()],
    state: { ...DEFAULT_SHELL_STATE, libSort: sort },
    libraryKey: 'k',
  });
}

describe('书架排序', () => {
  it('不再用原生 select', () => {
    expect(html()).not.toContain('<select');
  });

  it('是一颗按钮，点开走 libsortmenu', () => {
    expect(html()).toContain('data-act="libsortmenu"');
  });

  it('按钮上写着当前排序（换排序后跟着变）', () => {
    expect(html('recent')).toContain('最近阅读');
    expect(html('title')).toContain('书名');
    expect(html('progress')).toContain('进度');
  });
});
