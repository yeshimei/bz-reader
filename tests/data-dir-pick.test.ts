import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { collectDataDirCandidates, pickDataDir } from '../src/core/data-dir-pick';
import { FakeAdapter } from './helpers/fake-adapter';

function appWith(adapter: FakeAdapter): App {
  return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
}

function payload(books: number): string {
  return JSON.stringify({
    version: 1,
    books: Array.from({ length: books }, (_, i) => ({ id: `b${i}` })),
  });
}

describe('多数据目录的候选读取（A-30）', () => {
  it('读每个目录里的书数与文件 mtime；坏 JSON 记 0 本', async () => {
    const adapter = new FakeAdapter();
    await adapter.write('甲/bz-reader.json', payload(2));
    await adapter.write('乙/bz-reader.json', '{ 半截');
    adapter.mtimes.set('甲/bz-reader.json', 10);
    adapter.mtimes.set('乙/bz-reader.json', 20);

    const got = await collectDataDirCandidates(appWith(adapter), ['甲', '乙']);

    expect(got).toEqual([
      { dir: '甲', books: 2, mtime: 10 },
      { dir: '乙', books: 0, mtime: 20 },
    ]);
  });

  it('目录里根本没有 JSON 时记 0 本、mtime 0', async () => {
    const adapter = new FakeAdapter();
    const got = await collectDataDirCandidates(appWith(adapter), ['空目录']);
    expect(got).toEqual([{ dir: '空目录', books: 0, mtime: 0 }]);
  });
});

describe('挑数据目录（A-30）', () => {
  it('书最多的赢，不按扫描顺序盲选', () => {
    const pick = pickDataDir([
      { dir: '旧库', books: 1, mtime: 100 },
      { dir: '主库', books: 5, mtime: 1 },
    ]);
    expect(pick).toEqual({ dir: '主库', ambiguous: false });
  });

  it('书数并列时取更晚写过的数据文件', () => {
    const pick = pickDataDir([
      { dir: '旧库', books: 3, mtime: 100 },
      { dir: '新库', books: 3, mtime: 200 },
    ]);
    expect(pick).toEqual({ dir: '新库', ambiguous: false });
  });

  it('书数与 mtime 都并列时不猜：交给用户去设置里选', () => {
    const pick = pickDataDir([
      { dir: '甲', books: 2, mtime: 50 },
      { dir: '乙', books: 2, mtime: 50 },
    ]);
    expect(pick).toEqual({ dir: null, ambiguous: true });
  });

  it('没有候选时什么都不做', () => {
    expect(pickDataDir([])).toEqual({ dir: null, ambiguous: false });
  });
});
