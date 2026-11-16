import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DELETE_ITEM,
  KB_ITEMS,
  MARK_ACTS,
  MORE_ACT,
  REGION_ACTS,
  SELECTION_ACTS,
  TOOLBAR_ITEMS,
  isRegionLocator,
  moreMenuOpensUp,
  onlyForRegion,
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

describe('toolbarLayout · 入口门禁', () => {
  it('没装 bz Review（review=false）时没有「复习」这一颗', () => {
    const l = toolbarLayout({ marked: false, review: false });
    expect(l.visible.map((i) => i.act)).not.toContain('review');
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', 'AI', '双链', '复制']);
  });
  it('装了（review=true）时「复习」紧跟书摘', () => {
    const l = toolbarLayout({ marked: false, review: true });
    expect(l.visible.map((i) => i.act)).toContain('review');
  });
});

describe('toolbarLayout · 两种排布', () => {
  it('桌面：六颗全摊开，没有 ⋯', () => {
    const l = toolbarLayout({ marked: false });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习', 'AI', '双链', '复制']);
    expect(l.overflow).toEqual([]);
  });

  it('桌面 + 已有划线：删除排在最后', () => {
    const l = toolbarLayout({ marked: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习', 'AI', '双链', '复制', '删除']);
    expect(l.visible.at(-1)).toBe(DELETE_ITEM);
  });

  it('手机：主路径三颗，其余收进 ⋯', () => {
    const l = toolbarLayout({ marked: false, compact: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['AI', '双链', '复制']);
  });

  it('手机 + 已有划线：删除也收进 ⋯，不占主路径', () => {
    const l = toolbarLayout({ marked: true, compact: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['AI', '双链', '复制', '删除']);
  });

  it('手机没有划线：⋯ 里没有删除', () => {
    expect(toolbarLayout({ marked: false, compact: true }).overflow.some((i) => i.act === 'del')).toBe(false);
  });

  /* 扫描页框选（2026-11-15 定稿）：矩形能划线（色点）、写想法、复制双链、认字。
     书摘 / AI / 存为名词 / 存为段落都要原文，框里没有 —— 一颗都不出现。
     识别仍排第一：认完整页，之后就能像文字版一样划词。 */
  it('PDF 框选：识别 + 想法 + 双链 + 色点，没有书摘 / AI / 名词 / 段落', () => {
    const only = ['ocr', 'idea', 'bilink'] as const;
    const l = toolbarLayout({ marked: false, only });
    expect(l.visible.map((i) => i.act)).toEqual(['ocr', 'idea', 'bilink']);
    const html = toolbarHtml({ marked: false, only, acts: SELECTION_ACTS });
    expect([...html.matchAll(/data-act="(sel(?!pen)\w*)"/g)].map((m) => m[1])).toEqual([
      'selocr',
      'selidea',
      'selbilink',
    ]);
    /* 色点要露出来：矩形的颜色就从这四个点改 */
    expect(html).toContain('data-act="selpen"');
    expect(html).not.toContain('data-act="selquote"');
    expect(html).not.toContain('data-act="selai"');
    expect(html).not.toContain('data-act="selterm"');
    expect(html).not.toContain('data-act="selpassage"');
    expect(html).not.toContain('data-act="selcopy"');
  });

  /* 已划好的框选：同一套再多一颗删除。删除是 marked 才有的动作，`only`
     里不写它就会被一起过滤掉——这条防的是「点开矩形没有删除」。 */
  it('已划好的框选：识别 + 想法 + 双链 + 删除，别的一颗不多', () => {
    const only = ['ocr', 'idea', 'bilink', 'del'] as const;
    const html = toolbarHtml({ marked: true, only, acts: MARK_ACTS });
    for (const act of ['hlocr', 'hlidea', 'copylink', 'hldel']) expect(html, act).toContain(`data-act="${act}"`);
    for (const act of ['hlquote', 'hlai', 'hlterm', 'hlpassage', 'hlcopy']) {
      expect(html, act).not.toContain(`data-act="${act}"`);
    }
  });

  it('普通划词条里不出现「识别」：有字的页不需要它', () => {
    expect(toolbarHtml({ marked: false, acts: SELECTION_ACTS })).not.toContain('data-act="selocr"');
    expect(toolbarHtml({ marked: true, acts: MARK_ACTS })).not.toContain('data-act="selocr"');
  });

  /* 判断只认定位串里的 `/r=`（框选矩形）。普通划线不管在 EPUB 还是文字版
     PDF 上，工具条一个字都不少——2026-11-15 用户要求「只在扫描版 PDF 上缩减」，
     落到代码就是「只收窄区域框」，不是按书类型砍。 */
  it('onlyForRegion：区域框收窄，普通划线返回 undefined', () => {
    expect(onlyForRegion('pdf/3/r=0.1,0.2,0.3,0.4')).toEqual(REGION_ACTS);
    expect(onlyForRegion('pdf/3/12-40')).toBeUndefined();
    expect(onlyForRegion('epubcfi(/6/4)')).toBeUndefined();
    expect(onlyForRegion('')).toBeUndefined();
    expect(isRegionLocator('pdf/3/r=0.1,0.2,0.3,0.4')).toBe(true);
  });

  it('区域框走同一份 only：普通划线仍显示书摘 / AI / 名词 / 段落 / 复制', () => {
    const normal = toolbarHtml({ marked: true, only: onlyForRegion('pdf/3/12-40'), acts: MARK_ACTS });
    expect(normal).toContain('data-act="hlquote"');
    expect(normal).toContain('data-act="hlai"');
    const region = toolbarHtml({ marked: true, only: onlyForRegion('pdf/3/r=0.1,0.2,0.3,0.4'), acts: MARK_ACTS });
    for (const act of ['hlocr', 'hlidea', 'copylink', 'hldel']) expect(region, act).toContain(`data-act="${act}"`);
    for (const act of ['hlquote', 'hlai', 'hlterm', 'hlpassage', 'hlcopy']) {
      expect(region, act).not.toContain(`data-act="${act}"`);
    }
  });
});

describe('toolbarHtml · 同一条工具条', () => {
  it('划词与点划线：按钮与顺序完全一致，只换 data-act', () => {
    const sel = toolbarHtml({ marked: false, acts: SELECTION_ACTS });
    const mark = toolbarHtml({ marked: true, acts: MARK_ACTS });
    expect(labels(sel)).toEqual(['想法', '书摘', '复习', 'AI', '双链', '复制']);
    expect(labels(mark).slice(0, 6)).toEqual(labels(sel));
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
    expect(menuLabels(html)).toEqual(['AI', '双链', '复制', '删除']);
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
    expect(TOOLBAR_ITEMS.map((i) => i.act)).toEqual(['idea', 'quote', 'review', 'ai', 'bilink', 'copy']);
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

/**
 * AI 知识库打开之后多出来的两颗（2026-11-07）。
 *
 * 顺序定在 AI 右边：它们是「先存起来再问」的动作，比双链 / 复制更靠近 AI。
 * 收不收进「⋯」看宽度，不看平台——桌面窄到 400px 一样会挤。
 */
describe('toolbarLayout · 知识库两颗', () => {
  it('关着的时候一颗都不多（老布局原样）', () => {
    const l = toolbarLayout({ marked: false, kb: false });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习', 'AI', '双链', '复制']);
    expect(l.overflow).toEqual([]);
  });

  it('打开时排在 AI 右边，顺序固定', () => {
    const l = toolbarLayout({ marked: true, kb: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习', 'AI', '存为名词', '存为段落', '双链', '复制', '删除']);
    expect(l.overflow).toEqual([]);
  });

  it('窄窗：知识库两颗进 ⋯，主路径五颗留在胶囊上', () => {
    const l = toolbarLayout({ marked: false, kb: true, narrow: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习', 'AI', '双链', '复制']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['存为名词', '存为段落']);
  });

  it('窄窗 + 已有划线：删除留在胶囊最后，不跟着进菜单', () => {
    const l = toolbarLayout({ marked: true, kb: true, narrow: true });
    expect(l.visible.at(-1)).toBe(DELETE_ITEM);
    expect(l.overflow.some((i) => i.act === 'del')).toBe(false);
  });

  it('窄窗但知识库关着：没有 ⋯ 可开', () => {
    const l = toolbarLayout({ marked: false, kb: false, narrow: true });
    expect(l.overflow).toEqual([]);
  });

  it('手机：三颗主路径，知识库两颗与双链 / 复制一起进 ⋯', () => {
    const l = toolbarLayout({ marked: false, kb: true, compact: true });
    expect(l.visible.map((i) => t(i.key))).toEqual(['想法', '书摘', '复习']);
    expect(l.overflow.map((i) => t(i.key))).toEqual(['AI', '存为名词', '存为段落', '双链', '复制']);
  });
});

describe('toolbarHtml · 知识库两颗的 data-act', () => {
  it('划词给 selterm / selpassage，点划线给 hlterm / hlpassage', () => {
    const sel = toolbarHtml({ marked: false, kb: true, acts: SELECTION_ACTS });
    expect(sel).toContain('data-act="selterm"');
    expect(sel).toContain('data-act="selpassage"');
    const mark = toolbarHtml({ marked: true, kb: true, acts: MARK_ACTS });
    expect(mark).toContain('data-act="hlterm"');
    expect(mark).toContain('data-act="hlpassage"');
  });

  it('窄窗里两颗在「⋯」菜单中，胶囊上没有', () => {
    const html = toolbarHtml({ marked: false, kb: true, narrow: true, acts: SELECTION_ACTS });
    expect(menuLabels(html)).toEqual(['存为名词', '存为段落']);
    expect(labels(html)).not.toContain('存为名词');
  });
});

/**
 * 已经存过的两颗：**文案变成「看名词 / 看段落」，动作名不变**。
 *
 * 动作名不变是刻意的：同一个 data-act 在动作表里自己判断「存过就打开、没存过就录入」，
 * 这样旧 DOM、旧点击路径都不需要重学一遍；按钮上换的只是字。
 */
describe('toolbarHtml · 存过之后变「看」', () => {
  it('存过名词：那颗写「看名词」，另一颗照旧', () => {
    const html = toolbarHtml({ marked: true, kb: true, acts: MARK_ACTS, kbDone: { term: true } });
    expect(labels(html)).toContain('看名词');
    expect(labels(html)).toContain('存为段落');
    expect(html).toContain('data-act="hlterm"');
  });

  it('存过段落：那颗写「看段落」', () => {
    const html = toolbarHtml({ marked: true, kb: true, acts: MARK_ACTS, kbDone: { passage: true } });
    expect(labels(html)).toContain('看段落');
    expect(labels(html)).toContain('存为名词');
    expect(html).toContain('data-act="hlpassage"');
  });

  it('两颗都存过：两颗都变「看」', () => {
    const html = toolbarHtml({ marked: true, kb: true, acts: MARK_ACTS, kbDone: { term: true, passage: true } });
    expect(labels(html)).toContain('看名词');
    expect(labels(html)).toContain('看段落');
    expect(labels(html)).not.toContain('存为名词');
  });

  it('窄窗里进「⋯」的那两颗同样会变', () => {
    const html = toolbarHtml({
      marked: true,
      kb: true,
      narrow: true,
      acts: MARK_ACTS,
      kbDone: { term: true },
    });
    expect(menuLabels(html)).toEqual(['看名词', '存为段落']);
  });

  it('没存过时一颗都不变（老样子）', () => {
    const html = toolbarHtml({ marked: true, kb: true, acts: MARK_ACTS });
    expect(labels(html)).toContain('存为名词');
    expect(labels(html)).toContain('存为段落');
    expect(labels(html)).not.toContain('看名词');
  });
});

/**
 * 图标模式：一颗按钮只剩一枚宿主自带图标，文字挪进 title / aria-label。
 *
 * 图标只换「长什么样」，不换 data-act、不换顺序——两端仍是同一条工具条。
 * 「⋯」菜单里的项保持文字：菜单里空间够，文字比图标好认。
 */
const iconNames = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*class="bzs-sbtn[^"]*"[^>]*>\s*<span[^>]*data-icon="([^"]+)"/g)].map((m) => m[1]);

describe('toolbarHtml · 图标模式', () => {
  it('每颗主路径都有图标，且没有可见文字', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS, icon: true });
    expect(iconNames(html)).toEqual(['lightbulb', 'quote', 'layers', 'sparkles', 'link-2', 'copy', 'trash-2']);
    expect(labels(html)).toEqual([]);
  });

  it('文案进 title 与 aria-label（纯图标也得说清是什么）', () => {
    const html = toolbarHtml({ marked: false, acts: SELECTION_ACTS, icon: true });
    for (const word of ['想法', '书摘', '复习', 'AI', '双链', '复制']) {
      expect(html, word).toContain(`title="${word}"`);
      expect(html, word).toContain(`aria-label="${word}"`);
    }
  });

  it('知识库两颗也有自己的图标', () => {
    const html = toolbarHtml({ marked: false, kb: true, acts: SELECTION_ACTS, icon: true });
    expect(iconNames(html)).toContain('book-type');
    expect(iconNames(html)).toContain('align-left');
  });

  it('「⋯」换成横排三点图标，菜单项仍是文字', () => {
    const html = toolbarHtml({ marked: true, compact: true, acts: MARK_ACTS, icon: true });
    expect(html).toContain('data-icon="more-horizontal"');
    expect(menuLabels(html)).toEqual(['AI', '双链', '复制', '删除']);
  });

  it('动作名一个都不变（图标只是外壳）', () => {
    const text = toolbarHtml({ marked: true, acts: MARK_ACTS });
    const icon = toolbarHtml({ marked: true, acts: MARK_ACTS, icon: true });
    const acts = (h: string): string[] => [...h.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
    expect(acts(icon)).toEqual(acts(text));
  });

  it('文字模式保持原样：没有图标 span', () => {
    const html = toolbarHtml({ marked: true, acts: MARK_ACTS });
    expect(html).not.toContain('data-icon=');
    expect(labels(html)).toContain('想法');
  });

  it('按钮表里每一项都带图标名（加新按钮时漏了会红）', () => {
    for (const item of [...TOOLBAR_ITEMS, ...KB_ITEMS]) {
      expect(item.icon, item.act).toBeTruthy();
    }
    expect(DELETE_ITEM.icon).toBeTruthy();
  });
});

