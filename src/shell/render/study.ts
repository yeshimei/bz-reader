/* ============================================================
 * bz-reader · 书架外壳与书库页（shell/render/study.ts）
 *
 * 书架是一个中心 ItemView，内部八页。这个文件只管两件事：
 *   1. 外壳：页签（书库/笔记/对话/复习）+ 右上四颗图标 + 页面容器
 *   2. 书库页：继续阅读 / 筛选 / 封面墙 / 列表
 *
 * 原型是写死的封面墙，这里全部走真实数据；真实数据缺的字段
 * （封面色、读完状态、日期文案）在 adapt.ts 里补，不在这里猜。
 *
 * 页签、右上四颗、分类与排序都是**成套的短标签**：只存 MsgKey，渲染时
 * 现取（`t(p.key)`）。做成常量字符串的话，切语言后重绘还是旧语言——
 * 而这几颗恰好是用户切完语言第一眼看到的东西。
 * ============================================================ */
import { t, type MsgKey } from '../../i18n';
import { can } from '../../data/entitlement';
import type { BookRow } from '../adapt';
import { continueRow, shelfNames } from '../adapt';
import { visiblePicked } from '../book-select';
import { allPicked } from '../note-select';
import type { ShellState, StudyPage } from '../state';
import { MAG, barHtml, coverHtml, esc, ico } from './html';
import { shelfLabel } from '../shelf-label';
export interface StudyPageDef {
  value: StudyPage;
  key: MsgKey;
  /** 页签前的线描图标（ico() 的名字）。文字之外给一层形状记忆，扫一眼就能定位 */
  icon: string;
  /** 三点菜单里的一行说明（Review 的更多菜单同款「标题 + 一句话」） */
  subKey?: MsgKey;
}

/** 占页签位置的四页。统计与设置不在这里——它们退到右上图标 */
export const STUDY_TABS: StudyPageDef[] = [
  { value: 'library', key: 'shelf.tab.library', icon: 'library' },
  { value: 'notes', key: 'shelf.tab.notes', icon: 'note' },
  /* 对话（2026-11-16）：排在「笔记」后面。页签文案就是「对话」，
     不加 AI 前缀——页内标题同名，说同一件事用同一个词。 */
  { value: 'ai', key: 'shelf.tab.ai', icon: 'ai' },
  /* 复习（2026-11-19）：第四个页签，排在「对话」后面。是否真的列出由
     visibleStudyTabs 按开关 + Review 嵌入能力决定，这里只定义它的长相。 */
  { value: 'review', key: 'shelf.tab.review', icon: 'review' },
];

/**
 * 当前该列哪些页签（纯函数，便于单测）。
 *
 * 两个条件各管一段：对话看授权，复习看「开关开 + 装了支持嵌入的 Review」。
 * 判据由上层算成一个布尔传进来，渲染本身不读设置、不探插件——否则测试
 * 得把整条数据源都 stub 出来。data-p 是 DOM 属性不是权限，actions 里还会
 * 对这两页各拦一次。
 */
export function visibleStudyTabs(reviewTab: boolean): StudyPageDef[] {
  return STUDY_TABS.filter((p) => {
    if (p.value === 'ai') return can('aiLog');
    if (p.value === 'review') return reviewTab;
    return true;
  });
}

/**
 * 右上四颗。顺序即定稿：搜索、统计、导入、设置。
 *
 * 统计与设置从前是页签，摆在书库/笔记旁边意味着「同一层级的事」；
 * 实际上它们是低频的设置类入口，占着页签位置反而让高频的两页变小。
 */
export const STUDY_ACTS: StudyPageDef[] = [
  { value: 'search', key: 'shelf.act.search', icon: 'search', subKey: 'shelf.more.search' },
  { value: 'stats', key: 'shelf.act.stats', icon: 'chart', subKey: 'shelf.more.stats' },
  { value: 'import', key: 'shelf.act.import', icon: 'import', subKey: 'shelf.more.import' },
  { value: 'settings', key: 'shelf.act.settings', icon: 'gear', subKey: 'shelf.more.settings' },
];

/**
 * 手机端书架的三点菜单（2026-11-20）：四颗图标在窄屏收进这里，只留 ⋮。
 * 形态照抄 Review 的 .bzrv-more-menu（分组 + 图标 + 标题 + 一句话说明），
 * 开合同一套规矩：默认 hidden，点 more 开合，点外部 / ESC / 重绘都收起。
 * 菜单项复用 data-act="study" + data-p，切页逻辑与头栏图标一字不差——
 * 手机端它是这四页唯一的入口，另写一套动作迟早出现「一边能点一边不能点」。
 */
