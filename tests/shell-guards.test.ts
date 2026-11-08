/**
 * 壳层动作的几道「别把事情做坏」的闸（C1 / C2 / C3 / C8）。
 *
 *   C1  存笔记的导出文件名：书名可能是 `CON`、`../../evil`，不能让它越出导出目录
 *   C2  目录迁移在途：连点两次不该搬两遍
 *   C3  索引删不掉：要说一句、并且别把弹层收掉（收掉等于撒谎「删完了」）
 *   C8  删书签 / 删划线认 `data-book`：不能拿当前打开的那本去删
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { writePortrait, type PortraitFile } from '../src/data/portrait';
import { DEFAULT_DATA_DIR, setDataDir } from '../src/core/plugin-path';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* 这几条都不是在测卖什么，能力门一律放行 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.migrating = '';
  RT.ptOrphans = [];
  notices.length = 0;
  setDataDir(DEFAULT_DATA_DIR);
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function installSource(opts: {
  app?: unknown;
  books?: unknown[];
  migrateDir?: (kind: string, from: string, to: string) => Promise<{ ok: boolean; message: string }>;
}): void {
  setShellSource({
    app: opts.app ?? makeApp(),
    repo: { all: () => opts.books ?? [] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS, exportDir: '书摘' }),
    migrateDir: opts.migrateDir ?? (async () => ({ ok: true, message: '好了' })),
  } as unknown as ShellSource);
}

async function saveQuoteWithTitle(title: string): Promise<string[]> {
  const book = testBook('b1', title);
  addHighlight(book as never, { text: '原文', cfiRange: 'c1', chapterTitle: '第一章' });
  const adapter = new FakeAdapter();
  installSource({ app: { vault: { adapter } }, books: [book] });
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: { kind: 'quote', text: '原文', chapterTitle: '第一章' },
  });

  dispatchAction('quotesave', el());

  await vi.waitFor(() => expect(adapter.files.size).toBe(1));
  return [...adapter.files.keys()];
}

describe('存笔记的导出文件名（C1）', () => {
  it('书名是 Windows 保留名时不直接拿来当文件名', async () => {
    const keys = await saveQuoteWithTitle('CON');

    /* 前缀下划线是 `data/export.ts` 的 safeName 定下的（A4）：导出与存笔记
       必须落成同一个文件名，否则同一本书在两个入口下会出两份笔记。 */
    expect(keys[0]).toBe('书摘/_CON.md');
  });

  it('书名里带路径分隔符也出不了导出目录', async () => {
    const keys = await saveQuoteWithTitle('../../evil');

    expect(keys[0]!.startsWith('书摘/')).toBe(true);
    expect(keys[0]!.split('/')).not.toContain('..');
  });

  it('控制字符不会进文件名', async () => {
    const keys = await saveQuoteWithTitle('书\u0000名');

    expect(keys[0]).toBe('书摘/书 名.md');
  });
});

describe('目录迁移在途（C2）', () => {
  it('点了先收弹层，重复触发只提示、不再搬一遍', async () => {
    let release!: (v: { ok: boolean; message: string }) => void;
    const migrateDir = vi.fn(
      () =>
        new Promise<{ ok: boolean; message: string }>((resolve) => {
          release = resolve;
        }),
    );
    installSource({ migrateDir });
    const openMove = (): void =>
      setState({
        ...DEFAULT_SHELL_STATE,
        overlay: { kind: 'movedir', mode: 'data', text: JSON.stringify({ from: '旧', to: '新' }) },
      });

    openMove();
    dispatchAction('dodirmove', el());
    /* 还没 await 回来，弹层就已经收掉：按钮不会停在可点状态 */
    expect(getState().overlay).toBeNull();
    expect(RT.migrating).toBe('data');

    openMove();
    dispatchAction('dodirmove', el());

    expect(migrateDir).toHaveBeenCalledTimes(1);
    expect(notices.some((n) => n.includes('正在迁移'))).toBe(true);

    release({ ok: true, message: '完成' });
    await vi.waitFor(() => expect(RT.migrating).toBe(''));
  });
});

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

