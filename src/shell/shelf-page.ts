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
import { t } from '../i18n';
import { collectStats } from '../data/stats';
import { can } from '../data/entitlement';
import { filterRows, toRows } from './adapt';
import { allMarks } from './domain';
import type { ShellState } from './state';
import { getShellSource, shellPrefs, shellSettings } from './source';
import { bzSnapshot } from '../data/bz-bridge';
import { findReviewApi } from '../data/review-bridge';
import { viewLibrary, type StudyCounts } from './render/study';
import { viewSearch } from './render/search';
import { viewNotes } from './render/notes';
import { historyConfirmLayer, viewHistory, type AiKindFilter } from './render/history';
import { aiSessionCount, aiSessions } from '../data/ai-session';
import { viewStats, viewStatsLocked } from './render/stats';
import { getStatsUi } from './stats-ui';
import { KEY_COMMANDS, viewSettings } from './render/settings';
import { readHotkeys } from '../core/hotkeys';

export interface ShelfPage {
  body: string;
  counts: StudyCounts;
  /**
   * 页面级图层（盖住整个书架的一层，比如对话页的导出确认）。
   *
   * 不塞进 `body` 的原因：`body` 落在可滚动的 `.bzs-stubody` 里，
   * 遮罩用 `absolute; inset: 0` 只能盖住内容区，盖不到头栏与页签。
   * studyShell 把它挂在 `.bzs-studio` 下，位置才对得上原型。
   */
  layer?: string;
}

/** 这几页的内容完全由 state + books 决定，可以安全跳过重复重绘 */
const DEDUP_PAGES: readonly string[] = ['library', 'notes', 'ai'];

/**
 * 书架重绘指纹（D4）。
 *
 * 壳层状态每次写入都广播（开浮层、切侧栏页签、阅读器翻页……），书架哪怕
 * 在后台也照画一遍整页 HTML——封面墙几十本书时这一下是实打实的掉帧。
 * 这里把「这一页会画成什么样」压成一个字符串，一样就不重画。
 *
 * 只给书库 / 笔记两页出指纹：统计与设置页还依赖插件设置、热键、bz 探测
 * 结果，那两页很便宜，宁可重画也不留一份不更新的界面。其余页返回空串，
 * 调用方按「空串 = 每次都画」处理。
 *
 * 书的指纹里**没有**逐条标注内容：标注的增删改一律经 data/notes.ts，
 * 那里每次都会推 `notesUpdatedAt`。真正会绕开它的只有引擎回填元数据
 * （`applyEngineMeta`），所以 title / author 单列。
 */
export function shelfRenderKey(state: ShellState, books: ReaderBook[], compact = false): string {
  if (!DEDUP_PAGES.includes(state.studyPage)) return '';
  const s = [
    state.studyPage,
    state.libFilter,
    state.libSort,
    state.libView,
    state.libShelf,
    state.libKw,
    state.libSearchOpen ? '1' : '0',
    /* 书库多选：勾选圈、已选本数、批量按钮的禁用态都长在这一页。
       漏了这两项，点一下卡片看着没反应，再点一下才连跳两格。 */
    state.libSelect ? '1' : '0',
    state.libSel.join(','),
    /* 搜索方式切换是同一页里的可见变化：不进指纹，点「按意思搜」后
       整页会按旧指纹直接跳过重绘。 */
    state.searchMode,
    state.noteFilter,
    state.noteKw,
    state.noteSelect ? '1' : '0',
    state.noteSel.join(','),
    state.reviewIdx,
    /* 对话页：筛选、搜索词、排法、展开了哪几张都长在这一页上。
       漏一项就是「点了没反应」，所以连展开名单一起进指纹。 */
    state.aiKind,
    state.aiKw,
    state.aiGroup,
    state.aiOpen.join(','),
    /* 导出确认层也是这一页的可见状态：不进指纹，点「导出本书」后整页
       按旧指纹跳过重绘，遮罩要等下一次别的变化才出现。 */
    state.aiExport ? `${state.aiExport.title}|${state.aiExport.ids.join(',')}` : '',
    /* 会话本身在 data/ai-session 里，不进 state：归档 / 删除 / 种子数据变了
       也得重画，这里按 id + 时间 + 归档时间 + 轮数压一份指纹。
       只在对话页算：别的页看不到它，没必要每次重绘都复制一遍全部会话。 */
    state.studyPage === 'ai'
      ? aiSessions()
          .map((s) => `${s.id}:${s.when}:${s.archivedAt ?? 0}:${s.turns.length}`)
          .join(',')
      : '',
    compact ? 'c' : 'f',
    /* 「今天 / 昨天」和每日回顾都按本地日期算：跨过零点画面就该变一次，
       所以日子也是指纹的一部分（不然它会一直停在前一天）。 */
    new Date().toDateString(),
    /* 收藏与分组在 state 里也有一份缓存（hydrateLibrary 灌的），
       两处都要算进指纹，否则同步完只换了缓存时界面不动。 */
    state.favIds.join(','),
    Object.keys(state.shelves)
      .sort()
      .map((k) => `${k}=${state.shelves[k]}`)
      .join(','),
    /* 分类名单的**顺序**也要进指纹：改名 / 上下移动改的是这份名单，
       书上一个字都没变；漏了它，挪完分类条一动不动。 */
    state.shelfList.join(','),
    shellPrefs().accent,
  ].join('\u0001');

  let b = '';
  for (const x of books) {
    b +=
      [
        x.id,
        x.meta.title,
        x.meta.author ?? '',
        x.meta.coverPath ?? '',
        x.meta.subjects?.[0] ?? '',
        x.fileRef.format,
        x.fileRef.fileMissing ? '1' : '0',
        x.reading.position.percent ?? 0,
        x.reading.position.chapterTitle ?? '',
        x.reading.stats.completedTime ?? 0,
        x.reading.stats.totalReadTime ?? 0,
        x.reading.stats.lastReadTime ?? 0,
        x.notes?.highlights?.length ?? 0,
        /* 书摘与书签也上指纹（笔记页按它们出条数）：现在 notes.ts 每改一次都会推
           notesUpdatedAt，路是通的；但指纹不该只依赖「以后没人绕过 notes.ts」——
           少算一项就是一次静默不刷新。 */
        x.notes?.excerpts?.length ?? 0,
        x.notes?.bookmarks?.length ?? 0,
        x.notesUpdatedAt ?? 0,
        x.updatedAt ?? 0,
        x.archivedAt ?? 0,
      ].join('\u0002') + '\u0003';
  }
  return `${s}\u0004${b}`;
}

