import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, overlayKey, setState } from '../src/shell/state';
import { setLocale, t } from '../src/i18n';
import { overlayUnlock } from '../src/shell/overlay';

/**
 * 手机上的高级版弹窗：底部收起激活码框，把高度还给对照表。
 *
 * 钉住四件事：
 *   1. 收起态不渲染输入框 → 弹层不再被当成「键盘会弹起」的那类，
 *      因此拿到接近满屏的高度；
 *   2. 「已有激活码」入口仍在页脚，和去购买、群号同一行，不随表格滚走；
 *   3. 展开态必须有输入框，且仍带键盘避让标记；
 *   4. 桌面维持原样：输入框一直可见，没有多余的展开按钮。
 */

const { flags } = vi.hoisted(() => ({ flags: { mobile: false } }));

vi.mock('../src/core/mobile', () => ({
  isMobileEnv: () => flags.mobile,
  isMobileShell: () => flags.mobile,
  LIBRARY_WIDE: 1000,
  isCompactLibrary: () => false,
}));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    entitlement: () => ({
      tier: 'free' as const,
      unlocked: false,
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
  flags.mobile = false;
  setLocale('zh');
  setState({ ...DEFAULT_SHELL_STATE });
});

function footOf(html: string): string {
  const at = html.indexOf('<div class="bzs-mfoot">');
  expect(at).toBeGreaterThan(-1);
  return html.slice(at);
}

describe('手机 · 激活码框默认收起', () => {
  it('不渲染输入框，也不带键盘避让标记', () => {
    flags.mobile = true;
    const html = overlayUnlock();
    expect(html).not.toContain('data-role="license"');
    expect(html).not.toMatch(/class="bzs-scrim[^"]*\bhas-input\b/);
  });

  it('「已有激活码」入口与购买条同在页脚，仍是唯一出口', () => {
    flags.mobile = true;
    const html = overlayUnlock();
    const foot = footOf(html);
    expect(foot).toContain('data-act="showcode"');
    expect(foot).toContain(t('unlock.haveCode'));
    expect(foot).toContain('bzs-unlock-buy');
    expect(foot).toContain('data-act="buy"');
    /* 收起态不再有「填在下面即可」的落点，这一块要能被样式收掉 */
    expect(foot).toContain('is-closed');
  });

  it('展开态把输入框与激活按钮放回页脚，并重新带上键盘避让', () => {
    flags.mobile = true;
    const html = overlayUnlock(undefined, true);
    const foot = footOf(html);
    expect(foot).toContain('data-role="license"');
    expect(foot).toContain('data-act="activate"');
    expect(html).toMatch(/class="bzs-scrim[^"]*\bhas-input\b/);
    expect(html).not.toContain('data-act="showcode"');
  });

  it('换界面语言后入口还在，用的是语言包里那句现成文案', () => {
    flags.mobile = true;
    setLocale('en');
    expect(overlayUnlock()).toContain(t('unlock.haveCode'));
  });
});

describe('桌面 · 保持原样', () => {
  it('输入框一直可见，也没有多余的展开按钮', () => {
    const html = overlayUnlock();
    expect(html).toContain('data-role="license"');
    expect(html).toMatch(/class="bzs-scrim[^"]*\bhas-input\b/);
    expect(html).not.toContain('data-act="showcode"');
  });
});

describe('展开态要能触发重画', () => {
  it('内容键区分收起 / 展开，否则点了没反应', () => {
    const o = { kind: 'unlock' as const, mode: 'export' };
    expect(overlayKey({ ...o, codeOpen: true })).not.toBe(overlayKey(o));
  });

  it('点「已有激活码」把这一张弹层置为展开态', () => {
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: 'export' } });
    dispatchAction('showcode', { dataset: {} } as unknown as HTMLElement);
    expect(getState().overlay?.codeOpen).toBe(true);
  });

  it('不是解锁弹层时不乱改状态', () => {
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'detail' } });
    dispatchAction('showcode', { dataset: {} } as unknown as HTMLElement);
    expect(getState().overlay?.codeOpen).toBeUndefined();
  });
});
