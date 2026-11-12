import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/i18n';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { overlayUnlock } from '../src/shell/overlay';

/**
 * 解锁弹层不再有激活码入口（2026-11-12）。
 *
 * 填码的地方只有书架设置页的「授权」那一组；这张对照表是用户「刚被拦下」
 * 时看的一屏，页脚只留购买与交流群两个出口。以前桌面常驻输入框、手机
 * 收起成「已有激活码」按钮，两种形态都带着一句「购买后拿到激活码，填在
 * 下面即可」——用户看完还要在弹层里再找一遍填码的地方，不如直接引导到
 * 设置页那条唯一的正路。
 *
 * 钉住四件事：
 *   1. 桌面 / 手机 / 外语界面都不渲染输入框、激活按钮与展开入口；
 *   2. 「购买后拿到激活码」这句提示一并消失，页脚不再暗示下面有落点；
 *   3. 已激活时页脚不再推销一次购买，只留交流群；
 *   4. 弹层仍带专门的遮罩类：手机上是中上落位，不因少了输入框跌回贴底。
 */

const { ent, flags } = vi.hoisted(() => ({
  ent: { paid: false },
  flags: { mobile: false },
}));

vi.mock('../src/core/mobile', () => ({
  isMobileEnv: () => flags.mobile,
  isMobileShell: () => flags.mobile,
  isIosEnv: () => false,
  LIBRARY_WIDE: 1000,
  isCompactLibrary: () => false,
}));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    entitlement: () => ({
      tier: ent.paid ? ('paid' as const) : ('free' as const),
      unlocked: ent.paid,
      trialLeft: 0,
      trialUsed: 0,
      exp: 0,
      license: '',
      trialVoid: false,
      installId: 'test',
      days: [],
    }),
  };
});

afterEach(() => {
  ent.paid = false;
  flags.mobile = false;
  setLocale('zh');
  setState({ ...DEFAULT_SHELL_STATE });
});

function footOf(html: string): string {
  const at = html.indexOf('<div class="bzs-mfoot">');
  expect(at).toBeGreaterThan(-1);
  return html.slice(at);
}

/** 页脚里的动作名，按出现顺序 */
function footActs(html: string): string[] {
  return [...footOf(html).matchAll(/data-act="([a-z]+)"/g)].map((m) => m[1]);
}

describe('解锁弹层 · 激活码入口已移除', () => {
  it('桌面：没有输入框、激活按钮，也没有「已有激活码」', () => {
    const html = overlayUnlock();
    expect(html).not.toContain('data-role="license"');
    expect(html).not.toContain('data-act="activate"');
    expect(html).not.toContain('data-act="showcode"');
    expect(html).not.toContain('购买后拿到激活码');
  });

  it('手机：同样没有，不再有「收起 / 展开」两态', () => {
    flags.mobile = true;
    const html = overlayUnlock();
    expect(html).not.toContain('data-role="license"');
    expect(html).not.toContain('data-act="activate"');
    expect(html).not.toContain('data-act="showcode"');
    expect(html).not.toContain('购买后拿到激活码');
  });

  it('换界面语言也不会冒出来（八种语言逐一看一遍）', () => {
    for (const l of ['zh', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt'] as const) {
      setLocale(l);
      const html = overlayUnlock();
      expect(html, l).not.toContain('data-role="license"');
      expect(html, l).not.toContain('data-act="activate"');
      expect(html, l).not.toContain('data-act="showcode"');
    }
  });

  it('页脚只剩去购买与交流群两个出口，没有第三颗', () => {
    expect(footActs(overlayUnlock())).toEqual(['buy', 'copygroup']);
  });

  it('不再当作「带输入框的弹层」，但仍有专门的遮罩类保住手机落位', () => {
    const html = overlayUnlock();
    expect(html).not.toMatch(/class="bzs-scrim[^"]*\bhas-input\b/);
    expect(html).toMatch(/class="bzs-scrim[^"]*\bbzs-unlock-scrim\b/);
  });

  it('showcode 不再是动作：派发它不改动弹层', () => {
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: 'export' } });
    const before = getState().overlay;
    dispatchAction('showcode', { dataset: {} } as unknown as HTMLElement);
    expect(getState().overlay).toBe(before);
  });
});

describe('解锁弹层 · 已激活时不再推销购买', () => {
  it('页脚只剩交流群，购买按钮不再出现', () => {
    ent.paid = true;
    const html = overlayUnlock();
    expect(footActs(html)).toEqual(['copygroup']);
    expect(html).not.toContain('data-act="buy"');
  });

  it('「已激活」的副标还在，授权状态仍看得见', () => {
    ent.paid = true;
    expect(overlayUnlock()).toContain('已激活');
  });
});
