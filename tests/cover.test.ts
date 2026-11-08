import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { ReaderBook } from '../src/data/schema';
import { FakeAdapter } from './helpers/fake-adapter';

/* cover.ts 顶部 import 了 engine/foliate（会拉整个 vendor 运行时），
   node 测试里换成桩：只关心缓存与降级行为，不关心解 zip。 */
const { makeBookMock } = vi.hoisted(() => ({ makeBookMock: vi.fn() }));
vi.mock('../src/engine/foliate', () => ({ makeBook: makeBookMock }));

import { coverUrl, releaseCovers } from '../src/data/cover';

function makeApp(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function bookOf(id: string, path: string, size: number): ReaderBook {
  return {
    id,
    meta: { title: id },
    fileRef: { vaultPath: path, format: 'epub', size },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

/** 解不出封面（null）的假 foliate 书 */
function noCover(): { getCover: () => Promise<null>; destroy: () => void } {
  return { getCover: async () => null, destroy: () => undefined };
}

beforeEach(() => {
  makeBookMock.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cover/${Math.random()}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  releaseCovers();
});

describe('封面失败负缓存（A-18）', () => {
  it('一次取不到后，下次书架重绘不再 readBinary + 解 zip', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('书/a.epub', 'epub-bytes');
    makeBookMock.mockResolvedValue(noCover());
    const readBinary = vi.spyOn(adapter, 'readBinary');
    const book = bookOf('b1', '书/a.epub', 10);

    expect(await coverUrl(makeApp(adapter), book)).toBeNull();
    expect(readBinary).toHaveBeenCalledTimes(1);
    expect(makeBookMock).toHaveBeenCalledTimes(1);

    expect(await coverUrl(makeApp(adapter), book)).toBeNull();
    expect(readBinary).toHaveBeenCalledTimes(1); // 命中负缓存，没有重读整本
    expect(makeBookMock).toHaveBeenCalledTimes(1);
  });

  it('文件 mtime 变了（书被重新导入）才重试', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('书/a.epub', 'epub-bytes');
    makeBookMock.mockResolvedValue(noCover());
    const readBinary = vi.spyOn(adapter, 'readBinary');
    const book = bookOf('b1', '书/a.epub', 10);

    await coverUrl(makeApp(adapter), book);
    expect(readBinary).toHaveBeenCalledTimes(1);

    adapter.bump('书/a.epub');
    await coverUrl(makeApp(adapter), book);
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it('size 变了（同名不同版本）也重试', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('书/a.epub', 'epub-bytes');
    makeBookMock.mockResolvedValue(noCover());
    const readBinary = vi.spyOn(adapter, 'readBinary');
    const book = bookOf('b1', '书/a.epub', 10);

    await coverUrl(makeApp(adapter), book);
    book.fileRef.size = 999;
    await coverUrl(makeApp(adapter), book);
    expect(readBinary).toHaveBeenCalledTimes(2);
  });
});

/* ── A13：内存缓存与磁盘缓存同 key（id+size） ───────────────── */

describe('内存缓存 key 与磁盘一致（A13）', () => {
  it('同一个 id、文件换了版本（size 变了）就重新解封面', async () => {
    makeBookMock.mockResolvedValue({
      getCover: async () => new Blob(['img'], { type: 'image/png' }),
      destroy: () => undefined,
    });
    const adapter = new FakeAdapter();
    adapter.files.set('书/a.epub', 'epub-bytes');
    const app = makeApp(adapter);
    const book = bookOf('b1', '书/a.epub', 10);

    const first = await coverUrl(app, book);
    expect(first).toBeTruthy();

    /* 以前 MEM 只按 book.id 存：书换了版本，内存里那张旧图会一直顶着新书
       显示到下次重启（磁盘缓存早就按 id-size 换新了）。 */
    book.fileRef.size = 999;
    const second = await coverUrl(app, book);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(makeBookMock).toHaveBeenCalledTimes(2);
  });
});

describe('封面内存 LRU（A-19）', () => {
  it('第 61 本书进来时释放第 1 个 objectURL，内存不会无限涨', async () => {
    makeBookMock.mockResolvedValue({
      getCover: async () => new Blob(['img'], { type: 'image/png' }),
      destroy: () => undefined,
    });
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);

    for (let i = 0; i < 61; i += 1) {
      const path = `书/b${i}.epub`;
      adapter.files.set(path, 'epub-bytes');
      expect(await coverUrl(app, bookOf(`b${i}`, path, 10))).toMatch(/^blob:cover\//);
    }

    const created = vi.mocked(URL.createObjectURL).mock.results.map((r) => r.value as string);
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map((c) => c[0]);
    expect(created).toHaveLength(61);
    expect(revoked).toContain(created[0]);
    expect(revoked).not.toContain(created[60]);
  });

  it('releaseCovers() 释放全部 objectURL', async () => {
    makeBookMock.mockResolvedValue({
      getCover: async () => new Blob(['img'], { type: 'image/png' }),
      destroy: () => undefined,
    });
    const adapter = new FakeAdapter();
    adapter.files.set('书/a.epub', 'epub-bytes');
    const url = await coverUrl(makeApp(adapter), bookOf('b1', '书/a.epub', 10));
    expect(url).toBeTruthy();

    releaseCovers();

    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map((c) => c[0])).toContain(url);
  });
});
