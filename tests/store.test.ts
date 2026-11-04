import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore, sanitizeData } from '../src/data/store';
import { DEFAULT_DATA_DIR } from '../src/core/plugin-path';
import { FakeAdapter } from './helpers/fake-adapter';

/* 测试环境没有 localStorage，store 会回落到默认数据目录——所以 fixture 的
   路径必须跟着 DEFAULT_DATA_DIR 走，不能各写一份字符串。 */
const DIR = DEFAULT_DATA_DIR;
const FILE = `${DIR}/bz-reader.json`;
const TMP = `${FILE}.tmp`;

function makeStore(adapter: FakeAdapter): ReaderStore {
  const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  return new ReaderStore(app);
}

function validData(): string {
  return JSON.stringify({
    version: 1,
    books: [
      {
        id: 'b1',
        meta: { title: '测试书' },
        fileRef: { vaultPath: '书/a.epub', format: 'epub', size: 10 },
        reading: { position: { percent: 0.5 }, stats: { totalReadTime: 60, lastReadTime: 1 }, sessions: [] },
        notes: { highlights: [], excerpts: [], bookmarks: [] },
        addedAt: 1,
        updatedAt: 1,
      },
    ],
  });
}

function book(id: string, title: string) {
  return {
    id,
    meta: { title },
    fileRef: { vaultPath: `书/${id}.epub`, format: 'epub', size: 10 },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

function payload(books: unknown[]): string {
  return JSON.stringify({ version: 1, books });
}

describe('数据形状自愈（sanitizeData）', () => {
  it('半截记录补齐 reading/notes，统计页不会再 TypeError', () => {
    const clean = sanitizeData({
      version: 1,
      books: [{ id: 'x', fileRef: { vaultPath: 'a.epub', format: 'epub' } }],
    });
    expect(clean?.books).toHaveLength(1);
    const b = clean!.books[0]!;
    expect(b.meta.title).toBe('');
    expect(b.reading.stats.totalReadTime).toBe(0);
    expect(b.reading.sessions).toEqual([]);
    expect(b.notes.highlights).toEqual([]);
  });

  it('没有 id 或没有 vaultPath 的条目直接丢掉', () => {
    const clean = sanitizeData({
      version: 1,
      books: [{ id: 'ok', fileRef: { vaultPath: 'a.epub', format: 'epub' } }, { id: 'no-path' }, { fileRef: { vaultPath: 'b.epub' } }],
    });
    expect(clean?.books.map((b) => b.id)).toEqual(['ok']);
  });

  it('sessions 里 start 缺失/≤0 的条目丢掉（与 bz 的口径一致）', () => {
    const clean = sanitizeData({
      version: 1,
      books: [
        {
          id: 'x',
          fileRef: { vaultPath: 'a.epub', format: 'epub' },
          reading: { sessions: [{ start: 1, end: 2, durationSeconds: 1 }, { durationSeconds: 9 }, { start: 0 }] },
        },
      ],
    });
    expect(clean?.books[0]!.reading.sessions).toHaveLength(1);
  });

  it('books 不是数组时返回 null（调用方按空库启动）', () => {
    expect(sanitizeData({ version: 1 })).toBeNull();
    expect(sanitizeData('nope')).toBeNull();
  });

  it('收藏与分组在 sanitize 后仍然保留（P2-01 的落盘面）', () => {
    /* 重建 book 对象时漏掉 favorite/shelf，读盘一次就把它们丢掉，
       下一轮写盘永久消失——换设备「跟着走」的承诺在本地就断了。 */
    const clean = sanitizeData({
      version: 1,
      books: [
        {
          id: 'x',
          fileRef: { vaultPath: 'a.epub', format: 'epub' },
          favorite: true,
          shelf: '技术',
        },
      ],
    });
    expect(clean?.books[0]!.favorite).toBe(true);
    expect(clean?.books[0]!.shelf).toBe('技术');
  });
});

describe('读盘与恢复', () => {
  it('文件不存在时按空库启动，不写盘', async () => {
    const adapter = new FakeAdapter();
    const store = makeStore(adapter);
    const data = await store.load();
    expect(data.books).toEqual([]);
    expect(adapter.writes).toEqual([]);
  });

  it('坏 JSON：原文件改名留档，而不是下次写盘覆盖', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, '{ 这不是 JSON');
    const store = makeStore(adapter);
    const data = await store.load();
    expect(data.books).toEqual([]);
    const broken = [...adapter.files.keys()].filter((p) => p.includes('bz-reader.broken-'));
    expect(broken).toHaveLength(1);
    expect(adapter.files.get(broken[0]!)).toContain('这不是 JSON');
    expect(adapter.files.has(FILE)).toBe(false);
  });

  it('结构不符（books 不是数组）同样留档', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, JSON.stringify({ version: 1, books: 'oops' }));
    const store = makeStore(adapter);
    await store.load();
    expect([...adapter.files.keys()].some((p) => p.includes('bz-reader.broken-'))).toBe(true);
  });

  it('正本丢了但 .tmp 完整：从 .tmp 恢复并改名成正本', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(TMP, validData());
    const store = makeStore(adapter);
    const data = await store.load();
    expect(data.books).toHaveLength(1);
    expect(adapter.files.has(FILE)).toBe(true);
    expect(adapter.files.has(TMP)).toBe(false);
  });
});

