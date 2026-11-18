import { describe, expect, it } from 'vitest';
import { BookRepo, makeBook } from '../src/data/book-repo';
import { sanitizeData } from '../src/data/store';
import { hydrateLibrary, getState } from '../src/shell/state';
import { shelfOf, shelvesOf } from '../src/shell/domain';

/**
 * 彻底删除（2026-11-18）：连书记录与全部数据一起删，「曾经在书架」的痕迹
 * 也清除。区别于「移出书架」（只打归档标记、数据全留、可复活）。
 *
 * 书籍源文件与已导出的笔记不由数据层管理，这里只验数据层的删除与缓存清理。
 */
describe('彻底删除一本书', () => {
  function setup() {
    const a = makeBook('书/A.epub', 'epub');
    a.id = 'a';
    a.shelf = '在读';
    a.shelves = ['在读', '想看'];
    a.favorite = true;
    const b = makeBook('书/B.epub', 'epub');
    b.id = 'b';
    b.shelf = '在读';
    const repo = new BookRepo([a, b]);
    hydrateLibrary([a, b], 20, ['在读', '想看']);
    return { a, b, repo };
  }

  it('remove 真的把书从记录里移除，而不是打归档标记', () => {
    const { a, repo } = setup();
    expect(repo.remove('a')).toBe(true);
    expect(repo.byId('a')).toBeUndefined();
    expect(repo.all().map((x) => x.id)).toEqual(['b']);
  });

  it('再删一次返回 false（幂等、不报错）', () => {
    const { repo } = setup();
    expect(repo.remove('a')).toBe(true);
    expect(repo.remove('a')).toBe(false);
  });

  it('删后重建缓存：收藏与分类索引里不再有这本书', () => {
    const { repo } = setup();
    repo.remove('a');
    hydrateLibrary(repo.all(), getState().goal, getState().shelfList);
    expect(getState().favIds).not.toContain('a');
    expect(getState().shelves['a']).toBeUndefined();
    expect(getState().bookShelves['a']).toBeUndefined();
  });

  it('序列化后不再含被删书：痕迹彻底清除', () => {
    const { repo } = setup();
    repo.remove('a');
    const data = sanitizeData({ version: 1, schemaVersion: 3, books: repo.all() });
    expect(data?.books.map((x) => x.id)).toEqual(['b']);
  });

  it('删掉归档书也生效（不只是书架上的书）', () => {
    const { repo } = setup();
    const archived = makeBook('书/C.epub', 'epub');
    archived.id = 'c';
    archived.archivedAt = Date.now();
    repo.all().push(archived);
    expect(repo.remove('c')).toBe(true);
    expect(repo.byId('c')).toBeUndefined();
  });
});
