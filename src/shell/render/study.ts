/* ============================================================
 * bz-reader · 书架外壳与书库页（shell/render/study.ts）
 *
 * 书架是一个中心 ItemView，内部四页。这个文件只管两件事：
 *   1. 外壳：小标签 + 衬线大题「书 房」+ 四页签 + 右上动作
 *   2. 书库页：继续阅读 / 筛选 / 封面墙 / 列表
 *
 * 原型是写死的封面墙，这里全部走真实数据；真实数据缺的字段
 * （封面色、读完状态、日期文案）在 adapt.ts 里补，不在这里猜。
 * ============================================================ */
import type { BookRow } from '../adapt';
import { continueRow, shelfNames } from '../adapt';
import { isStudyTab, type ShellState, type StudyPage } from '../state';
import { MAG, barHtml, coverHtml, esc, ico } from './html';

export interface StudyPageDef {
  value: StudyPage;
  label: string;
  /** 页签前的线描图标（ico() 的名字）。文字之外给一层形状记忆，扫一眼就能定位 */
  icon: string;
}

/** 占页签位置的两页。统计与设置不在这里——它们退到右上图标 */
export const STUDY_TABS: StudyPageDef[] = [
  { value: 'library', label: '书库', icon: 'library' },
  { value: 'notes', label: '笔记', icon: 'note' },
];

/**
 * 右上四颗。顺序即定稿：搜索、统计、导入、设置。
 *
 * 统计与设置从前是页签，摆在书库/笔记旁边意味着「同一层级的事」；
 * 实际上它们是低频的设置类入口，占着页签位置反而让高频的两页变小。
 */
export const STUDY_ACTS: StudyPageDef[] = [
  { value: 'search', label: '搜索', icon: 'search' },
  { value: 'stats', label: '统计', icon: 'chart' },
  { value: 'import', label: '导入书籍', icon: 'import' },
  { value: 'settings', label: '设置', icon: 'gear' },
];

/** 子页标题：头栏那一行字 */
const SUB_TITLE: Record<string, string> = {
  search: '搜索',
  import: '导入书籍',
  stats: '统计',
  settings: '设置',
};

/** 页签上的计数徽记：书库给本数，笔记给条数，统计与设置不给 */
export interface StudyCounts {
  books: number;
  notes: number;
}

/**
 * 书架整页外壳。`body` 是内部某一页的 HTML。
 *
 * 它占一个中心 tab（VIEW_TYPE_STUDY），不是侧栏——侧栏留给目录/书签/划线。
 * 两种头栏：
 *   · 页签页（书库/笔记）：两页签 + 右侧四颗图标
 *   · 子页（搜索/导入/统计/设置）：一颗返回 + 标题，不再有页签
 * 子页不留右上四颗：正在做一件事的时候，旁边摆四个「去别处」的按钮
 * 只会让人分心，要换页先退出来。
 */
export function studyShell(page: StudyPage, body: string, counts: StudyCounts): string {
  const head = isStudyTab(page)
    ? `<div class="bzs-stuhead">${tabNav(page, counts)}<span class="sp"></span>${actBar()}</div>`
    : `<div class="bzs-stuhead is-sub"><button class="bzs-back" data-act="studyback" title="返回" aria-label="返回">${ico(
        'back',
      )}</button><span class="bzs-subtitle">${esc(SUB_TITLE[page] || '')}</span></div>`;

  return `<div class="bzs-studio">${head}<div class="bzs-stubody">${body}</div></div>`;
}

