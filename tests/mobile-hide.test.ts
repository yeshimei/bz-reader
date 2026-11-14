import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView } from './helpers/plugin-harness';

/**
 * 手机上不提供的功能（2026-11-11）：
 *   · 并排对照 —— 屏幕一分为二，每边不到 200px，副卷还没有划词工具条；
 *   · 对照书籍 —— 只服务并排，并排没了它没有去处；
 *   · 朗读 —— 手机浏览器内核没有稳定的语音合成通道，真机上按了不出声；
 *   · 版式里的「栏数」—— 引擎的竖屏规则写死单栏，选双栏等于没选；
 *   · 设置页「快捷键」组 —— 点一行打开的是桌面的快捷键面板，手机没有这一页。
 *
 * 这里钉住的是**入口不出现**：不是把功能删掉，桌面端行为一字不动。
 */

const { flags } = vi.hoisted(() => ({ flags: { mobile: false, shell: false } }));

vi.mock('../src/core/mobile', () => ({
  isMobileEnv: () => flags.mobile,
  /* 「手机形态」：真机恒等于 mobile，桌面开 force-mobile 时只 shell 为真 */
  isMobileShell: () => flags.mobile || flags.shell,
  isIosEnv: () => false,
  LIBRARY_WIDE: 1000,
  isCompactLibrary: () => false,
}));

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { COMMANDS } from '../src/plugin-commands';
import { typographyFormHtml } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import {
  availableActions,
  headerActionsFor,
  headerOverflowFor,
  MOBILE_HIDDEN_ACTIONS,
} from '../src/view/header-actions';
let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
  flags.mobile = false;
  flags.shell = false;
  vi.restoreAllMocks();
});

const settingsHtml = (mobile: boolean): string =>
  viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '1.1.1',
    mobile,
  });

describe('动作清单：手机上去掉两项', () => {
  it('清单只含并排对照、对照书籍（朗读已放开）', () => {
    expect([...MOBILE_HIDDEN_ACTIONS].sort()).toEqual(['para', 'paraBook']);
  });

  it('availableActions：手机少两项，朗读与桌面一样在', () => {
    const phone = availableActions(true);
    expect(phone).not.toContain('para');
    expect(phone).not.toContain('paraBook');
    expect(phone).toContain('tts');

    const desk = availableActions(false);
    expect(desk).toContain('para');
    expect(desk).toContain('paraBook');
    expect(desk).toContain('tts');
  });

  it('头栏：手机露出前三颗，折进 ⋮ 的也不含这两项', () => {
    const shown = headerActionsFor(true);
    const overflow = headerOverflowFor(true);
    for (const id of MOBILE_HIDDEN_ACTIONS) {
      expect(shown, id).not.toContain(id);
      expect(overflow, id).not.toContain(id);
    }
    /* 名额让给还能用的：目录 / 搜索 / 书签之后直接是排版 */
    expect(overflow[0]).toBe('type');
  });

  it('用户自己排过序、把并排放到第一位：手机上仍然不出现', () => {
    const cfg = { order: ['para', 'tts', 'paraBook', 'mark'], hidden: [] };
    const shown = headerActionsFor(true, cfg);
    const overflow = headerOverflowFor(true, cfg);
    for (const id of MOBILE_HIDDEN_ACTIONS) {
      expect(shown, id).not.toContain(id);
      expect(overflow, id).not.toContain(id);
    }
  });

  it('桌面端：默认清单与顺序原样', () => {
    expect(headerActionsFor(false)).toEqual([
      'toc',
      'search',
      'mark',
      'type',
      'history',
      'para',
      'paraBook',
      'tts',
      'bookmap',
      'guide',
      'immersive',
      'library',
    ]);
  });
});

