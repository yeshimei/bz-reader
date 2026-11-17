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
import { ItemView, type App, type WorkspaceLeaf } from 'obsidian';
import type { FoliateTOCItem } from '../types/foliate';
import { isMobileEnv, isMobileShell } from '../core/mobile';
import { dispatchAction, dispatchInput } from '../shell/actions';
import { togglePicked } from '../shell/note-picker';
import { renderAiMarkdown } from '../shell/ai-md';
import { canSendAi } from '../shell/ai-context';
import { getState, setState, subscribe, type SideTab } from '../shell/state';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from '../shell/source';
import { RT } from '../shell/runtime';
import {
  viewSidebar,
  notePickerListHtml,
  type AiIndexView,
  type AiNoteRow,
} from '../shell/render/sidebar';
import { aiChatsOf, aiHistRows, restoreAiChat } from '../shell/ai-chat';
import { focusSelector, type FocusMemo } from '../shell/focus-memo';
import { isTocItemActive, type TocActiveRef } from '../shell/toc-active';
import { getToc, subscribeToc, tocPaintMode } from './toc-state';
import { revealScrollTop } from './toc-reveal';
import { pdfLocatorPage, pdfPageLocator } from '../engine/pdf/locator';
import { wikilinkTo } from '../data/wikilink';
import { t } from '../i18n';
import { setHtml } from '../ui/dom';
import { bzEmbedder } from '../data/bz-bridge';
import { cachedPortrait, ensurePortrait } from '../shell/portrait-cache';
import { portraitBuilder } from '../data/portrait-build';
import { estimateChars, portraitState } from '../data/portrait';
import { aiReady } from '../data/settings';

/** 保留旧值：已保存的工作区布局按这个字符串恢复 leaf */
export const VIEW_TYPE_TOC = 'bz-reader-toc';

export type { SideTab };

/** 笔记浮层的数据源：全库 Markdown，按最近修改排；一次取好，搜索在本地过 */
function allNotes(app: App | undefined): AiNoteRow[] {
  const files = app?.vault?.getMarkdownFiles?.() ?? [];
  return files
    .slice()
    .sort((a, b) => (Number(b.stat?.mtime) || 0) - (Number(a.stat?.mtime) || 0))
    .map((f) => ({
      title: f.basename,
      path: f.path,
      desc: f.parent?.path && f.parent.path !== '/' ? f.parent.path : '',
    }));
}

/** 输入框按内容长高；上限与输入卡片的 max-height 对齐（140px） */
function autoGrowInput(t: HTMLTextAreaElement): void {
  t.setCssProps({ height: 'auto' });
  t.setCssProps({ height: `${Math.min(t.scrollHeight + 2, 140)}px` });
}

/** 发送按钮只在「有字或有上下文」时亮 */
function syncAiSend(root: HTMLElement | null): void {
  if (!root) return;
  const input = root.querySelector<HTMLTextAreaElement>('[data-role="aiask"]');
  const send = root.querySelector<HTMLButtonElement>('.bzs-ai-send');
  if (!input || !send) return;
  send.disabled = !canSendAi(input.value, RT.aiCtx);
}

/** 搜索词变了：只重画浮层里的列表，不重绘整块侧栏（输入框焦点和草稿都在） */
function paintNoteList(root: HTMLElement | null): void {
  const list = root?.querySelector<HTMLElement>('.bzs-pk-list');
  if (!list) return;
  setHtml(list, notePickerListHtml(RT.aiNoteAll, RT.aiNoteKw, RT.aiNotePicked));
  syncNotePicker(root);
}

