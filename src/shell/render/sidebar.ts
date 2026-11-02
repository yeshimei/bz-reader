/* ============================================================
 * bz-reader · 左侧栏四页签（shell/render/sidebar.ts）
 *
 * 侧栏是「读书时的坐标」，不是书库。所以它只回答三个问题：
 * 我在哪（目录）、我留过什么记号（书签 / 划线）、这一段什么意思（AI）。
 * 换书与回书架在顶行，不在这里再放一层书架。
 *
 * 目录来自 toc-state 的快照（阅读视图是唯一写入方），
 * 书关闭后快照为空——这时给空态，不假装有目录。
 * ============================================================ */
import type { ReaderBook } from '../../data/schema';
import type { FoliateTOCItem } from '../../types/foliate';
import type { BmkRow, MarkRow } from '../domain';
import { bmksOf, groupByChapter, marksOf } from '../domain';
import type { SideTab } from '../state';
import { cn, esc, ico } from './html';

export interface AiLogItem {
  me: boolean;
  tag: string;
  text: string;
}

export interface SidebarView {
  book: ReaderBook | null;
  tab: SideTab;
  toc: FoliateTOCItem[] | null;
  activeLabel: string;
  /** 未开书时各页签统一空态 */
  aiLog: AiLogItem[];
  aiReady: boolean;
  aiProvider: string;
  /** AI 属于高级能力：基础版构建里这个页签整个不出现，不给「锁着」的假入口 */
  aiEnabled?: boolean;
}

/**
 * 侧栏页签：书的坐标。书架是中心 tab，不在这里（封面墙需要宽度）。
 * 顺序即优先级：目录 → 书签 → 划线 → AI；打开一本书自动落在目录。
 */
export const SIDE_TABS: Array<{ value: SideTab; label: string; icon: string }> = [
  { value: 'toc', label: '目录', icon: 'board' },
  { value: 'bookmarks', label: '书签', icon: 'bookmark' },
  { value: 'highlights', label: '划线', icon: 'pen' },
  { value: 'ai', label: 'AI', icon: 'ai' },
];

export function sideTabs(aiEnabled = true): typeof SIDE_TABS {
  return aiEnabled ? SIDE_TABS : SIDE_TABS.filter((t) => t.value !== 'ai');
}

/** 目录：目录项没有百分比，用「第几项 / 共几项」估一个位置，够用且不撒谎 */
function tocBody(toc: FoliateTOCItem[], activeLabel: string): string {
  const flat: Array<{ item: FoliateTOCItem; depth: number }> = [];
  const walk = (items: FoliateTOCItem[], depth: number): void => {
    for (const it of items) {
      flat.push({ item: it, depth });
      if (it.subitems?.length) walk(it.subitems, depth + 1);
    }
  };
  walk(toc, 0);

  return `<div class="bzs-sbsec">共 ${flat.length} 节</div>${flat
    .map(({ item, depth }, i) => {
      const on = item.label === activeLabel;
      const pct = Math.round((i / Math.max(1, flat.length)) * 100);
      return `<button class="bzs-chaprow${depth ? ' d1' : ''}${on ? ' on' : ''}" data-act="jumpch" data-href="${esc(item.href)}">
        <span class="no">${depth ? '·' : cn(i + 1)}</span>
        <span class="t">${esc(item.label)}</span>
        <span class="pc">${pct}%</span>
      </button>`;
    })
    .join('')}`;
}

function bookmarksBody(rows: BmkRow[]): string {
  if (!rows.length) return `<div class="bzs-empty">还没有书签。<br>读到的地方，点阅读栏「签」记一枚。</div>`;
  return `<div class="bzs-sbsec">按书中先后</div><div class="bzs-timeline">${rows
    .map(
      (k) => `<div class="bzs-mkrow" data-act="jumpbmk" data-id="${k.id}">
        <span class="tt">${esc(k.label)}</span><span class="pc">${k.percent}%</span><span class="sp"></span>
        <em>${esc(k.chapterTitle)}</em>
        <button class="x" data-act="delbmk" data-id="${k.id}" title="删除">×</button>
      </div>`,
    )
    .join('')}</div>`;
}

