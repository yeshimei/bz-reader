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
import { viewSearch } from './render/search';
import { viewNotes } from './render/notes';
import { viewStats, viewStatsLocked } from './render/stats';
import { KEY_COMMANDS, viewSettings } from './render/settings';
import { readHotkeys } from '../core/hotkeys';
import { isMobileShell } from '../core/mobile';

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
    case 'search':
      /* 整页搜索：表单与结果都在这里出，输入时由 ShelfPanel 就地换命中列表 */
      return { body: viewSearch(), counts };
    case 'import':
      /* 导入页是命令式的（扫描、勾选、写入都是行为），这里只给挂载点，
         ShelfPanel 画完这一页后把 mountImport 挂进来。 */
      return { body: '<div class="bzs-import-host" data-role="importhost"></div>', counts };
    case 'notes':
      return {
        body: viewNotes({
          marks,
          filter: state.noteFilter,
          kw: state.noteKw,
          reviewIdx: state.reviewIdx,
          select: state.noteSelect,
          picked: state.noteSel,
        }),
        counts,
      };
    case 'stats': {
      // 统计是付费项：锁着就给锁态，别让整页空白像坏了
      const src = getShellSource();
      return {
        body: can('stats')
          ? viewStats({
              stats: collectStats(books),
              books,
              goal: state.goal,
              checkins: src?.store.get().checkins,
              dailyGoalMinutes: src?.store.get().dailyGoalMinutes,
            })
          : viewStatsLocked(),
        counts,
      };
    }
    case 'settings':
      return {
        body: viewSettings({
          prefs: shellPrefs(),
          settings: shellSettings(),
          pen: state.pen,
          hotkeys: readHotkeys(app, KEY_COMMANDS),
          relicense: state.relicense,
        }),
        counts,
      };
    default:
      return {
        body: viewLibrary({
          rows: shown,
          total: books.length,
          state,
          libraryKey: state.libShelf + state.libFilter + state.libView,
          mobile: isMobileShell(),
        }),
        counts,
      };
  }
}