/** 勾选态与底部已选：本地改 DOM，不整页重绘 */
function syncNotePicker(root: HTMLElement | null): void {
  const picker = root?.querySelector<HTMLElement>('.bzs-picker');
  if (!picker) return;
  picker.querySelectorAll<HTMLElement>('.bzs-pk-row').forEach((row) => {
    const on = RT.aiNotePicked.includes(row.dataset.path ?? '');
    row.classList.toggle('is-on', on);
    row.setAttribute('aria-pressed', String(on));
  });
  const count = picker.querySelector<HTMLElement>('.bzs-pk-count');
  if (count) count.textContent = t('side.ai.ctx.noteCount', { n: RT.aiNotePicked.length });
  const picked = picker.querySelector<HTMLElement>('.bzs-pk-picked');
  if (picked) {
    const names = RT.aiNotePicked.map((p) => RT.aiNoteAll.find((n) => n.path === p)?.title).filter(
      (x): x is string => !!x,
    );
    const tags: HTMLElement[] = names.slice(0, 2).map((name) => {
      const el = createSpan();
      el.className = 'bzs-pk-tag';
      el.textContent = name;
      return el;
    });
    if (names.length > 2) {
      const more = createSpan();
      more.className = 'bzs-pk-tag is-more';
      more.textContent = `+${names.length - 2}`;
      tags.push(more);
    }
    picked.replaceChildren(...tags);
  }
  const insert = picker.querySelector<HTMLButtonElement>('.bzs-pk-insert');
  if (insert) insert.disabled = RT.aiNotePicked.length === 0;
}