describe('阅读页 ⋮ 菜单：手机上也不出现', () => {
  /** 菜单替身：只记标题，够判断「有没有这一项」 */
  function menuTitles(view: unknown): string[] {
    const titles: string[] = [];
    const item = {
      setTitle(t?: string): unknown {
        if (t) titles.push(t);
        return item;
      },
      setIcon: () => item,
      setChecked: () => item,
      setDisabled: () => item,
      onClick: () => item,
    };
    const menu = {
      addItem(fn: (i: typeof item) => void): unknown {
        fn(item);
        return menu;
      },
      addSeparator: () => menu,
      showAtPosition: () => menu,
    };
    (view as { onPaneMenu(menu: unknown, source: string): void }).onPaneMenu(menu, '');
    return titles;
  }

  it('手机上菜单里没有并排 / 对照书籍，朗读还在', () => {
    flags.mobile = true;
    const app = makeApp();
    const { view } = makeReaderView(app);
    (view as unknown as { book: unknown }).book = {
      id: 'b1',
      meta: { title: '书' },
      reading: { position: {} },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
    };
    (view as unknown as { host: unknown }).host = { isPdf: false, pdfUi: null };

    const titles = menuTitles(view);
    expect(titles.length).toBeGreaterThan(0);
    for (const banned of ['并排对照', '对照书籍：未选']) {
      expect(titles, banned).not.toContain(banned);
    }
    /* 朗读 2026-11-13 起手机也有：换成音频播放，不再依赖系统语音内核 */
    expect(titles).toContain('朗读（r）');
    expect(titles).toContain('目录（s）');
  });

  it('桌面上两项还在', () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    (view as unknown as { book: unknown }).book = {
      id: 'b1',
      meta: { title: '书' },
      reading: { position: {} },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
    };
    (view as unknown as { host: unknown }).host = { isPdf: false, pdfUi: null };

    const titles = menuTitles(view);
    expect(titles).toContain('并排对照');
    expect(titles).toContain('朗读（r）');
  });
});

describe('排版浮层：手机上不出现「栏数」', () => {
  it('手机：没有分栏这一行', () => {
    const html = typographyFormHtml(true);
    expect(html).not.toContain('栏数');
    expect(html).not.toContain('data-k="columns"');
    /* 别的照样在：字号 / 行距 / 边距 / 方向 / 翻页 */
    expect(html).toContain('data-k="fontSize"');
    expect(html).toContain('data-k="layout"');
    expect(html).toContain('data-k="flow"');
  });

  it('桌面：分栏还在', () => {
    const html = typographyFormHtml(false);
    expect(html).toContain('栏数');
    expect(html).toContain('data-k="columns"');
  });
});

describe('设置页：手机上只收快捷键', () => {
  it('手机：没有快捷键组；朗读组照常给（手机也听书）', () => {
    const html = settingsHtml(true);
    expect(html).not.toContain('data-act="hotkey"');
    expect(html).toContain('data-k="ttsRate"');
    expect(html).toContain('data-k="ttsFollow"');
    /* 2026-11-14 二轮：引擎从 seg 换成三张卡，手机上照样给（本地可填局域网地址） */
    expect(html).toContain('data-act="ttsengine"');
    expect(html).toContain('data-v="local"');
    expect(html).not.toContain('data-k="columns"');
  });

  it('手机：别的组照旧（版式、外观、PDF、标注、数据、AI、授权）', () => {
    const html = settingsHtml(true);
    expect(html).toContain('data-k="fontSize"');
    expect(html).toContain('data-k="lineHeight"');
    expect(html).toContain('data-k="pdfFlow"');
    expect(html).toContain('data-k="exportComments"');
    expect(html).toContain('data-act="backup"');
    expect(html).toContain('data-role="license"');
  });

  it('手机：「阅读页图标」里只省略并排两项', () => {
    const html = settingsHtml(true);
    for (const id of MOBILE_HIDDEN_ACTIONS) {
      expect(html, id).not.toContain(`data-act="headermove" data-k="${id}"`);
      expect(html, id).not.toContain(`data-act="headertoggle" data-k="${id}"`);
    }
    expect(html).toContain('data-act="headermove" data-k="toc"');
    expect(html).toContain('data-act="headermove" data-k="tts"');
  });

  it('桌面：朗读、分栏、快捷键都还在', () => {
    const html = settingsHtml(false);
    /* hotkeys 传的是空数组，所以按键行本身不渲染；组标题在就说明整组还在 */
    expect(html).toContain('<h3>快捷键</h3>');
    expect(html).toContain('data-k="ttsRate"');
    expect(html).toContain('data-k="columns"');
    expect(html).toContain('data-act="headermove" data-k="para"');
  });
});

