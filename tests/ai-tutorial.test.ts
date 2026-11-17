/**
 * AI 助手教程（2026-11-17）。
 *
 * 作者给了这一期（BV1BNsz6zEBx）：讲自己的接口地址 / 模型 / 密钥怎么填，
 * 划词解释与全书问答怎么用。它和「AI 知识库」那条不是同一支——那条只讲
 * 索引怎么建。三处入口共用这一条地址：
 *   1. 设置页 AI 组标题右侧的「看教程」；
 *   2. 高级版对照表 AI 那一段的组标题后面；
 *   3. README 功能表 AI 那一行（由 tests/readme-links.test.ts 盯着）。
 *
 * 地址只登记在 `core/links.ts` 一处，这里管前两处指对了、点得开。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CHAT_TUTORIAL_URL, AI_TUTORIAL_URL } from '../src/core/links';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { setLocale } from '../src/i18n';
import { dispatchAction } from '../src/shell/actions';
import { overlayUnlock } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* 只看链接挂在哪、点开是不是这一期，不测授权：钉成基础版 */
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

function settingsHtml(): string {
  return viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '1.5.1',
  });
}

describe('AI 教程 · 设置页', () => {
  it('AI 组标题旁边有一颗「看教程」', () => {
    const out = settingsHtml();
    const start = out.indexOf('id="bz-set-ai"');
    expect(start, '有 AI 组').toBeGreaterThan(-1);
    const grp = out.slice(start, start + 600);
    expect(grp).toContain('data-act="aichattut"');
    expect(grp).toContain('看教程');
  });

  it('点一下在新窗口打开这一期，带 noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('aichattut', { dataset: {} } as unknown as HTMLElement);

    expect(open).toHaveBeenCalledWith(AI_CHAT_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
  });

  it('地址填上了就不再弹「教程整理中」', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('aichattut', { dataset: {} } as unknown as HTMLElement);

    expect(notices.join()).not.toContain('整理中');
  });
});

describe('AI 教程 · 高级版对照表', () => {
  it('挂在 AI 那一段的组标题上，只挂一处', () => {
    const html = overlayUnlock('');
    const rows = [...html.matchAll(/<div class="bzs-plan-row[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    const hit = rows.filter((r) => r.includes(AI_CHAT_TUTORIAL_URL));
    expect(hit, '组标题上有一颗').toHaveLength(1);
  });

  it('「AI 知识库」那一行仍是讲索引的那条，两条没被并成一条', () => {
    const html = overlayUnlock('');
    expect(html).toContain(AI_TUTORIAL_URL);
    expect(AI_TUTORIAL_URL).not.toBe(AI_CHAT_TUTORIAL_URL);
  });
});
