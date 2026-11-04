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

  /* 排序箭头原来写的是 ico('chevron-down')，而图标表里只有 chevron——
     渲染出来是一个空 svg，按钮上只剩文字。 */
  it('排序按钮带得下箭头（不是空 svg）', () => {
    expect(html()).toMatch(/libsortmenu[^>]*>[\s\S]*?<path d="M6 9\.5l6 6 6-6"/);
  });
});

describe('书库空态', () => {
  it('一本都没导入：只留一句空态，不画搜索与分类', () => {
    const out = viewLibrary({
      rows: [],
      total: 0,
      state: DEFAULT_SHELL_STATE,
      libraryKey: 'k',
    });
    expect(out).toContain('书库还是空的');
    expect(out).not.toContain('bzs-filters');
    expect(out).not.toContain('bzs-shelfline');
    expect(out).not.toContain('没有匹配的书');
  });

  it('库里有书但筛选无匹配：留着筛选栏，换一句空态', () => {
    const out = viewLibrary({
      rows: [],
      total: 3,
      state: DEFAULT_SHELL_STATE,
      libraryKey: 'k',
    });
    expect(out).toContain('bzs-filters');
    expect(out).toContain('没有匹配的书');
    expect(out).not.toContain('书库还是空的');
  });
});

describe('窄屏筛选栏', () => {
  function mobile(patch = {}): string {
    return viewLibrary({
      rows: [row()],
      total: 1,
      state: { ...DEFAULT_SHELL_STATE, ...patch },
      libraryKey: 'k',
      mobile: true,
    });
  }

  /* 390px 上「搜索框 + 五个分类 + 排序 + 两个视图」排不下，
     真机截图里右边两颗被裁掉了。窄屏收成：搜索图标 + 分类下拉 + 排序下拉 + 视图。 */
  it('分类收成一颗下拉，不再平铺五颗', () => {
    const out = mobile();
    expect(out).toContain('data-act="libfiltermenu"');
    expect(out).not.toContain('data-act="libfilter"');
  });

  it('搜索框默认收起，只留一颗放大镜', () => {
    const out = mobile();
    expect(out).toContain('data-act="libsearchtoggle"');
    expect(out).not.toContain('data-role="libkw"');
  });

  it('点开后搜索框独占一行，还有一颗「收起」', () => {
    const out = mobile({ libSearchOpen: true });
    expect(out).toContain('data-role="libkw"');
    expect(out).toContain('收起');
  });

  it('桌面不受影响：五颗分类照旧平铺', () => {
    const out = html();
    expect(out).toContain('data-act="libfilter"');
    expect(out).not.toContain('data-act="libfiltermenu"');
  });
});
