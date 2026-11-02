/* ============================================================
 * bz-reader · 书架页体（shell/shelf-page.ts）
 *
 * 「书架这一页画什么」只写一遍。
 *
 * 以前书架的渲染内核在 StudySurface 里，只有中心 tab 与手机弹窗用得上；
 * 现在书架搬进原生侧栏，SideView 也要画同一页，于是把纯渲染部分抽出来：
 * 输入状态与书，输出 HTML。谁承载（侧栏 / 任何将来的容器）谁负责挂。
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
