/**
 * 「补全信息（AI）」的请求闸门（2026-11-11 真机反馈）。
 *
 * 用户点《围城》的「补全信息」，简介与分类本来就有，却每点一次弹一次
 * 「已补上简介与分类」。根因不在模型，在调用方：不管缺不缺都发请求，
 * 模型每次换个说法就能凑出「新增标签」，于是永远「写成功了」。
 *
 * 这里只守一件事：**信息齐了就不发请求**。省的是额度，也是用户那次
 * 莫名其妙的等待。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichBookMeta } from '../src/shell/actions';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import type { BookMeta, ReaderBook } from '../src/data/schema';
import { t } from '../src/i18n';
import { makeApp, makeStore } from './helpers/plugin-harness';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* 授权不在这条链路的考察范围：一律放行，免得测试卡在解锁层 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  setShellSource(null);
  notices.length = 0;
  vi.unstubAllGlobals();
});

function makeBook(patch: Partial<BookMeta> = {}): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '围城', ...patch },
    reading: { position: {}, stats: {} },
    notes: {},
    updatedAt: 1,
  } as unknown as ReaderBook;
}

function installSource(book: ReaderBook): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [book] },
    store: makeStore(),
    /* 密钥填好：这样卡住的不会是「没配置 AI」那一步 */
    settings: () => ({
      ...DEFAULT_SETTINGS,
      ai: { provider: 'deepseek', baseUrl: '', keys: { deepseek: 'sk-test' }, models: {} },
    }),
  } as unknown as ShellSource);
}

describe('补全信息：信息齐了就别问模型', () => {
  it('简介与分类都在：不发请求，只说一声已经齐了', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    installSource(makeBook({ description: '已有简介', subjects: ['小说'] }));
    await enrichBookMeta('b1');

    expect(notices).toContain(t('notice.enrich.none'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缺简介：照常往下走（这里只验证没被提前拦掉）', async () => {
    const fetchMock = vi.fn(() => new Promise(() => undefined));
    /* aiAsk 用的是 window.fetch（宿主里 window 就是 global） */
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', fetchMock);

    installSource(makeBook({ subjects: ['小说'] }));
    void enrichBookMeta('b1');

    /* 有请求就说明没被「齐了」那条挡回去；请求永远 pending，测试结束即弃 */
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(notices).not.toContain(t('notice.enrich.none'));
  });
});
