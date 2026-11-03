/* ============================================================
 * bz-reader · 书架面板（shell/shelf-panel.ts）
 *
 * 「书架」是一个中心 ItemView，内部四页：书库 / 笔记 / 统计 / 设置。
 * 为什么是中心 tab 而不是侧栏：封面墙要宽，侧栏那 300px 只能放三列，
 * 书名被截成两行还认不出是哪本。侧栏留给「书的坐标」（目录/书签/划线/AI），
 * 两者各干各的事，不再互相将就。
 *
 * 渲染策略：全量 innerHTML + 事件委托（与其它视图一致），
 * 代价是重绘丢焦点，所以下面专门记焦点与滚动位置。
 * ============================================================ */
import { isMobileShell } from '../core/mobile';
import { dispatchAction, dispatchInput } from './actions';
import { getState, setState, subscribe, type StudyPage } from './state';
import { getShellSource, liveBooks, shellPrefs, subscribeShellSource } from './source';
import { studyShell } from './render/study';
import { buildShelfPage } from './shelf-page';
import { hydrateCovers } from './covers';

interface FocusMemo {
  role: string;
  start: number;
  end: number;
}

export class ShelfPanel {
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private offSource: (() => void) | null = null;
  private scrollTop = 0;
  private focusMemo: FocusMemo | null = null;
  private painted = false;

  /** @param host 挂载点，ItemView 传 contentEl */
  constructor(private host: HTMLElement) {}

  mount(): void {
    this.host.addClass('bzs-shell-wrap');
    this.root = this.host.createDiv({ cls: `bzs-shell${isMobileShell() ? ' is-mobile' : ''}` });
    this.bind();
    this.render();
    this.unsubscribe = subscribe(() => this.render());
    /* 视图可能比插件先活：Obsidian 恢复布局时插件还没注入数据源，
       那一次 render 是空跑，而状态订阅此后未必再被触发——书架就一直空着。
       数据源一到就得自己补画一次。 */
    this.offSource = subscribeShellSource(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offSource?.();
    this.offSource = null;
    this.root = null;
    this.host.empty();
  }

  /** 外部切页（命令面板 / 侧栏「换书」等）。改状态即可，订阅会触发重绘。 */
  setPage(page: StudyPage): void {
    setState({ studyPage: page });
  }

  private memoFocus(): void {
    const el = document.activeElement as HTMLElement | null;
    const role = el?.dataset?.role;
    if (!el || !role) {
      this.focusMemo = null;
      return;
    }
    const input = el as HTMLInputElement;
    this.focusMemo = {
      role,
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    };
  }

  private restoreFocus(): void {
    const memo = this.focusMemo;
    this.focusMemo = null;
    if (!memo) return;
    const el = this.root?.querySelector<HTMLInputElement>(`[data-role="${memo.role}"]`);
    if (!el) return;
    el.focus();
    try {
      el.setSelectionRange(memo.start, memo.end);
    } catch {
      /* range 型 input 不支持 setSelectionRange，忽略 */
    }
  }

  private memoScroll(): void {
    const body = this.root?.querySelector<HTMLElement>('.bzs-stubody');
    if (body) this.scrollTop = body.scrollTop;
  }

  render(): void {
    const root = this.root;
    if (!root || !getShellSource()) return;

    const state = getState();
    this.memoScroll();
    this.memoFocus();

    const books = liveBooks();
    const { body, counts } = buildShelfPage(state, books);

    root.dataset.bzaccent = shellPrefs().accent;
    root.innerHTML = studyShell(state.studyPage, body, counts);

    const scroller = root.querySelector<HTMLElement>('.bzs-stubody');
    if (scroller) {
      // 只有同一页内重绘才恢复滚动；换页回到顶部
      if (this.painted && this.scrollTop > 0) scroller.scrollTop = this.scrollTop;
      else scroller.scrollTop = 0;
    }
    this.painted = true;
    this.restoreFocus();
    // 封面是异步的：先出的是色块，真封面到了就地换图（不重绘，否则滚动位置会跳）
    hydrateCovers(getShellSource()?.app, books, root);
  }

  private bind(): void {
    const el = this.host;
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.bzs-scrim') === target) return; // 遮罩点击由 overlay 层处理
      const hit = target.closest<HTMLElement>('[data-act]');
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
    el.addEventListener('scroll', () => this.memoScroll(), true);
  }
}
