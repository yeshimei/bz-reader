import { describe, expect, it } from 'vitest';
import { studyShell, STUDY_ACTS, STUDY_TABS } from '../src/shell/render/study';
import { nextStudyPage } from '../src/shell/state';

/**
 * 书架头栏定稿（docs/ui-spec.md · S1）：
 *   页签只留「书库 / 笔记」，统计与设置退到右侧图标；
 *   搜索与导入从浮层改成整页。
 *
 * 2026-11-08 改：子页头栏不再换形态。以前进搜索/统计/导入/设置，头栏整个
 * 换成「← 返回 + 标题」，四颗图标消失——用户的原话是「不要那种形式」。
 * 现在页签与四颗图标一直在，当前那颗就是选中态；再点一次回进来之前那页。
 *
 * 这一组断言只认结构，不认样式：样式改了不该让测试红。
 */

const counts = { books: 16, notes: 48 };

/** 取某个标记在 HTML 里的位置，用来断言顺序 */
function at(html: string, needle: string): number {
  const i = html.indexOf(needle);
  expect(i, `找不到 ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** 头栏右侧动作区那一段 HTML（页签之后） */
function actsOf(html: string): string {
  return html.slice(at(html, 'bzs-stuacts'));
}

describe('书架头栏 · 页签', () => {
  it('页签只剩书库与笔记', () => {
    expect(STUDY_TABS.map((t) => t.value)).toEqual(['library', 'notes']);
    const html = studyShell('library', '', counts);
    expect(html).toContain('data-act="study" data-p="library"');
    expect(html).toContain('data-act="study" data-p="notes"');
  });

  it('统计与设置不再占页签位置', () => {
    const html = studyShell('library', '', counts);
    const nav = html.slice(at(html, 'bzs-stunav'), at(html, 'bzs-stuacts'));
    expect(nav).not.toContain('data-p="stats"');
    expect(nav).not.toContain('data-p="settings"');
  });

  it('页签带计数：书库给本数，笔记给条数', () => {
    const html = studyShell('library', '', counts);
    expect(html).toContain('<span class="n">16</span>');
    expect(html).toContain('<span class="n">48</span>');
  });
});

describe('书架头栏 · 右侧四颗', () => {
  it('顺序是 搜索 / 统计 / 导入 / 设置', () => {
    expect(STUDY_ACTS.map((a) => a.value)).toEqual(['search', 'stats', 'import', 'settings']);
  });

  it('四颗都渲染在动作区，且顺序与定义一致', () => {
    const html = studyShell('library', '', counts);
    const acts = actsOf(html);
    const idx = ['search', 'stats', 'import', 'settings'].map((p) => at(acts, `data-p="${p}"`));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('在书库/笔记时四颗一颗都不亮', () => {
    for (const p of ['library', 'notes'] as const) {
      const acts = actsOf(studyShell(p, '', counts));
      expect(acts, p).not.toContain('class="bzs-cbtn on"');
      expect(acts, p).not.toContain('aria-pressed="true"');
    }
  });

  /* 2026-11-08：头栏不再挂第五颗「分类」。分类管理挪进书卡菜单的
     「归入分类…」下一层，头栏回到定稿的四颗。 */
  it('头栏只有四颗：没有分类管理那颗第五图标', () => {
    const html = studyShell('library', '', counts);
    expect(html).not.toContain('data-act="shelfmanage"');
    const acts = actsOf(html);
    expect((acts.match(/data-act="study"/g) ?? []).length).toBe(4);
  });
});

describe('书架整页 · 子页头栏', () => {
  it('子页不再有返回键：页签栏与四颗图标一直在', () => {
    for (const p of ['search', 'import', 'stats', 'settings'] as const) {
      const html = studyShell(p, '', counts);
      expect(html, p).not.toContain('data-act="studyback"');
      expect(html, p).toContain('bzs-stunav');
      expect(html, p).toContain('bzs-stuacts');
    }
  });

  it('当前子页那颗是亮的，另外三颗不亮', () => {
    for (const p of ['search', 'stats', 'import', 'settings'] as const) {
      const acts = actsOf(studyShell(p, '', counts));
      expect((acts.match(/class="bzs-cbtn on"/g) ?? []).length, p).toBe(1);
      expect(acts, p).toContain(`class="bzs-cbtn on" data-act="study" data-p="${p}"`);
      expect(acts, p).toContain('aria-pressed="true"');
    }
  });

  it('子页时两个页签都不亮（确实不在那两页上）', () => {
    const html = studyShell('stats', '', counts);
    const nav = html.slice(at(html, 'bzs-stunav'), at(html, 'bzs-stuacts'));
    expect(nav).not.toContain('class="on"');
    expect(nav).not.toContain('aria-selected="true"');
  });

  it('子页正文原样落在 body 容器里', () => {
    const html = studyShell('search', '<div id="hits"></div>', counts);
    expect(html).toContain('<div id="hits"></div>');
  });
});

describe('头栏入口 · 点一下去哪一页', () => {
  it('页签页永远去自己那页', () => {
    expect(nextStudyPage('library', 'notes', 'library')).toBe('notes');
    expect(nextStudyPage('notes', 'library', 'notes')).toBe('library');
    expect(nextStudyPage('library', 'library', 'library')).toBe('library');
  });

  it('子页图标点一次进去，再点一次回进来之前那页', () => {
    expect(nextStudyPage('library', 'stats', 'library')).toBe('stats');
    expect(nextStudyPage('stats', 'stats', 'notes')).toBe('notes');
  });

  it('子页之间直接切换，返回目标不动', () => {
    expect(nextStudyPage('stats', 'settings', 'notes')).toBe('settings');
    expect(nextStudyPage('search', 'import', 'library')).toBe('import');
  });
});
