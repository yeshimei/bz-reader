import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { importDetailed, importFiles } from '../src/data/importer';
import { fingerprintOf } from '../src/data/fingerprint';
import { BookRepo } from '../src/data/book-repo';
import { FakeAdapter } from './helpers/fake-adapter';

function makeApp(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function file(name: string, text = 'x'): File {
  return new File([text], name);
}

/**
 * A-17：`writeBinary` 抛错时导入流程必须落定。
 *
 * 以前这里是 change 回调里一个裸 async IIFE：任何一步 reject 都没人接，
 * pickAndImport 返回的 Promise 永远 pending，导入面板停在「正在写入…」。
 * 抽出来的 importFiles 是那段循环的可测内核：失败也要 resolve（已写入的
 * 部分照常返回），并且后续文件还能继续写。
 */
describe('本地文件导入（A-17）', () => {
  it('第二个文件写失败：Promise 落定，返回已写入的第一个，并继续写第三个', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const original = adapter.writeBinary.bind(adapter);
    let calls = 0;
    adapter.writeBinary = async (path: string, data: ArrayBuffer) => {
      calls += 1;
      if (calls === 2) throw new Error('EIO: disk full');
      await original(path, data);
    };

    const written = await importFiles(app, [file('a.epub'), file('b.epub'), file('c.epub')], ['epub'], 'Books');

    expect(written).toEqual(['Books/a.epub', 'Books/c.epub']);
    expect(adapter.files.has('Books/a.epub')).toBe(true);
    expect(adapter.files.has('Books/b.epub')).toBe(false);
    expect(adapter.files.has('Books/c.epub')).toBe(true);
  });

  it('第一个文件就写失败：返回空数组，不 reject，也不留下半截文件', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    adapter.writeBinary = async () => {
      throw new Error('EACCES: permission denied');
    };

    const written = await importFiles(app, [file('a.epub')], ['epub'], 'Books');

    expect(written).toEqual([]);
    expect(adapter.files.size).toBe(0);
  });

  it('只写 accept 允许的扩展名，写进指定文件夹', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);

    const written = await importFiles(app, [file('a.epub'), file('b.pdf')], ['epub'], 'Inbox');

    expect(written).toEqual(['Inbox/a.epub']);
    expect(adapter.files.has('Inbox/a.epub')).toBe(true);
    expect(adapter.files.has('Inbox/b.pdf')).toBe(false);
  });
});

/**
 * 同一份文件只能进书架一次：导入前先算指纹、查已有记录，命中就不写盘。
 *
 * 以前是「先写盘（重名存成 (2)）再按路径登记」，所以同一本书导入两次
 * 就是两个文件、两条记录、两份进度。
 */
describe('导入前按指纹查重', () => {
  it('库里已有同一份内容：不写盘、不产生副本，直接复用原路径', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const repo = new BookRepo([]);
    const content = new Uint8Array([1, 2, 3, 4]);
    await adapter.writeBinary('Books/原书.epub', content.buffer);
    repo.ensure('Books/原书.epub', 'epub', content.length, fingerprintOf(content) ?? undefined);

    const results = await importDetailed(app, [new File([content], '原书.epub')], ['epub'], 'Books', repo);

    expect(results).toHaveLength(1);
    expect(results[0]!.reused).toBe(true);
    expect(results[0]!.written).toBe(false);
    expect(results[0]!.path).toBe('Books/原书.epub');
    expect(adapter.files.has('Books/原书 (2).epub')).toBe(false);
  });

  it('记录还在但文件没了：照常写盘，让这条记录重新有文件可用', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const repo = new BookRepo([]);
    const content = new Uint8Array([9, 9, 9]);
    const fp = fingerprintOf(content);
    repo.ensure('Books/丢了.epub', 'epub', content.length, fp ?? undefined);

    const results = await importDetailed(app, [new File([content], '丢了.epub')], ['epub'], 'Books', repo);

    expect(results[0]!.written).toBe(true);
    expect(results[0]!.reused).toBe(false);
    expect(results[0]!.path).toBe('Books/丢了.epub');
    expect(results[0]!.fingerprint).toBe(fp);
  });

  it('没有书库可查时按老规矩写盘，并把指纹一起带回去', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const content = new Uint8Array([5, 5]);

    const results = await importDetailed(app, [new File([content], 'a.epub')], ['epub'], 'Books');

    expect(results[0]!.written).toBe(true);
    expect(results[0]!.fingerprint).toBe(fingerprintOf(content));
  });

  it('同一批里两个同内容文件：第二个不再写盘', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const repo = new BookRepo([]);
    const content = new Uint8Array([7, 7, 7]);
    const fp = fingerprintOf(content) ?? undefined;

    const first = await importDetailed(app, [new File([content], 'a.epub')], ['epub'], 'Books', repo);
    repo.ensure(first[0]!.path, 'epub', content.length, fp);
    const second = await importDetailed(app, [new File([content], 'b.epub')], ['epub'], 'Books', repo);

    expect(second[0]!.reused).toBe(true);
    expect(second[0]!.written).toBe(false);
    expect([...adapter.files.keys()].filter((p) => p.endsWith('.epub'))).toHaveLength(1);
  });
});
/* ── A12：超大文件先看 size，不要 arrayBuffer ────────────────── */

describe('超大文件（A12）', () => {
  /** 只实现 size 的假 File：真 File 装不下 300MB 的数组 */
  function sized(name: string, size: number, spy: { calls: number }): File {
    return {
      name,
      size,
      arrayBuffer: async () => {
        spy.calls += 1;
        return new ArrayBuffer(0);
      },
    } as unknown as File;
  }

  it('超过 300MB 直接跳过：不调用 arrayBuffer，也不写盘', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const spy = { calls: 0 };
    const out = await importDetailed(app, [sized('巨无霸.epub', 400 * 1024 * 1024, spy)], ['epub'], 'Books');

    expect(spy.calls).toBe(0);
    expect(out).toEqual([]);
    expect(adapter.writes).toEqual([]);
  });

  it('刚好 300MB 仍然导入（边界只挡超过的）', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp(adapter);
    const spy = { calls: 0 };
    const out = await importDetailed(app, [sized('临界.epub', 300 * 1024 * 1024, spy)], ['epub'], 'Books');

    expect(spy.calls).toBe(1);
    expect(out.map((r) => r.written)).toEqual([true]);
  });
});
