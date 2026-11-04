import { afterEach, describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { isCompactLibrary } from '../src/core/mobile';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';

/**
 * 书库筛选行（2026-11-05）：
 * 「放得下就摊开」——桌面把搜索、五个分类、三个排序、两个视图全平铺；
 * 手机 390px 收成「放大镜 + 分类下拉 + 排序下拉 + 视图」四颗。
 *
 * 收不收**只看这一块有多宽**，不看平台：用 isMobileShell() 判的话，
 * 桌面验收时开着 force-mobile，1725×1152 的窗口也会被当成手机，
 * 筛选行收成四个下拉（真机截图）。
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

function html(patch: Partial<typeof DEFAULT_SHELL_STATE> = {}, compact = false): string {
  return viewLibrary({
    rows: [row()],
    total: 1,
    state: { ...DEFAULT_SHELL_STATE, ...patch },
    libraryKey: 'k',
    compact,
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

/* 真机：1725×1152 的桌面窗口里，筛选行还是四颗下拉（放大镜 / 全部▾ /
   最近阅读▾ / 列表）。原因是渲染按 isMobileShell() 判——桌面验收开着
   force-mobile 时它也返回 true。收不收只该看这一块有多宽。 */
describe('放得下就摊开：只看宽度，不看平台', () => {
  it('桌面宽窗口（1725）摊开', () => {
    expect(isCompactLibrary(1725)).toBe(false);
  });

  it('半屏窗口（900）放不下，收成下拉', () => {
    expect(isCompactLibrary(900)).toBe(true);
  });

  it('阈值 1000：刚好够就摊开，少 1px 就收', () => {
    expect(isCompactLibrary(1000)).toBe(false);
    expect(isCompactLibrary(999)).toBe(true);
  });

  /* 视图刚挂上来、还没参与布局时 clientWidth 是 0——
     这时宁可按摊开画，随后 onResize 会纠正；反过来会在桌面上闪一下下拉。 */
  it('宽度还测不到（0）时按摊开处理', () => {
    expect(isCompactLibrary(0)).toBe(false);
  });

  it('桌面宽窗口渲染出来一个下拉都不剩', () => {
    const out = html();
    expect(out).not.toContain('data-act="libfiltermenu"');
    expect(out).not.toContain('data-act="libsortmenu"');
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