export function studyMoreMenuHtml(page: StudyPage): string {
  return `<div class="bzs-more-menu" hidden>
  <div class="bzs-more-group">${t('shelf.more.group')}</div>
${STUDY_ACTS.map((a) => {
    const label = t(a.key);
    const on = page === a.value;
    return `  <button type="button" class="bzs-more-item${on ? ' is-on' : ''}" data-act="study" data-p="${a.value}">${ico(
      a.icon,
      'bzs-more-item-ic',
    )}<span class="bzs-more-item-txt"><span class="bzs-more-item-title">${label}</span><span class="bzs-more-item-sub">${
      a.subKey ? t(a.subKey) : ''
    }</span></span></button>`;
  }).join('\n')}
</div>`;
}

/** 页签上的计数徽记：书库给本数，笔记给条数，对话给轮数，统计与设置不给 */
export interface StudyCounts {
  books: number;
  notes: number;
  chats: number;
}

/**
 * 书架整页外壳。`body` 是内部某一页的 HTML。
 *
 * 它占一个中心 tab（VIEW_TYPE_STUDY），不是侧栏——侧栏留给目录/书签/划线。
 * 头栏只有一种形态：左边两个页签、右边四颗图标，进任何一页都在。
 *
 * 2026-11-08 改：子页以前换成「← 返回 + 标题」，四颗图标整块消失——
 * 用户的原话是「不要那种形式」。现在不换形态：当前那颗图标亮起，
 * 再点一次回进来之前那页（判据在 state.nextStudyPage）。
 */
export function studyShell(page: StudyPage, body: string, counts: StudyCounts, layer = '', reviewTab = false): string {
  /* 复习页的 body 不能带书库那套 padding / overflow：嵌入面板自己按宿主
     撑满（position:absolute; inset:0），多一层内边距会把它挤小，滚动条也会
     叠成两层。is-embed 让 study.css 把这部分收掉。 */
  const bodyCls = page === 'review' ? 'bzs-stubody is-embed' : 'bzs-stubody';
  /* 复习页另给头栏一个 is-review：手机上四个页签 + Review 四颗图标一行放不下，
     窄屏按这个类换两行（见 study.css 的移动端块）。桌面端不加任何规则。 */
  const headCls = page === 'review' ? 'bzs-stuhead is-review' : 'bzs-stuhead';
  return `<div class="bzs-studio"><div class="${headCls}">${tabNav(page, counts, reviewTab)}<span class="sp"></span>${actBar(
    page,
  )}</div><div class="${bodyCls}">${body}</div>${layer}</div>`;
}

/**
 * 页签计数：每页只给自己的那一个。
 *
 * 以前是 `p.value === 'library' ? books : notes`——加第三页时它会把笔记数
 * 当成对话数画出来，页签上一个都不会空。按页取，未列出的页不给徽记。
 */
function tabCount(page: StudyPage, counts: StudyCounts): number {
  if (page === 'library') return counts.books;
  if (page === 'notes') return counts.notes;
  if (page === 'ai') return counts.chats;
  return 0;
}

