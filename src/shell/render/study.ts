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
import type { ShellState, StudyPage } from '../state';
import { MAG, barHtml, coverHtml, esc, ico } from './html';

export interface StudyPageDef {
  value: StudyPage;
  label: string;
  /** 页签前的线描图标（ico() 的名字）。文字之外给一层形状记忆，扫一眼就能定位 */
  icon: string;
}

export const STUDY_PAGES: StudyPageDef[] = [
  { value: 'library', label: '书库', icon: 'library' },
  { value: 'notes', label: '笔记', icon: 'note' },
  { value: 'stats', label: '统计', icon: 'chart' },
  { value: 'settings', label: '设置', icon: 'gear' },
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
 * 头行压成一行：四页签（带图标）+ 搜索/导入；大题「书 架」去掉了——
 * 页签本身已经说明这是哪，一行大字只吃竖向空间。
 */
export function studyShell(page: StudyPage, body: string, counts: StudyCounts): string {
  const nav = STUDY_PAGES.map((p) => {
    const n = p.value === 'library' ? counts.books : p.value === 'notes' ? counts.notes : 0;
    return `<button class="${page === p.value ? 'on' : ''}" data-act="study" data-p="${p.value}" title="${p.label}">${ico(
      p.icon,
    )}<span>${p.label}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('');

  return `<div class="bzs-studio">
    <div class="bzs-stuhead">
      <nav class="bzs-stunav">${nav}</nav>
      <span class="sp"></span>
      <div class="bzs-stuacts">
        <button class="bzs-cbtn" data-act="search" title="搜索（命令面板里也能搜到）" aria-label="搜索">${ico('search')}</button>
        <button class="bzs-cbtn" data-act="import" title="导入书籍" aria-label="导入">${ico('import')}</button>
      </div>
    </div>
    <div class="bzs-stubody">${body}</div>
  </div>`;
}

/* ─────────── 书库 ─────────── */

const FILTERS: Array<[ShellState['libFilter'], string]> = [
  ['all', '全部'],
  ['reading', '在读'],
  ['done', '已读'],
  ['new', '未读'],
  ['fav', '收藏'],
];

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
      <select data-role="libsort">
        <option value="recent"${state.libSort === 'recent' ? ' selected' : ''}>最近阅读</option>
        <option value="title"${state.libSort === 'title' ? ' selected' : ''}>书名</option>
        <option value="progress"${state.libSort === 'progress' ? ' selected' : ''}>进度</option>
      </select>
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
