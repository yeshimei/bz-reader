/* ============================================================
 * bz-reader · 书架页体（shell/shelf-page.ts）
 *
 * 「书架这一页画什么」只写一遍。
 *
 * 把纯渲染部分抽出来的原因只有一个：承载方式改过两次（中心 tab → 侧栏
 * → 又回到中心 tab），每次都是整页 UI 跟着搬。现在输入是「状态 + 书」、
 * 输出是 HTML，谁承载谁负责挂，再换容器不用重写这一页。
 * ============================================================ */
import type { ReaderBook } from '../data/schema';
import { collectStats } from '../data/stats';
import { can } from '../data/entitlement';
import { filterRows, toRows } from './adapt';
import { allMarks } from './domain';
import type { ShellState } from './state';
import { getShellSource, shellPrefs, shellSettings } from './source';
import { viewLibrary, type StudyCounts } from './render/study';
import { viewNotes } from './render/notes';
import { viewStats, viewStatsLocked } from './render/stats';
import { KEY_COMMANDS, viewSettings } from './render/settings';
import { readHotkeys } from '../core/hotkeys';

export interface ShelfPage {
  body: string;
  counts: StudyCounts;
}

/** 书架某一页的 HTML。数据全部来自 store，不在这里做二次加工 */
export function buildShelfPage(state: ShellState, books: ReaderBook[]): ShelfPage {
  const app = getShellSource()?.app;
  const rows = app ? toRows(app, books) : [];
  const shown = filterRows(rows, state);
  const marks = allMarks(books);
  const counts: StudyCounts = { books: books.length, notes: marks.length };

  switch (state.studyPage) {
    case 'notes':
      return {
        body: viewNotes({ marks, filter: state.noteFilter, kw: state.noteKw, reviewIdx: state.reviewIdx }),
        counts,
      };
    case 'stats':
      // 统计是付费项：锁着就给锁态，别让整页空白像坏了
      return {
        body: can('stats') ? viewStats({ stats: collectStats(books), books, goal: state.goal }) : viewStatsLocked(),
        counts,
      };
    case 'settings':
      return {
        body: viewSettings({
          prefs: shellPrefs(),
          settings: shellSettings(),
          pen: state.pen,
          hotkeys: readHotkeys(app, KEY_COMMANDS),
        }),
        counts,
      };
    default:
      return {
        body: viewLibrary({ rows: shown, state, libraryKey: state.libShelf + state.libFilter + state.libView }),
        counts,
      };
  }
}
