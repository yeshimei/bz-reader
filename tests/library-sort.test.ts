import { afterEach, describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';

/**
 * 书库排序（2026-11-05）：
 * 桌面 1200px 放得下，排序不该再藏在「最近阅读 ▾」下拉里——
 * 三颗 chip 平铺，点哪颗亮哪颗。窄屏（手机 390px）仍然收成一颗下拉。
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

function html(patch: Partial<typeof DEFAULT_SHELL_STATE> = {}, mobile = false): string {
  return viewLibrary({
    rows: [row()],
    total: 1,
    state: { ...DEFAULT_SHELL_STATE, ...patch },
    libraryKey: 'k',
    mobile,
  });
}

function el(v: string): HTMLElement {
  return { dataset: { v } } as unknown as HTMLElement;
}

afterEach(() => {
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('桌面端：排序完全展开', () => {
  it('不再是下拉菜单', () => {
    const out = html();
    expect(out).not.toContain('data-act="libsortmenu"');
  });

  it('三颗 chip 分别是最近阅读 / 书名 / 进度', () => {
    const out = html();
    for (const [v, label] of [
      ['recent', '最近阅读'],
      ['title', '书名'],
      ['progress', '进度'],
    ] as const) {
      expect(out).toContain(`data-act="libsort" data-v="${v}">${label}<`);
    }
  });

  it('当前排序那颗高亮，换排序后跟着换', () => {
    expect(html({ libSort: 'recent' })).toMatch(
      /class="bzs-chip on" data-act="libsort" data-v="recent">最近阅读</,
    );
    expect(html({ libSort: 'title' })).toMatch(/class="bzs-chip on" data-act="libsort" data-v="title">书名</);
    expect(html({ libSort: 'title' })).not.toMatch(
      /class="bzs-chip on" data-act="libsort" data-v="recent"/,
    );
  });

  /* 五颗分类 chip 和三颗排序 chip 长得一模一样，中间只有一个弹性空隙。
     没有抬头的话，右侧第一颗「最近阅读」会被读成第六个分类。 */
  it('排序组带一个小抬头', () => {
    expect(html()).toMatch(/class="bzs-mini">排序</);
  });

  it('仍不用原生 select', () => {
    expect(html()).not.toContain('<select');
  });
});

describe('窄屏：排序仍收成一颗下拉', () => {
  it('点开走 libsortmenu，不再平铺三颗', () => {
    const out = html({}, true);
    expect(out).toContain('data-act="libsortmenu"');
    expect(out).not.toContain('data-act="libsort" data-v');
  });

  it('下拉按钮上写着当前排序', () => {
    expect(html({ libSort: 'title' }, true)).toContain('书名');
  });
});

describe('点排序 chip', () => {
  it('把 libSort 写回状态', () => {
    for (const v of ['title', 'progress', 'recent'] as const) {
      dispatchAction('libsort', el(v));
      expect(getState().libSort).toBe(v);
    }
  });
});
