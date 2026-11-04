/* ============================================================
 * bz-reader · 原生侧栏视图（view/side-view.ts）
 *
 * 这里只装「书的坐标」：目录 / 书签 / 划线 / AI。
 *
 * 书架（书库 / 笔记 / 统计 / 设置）**不在这里**——它是中心 tab 里的一个
 * 视图（VIEW_TYPE_STUDY，见 shell/study-view.ts）。2026-11-03 试过把书架
 * 也塞进侧栏，结果封面墙在 300px 里只能排三列、书名被截成两行认不出是哪本，
 * 于是拆开：侧栏管「这一本读到哪」，中心 tab 管「我有哪些书」。
 * 站内曾经有注释写着「侧栏是书架唯一的家」，那是上一版的结论，已改。
 *
 * 三份数据源：
 *   1. shell/state.ts   当前页签、当前书 id、书架四页的页内状态
 *   2. toc-state.ts     目录快照，由阅读视图写入（它是唯一写入方）
 *   3. store            书与标注的真实数据
 * ============================================================ */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { FoliateTOCItem } from '../types/foliate';
import { isMobileShell } from '../core/mobile';
import { dispatchAction, dispatchInput } from '../shell/actions';
import { getState, setState, subscribe, type SideTab } from '../shell/state';
import { liveBooks, shellPrefs, shellSettings } from '../shell/source';
import { RT } from '../shell/runtime';
import { viewSidebar } from '../shell/render/sidebar';
import { focusSelector, type FocusMemo } from '../shell/focus-memo';
import { isTocItemActive, type TocActiveRef } from '../shell/toc-active';
import { getToc, subscribeToc } from './toc-state';

/** 保留旧值：已保存的工作区布局按这个字符串恢复 leaf */
export const VIEW_TYPE_TOC = 'bz-reader-toc';

export type { SideTab };

