import { describe, expect, it } from 'vitest';
import { applyMetaEdit, coverSourceOf, isCustomCover, restoreMetaDefaults } from '../src/data/book-edit';
import { applyEngineMeta } from '../src/data/book-meta';
import type { ReaderBook } from '../src/data/schema';

function book(meta: Partial<ReaderBook['meta']> = {}, path = 'Books/三体.epub', format: ReaderBook['fileRef']['format'] = 'epub'): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '书名', ...meta },
    fileRef: { vaultPath: path, format },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

describe('编辑书籍信息：写入字段并记下手动编辑', () => {
  it('书名、作者、简介一起写，三个标记都打上', () => {
    const b = book();
    expect(applyMetaEdit(b, { title: '新名', author: '刘慈欣', description: '一本好书' })).toBe(true);
    expect(b.meta.title).toBe('新名');
    expect(b.meta.author).toBe('刘慈欣');
    expect(b.meta.description).toBe('一本好书');
    expect(b.meta.titleEdited).toBe(true);
    expect(b.meta.authorEdited).toBe(true);
    expect(b.meta.descriptionEdited).toBe(true);
  });

  it('只改简介时不动书名与作者的标记', () => {
    const b = book({ title: '书名', author: '原作者' });
    expect(applyMetaEdit(b, { title: '书名', author: '原作者', description: '新简介' })).toBe(true);
    expect(b.meta.description).toBe('新简介');
    expect(b.meta.descriptionEdited).toBe(true);
    expect(b.meta.titleEdited).toBeUndefined();
    expect(b.meta.authorEdited).toBeUndefined();
  });

  it('什么都没变时返回 false', () => {
    const b = book({ title: '书名', author: '作者', description: '简介' });
    expect(applyMetaEdit(b, { title: '书名', author: '作者', description: '简介' })).toBe(false);
  });

  it('书名留空时保留原书名，不写空', () => {
    const b = book({ title: '原书名' });
    applyMetaEdit(b, { title: '   ', author: '作者', description: '' });
    expect(b.meta.title).toBe('原书名');
  });

  it('作者和简介可以被清空（不是回退成旧值）', () => {
    const b = book({ title: '书名', author: '作者', description: '简介' });
    applyMetaEdit(b, { title: '书名', author: '', description: '' });
    expect(b.meta.author).toBe('');
    expect(b.meta.description).toBe('');
    expect(b.meta.authorEdited).toBe(true);
    expect(b.meta.descriptionEdited).toBe(true);
  });
});

describe('手动编辑过的字段不被引擎元数据覆盖', () => {
  it('改过的作者与简介在打开书时保持原样', () => {
    const b = book({ author: '我填的', authorEdited: true, description: '我写的', descriptionEdited: true });
    applyEngineMeta(b, { title: '原书名', author: '原书作者', description: '原书简介' });
    expect(b.meta.author).toBe('我填的');
    expect(b.meta.description).toBe('我写的');
  });

  it('没改过的作者与简介照常回填', () => {
    const b = book();
    applyEngineMeta(b, { author: '原书作者', description: '原书简介' });
    expect(b.meta.author).toBe('原书作者');
    expect(b.meta.description).toBe('原书简介');
  });

  it('用户清空后标记仍在，引擎也不填回来', () => {
    const b = book({ author: '', authorEdited: true });
    applyEngineMeta(b, { author: '原书作者' });
    expect(b.meta.author).toBe('');
  });
});

describe('还原默认信息', () => {
  it('清掉三个标记，书名回文件名，作者和简介清空', () => {
    const b = book({
      title: '我改的',
      titleEdited: true,
      author: '我填的',
      authorEdited: true,
      description: '我写的',
      descriptionEdited: true,
    });
    restoreMetaDefaults(b);
    expect(b.meta.title).toBe('三体');
    expect(b.meta.author).toBe('');
    expect(b.meta.description).toBe('');
    expect(b.meta.titleEdited).toBeUndefined();
    expect(b.meta.authorEdited).toBeUndefined();
    expect(b.meta.descriptionEdited).toBeUndefined();
    expect(b.updatedAt).toBeGreaterThan(1);
  });

  it('剪藏本没有文件名：保留原书名，只清标记与作者简介', () => {
    const b = book({ title: '剪藏本', titleEdited: true, author: '我填的', authorEdited: true }, '', 'txt');
    b.meta.clipBook = true;
    restoreMetaDefaults(b);
    expect(b.meta.title).toBe('剪藏本');
    expect(b.meta.author).toBe('');
    expect(b.meta.titleEdited).toBeUndefined();
    expect(b.meta.authorEdited).toBeUndefined();
  });
});

describe('封面来源', () => {
  it('自定义封面：coverEdited 为真且有路径', () => {
    const b = book({ coverEdited: true, coverPath: 'bz-reader/storage/covers/custom-b1.jpg' });
    expect(isCustomCover(b)).toBe(true);
    expect(coverSourceOf(b)).toBe('custom');
  });

  it('原书封面：没有自定义标记但有缓存路径', () => {
    const b = book({ coverPath: 'bz-reader/storage/covers/b1-123.jpg' });
    expect(isCustomCover(b)).toBe(false);
    expect(coverSourceOf(b)).toBe('builtin');
  });

  it('TXT 没有原书封面', () => {
    const b = book({}, 'Books/笔记.txt', 'txt');
    expect(coverSourceOf(b)).toBe('none');
  });

  it('TXT 也能有自定义封面', () => {
    const b = book({ coverEdited: true, coverPath: 'bz-reader/storage/covers/custom-b1.png' }, 'Books/笔记.txt', 'txt');
    expect(coverSourceOf(b)).toBe('custom');
  });

  it('coverEdited 为真但路径丢了：不算自定义', () => {
    const b = book({ coverEdited: true });
    expect(isCustomCover(b)).toBe(false);
    expect(coverSourceOf(b)).toBe('builtin');
  });
});
