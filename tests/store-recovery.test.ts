import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore, mergeData, sanitizeDataDetailed } from '../src/data/store';
import { DEFAULT_DATA_DIR } from '../src/core/plugin-path';
import { FakeAdapter } from './helpers/fake-adapter';

const DIR = DEFAULT_DATA_DIR;
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

describe('读盘失败（A-02）', () => {
  it('不是「文件不存在」的读失败：本次会话只读，不能拿空库覆盖原文件', async () => {
    const adapter = new FakeAdapter();
    const originalRead = adapter.read.bind(adapter);
    let calls = 0;
    adapter.read = async (path: string) => {
      calls += 1;
      if (calls === 1) throw new Error('EACCES: permission denied');
      return originalRead(path);
    };
    const store = makeStore(adapter);

    const data = await store.load();
    expect(data.books).toEqual([]);

    store.get().books.push(book('b1', '读失败时不该被写下去') as never);
    await store.flush(true);

    expect(adapter.writes).toHaveLength(0);
    expect(adapter.files.has(FILE)).toBe(false);
  });
});

describe('老数据搬迁（A-12）', () => {
  it('新数据目录已经有 bz-reader.json 时不再整棵覆盖', async () => {
    const adapter = new FakeAdapter();
    const legacyFile = '.obsidian/plugins/bz-reader/storage/bz-reader.json';
    const newText = payload([book('new', '新目录里的书')]);
    adapter.files.set(legacyFile, payload([book('old', '老目录里的书')]));
    adapter.files.set(FILE, newText);

    /* 模拟一次竞态：这一拍 read() 报「不存在」，但磁盘上文件其实在
       （Sync 刚把它建出来 / 另一窗口刚写完）。adoptLegacy 若不先 exists 就会
       用老目录那份把新文件整份盖掉。 */
    const originalRead = adapter.read.bind(adapter);
    let failed = false;
    adapter.read = async (path: string) => {
      if (!failed && path === FILE) {
        failed = true;
        throw new Error(`ENOENT: no such file or directory, ${path}`);
      }
      return originalRead(path);
    };

    const store = makeStore(adapter);
    const data = await store.load();

    expect(adapter.files.get(FILE)).toBe(newText);
    expect(data.books).toEqual([]);
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

  it('checkins 按天取 max，goal / dailyGoalMinutes 取有值且较大的那份（A-13）', () => {
    const local = {
      version: 1 as const,
      books: [],
      checkins: { '2026-01-01': 600, '2026-01-02': 60 },
      goal: 30,
      dailyGoalMinutes: 20,
      prefs: { theme: 'local' },
      dataDir: '本地目录',
    };
    const disk = {
      version: 1 as const,
      books: [],
      checkins: { '2026-01-01': 300, '2026-01-02': 900, '2026-01-03': 120 },
      goal: 50,
      dailyGoalMinutes: 10,
      prefs: { theme: 'disk' },
      dataDir: '盘上目录',
    };

    const out = mergeData(local as never, disk as never);
    expect(out.checkins).toEqual({
      '2026-01-01': 600,
      '2026-01-02': 900,
      '2026-01-03': 120,
    });
    expect(out.goal).toBe(50);
    expect(out.dailyGoalMinutes).toBe(20);
    /* 其余字段沿用本地：磁盘那边的 prefs / dataDir 不能整份盖过来 */
    expect(out.prefs).toEqual({ theme: 'local' });
    expect(out.dataDir).toBe('本地目录');
  });

  it('本地没有 goal 时采用磁盘那份；两边都没有就保持没有（A-13）', () => {
    const out = mergeData(
      { version: 1 as const, books: [] } as never,
      { version: 1 as const, books: [], goal: 24, dailyGoalMinutes: 15 } as never,
    );
    expect(out.goal).toBe(24);
    expect(out.dailyGoalMinutes).toBe(15);

    const empty = mergeData({ version: 1 as const, books: [] } as never, { version: 1 as const, books: [] } as never);
    expect(empty.goal).toBeUndefined();
    expect(empty.dailyGoalMinutes).toBeUndefined();
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

  it('.bak 恢复后不用等调用方 flush：load() 自己就把正本修好（A-14）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, '{ 半截 JSON');
    adapter.files.set(`${FILE}.bak`, payload([book('b1', '从备份里回来的书')]));
    const store = makeStore(adapter);

    await store.load();

    expect(adapter.files.get(FILE)).toContain('从备份里回来的书');
  });

  it('正本整个缺失、只有 .bak：也先试 .bak 再试 .tmp（A-14）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(`${FILE}.bak`, payload([book('b1', '只有备份的书')]));
    const store = makeStore(adapter);

    const data = await store.load();
    expect(data.books).toHaveLength(1);
    expect(data.books[0]!.meta.title).toBe('只有备份的书');
    /* load 里恢复完立即回写，下一次启动走正常路径 */
    expect(adapter.files.get(FILE)).toContain('只有备份的书');
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
