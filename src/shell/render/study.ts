/* ============================================================
 * bz-reader · 书架外壳与书库页（shell/render/study.ts）
 *
 * 书架是一个中心 ItemView，内部六页。这个文件只管两件事：
 *   1. 外壳：两页签 + 右上四颗图标（只此一种形态）+ 页面容器
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
import type { BookRow } from '../adapt';
import { continueRow, shelfNames } from '../adapt';
import type { ShellState, StudyPage } from '../state';
import { MAG, barHtml, coverHtml, esc, ico } from './html';
export interface StudyPageDef {
  value: StudyPage;
  key: MsgKey;
  /** 页签前的线描图标（ico() 的名字）。文字之外给一层形状记忆，扫一眼就能定位 */
  icon: string;
}

/** 占页签位置的两页。统计与设置不在这里——它们退到右上图标 */
export const STUDY_TABS: StudyPageDef[] = [
  { value: 'library', key: 'shelf.tab.library', icon: 'library' },
  { value: 'notes', key: 'shelf.tab.notes', icon: 'note' },
];

/**
 * 右上四颗。顺序即定稿：搜索、统计、导入、设置。
 *
 * 统计与设置从前是页签，摆在书库/笔记旁边意味着「同一层级的事」；
 * 实际上它们是低频的设置类入口，占着页签位置反而让高频的两页变小。
 */
export const STUDY_ACTS: StudyPageDef[] = [
  { value: 'search', key: 'shelf.act.search', icon: 'search' },
  { value: 'stats', key: 'shelf.act.stats', icon: 'chart' },
  { value: 'import', key: 'shelf.act.import', icon: 'import' },
  { value: 'settings', key: 'shelf.act.settings', icon: 'gear' },
];

/** 页签上的计数徽记：书库给本数，笔记给条数，统计与设置不给 */
export interface StudyCounts {
  books: number;
  notes: number;
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
export function studyShell(page: StudyPage, body: string, counts: StudyCounts): string {
  return `<div class="bzs-studio"><div class="bzs-stuhead">${tabNav(page, counts)}<span class="sp"></span>${actBar(
    page,
  )}</div><div class="bzs-stubody">${body}</div></div>`;
}

function tabNav(page: StudyPage, counts: StudyCounts): string {
  const nav = STUDY_TABS.map((p) => {
    const n = p.value === 'library' ? counts.books : counts.notes;
    const label = t(p.key);
    return `<button class="${page === p.value ? 'on' : ''}" data-act="study" data-p="${p.value}" title="${label}">${ico(
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
 */
function actBar(page: StudyPage): string {
  return `<div class="bzs-stuacts">${STUDY_ACTS.map((a) => {
    const label = t(a.key);
    const on = page === a.value;
    return `<button class="bzs-cbtn${on ? ' on' : ''}" data-act="study" data-p="${a.value}" title="${label}" aria-label="${label}" aria-pressed="${on}">${ico(
      a.icon,
    )}</button>`;
  }).join('')}</div>`;
}

/* ─────────── 书库 ─────────── */

/** 分类下拉与桌面的 chip 排共用这一张表（actions 里的 libfiltermenu 也读它） */
export const LIB_FILTERS: Array<[ShellState['libFilter'], MsgKey]> = [
  ['all', 'shelf.filter.all'],
  ['reading', 'shelf.filter.reading'],
  ['done', 'shelf.filter.done'],
  ['new', 'shelf.filter.new'],
  ['fav', 'shelf.filter.fav'],
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
    return `<div class="bzs-empty">${t('shelf.empty.all')}</div>`;
  }

  const recent = continueRow(rows);
  const shown = v.rows;
  const shelves = shelfNames(rows);

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
          <button class="bzs-chip bzs-icon-chip${state.libKw ? ' on' : ''}" data-act="libsearchtoggle" aria-label="${t(
            'shelf.act.search',
          )}" title="${t('shelf.act.search')}">${MAG}</button>
          <button class="bzs-chip" data-act="libfiltermenu">${filterLabel}${ico('chevron')}</button>
          <button class="bzs-chip bzs-sort" data-act="libsortmenu" aria-label="${t('shelf.sort')}">${sortLabel}${ico(
            'chevron',
          )}</button>
          <span class="sp"></span>
          <button class="bzs-chip" data-act="libview" data-v="${state.libView === 'grid' ? 'list' : 'grid'}">${
            state.libView === 'grid' ? t('shelf.view.list') : t('shelf.view.grid')
          }</button>
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
    </div>`;

  const shelfline = `<div class="bzs-shelfline">
      <span class="bzs-mini" style="margin-right:4px">${t('shelf.shelfline')}</span>
      ${shelves.map((s) => `<button class="bzs-chip${state.libShelf === s ? ' on' : ''}" data-act="shelf" data-v="${esc(s)}">${esc(s)}</button>`).join('')}
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
        (b) => `<div class="bzs-bkcard${b.status === 'done' ? ' is-done' : ''}${b.missing ? ' is-missing' : ''}" data-act="openbook" data-id="${esc(b.id)}"
          data-bookmenu="${esc(b.id)}" role="button" tabindex="0" title="${b.missing ? t('shelf.missing.tip') : t('shelf.more')}">
        ${
          b.missing
            ? `<span class="flag is-missing">${t('shelf.missing')}</span>`
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
          <div class="meta"><span>${b.missing ? t('shelf.missing') : `${b.format} · ${esc(b.lastText)}`}</span><em>${b.percent > 0 ? b.percent + '%' : '—'}</em></div>
        </div>
      </div>`,
      )
      .join('')}</div>`;
  } else {
    body = `<div class="bzs-list">${shown
      .map(
        (b) => `<div class="bzs-bkrow2${b.missing ? ' is-missing' : ''}" data-act="openbook" data-id="${esc(b.id)}" data-bookmenu="${esc(b.id)}" role="button" tabindex="0" title="${b.missing ? t('shelf.missing.tip') : t('shelf.more')}">
        ${coverHtml(b)}
        <div class="bi"><b>${esc(b.title)}</b><div class="sub">${esc(b.author)} · ${esc(b.shelf)} · ${b.format}${b.missing ? ` · <span class="miss">${t('shelf.missing')}</span>` : ''}</div></div>
        ${barHtml(b.percent)}
        <span class="pct">${b.percent > 0 ? b.percent + '%' : '—'}</span>
        <span class="dt">${esc(b.lastText)}</span>
      </div>`,
      )
      .join('')}</div>`;
  }

  return `${cont}${filters}${shelfline}${body}`;
}
