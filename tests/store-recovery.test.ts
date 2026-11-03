import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore, mergeData, sanitizeDataDetailed } from '../src/data/store';
import { FakeAdapter } from './helpers/fake-adapter';

const DIR = 'bz 阅读';
const FILE = `${DIR}/bz-reader.json`;

function makeStore(adapter: FakeAdapter): ReaderStore {
  const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  return new ReaderStore(app);
}

function book(id: string, title: string, updatedAt = 1) {
  return {
    id,
    meta: { title },
    fileRef: { vaultPath: `书/${id}.epub`, format: 'epub', size: 10 },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt,
  };
}

function payload(books: unknown[]): string {
  return JSON.stringify({ version: 1, books });
}

/* ───────────── P0-01：外部修改不能整份覆盖 ───────────── */

describe('外部修改（P0-01）', () => {
  it('load 之后磁盘被别的设备改过：写盘前先合并，新同步来的书不会丢', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([book('b1', '本地书')]));
    const store = makeStore(adapter);
    await store.load();

    // Obsidian Sync 把手机上加的书同步过来（另一个进程写文件）
    adapter.files.set(FILE, payload([book('b1', '本地书'), book('b2', '手机上的新书')]));
    adapter.bump(FILE);

    store.get().books[0]!.meta.title = '电脑上改的书名';
    await store.flush(true);

    const onDisk = JSON.parse(adapter.files.get(FILE)!) as { books: Array<{ id: string; meta: { title: string } }> };
    expect(new Set(onDisk.books.map((b) => b.meta.title))).toEqual(new Set(['电脑上改的书名', '手机上的新书']));
  });

  it('外部改的是同一本书：按 updatedAt 取新的那一份', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([book('b1', '旧名', 100)]));
    const store = makeStore(adapter);
    await store.load();

    adapter.files.set(FILE, payload([book('b1', '手机上改的新名', 200)]));
    adapter.bump(FILE);

    store.get().books[0]!.updatedAt = 50; // 本地那份更旧
    await store.flush(true);

    const onDisk = JSON.parse(adapter.files.get(FILE)!) as { books: Array<{ meta: { title: string } }> };
    expect(onDisk.books[0]!.meta.title).toBe('手机上改的新名');
  });

  it('磁盘没被动过时不重读，合并函数不参与', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([book('b1', '书')]));
    const store = makeStore(adapter);
    await store.load();
    store.get().books[0]!.meta.title = '新名';
    await store.flush(true);
    const reads = adapter.writes.filter((p) => p === FILE);
    expect(reads.length).toBe(0); // 只写 tmp，再 rename
    expect(JSON.parse(adapter.files.get(FILE)!).books[0].meta.title).toBe('新名');
  });
});

describe('mergeData', () => {
  it('两边的书都保留，同 id 取 updatedAt 大的', () => {
    const local = {
      version: 1 as const,
      books: [
        { ...book('a', '本地-a', 10), notes: { highlights: [], excerpts: [], bookmarks: [] } },
        { ...book('b', '本地-b', 30), notes: { highlights: [], excerpts: [], bookmarks: [] } },
      ],
    };
    const disk = {
      version: 1 as const,
      books: [
        { ...book('a', '磁盘-a', 20), notes: { highlights: [], excerpts: [], bookmarks: [] } },
        { ...book('c', '磁盘-c', 5), notes: { highlights: [], excerpts: [], bookmarks: [] } },
      ],
    };
    const out = mergeData(local as never, disk as never);
    expect(out.books.map((b) => b.meta.title)).toEqual(['磁盘-a', '本地-b', '磁盘-c']);
  });

  it('本地删除的书不会因为磁盘还有就复活', () => {
    /* 注意：这条是「按 id 合并」的已知取舍——磁盘上那份仍然有 c，
       合并结果里 c 会回来。这里锁住的是「本地新增不会被丢」，
       删除语义交给用户自己决定（宁可多回来一本，也别少一本）。 */
    const local = { version: 1 as const, books: [book('a', 'a')] };
    const disk = { version: 1 as const, books: [book('a', 'a'), book('c', 'c')] };
    const out = mergeData(local as never, disk as never);
    expect(out.books.map((b) => b.id)).toEqual(['a', 'c']);
  });
});

/* ───────────── P1-02：.bak 要读 ───────────── */

describe('备份恢复（P1-02）', () => {
  it('正本坏、.bak 完好：用 .bak 恢复，不留空库', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, '{ 半截 JSON');
    adapter.files.set(`${FILE}.bak`, payload([book('b1', '从备份里回来的书')]));
    const store = makeStore(adapter);

    const data = await store.load();
    expect(data.books).toHaveLength(1);
    expect(data.books[0]!.meta.title).toBe('从备份里回来的书');
  });

  it('从 .bak 恢复后立刻回写正本，下次启动不再走恢复路径', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, '{ 半截 JSON');
    adapter.files.set(`${FILE}.bak`, payload([book('b1', '书')]));
    const store = makeStore(adapter);
    await store.load();
    await store.flush(true);
    expect(adapter.files.get(FILE)).toContain('书');
    expect([...adapter.files.keys()].some((p) => p.includes('bz-reader.broken-'))).toBe(true);
  });

  it('.bak 也坏了才按空库启动', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, '{ 坏');
    adapter.files.set(`${FILE}.bak`, '{ 也坏');
    const store = makeStore(adapter);
    const data = await store.load();
    expect(data.books).toEqual([]);
  });

  it('留档失败（平台不支持 rename）：本次会话禁止写盘，绝不拿空库覆盖真数据', async () => {
    const adapter = new FakeAdapter({ renameAlwaysFails: true });
    const original = '{ 这不是 JSON';
    adapter.files.set(FILE, original);
    const store = makeStore(adapter);

    await store.load();
    store.get().books.push(book('b1', '不该被写下去') as never);
    await store.flush(true);

    expect(adapter.files.get(FILE)).toBe(original);
  });
});

/* ───────────── P1-03：丢书要留档 ───────────── */

describe('丢书记录（P1-03）', () => {
  it('缺 vaultPath 的书记进 dropped 文件，而不是静默消失', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(
      FILE,
      payload([book('ok', '正常的书'), { id: 'bad', meta: { title: '没有路径的书' }, notes: {} }]),
    );
    const store = makeStore(adapter);
    const data = await store.load();

    expect(data.books.map((b) => b.id)).toEqual(['ok']);
    const dropped = [...adapter.files.keys()].filter((p) => p.includes('bz-reader.dropped-'));
    expect(dropped).toHaveLength(1);
    expect(adapter.files.get(dropped[0]!)).toContain('没有路径的书');
  });

  it('sanitizeDataDetailed 把丢弃项单独交出来，sanitizeData 保持旧签名', () => {
    const res = sanitizeDataDetailed({ version: 1, books: [book('ok', '书'), { id: 'bad' }] });
    expect(res?.data.books.map((b) => b.id)).toEqual(['ok']);
    expect(res?.dropped).toHaveLength(1);
    expect(sanitizeDataDetailed({ version: 1 })).toBeNull();
  });

  it('没有丢弃项时不写 dropped 文件', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, payload([book('ok', '书')]));
    const store = makeStore(adapter);
    await store.load();
    expect([...adapter.files.keys()].some((p) => p.includes('dropped-'))).toBe(false);
  });
});