describe('落盘', () => {
  it('没有改动时 flush() 不写盘，flush(true) 强制写', async () => {
    const adapter = new FakeAdapter();
    const store = makeStore(adapter);
    await store.load();
    await store.flush();
    expect(adapter.writes).toHaveLength(0);

    store.get().books.push({
      id: 'b2',
      meta: { title: '刚加的' },
      fileRef: { vaultPath: '书/b.epub', format: 'epub', size: 5 },
      reading: { position: { percent: 0 }, stats: { totalReadTime: 1, lastReadTime: 1 }, sessions: [] },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
      addedAt: 1,
      updatedAt: 1,
    });
    await store.flush(true);
    expect(adapter.writes).toContain(TMP);
    expect(adapter.files.get(FILE)).toContain('刚加的');
  });

  it('rename 不覆盖目标时先备份正本，不删数据', async () => {
    const adapter = new FakeAdapter({ renameFails: 1 });
    adapter.files.set(FILE, validData());
    const store = makeStore(adapter);
    const oldText = validData();
    await store.load();
    store.get().books[0]!.meta.title = '改过的书名';
    await store.flush(true);

    // 第一次 rename(tmp → 正本) 失败 → 正本被改名成 .bak → 再改名成功
    expect(adapter.files.get(`${FILE}.bak`)).toBe(oldText);
    expect(adapter.files.get(FILE)).toContain('改过的书名');
    expect(adapter.files.has(TMP)).toBe(false);
  });

  it('写盘前合并外部修改时 books 数组引用不变（book-repo 不会与 store 分叉）', async () => {
    /* BookRepo 构造时拿的是 store.get().books 那一个数组。合并如果换成新数组，
       repo 继续指向旧数组：新导入的书落不了盘、删掉的书重启又回来（P3-07）。 */
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, validData());
    const store = makeStore(adapter);
    await store.load();
    const booksRef = store.get().books;
    expect(booksRef).toHaveLength(1);

    // 另一台设备（或另一个窗口）往磁盘上加了第二本
    const disk = JSON.parse(validData());
    disk.books.push({ ...disk.books[0], id: 'b2', meta: { title: '同步来的书' }, updatedAt: 2 });
    adapter.files.set(FILE, JSON.stringify(disk));
    adapter.bump(FILE);

    await store.flush(true);

    expect(store.get().books).toBe(booksRef);
    expect(booksRef.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('JSON.stringify 抛错不会把写盘链永久打死', async () => {
    const adapter = new FakeAdapter();
    const store = makeStore(adapter);
    await store.load();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    store.get().prefs = cyc;
    await store.flush(true); // 不该 reject
    // 修好数据后还能继续写
    store.get().prefs = { theme: 'auto' };
    await store.flush(true);
    expect(adapter.files.get(FILE)).toContain('auto');
  });

  it('磁盘签名还是空的时候磁盘上已经有文件：先合并再写，不能拿空库盖掉（A-01）', async () => {
    const adapter = new FakeAdapter();
    const store = makeStore(adapter);
    await store.load(); // 文件不存在，diskSig 留空
    expect(adapter.files.has(FILE)).toBe(false);

    // 另一个进程（Sync / 另一个窗口）在两次写盘之间创建了文件
    adapter.files.set(FILE, payload([book('disk', '盘上来的书')]));
    adapter.bump(FILE);

    store.get().books.push(book('local', '本地新书') as never);
    await store.flush(true);

    const onDisk = JSON.parse(adapter.files.get(FILE)!) as { books: Array<{ id: string; meta: { title: string } }> };
    expect(onDisk.books.map((b) => b.id).sort()).toEqual(['disk', 'local']);
  });

  it('内容没变化时只刷新磁盘签名，不重复写文件（A-21）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set(FILE, validData());
    const store = makeStore(adapter);
    await store.load();

    store.get().books[0]!.meta.title = '只改一次';
    await store.flush(true);
    const writesAfterFirst = adapter.writes.length;
    expect(writesAfterFirst).toBeGreaterThan(0);

    await store.flush(true); // 数据没再动，强制 flush 也不该再写
    expect(adapter.writes.length).toBe(writesAfterFirst);
    expect(JSON.parse(adapter.files.get(FILE)!).books[0].meta.title).toBe('只改一次');
  });

  it('touch 之后 2 秒才落盘（A-21 节流）', async () => {
    vi.useFakeTimers();
    const g = globalThis as unknown as Record<string, unknown>;
    const hadWindow = 'window' in g;
    const oldWindow = g.window;
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    try {
      const adapter = new FakeAdapter();
      adapter.files.set(FILE, validData());
      const store = makeStore(adapter);
      await store.load();
      store.touch();

      await vi.advanceTimersByTimeAsync(1999);
      expect(adapter.writes).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(adapter.writes).toContain(TMP);
      expect(adapter.files.get(FILE)).toContain('测试书');
    } finally {
      vi.useRealTimers();
      if (hadWindow) g.window = oldWindow;
      else delete g.window;
    }
  });

  it('rename 不覆盖目标、旧 .bak 还在：第三次落盘仍然成功', async () => {
    /* 移动端真机上的事故：第一次失败留下 .bak，之后 rename(正本 → .bak)
       因为目标已存在而失败，退路从此走不通——每翻一页弹一次「保存失败」。
       这里模拟 SAF 的 rename 语义，连写三次。 */
    const adapter = new FakeAdapter({ renameNoOverwrite: true });
    const store = makeStore(adapter);
    await store.load();

    for (const title of ['第一版', '第二版', '第三版']) {
      store.get().books = [
        {
          id: 'b1',
          meta: { title },
          fileRef: { vaultPath: '书/a.epub', format: 'epub', size: 1 },
          reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
          notes: { highlights: [], excerpts: [], bookmarks: [] },
          addedAt: 1,
          updatedAt: 1,
        },
      ];
      await store.flush(true);
    }

    expect(adapter.files.get(FILE)).toContain('第三版');
    expect(adapter.files.has(TMP)).toBe(false);
  });

  it('平台完全不支持 rename：退回就地覆盖正本，数据仍然保存', async () => {
    const adapter = new FakeAdapter({ renameAlwaysFails: true });
    const store = makeStore(adapter);
    await store.load();
    store.get().books = [
      {
        id: 'b1',
        meta: { title: '就地写' },
        fileRef: { vaultPath: '书/a.epub', format: 'epub', size: 1 },
        reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
        notes: { highlights: [], excerpts: [], bookmarks: [] },
        addedAt: 1,
        updatedAt: 1,
      },
    ];
    await store.flush(true);

    expect(adapter.files.get(FILE)).toContain('就地写');
    expect(adapter.files.has(TMP)).toBe(false);
  });
});