function tabNav(page: StudyPage, counts: StudyCounts, reviewTab: boolean): string {
  /* 页签名单由 visibleStudyTabs 算好：对话看授权、复习看开关 + Review 能力。
     点击入口在 actions 的 `study` 分支再各拦一次——data-p 是 DOM 属性，不是权限。 */
  const nav = visibleStudyTabs(reviewTab).map((p) => {
    const n = tabCount(p.value, counts);
    const label = t(p.key);
    return `<button class="${page === p.value ? 'on' : ''}" data-act="study" data-p="${p.value}"><span class="bzs-sr-only">${label}</span>${ico(
      p.icon,
    )}<span>${label}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  return `<nav class="bzs-stunav">${nav}</nav>`;
}

/**
 * 右上四颗。
 *
 * 2026-11-08 起它们和页签同级：点了切页，当前那颗图标亮成铜色（不加底色、
 * 不加下划线，见 study.css 的 .bzs-stuacts）。亮着的那颗再点一次由
 * nextStudyPage 送回进来之前的页签页，所以不再需要单独的返回键。
 *
 * 同一天里这里曾短暂挂过第五颗「分类」，随后撤掉：分类管理不是一页，
 * 塞进头栏会让人以为它和搜索/统计同级。入口改到书卡菜单「归入分类…」
 * 的下一层，头栏保持定稿的四颗。
 *
 * 2026-11-20 二轮：手机上这四颗全收进 ⋮（同 Review 的更多菜单形态），
 * 桌面仍平铺，菜单在两种形态里都渲染、由 CSS 决定谁可见。
 */
export function actBar(page: StudyPage): string {
  /* 复习页右侧那四颗属于 Review：Reader 不画自己的图标，只留一个空容器，
     由 Review 侧门面把自己的图标塞进来并绑定（见 shelf-panel 的挂载）。 */
  if (page === 'review') return '<div class="bzs-review-acts" data-role="reviewacts"></div>';
  return `<div class="bzs-stuacts">${STUDY_ACTS.map((a) => {
    const label = t(a.key);
    const on = page === a.value;
    return `<button class="bzs-cbtn${on ? ' on' : ''}" data-act="study" data-p="${a.value}" aria-pressed="${on}"><span class="bzs-sr-only">${label}</span>${ico(
      a.icon,
    )}</button>`;
  }).join('')}<button class="bzs-cbtn bzs-more-btn" data-act="more"><span class="bzs-sr-only">${t('tool.more')}</span>${ico(
    'more',
  )}</button>${studyMoreMenuHtml(page)}</div>`;
}

/* ─────────── 书库 ─────────── */

/** 分类下拉与桌面的 chip 排共用这一张表（actions 里的 libfiltermenu 也读它） */
export const LIB_FILTERS: Array<[ShellState['libFilter'], MsgKey]> = [
  ['all', 'shelf.filter.all'],
  ['reading', 'shelf.filter.reading'],
  ['done', 'shelf.filter.done'],
  ['new', 'shelf.filter.new'],
  ['fav', 'shelf.filter.fav'],
  /* 归档（2026-11-21）：换版本后旧书归档在库里，界面上要有个地方看得到、
     恢复得回来——否则旧版的划线摘录等于凭空消失。 */
  ['archived', 'shelf.filter.archived'],
];

/** 排序的三档：桌面平铺成三颗 chip，窄屏收进下拉（actions 的 libsortmenu 读同一张表） */
export const LIB_SORTS: Array<[ShellState['libSort'], MsgKey]> = [
  ['recent', 'shelf.sort.recent'],
  ['title', 'shelf.sort.title'],
  ['progress', 'shelf.sort.progress'],
];

export interface LibraryView {
  rows: BookRow[];
  /**
   * 库里一共有几本（过滤前）。
   *
   * 「一本都没导入」和「筛选后没匹配」是两种状态：前者要收起整条
   * 搜索/分类栏（没有东西可筛），后者要留着让用户改条件。
   */
  total?: number;
  state: ShellState;
  /** 书库在加载真实封面时会重排，给一个稳定的 key 让滚动位置不丢 */
  libraryKey: string;
  /**
   * 放不下：筛选栏收成「放大镜 + 分类下拉 + 排序下拉 + 视图」，搜索按需展开。
   *
   * 由 `isCompactLibrary(这块的宽度)` 决定——**不是平台**。390px 的手机收着，
   * 1725px 的桌面摊开。
   */
  compact?: boolean;
}

export function viewLibrary(v: LibraryView): string {
  const { rows, state } = v;
  const compact = v.compact === true;

  /* 空库：整页只留一句空态。
     以前把搜索框、五个分类 chip、书架名一起画出来，下面再补一句
     「没有匹配的书」——库里一本书都没有时，这两句话互相矛盾，
     而且满屏控件全是死的（真机图一）。 */
  if (!(v.total ?? rows.length)) {
    /* 空库给一颗能点的导入按钮（2026-11-17）：以前只有一句「点右上导入」，
       新用户对着空屏还得去猜右上角在哪。按钮和右上那条走同一个 act。 */
    return `<div class="bzs-empty">
      <div>${t('shelf.empty.all')}</div>
      <button type="button" class="bzs-btn sm pri" data-act="import" style="margin-top:12px">${t(
        'shelf.empty.import',
      )}</button>
    </div>`;
  }

  const recent = continueRow(rows);
  const shown = v.rows;
  const shelves = shelfNames(rows, state.shelfList);

  /* 批量选择：只认当前可见的这批书。切筛选 / 分类 / 搜索词会由 state 的
     守卫退出多选，这里再求一次交集，挡住「选择还留着但书已不在架上」。 */
  const select = state.libSelect;
  const shownIds = shown.map((b) => b.id);
  const picked = select ? visiblePicked(state.libSel, shownIds) : [];
  const pickedSet = new Set(picked);
  const selectBtn = select
    ? ''
    : `<button class="bzs-round" data-act="libsel"><span class="bzs-sr-only">${t('shelf.select')}</span>${ico('listchecks')}</button>`;
  const selBar = select
    ? `<div class="bzs-libselbar">
        <span class="bzs-mini">${t('shelf.selected', { n: picked.length })}</span>
        <span class="sp"></span>
        <button class="bzs-btn sm" data-act="libselall">${allPicked(picked, shownIds) ? t('shelf.selectNone') : t('shelf.selectAll')}</button>
        <button class="bzs-btn sm" data-act="libselclass"${picked.length ? '' : ' disabled'}>${t('shelf.batch.classify')}</button>
        <button class="bzs-btn sm danger" data-act="libselremove"${picked.length ? '' : ' disabled'}>${t('shelf.batch.remove')}</button>
        <button class="bzs-btn sm" data-act="libsel">${t('shelf.select.exit')}</button>
      </div>`
    : '';
  const pickBox = (b: BookRow): string =>
    select ? `<span class="bzs-bkpick${pickedSet.has(b.id) ? ' on' : ''}">${ico('check')}</span>` : '';
  const cardTitle = (b: BookRow): string =>
    select ? t('shelf.select.tip') : b.missing ? t('shelf.missing.tip') : t('shelf.more');

  const cont = recent
    ? `<div class="bzs-cont2">
        ${coverHtml(recent)}
        <div class="ci">
          <div class="kick">${t('shelf.continue')}</div>
          <h2>${esc(recent.title)}</h2>
          <div class="sub">${esc(recent.author)} · ${
            recent.chapterTitle
              ? /* 章节名来自书里，可能是任意字符串：拼进 HTML 前必须转义（D1） */
                esc(t('shelf.lastChapter', { chapter: recent.chapterTitle }))
              : t('shelf.lastPercent', { percent: recent.percent })
          }</div>
          <div class="prog">${barHtml(recent.percent)}<b>${recent.percent}%</b></div>
        </div>
        <div class="acts">
          <button class="bzs-btn pri" data-act="openbook" data-id="${esc(recent.id)}">${t('shelf.resume')}</button>
          <button class="bzs-btn" data-act="detail" data-id="${esc(recent.id)}">${t('shelf.detail')}</button>
        </div>
      </div>`
    : '';

  const curFilter = LIB_FILTERS.find((f) => f[0] === state.libFilter);
  const filterLabel = curFilter ? t(curFilter[1]) : t('shelf.filter.all');
  const sortLabel = t((LIB_SORTS.find((s) => s[0] === state.libSort) ?? LIB_SORTS[0])[1]);
  /* 窄屏只放得下图标：钮上写的是「点它会切到哪种视图」，不是当前视图名 */
  const toView = state.libView === 'grid' ? 'list' : 'grid';
  const toViewLabel = toView === 'list' ? t('shelf.view.list') : t('shelf.view.grid');

  /* 放不下（手机 390）：一行放「搜索 / 分类 / 排序 / 视图」四颗，
     搜索展开后独占一行。
     放得下（桌面）：搜索、五个分类、三个排序、两个视图全部平铺——
     点一颗比点开下拉再点一次快，也不用为「现在选的是哪个」留一层记忆。 */
  const filters = compact
    ? state.libSearchOpen
      ? `<div class="bzs-filters is-mb is-search">
          <div class="bzs-well">${MAG}<input data-role="libkw" placeholder="${t('shelf.search.ph')}" value="${esc(state.libKw)}"></div>
          <button class="bzs-chip" data-act="libsearchtoggle">${t('shelf.collapse')}</button>
        </div>`
      : `<div class="bzs-filters is-mb">
          <button class="bzs-round${state.libKw ? ' on' : ''}" data-act="libsearchtoggle"><span class="bzs-sr-only">${t(
            'shelf.act.search',
          )}</span><span class="bzs-sr-only">${t('shelf.act.search')}</span>${ico('search')}</button>
          <button class="bzs-chip" data-act="libfiltermenu">${filterLabel}${ico('chevron')}</button>
          <button class="bzs-chip bzs-sort" data-act="libsortmenu"><span class="bzs-sr-only">${t('shelf.sort')}</span>${sortLabel}${ico(
            'chevron',
          )}</button>
          <span class="sp"></span>
          <button class="bzs-round" data-act="libview" data-v="${toView}"><span class="bzs-sr-only">${toViewLabel}</span>${ico(
            toView,
          )}</button>
          ${selectBtn}
        </div>`
    : `<div class="bzs-filters">
      <div class="bzs-well">${MAG}<input data-role="libkw" placeholder="${t('shelf.search.ph')}" value="${esc(state.libKw)}"></div>
      ${LIB_FILTERS.map(
        (f) =>
          `<button class="bzs-chip${state.libFilter === f[0] ? ' on' : ''}" data-act="libfilter" data-v="${f[0]}">${t(f[1])}</button>`,
      ).join('')}
      <span style="flex:1"></span>
      <span class="bzs-mini">${t('shelf.sort')}</span>
      ${LIB_SORTS.map(
        (s) =>
          `<button class="bzs-chip${state.libSort === s[0] ? ' on' : ''}" data-act="libsort" data-v="${s[0]}">${t(s[1])}</button>`,
      ).join('')}
      <span class="bzs-vsep" aria-hidden="true"></span>
      <button class="bzs-chip${state.libView === 'grid' ? ' on' : ''}" data-act="libview" data-v="grid">${t('shelf.view.grid')}</button>
      <button class="bzs-chip${state.libView === 'list' ? ' on' : ''}" data-act="libview" data-v="list">${t('shelf.view.list')}</button>
      ${selectBtn}
    </div>`;

  const shelfline = `<div class="bzs-shelfline">
      <span class="bzs-mini" style="margin-right:4px">${t('shelf.shelfline')}</span>
      ${shelves.map((s) => `<button class="bzs-chip${state.libShelf === s ? ' on' : ''}" data-act="shelf" data-v="${esc(s)}">${esc(shelfLabel(s))}</button>`).join('')}
      <span class="sp"></span><span class="bzs-mini">${t('shelf.count', { n: shown.length })}</span>
    </div>`;

  let body: string;
  if (!shown.length) {
    body = `<div class="bzs-empty">${t('shelf.empty.none')}</div>`;
  } else if (state.libView === 'grid') {
    body = `<div class="bzs-grid">${shown
      .map(
        /* 卡片上不再钉三颗按钮：点一下开书；文件失联时点它进「重新定位」，
           右键（手机长按）出菜单，详情与其它动作都在里面。 */
        (b) => `<div class="bzs-bkcard${b.status === 'done' ? ' is-done' : ''}${b.missing ? ' is-missing' : ''}${b.clip ? ' is-clip' : ''}${select && pickedSet.has(b.id) ? ' is-picked' : ''}" data-act="${select ? 'libselpick' : 'openbook'}" data-id="${esc(b.id)}"
          data-bookmenu="${esc(b.id)}" role="button" tabindex="0"><span class="bzs-sr-only">${cardTitle(b)}</span>
        ${pickBox(b)}
        ${
          b.archived
            ? `<span class="flag is-archived">${t('shelf.filter.archived')}</span>`
            : b.missing
              ? `<span class="flag is-missing">${t('shelf.missing')}</span>`
              : b.clip
                ? `<span class="flag is-clip">${t('clip.badge')}</span>`
                : b.status === 'done'
                  ? `<span class="flag">${t('shelf.badge.done')}</span>`
                  : b.fav
                    ? `<span class="flag">${t('shelf.filter.fav')}</span>`
                    : ''
        }
        ${coverHtml(b)}
        <div class="bi">
          <b>${esc(b.title)}</b>
          <span class="sub">${esc(b.author)}</span>
          ${barHtml(b.percent)}
          <div class="meta"><span>${b.missing ? t('shelf.missing') : `${b.clip ? t('clip.badge') : b.format} · ${esc(b.lastText)}`}</span><em>${b.percent > 0 ? b.percent + '%' : '—'}</em></div>
        </div>
      </div>`,
      )
      .join('')}</div>`;
  } else {
    body = `<div class="bzs-list">${shown
      .map(
        (b) => `<div class="bzs-bkrow2${b.missing ? ' is-missing' : ''}${b.clip ? ' is-clip' : ''}${select && pickedSet.has(b.id) ? ' is-picked' : ''}" data-act="${select ? 'libselpick' : 'openbook'}" data-id="${esc(b.id)}" data-bookmenu="${esc(b.id)}" role="button" tabindex="0"><span class="bzs-sr-only">${cardTitle(b)}</span>
        ${pickBox(b)}
        ${coverHtml(b)}
        <div class="bi"><b>${esc(b.title)}</b><div class="sub">${esc(b.author)} · ${esc(b.shelf)} · ${b.clip ? t('clip.badge') : b.format}${b.missing ? ` · <span class="miss">${t('shelf.missing')}</span>` : ''}</div></div>
        ${barHtml(b.percent)}
        <span class="pct">${b.percent > 0 ? b.percent + '%' : '—'}</span>
        <span class="dt">${esc(b.lastText)}</span>
      </div>`,
      )
      .join('')}</div>`;
  }

  return `${cont}${filters}${selBar}${shelfline}${body}`;
}
