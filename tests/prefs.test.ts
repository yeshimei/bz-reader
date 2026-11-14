import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  FONT_FAMILIES,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  LEGACY_THEMES,
  fontLabel,
  gatedPrefs,
  normalizePrefs,
  pickPrefs,
} from '../src/data/prefs';

describe('normalizePrefs', () => {
  it('空输入给出默认值', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it('字号被夹在合法区间并取整', () => {
    expect(normalizePrefs({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_RANGE.max);
    expect(normalizePrefs({ fontSize: -5 }).fontSize).toBe(FONT_SIZE_RANGE.min);
    expect(normalizePrefs({ fontSize: 18.7 }).fontSize).toBe(19);
  });

  it('行高与页边距同样被夹住', () => {
    expect(normalizePrefs({ lineHeight: 0 }).lineHeight).toBe(LINE_HEIGHT_RANGE.min);
    expect(normalizePrefs({ lineHeight: 9 }).lineHeight).toBe(LINE_HEIGHT_RANGE.max);
    expect(normalizePrefs({ margin: 1 }).margin).toBe(MARGIN_RANGE.min);
    expect(normalizePrefs({ margin: 999 }).margin).toBe(MARGIN_RANGE.max);
  });

  it('枚举值非法时回落到默认值', () => {
    const p = normalizePrefs({ accent: 'rainbow', fontFamily: 'comic', layout: 'diagonal' });
    expect(p.accent).toBe(DEFAULT_PREFS.accent);
    expect(p.fontFamily).toBe(DEFAULT_PREFS.fontFamily);
    expect(p.layout).toBe(DEFAULT_PREFS.layout);
  });

  it('旧主题名（已撤掉的五套皮肤）不会被当成脏数据', () => {
    /* ReaderPrefs 已经没有 theme 字段了，所谓迁移其实是「不认识的值一律回落到
       默认」。这里断言真实行为：带旧 theme 的旧配置仍能正常归一化，其余字段不丢。 */
    for (const legacy of LEGACY_THEMES) {
      const p = normalizePrefs({ theme: legacy, fontSize: 22 } as unknown as Record<string, unknown>);
      expect(p.fontSize).toBe(22);
      expect(p.accent).toBe(DEFAULT_PREFS.accent);
      expect(Object.keys(p)).not.toContain('theme');
    }
  });

  it('不修改传入对象', () => {
    const raw = { fontSize: 20 };
    const before = JSON.stringify(raw);
    normalizePrefs(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('翻页 / 滚动模式：只认 paged / scroll，其它退回分页', () => {
    expect(DEFAULT_PREFS.flow).toBe('paged');
    expect(normalizePrefs({ flow: 'scroll' }).flow).toBe('scroll');
    expect(normalizePrefs({ flow: 'paged' }).flow).toBe('paged');
    expect(normalizePrefs({ flow: 'nope' }).flow).toBe('paged');
  });

  it('阅读页页码：默认全书，只认 off / chapter / book', () => {
    expect(DEFAULT_PREFS.pageLabel).toBe('book');
    expect(normalizePrefs({ pageLabel: 'chapter' }).pageLabel).toBe('chapter');
    expect(normalizePrefs({ pageLabel: 'book' }).pageLabel).toBe('book');
    expect(normalizePrefs({ pageLabel: 'off' }).pageLabel).toBe('off');
    expect(normalizePrefs({ pageLabel: 'nope' }).pageLabel).toBe('book');
    /* 老数据没有这一项：跟默认走（全书） */
    expect(normalizePrefs({ fontSize: 20 }).pageLabel).toBe('book');
  });

  it('章节名开关：默认开，老数据也开，只有明确写 false 才关', () => {
    expect(DEFAULT_PREFS.chapterLabel).toBe(true);
    expect(normalizePrefs({}).chapterLabel).toBe(true);
    expect(normalizePrefs({ fontSize: 20 }).chapterLabel).toBe(true);
    expect(normalizePrefs({ chapterLabel: false }).chapterLabel).toBe(false);
    expect(normalizePrefs({ chapterLabel: true }).chapterLabel).toBe(true);
  });
});

/**
 * 正文口径（2026-11-11 改）：字号 26px / 行高 1.7 / 页边距 8（下限）。
 * 行高这条踩过：按 0.1 取整会把非整档值抹平，界面上永远显示不出定稿值。
 */
describe('正文口径', () => {
  it('默认字号 26px、行高 1.7、页边距 8', () => {
    expect(DEFAULT_PREFS.fontSize).toBe(26);
    expect(DEFAULT_PREFS.lineHeight).toBe(1.7);
    expect(DEFAULT_PREFS.margin).toBe(MARGIN_RANGE.min);
  });

  it('默认值都落在滑块的 min/max/step 线上', () => {
    /* 默认值掉出范围时 normalizePrefs 会把它夹成边界值，
       界面上看见的默认值就不是代码里写的那一个。 */
    const onGrid = (v: number, r: { min: number; max: number; step: number }): boolean =>
      v >= r.min && v <= r.max && Math.abs(Math.round((v - r.min) / r.step) * r.step + r.min - v) < 1e-9;
    expect(onGrid(DEFAULT_PREFS.fontSize, FONT_SIZE_RANGE)).toBe(true);
    expect(onGrid(DEFAULT_PREFS.lineHeight, LINE_HEIGHT_RANGE)).toBe(true);
    expect(onGrid(DEFAULT_PREFS.margin, MARGIN_RANGE)).toBe(true);
  });

  it('1.7 存取一个来回不被改掉', () => {
    expect(normalizePrefs({ lineHeight: 1.7 }).lineHeight).toBe(1.7);
  });

  it('行高按 0.05 取整（滑块步长同档）', () => {
    expect(LINE_HEIGHT_RANGE.step).toBe(0.05);
    expect(normalizePrefs({ lineHeight: 1.97 }).lineHeight).toBe(1.95);
    expect(normalizePrefs({ lineHeight: 1.98 }).lineHeight).toBe(2);
  });

  it('字体档名：跟随书籍 / 宋体 / 黑体（走集中表，随界面语言取）', () => {
    expect(FONT_FAMILIES.map((f) => fontLabel(f.value))).toEqual(['跟随书籍', '宋体', '黑体']);
  });
});

/**
 * 竖排仍是高级能力：到期（或从未解锁）后必须落回横排。
 * 双栏已下放基础版（2026-11-05），不再跟着门控。
 * 只门控「实际生效的排版」，不改用户存下来的偏好——续费/重新激活后原选择自动回来。
 */
describe('gatedPrefs', () => {
  const fancy = normalizePrefs({ layout: 'vertical', columns: 2 });

  it('未解锁：竖排落回横排；双栏保留（基础版也能双栏）', () => {
    const p = gatedPrefs(fancy, false);
    expect(p.layout).toBe('horizontal');
    expect(p.columns).toBe(2);
  });

  it('已解锁：原样保留', () => {
    expect(gatedPrefs(fancy, true)).toEqual(fancy);
  });

  it('不改传入对象（到期后用户存的选择还在）', () => {
    const before = JSON.stringify(fancy);
    gatedPrefs(fancy, false);
    expect(JSON.stringify(fancy)).toBe(before);
  });
});

/** 桌面与移动各读各的槽；老数据只有一份全局 prefs 时两边都拿它当初始值。 */
describe('pickPrefs · 平台分槽', () => {
  it('桌面读 prefsDesktop、手机读 prefsMobile', () => {
    const data = { prefsDesktop: { fontSize: 18 }, prefsMobile: { fontSize: 24 } };
    expect(pickPrefs(data, false).fontSize).toBe(18);
    expect(pickPrefs(data, true).fontSize).toBe(24);
  });

  it('本平台还没写过：退回老的全局 prefs', () => {
    const data = { prefs: { fontSize: 22 } };
    expect(pickPrefs(data, false).fontSize).toBe(22);
    expect(pickPrefs(data, true).fontSize).toBe(22);
  });
});

/**
 * 「上下边距」这一档已经撤掉：上下留白回到写死值（见 theme.ts）。
 *
 * 老数据里可能还留着 marginY，读进来必须被丢掉——留着它等于留一个
 * 永远不会生效的字段，下次有人看见又会以为能调。
 */
describe('上下边距已撤档', () => {
  it('默认偏好里没有 marginY', () => {
    expect(DEFAULT_PREFS).not.toHaveProperty('marginY');
  });

  it('老数据带 marginY：归一化后丢掉，其余字段不受影响', () => {
    const p = normalizePrefs({ marginY: 64, fontSize: 20 });
    expect(p).not.toHaveProperty('marginY');
    expect(p.fontSize).toBe(20);
  });
});

/**
 * 工具条样式（2026-11-08）：文字 / 图标二选一。
 *
 * 默认**文字**：老用户升级后界面不该变样。图标模式是为了窄屏省地方，
 * 认不出来的按钮靠 title / aria-label 补话。
 */
describe('工具条样式', () => {
  it('默认是文字', () => {
    expect(DEFAULT_PREFS.toolbarStyle).toBe('text');
    expect(normalizePrefs({}).toolbarStyle).toBe('text');
  });

  it('只认 text / icon，其它值退回文字', () => {
    expect(normalizePrefs({ toolbarStyle: 'icon' }).toolbarStyle).toBe('icon');
    expect(normalizePrefs({ toolbarStyle: 'text' }).toolbarStyle).toBe('text');
    expect(normalizePrefs({ toolbarStyle: 'emoji' } as unknown as Record<string, unknown>).toolbarStyle).toBe('text');
    expect(normalizePrefs({ toolbarStyle: 1 } as unknown as Record<string, unknown>).toolbarStyle).toBe('text');
  });

  it('跟库走（阅读偏好的一份），不写进本机设置', () => {
    /* 断言的是「它属于 prefs」这件事：DEFAULT_PREFS 里有它，
       而 DEFAULT_SETTINGS 不该有同名项（两处各存一份必然分叉）。 */
    expect(DEFAULT_PREFS).toHaveProperty('toolbarStyle');
  });
});

/**
 * PDF 链接别名（2026-11-09）：从 PDF++ 抄来的四档。
 *
 * 默认「原文」：粘进笔记先看见的是引的那句话，不是「第 12 页」——
 * 一句没有上下文的页码，三个月后自己都认不出来。
 */
describe('PDF 链接别名', () => {
  it('默认贴原文', () => {
    expect(DEFAULT_PREFS.pdfLinkLabel).toBe('text');
    expect(normalizePrefs({}).pdfLinkLabel).toBe('text');
  });

  it('四档各自认得出，其它值退回原文', () => {
    for (const mode of ['page', 'titlePage', 'emoji'] as const) {
      expect(normalizePrefs({ pdfLinkLabel: mode }).pdfLinkLabel).toBe(mode);
    }
    expect(normalizePrefs({ pdfLinkLabel: 'quote' } as unknown as Record<string, unknown>).pdfLinkLabel).toBe(
      'text',
    );
    expect(normalizePrefs({ pdfLinkLabel: 2 } as unknown as Record<string, unknown>).pdfLinkLabel).toBe('text');
  });
});

/**
 * 桌面端点正文翻页（2026-11-12）：默认关。
 *
 * 正文点下去第一用途是选字 / 点链接 / 落焦点，把整页卷走比「没反应」更恼人；
 * 触屏笔记本想用手指点，自己去设置里开。手机端不用这一项。
 */
describe('桌面点击翻页', () => {
  it('默认关，老数据（没有这一项）也是关', () => {
    expect(DEFAULT_PREFS.desktopTapTurn).toBe(false);
    expect(normalizePrefs({}).desktopTapTurn).toBe(false);
  });

  it('只认显式 true，脏值一律当关', () => {
    expect(normalizePrefs({ desktopTapTurn: true }).desktopTapTurn).toBe(true);
    expect(normalizePrefs({ desktopTapTurn: '1' } as unknown as Record<string, unknown>).desktopTapTurn).toBe(false);
    expect(normalizePrefs({ desktopTapTurn: 1 } as unknown as Record<string, unknown>).desktopTapTurn).toBe(false);
  });
});

/**
 * 在线语音改名（2026-11-14）：引擎从 `deepseek` 变成 `online`。
 *
 * 老数据必须原样可用：引擎名归一、选过的嗓子搬进新字段，不能升级之后
 * 让人突然听见另一个声音，或者直接「未配置」。
 */
describe('朗读引擎迁移', () => {
  it('旧值 deepseek 归一成 online，其它脏值也当 online', () => {
    expect(normalizePrefs({ ttsEngine: 'deepseek' } as unknown as Record<string, unknown>).ttsEngine).toBe('online');
    expect(normalizePrefs({ ttsEngine: 'nope' } as unknown as Record<string, unknown>).ttsEngine).toBe('online');
    expect(normalizePrefs({ ttsEngine: 'local' }).ttsEngine).toBe('local');
    expect(normalizePrefs({ ttsEngine: 'system' }).ttsEngine).toBe('system');
  });

  it('老数据选过的嗓子搬进 ttsVoiceOnline，不默默换声', () => {
    expect(normalizePrefs({ ttsVoice: 'tide' }).ttsVoiceOnline).toBe('tide');
    expect(normalizePrefs({ ttsVoice: 'stella' }).ttsVoiceOnline).toBe('stella');
  });

  it('全新安装留空：由引擎层按服务兜底，不把 stella 硬塞给别家服务', () => {
    expect(DEFAULT_PREFS.ttsVoiceOnline).toBe('');
    expect(normalizePrefs({}).ttsVoiceOnline).toBe('');
  });

  it('已经存了在线音色就听它的，去掉首尾空格', () => {
    expect(normalizePrefs({ ttsVoice: 'tide', ttsVoiceOnline: ' alice ' }).ttsVoiceOnline).toBe('alice');
  });
});
