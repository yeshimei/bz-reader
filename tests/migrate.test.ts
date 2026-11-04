import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { copyTree, dirHasFiles, findDataDirs, removeTree } from '../src/data/migrate';
import { verifyCopiedJson } from '../src/data/store';
import { FakeAdapter } from './helpers/fake-adapter';

function makeApp(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function payload(n: number): string {
  return JSON.stringify({
    version: 1,
    books: Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      meta: { title: `书${i}` },
      fileRef: { vaultPath: `书/${i}.epub`, format: 'epub' },
      notes: {},
    })),
  });
}

describe('dirHasFiles（迁移前的目标目录检查）', () => {
  it('空目录返回 false', async () => {
    const adapter = new FakeAdapter();
    adapter.dirs.add('新目录');
    expect(await dirHasFiles(makeApp(adapter), '新目录')).toBe(false);
  });

  it('有文件返回 true', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('新目录/bz-reader.json', '{}');
    expect(await dirHasFiles(makeApp(adapter), '新目录')).toBe(true);
  });

  it('只有子目录也返回 true（别把别人的目录当空地）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('新目录/书摘/a.md', '#');
    expect(await dirHasFiles(makeApp(adapter), '新目录')).toBe(true);
  });

  it('目录不存在返回 false', async () => {
    expect(await dirHasFiles(makeApp(new FakeAdapter()), '没有这个目录')).toBe(false);
  });
});

describe('copyTree / removeTree', () => {
  it('递归复制文件与子目录，计数正确', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('旧/bz-reader.json', '{"a":1}');
    adapter.files.set('旧/covers/x.jpg', 'img');
    const res = await copyTree(makeApp(adapter), '旧', '新');
    expect(res.failed).toEqual([]);
    expect(res.files).toBe(2);
    expect(adapter.files.get('新/bz-reader.json')).toBe('{"a":1}');
    expect(adapter.files.get('新/covers/x.jpg')).toBe('img');
  });

  it('removeTree 只删指定目录，且拒绝库根', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('旧/a.txt', '1');
    adapter.files.set('别处/b.txt', '1');
    expect(await removeTree(makeApp(adapter), '旧')).toBe(true);
    expect(adapter.files.has('旧/a.txt')).toBe(false);
    expect(adapter.files.has('别处/b.txt')).toBe(true);
    expect(await removeTree(makeApp(adapter), '/')).toBe(false);
  });
});

describe('verifyCopiedJson（迁移前真解析，不是 exists）', () => {
  it('半截 JSON 判不合格——这是「迁移成功但书架空了」的根因', () => {
    const r = verifyCopiedJson('{"version":1,"books":[{"id":"a"', 1);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('半截');
  });

  it('结构不对（books 不是数组）判不合格', () => {
    expect(verifyCopiedJson('{"version":1,"books":"oops"}', 1).ok).toBe(false);
  });

  it('书数变少判不合格，并报出两边数量', () => {
    const r = verifyCopiedJson(payload(2), 5);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('2');
    expect(r.message).toContain('5');
  });

  it('文件不存在判不合格', () => {
    expect(verifyCopiedJson(null, 0).ok).toBe(false);
  });

  it('书数相等或更多才算过', () => {
    expect(verifyCopiedJson(payload(3), 3).ok).toBe(true);
    expect(verifyCopiedJson(payload(4), 3).ok).toBe(true);
    expect(verifyCopiedJson(payload(0), 0).ok).toBe(true);
  });
});

describe('findDataDirs（P1-07 数据目录找回）', () => {
  it('库根与一层子目录里含 bz-reader.json 的都找出来，库根用空串', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('bz-reader.json', '{}');
    adapter.files.set('我的书库/bz-reader.json', '{}');
    adapter.files.set('别的地方/笔记.md', '#');
    const found = await findDataDirs(makeApp(adapter));
    expect(found.sort()).toEqual(['', '我的书库'].sort());
  });

  it('跳过隐藏目录（.obsidian / .trash 不该被当数据目录）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('.obsidian/plugins/bz-reader/storage/bz-reader.json', '{}');
    expect(await findDataDirs(makeApp(adapter))).toEqual([]);
  });

  it('一个都没有时返回空数组，不抛', async () => {
    const app = makeApp(new FakeAdapter());
    expect(await findDataDirs(app)).toEqual([]);
  });

  /* ── 默认数据目录改到 `bz-reader/storage/` 之后（两层） ──
   * 只扫一层的话，新默认位置自己就扫不到——「localStorage 被清 / 换设备只同步
   * 了库」时，找回逻辑会对着一个和它结构对不上的布局空转。 */
  it('两层的 bz-reader/storage 也能找到', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('bz-reader/storage/bz-reader.json', '{}');
    expect(await findDataDirs(makeApp(adapter))).toEqual(['bz-reader/storage']);
  });

  it('一层的老布局照旧能找到（两层是在一层之外多扫一轮）', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('我的书库/bz-reader.json', '{}');
    adapter.files.set('bz-reader/storage/bz-reader.json', '{}');
    expect((await findDataDirs(makeApp(adapter))).sort()).toEqual(['我的书库', 'bz-reader/storage'].sort());
  });

  it('三层及以下仍然不猜——扫全库会卡住启动', async () => {
    const adapter = new FakeAdapter();
    adapter.files.set('a/b/更深/bz-reader.json', '{}');
    expect(await findDataDirs(makeApp(adapter))).toEqual([]);
  });
});
