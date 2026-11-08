import { describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { DEFAULT_SHELL_STATE } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';

/**
 * 书库页渲染：空态、筛选栏留不留、窄屏收不收。
 * 排序控件的形态单独在 library-sort.test.ts 里测。
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

describe('点书卡直接开书', () => {
  /** 取某一类卡的起始标签（属性都在同一串里，避免误伤「继续阅读」卡的详情按钮） */
  const tagOf = (out: string, cls: string): string =>
    new RegExp(`<div class="${cls}[^"]*"[^>]*>`).exec(out)?.[0] ?? '';

  it('封面墙：整张卡的动作是 openbook，不再是 detail', () => {
    const card = tagOf(html(), 'bzs-bkcard');
    expect(card).toContain('data-act="openbook"');
    expect(card).not.toContain('data-act="detail"');
  });

  it('列表行：动作同样是 openbook', () => {
    const out = viewLibrary({
      rows: [row()],
      total: 1,
      state: { ...DEFAULT_SHELL_STATE, libView: 'list' },
      libraryKey: 'k',
    });
    const line = tagOf(out, 'bzs-bkrow2');
    expect(line).toContain('data-act="openbook"');
    expect(line).not.toContain('data-act="detail"');
  });

  /* 右键 / 长按菜单的入口不能丢：桌面右键、手机长按都还靠它 */
  it('书卡仍保留菜单入口（data-bookmenu）', () => {
    expect(tagOf(html(), 'bzs-bkcard')).toContain('data-bookmenu');
  });

  it('「继续阅读」大卡片的详情按钮保持原样', () => {
    expect(html()).toContain('data-act="detail"');
  });
});

describe('窄屏筛选栏', () => {
  function mobile(patch = {}): string {
    return viewLibrary({
      rows: [row()],
      total: 1,
      state: { ...DEFAULT_SHELL_STATE, ...patch },
      libraryKey: 'k',
      compact: true,
    });
  }

  /* 390px 上「搜索框 + 五个分类 + 排序 + 两个视图」排不下，
     真机截图里右边两颗被裁掉了。放不下的那一档收成：
     搜索图标 + 分类下拉 + 排序下拉 + 视图。 */
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

  /* 2026-11-08：筛选条换成圆形语汇后，空间不够放字的动作钮（搜索、视图切换）
     一律用正圆图标钮；文字只留给分类/排序这种「选一个值」的胶囊。 */
  it('动作钮是圆形图标钮：搜索与视图都不再往圆里塞文字', () => {
    const out = mobile();
    const search = out.match(/<button[^>]*data-act="libsearchtoggle"[^>]*>/)?.[0] ?? '';
    const view = out.match(/<button[^>]*data-act="libview"[^>]*>/)?.[0] ?? '';
    expect(search).toContain('bzs-round');
    expect(view).toContain('bzs-round');
    expect(search).toContain('aria-label');
    expect(view).toContain('aria-label');
    expect(out).not.toContain('>列表<');
    expect(out).not.toContain('>封面墙<');
  });
});
