import { afterEach, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { BookRepo, makeBook } from '../src/data/book-repo';
import { sanitizeData } from '../src/data/store';
import { toRow } from '../src/shell/adapt';
import { liveBooks, setShellSource, type ShellSource } from '../src/shell/source';

function book(path: string) {
  return makeBook(path, 'epub', 100);
}

afterEach(() => {
  setShellSource(null);
});

/**
 * 「移出书架」= 归档：只打一个时间戳，进度、划线、书签、想法、会话
 * 一条都不删。重新导入同一份文件（路径或指纹命中）就复活。
 */
describe('移出书架 = 归档，数据一条不删', () => {
  it('archive 只打标记：记录、进度、划线都还在', () => {
    const b = book('书/a.epub');
    b.reading.position.percent = 0.42;
    b.notes.highlights.push({ id: 'h1', text: '划线', createdAt: 1 });
    const repo = new BookRepo([b]);

    repo.archive(b);

    expect(b.archivedAt).toBeGreaterThan(0);
    expect(repo.all()).toHaveLength(1);
    expect(b.reading.position.percent).toBe(0.42);
    expect(b.notes.highlights).toHaveLength(1);
  });

  it('归档书不参与「继续阅读」', () => {
    const a = book('书/a.epub');
    a.reading.stats.lastReadTime = Date.now();
    const b = book('书/b.epub');
    const repo = new BookRepo([a, b]);

    repo.archive(a);

    expect(repo.recent(1)[0]?.id).toBe(b.id);
  });

  it('重新导入同一份文件（按路径）：复活，进度原样', () => {
    const b = book('书/a.epub');
    b.reading.position.percent = 0.3;
    const repo = new BookRepo([b]);
    repo.archive(b);

    const got = repo.ensure('书/a.epub', 'epub', 100);

    expect(got.revived).toBe(true);
    expect(got.created).toBe(false);
    expect(b.archivedAt).toBeUndefined();
    expect(b.reading.position.percent).toBe(0.3);
  });

  it('重新导入同一份文件（换了路径，按指纹）：复活并指向新路径', () => {
    const b = book('书/a.epub');
    b.fileRef.fingerprint = 'v1-abc';
    const repo = new BookRepo([b]);
    repo.archive(b);

    const got = repo.ensure('书/新/a.epub', 'epub', 100, 'v1-abc');

    expect(got.revived).toBe(true);
    expect(got.pathChanged).toBe(true);
    expect(b.archivedAt).toBeUndefined();
  });

  it('没归档的书再登记不会被误报成复活', () => {
    const b = book('书/a.epub');
    const repo = new BookRepo([b]);

    const got = repo.ensure('书/a.epub', 'epub', 100);

    expect(got.revived).toBeFalsy();
  });
});

describe('归档与失联标记要能落盘、读回来', () => {
  it('sanitize 保留 archivedAt 与 fileRef.fileMissing', () => {
    const data = sanitizeData({
      version: 1,
      schemaVersion: 3,
      books: [
        {
          id: 'b1',
          meta: { title: '书' },
          fileRef: { vaultPath: 'a.epub', format: 'epub', fileMissing: true },
          reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
          notes: { highlights: [], excerpts: [], bookmarks: [] },
          addedAt: 1,
          updatedAt: 1,
          archivedAt: 123,
        },
      ],
    });

    expect(data?.books[0]?.archivedAt).toBe(123);
    expect(data?.books[0]?.fileRef.fileMissing).toBe(true);
  });
});

describe('书架视图：归档的下去，失联的留下', () => {
  it('liveBooks 过滤归档、保留失联（失联书要能被用户处理）', () => {
    const fine = book('书/fine.epub');
    const gone = book('书/gone.epub');
    gone.fileRef.fileMissing = true;
    const archived = book('书/archived.epub');
    archived.archivedAt = 1;

    setShellSource({ repo: { all: () => [fine, gone, archived] } } as unknown as ShellSource);

    expect(liveBooks().map((b) => b.id)).toEqual([fine.id, gone.id]);
  });

  it('toRow 把失联状态带到书卡上（角标与压暗靠它）', () => {
    const b = book('书/gone.epub');
    b.fileRef.fileMissing = true;
    const app = { vault: { adapter: { getResourcePath: () => '' } } } as unknown as App;

    expect(toRow(app, b).missing).toBe(true);
    expect(toRow(app, book('书/fine.epub')).missing).toBe(false);
  });
});
