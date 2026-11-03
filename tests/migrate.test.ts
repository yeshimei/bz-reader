import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { copyTree, dirHasFiles, removeTree } from '../src/data/migrate';
import { FakeAdapter } from './helpers/fake-adapter';

function makeApp(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
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
