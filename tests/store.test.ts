import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ReaderStore, sanitizeData, sanitizeDataDetailed } from '../src/data/store';
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

  /* ── A8：id 只能长成 `^[\w-]{1,64}$` ────────────────────────── */

  it('带引号的书 id 整本丢弃，并进 dropped（它会进 DOM 属性）', () => {
    const res = sanitizeDataDetailed({
      version: 1,
      books: [
        { id: 'x" onmouseover="alert(1)', fileRef: { vaultPath: 'a.epub', format: 'epub' } },
        { id: '../../evil', fileRef: { vaultPath: 'b.epub', format: 'epub' } },
        { id: 'ok-1', fileRef: { vaultPath: 'c.epub', format: 'epub' } },
      ],
    });
    expect(res?.data.books.map((b) => b.id)).toEqual(['ok-1']);
    expect(res?.dropped).toHaveLength(2);
  });

  it('标注 id 不合规的单条丢弃，同数组里合规的照留', () => {
    const res = sanitizeDataDetailed({
      version: 1,
      books: [
        {
          id: 'b1',
          fileRef: { vaultPath: 'a.epub', format: 'epub' },
          notes: {
            highlights: [
              { id: 'h1', text: '正常', createdAt: 1 },
              { id: 'x/../y', text: '带斜杠', createdAt: 1 },
              { id: '', text: '空 id', createdAt: 1 },
            ],
          },
        },
      ],
    });
    expect(res?.data.books[0]!.notes.highlights.map((h) => h.id)).toEqual(['h1']);
    expect(res?.dropped).toHaveLength(2);
  });

  /* ── A9：数字只能是有限数，percent 夹到 0..1 ────────────────── */

  it('1e999 解析出来的 Infinity 落回默认值，不会写进内存', () => {
    /* JSON.parse('1e999') 得到 Infinity，`typeof` 仍是 number——
       以前它能一路混进来，再 JSON.stringify 回 null。 */
    const raw = JSON.parse(
      '{"version":1,"books":[{"id":"b1","fileRef":{"vaultPath":"a.epub","format":"epub"},' +
        '"addedAt":1e999,"updatedAt":1e999,"notesUpdatedAt":1e999,' +
        '"reading":{"position":{"percent":1e999},"stats":{"totalReadTime":1e999,"lastReadTime":-1e999}}}]}',
    );
    const clean = sanitizeData(raw);
    const b = clean!.books[0]!;
    expect(Number.isFinite(b.addedAt)).toBe(true);
    expect(Number.isFinite(b.updatedAt)).toBe(true);
    expect(b.notesUpdatedAt).toBeUndefined();
    expect(b.reading.position.percent).toBe(0); // 非有限数落回默认（0），不是夹成 1
    expect(b.reading.stats.totalReadTime).toBe(0);
    expect(b.reading.stats.lastReadTime).toBe(0);
  });

  it('percent 夹在 0..1：负数变 0，超界变 1', () => {
    const clean = sanitizeData({
      version: 1,
      books: [
        { id: 'a', fileRef: { vaultPath: 'a.epub', format: 'epub' }, reading: { position: { percent: -3 } } },
        { id: 'b', fileRef: { vaultPath: 'b.epub', format: 'epub' }, reading: { position: { percent: 7 } } },
      ],
    });
    expect(clean!.books[0]!.reading.position.percent).toBe(0);
    expect(clean!.books[1]!.reading.position.percent).toBe(1);
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

  it('PDF 视角（旋转 / 双页）在 sanitize 后仍然保留，角度按 90 取整', () => {
    /* 同一类坑：重建 book 对象时漏了 pdfView，读盘一次就退回 0°，
       用户每天打开扫描件都要重新转一遍。 */
    const clean = sanitizeData({
      version: 1,
      books: [
        {
          id: 'p',
          fileRef: { vaultPath: 'a.pdf', format: 'pdf' },
          pdfView: { rotation: 270, spread: true },
        },
        {
          id: 'q',
          fileRef: { vaultPath: 'b.pdf', format: 'pdf' },
          /* 手改过的脏值：角度取整到 90 的倍数，非法数字归 0 */
          pdfView: { rotation: 137, spread: 1 },
        },
      ],
    });
    expect(clean?.books[0]!.pdfView).toEqual({ rotation: 270, spread: true });
    expect(clean?.books[1]!.pdfView).toEqual({ rotation: 180, spread: false });
  });

  it('没有 pdfView 的书不凭空长出这个字段', () => {
    const clean = sanitizeData({
      version: 1,
      books: [{ id: 'x', fileRef: { vaultPath: 'a.epub', format: 'epub' } }],
    });
    expect(clean?.books[0]!.pdfView).toBeUndefined();
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

  it('外部改动不会被并进来，books 数组引用也不变（book-repo 不会与 store 分叉）', async () => {
    /* 2026-11-08 起不再做跨设备合并：写盘就是本机这份整份落地。
       books 数组的引用仍然不能换——BookRepo 构造时拿的是它，换掉等于
       让 repo 继续指向旧数组（新导入的书落不了盘、删掉的书重启又回来）。 */
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
    expect(booksRef.map((b) => b.id)).toEqual(['b1']);
    const onDisk = JSON.parse(adapter.files.get(FILE)!) as { books: Array<{ id: string }> };
    expect(onDisk.books.map((b) => b.id)).toEqual(['b1']);
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

  it('两次写盘之间磁盘上出现文件：本机这份照写，不读盘合并', async () => {
    /* 这是「不做冲突处理」的代价，写下来是为了让它是被选择的行为，而不是
       某天被人当成 bug 又加回一套合并算法：谁最后写谁赢。 */
    const adapter = new FakeAdapter();
    const store = makeStore(adapter);
    await store.load();
    expect(adapter.files.has(FILE)).toBe(false);

    // 另一个进程（Sync / 另一个窗口）在两次写盘之间创建了文件
    adapter.files.set(FILE, payload([book('disk', '盘上来的书')]));
    adapter.bump(FILE);

    store.get().books.push(book('local', '本地新书') as never);
    await store.flush(true);

    const onDisk = JSON.parse(adapter.files.get(FILE)!) as { books: Array<{ id: string }> };
    expect(onDisk.books.map((b) => b.id)).toEqual(['local']);
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
