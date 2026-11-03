import { describe, expect, it } from 'vitest';
import { applyEngineMeta } from '../src/data/book-meta';
import type { ReaderBook } from '../src/data/schema';

function book(meta: Partial<ReaderBook['meta']> = {}): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '书名', ...meta },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

describe('打开书时回填引擎元数据', () => {
  it('没改过名：采用文件里的书名', () => {
    const b = book({ title: 'a' });
    expect(applyEngineMeta(b, { title: '真正的书名' })).toBe(true);
    expect(b.meta.title).toBe('真正的书名');
  });

  it('改过名：文件里的旧书名不再覆盖，作者/字数照旧回填', () => {
    const b = book({ title: '我改的名字', titleEdited: true });
    applyEngineMeta(b, { title: '旧书名', author: '作者', wordCount: 12000 });
    expect(b.meta.title).toBe('我改的名字');
    expect(b.meta.author).toBe('作者');
    expect(b.meta.wordCount).toBe(12000);
  });

  it('没有变化时返回 false（调用方不必重绘）', () => {
    const b = book({ title: '同名', author: '作者', wordCount: 5 });
    expect(applyEngineMeta(b, { title: '同名', author: '作者', wordCount: 5 })).toBe(false);
  });
});
