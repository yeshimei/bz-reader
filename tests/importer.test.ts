import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { importFiles } from '../src/data/importer';
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