describe('命令面板：手机上朗读命令也注册', () => {
  it('朗读命令不再标「手机不提供」，也没有别的命令被误标', () => {
    const tts = COMMANDS.find((c) => c.id === 'tts');
    expect(tts?.mobileDisabled).toBeUndefined();
    expect(COMMANDS.filter((c) => c.mobileDisabled).map((c) => c.id)).toEqual([]);
  });
});

/**
 * 手机形态 ≠ 真实设备（2026-11-11）。
 *
 * 桌面开 force-mobile 验收手机布局时，`isMobileEnv()` 仍是 false、
 * `isMobileShell()` 为 true。上一版拿真实设备判，结果「隐藏生没生效」
 * 只能在真机上看，一轮几分钟——现在入口可见性统一看手机形态。
 * 露几颗仍只看真实设备（开着 force-mobile 的桌面窗口放得下 12 颗，
 * 不该收成 3 颗）。
 */
describe('手机形态（桌面 force-mobile 验收）也要收起', () => {
  it('设置页：不带 mobile 参数时收起快捷键组与分栏，朗读组照常', () => {
    flags.shell = true;
    const html = viewSettings({
      prefs: DEFAULT_PREFS,
      settings: DEFAULT_SETTINGS,
      pen: 'amber',
      hotkeys: [],
      version: '1.1.1',
    });
    expect(html).toContain('data-k="ttsRate"');
    expect(html).toContain('data-k="ttsFollow"');
    expect(html).not.toContain('data-k="columns"');
    expect(html).not.toContain('<h3>快捷键</h3>');
  });

  it('排版浮层：不带 mobile 参数时按手机形态收起「栏数」', () => {
    flags.shell = true;
    expect(typographyFormHtml()).not.toContain('data-k="columns"');
  });

  it('头栏：并排与对照书籍收起，朗读保留', () => {
    flags.shell = true;
    const shown = headerActionsFor(false, null, false, true);
    expect(shown).not.toContain('para');
    expect(shown).toContain('tts');
    expect(shown).toHaveLength(10);
    /* 不传第 4 参的老调用点：仍按桌面全套走 */
    expect(headerActionsFor(false, null)).toHaveLength(12);
  });
});

/**
 * 朗读组的位置（2026-11-11 用户要求）：右列、AI 组的正上方。
 * 左列只留界面 / 版式 / 外观 / PDF。
 */
describe('朗读组排在右列 AI 之上', () => {
  it('朗读紧跟 AI 前面，且不在左列', () => {
    const out = settingsHtml(false);
    const a = out.indexOf('<div class="bzs-set-col">');
    const b = out.indexOf('<div class="bzs-set-col">', a + 1);
    const left = out.slice(a, b);
    const right = out.slice(b, out.indexOf('<h3>阅读页图标</h3>', b));
    expect(left).not.toContain('<h3>朗读</h3>');
    expect(right).toContain('<h3>朗读</h3>');
    /* 右列里朗读紧挨在 AI 之前：中间不再夹别的组 */
    const ttsAt = right.indexOf('<h3>朗读</h3>');
    const aiAt = right.indexOf('<h3>AI 助手</h3>');
    const between = right.slice(ttsAt, aiAt);
    expect(ttsAt).toBeGreaterThan(-1);
    expect(aiAt).toBeGreaterThan(ttsAt);
    expect(between.match(/<h3>/g) ?? []).toHaveLength(1);
  });
});
