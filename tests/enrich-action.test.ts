/**
 * 「补全信息（AI）」的链路测试。
 *
 * 2026-11-11：点《围城》补全，简介与分类本来就有，却每点一次弹一次
 * 「已补上简介与分类」——根因是不管缺不缺都发请求。这里守「齐了不发」。
 *
 * 2026-11-17：再加一类——书「信息齐了」但书架还挂在未分类（book.shelf 空），
 * 这时仍然要发请求，让 AI 顺手归一类；判断只看 book.shelf 原值，不能走
 * shelfOf（它会回退到 meta.subjects，那本书有标签却被显示在未分类）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichBookMeta } from '../src/shell/actions';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import type { BookMeta, ReaderBook } from '../src/data/schema';
import { t } from '../src/i18n';
import { makeApp, makeStore } from './helpers/plugin-harness';

const mocks = vi.hoisted(() => ({
  notices: [] as string[],
  aiText: '' as string,
  aiCalls: 0,
  shelves: [] as Array<[string, string]>,
  shelfLists: [] as string[][],
}));

vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void mocks.notices.push(text),
}));

/* 把模型回复捏成固定值，测的是调用链与写入，不是 HTTP 格式（那是 ai.test 的事） */
vi.mock('../src/data/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/ai')>();
  return {
    ...actual,
    aiAsk: vi.fn(async () => {
      mocks.aiCalls += 1;
      return { text: mocks.aiText };
    }),
  };
});

/* 授权不在这条链路的考察范围：一律放行 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  mocks.notices.length = 0;
  mocks.shelves.length = 0;
  mocks.shelfLists.length = 0;
  mocks.aiCalls = 0;
  mocks.aiText = '';
  vi.unstubAllGlobals();
});

function makeBook(patch: Partial<BookMeta> = {}, shelf?: string): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '围城', ...patch },
    shelf,
    reading: { position: {}, stats: {} },
    notes: {},
    updatedAt: 1,
  } as unknown as ReaderBook;
}

function installSource(book: ReaderBook, shelfList: string[] = []): void {
  setState({ ...DEFAULT_SHELL_STATE, shelfList });
  setShellSource({
    app: makeApp(),
    repo: { all: () => [book] },
    store: makeStore(),
    settings: () => ({
      ...DEFAULT_SETTINGS,
      ai: { baseUrl: 'https://api.test/v1', apiKey: 'sk-test', model: 'test-model' },
    }),
    setShelf: (id: string, name: string) => void mocks.shelves.push([id, name]),
    setBookShelves: (id: string, names: string[]) => {
      if (names[0]) mocks.shelves.push([id, names[0]]);
    },
    setShelfList: (list: string[]) => void mocks.shelfLists.push(list),
  } as unknown as ShellSource);
}

describe('补全信息：信息齐了就别问模型', () => {
  it('简介、分类都在且已归类：不发请求，只说一声已经齐了', async () => {
    installSource(makeBook({ description: '已有简介', subjects: ['小说'] }, '科学'));
    await enrichBookMeta('b1');

    expect(mocks.aiCalls).toBe(0);
    expect(mocks.notices).toContain(t('notice.enrich.none'));
  });
});

describe('补全信息：信息齐了但还没归类，仍要发请求', () => {
  it('给书归到模型挑的现有分类，并说一声归入哪一类', async () => {
    mocks.aiText = '简介：已有\n标签：已有\n语言：zh\n归类：文学';
    installSource(makeBook({ description: '已有简介', subjects: ['小说'] }, ''), ['文学', '科学']);
    await enrichBookMeta('b1');

    expect(mocks.aiCalls).toBe(1);
    expect(mocks.shelves).toEqual([['b1', '文学']]);
    expect(mocks.notices.join(' ')).toContain('文学');
  });

  it('现有分类不合适时用模型起的新名字，并写进分类名册', async () => {
    mocks.aiText = '归类：纪实文学';
    installSource(makeBook({ description: '已有简介', subjects: ['小说'] }, ''), ['文学', '科学']);
    await enrichBookMeta('b1');

    expect(mocks.shelves).toEqual([['b1', '纪实文学']]);
    /* 新名字进名单：下次重绘这一格还在 */
    expect(mocks.shelfLists.some((list) => list.includes('纪实文学'))).toBe(true);
  });

  it('模型没给归类就只说没补到，不硬塞一个分类', async () => {
    mocks.aiText = '简介：已有\n标签：已有';
    installSource(makeBook({ description: '已有简介', subjects: ['小说'] }, ''), ['文学']);
    await enrichBookMeta('b1');

    expect(mocks.shelves).toEqual([]);
  });
});
