import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DATA_DIR, dataDirOf, setDataDir } from '../src/core/plugin-path';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeApp, makePlugin, testBook } from './helpers/plugin-harness';

/** 有一个文件读失败，用来模拟「复制中途断掉」 */
class FlakyAdapter extends FakeAdapter {
  failRead = '';

  async readBinary(path: string): Promise<ArrayBuffer> {
    if (path === this.failRead) throw new Error('read failed');
    return super.readBinary(path);
  }
}

describe('换数据目录（A-22）', () => {
  it('复制有文件失败时清掉目标目录的半份副本，别把下一次迁移挡住', async () => {
    const adapter = new FlakyAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    await adapter.write(
      `${DEFAULT_DATA_DIR}/bz-reader.json`,
      JSON.stringify({ version: 1, books: [testBook('a')] }),
    );
    await adapter.write(`${DEFAULT_DATA_DIR}/covers/a.jpg`, 'image');
    adapter.failRead = `${DEFAULT_DATA_DIR}/covers/a.jpg`;

    const app = makeApp({ adapter });
    const plugin = makePlugin(app);
    plugin.repo = {
      all: () => plugin.store.get().books,
      byId: (id: string) =>
        (plugin.store.get().books as Array<{ id: string }>).find((b) => b.id === id) ?? null,
    };
    plugin.store.get().books = [testBook('a')];

    const res = await plugin.migrateDataDir('新目录');

    expect(res.ok).toBe(false);
    expect(res.message).toContain('没复制成功');
    expect([...adapter.files.keys()].some((p) => p.startsWith('新目录/'))).toBe(false);
    expect([...adapter.dirs].some((d) => d === '新目录' || d.startsWith('新目录/'))).toBe(false);
    expect(dataDirOf()).toBe(DEFAULT_DATA_DIR);
    expect(plugin.store.load).not.toHaveBeenCalled();
  });

  it('复制成功才切指针并删旧目录', async () => {
    const adapter = new FakeAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    await adapter.write(
      `${DEFAULT_DATA_DIR}/bz-reader.json`,
      JSON.stringify({ version: 1, books: [testBook('a')] }),
    );
    const app = makeApp({ adapter });
    const plugin = makePlugin(app);
    plugin.store.get().books = [testBook('a')];

    const res = await plugin.migrateDataDir('新目录');

    expect(res.ok).toBe(true);
    expect(dataDirOf()).toBe('新目录');
    expect(plugin.cfg.dataDir).toBe('新目录');
    expect(adapter.files.has(`${DEFAULT_DATA_DIR}/bz-reader.json`)).toBe(false);
  });

  /**
   * A5：封面缓存跟着数据目录走（`covers/`），迁移完 `meta.coverPath` 就全是
   * 旧目录的死路径。书架自己能重解，外部（bz 书库）拿它当图片读是永久空白。
   */
  it('迁移成功后清掉所有 coverPath，并落盘', async () => {
    const adapter = new FakeAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    const b = testBook('a');
    b.meta.coverPath = `${DEFAULT_DATA_DIR}/covers/a-10.jpg`;
    await adapter.write(
      `${DEFAULT_DATA_DIR}/bz-reader.json`,
      JSON.stringify({ version: 1, books: [b] }),
    );
    await adapter.write(`${DEFAULT_DATA_DIR}/covers/a-10.jpg`, 'image');

    const app = makeApp({ adapter });
    const plugin = makePlugin(app);
    plugin.store.get().books = [b];

    const res = await plugin.migrateDataDir('新目录');
    expect(res.ok).toBe(true);
    /* 迁移完 load() 会把新目录那份读回来（那里也带着旧路径），迁移流程
       必须在 load 之后清一遍，否则这次清完下次启动又被读回来。 */
    expect(plugin.store.get().books.every((x) => !x.meta.coverPath)).toBe(true);
    expect(plugin.store.touch).toHaveBeenCalled();
  });
});