export class SideView extends ItemView {
  private root: HTMLElement | null = null;
  private unsubs: Array<() => void> = [];
  /** 每个页签各自的滚动位置：从划线切回目录不该跳回顶部 */
  private scrollTops: Record<string, number> = {};
  /** 全量重绘会换掉输入框，焦点与光标要还回去（设置页在侧栏里，边打字边丢焦点很难受） */
  private focusMemo: FocusMemo | null = null;
  /** 上一次全量渲染时的目录快照（判断「只是换高亮」还是「整棵树变了」） */
  private paintedItems: FoliateTOCItem[] | null = null;
  private paintedBook = '';
  private paintedActive = '';
  private paintedActiveHref = '';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TOC;
  }

  getDisplayText(): string {
    return 'bz 阅读';
  }

  getIcon(): string {
    return 'book-open';
  }

  /** 外部（ribbon / 命令 / 阅读页）指定落点 */
  setTab(tab: SideTab): void {
    setState({ sideTab: tab });
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('bzs-shell-wrap');
    /* is-side：侧栏不铺自己的底色（宿主侧栏是 secondary，铺 primary 会多一张白纸） */
    this.root = this.contentEl.createDiv({ cls: `bzs-shell is-side${isMobileShell() ? ' is-mobile' : ''}` });
    this.bind();
    this.render();
    this.unsubs.push(subscribe(() => this.render()));
    this.unsubs.push(subscribeToc(() => this.onTocChange()));
  }

  async onClose(): Promise<void> {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.contentEl.empty();
  }

  private bind(): void {
    const el = this.contentEl;
    el.addEventListener('click', (e) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      dispatchAction(hit.dataset.act || '', hit, { repaint: () => this.render() });
    });

    const onEdit = (e: Event): void => {
      const t = e.target as HTMLElement;
      if (!t?.dataset?.role) return;
      dispatchInput(t as HTMLInputElement, e);
    };
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);
    /* 输入法上屏后补一次：input 期间 isComposing 为真会被跳过（P1-10） */
    el.addEventListener('compositionend', onEdit);

    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && (t as HTMLInputElement)?.dataset?.role === 'aiask') {
        e.preventDefault();
        dispatchAction('aiask', t, { repaint: () => this.render() });
        return;
      }
      /* 键盘可达性（S-02）：目录行、书签行、划线行都补了 role=button
         + tabindex=0，但以前只有 click 委托——Tab 得过去、按 Enter/Space
         毫无反应。这里把 Enter/Space 转成同一个动作。 */
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const hit = t.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      dispatchAction(hit.dataset.act || '', hit, { repaint: () => this.render() });
    });

    el.addEventListener(
      'scroll',
      (e) => {
        const body = e.target as HTMLElement;
        if (body?.classList?.contains('bzs-sbbody')) {
          this.scrollTops[getState().sideTab] = body.scrollTop;
        }
      },
      true,
    );
  }

  private memoFocus(): void {
    const el = document.activeElement as HTMLElement | null;
    const role = el?.dataset?.role;
    if (!el || !role || !this.root?.contains(el)) {
      this.focusMemo = null;
      return;
    }
    const input = el as HTMLInputElement;
    this.focusMemo = {
      role,
      k: el.dataset.k,
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    };
  }

  private restoreFocus(): void {
    const memo = this.focusMemo;
    this.focusMemo = null;
    if (!memo) return;
    const el = this.root?.querySelector<HTMLInputElement>(focusSelector(memo.role, memo.k));
    if (!el) return;
    el.focus();
    try {
      el.setSelectionRange(memo.start, memo.end);
    } catch {
      /* range 型 input 不支持 setSelectionRange，忽略 */
    }
  }

  /**
   * TOC 变更：目录树没变就只切高亮，不重建整棵树。
   *
   * 每次 relocate（翻一页）都会 patchToc({activeLabel})，而全量 render 会把
   * 目录 + 划线 + AI 气泡一起重建——手机上每翻一页掉一次帧，正在输入的关键词
   * 也要靠 focusMemo 抢回来。目录内容本身变了（换书/重新解析）才走全量。
   *
   * 2026-11-04 修条件写反（P1-11）：以前是 `sameTree && moved`，于是
   *   · 同章内翻页（高亮没变，moved=false）→ 走全量 render，最该走快路径的
   *     那条路反而最贵；
   *   · 换章（高亮真的变了）→ 走快路径。
   * 现在只要「同一棵树 + 目录页签 + 已渲染」就走快路径，内部再按 moved
   * 决定要不要动 DOM。
   */
  private onTocChange(): void {
    const snap = getToc();
    const activeLabel = snap?.activeLabel ?? '';
    const activeHref = snap?.activeHref ?? '';
    const sameTree =
      (snap?.items ?? null) === this.paintedItems && (snap?.bookId ?? '') === this.paintedBook;
    const moved = activeLabel !== this.paintedActive || activeHref !== this.paintedActiveHref;
    if (sameTree && getState().sideTab === 'toc' && this.root) {
      if (!moved) return; // 高亮没变，DOM 一行都不用动
      this.paintedActive = activeLabel;
      this.paintedActiveHref = activeHref;
      this.patchActiveRow(this.root, { label: activeLabel, href: activeHref });
      return;
    }
    this.render();
  }

  /** 只切 `.on`：按 href 定位唯一一行；href 缺失才退回 data-label（老快照） */
  private patchActiveRow(root: HTMLElement, active: TocActiveRef): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bzs-chaprow'))) {
      const item = { label: el.dataset.label ?? '', href: el.dataset.href ?? '' };
      el.classList.toggle('on', isTocItemActive(item, active));
    }
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const state = getState();
    const snap = getToc();
    const bookId = state.bookId || snap?.bookId || '';
    const books = liveBooks();
    const book = books.find((b) => b.id === bookId) ?? null;
    const settings = shellSettings();

    this.memoFocus();

    root.dataset.bzaccent = shellPrefs().accent;
    root.innerHTML = viewSidebar({
      book,
      tab: state.sideTab,
      toc: snap?.items ?? ([] as FoliateTOCItem[]),
      activeLabel: snap?.activeLabel ?? '',
      activeHref: snap?.activeHref ?? '',
      aiLog: RT.aiLog,
      aiReady: !!settings.ai.baseUrl && !!settings.ai.apiKey && !!settings.ai.model,
      aiProvider: settings.ai.model || '未配置',
      collapsed: RT.tocCollapsed,
    });
    this.paintedItems = snap?.items ?? null;
    this.paintedBook = snap?.bookId ?? '';
    this.paintedActive = snap?.activeLabel ?? '';
    this.paintedActiveHref = snap?.activeHref ?? '';

    const scroller = root.querySelector<HTMLElement>('.bzs-sbbody');
    if (scroller) scroller.scrollTop = this.scrollTops[state.sideTab] ?? 0;
    this.restoreFocus();
  }
}