/**
 * 书架某一页的 HTML。数据全部来自 store，不在这里做二次加工。
 *
 * @param compact 书库筛选行放不下（`isCompactLibrary(宽度)`）。
 *   只看宽度、不看平台：桌面验收开着 force-mobile 时也要摊开。
 */
export function buildShelfPage(state: ShellState, books: ReaderBook[], compact: boolean): ShelfPage {
  const app = getShellSource()?.app;
  /* 页签上的「笔记」数量只要条数，不必把每一条拍平成 MarkRow 再排序：
     以前每画一页（包括设置页）都算一次全库标注（D4）。 */
  const noteCount = books.reduce((n, b) => n + (b.notes?.highlights?.length ?? 0), 0);
  /* 对话页的数据在 data/ai-session 里（本轮是内存列表）：页签计数和页面
     内容读同一份，不另算一遍，免得两个数对不上。 */
  const sessions = state.studyPage === 'ai' ? aiSessions() : [];
  const counts: StudyCounts = { books: books.length, notes: noteCount, chats: aiSessionCount() };

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
          marks: allMarks(books),
          filter: state.noteFilter,
          kw: state.noteKw,
          reviewIdx: state.reviewIdx,
          select: state.noteSelect,
          picked: state.noteSel,
        }),
        counts,
      };
    /* 对话（2026-11-16）：按书 / 按时间、类型筛选、搜索、展开、归档、导出。
       导出目录跟笔记页同一个设置：写进「笔记」的那批 .md，而不是另起一处。 */
    case 'ai': {
      /* 授权过期 / 旧库恢复时兜底：不渲染对话内容，退回书库页。
         页签与点击入口在 render / actions 里已各拦一次。 */
      if (!can('aiLog')) return buildShelfPage({ ...state, studyPage: 'library' }, books, compact);
      const dir = String(shellSettings().exportDir ?? 'bz-reader/notes');
      return {
        body: viewHistory({
          sessions,
          kind: state.aiKind as AiKindFilter,
          kw: state.aiKw,
          group: state.aiGroup,
          open: state.aiOpen,
          dir,
        }),
        counts,
        layer: state.aiExport
          ? historyConfirmLayer(state.aiExport.title, state.aiExport.ids, sessions, dir)
          : '',
      };
    }
    case 'stats': {
      // 统计是付费项：锁着给基础版（六个真实数字 + 强调色遮罩），点一下弹高级版
      const src = getShellSource();
      /* 归档书的阅读历史仍然计入统计。整页一比一之后，KPI、明细表、
         热力图全部同出这一份全量书籍，不再另切一份在架书单——
         否则「读过 / 在库」会和表格里的行数对不上。 */
      const all = src?.repo.all() ?? books;
      const statsView = {
        stats: collectStats(all),
        books: all,
        goal: state.goal,
        checkins: src?.store.get().checkins,
        dailyGoalMinutes: src?.store.get().dailyGoalMinutes,
      };
      const ui = getStatsUi();
      return {
        body: can('stats') ? viewStats(statsView, ui) : viewStatsLocked(statsView, ui),
        counts,
      };
    }
    case 'settings':
      return {
        body: viewSettings({
          prefs: shellPrefs(),
          settings: shellSettings(),
          pen: state.pen,
          /* 命令名在这里求值而不是存进 KEY_COMMANDS：切语言后重绘设置页
             就能看到新名字，不必等重启。 */
          hotkeys: readHotkeys(
            app,
            KEY_COMMANDS.map((c) => ({ id: c.id, label: t(c.key), builtin: c.builtin })),
          ),
          relicense: state.relicense,
          version: getShellSource()?.version?.() || '',
          /* 「连接至 BZ AI 知识库」那一行是自动识别的，这里现探一次：切换 bz 后
             重进设置页看到的就是新状态，不缓存。 */
          bz: bzSnapshot(getShellSource()?.app),
          /* bz Review 装没装：现探，装完重进设置页就能看到新状态。 */
          review: { installed: !!getShellSource()?.app && !!findReviewApi(getShellSource()!.app) },
          /* 离线音频的状态（2026-11-14 从朗读浮层搬过来）：浮层没了，
             这一项得在设置页仍看得见。
             整本预生成 2026-11-17 从设置页撤掉：浮条上已有那颗按钮，设置里
             再摆一个入口只是第二个开关。 */
          offline: getShellSource()?.offlineAudioInfo?.() ?? null,
        }),
        counts,
      };
    default: {
      /* 行映射（配色 / 日期文案 / 封面地址）只在书库页做：别的页用不上，
         每画一页都算一遍是白烧 CPU（D4）。 */
      const rows = app ? toRows(app, books) : [];
      return {
        body: viewLibrary({
          rows: filterRows(rows, state),
          total: books.length,
          state,
          libraryKey: state.libShelf + state.libFilter + state.libView,
          compact,
        }),
        counts,
      };
    }
  }
}
