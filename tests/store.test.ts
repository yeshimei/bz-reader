import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore, sanitizeData } from '../src/data/store';
import { FakeAdapter } from './helpers/fake-adapter';

const DIR = 'bz 阅读';
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
