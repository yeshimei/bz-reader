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
import { can } from '../data/entitlement';
import { isMobileShell } from '../core/mobile';
import { dispatchAction, dispatchInput } from '../shell/actions';
import { getState, setState, subscribe, type SideTab } from '../shell/state';
import { liveBooks, shellPrefs, shellSettings } from '../shell/source';
import { RT } from '../shell/runtime';
import { viewSidebar } from '../shell/render/sidebar';
import { focusSelector, type FocusMemo } from '../shell/focus-memo';
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
    this.root = this.contentEl.createDiv({ cls: `bzs-shell${isMobileShell() ? ' is-mobile' : ''}` });
    this.bind();
    this.render();
    this.unsubs.push(subscribe(() => this.render()));
    this.unsubs.push(subscribeToc(() => this.render()));
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
      dispatchInput(t as HTMLInputElement);
    };
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);

    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key === 'Enter' && t?.dataset?.role === 'aiask') {
        e.preventDefault();
        dispatchAction('aiask', t, { repaint: () => this.render() });
      }
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
      aiLog: RT.aiLog,
      aiReady: !!settings.ai.baseUrl && !!settings.ai.apiKey && !!settings.ai.model,
      aiProvider: settings.ai.model || '未配置',
      aiEnabled: can('ai'),
    });

    const scroller = root.querySelector<HTMLElement>('.bzs-sbbody');
    if (scroller) scroller.scrollTop = this.scrollTops[state.sideTab] ?? 0;
    this.restoreFocus();
  }
}
