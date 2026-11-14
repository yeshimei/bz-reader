import { describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { DEFAULT_SHELL_STATE, type ShellState } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';
import { shelfRenderKey } from '../src/shell/shelf-page';

/** 书库批量操作栏与勾选态的渲染。照笔记页的多选范式，但作用在书卡上。 */
function row(id: string, title = id): BookRow {
  return {
    id,
    title,
    author: '作者',
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
    glyph: title.slice(0, 1),
    chapterTitle: '第一回',
    noteCount: 0,
  };
}

function html(state: Partial<ShellState> = {}, compact = false): string {
  return viewLibrary({
    rows: [row('a'), row('b'), row('c')],
    total: 3,
    state: { ...DEFAULT_SHELL_STATE, ...state },
    libraryKey: 'k',
    compact,
  });
}

const cardTag = (out: string, cls: string): string =>
  new RegExp(`<div class="${cls}[^"]*"[^>]*>`).exec(out)?.[0] ?? '';

describe('书库多选入口', () => {
  it('桌面与窄屏筛选条都有「多选」圆钮，平时不画批量工具条', () => {
    for (const compact of [false, true]) {
      expect(html({}, compact)).toContain('data-act="libsel"');
      expect(html({}, compact)).not.toContain('bzs-libselbar');
    }
  });

  it('平时点卡片照旧开书', () => {
    expect(cardTag(html(), 'bzs-bkcard')).toContain('data-act="openbook"');
    expect(cardTag(html({ libView: 'list' }), 'bzs-bkrow2')).toContain('data-act="openbook"');
  });
});

describe('多选模式下的书库', () => {
  it('出现批量工具条：已选本数、全选、归类、移出、退出', () => {
    const out = html({ libSelect: true, libSel: ['a', 'c'] });
    expect(out).toContain('bzs-libselbar');
    expect(out).toContain('已选 2 本');
    for (const act of ['libselall', 'libselclass', 'libselremove', 'libsel']) {
      expect(out, act).toContain(`data-act="${act}"`);
    }
  });

  it('点卡片变成勾选而不再开书，封面墙与列表都一样', () => {
    for (const [view, cls] of [
      ['grid', 'bzs-bkcard'],
      ['list', 'bzs-bkrow2'],
    ] as const) {
      const out = html({ libSelect: true, libView: view });
      const card = cardTag(out, cls);
      expect(card, view).toContain('data-act="libselpick"');
      expect(card, view).not.toContain('data-act="openbook"');
      expect(out, view).toContain('bzs-bkpick');
    }
  });

  it('勾中的卡片描边，没勾的不描：几本就是几本', () => {
    const out = html({ libSelect: true, libSel: ['a', 'c'] });
    expect(out.match(/is-picked/g) ?? []).toHaveLength(2);
    expect(html({ libSelect: true }).match(/is-picked/g) ?? []).toHaveLength(0);
  });

  it('选中集合里已经看不见的书不计数、不画勾选', () => {
    const out = html({ libSelect: true, libSel: ['a', 'ghost'] });
    expect(out).toContain('已选 1 本');
    expect(out.match(/is-picked/g) ?? []).toHaveLength(1);
  });

  it('全选按钮随当前可见这批切换「全选 / 取消全选」', () => {
    expect(html({ libSelect: true, libSel: ['a', 'b', 'c'] })).toContain('取消全选');
    expect(html({ libSelect: true, libSel: ['a'] })).toContain('>全选<');
  });

  it('一本没选时归类与移出都点不动', () => {
    const out = html({ libSelect: true });
    for (const act of ['libselclass', 'libselremove']) {
      const btn = new RegExp(`<button[^>]*data-act="${act}"[^>]*>`).exec(out)?.[0] ?? '';
      expect(btn, act).toContain('disabled');
    }
  });

  it('仍保留右键菜单的挂载点（多选期间由面板屏蔽，不在 HTML 里删）', () => {
    expect(cardTag(html({ libSelect: true }), 'bzs-bkcard')).toContain('data-bookmenu');
  });
});

describe('重绘指纹', () => {
  it('多选开关与选中集合都进指纹：勾一下画面必须跟着变', () => {
    const plain = shelfRenderKey({ ...DEFAULT_SHELL_STATE }, []);
    const on = shelfRenderKey({ ...DEFAULT_SHELL_STATE, libSelect: true }, []);
    const picked = shelfRenderKey({ ...DEFAULT_SHELL_STATE, libSelect: true, libSel: ['a'] }, []);
    expect(on).not.toBe(plain);
    expect(picked).not.toBe(on);
  });
});
