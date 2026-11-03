import { describe, expect, it } from 'vitest';
import { studyShell, STUDY_ACTS, STUDY_TABS } from '../src/shell/render/study';

/**
 * 书架头栏定稿（docs/ui-spec.md · S1）：
 *   页签只留「书库 / 笔记」，统计与设置退到右侧图标；
 *   搜索与导入从浮层改成整页，头栏换成「← 返回 + 标题」。
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
    const acts = html.slice(at(html, 'bzs-stuacts'));
    const idx = ['search', 'stats', 'import', 'settings'].map((p) => at(acts, `data-p="${p}"`));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

describe('书架整页 · 子页头栏', () => {
  it('搜索是整页：有返回键和标题，不再有页签栏', () => {
    const html = studyShell('search', '<div id="hits"></div>', counts);
    expect(html).toContain('data-act="studyback"');
    expect(html).toContain('搜索');
    expect(html).not.toContain('bzs-stunav');
  });

  it('导入也是整页', () => {
    const html = studyShell('import', '<div class="bzs-import-host"></div>', counts);
    expect(html).toContain('data-act="studyback"');
    expect(html).toContain('导入书籍');
    expect(html).not.toContain('bzs-stunav');
  });

  it('统计与设置从图标进来，同样是整页', () => {
    for (const p of ['stats', 'settings'] as const) {
      const html = studyShell(p, '', counts);
      expect(html).toContain('data-act="studyback"');
      expect(html).not.toContain('bzs-stunav');
    }
  });

  it('子页正文原样落在 body 容器里', () => {
    const html = studyShell('search', '<div id="hits"></div>', counts);
    expect(html).toContain('<div id="hits"></div>');
  });
});
