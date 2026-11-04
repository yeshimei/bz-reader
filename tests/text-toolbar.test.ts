import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DELETE_ITEM,
  MARK_ACTS,
  MORE_ACT,
  SELECTION_ACTS,
  TOOLBAR_ITEMS,
  moreMenuOpensUp,
  planToolbarHit,
  toggleMoreMenu,
  toolbarHtml,
  toolbarLayout,
} from '../src/shell/text-toolbar';
import { installDomStub } from './helpers/dom-stub';
import { t } from '../src/i18n';

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
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', 'AI', '双链', '复制']);
    expect(l.overflow).toEqual([]);
  });

  it('桌面 + 已有划线：删除排在最后', () => {
    const l = toolbarLayout({ marked: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', 'AI', '双链', '复制', '删除']);
    expect(l.visible.at(-1)).toBe(DELETE_ITEM);
  });

  it('手机：主路径三颗，其余收进 ⋯', () => {
    const l = toolbarLayout({ marked: false, compact: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', 'AI']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['双链', '复制']);
  });

  it('手机 + 已有划线：删除也收进 ⋯，不占主路径', () => {
    const l = toolbarLayout({ marked: true, compact: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', 'AI']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['双链', '复制', '删除']);
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

/**
 * 「⋯」是这条工具条上唯一一个**不是业务动作**的按钮：它只开合自己的菜单。
 *
 * 以前浮层里的这枚按钮没有分支，点下去被当成一次普通动作派发出去、
 * 派发完再整块重画——菜单刚画出来就被新 DOM 换掉，看起来就是「闪一下，
 * 打不开」。判定必须发生在派发之前，并且明确「不重画」。
 */
describe('⋯：就地开合，不走动作分派', () => {
  it('「⋯」归为开合', () => {
    expect(planToolbarHit(MORE_ACT)).toEqual({ kind: 'more' });
  });

  it('业务按钮照旧交给动作表', () => {
    expect(planToolbarHit('hlai')).toEqual({ kind: 'act', act: 'hlai' });
    expect(planToolbarHit('selidea')).toEqual({ kind: 'act', act: 'selidea' });
  });

  it('没有 data-act 就当没点中', () => {
    expect(planToolbarHit(undefined)).toEqual({ kind: 'ignore' });
    expect(planToolbarHit('')).toEqual({ kind: 'ignore' });
  });

  it('按钮上的 data-act 与判定用的常量是同一个', () => {
    const html = toolbarHtml({ marked: true, compact: true, acts: MARK_ACTS });
    expect(html).toContain(`data-act="${MORE_ACT}"`);
  });
});

/**
 * 开合本身也得测：能开、能收。
 *
 * 收不起来比打不开更烦——菜单挂着，点哪儿都像失灵。
 */
describe('⋯ 菜单：开得开、收得起', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installDomStub();
  });
  afterAll(() => restore());

  const makeBar = (): HTMLElement => document.createElement('div') as unknown as HTMLElement;

  it('第一次点开，第二次收起', () => {
    const bar = makeBar();
    expect(toggleMoreMenu(bar, 844)).toBe(true);
    expect(bar.classList.contains('is-more')).toBe(true);
    expect(toggleMoreMenu(bar, 844)).toBe(false);
    expect(bar.classList.contains('is-more')).toBe(false);
  });

  it('收起时把「向上弹」也一起忘掉', () => {
    const bar = makeBar();
    bar.classList.add('is-more', 'is-more-up');
    expect(toggleMoreMenu(bar, 844)).toBe(false);
    expect(bar.classList.contains('is-more-up')).toBe(false);
  });

  it('拿不到工具条就当没点', () => {
    expect(toggleMoreMenu(null, 844)).toBe(false);
  });

  it('下方放得下就向下弹，贴着屏幕底就翻上去', () => {
    expect(moreMenuOpensUp(400, 96, 844)).toBe(false);
    expect(moreMenuOpensUp(760, 96, 844)).toBe(true);
  });
});
