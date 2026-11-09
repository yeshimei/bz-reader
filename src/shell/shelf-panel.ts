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
import { isCompactLibrary, isMobileShell } from '../core/mobile';
import { TAP_LONG_PRESS_MS, TAP_MENU_PRESSURE_MS, TAP_SLOP_PX } from '../core/tap';
import { dispatchAction, dispatchInput } from './actions';
import { getState, setState, setStateQuiet, subscribe, type StudyPage } from './state';
import { getShellSource, liveBooks, shellPrefs, subscribeShellSource } from './source';
import { studyShell } from './render/study';
import { searchResultsHtml } from './render/search';
import { RT } from './runtime';
import { kickBodySearch } from './search-run';
import { buildShelfPage, shelfRenderKey } from './shelf-page';
import { hydrateCovers } from './covers';
import { focusSelector, type FocusMemo } from './focus-memo';
import { bindRangeTouch } from './range-touch';
import { setHtml } from '../ui/dom';

export class ShelfPanel {
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private offSource: (() => void) | null = null;
  private scrollTop = 0;
  /** 长按菜单弹出后，抑制紧随其后的合成 click（P3-17） */
  private suppressClickUntil = 0;
  private focusMemo: FocusMemo | null = null;
  private painted = false;
  /** 上一次渲染的页；换页要重置滚动位置 */
  private lastPage: StudyPage | null = null;
  /** 导入页的拆卸函数：换页或离开时调用，别把监听留在 DOM 上 */
  private teardownImport: (() => void) | null = null;
  /** 更新日志只在第一次画到书库页时问一次（判重与记账在插件侧） */
  private changelogAsked = false;
  /** 上一次用的筛选行形态；只在跨过阈值时重绘，避免 resize 抖动 */
  private compact: boolean | null = null;
  /** 正文命中到达时「只换命中列表」的回调；离开搜索页 / 销毁时摘掉 */
  private hitlistCb: (() => void) | null = null;
  /** 上一次重绘的内容指纹（D4）：一样就不画 */
  private lastKey = '';
  /** 移动端滑块的触摸接管（桌面返回空函数，见 shell/range-touch.ts） */
  private rangeTouchOff: (() => void) | null = null;

  /** @param host 挂载点，ItemView 传 contentEl */
  constructor(private host: HTMLElement) {}

  mount(): void {
    this.host.addClass('bzs-shell-wrap');
    this.root = this.host.createDiv({ cls: `bzs-shell${isMobileShell() ? ' is-mobile' : ''}` });
    this.bind();
    this.rangeTouchOff = bindRangeTouch(this.root);
    this.render();
    /* 首帧可能还没参与布局：clientWidth 为 0 时按摊开画了。
       下一帧量到真实宽度，该收就重画一次（手机上不能停在下拉之外的样子）。 */
    window.requestAnimationFrame(() => this.onResize());
    this.unsubscribe = subscribe(() => this.render());
    /* 视图可能比插件先活：Obsidian 恢复布局时插件还没注入数据源，
       那一次 render 是空跑，而状态订阅此后未必再被触发——书架就一直空着。
       数据源一到就得自己补画一次。 */
    this.offSource = subscribeShellSource(() => this.render());
  }

  /**
   * 这块有多宽就摆多少：书库筛选行摊开还是收成下拉，**只问宽度**。
   *
   * 以前按 `isMobileShell()` 判，桌面验收开着 force-mobile 时，1725×1152
   * 的窗口也被当成手机，整行收成四个下拉——「能放得下却收起来了」。
   */
  private wantCompact(): boolean {
    return isCompactLibrary(this.host.clientWidth);
  }

  /** 窗口 / 侧栏宽度变了：只有跨过 1000px 那道线才重画 */
  onResize(): void {
    if (this.wantCompact() !== this.compact) this.render();
  }

