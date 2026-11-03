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
import { focusSelector, type FocusMemo } from './focus-memo';

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
      /* 设置页有四个 data-role="setting"，必须带上 data-k 才能找回同一个框；
         只按 role 会命中导出目录，AI 输入框就打不进第二个字。 */
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

    /* 书卡菜单：桌面右键、手机长按。
       长按用 520ms 的指针计时，手指一动就取消——否则用户想划动书库时
       会被菜单打断。两端都走同一个 bookmenu 动作，不写两套逻辑。 */
    let menuAt = 0;
    const openMenu = (card: HTMLElement, x: number, y: number): void => {
      menuAt = Date.now();
      card.dataset.x = String(Math.round(x));
      card.dataset.y = String(Math.round(y));
      dispatchAction('bookmenu', card, { repaint: () => this.render() });
    };
    const cardOf = (t: EventTarget | null): HTMLElement | null =>
      t instanceof HTMLElement ? t.closest<HTMLElement>('[data-bookmenu]') : null;

    el.addEventListener('contextmenu', (e) => {
      const card = cardOf(e.target);
      if (!card) return;
      e.preventDefault();
      if (Date.now() - menuAt < 400) return; // 长按已经开过
      openMenu(card, e.clientX, e.clientY);
    });

    let pressTimer: number | null = null;
    let pressCard: HTMLElement | null = null;
    let pressX = 0;
    let pressY = 0;
    const cancelPress = (): void => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      pressCard = null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (!isMobileShell()) return;
      const card = cardOf(e.target);
      if (!card) return;
      pressCard = card;
      pressX = e.clientX;
      pressY = e.clientY;
      if (pressTimer !== null) window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        const target = pressCard;
        pressCard = null;
        if (target) openMenu(target, pressX, pressY);
      }, 520);
    });
    el.addEventListener('pointermove', (e) => {
      if (!pressCard) return;
      if (Math.abs(e.clientX - pressX) > 8 || Math.abs(e.clientY - pressY) > 8) cancelPress();
    });
    el.addEventListener('pointerup', cancelPress);
    el.addEventListener('pointercancel', cancelPress);

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
