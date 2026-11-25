import { describe, expect, it } from 'vitest';
import type { BookRow } from '../src/shell/adapt';
import { DEFAULT_SHELL_STATE } from '../src/shell/state';
import { viewLibrary } from '../src/shell/render/study';
import { t } from '../src/i18n';

/**
 * 空态不能把筛选栏一起收走（2026-11-25，QQ 群反馈）。
 *
 * 真机两次踩到：把书全「移出书架」后书库显示「书库还是空的」；
 * 停在「已归档」筛选（状态会落 localStorage）而归档里没有书时，
 * 27 本书在架、导入页也标着「已在书架」，书库却还是那一屏空的。
 * 根因是「整库为空」的判定用了当前筛选源的本数，空掉就走纯空态，
 * 分类筛选一消失，用户再也点不到「已归档 / 全部」，恢复入口彻底没了。
 *
 * 这里锁死三件事：只有库里真的一本书都没有才收筛选栏；
 * 筛出来为空时筛选栏一直在；空态给出能走回去的那颗按钮。
 */
function row(patch: Partial<BookRow> = {}): BookRow {
  return {
    id: 'b1',
    title: '围城',
    author: '钱钟书',
    percent: 8,
    status: 'reading',
    fav: false,
    minutes: 12,
    lastText: '今天',
    lastTs: 1,
    shelf: '文学',
    format: 'EPUB',
    coverUrl: null,
    bg: '#4a3a28',
    fg: '#e9dcc3',
    glyph: '围',
    chapterTitle: '第一章',
    noteCount: 0,
    ...patch,
  };
}

describe('书库空态不吞筛选栏', () => {
  it('真·空库（连归档都没有）：仍是那一屏空态，不画筛选栏', () => {
    const out = viewLibrary({
      rows: [],
      total: 0,
      archived: 0,
      state: DEFAULT_SHELL_STATE,
      libraryKey: 'k',
    });
    expect(out).toContain(t('shelf.empty.all'));
    expect(out).not.toContain('bzs-filters');
  });

  it('停在「已归档」但归档里没有书：筛选栏留着，能点回全部', () => {
    const out = viewLibrary({
      rows: [],
      total: 27,
      archived: 0,
      state: { ...DEFAULT_SHELL_STATE, libFilter: 'archived' },
      libraryKey: 'k',
    });
    expect(out).not.toContain(t('shelf.empty.all'));
    expect(out).toContain('bzs-filters');
    expect(out).toContain('data-act="libfilter" data-v="archived"');
    expect(out).toContain(t('shelf.empty.archived'));
    /* 空态里那颗按钮直接把用户送回全部 */
    expect(out).toContain('data-act="libfilter" data-v="all"');
  });

  it('书全被移出书架：不显示空库那屏，给一颗进「已归档」的按钮', () => {
    const out = viewLibrary({
      rows: [],
      total: 3,
      archived: 3,
      state: DEFAULT_SHELL_STATE,
      libraryKey: 'k',
    });
    expect(out).not.toContain(t('shelf.empty.all'));
    expect(out).toContain('bzs-filters');
    expect(out).toContain(t('shelf.empty.onShelf'));
    expect(out).toContain(t('shelf.empty.viewArchived', { n: 3 }));
    expect(out).toContain('data-act="libfilter" data-v="archived"');
  });

  it('有在架书、只是筛选没匹配：空态照旧，不塞归档按钮', () => {
    const out = viewLibrary({
      rows: [],
      total: 5,
      archived: 2,
      state: { ...DEFAULT_SHELL_STATE, libKw: '不存在的书名' },
      libraryKey: 'k',
    });
    expect(out).toContain(t('shelf.empty.none'));
    expect(out).not.toContain(t('shelf.empty.viewArchived', { n: 2 }));
    expect(out).toContain('bzs-filters');
  });

  it('已归档里有书、只是分类筛空：说没有匹配，不谎称归档是空的', () => {
    const out = viewLibrary({
      rows: [],
      total: 9,
      archived: 4,
      state: { ...DEFAULT_SHELL_STATE, libFilter: 'archived', libShelf: '历史' },
      libraryKey: 'k',
    });
    expect(out).toContain(t('shelf.empty.none'));
    expect(out).not.toContain(t('shelf.empty.archived'));
    expect(out).toContain('bzs-filters');
  });

  it('窄屏同样如此：筛选栏不因为空掉而收起', () => {
    const out = viewLibrary({
      rows: [],
      total: 27,
      archived: 0,
      state: { ...DEFAULT_SHELL_STATE, libFilter: 'archived' },
      libraryKey: 'k',
      compact: true,
    });
    expect(out).not.toContain(t('shelf.empty.all'));
    expect(out).toContain('bzs-filters');
    /* 窄屏分类收进下拉，但入口在 */
    expect(out).toContain('data-act="libfiltermenu"');
  });
});
