/* ============================================================
 * bz-reader · 左侧栏五页签（shell/render/sidebar.ts）
 *
 * 侧栏是「读书时的坐标」，不是书库。所以它只回答三个问题：
 * 我在哪（目录）、我留过什么记号（书签 / 划线）、别人引过哪（引用）、
 * 这一段什么意思（AI）。
 * 换书与回书架在顶行，不在这里再放一层书架。
 *
 * 目录来自 toc-state 的快照（阅读视图是唯一写入方），
 * 书关闭后快照为空——这时给空态，不假装有目录。
 * ============================================================ */
import { t, type MsgKey } from '../../i18n';
import type { ReaderBook } from '../../data/schema';
import type { FoliateTOCItem } from '../../types/foliate';
import type { BmkRow, MarkRow } from '../domain';
import { bmksOf, groupByChapter, marksOf } from '../domain';
import type { SideTab } from '../state';
import type { AiLogItem } from '../runtime';
import type { AiHistRow } from '../ai-chat';
import {
  canSendAi,
  ctxChipText,
  type AiContextItem,
} from '../ai-context';
import { aiPromptLabels } from '../ai-labels';
import { isTocItemActive, type TocActiveRef } from '../toc-active';
import type { BuildProgress } from '../../data/portrait-build';
import type { PortraitPlan, PortraitState } from '../../data/portrait';
import { portraitEstimate } from './portrait';
import { kbLinksHtml } from '../kb-links';
import { esc, ico, icoNative, MAG } from './html';
import {
  groupNotes,
  searchNotes,
  NOTE_PICKER_ROWS,
  NOTE_SEARCH_LIMIT,
  type PickerNote,
} from '../note-picker';

/* AiLogItem 的字段口径只有一份，在 shell/runtime.ts（pushAi 往那儿写）。
   这里以前自己抄了一份，加 sources 时两份就对不上了。 */
export type { AiLogItem } from '../runtime';
export type { AiHistRow } from '../ai-chat';

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
  /** 输入框里没发出去的草稿：侧栏整页重建后要能原样回填 */
  aiDraft?: string;
  /** 输入条里还没发出去的上下文（A 版四类：划线 / 正文 / 截图 / 笔记） */
  aiCtx?: readonly AiContextItem[];
  /** 笔记选择器开着没有 */
  aiNoteOpen?: boolean;
  /** 笔记选择器里的搜索词 */
  aiNoteKw?: string;
  /** 浮层里勾选的路径 */
  aiNotePicked?: readonly string[];
  /** 笔记清单（打开时从全库取一次，搜索在这里面找） */
  aiNotes?: readonly AiNoteRow[];
  /** 正在等 AI：`evidence` 检索依据、`model` 生成回答；空 = 没有在等 */
  aiStage?: '' | 'evidence' | 'model';
  /** 当前这条对话的会话 id（历史列表里标「当前」用） */
  aiChatId?: string;
  /** 历史面板开着没有 */
  aiHistOpen?: boolean;
  /** 历史面板里的行（新的在前） */
  aiHist?: readonly AiHistRow[];
  /**
   * AI 页签的索引态（2026-11-07 定稿）。
   *
   * 侧栏先回答「这本书能不能按全书提问」：没索引就摆「建立索引」，
   * 建法与进度都在这块里，不弹窗；建好之后才出现输入框。
   * 缺省 = 还没读到状态，按「未建」画但不出按钮（避免建过的书闪一下）。
   */
  aiIndex?: AiIndexView;
  /** 被折叠的父章节 href（见 runtime.tocCollapsed）；缺省 = 全部展开 */
  collapsed?: ReadonlySet<string>;
  /**
   * 目录行可以拖出去（拖进笔记就是一条带页码的链接）。
   *
   * 只有 PDF 给：EPUB 的 href 是书内路径，拼出来的链接打不开那一章。
   */
  tocDraggable?: boolean;
  /**
   * 引用反链：哪几篇笔记引了这本书的哪一处。
   *
   * 由阅读视图按书推送（宿主从 Obsidian 的链接索引里捞）：PDF 是
   * 「哪一页」，EPUB 是「哪一章的哪一句」。只放数据不放「有没有开书」
   * ——那是 `book` 的事。
   */
  cites?: ReadonlyArray<CiteRowView>;
  /** 当前停在第几页（0 = 不是 PDF / 未知），「只看本页」用 */
  activePage?: number;
  /** 「只看本页」开关是否打开 */
  citesOnlyPage?: boolean;
}

/** 笔记选择器的一行（数据来自库里的 Markdown 文件） */
export interface AiNoteRow {
  title: string;
  path: string;
  /** 二级说明：所在目录 */
  desc: string;
}

/** 侧栏 AI 页签要画的那点索引状态 */
export interface AiIndexView {  state: PortraitState;
  /** 盘上的状态还没读回来：先只说一句「在读」，不摆按钮也不摆输入框 */
  loading?: boolean;
  /** 正在跑（或上次停在一半）的任务进度；null / 缺省 = 没有任务 */
  progress?: BuildProgress | null;
  /** 正文体积（切块之前按它估块数与请求数） */
  chars: number;
  /** 用户点了「建立索引」，正在选建法 */
  choosing?: boolean;
  plan: PortraitPlan;
  /** 手机端不建索引（建好的照样能问） */
  mobile?: boolean;
  /** 这本书正在阅读视图里打开：建索引要读它的正文 */
  open?: boolean;
  /** 嵌入服务 / 对话模型分别配好了没（两种建法要的东西不一样） */
  embedReady?: boolean;
  askReady?: boolean;
  /** 已建好的块数（建好后那行元信息用） */
  blocks?: number;
}

