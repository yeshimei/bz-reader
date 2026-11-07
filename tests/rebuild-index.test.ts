/**
 * 重建索引（侧栏 AI 页签 · 对话页那条「重建索引」）。
 *
 * 2026-11-07 定稿：点一下先问一句，确认之后才删掉旧索引，删完回到「还没建索引」
 * 的空态，让用户重新选一次建法——不再悄悄沿用上一次的方案直接开跑。
 *
 * 两件事必须钉住：**确认之前一个字节都不动**、**确认之后缓存也要跟着失效**
 * （只删文件不清缓存，侧栏会继续按「建好了」画，用户看到的是旧索引还在）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { DEFAULT_DATA_DIR, setDataDir } from '../src/core/plugin-path';
import { portraitState, readPortrait, writePortrait, type PortraitFile } from '../src/data/portrait';
import { cachedPortrait, ensurePortrait, forgetPortrait } from '../src/shell/portrait-cache';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeStore, testBook } from './helpers/plugin-harness';

/* 「重建索引」在 AI 能力门后面；这里只测流程，不测卖什么 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function portrait(): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '瓦尔登湖',
    plan: 'compress',
    model: 'm',
    chunkChars: 8000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 100, digest: '一句话', summary: '要点' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
  };
}

/** 装一个「书开着、索引已建好且已在缓存里」的环境 */
async function seed(): Promise<{ app: unknown }> {
  setDataDir('数据');
  const adapter = new FakeAdapter();
  const app = { vault: { adapter, configDir: '.obsidian' }, workspace: {} };
  const book = testBook('b1', '瓦尔登湖');
  setShellSource({
    app,
    repo: { all: () => [book] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
    hasOpenReader: () => true,
  } as unknown as ShellSource);
  setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', sideTab: 'ai' });
  await writePortrait(app as never, portrait());
  await ensurePortrait(app as never, 'b1');
  return { app };
}

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.aiIndexOpen = false;
  RT.aiLog = [];
  forgetPortrait();
  setDataDir(DEFAULT_DATA_DIR);
});

describe('重建索引：先问，再删', () => {
  it('点「重建索引」只弹确认，旧索引一个字节都不动', async () => {
    const { app } = await seed();
    expect(cachedPortrait('b1')).not.toBeUndefined();

    dispatchAction('aiidxrebuild', el());

    expect(getState().overlay?.kind).toBe('rebuildidx');
    expect(await readPortrait(app as never, 'b1')).not.toBeNull();
    expect(cachedPortrait('b1')).not.toBeUndefined();
  });

  it('确认之后：旧索引删掉、缓存失效、回到「还没建」的空态', async () => {
    const { app } = await seed();
    dispatchAction('aiidxrebuild', el());

    dispatchAction('aiidxrebuildyes', el());
    await vi.waitFor(async () => expect(await readPortrait(app as never, 'b1')).toBeNull());

    expect(getState().overlay).toBeNull();
    /* 缓存必须一起清：留着的话侧栏还按「建好了」画，输入框照旧出现 */
    expect(cachedPortrait('b1')).toBeUndefined();
    expect(portraitState(cachedPortrait('b1') ?? null, 'm')).toBe('none');
    /* 选建法那一块不自动展开：空态要的就是「建立索引」这一步，重建完从头选 */
    expect(RT.aiIndexOpen).toBe(false);
  });

  it('旧对话一并清掉：索引都没了，那些答案的依据也不在了', async () => {
    await seed();
    RT.aiLog = [{ me: true, tag: '我', text: '这本书讲什么' }];
    dispatchAction('aiidxrebuild', el());

    dispatchAction('aiidxrebuildyes', el());
    await vi.waitFor(() => expect(RT.aiLog).toEqual([]));
  });
});