  destroy(): void {
    this.teardownSubPage();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offSource?.();
    this.offSource = null;
    this.rangeTouchOff?.();
    this.rangeTouchOff = null;
    if (this.hitlistCb) RT.body.listeners.delete(this.hitlistCb);
    this.hitlistCb = null;
    /* 监听挂在 host 上（宿主 contentEl 活得比面板久），摘不掉也不能再管事：
       先摘掉自己那层 root，旧监听进来一律按「目标不在树里」丢弃（D3）。 */
    this.root?.remove();
    this.root = null;
    this.lastKey = '';
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

    /* 导入页不参与重绘：扫描结果、勾选、筛选框内容都活在它自己的 DOM 里，
       业务数据一变（store.touch）就整页重建会把勾了一半的清单清空。
       真正的离开（换页）由 lastPage 判断。 */
    if (state.studyPage === 'import' && this.lastPage === 'import' && this.teardownImport) return;

    /* 第一次画到书库页：问一句要不要弹更新日志。
       放在这里而不是 openStudy，是因为工作区恢复时视图会自己 mount、
       不经过任何打开入口——那条路也得能弹。 */
    if (state.studyPage === 'library' && !this.changelogAsked) {
      this.changelogAsked = true;
      getShellSource()?.maybeShowChangelog();
    }

    const books = liveBooks();
    const compact = this.wantCompact();
    this.compact = compact;

    /* 内容指纹一样就不重画（D4）：状态每写一次都广播，浮层开关、侧栏页签、
       阅读器翻页都会走到这里，而画面一个字都不会变。 */
    const key = shelfRenderKey(state, books, compact);
    if (key && key === this.lastKey) return;
    this.lastKey = key;

    /* 只有同一页内重绘才恢复滚动；换页要回到顶部。
       以前只判 `painted`（永不复位），从书库滚到一半切设置页会停在中间。 */
    const pageChanged = this.lastPage !== state.studyPage;
    this.memoScroll();
    this.memoFocus();

    const { body, counts } = buildShelfPage(state, books, compact);

    root.dataset.bzaccent = shellPrefs().accent;
    setHtml(root, studyShell(state.studyPage, body, counts));

    const scroller = root.querySelector<HTMLElement>('.bzs-stubody');
    if (scroller) {
      if (!pageChanged && this.scrollTop > 0) scroller.scrollTop = this.scrollTop;
      else scroller.scrollTop = 0;
    }
    this.lastPage = state.studyPage;
    this.painted = true;
    this.mountSubPage(state.studyPage);
    this.restoreFocus();
    this.bindHitlist(state.studyPage);
    // 封面是异步的：先出的是色块，真封面到了就地换图（不重绘，否则滚动位置会跳）
    hydrateCovers(getShellSource()?.app, books, root);
  }

  /**
   * 正文搜索是异步的：命中到达时只替换 `[data-role="hitlist"]`，
   * 不整页重绘——整页重绘会把正在打字的输入框换掉。
   */
  private bindHitlist(page: StudyPage): void {
    if (this.hitlistCb) RT.body.listeners.delete(this.hitlistCb);
    this.hitlistCb = null;
    if (page !== 'search') return;
    this.hitlistCb = () => {
      const root = this.root;
      if (!root) return;
      const list = root.querySelector<HTMLElement>('[data-role="hitlist"]');
      if (list) setHtml(list, searchResultsHtml(getState().searchKw, getState().searchScope));
    };
    RT.body.listeners.add(this.hitlistCb);
  }

  /** 子页里需要真实 DOM 的那几个（目前只有导入）挂进来 */
  private mountSubPage(page: StudyPage): void {
    this.teardownSubPage();
    if (page !== 'import') return;
    const host = this.root?.querySelector<HTMLElement>('[data-role="importhost"]');
    const src = getShellSource();
    if (!host || !src) return;
    this.teardownImport = src.mountImport(host);
  }

  private teardownSubPage(): void {
    this.teardownImport?.();
    this.teardownImport = null;
  }

  /**
   * 事件是不是落在本面板之外。
   *
   * 订阅可以退订，`host` 上的委托监听退不掉（宿主 contentEl 活得比面板久，
   * 又没存监听句柄）。面板销毁后如果同一块 contentEl 上又挂了一个书架，
   * 旧监听会跟着新点击跑一遍——同一个动作派发两次，开书弹两层。
   * 判据用「目标在不在自己这层 root 里」：销毁后 root 为空，一律丢弃（D3）。
   */
  private outside(target: EventTarget | null): boolean {
    const root = this.root;
    if (!root || !target) return true;
    try {
      return !root.contains(target as Node);
    } catch {
      return true;
    }
  }

