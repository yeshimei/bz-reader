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
import { isTocItemActive, type TocActiveRef } from '../toc-active';
import { esc, ico, icoNative } from './html';

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
  /** 当前章节的 href：目录里 label 会重复，只有它能把高亮落到唯一一行 */
  activeHref: string;
  /** 未开书时各页签统一空态 */
  aiLog: AiLogItem[];
  aiReady: boolean;
  aiProvider: string;
  /** 被折叠的父章节 href（见 runtime.tocCollapsed）；缺省 = 全部展开 */
  collapsed?: ReadonlySet<string>;
}

/**
 * 侧栏页签：书的坐标。书架是中心 tab，不在这里（封面墙需要宽度）。
 * 顺序即优先级：目录 → 书签 → 划线 → AI；打开一本书自动落在目录。
 *
 * 入口平权：AI 页签始终存在，基础版点它由 actions 弹高级版对照页。
 */
export const SIDE_TABS: Array<{ value: SideTab; label: string; icon: string }> = [
  { value: 'toc', label: '目录', icon: 'book-open' },
  { value: 'bookmarks', label: '书签', icon: 'bookmark' },
  { value: 'highlights', label: '划线', icon: 'highlighter' },
  { value: 'ai', label: 'AI', icon: 'sparkles' },
];

/** 没有折叠状态时的空集：省掉每次渲染都新建一个 Set */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * 目录项的编号是书自己带的（「一、」「3.」「第十二章 」），不是我们画的。
 * 侧栏只有 300px，这些序号占掉一成宽度，扫读时还是噪音——显示时剥掉，
 * 原始 label 不动（高亮比对、章节缩览都还靠它）。
 *
 * 只剥「序号 + 顿号/点/冒号/括号」和「第X章/节/回…」两种开头；
 * 标题本身以数字开头的（如「1984」）不在剥的范围——后面没有分隔符。
 */
export function stripTocLabel(label: string): string {
  const s = label.trim();
  const stripped = s
    .replace(/^(第[0-9一二三四五六七八九十百千两零〇]+[章节回卷讲篇部话][、.．:：\s]*)+/, '')
    .replace(/^[0-9〇零一二三四五六七八九十百千]+[、.．:：)）]\s*/, '')
    .replace(/^(Chapter|CHAPTER)\s+[0-9IVXivx]+\s*[.:：\-—]?\s*/, '');
  return stripped || s;
}

/**
 * 目录。
 *
 * 行尾不再画百分比：它是「第几项 / 共几项」估出来的，不是真实阅读进度，
 * 放在每一行反而让人以为翻页有误差（真机反馈）。要进度看书架与书签页。
 *
 * 折叠：有子项的父章节前面放一枚箭头，点它收起整支子树（`collapsed` 里记 href）。
 * 默认全展开——一进来就只看见几个大部头，等于把「目录」变成「目录的目录」。
 */
function tocBody(toc: FoliateTOCItem[], active: TocActiveRef, collapsed: ReadonlySet<string>): string {
  let total = 0;
  const count = (items: FoliateTOCItem[]): void => {
    for (const it of items) {
      total += 1;
      if (it.subitems?.length) count(it.subitems);
    }
  };
  count(toc);

  const rows: string[] = [];
  const walk = (items: FoliateTOCItem[], depth: number): void => {
    for (const it of items) {
      const on = isTocItemActive(it, active);
      const kids = it.subitems?.length ? it.subitems : null;
      const isCollapsed = !!kids && collapsed.has(it.href);
      /* 序号列（原 .no）去掉了：侧栏只有 300px，那一列吃掉 24px + 10px 间距，
         长章节名被截在最难认的位置。层级靠缩进（.d1）表达就够了。
         高亮比对用原始 label，显示用剥过序号的。 */
      rows.push(`<div class="bzs-chaprow${depth ? ' d1' : ''}${on ? ' on' : ''}${
        isCollapsed ? ' is-collapsed' : ''
      }" data-act="jumpch" data-href="${esc(it.href)}" data-label="${esc(it.label)}" role="button" tabindex="0">
        ${
          kids
            ? `<span class="tw" data-act="toctoggle" data-href="${esc(it.href)}" title="${
                isCollapsed ? '展开' : '折叠'
              }">${ico('chevron')}</span>`
            : `<span class="tw is-empty"></span>`
        }
        <span class="t">${esc(stripTocLabel(it.label))}</span>
      </div>`);
      if (kids && !isCollapsed) walk(kids, depth + 1);
    }
  };
  walk(toc, 0);

  return `<div class="bzs-sbsec">共 ${total} 节</div>${rows.join('')}`;
}

function bookmarksBody(rows: BmkRow[]): string {
  if (!rows.length) return `<div class="bzs-empty">还没有书签。<br>读到的地方，点阅读栏「签」记一枚。</div>`;
  /* 两行：第一行书名 + 百分比 + 删除，第二行目录名。
     以前三个都在一行，侧栏 300px 里谁都被截；目录名本来就是「在哪」，
     和「叫什么、读到哪」不是一回事，分开放反而都读得全。 */
  return `<div class="bzs-sbsec">按书中先后</div><div class="bzs-timeline">${rows
    .map(
      (k) => `<div class="bzs-mkrow" data-act="jumpbmk" data-id="${k.id}" role="button" tabindex="0">
        <div class="hd"><span class="tt">${esc(k.label)}</span><span class="pc">${k.percent}%</span>
        <button class="x" data-act="delbmk" data-id="${k.id}" title="删除">${ico('x')}</button></div>
        <em>${esc(k.chapterTitle)}</em>
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
            (m) => `<div class="bzs-hlit" style="--c:${m.css}" data-act="hljump" data-id="${m.id}" role="button" tabindex="0">
              <span class="tx"><i class="dot" style="background:${m.css}"></i>${esc(m.text)}</span>
              ${m.comment ? `<span class="cm"><b>想 法</b>${esc(m.comment)}</span>` : ''}
              <button class="x" data-act="delmark" data-id="${m.id}" title="删除">${ico('x')}</button>
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

  const tabs = SIDE_TABS
    .map((t) => {
      const n = tabCount(t.value);
      return `<button class="bzs-sbtab${v.tab === t.value ? ' on' : ''}" data-act="sbtab" data-tab="${t.value}" title="${t.label}" aria-label="${t.label}">${icoNative(
        t.icon,
      )}${n ? `<span class="n">${n}</span>` : ''}</button>`;
    })
    .join('');

  let body: string;
  if (!book) {
    body = `<div class="bzs-empty">左侧栏跟着阅读走。<br>在书架点开一本书，目录、书签与划线就会出现在这里。</div>`;
  } else if (v.tab === 'toc') {
    body = v.toc?.length
      ? tocBody(v.toc, { label: v.activeLabel, href: v.activeHref }, v.collapsed ?? EMPTY_COLLAPSED)
      : `<div class="bzs-empty">目录还没准备好。<br><button class="bzs-btn sm" data-act="openbook" data-id="${esc(book.id)}">打开当前书籍</button></div>`;
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