describe('重建索引：删不掉要说，删掉要说清（C3）', () => {
  it('删不掉时提示，并且不收起确认层', async () => {
    /* 没有 adapter 的 app：removePortrait 拿不到文件系统，只能返回 false */
    installSource({ app: {} });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'rebuildidx', bookId: 'b1' } });

    dispatchAction('aiidxrebuildyes', el());

    await vi.waitFor(() => expect(notices.some((n) => n.includes('索引没删掉'))).toBe(true));
    expect(getState().overlay?.kind).toBe('rebuildidx');
  });

  it('删掉了要说「已清空，请重新建立」，然后收层', async () => {
    setDataDir('数据');
    const adapter = new FakeAdapter();
    const app = { vault: { adapter, configDir: '.obsidian' }, workspace: {} };
    await writePortrait(app as never, portrait());
    installSource({ app });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'rebuildidx', bookId: 'b1' } });

    dispatchAction('aiidxrebuildyes', el());

    await vi.waitFor(() => expect(getState().overlay).toBeNull());
    expect(notices.some((n) => n.includes('索引已清空'))).toBe(true);
  });
});

describe('删除认 data-book，失败不关卡（C8）', () => {
  function bookmark(id: string): Record<string, unknown> {
    return { id, cfi: `cfi-${id}`, percent: 0, chapterTitle: '第一章', label: '第一章', createdAt: 1 };
  }

  it('删书签：两本书有同名书签时不误删当前这本', () => {
    const b1 = testBook('b1');
    const b2 = testBook('b2');
    (b1.notes as { bookmarks: unknown[] }).bookmarks.push(bookmark('k1'));
    (b2.notes as { bookmarks: unknown[] }).bookmarks.push(bookmark('k1'));
    installSource({ books: [b1, b2] });
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'confirmdel', bookmarkId: 'k1', bookId: 'b2' },
    });

    dispatchAction('delbmkdo', el({ id: 'k1', book: 'b2' }));

    expect((b1.notes as { bookmarks: unknown[] }).bookmarks).toHaveLength(1);
    expect((b2.notes as { bookmarks: unknown[] }).bookmarks).toHaveLength(0);
  });

  it('书签已经不在了：提示一句，确认层留着', () => {
    const b1 = testBook('b1');
    installSource({ books: [b1] });
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'confirmdel', bookmarkId: 'gone', bookId: 'b1' },
    });

    dispatchAction('delbmkdo', el({ id: 'gone', book: 'b1' }));

    expect(notices.some((n) => n.includes('书签已经不在了'))).toBe(true);
    expect(getState().overlay?.kind).toBe('confirmdel');
  });

  it('删划线：两条同名 id 时按 data-book 找对书', () => {
    const b1 = testBook('b1');
    const b2 = testBook('b2');
    addHighlight(b1 as never, { text: '一', cfiRange: 'c1' });
    addHighlight(b2 as never, { text: '二', cfiRange: 'c2' });
    const id = (b2.notes as { highlights: Array<{ id: string }> }).highlights[0]!.id;
    installSource({ books: [b1, b2] });
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'confirmdel', markId: id, bookId: 'b2' },
    });

    dispatchAction('delmarkdo', el({ id, book: 'b2' }));

    expect((b1.notes as { highlights: unknown[] }).highlights).toHaveLength(1);
    expect((b2.notes as { highlights: unknown[] }).highlights).toHaveLength(0);
  });

  it('划线已经不在了：提示，确认层留着', () => {
    const b1 = testBook('b1');
    installSource({ books: [b1] });
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'confirmdel', markId: 'gone', bookId: 'b1' },
    });

    dispatchAction('delmarkdo', el({ id: 'gone', book: 'b1' }));

    expect(notices.some((n) => n.includes('找不到这条标注'))).toBe(true);
    expect(getState().overlay?.kind).toBe('confirmdel');
  });
});