/** 浮层里的行与清空按钮只改本地状态，不整页重绘；返回 true = 这次点击已经处理掉 */
function pickerAct(hit: HTMLElement, root: HTMLElement | null): boolean {
  const act = hit.dataset.act;
  if (act === 'aictxnotepick') {
    const path = hit.dataset.path ?? '';
    if (path) {
      RT.aiNotePicked = togglePicked(RT.aiNotePicked, path);
      syncNotePicker(root);
    }
    return true;
  }
  if (act === 'aictxnoteclear') {
    RT.aiNoteKw = '';
    const input = root?.querySelector<HTMLInputElement>('[data-role="ainotesearch"]');
    if (input) {
      input.value = '';
      input.focus({ preventScroll: true });
    }
    paintNoteList(root);
    return true;
  }
  return false;
}

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
  /** 上一次画进 DOM 的 AI 对话条数：只有真的多了一条才滚到底 */
  private paintedAiLog = -1;
  /** 上一次有没有在等 AI：等待气泡出现 / 消失时也要滚到底 */
  private paintedAiBusy = false;
  /** 上一帧笔记选择器开着没有：只在「刚打开」时抢焦点 */
  private paintedNoteOpen = false;
  /** 挂在 document 上的收口（Esc 关选择器 / 点空白关选择器） */
  private offDoc: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TOC;
  }

  getDisplayText(): string {
    return 'Bz 阅读';
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
    this.bindDoc();
    this.render();
    this.unsubs.push(subscribe(() => this.render()));
    this.unsubs.push(subscribeToc(() => this.onTocChange()));
    /* 建索引的进度每跑完一批就广播一次：不订阅的话，侧栏会停在
       「第 3 / 130 块」直到用户点别的页签再切回来。 */
    this.unsubs.push(portraitBuilder().subscribe(() => this.render()));
  }

  async onClose(): Promise<void> {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.offDoc?.();
    this.offDoc = null;
    this.contentEl.empty();
  }

  private bind(): void {
    const el = this.contentEl;
    el.addEventListener('click', (e) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      if (pickerAct(hit, this.root)) return;
      dispatchAction(hit.dataset.act || '', hit, { repaint: () => this.render() });
    });

    /**
     * 目录行拖到笔记里：落一条带页码的链接。
     *
     * 只给 PDF——EPUB 的 href 是书内路径，拼出来打不开那一章。别的时候
     * 拖拽是浏览器默认行为（选字），不能拦。
     */
    el.addEventListener('dragstart', (e) => {
      const row = (e.target as HTMLElement)?.closest<HTMLElement>('.bzs-chaprow[draggable="true"]');
      const bookId = getState().bookId;
      if (!row || !bookId) return;
      const book = liveBooks().find((b) => b.id === bookId);
      const page = pdfLocatorPage(row.dataset.href || '');
      const dt = e.dataTransfer;
      if (!book || !page || !dt) return;
      const label = (row.dataset.label || '').trim() || t('pdf.label.page', { n: page });
      dt.setData('text/plain', wikilinkTo(book, { cfi: pdfPageLocator(page) }, label));
      dt.effectAllowed = 'copy';
    });

    const onEdit = (e: Event): void => {
      const t = e.target as HTMLElement;
      if (!t?.dataset?.role) return;
      dispatchInput(t as HTMLInputElement | HTMLTextAreaElement, e);
      if (t.dataset.role === 'aiask' && t.tagName === 'TEXTAREA') {
        autoGrowInput(t as HTMLTextAreaElement);
        syncAiSend(this.root);
      }
      if (t.dataset.role === 'ainotesearch') paintNoteList(this.root);
    };
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);
    /* 输入法上屏后补一次：input 期间 isComposing 为真会被跳过（P1-10） */
    el.addEventListener('compositionend', onEdit);

    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && t?.dataset?.role === 'aiask') {
        /* 输入法 composing 期间 Enter 是「上屏」不是「发送」；Shift+Enter 换行。
           旧写法还看 keyCode === 229 兜底，但 keyCode 已废弃；Electron/Chromium
           在 composing 期间 isComposing 恒为真，这一个判断就够。 */
        if (e.isComposing || e.shiftKey) return;
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
      if (pickerAct(hit, this.root)) return;
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

  /** 笔记选择器：点空白或 Esc 收掉。挂在 document 上，点书页也能收 */
  private bindDoc(): void {
    const close = (): void => {
      if (!RT.aiNoteOpen) return;
      RT.aiNoteOpen = false;
      RT.aiNoteKw = '';
      RT.aiNotePicked = [];
      RT.aiNoteAll = [];
      /* 只摘掉 popover，不整页重绘：点输入框 / 发送键时焦点与这次点击都还在 */
      this.root?.querySelector('.bzs-picker')?.remove();
    };
    const onDown = (e: MouseEvent): void => {
      if (!RT.aiNoteOpen) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.bzs-picker') || t?.closest?.('[data-act="aictxnote"]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    this.offDoc = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }

  private memoFocus(): void {
    const el = document.activeElement as HTMLElement | null;
    const role = el?.dataset?.role;
    if (!el || !role || !this.root?.contains(el)) {
      this.focusMemo = null;
      return;
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement;
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
    const el = this.root?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      focusSelector(memo.role, memo.k),
    );
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
   * 现在只要「同一棵树 + 已渲染」就走快路径，内部再按 moved
   * 决定要不要动 DOM；动 DOM 只在目录页签里做（B10）。
   */
  private onTocChange(): void {
    const snap = getToc();
    const activeLabel = snap?.activeLabel ?? '';
    const activeHref = snap?.activeHref ?? '';
    const sameTree =
      (snap?.items ?? null) === this.paintedItems && (snap?.bookId ?? '') === this.paintedBook;
    const moved = activeLabel !== this.paintedActive || activeHref !== this.paintedActiveHref;
    const mode = tocPaintMode({
      sameTree: sameTree && !!this.root,
      moved,
      /* 书签 / 划线 / AI 页签里根本没有目录行：以前这里没判页签，
         翻一页就整块侧栏重建——滚动位置靠 scrollTops 抢回来，正在输入的
         提问框靠 focusMemo 抢回来，手机上一页掉一次帧。 */
      onTocPage: getState().sideTab === 'toc',
    });
    if (mode === 'full') {
      this.render();
      return;
    }
    if (!moved) return;
    /* 高亮状态无论画不画都要记下来：下一次 relocate 的 moved 判定以它为准 */
    this.paintedActive = activeLabel;
    this.paintedActiveHref = activeHref;
    if (mode === 'row' && this.root) {
      this.patchActiveRow(this.root, { label: activeLabel, href: activeHref });
      this.revealActiveRow();
    }
  }

  /**
   * 把高亮的目录行滚进可视区。
   *
   * 只在高亮真的变了（换章 / 跳目录）时调：用户自己滚目录浏览时不能抢。
   * 用 revealScrollTop 自己算 scrollTop，避免 scrollIntoView 连带滚外层。
   */
  private revealActiveRow(): void {
    const root = this.root;
    if (!root) return;
    const scroller = root.querySelector<HTMLElement>('.bzs-sbbody');
    /* 源分组行与它的第一篇共用同一个 href，两行都会亮：要滚的是**最后一
       行**（文章本身）。取第一行的话，分组行贴底了、文章行被切在面板外
       （真机截图里只露出半行标题）。 */
    const hits = root.querySelectorAll<HTMLElement>('.bzs-chaprow.on');
    const row = hits.length ? hits[hits.length - 1] : null;
    if (!scroller || !row) return;
    const item = row.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const next = revealScrollTop(scroller.scrollTop, item, view);
    if (next !== scroller.scrollTop) scroller.scrollTop = next;
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

    /* 画像状态是异步读来的：先按缓存画，读到（或建完）之后自己重绘一次。
       undefined = 还没读过，这一帧不出「建立索引」——建过的书不该闪一下按钮。 */
    const cached = bookId ? cachedPortrait(bookId) : null;
    if (bookId && cached === undefined) {
      void ensurePortrait(getShellSource()?.app, bookId, () => this.render());
    }
    const progress = portraitBuilder().progress();
    /* 向量归第二大脑：模型名从 bz 取，画像里记的也是它——换了模型，旧向量
       会在这里被判 stale（以前靠用户自己把设置改对才看得出来）。 */
    const embedder = bzEmbedder(getShellSource()?.app);
    const aiIndex: AiIndexView = {
      state: portraitState(cached ?? null, embedder.model),
      loading: !!bookId && cached === undefined,
      /* 单例只跑一个任务：进度记的是另一本书时，这本按「没在跑」画 */
      progress: progress.bookId && progress.bookId === bookId ? progress : null,
      chars: estimateChars(book),
      choosing: RT.aiIndexOpen,
      plan: RT.portraitPlan,
      mobile: isMobileEnv(),
      open: !!bookId && getShellSource()?.openBookId() === bookId,
      embedReady: !!embedder.ai,
      askReady: aiReady(settings),
      blocks: cached?.blocks?.length ?? 0,
    };

    root.dataset.bzaccent = shellPrefs().accent;
    /* 聊天态让 leaf 去掉宿主的 12/32 内边距：输入卡要横向铺满、贴着底边。
       其它页签仍按原样留白，不跟着一起改。 */
    const aiChat = state.sideTab === 'ai' && aiReady(settings) && aiIndex.state === 'ready';
    this.contentEl.toggleClass('is-ai-chat', aiChat);
    /* 切到别的页签 = 笔记选择器没有意义了：把它收掉，免得回来时浮在半空 */
    if (state.sideTab !== 'ai') {
      RT.aiNoteOpen = false;
      RT.aiNoteKw = '';
      RT.aiNotePicked = [];
      RT.aiNoteAll = [];
    }
    const notesOpen = state.sideTab === 'ai' && RT.aiNoteOpen;
    /* 浮层第一次打开时把全库笔记取一次；关掉会清空，下次再开重新取 */
    if (notesOpen && !RT.aiNoteAll.length) RT.aiNoteAll = allNotes(getShellSource()?.app);
    /* 换到这本书：把上次那条对话读回侧栏（2026-11-16）。
       只改 RT、不在这里 repaint——这一帧正要按它画。 */
    if (state.sideTab === 'ai') restoreAiChat(bookId);
    setHtml(
      root,
      viewSidebar({
        book,
        tab: state.sideTab,
        toc: snap?.items ?? ([] as FoliateTOCItem[]),
        activeLabel: snap?.activeLabel ?? '',
        activeHref: snap?.activeHref ?? '',
        aiLog: RT.aiLog,
        aiDraft: RT.aiDraft,
        aiCtx: RT.aiCtx,
        aiStage: RT.aiStage,
        aiChatId: RT.aiChatId,
        aiHistOpen: RT.aiHistOpen,
        aiHist: RT.aiHistOpen ? aiHistRows(aiChatsOf(bookId), RT.aiChatId) : [],
        aiNoteOpen: notesOpen,
        aiNoteKw: RT.aiNoteKw,
        aiNotePicked: RT.aiNotePicked,
        aiNotes: notesOpen ? RT.aiNoteAll : [],
        aiReady: aiReady(settings),
        aiIndex,
        collapsed: RT.tocCollapsed,
        cites: state.cites,
        activePage: state.pdfPage,
        citesOnlyPage: RT.citesOnlyPage,
        tocDraggable: book?.fileRef.format === 'pdf',
      }),
    );
    /* 侧栏里的 AI 答按 Markdown 渲染（2026-11-11）：模板只打标记，注入后统一换 */
    renderAiMarkdown(root);
    this.paintAi(root);
    this.paintedItems = snap?.items ?? null;
    this.paintedBook = snap?.bookId ?? '';
    this.paintedActive = snap?.activeLabel ?? '';
    this.paintedActiveHref = snap?.activeHref ?? '';

    const scroller = root.querySelector<HTMLElement>('.bzs-sbbody');
    if (scroller && state.sideTab !== 'ai') scroller.scrollTop = this.scrollTops[state.sideTab] ?? 0;
    /* 首屏目录也要落在当前章：打开一本书点目录，最该先看到的是「我读到哪」 */
    this.revealActiveRow();
    this.restoreFocus();
  }

  /**
   * 注入之后 AI 页签的收尾：输入框长高、发送键亮灭、选择器摆位、滚到最新一条。
   *
   * 全是 DOM 操作，所以放在 setHtml 之后；模板只负责拼结构。
   */
  private paintAi(root: HTMLElement): void {
    const state = getState();
    if (state.sideTab !== 'ai') {
      this.paintedAiLog = RT.aiLog.length;
      this.paintedNoteOpen = false;
      return;
    }
    const input = root.querySelector<HTMLTextAreaElement>('[data-role="aiask"]');
    if (input) autoGrowInput(input);
    syncAiSend(root);

    const picker = root.querySelector<HTMLElement>('.bzs-picker');
    if (picker) {
      const search = picker.querySelector<HTMLInputElement>('[data-role="ainotesearch"]');
      if (search) {
        if (RT.aiNoteKw) search.value = RT.aiNoteKw;
        paintNoteList(root);
        if (!this.paintedNoteOpen) {
          window.setTimeout(() => {
            if (!RT.aiNoteOpen) return;
            search.focus({ preventScroll: true });
            search.setSelectionRange(search.value.length, search.value.length);
          }, 20);
        }
      }
    }
    this.paintedNoteOpen = RT.aiNoteOpen;

    /* 只有多了一条（或等待气泡出现 / 消失）才滚：重绘一次就抢滚动条
       会让往回翻的人突然掉到底 */
    const busy = !!RT.aiStage;
    if (this.paintedAiLog !== RT.aiLog.length || busy !== this.paintedAiBusy) {
      const box = root.querySelector<HTMLElement>('.bzs-aimsg');
      if (box) box.scrollTop = box.scrollHeight;
      this.paintedAiLog = RT.aiLog.length;
      this.paintedAiBusy = busy;
    }
  }
}
