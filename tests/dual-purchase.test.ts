import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 购买入口按界面语言分流（2026-11-24 起）。
 *
 * 解锁弹层页脚只一颗「去购买」：简体中文跳国内店，其余语言（含繁体）跳
 * 海外 Creem。不再让人手选地区；远程 bzr-data 换渠道后自动跟随。
 * 国内老按钮 data-act="buy" 保留语义，老调用继续有效。
 */

vi.mock('../src/core/notice', () => ({
  notify: () => undefined,
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

import { PURCHASE_URL, PURCHASE_URL_INTL } from '../src/data/entitlement';
import { setLocale } from '../src/i18n';
import { overlayUnlock } from '../src/shell/overlay';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { _resetBzrDataForTests, _setBzrHttpForTests, refreshBzrData } from '../src/data/bzr-data';

beforeEach(() => _resetBzrDataForTests());
afterAll(() => {
  _setBzrHttpForTests(null);
  _resetBzrDataForTests();
});

afterEach(() => {
  setLocale('zh');
  vi.unstubAllGlobals();
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('购买分流 · 常量', () => {
  it('国内店仍是原来的链动小铺，没被换掉', () => {
    expect(PURCHASE_URL).toBe('https://wzyp.cn/shop/IFCEI5I3');
  });

  it('海外店指向 Creem 商店', () => {
    expect(PURCHASE_URL_INTL).toBe('https://www.creem.io/stores/baizai');
  });

  it('两个地址不同：简中和非简中不能跳同一个店', () => {
    expect(PURCHASE_URL_INTL).not.toBe(PURCHASE_URL);
  });
});

describe('购买分流 · 解锁弹层', () => {
  it('页脚只有一颗购买按钮，不再有地区选择', () => {
    const html = overlayUnlock();
    expect(html).toContain('data-act="buy"');
    expect(html).not.toContain('data-act="buy-intl"');
  });

  it('中文界面按钮写「去购买」，不出现地区字样', () => {
    const html = overlayUnlock();
    expect(html).toContain('去购买');
    expect(html).not.toContain('中国大陆');
    expect(html).not.toContain('其他地区');
  });

  it('换语言按钮跟着翻、且只剩一颗，不残留中文', () => {
    for (const lang of ['en', 'ja', 'de', 'fr', 'es', 'pt', 'zh-TW'] as const) {
      setLocale(lang);
      const html = overlayUnlock();
      expect(html.match(/data-act="buy"/g) ?? []).toHaveLength(1);
      expect(html).not.toContain('data-act="buy-intl"');
      expect(html).not.toContain('中国大陆');
      expect(html).not.toContain('其他地区');
      expect(html).not.toContain('去购买');
    }
  });

  it('按钮在页脚，不散进正文对照表', () => {
    const html = overlayUnlock();
    const footAt = html.indexOf('<div class="bzs-mfoot">');
    expect(footAt).toBeGreaterThan(-1);
    expect(html.slice(0, footAt)).not.toContain('data-act="buy"');
    expect(html.slice(footAt)).toContain('data-act="buy"');
  });
});

describe('购买分流 · 点击跳转', () => {
  it('简体中文点「去购买」跳国内店', () => {
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL]);
  });

  it('英文界面点「去购买」跳海外店', () => {
    setLocale('en');
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL_INTL]);
  });

  it('繁体界面也算非简体，跳海外店', () => {
    setLocale('zh-TW');
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL_INTL]);
  });
});

describe('购买分流 · 远程换链接自动跟随', () => {
  const remoteDoc = JSON.stringify({
    version: 1, updatedAt: '2026-11-23',
    changelog: [{ version: '1.6.0', date: '2026-11-23', added: [
      { domain: { zh: '书架', en: 'Shelf' }, text: { zh: '改动', en: 'Change' } },
    ] }],
    roadmap: [], stats: { reward: 0, pro: 0, patrons: 0 },
    links: {
      support: 'https://afdian.net/a/x', buy: 'https://wzyp.cn/shop/IFCEI5I3',
      buyCn: 'https://new-cn.example.com/pay', buyIntl: 'https://new-intl.example.com/pay',
    },
  });

  it('远程给了新 buyCn，简中点按钮跳新国内地址', async () => {
    _setBzrHttpForTests(() => remoteDoc);
    await refreshBzrData({ force: true });
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual(['https://new-cn.example.com/pay']);
  });

  it('远程给了新 buyIntl，英文点按钮跳新海外地址', async () => {
    _setBzrHttpForTests(() => remoteDoc);
    await refreshBzrData({ force: true });
    setLocale('en');
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual(['https://new-intl.example.com/pay']);
  });

  it('点击本身不联网：refresh 之后不再发请求', async () => {
    let calls = 0;
    _setBzrHttpForTests(() => { calls += 1; return remoteDoc; });
    await refreshBzrData({ force: true });
    const afterRefresh = calls;
    vi.stubGlobal('window', { open: () => undefined });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(calls).toBe(afterRefresh);
  });
});
