import { describe, expect, it } from 'vitest';
import {
  DELETE_ITEM,
  MARK_ACTS,
  SELECTION_ACTS,
  TOOLBAR_ITEMS,
  toolbarHtml,
  toolbarLayout,
} from '../src/shell/text-toolbar';

/**
 * 划词工具条（S11 定稿）：**划词与点划线是同一枚**。
 *
 * 两端只差排布：桌面全平铺，手机留三颗主路径、其余进「⋯」。
 * 按钮顺序是定稿的一部分：想法 → 书摘 → AI → 双链 → 复制 → 删除。
 * 删除只在已有划线时出现，且永远是最后一颗、唯一带 danger 的一颗。
 */
const labels = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*class="bzs-sbtn[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
const menuLabels = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*class="bzs-tb-mi[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('toolbarLayout · 两种排布', () => {
  it('桌面：五颗全摊开，没有 ⋯', () => {
    const l = toolbarLayout({ marked: false });
    expect(l.visible.map((i) => i.label)).toEqual(['想法', '书摘', 'AI', '双链', '复制']);
    expect(l.overflow).toEqual([]);
  });

  it('桌面 + 已有划线：删除排在最后', () => {
    const l = toolbarLayout({ marked: true });
    expect(l.visible.map((i) => i.label)).toEqual(['想法', '书摘', 'AI', '双链', '复制', '删除']);
    expect(l.visible.at(-1)).toBe(DELETE_ITEM);
  });

  it('手机：主路径三颗，其余收进 ⋯', () => {
    const l = toolbarLayout({ marked: false, compact: true });
    expect(l.visible.map((i) => i.label)).toEqual(['想法', '书摘', 'AI']);
    expect(l.overflow.map((i) => i.label)).toEqual(['双链', '复制']);
  });

  it('手机 + 已有划线：删除也收进 ⋯，不占主路径', () => {
    const l = toolbarLayout({ marked: true, compact: true });
    expect(l.visible.map((i) => i.label)).toEqual(['想法', '书摘', 'AI']);
    expect(l.overflow.map((i) => i.label)).toEqual(['双链', '复制', '删除']);
  });

  it('手机没有划线：⋯ 里没有删除', () => {
    expect(toolbarLayout({ marked: false, compact: true }).overflow.some((i) => i.act === 'del')).toBe(false);
  });
});

describe('toolbarHtml · 同一条工具条', () => {
  it('划词与点划线：按钮与顺序完全一致，只换 data-act', () => {
    const sel = toolbarHtml({ marked: false, acts: SELECTION_ACTS });
    const mark = toolbarHtml({ marked: true, acts: MARK_ACTS });
    expect(labels(sel)).toEqual(['想法', '书摘', 'AI', '双链', '复制']);
    expect(labels(mark).slice(0, 5)).toEqual(labels(sel));
    expect(labels(mark).at(-1)).toBe('删除');
    expect(sel).toContain('data-act="selidea"');
    expect(mark).toContain('data-act="hlidea"');
    expect(mark).toContain('data-act="hldel"');
  });

  it('色点按当前笔色加圈；没有划线时一颗都不亮', () => {
    const off = toolbarHtml({ marked: false });
    const on = toolbarHtml({ marked: true, color: 'green' });
    expect(off).not.toContain('bzs-pendot on');
    expect(on.match(/bzs-pendot on/g)?.length).toBe(1);
    expect(on).toMatch(/class="bzs-pendot on"[^>]*data-v="green"/);
  });

  it('想法是主色，删除是 danger', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS });
    expect(html).toContain('class="bzs-sbtn pri" data-act="hlidea"');
    expect(html).toContain('class="bzs-sbtn danger" data-act="hldel"');
  });

  it('手机：⋯ 常驻，菜单里是双链 / 复制 / 删除', () => {
    const html = toolbarHtml({ marked: true, compact: true, acts: MARK_ACTS });
    expect(html).toContain('data-act="more"');
    expect(menuLabels(html)).toEqual(['双链', '复制', '删除']);
    expect(html).toContain('data-act="copylink"');
  });

  it('桌面：不出现 ⋯', () => {
    expect(toolbarHtml({ marked: true })).not.toContain('data-act="more"');
  });

  it('当前打开的面板亮起', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS, active: 'quote' });
    expect(html).toMatch(/class="bzs-sbtn on" data-act="hlquote"/);
  });

  it('data-* 属性挂到每颗按钮上（点划线要带 id 与书）', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS, attrs: 'data-id="m1" data-book="b1"' });
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b).toContain('data-id="m1"');
      expect(b).toContain('data-book="b1"');
    }
  });

  it('不含原文 / 章节 / 输入框：工具条就是工具条', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS });
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('bzs-qcard');
    expect(html).not.toContain('换一支笔');
  });

  it('按钮表只有一份，两端共用', () => {
    expect(TOOLBAR_ITEMS.map((i) => i.act)).toEqual(['idea', 'quote', 'ai', 'bilink', 'copy']);
  });
});
