import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { DEFAULT_SHELL_STATE } from '../src/shell/state';
import { buildShelfPage, shelfRenderKey } from '../src/shell/shelf-page';

/* ============================================================
 * 书架什么时候该重画（D4）。
 *
 * 壳层状态每写一次都广播（开浮层、切侧栏页签、阅读器翻页），书架在后台
 * 也会整页重画。指纹的职责只有两条：
 *   1. 内容真的变了 → 必须不一样（漏一项就是界面不更新，比卡顿严重得多）；
 *   2. 内容没变 → 必须一样（否则等于没做）。
 * ============================================================ */

function book(patch: Partial<ReaderBook> = {}): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '红楼梦', author: '曹雪芹' },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: {
      position: { percent: 0.08, chapterTitle: '第一回' },
      stats: { totalReadTime: 720, lastReadTime: 1000 },
      sessions: [],
    },
    notes: {
      highlights: [
        {
          id: 'm1',
          text: '假作真时真亦假',
          cfiRange: 'cfi-1',
          chapterTitle: '第一回',
          color: 'amber',
          createdAt: 1,
        },
      ],
      excerpts: [],
      bookmarks: [],
    },
    addedAt: 1,
    updatedAt: 2,
    notesUpdatedAt: 2,
    ...patch,
  };
}

const lib = { ...DEFAULT_SHELL_STATE, studyPage: 'library' as const };

describe('重绘指纹：不变的', () => {
  it('同样的状态与同样的书 → 同一个指纹', () => {
    expect(shelfRenderKey(lib, [book()])).toBe(shelfRenderKey({ ...lib }, [book()]));
  });

  it('书库与笔记两页都出指纹（这两页才值得跳过重绘）', () => {
    expect(shelfRenderKey(lib, [book()])).not.toBe('');
    expect(shelfRenderKey({ ...lib, studyPage: 'notes' }, [book()])).not.toBe('');
  });

  /* 设置 / 统计还依赖插件设置、热键、bz 探测结果，这些不在 state + books 里；
     宁可重画也不给一份不更新的界面。空串 = 调用方每次都画。 */
  it('设置页与统计页不出指纹', () => {
    expect(shelfRenderKey({ ...lib, studyPage: 'settings' }, [book()])).toBe('');
    expect(shelfRenderKey({ ...lib, studyPage: 'stats' }, [book()])).toBe('');
  });
});

describe('重绘指纹：变了的', () => {
  const differs = (a: string, b: string): void => expect(a).not.toBe(b);

  it('换页', () => {
    differs(shelfRenderKey(lib, [book()]), shelfRenderKey({ ...lib, studyPage: 'notes' }, [book()]));
  });

  it('筛选 / 排序 / 视图 / 分组 / 搜索词', () => {
    const base = shelfRenderKey(lib, [book()]);
    differs(base, shelfRenderKey({ ...lib, libFilter: 'fav' }, [book()]));
    differs(base, shelfRenderKey({ ...lib, libSort: 'title' }, [book()]));
    differs(base, shelfRenderKey({ ...lib, libView: 'list' }, [book()]));
    differs(base, shelfRenderKey({ ...lib, libShelf: '小说' }, [book()]));
    differs(base, shelfRenderKey({ ...lib, libKw: '红' }, [book()]));
    differs(base, shelfRenderKey({ ...lib, libSearchOpen: true }, [book()]));
  });

  it('笔记页的筛选、勾选与回顾位置', () => {
    const notes = { ...lib, studyPage: 'notes' as const };
    const base = shelfRenderKey(notes, [book()]);
    differs(base, shelfRenderKey({ ...notes, noteFilter: 'comment' }, [book()]));
    differs(base, shelfRenderKey({ ...notes, noteKw: '假' }, [book()]));
    differs(base, shelfRenderKey({ ...notes, noteSelect: true }, [book()]));
    differs(base, shelfRenderKey({ ...notes, noteSel: ['m1'] }, [book()]));
    differs(base, shelfRenderKey({ ...notes, reviewIdx: 3 }, [book()]));
  });

  it('窄屏与宽屏是两种版式', () => {
    differs(shelfRenderKey(lib, [book()], false), shelfRenderKey(lib, [book()], true));
  });

  it('收藏缓存与分组缓存（hydrateLibrary 灌进 state 的那份）', () => {
    const base = shelfRenderKey(lib, [book()]);
    differs(base, shelfRenderKey({ ...lib, favIds: ['b1'] }, [book()]));
    differs(base, shelfRenderKey({ ...lib, shelves: { b1: '小说' } }, [book()]));
  });

  it('阅读进度', () => {
    const base = shelfRenderKey(lib, [book()]);
    const moved = book();
    moved.reading.position.percent = 0.4;
    differs(base, shelfRenderKey(lib, [moved]));
  });

  it('标注增删（notesUpdatedAt 推动）', () => {
    const base = shelfRenderKey(lib, [book()]);
    const edited = book();
    edited.notes.highlights.push({
      id: 'm2',
      text: '无为有处有还无',
      cfiRange: 'cfi-2',
      createdAt: 3,
    });
    edited.notesUpdatedAt = 3;
    differs(base, shelfRenderKey(lib, [edited]));
  });

  /* 指纹里补了书摘 / 书签条数：不经过 notesUpdatedAt 也得能看见变化。 */
  it('书摘 / 书签条数变化也算内容变了', () => {
    const base = shelfRenderKey(lib, [book()]);
    const excerpted = book();
    excerpted.notes.excerpts.push({ id: 'x1', text: '好一似食尽鸟投林', createdAt: 3 });
    differs(base, shelfRenderKey(lib, [excerpted]));

    const marked = book();
    marked.notes.bookmarks.push({ id: 'k1', percent: 0.3, createdAt: 3 });
    differs(base, shelfRenderKey(lib, [marked]));
  });

  it('书名被引擎回填 / 用户改名（不碰 updatedAt）', () => {
    const base = shelfRenderKey(lib, [book()]);
    const renamed = book();
    renamed.meta.title = '石头记';
    differs(base, shelfRenderKey(lib, [renamed]));
  });

  it('移出书架 / 文件失联 / 读完', () => {
    const base = shelfRenderKey(lib, [book()]);
    differs(base, shelfRenderKey(lib, [book({ archivedAt: 9 })]));
    const missing = book();
    missing.fileRef.fileMissing = true;
    differs(base, shelfRenderKey(lib, [missing]));
    const done = book();
    done.reading.stats.completedTime = 5;
    differs(base, shelfRenderKey(lib, [done]));
  });

  it('少一本书', () => {
    differs(shelfRenderKey(lib, [book()]), shelfRenderKey(lib, []));
  });
});

describe('页签计数不再为了一个数字拍平全库标注', () => {
  const two = [
    book(),
    book({
      id: 'b2',
      meta: { title: '西游记', author: '吴承恩' },
      notes: { highlights: [], excerpts: [], bookmarks: [] },
    }),
  ];

  it('书库页的笔记数就是全库划线条数', () => {
    const page = buildShelfPage(lib, two, false);
    expect(page.counts).toEqual({ books: 2, notes: 1 });
  });

  it('笔记页照样列出每一条（省的是别的页，不是这一页）', () => {
    const page = buildShelfPage({ ...lib, studyPage: 'notes' }, two, false);
    expect(page.counts.notes).toBe(1);
    expect(page.body).toContain('假作真时真亦假');
  });
});
