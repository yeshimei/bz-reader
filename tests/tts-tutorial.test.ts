import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_TUTORIAL_URL,
  CLIP_TUTORIAL_URL,
  TTS_TUTORIAL_URL,
  VIDEO_TUTORIAL_URL,
} from '../src/core/links';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { setLocale } from '../src/i18n';
import { dispatchAction } from '../src/shell/actions';
import { overlayUnlock } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';

/**
 * 朗读教程视频（2026-11-14）。
 *
 * 这一期讲的是听书整套流程：三种引擎怎么配、预生成怎么用、离线包怎么拷。
 * 两处入口共用同一条地址——对照表「朗读」那一行的行尾，与设置页朗读组的
 * 标题右侧。地址只登记在 `core/links.ts` 一处，README 那条由
 * `tests/readme-links.test.ts` 盯着，这里只管「两处都指对了」。
 */

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* 只看表的排版与链接，不测授权：钉成基础版，弹层不高亮任何一行 */
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
  notices.length = 0;
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
    version: '1.4.0',
  });
}

describe('朗读教程 · 设置页', () => {
  it('朗读组标题旁边有一颗「看教程」，点了打开这一期', () => {
    const out = settingsHtml();
    const start = out.indexOf('id="bz-set-tts"');
    expect(start, '有朗读组').toBeGreaterThan(-1);
    /* 组头就在 id 之后不远：标题 + 教程链接，取一段窗口够用 */
    const grp = out.slice(start, start + 600);

    expect(grp).toContain('data-act="ttstut"');
    expect(grp).toContain('看教程');
  });

  it('点一下在新窗口打开，带 noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('ttstut', el());

    expect(open).toHaveBeenCalledWith(TTS_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
  });
});

describe('朗读教程 · 高级版对照表', () => {
  it('挂在「朗读与听书」那一段的标题后面，不落到某一行', () => {
    const html = overlayUnlock('');
    const groupRows = [...html.matchAll(/<div class="bzs-plan-row is-group">([\s\S]*?)<\/div>/g)].map(
      (m) => m[1],
    );
    const hit = groupRows.filter((r) => r.includes(TTS_TUTORIAL_URL));

    expect(hit, '组标题上有一颗').toHaveLength(1);
    expect(hit[0]).toContain('朗读与听书');

    /* 全表只挂这一处：同一支视频同时挂在行尾和组标题，用户会以为讲两件事 */
    const all = [...html.matchAll(/<div class="bzs-plan-row[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    expect(all.filter((r) => r.includes(TTS_TUTORIAL_URL))).toHaveLength(1);
  });

  it('链接文案写「看教程」，不写「看视频」', () => {
    const html = overlayUnlock('');
    expect(html).toContain('看教程');
    expect(html).not.toContain('看视频');
  });
});

describe('朗读教程 · 地址登记', () => {
  it('四条教程视频各指各的，换一期不会顺带改掉另一处', () => {
    const all = [VIDEO_TUTORIAL_URL, AI_TUTORIAL_URL, CLIP_TUTORIAL_URL, TTS_TUTORIAL_URL];
    expect(new Set(all).size).toBe(all.length);
    expect(TTS_TUTORIAL_URL).toMatch(/^https:\/\/www\.bilibili\.com\/video\/[A-Za-z0-9]+$/);
  });
});