  private bind(): void {
    const el = this.host;
    el.addEventListener('click', (e) => {
      /* 长按菜单之后浏览器还会补发一次 click（P3-17）：不拦的话，
         菜单刚弹出来，紧接着又打开了「书籍详情」弹层把它盖住。 */
      if (Date.now() < this.suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this.outside(e.target)) return;
      const target = e.target as HTMLElement;
      if (target.closest('.bzs-scrim') === target) return; // 遮罩点击由 overlay 层处理
      const hit = target.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      dispatchAction(hit.dataset.act || '', hit, { repaint: () => this.render() });
    });

    /* 键盘可达性（S-02）：书卡与列表行都有 role=button + tabindex=0，
       但以前只有 click 委托——Tab 得过去、按 Enter/Space 毫无反应。 */
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (this.outside(e.target)) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const hit = t.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      dispatchAction(hit.dataset.act || '', hit, { repaint: () => this.render() });
    });

    /* 书卡菜单：桌面右键、手机长按。
       长按用全站同一套指针计时（core/tap 的 TAP_LONG_PRESS_MS），手指一动
       就取消——否则用户想划动书库时会被菜单打断。两端都走同一个 bookmenu
       动作，不写两套逻辑。 */
    let menuAt = 0;
    const openMenu = (card: HTMLElement, x: number, y: number): void => {
      menuAt = Date.now();
      card.dataset.x = String(Math.round(x));
      card.dataset.y = String(Math.round(y));
      dispatchAction('bookmenu', card, { repaint: () => this.render() });
    };
    const cardOf = (t: EventTarget | null): HTMLElement | null =>
      this.outside(t) || !(t instanceof HTMLElement) ? null : t.closest<HTMLElement>('[data-bookmenu]');

    el.addEventListener('contextmenu', (e) => {
      if (this.outside(e.target)) return;
      const card = cardOf(e.target);
      if (!card) return;
      e.preventDefault();
      if (Date.now() - menuAt < 400) return; // 长按已经开过
      this.suppressClickUntil = Date.now() + TAP_MENU_PRESSURE_MS;
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
        /* 安卓长按会先发一次 contextmenu，菜单已经开过了；计时器到点
           再开一次就是「长按弹两层抽屉」。先去重，再压合成 click。 */
        if (Date.now() - menuAt < 400) return;
        // 菜单弹出后浏览器还会补一次 click，先压住（P3-17）
        this.suppressClickUntil = Date.now() + TAP_MENU_PRESSURE_MS;
        if (target) openMenu(target, pressX, pressY);
      }, TAP_LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (!pressCard) return;
      if (Math.abs(e.clientX - pressX) > TAP_SLOP_PX || Math.abs(e.clientY - pressY) > TAP_SLOP_PX) {
        cancelPress();
      }
    });
    el.addEventListener('pointerup', cancelPress);
    el.addEventListener('pointercancel', cancelPress);

    const onEdit = (e: Event): void => {
      if (this.outside(e.target)) return;
      const t = e.target as HTMLElement;
      const role = t?.dataset?.role;
      if (!role) return;
      /* 搜索框就地换命中列表：整页重绘会把输入框换掉，手指还在打就被打断。
         搜索页与浮层用的是同一个词（ShellState.searchKw）。 */
      if (role === 'searchkw') {
        const v = (t as HTMLInputElement).value;
        setStateQuiet({ searchKw: v });
        const list = this.root?.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) setHtml(list, searchResultsHtml(v, getState().searchScope));
        /* 快结果已经画上了，正文命中随后异步追加（防抖在 search-run 里） */
        kickBodySearch(v, getState().searchScope);
        return;
      }
      dispatchInput(t as HTMLInputElement, e);
    };
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);
    /* 输入法上屏后补一次：input 期间 isComposing 为真会被跳过（P1-10） */
    el.addEventListener('compositionend', onEdit);
    el.addEventListener('scroll', () => this.memoScroll(), true);
  }
}