function highlightsBody(rows: MarkRow[]): string {
  if (!rows.length) return `<div class="bzs-empty">还没有划线。<br>在正文里选中一段文字，浮出的色点里挑一支笔。</div>`;
  return groupByChapter(rows)
    .map(
      (g) => `<div class="bzs-hlgroup">
        <div class="bzs-hlg-h"><span>${esc(g.title)}</span><span class="n">${g.items.length}</span><span class="ln"></span></div>
        ${g.items
          .map(
            (m) => `<div class="bzs-hlit" style="--c:${m.css}" data-act="hlcard" data-id="${m.id}">
              <span class="tx">${esc(m.text)}</span>
              ${m.comment ? `<span class="cm"><b>想 法</b>${esc(m.comment)}</span>` : ''}
              <button class="x" data-act="delmark" data-id="${m.id}" title="删除">×</button>
            </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
}

function aiBody(v: SidebarView): string {
  const log = v.aiLog.length
    ? v.aiLog
    : [
        {
          me: false,
          tag: 'AI',
          text: v.aiReady
            ? '选中一段文字，点划词浮层里的「AI 解释」；或直接在这本书里问一个问题。回答只引用你当前位置之前的内容。'
            : '还没有配置 AI 服务。到书架 · 设置里填好服务商、模型与密钥，这里就能用了。',
        },
      ];
  return `<div class="bzs-aichat">
      ${log
        .map((m) => `<div class="bzs-aibubble${m.me ? ' me' : ''}"><span class="tag">${m.me ? '我' : esc(m.tag)}</span>${esc(m.text)}</div>`)
        .join('')}
      <div class="bzs-aiask">
        <input data-role="aiask" placeholder="${v.aiReady ? '问这本书…' : 'AI 未配置'}"${v.aiReady ? '' : ' disabled'}>
        <button class="bzs-btn sm pri" data-act="aiask">问</button>
      </div>
      <div class="bzs-mini" style="padding:6px 2px">${v.aiReady ? `仅看当前位置之前 · ${esc(v.aiProvider)}` : '服务在书架 · 设置里配置'}</div>
    </div>`;
}

export function viewSidebar(v: SidebarView): string {
  const book = v.book;
  const title = book ? book.meta.title || '未命名' : '没有打开的书';
  const counts = book
    ? {
        toc: v.toc?.length ?? 0,
        bookmarks: (book.notes?.bookmarks ?? []).length,
        highlights: (book.notes?.highlights ?? []).length,
      }
    : { toc: 0, bookmarks: 0, highlights: 0 };

  const tabCount = (t: SideTab): number =>
    t === 'toc' ? counts.toc : t === 'bookmarks' ? counts.bookmarks : t === 'highlights' ? counts.highlights : 0;

  const tabs = sideTabs(v.aiEnabled !== false)
    .map((t) => {
      const n = tabCount(t.value);
      return `<button class="bzs-sbtab${v.tab === t.value ? ' on' : ''}" data-act="sbtab" data-tab="${t.value}" title="${t.label}">${ico(
        t.icon,
      )}<span>${t.label}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
    })
    .join('');

  let body: string;
  if (!book) {
    body = `<div class="bzs-empty">左侧栏跟着阅读走。<br>在书架点开一本书，目录、书签与划线就会出现在这里。</div>`;
  } else if (v.tab === 'toc') {
    body = v.toc?.length ? tocBody(v.toc, v.activeLabel) : `<div class="bzs-empty">这本书还没有解析出目录。<br>翻一页之后会重新试一次。</div>`;
  } else if (v.tab === 'bookmarks') {
    body = bookmarksBody(bmksOf(book));
  } else if (v.tab === 'highlights') {
    body = highlightsBody(marksOf(book));
  } else {
    body = aiBody(v);
  }

  return `<div class="bzs-side">
    <div class="bzs-sbtabs">${tabs}</div>
    <div class="bzs-sbhead"><b>${esc(title)}</b></div>
    <div class="bzs-sbbody">${body}</div>
  </div>`;
}