function tabNav(page: StudyPage, counts: StudyCounts): string {
  const nav = STUDY_TABS.map((p) => {
    const n = p.value === 'library' ? counts.books : counts.notes;
    return `<button class="${page === p.value ? 'on' : ''}" data-act="study" data-p="${p.value}" title="${p.label}">${ico(
      p.icon,
    )}<span>${p.label}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  return `<nav class="bzs-stunav">${nav}</nav>`;
}

function actBar(): string {
  return `<div class="bzs-stuacts">${STUDY_ACTS.map(
    (a) =>
      `<button class="bzs-cbtn" data-act="study" data-p="${a.value}" title="${a.label}" aria-label="${a.label}">${ico(
        a.icon,
      )}</button>`,
  ).join('')}</div>`;
}

/* ─────────── 书库 ─────────── */

const FILTERS: Array<[ShellState['libFilter'], string]> = [
  ['all', '全部'],
  ['reading', '在读'],
  ['done', '已读'],
  ['new', '未读'],
  ['fav', '收藏'],
];

/** 排序按钮上显示的字：与 actions.ts 的 libsortmenu 菜单同一套 */
const SORT_LABEL: Record<ShellState['libSort'], string> = {
  recent: '最近阅读',
  title: '书名',
  progress: '进度',
};

export interface LibraryView {
  rows: BookRow[];
  state: ShellState;
  /** 书库在加载真实封面时会重排，给一个稳定的 key 让滚动位置不丢 */
  libraryKey: string;
}

export function viewLibrary(v: LibraryView): string {
  const { rows, state } = v;
  const recent = continueRow(rows);
  const shown = v.rows;
  const shelves = shelfNames(rows);

  const cont = recent
    ? `<div class="bzs-cont2">
        ${coverHtml(recent)}
        <div class="ci">
          <div class="kick">继续阅读</div>
          <h2>${esc(recent.title)}</h2>
          <div class="sub">${esc(recent.author)} · ${
            recent.chapterTitle ? `上次读到 ${esc(recent.chapterTitle)}` : `上次读到 ${recent.percent}%`
          }</div>
          <div class="prog">${barHtml(recent.percent)}<b>${recent.percent}%</b></div>
        </div>
        <div class="acts">
          <button class="bzs-btn pri" data-act="openbook" data-id="${recent.id}">接着读 ›</button>
          <button class="bzs-btn" data-act="detail" data-id="${recent.id}">书籍详情</button>
        </div>
      </div>`
    : `<div class="bzs-empty">书库还是空的。点右上「导入」放一本 epub 进来，或把书直接拖进笔记库。</div>`;

  const filters = `<div class="bzs-filters">
      <div class="bzs-well">${MAG}<input data-role="libkw" placeholder="搜索书名 / 作者 / 分类" value="${esc(state.libKw)}"></div>
      ${FILTERS.map(
        (f) => `<button class="bzs-chip${state.libFilter === f[0] ? ' on' : ''}" data-act="libfilter" data-v="${f[0]}">${f[1]}</button>`,
      ).join('')}
      <span style="flex:1"></span>
      <button class="bzs-chip bzs-sort" data-act="libsortmenu" aria-label="排序">${SORT_LABEL[state.libSort]} ${ico(
        'chevron-down',
      )}</button>
      <button class="bzs-chip${state.libView === 'grid' ? ' on' : ''}" data-act="libview" data-v="grid">封面墙</button>
      <button class="bzs-chip${state.libView === 'list' ? ' on' : ''}" data-act="libview" data-v="list">列表</button>
    </div>
    <div class="bzs-shelfline">
      <span class="bzs-mini" style="margin-right:4px">书架</span>
      ${shelves.map((s) => `<button class="bzs-chip${state.libShelf === s ? ' on' : ''}" data-act="shelf" data-v="${esc(s)}">${esc(s)}</button>`).join('')}
      <span class="sp"></span><span class="bzs-mini">${shown.length} 本</span>
    </div>`;

  let body: string;
  if (!shown.length) {
    body = `<div class="bzs-empty">没有匹配的书。换个关键词，或点右上「导入」放一本进来。</div>`;
  } else if (state.libView === 'grid') {
    body = `<div class="bzs-grid">${shown
      .map(
        /* 卡片上不再钉三颗按钮：右键（手机长按）出菜单，动作都在里面。
           少了那一行，封面能大一圈，书名也不用为按钮让位。 */
        (b) => `<div class="bzs-bkcard${b.status === 'done' ? ' is-done' : ''}" data-act="detail" data-id="${b.id}"
          data-bookmenu="${b.id}" role="button" tabindex="0" title="右键 / 长按更多">
        ${b.status === 'done' ? `<span class="flag">已读完</span>` : b.fav ? `<span class="flag">收藏</span>` : ''}
        ${coverHtml(b)}
        <div class="bi">
          <b>${esc(b.title)}</b>
          <span class="sub">${esc(b.author)}</span>
          ${barHtml(b.percent)}
          <div class="meta"><span>${b.format} · ${esc(b.lastText)}</span><em>${b.percent > 0 ? b.percent + '%' : '—'}</em></div>
        </div>
      </div>`,
      )
      .join('')}</div>`;
  } else {
    body = `<div class="bzs-list">${shown
      .map(
        (b) => `<div class="bzs-bkrow2" data-act="detail" data-id="${b.id}" data-bookmenu="${b.id}" title="右键 / 长按更多">
        ${coverHtml(b)}
        <div class="bi"><b>${esc(b.title)}</b><div class="sub">${esc(b.author)} · ${esc(b.shelf)} · ${b.format}</div></div>
        ${barHtml(b.percent)}
        <span class="pct">${b.percent > 0 ? b.percent + '%' : '—'}</span>
        <span class="dt">${esc(b.lastText)}</span>
      </div>`,
      )
      .join('')}</div>`;
  }

  return `${cont}${filters}${body}`;
}
