import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { ReaderBook } from '../src/data/schema';
import { FakeAdapter } from './helpers/fake-adapter';

/* book-scan 只在导入时跑：把 EPUB 当 zip 打开拿 OPF 书目。
   node 里没有 zip/foliate 运行时，这里换成桩，只验「作者有没有被读出来并写回书」。 */
const { makeBookMock } = vi.hoisted(() => ({ makeBookMock: vi.fn() }));
vi.mock('../src/engine/foliate', () => ({ makeBook: makeBookMock }));

import { fillBookMeta, fillBookMetas, backfillFingerprints, readBookMeta } from '../src/data/book-scan';
import { fingerprintOf } from '../src/data/fingerprint';

function makeApp(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function bookOf(id: string, path: string, size = 0): ReaderBook {
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

/** foliate 打开后的书：带书目 + destroy 计数 */
function foliateBook(meta: Record<string, unknown>, destroy = vi.fn()): { metadata: Record<string, unknown>; sections: unknown[]; destroy: () => void } {
  return { metadata: meta, sections: [], destroy };
}

beforeEach(() => {
  makeBookMock.mockReset();
});

describe('导入时读取书目（作者不再等第一次打开）', () => {
  it('EPUB：读出 dc:creator 并收敛成作者名', async () => {
    makeBookMock.mockResolvedValueOnce(
      foliateBook({ title: '活着', author: [{ name: '余华' }], language: 'zh' }),
    );
    const adapter = new FakeAdapter();
    adapter.files.set('Books/活着.epub', 'fake-epub-bytes');

    const meta = await readBookMeta(makeApp(adapter), 'Books/活着.epub');

    expect(meta?.author).toBe('余华');
    expect(meta?.title).toBe('活着');
    /* 传进去的 File 要用真文件名：foliate 按扩展名派发 loader */
    const file = makeBookMock.mock.calls[0]?.[0] as File;
    expect(file.name).toBe('活着.epub');
  });

  it('多人作者拼起来，不只留第一个', async () => {
    makeBookMock.mockResolvedValueOnce(
      foliateBook({ title: '合著', author: [{ name: '甲' }, { name: '乙' }] }),
    );
    const adapter = new FakeAdapter();
    adapter.files.set('a.epub', 'x');

    expect((await readBookMeta(makeApp(adapter), 'a.epub'))?.author).toBe('甲、乙');
  });

  it('读完就销毁 foliate 书对象（zip 解出来的资源不留着）', async () => {
    const destroy = vi.fn();
    makeBookMock.mockResolvedValueOnce(foliateBook({ author: '作者' }, destroy));
    const adapter = new FakeAdapter();
    adapter.files.set('a.epub', 'x');

    await readBookMeta(makeApp(adapter), 'a.epub');

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('TXT 没有内嵌书目：不读文件，直接 null', async () => {
    const adapter = new FakeAdapter();
    const readBinary = vi.spyOn(adapter, 'readBinary');

    expect(await readBookMeta(makeApp(adapter), 'Books/笔记.txt')).toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
    expect(makeBookMock).not.toHaveBeenCalled();
  });

  it('超过 40MB 的书不整本读进来（书目退回文件名）', async () => {
    const adapter = new FakeAdapter();
    const readBinary = vi.spyOn(adapter, 'readBinary');

    expect(await readBookMeta(makeApp(adapter), '巨书.epub', 41 * 1024 * 1024)).toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
    expect(makeBookMock).not.toHaveBeenCalled();
  });

  it('坏书/读不出来：不抛错，返回 null（导入不能因为一本坏书卡死）', async () => {
    makeBookMock.mockRejectedValueOnce(new Error('zip: not a valid archive'));
    const adapter = new FakeAdapter();
    adapter.files.set('bad.epub', 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const b = bookOf('b1', 'bad.epub');
    expect(await fillBookMeta(makeApp(adapter), b)).toBe(false);
    expect(b.meta.author).toBeUndefined();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('把作者写进书目：fillBookMeta 返回 true', async () => {
    makeBookMock.mockResolvedValueOnce(foliateBook({ title: '活着', author: '余华' }));
    const adapter = new FakeAdapter();
    adapter.files.set('Books/活着.epub', 'x');
    const b = bookOf('b1', 'Books/活着.epub');

    expect(await fillBookMeta(makeApp(adapter), b)).toBe(true);
    expect(b.meta.author).toBe('余华');
    expect(b.meta.title).toBe('活着');
  });

  it('用户改过名：书名不动，作者照填', async () => {
    makeBookMock.mockResolvedValueOnce(foliateBook({ title: '文件里的书名', author: '余华' }));
    const adapter = new FakeAdapter();
    adapter.files.set('a.epub', 'x');
    const b = bookOf('b1', 'a.epub');
    b.meta.title = '我改的名字';
    b.meta.titleEdited = true;

    await fillBookMeta(makeApp(adapter), b);

    expect(b.meta.title).toBe('我改的名字');
    expect(b.meta.author).toBe('余华');
  });

  it('批量：每本都填，坏书跳过，返回真的写了几本', async () => {    const adapter = new FakeAdapter();
    adapter.files.set('a.epub', 'x');
    adapter.files.set('b.epub', 'x');
    adapter.files.set('c.epub', 'x');
    makeBookMock
      .mockResolvedValueOnce(foliateBook({ author: '甲' }))
      .mockRejectedValueOnce(new Error('corrupt'))
      .mockResolvedValueOnce(foliateBook({ author: '丙' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const books = [bookOf('a', 'a.epub'), bookOf('b', 'b.epub'), bookOf('c', 'c.epub')];
    const changed = await fillBookMetas(makeApp(adapter), books);

    expect(changed).toBe(2);
    expect(books.map((b) => b.meta.author)).toEqual(['甲', undefined, '丙']);
    /* 三本各解析一次，没有重复 */
    expect(makeBookMock).toHaveBeenCalledTimes(3);

    warn.mockRestore();
  });
});

/**
 * 升级前的书没有指纹。不补算的话，用户重新导入同一本书照样新建一条，
 * 等于去重没生效。补算只读记录上那条路径，文件没了/太大就跳过。
 */
describe('给老记录补算内容指纹', () => {
  it('只补没有指纹的，已有的原样保留', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('a.epub', 'aaa');
    adapter.files.set('b.epub', 'bbb');
    const books = [bookOf('a', 'a.epub'), bookOf('b', 'b.epub')];
    books[0]!.fileRef.fingerprint = 'v1-keep';

    const n = await backfillFingerprints(makeApp(adapter), books);

    expect(n).toBe(1);
    expect(books[0]!.fileRef.fingerprint).toBe('v1-keep');
    expect(books[1]!.fileRef.fingerprint).toBe(fingerprintOf(new TextEncoder().encode('bbb')));
  });

  it('文件已经没了：跳过，不抛错，不写假指纹', async () => {
    const adapter = new FakeAdapter();
    const books = [bookOf('gone', 'gone.epub')];

    expect(await backfillFingerprints(makeApp(adapter), books)).toBe(0);
    expect(books[0]!.fileRef.fingerprint).toBeUndefined();
  });

  it('已经都有指纹：一次文件都不读', async () => {
    const adapter = new FakeAdapter();
    const readBinary = vi.spyOn(adapter, 'readBinary');
    const books = [bookOf('a', 'a.epub')];
    books[0]!.fileRef.fingerprint = 'v1-x';

    expect(await backfillFingerprints(makeApp(adapter), books)).toBe(0);
    expect(readBinary).not.toHaveBeenCalled();
  });
});
