import { afterEach, describe, expect, it, vi } from 'vitest';
import { MANGA_TUTORIAL_URL } from '../src/core/links';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { setLocale } from '../src/i18n';
import { dispatchAction } from '../src/shell/actions';
import { overlayUnlock } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';

/**
 * 漫画教程视频（2026-11-26）。
 *
 * 两个入口共用同一条地址：设置页漫画组的标题右侧，与高级版对照表
 * 「漫画」那一段标题后面。地址只登记在 `core/links.ts` 一处。
 */

vi.mock('../src/core/notice', () => ({
  notify: () => undefined,
}));

/* 只看表与设置页的排版和链接，不测授权：钉成基础版 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => false,
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
  setLocale('zh');
  setState({ ...DEFAULT_SHELL_STATE });
  vi.unstubAllGlobals();
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function settingsHtml(): string {
  return viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '1.7.0',
  });
}

describe('漫画教程 · 设置页', () => {
  it('漫画组标题旁边有一颗「看教程」', () => {
    const out = settingsHtml();
    const at = out.indexOf('data-act="mangatut"');
    expect(at, '有漫画教程按钮').toBeGreaterThan(-1);

    /* 按钮必须在组头那一行，不能塞进 <h3>：按 h3 认组的地方会把按钮字
       一起读成组名 */
    const head = out.slice(Math.max(0, at - 260), at + 20);
    expect(head).toContain('bzs-setgrp-head');
    expect(head).toContain('<h3>漫画</h3>');
  });

  it('点一下在新窗口打开，带 noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('mangatut', el());

    expect(open).toHaveBeenCalledWith(MANGA_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
  });
});

describe('漫画教程 · 高级版对照表', () => {
  it('挂在「漫画」那一段的标题后面，不落到某一行', () => {
    const html = overlayUnlock('');
    const groupRows = [...html.matchAll(/<div class="bzs-plan-row is-group">([\s\S]*?)<\/div>/g)].map(
      (m) => m[1],
    );
    const hit = groupRows.filter((r) => r.includes(MANGA_TUTORIAL_URL));

    expect(hit, '组标题上有一颗').toHaveLength(1);
    expect(hit[0]).toContain('漫画');

    const all = [...html.matchAll(/<div class="bzs-plan-row[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    expect(all.filter((r) => r.includes(MANGA_TUTORIAL_URL))).toHaveLength(1);
  });

  it('地址是 B 站视频页，不是合集短链', () => {
    expect(MANGA_TUTORIAL_URL).toMatch(/^https:\/\/www\.bilibili\.com\/video\/[A-Za-z0-9]+$/);
  });
});