/**
 * 侧栏页签：书的坐标。书架是中心 tab，不在这里（封面墙需要宽度）。
 * 顺序即优先级：目录 → 书签 → 划线 → 引用 → AI；打开一本书自动落在目录。
 * 「引用」列的是笔记里指向本书具体位置的链接，EPUB / PDF 各有各的反链，
 * 没数据时给空态。
 *
 * 入口平权：AI 与引用页签始终存在，基础版点它由 actions 弹高级版对照页、
 * 不切过去；引用页签跟双向链接共用一道门禁。
 */
export const SIDE_TABS: Array<{ value: SideTab; key: MsgKey; icon: string }> = [
  { value: 'toc', key: 'side.tab.toc', icon: 'book-open' },
  { value: 'bookmarks', key: 'side.tab.bookmarks', icon: 'bookmark' },
  { value: 'highlights', key: 'side.tab.highlights', icon: 'highlighter' },
  { value: 'cites', key: 'side.tab.cites', icon: 'quote' },
  { value: 'ai', key: 'tool.ai', icon: 'sparkles' },
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
function tocBody(
  toc: FoliateTOCItem[],
  active: TocActiveRef,
  collapsed: ReadonlySet<string>,
  draggable = false,
): string {
  /* 计数只算文章行：源分组是「卷名」，不是要读的一节。以前 3 个源 + 23 篇
     显示「共 26 节」，读者会以为多了 3 篇（真机反复报）。 */
  let total = 0;
  const count = (items: FoliateTOCItem[]): void => {
    for (const it of items) {
      if (it.subitems?.length) count(it.subitems);
      else total += 1;
    }
  };
  count(toc);

  /* 整份目录一层平铺（扫顶层即可：任何层级的子项都挂在顶层某一项下面）时，
     左边不必为箭头留位——留了就是每行都缩进 22px，标题跟「共 N 节」对不齐。
     真有两级时仍留同宽占位，同级标题的左边缘才对得齐。 */
  const foldable = toc.some((it) => !!it.subitems?.length);

  const rows: string[] = [];
  const walk = (items: FoliateTOCItem[], depth: number): void => {
    for (const it of items) {
      const on = isTocItemActive(it, active);
      const kids = it.subitems?.length ? it.subitems : null;
      const isCollapsed = !!kids && collapsed.has(it.href);
      /* 序号列（原 .no）去掉了：侧栏只有 300px，那一列吃掉 24px + 10px 间距，
         长章节名被截在最难认的位置。层级靠缩进（.d1）表达就够了。
         高亮比对用原始 label，显示用剥过序号的。 */
      const tw = kids
        ? `<span class="tw" data-act="toctoggle" data-href="${esc(it.href)}" title="${
            isCollapsed ? t('side.expand') : t('side.collapse')
          }">${ico('chevron')}</span>`
        : foldable
          ? `<span class="tw is-empty"></span>`
          : '';
      /* 长中文标题在 300px 里只显示半句，「派早报」两篇几乎分不出来：
         行上带完整 title（悬浮可看全），剪藏本的行 CSS 还允许折两行。 */
      const state = it.state ? ` data-state="${esc(it.state)}"` : '';
      const num = kids && it.count != null ? `<span class="n">${it.count}</span>` : '';
      rows.push(`<div class="bzs-chaprow${depth ? ' d1' : ''}${on ? ' on' : ''}${
        isCollapsed ? ' is-collapsed' : ''
      }" data-act="jumpch" data-href="${esc(it.href)}" data-label="${esc(it.label)}"${state} title="${esc(
        it.label,
      )}" role="button" tabindex="0"${draggable ? ' draggable="true"' : ''}>
        ${tw}
        <span class="t">${esc(stripTocLabel(it.label))}</span>
        ${num}
      </div>`);
      if (kids && !isCollapsed) walk(kids, depth + 1);
    }
  };
  walk(toc, 0);

  return `<div class="bzs-sbsec">${t('side.toc.count', { n: total })}</div>${rows.join('')}`;
}

function bookmarksBody(rows: BmkRow[]): string {
  if (!rows.length) {
    return `<div class="bzs-empty">${t('side.bookmarks.empty')}<br>${t('side.bookmarks.emptyHint')}</div>`;
  }
  /* 两行：第一行书名 + 百分比 + 删除，第二行目录名。
     以前三个都在一行，侧栏 300px 里谁都被截；目录名本来就是「在哪」，
     和「叫什么、读到哪」不是一回事，分开放反而都读得全。 */
  return `<div class="bzs-sbsec">${t('side.bookmarks.order')}</div><div class="bzs-timeline">${rows
    .map(
      (k) => `<div class="bzs-mkrow" data-act="jumpbmk" data-id="${esc(k.id)}" role="button" tabindex="0">
        <div class="hd"><span class="tt">${esc(k.label)}</span><span class="pc">${k.percent}%</span>
        <button class="x" data-act="delbmk" data-id="${esc(k.id)}" title="${t('side.delete')}">${ico('x')}</button></div>
        <em>${esc(k.chapterTitle)}</em>
      </div>`,
    )
    .join('')}</div>`;
}

function highlightsBody(rows: MarkRow[]): string {
  if (!rows.length) {
    return `<div class="bzs-empty">${t('side.highlights.empty')}<br>${t('side.highlights.emptyHint')}</div>`;
  }
  return groupByChapter(rows)
    .map(
      (g) => `<div class="bzs-hlgroup">
        <div class="bzs-hlg-h"><span>${esc(g.title)}</span><span class="n">${g.items.length}</span><span class="ln"></span></div>
        ${g.items
          .map(
            (m) => `<div class="bzs-hlit" style="--c:${m.css}" data-act="hljump" data-id="${esc(m.id)}" role="button" tabindex="0">
              <span class="tx"><i class="dot" style="background:${m.css}"></i>${esc(m.text)}</span>
              ${m.comment ? `<span class="cm"><b>${t('side.ideaTag')}</b><span class="cmm">${esc(m.comment)}</span></span>` : ''}
              ${kbLinksHtml(m.kb)}
              <button class="x" data-act="delmark" data-id="${esc(m.id)}" title="${t('side.delete')}">${ico('x')}</button>
            </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
}

/**
 * 引用行。PDF 看「页」，EPUB 看「章节 + 定位」——一本书只会走其中一支。
 * 字段都对可选，是为了让两种来源能塞进同一个数组。
 */
export interface CiteRowView {
  /** PDF：1 基页码；EPUB 没有页码 */
  page?: number;
  sourcePath: string;
  label?: string;
  color?: string;
  /** EPUB：跳回原文的定位串（CFI） */
  locator?: string;
  /** EPUB：章节名（链接里的 `c=`），分组头用它 */
  chapter?: string;
  /** EPUB：章节内百分比 0..1 */
  pct?: number;
  /** EPUB：原文前若干字，别名缺失时当行标题 */
  text?: string;
}

/**
 * 一行引用：点它跳回书里，右边那颗小按钮才打开笔记（跳回去是主操作）。
 *
 * `page > 0` 走 PDF 的页定位；否则走 EPUB 的 cfi / 原文 / 百分比，
 * 三个都带上是给三级降级用的（CFI 失效还能按原文搜、按百分比落）。
 */
function citeRowHtml(row: CiteRowView, page: number): string {
  const path = row.sourcePath;
  const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
  /* 别名是笔记里写的原文；没有就用链接里的原文片段。
     用它当行标题比「文件名」有用，文件名一长串，扫一眼不知道引的是哪句话。 */
  const label = String(row.label ?? row.text ?? '').replace(/\s+/g, ' ').trim();
  const dot = row.color
    ? `<i class="dot" style="background:${esc(row.color)}"></i>`
    : '<i class="dot"></i>';
  const jump =
    page > 0
      ? `data-page="${page}"`
      : `data-cfi="${esc(row.locator ?? '')}"` +
        (row.chapter ? ` data-chapter="${esc(row.chapter)}"` : '') +
        (row.text ? ` data-text="${esc(row.text)}"` : '') +
        (typeof row.pct === 'number' ? ` data-pct="${row.pct}"` : '');
  return `<div class="bzs-cite" data-act="citejump" ${jump} role="button" tabindex="0" title="${esc(path)}">
    ${dot}<span class="nm">${esc(name)}</span>${label ? `<span class="tx">${esc(label)}</span>` : ''}
    <button class="x" data-act="citeopen" data-path="${esc(path)}" title="${t(
      'side.cites.open',
    )}">${icoNative('external-link', 13)}</button>
  </div>`;
}

/**
 * EPUB 引用：按章节分组。
 *
 * 没有页码可排，章节名就是「在哪」这条线；同一章被引五处时并成一组，
 * 组内保持链接出现的顺序。没有章节名的老链接归到「其他位置」，
 * 不硬编一个假章节。
 */
function citesByChapter(rows: ReadonlyArray<CiteRowView>): string {
  const groups = new Map<string, CiteRowView[]>();
  for (const row of rows) {
    const key = String(row.chapter ?? '').trim();
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups]
    .map(([chapter, list]) => {
      const head = `<div class="bzs-hlg-h"><span>${esc(
        chapter || t('side.cites.bookPlace'),
      )}</span><span class="n">${t('side.cites.count', { n: list.length })}</span><span class="ln"></span></div>`;
      return `<div class="bzs-hlgroup">${head}${list.map((r) => citeRowHtml(r, 0)).join('')}</div>`;
    })
    .join('');
}

/**
 * 引用（反链）。
 *
 * PDF 按页升序分组：一页被三篇笔记引过，就问「这页被谁引过」，不是按笔记列
 * ——用户在这页上看见虚线框，想知道出处，翻的是「页码」这条线。
 * EPUB 没有页码，按章节分组（见 `citesByChapter`）。
 */
function citesBody(
  rows: ReadonlyArray<CiteRowView>,
  activePage = 0,
  onlyPage = false,
): string {
  if (!rows.length) {
    /* 空态要讲清依赖：这里列的是笔记里「带书内定位」的链接，不是插件替用户
       攒的笔记。不写 `#page=` 这类 PDF 专用语法（EPUB 上照着写会教错话），
       也不点名高级版——链接可以自己写，页签本身免费。 */
    return `<div class="bzs-empty">${t('side.cites.empty')}</div>`;
  }
  /* EPUB 没有页码：一行一个位置，不摆「只看本页」那枚开关 */
  if (!rows.some((r) => (r.page ?? 0) > 0)) return citesByChapter(rows);
  /* 「只看本页」：翻到第 40 页时，前面几十组都是路过的噪声。
     只在真有当前页、且确实按页分组时才给这枚开关。 */
  const canFilter = activePage > 0;
  const shown = onlyPage && canFilter ? rows.filter((r) => r.page === activePage) : rows;
  const toggle = canFilter
    ? `<button type="button" class="bzs-citeonly${onlyPage ? ' on' : ''}" data-act="citeonly" title="${t(
        'side.cites.onlyPage',
      )}">${t('side.cites.onlyPage')}</button>`
    : '';
  if (!shown.length) {
    return `<div class="bzs-citehead">${toggle}</div><div class="bzs-empty">${t('side.cites.noneHere')}</div>`;
  }
  const byPage = new Map<number, CiteRowView[]>();
  for (const row of shown) {
    const page = Number(row.page) || 0;
    const list = byPage.get(page) ?? [];
    list.push(row);
    byPage.set(page, list);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  return (
    (toggle ? `<div class="bzs-citehead">${toggle}</div>` : '') +
    pages
      .map((page) => {
        const sources = byPage.get(page) ?? [];
        const head = `<div class="bzs-hlg-h${page === activePage ? ' is-here' : ''}"><span>${t(
          'side.cites.page',
          { n: page },
        )}</span><span class="n">${t('side.cites.count', { n: sources.length })}</span><span class="ln"></span></div>`;
        const items = sources.map((row) => citeRowHtml(row, page)).join('');
        return `<div class="bzs-hlgroup">${head}${items}</div>`;
      })
      .join('')
  );
}

/**
 * 一条回答下面的来源（决策 17：点了能打开对应笔记或书）。
 *
 * 三种：库内笔记 → opensrc；全书的章 → opensrcbook（带书号与章名）；
 * 两样都没有的（例如「本章」这种兜底名）只当说明。
 */
function aiSourcesRow(m: AiLogItem): string {
  if (m.me || !m.sources?.length) return '';
  const items = m.sources
    .map((s) => {
      const label = esc(s.title);
      const tip = esc(s.note || s.path || s.title);
      if (s.path) {
        return `<button type="button" class="bzs-aisrc-i" data-act="opensrc" data-path="${esc(s.path)}" title="${tip}">${label}</button>`;
      }
      if (s.bookId) {
        return `<button type="button" class="bzs-aisrc-i" data-act="opensrcbook" data-book="${esc(
          s.bookId,
        )}" data-chapter="${esc(s.title)}" data-text="${esc(s.text ?? '')}" title="${tip}">${label}</button>`;
      }
      return `<span class="bzs-aisrc-i" title="${tip}">${label}</span>`;
    })
    .join('');
  return `<div class="bzs-aisrc"><span class="lbl">${esc(t('side.ai.sources'))}</span>${items}</div>`;
}

/**
 * 索引建法与进度（2026-11-07 定稿）。
 *
 * 以前这两步是「全书问答准备」弹窗：打开弹层 → 看预估 → 选方案 → 开始。
 * 现在全部收进这一块侧栏，理由是它本来就在同一个位置反复出现——建完之前
 * 侧栏 AI 页签本来也干不了别的，弹窗只是把同一件事又说了一遍。
 *
 * 一条硬规矩：
 *   · 没建索引 → 只有「建立索引」与「观看视频教程」；
 *   · 建到一半 → 只有进度与暂停 / 取消；
 *   · 建好了   → 才出现输入框（问什么都按全书回答）。
 */
const PLAN_LABEL: Record<PortraitPlan, MsgKey> = {
  vector: 'pt.plan.vector',
  compress: 'pt.plan.compress',
};

const PLAN_EST: Record<PortraitPlan, MsgKey> = {
  vector: 'pt.estimate.vector',
  compress: 'pt.estimate.compress',
};

function tutorialBtn(): string {
  return `<button class="bzs-btn sm" data-act="aitutorial">${t('side.ai.index.tutorial')}</button>`;
}

function buildBtn(stale: boolean): string {
  return `<button class="bzs-btn sm pri" data-act="aiidx">${stale ? t('side.ai.index.rebuild') : t('side.ai.index.build')}</button>`;
}

/** 选建法：两张卡写清块数与请求数，确认之后才跑 */
function indexChoose(v: AiIndexView): string {
  const cards = (['vector', 'compress'] as const)
    .map((plan) => {
      const est = portraitEstimate(v.chars, plan, 0);
      const on = v.plan === plan;
      // 这一档要的服务没配好：仍然可选，但把缺什么写在卡片下面（按钮不给灰）
      const lack =
        plan === 'vector' && v.embedReady === false
          ? t('side.ai.embedNotReady')
          : plan === 'compress' && v.askReady === false
            ? t('side.ai.notReady')
            : '';
      return `<button class="bzs-aiplan${on ? ' on' : ''}" data-act="aiplan" data-v="${plan}" aria-pressed="${on}">
          <b>${esc(t(PLAN_LABEL[plan]))}</b>
          <span class="est">${esc(t(PLAN_EST[plan], { blocks: est.blocks, requests: est.requests }))}</span>
          ${on && lack ? `<em class="lack">${esc(lack)}</em>` : ''}
        </button>`;
    })
    .join('');
  return `<div class="bzs-aiidx">
      <div class="lead">${t('side.ai.index.choose')}</div>
      ${cards}
      <div class="acts">
        <button class="bzs-btn sm pri" data-act="aistart">${t('pt.start')}</button>
        <button class="bzs-btn sm" data-act="aiidxclose">${t('pt.stop')}</button>
      </div>
    </div>`;
}

/** 跑起来之后：进度条 + 一行「第几块」+ 暂停 / 取消 */
function indexRun(p: BuildProgress): string {
  const extracting = p.phase === 'extract' || p.status === 'extract';
  const line = extracting
    ? t('pt.extract', { done: p.extractDone, total: p.extractTotal })
    : p.total
      ? t('pt.block', { done: p.done, total: p.total })
      : t('pt.extract', { done: 0, total: 0 });
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 4;
  const paused = p.status === 'paused';
  const failed = p.failed > 0;
  const note = [paused ? t('pt.pause') : '', failed ? t('pt.failedBlocks', { n: p.failed }) : '']
    .filter(Boolean)
    .join(' · ');
  return `<div class="bzs-aiidx">
      <div class="bzs-idxhd"><b>${t('side.ai.index.running')}</b><span class="pc">${pct}%</span></div>
      <div class="bzs-idxbar"><i style="width:${pct}%"></i></div>
      <div class="bzs-mini">${esc(line)}${note ? ` · ${esc(note)}` : ''}</div>
      ${p.message ? `<div class="bzs-mini is-bad">${esc(p.message)}</div>` : ''}
      <div class="acts">
        <button class="bzs-btn sm" data-act="${paused ? 'ptresume' : 'ptpause'}">${paused ? t('pt.resume') : t('pt.pause')}</button>
        ${failed ? `<button class="bzs-btn sm" data-act="ptretry">${t('pt.retryFailed')}</button>` : ''}
        <button class="bzs-btn sm" data-act="aiidxstop">${t('pt.stop')}</button>
      </div>
    </div>`;
}

function indexBody(v: SidebarView, idx: AiIndexView): string {
  if (idx.loading) return `<div class="bzs-aiidx"><div class="lead">${t('side.ai.index.loading')}</div></div>`;

  const p = idx.progress ?? null;
  if (p && (p.status === 'extract' || p.status === 'running' || p.status === 'paused' || (p.status === 'error' && p.total > 0))) {
    return indexRun(p);
  }
  /* 刚跑完、盘上的缓存还没换过来：先给一句话，下一次重绘就进对话界面 */
  if (p?.status === 'done') {
    return `<div class="bzs-aiidx"><div class="lead">${t('side.ai.index.done')}</div></div>`;
  }
  if (idx.choosing) return indexChoose(idx);

  const stale = idx.state === 'stale';
  /* 手机上不建索引：只说明去哪儿建，教程按钮仍留着（没有 bz 也能看） */
  if (idx.mobile) {
    return `<div class="bzs-aiidx">
        <div class="lead">${t('pt.mobile')}</div>
        <div class="acts">${tutorialBtn()}</div>
      </div>`;
  }
  return `<div class="bzs-aiidx">
      ${stale ? `<div class="bzs-mini is-bad">${t('side.ai.book.stale')}</div>` : ''}
      <div class="lead">${t('side.ai.index.lead')}</div>
      ${idx.open === false ? `<div class="bzs-mini">${t('pt.needOpen')}</div>` : ''}
      <div class="acts">${buildBtn(stale)}${tutorialBtn()}</div>
    </div>`;
}

/** 截图缩略图：PDF 是 data URL；EPUB 是一份 sandbox iframe 快照 */
function shotThumbHtml(item: AiContextItem, cls = 'bzs-ctx-thumb'): string {
  const thumb = String(item.thumb ?? '');
  if (/^data:image\//i.test(thumb)) {
    return `<span class="${cls}"><img src="${esc(thumb)}" alt=""></span>`;
  }
  const g = item.shot;
  if (g && g.pageW > 0 && g.pageH > 0) {
    /* 原型 thumbHtml：先按选区放大到铺满 26×16，再把选区左上角挪到 0,0 */
    const TW = 26;
    const TH = 16;
    const k = Math.max(TW / Math.max(1, g.w), TH / Math.max(1, g.h));
    const left = -g.x * k + (TW - g.w * k) / 2;
    const top = -g.y * k + (TH - g.h * k) / 2;
    return `<span class="${cls}"><iframe class="bzs-shot-frame" sandbox="" scrolling="no" tabindex="-1" aria-hidden="true" style="width:${g.pageW}px;height:${g.pageH}px;transform:scale(${k});left:${left}px;top:${top}px" srcdoc="${esc(
      thumb,
    )}"></iframe></span>`;
  }
  return `<span class="${cls} is-empty"></span>`;
}

/**
 * 输入条 / 已发气泡里的一枚上下文 chip。
 *
 * A 版把四类上下文压成一样高的一行小标签：截图带 26×16 缩略图，
 * 正文只报字数，笔记露标题，划线露前十几个字。气泡里的不可删。
 */
function ctxChipHtml(
  item: AiContextItem,
  opts: { index?: number; removable?: boolean; max?: number } = {},
): string {
  const labels = aiPromptLabels();
  const label = ctxChipText(item, labels, opts.max);
  const icon =
    item.kind === 'quote' ? '❝' : item.kind === 'body' ? '¶' : item.kind === 'note' ? '▤' : '';
  const remove =
    opts.removable && opts.index !== undefined
      ? `<button class="x" data-act="aictxdel" data-i="${opts.index}" title="${t(
          'side.ai.ctx.remove',
        )}">×</button>`
      : '';
  const shot = item.kind === 'shot' ? shotThumbHtml(item) : '';
  return `<span class="bzs-ctx-chip${item.kind === 'shot' ? ' has-shot' : ''}">${shot}${
    icon ? `<i class="k">${icon}</i>` : ''
  }<i class="t">${esc(label)}</i>${remove}</span>`;
}

/** 一条消息。AI 的答走 Markdown 渲染；用户那句保持纯文本，上下文仍显示成 chip */
function aiBubbleHtml(m: AiLogItem, hint: boolean, at = -1): string {
  if (m.me) {
    const chips = m.ctx?.length
      ? `<div class="bzs-aictx is-sent">${m.ctx
          .map((c) => ctxChipHtml(c, { max: c.kind === 'quote' ? 16 : 10 }))
          .join('')}</div>`
      : '';
    return `<div class="bzs-aibubble me">${chips}<div class="txt">${esc(m.text)}</div></div>`;
  }
  /* 空对话只有一条提示：不加空态卡片、不加标题，和原型一样就是一条 AI 气泡 */
  const body = hint
    ? `<div class="txt">${esc(m.text)}</div>`
    : `<div class="txt" data-ai-md>${esc(m.text)}</div>`;
  /* 每条回答自带「复制」（2026-11-16）：与划词浮框对齐。
     空态提示那条不是回答，不给按钮。 */
  const copy =
    hint || at < 0
      ? ''
      : `<button type="button" class="bzs-ai-copy" data-act="aicopyone" data-i="${at}">${esc(
          t('ai.card.copy'),
        )}</button>`;
  return `<div class="bzs-aibubble ai${m.live ? ' is-live' : ''}"><span class="tag">${t(
    'side.ai.tag.book',
  )}</span>${body}${aiSourcesRow(m)}${aiWarnRow(m)}${copy}</div>`;
}

/** 引文核不上时的那一行：只在真有问题时出现，正常答案下面不多一个字 */
function aiWarnRow(m: AiLogItem): string {
  if (m.me || !m.warn) return '';
  return `<div class="bzs-aiwarn">${esc(m.warn)}</div>`;
}

const PK_DOC =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
const PK_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

/**
 * 浮层里的列表：按所在目录分组，行内仍留目录小字作兜底。
 * 搜索在全库清单里过滤，但一次只画这些行——几千篇塞进 DOM 会卡住侧栏。
 * 这段 HTML 与 side-view 的本地重绘共用，改样式只改这里。
 */
export function notePickerListHtml(
  rows: readonly PickerNote[],
  kw: string,
  picked: readonly string[],
): string {
  const shown = searchNotes(rows, kw, kw.trim() ? NOTE_SEARCH_LIMIT : NOTE_PICKER_ROWS);
  const groups = groupNotes(shown);
  if (!groups.length) return `<div class="bzs-pk-empty">${t('side.ai.ctx.noteEmpty')}</div>`;
  let k = 0;
  return groups
    .map((g) => {
      const head = `<div class="bzs-pk-group">${esc(g.group || t('side.ai.ctx.noteRoot'))}</div>`;
      const lines = g.rows
        .map((n) => {
          const on = picked.includes(n.path);
          return `<button type="button" class="bzs-pk-row${on ? ' is-on' : ''}" data-act="aictxnotepick" data-path="${esc(
            n.path,
          )}" data-title="${esc(n.title)}" data-desc="${esc(n.desc)}" aria-pressed="${on}" style="--k:${k++}">
            <span class="bzs-pk-ic">${PK_DOC}</span>
            <span class="bzs-pk-body"><span class="bzs-pk-nm">${esc(
              n.title,
            )}</span><span class="bzs-pk-ds">${esc(n.desc)}</span></span>
            <span class="bzs-pk-check">${PK_CHECK}</span>
          </button>`;
        })
        .join('');
      return head + lines;
    })
    .join('');
}

/** 笔记选择器：按目录分组 + 底部已选，点确认才把笔记带进对话 */
function notePickerHtml(v: SidebarView): string {
  if (!v.aiNoteOpen) return '';
  const n = v.aiNotePicked?.length ?? 0;
  return `<div class="bzs-picker" data-role="aipicker">
      <div class="bzs-pk-head">
        <b>${t('side.ai.ctx.noteTitle')}</b>
        <span class="bzs-pk-count">${t('side.ai.ctx.noteCount', { n })}</span>
      </div>
      <div class="bzs-pk-search">
        ${MAG}
        <input data-role="ainotesearch" placeholder="${t('side.ai.ctx.noteSearch')}" value="${esc(
          v.aiNoteKw ?? '',
        )}">
        <button type="button" class="bzs-pk-clear" data-act="aictxnoteclear" aria-label="${t(
          'side.ai.ctx.noteClear',
        )}">×</button>
      </div>
      <div class="bzs-pk-list">${notePickerListHtml(
        v.aiNotes ?? [],
        v.aiNoteKw ?? '',
        v.aiNotePicked ?? [],
      )}</div>
      <div class="bzs-pk-foot">
        <div class="bzs-pk-picked"></div>
        <button type="button" class="bzs-pk-insert" data-act="aictxnoteconfirm"${
          n ? '' : ' disabled'
        }>${t('side.ai.ctx.noteInsert')}</button>
      </div>
    </div>`;
}

/**
 * A 版输入卡片：待发送 chips + 自动长高的 textarea + 左下三颗命令 + 右下发送。
 *
 * 2026-11-16：三颗命令换成「三行文字 / 画框 / 折角便签」——
 * 原来那三枚（文件 / 四角扫描框 / 线圈本）在 16px 下认不出来，
 * 尤其「文件」和「笔记」几乎同形。
 */
function aiComposerHtml(v: SidebarView): string {
  const items = v.aiCtx ?? [];
  const disabled = canSendAi(v.aiDraft, items) ? '' : ' disabled';
  return `<div class="bzs-ai-composer">
      <div class="bzs-aictx">${items
        .map((c, i) => ctxChipHtml(c, { removable: true, index: i }))
        .join('')}</div>
      <textarea data-role="aiask" rows="1" placeholder="${t('side.ai.ask.ph')}">${esc(
        v.aiDraft ?? '',
      )}</textarea>
      <div class="bzs-ai-cbar">
        <div class="bzs-ai-qacts">
          <button class="bzs-qbtn" data-act="aictxbody" aria-label="${t('side.ai.ctx.body')}" title="${t(
            'side.ai.ctx.body',
          )}">${icoNative('align-left', 16)}</button>
          <button class="bzs-qbtn" data-act="aictxshot" aria-label="${t('side.ai.ctx.shot')}" title="${t(
            'side.ai.ctx.shot',
          )}">${icoNative('image', 16)}</button>
          <button class="bzs-qbtn" data-act="aictxnote" aria-label="${t('side.ai.ctx.note')}" title="${t(
            'side.ai.ctx.note',
          )}">${icoNative('sticky-note', 16)}</button>
        </div>
        <button class="bzs-ai-send" data-act="aiask" aria-label="${t(
          'side.ai.send',
        )}" title="${t('side.ai.send')}"${disabled}>${icoNative('arrow-up', 18)}</button>
      </div>
      ${notePickerHtml(v)}
    </div>`;
}

/**
 * 正在等回答的那一条（2026-11-16）。
 *
 * 以前这段是空白：发出问题之后侧栏只有用户自己那句，检索 + 生成最慢
 * 二十几秒，看着像没点动。现在先挂一条带跳动点的气泡，正文回来原地替换。
 */
function aiBusyBubble(v: SidebarView): string {
  const stage = v.aiStage;
  if (!stage) return '';
  const label = t(stage === 'evidence' ? 'side.ai.stage.evidence' : 'side.ai.stage.model');
  return `<div class="bzs-aibubble ai is-pending"><span class="tag">${t(
    'side.ai.tag.book',
  )}</span><div class="txt"><span class="bzs-typing"><i></i><i></i><i></i></span><span class="ph">${esc(
    label,
  )}</span></div></div>`;
}

/** 会话历史：这本书聊过的几条，点一条切过去，× 删掉 */
function aiHistPanel(v: SidebarView): string {
  if (!v.aiHistOpen) return '';
  const rows = v.aiHist ?? [];
  const body = rows.length
    ? rows
        .map(
          (r) => `<div class="bzs-aihist-row${r.here ? ' is-here' : ''}">
            <button type="button" class="t" data-act="aihistpick" data-id="${esc(r.id)}">
              <b>${esc(r.head || t('side.ai.hist.untitled'))}</b>
              <span>${t('side.ai.hist.meta', { n: r.n, when: r.when })}</span>
            </button>
            <button type="button" class="x" data-act="aihistdel" data-id="${esc(
              r.id,
            )}" aria-label="${t('common.delete')}" title="${t('common.delete')}">×</button>
          </div>`,
        )
        .join('')
    : `<div class="bzs-aihist-empty">${t('side.ai.hist.none')}</div>`;
  return `<div class="bzs-aihist"><div class="hd">${t('side.ai.hist.title')}</div>${body}</div>`;
}

/** 消息区底部：复制整段 / 归档（与划词浮框同一套动作） */
function aiChatFoot(v: SidebarView): string {
  if (!v.aiLog.some((m) => !m.me)) return '';
  return `<div class="bzs-aifoot">
      <button class="lnk" data-act="aicopychat">${t('side.ai.copyChat')}</button>
      <button class="lnk" data-act="aisavelog">${t('side.ai.archiveChat')}</button>
    </div>`;
}

/** 建好之后：聊天消息 + 固定底栏输入卡片。提问一律按全书回答，没有档位可选 */
function indexChat(v: SidebarView, idx: AiIndexView): string {
  const log: AiLogItem[] = v.aiLog.length
    ? v.aiLog
    : [{ me: false, tag: t('side.ai.tag.book'), text: t('side.ai.hint') }];
  const hint = !v.aiLog.length;
  const blocks = idx.blocks && idx.blocks > 0 ? ` · ${t('pt.blockCount', { n: idx.blocks })}` : '';
  return `<div class="bzs-aichat">
      <div class="bzs-aimeta"><span>${t('side.ai.scope.book')}${blocks}</span>
        <span class="bzs-aimeta-acts">
          <button class="lnk" data-act="aiidxrebuild">${t('side.ai.rebuild.short')}</button>
          <button class="lnk" data-act="aihist">${t('side.ai.hist.open')}</button>
          <button class="lnk" data-act="ainew">${t('side.ai.chat.new')}</button>
          <button class="lnk" data-act="aiclear">${t('side.ai.chat.clear')}</button>
        </span>
      </div>
      ${aiHistPanel(v)}
      <div class="bzs-aimsg">${log
        .map((m, i) => aiBubbleHtml(m, hint, i))
        .join('')}${aiBusyBubble(v)}</div>
      ${aiChatFoot(v)}
      ${aiComposerHtml(v)}
    </div>`;
}

function aiBody(v: SidebarView): string {
  /* 服务没配：说清去哪儿配。没配之前既建不了索引，也问不了；
     但教程按钮仍留着——没装 bz、也没配 AI 的人，正是最需要先看点东西的人。 */
  if (!v.aiReady) {
    return `<div class="bzs-aiidx">
        <div class="lead">${t('side.ai.notReady')}</div>
        <div class="acts">${tutorialBtn()}</div>
      </div>`;
  }
  const idx = v.aiIndex;
  if (!idx) return `<div class="bzs-aiidx"><div class="lead">${t('side.ai.index.lead')}</div></div>`;
  return idx.state === 'ready' ? indexChat(v, idx) : indexBody(v, idx);
}

export function viewSidebar(v: SidebarView): string {
  const book = v.book;
  const title = book ? book.meta.title || t('side.untitled') : t('side.noBook');
  const author = book?.meta.author ? `<span class="author">${esc(book.meta.author)}</span>` : '';
  const counts = book
    ? {
        bookmarks: (book.notes?.bookmarks ?? []).length,
        highlights: (book.notes?.highlights ?? []).length,
      }
    : { bookmarks: 0, highlights: 0 };

  /* 目录不显示条数（2026-11-09）：那是「这本书有多厚」，不是「我要去哪」，
     还和图标抢地方。书签与划线保留——它们表示「我在这本书里留过多少东西」。 */
  const tabCount = (tab: SideTab): number =>
    tab === 'bookmarks'
      ? counts.bookmarks
      : tab === 'highlights'
        ? counts.highlights
        : tab === 'cites'
          ? (v.cites ?? []).length
          : 0;

  const tabs = SIDE_TABS
    .map((tab) => {
      const n = tabCount(tab.value);
      /* 三位数会把页签挤歪：超过 99 只报「99+」，准确数在各自的页里还能数 */
      const badge = n > 99 ? '99+' : String(n);
      const label = t(tab.key);
      return `<button class="bzs-sbtab${v.tab === tab.value ? ' on' : ''}" data-act="sbtab" data-tab="${tab.value}" title="${label}" aria-label="${label}">${icoNative(
        tab.icon,
      )}${n ? `<span class="n">${badge}</span>` : ''}</button>`;
    })
    .join('');

  let body: string;
  if (!book) {
    body = `<div class="bzs-empty">${t('side.empty')}<br>${t('side.emptyHint')}</div>`;
  } else if (v.tab === 'toc') {
    body = v.toc?.length
      ? tocBody(
          v.toc,
          { label: v.activeLabel, href: v.activeHref },
          v.collapsed ?? EMPTY_COLLAPSED,
          v.tocDraggable === true,
        )
      : `<div class="bzs-empty">${t('side.toc.notReady')}<br><button class="bzs-btn sm" data-act="openbook" data-id="${esc(
          book.id,
        )}">${t('side.toc.openCurrent')}</button></div>`;
  } else if (v.tab === 'bookmarks') {
    body = bookmarksBody(bmksOf(book));
  } else if (v.tab === 'highlights') {
    body = highlightsBody(marksOf(book));
  } else if (v.tab === 'cites') {
    body = citesBody(v.cites ?? [], v.activePage ?? 0, v.citesOnlyPage === true);
  } else {
    body = aiBody(v);
  }

  /* 只有真正进到聊天态才切成「消息自己滚 + 输入条钉底」的布局；
     建索引 / 选建法 / 没配服务那几屏还是普通整页滚动。 */
  const aiChat = v.tab === 'ai' && v.aiReady && v.aiIndex?.state === 'ready';
  return `<div class="bzs-side">
    <div class="bzs-sbtabs">${tabs}</div>
    <div class="bzs-sbhead"><b>${esc(title)}</b>${author}</div>
    <div class="bzs-sbbody${aiChat ? ' is-ai' : ''}">${body}</div>
  </div>`;
}
