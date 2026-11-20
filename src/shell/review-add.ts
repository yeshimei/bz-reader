/* ============================================================
 * bz-reader · 「加入复习」弹窗（shell/review-add.ts）
 *
 * 两步：先挑章节，再确认。确认这一步不是多余的仪式——它要回答用户唯一
 * 真正关心的问题：「这次要发多少字给模型，大概花多少钱」。所以字数在
 * 确认页是**准确值**（按划线模式直接数，按章节模式先把正文读出来再数），
 * 不是估算。
 *
 * 为什么按章节模式要先读正文：警告要能拦得住。给一个「约 3 万字」的估算，
 * 用户点了「开始」才发现是 6 万字，那时候钱已经花了。
 *
 * 界面全部走 Obsidian 原生 Modal 与 setting-item，不另造一套视觉——
 * 这个弹窗只在挑内容时出现，用户不该在这里学一套新操作。
 * ============================================================ */
import { Modal, type App } from 'obsidian';
import { t } from '../i18n';
import { notify, notifyProgress } from '../core/notice';
import type { ReaderSettings } from '../data/settings';
import { aiReadyShared } from '../data/settings';
import type { ReaderBook } from '../data/schema';
import { aiPostChat } from '../data/ai';
import { makeBook } from '../engine/foliate';
import type { FoliateBook } from '../types/foliate';
import {
  AI_BLOCK_CHARS,
  AI_WARN_CHARS,
  aiCardKey,
  findReviewApi,
  markCardKey,
  markChapterGroups,
  pickedMarkStats,
  pickedMarks,
  type MarkChapterGroup,
  type MarkLite,
  type ReviewApi,
} from '../data/review-bridge';
import { openAiGuide } from './ai-guide';
import { marksOf } from './domain';
import { getShellSource, liveBooks, shellSettings } from './source';
import { DEFAULT_HIGHLIGHT_COLOR, ensureHighlight } from '../data/notes';
import { mutateState } from './state';
import { emitNotesChanged } from './runtime';
import { setMarkReviewPlanned } from './review-marks';
import { runReviewAdd, type RunChapter } from './review-run';
import { openCardsFlow, openCardsFlowLoading } from './review-cards-ui';
import { pickedChapters, resolveScope, type Scope, type ScopeChapter, type ScopeMark } from './review-scope';

/** 侧栏「划线」页那颗按钮的入口 */
export async function openReviewAdd(app: App | undefined, book: ReaderBook | undefined): Promise<void> {
  if (!app) return;
  if (!book) {
    notify(t('side.empty'), 'info');
    return;
  }
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  const settings = shellSettings();
  if (!(await aiReadyShared(settings, app))) {
    openAiGuide();
    return;
  }
  new ReviewAddFlow(app, book, api, settings).open();
}

/** 这条钥匙是不是已经在复习计划里（查询失败当「不在」，照常往下走） */
async function alreadyPlanned(api: ReviewApi, key: string): Promise<boolean> {
  if (!api.statusOf) return false;
  try {
    const rows = await api.statusOf([key]);
    return rows.some((r) => r.path === key && r.planned);
  } catch {
    return false;
  }
}

/**
 * 工具条上的「加入复习」：点开一条已经划好的线 → 弹三选一制卡。
 *
 * 一条划线就是一张卡，没有「挑哪些章节」的问题。重复点不会排两次——
 * 钥匙由 `reader:<书>:<划线>` 决定，Review 那边见到已存在就跳过。
 * 2026-11-19 起入口处就先问一句：已经在计划里的，不再开界面、也不再
 * 让 AI 白出一遍题。
 */
export async function addMarkToReview(app: App | undefined, book: ReaderBook | undefined, markId: string | undefined): Promise<void> {
  if (!app || !book) return;
  const h = (book.notes?.highlights ?? []).find((x) => x.id === markId);
  if (!h) {
    notify(t('notice.mark.notFound'), 'error');
    return;
  }
  const key = markCardKey(book.id, h.id);
  const api = findReviewApi(app);
  if (api && (await alreadyPlanned(api, key))) {
    notify(t('review.alreadyPlanned'), 'info');
    return;
  }
  openCardsFlow(app, [{
    key,
    bookTitle: book.meta.title || '',
    chapterTitle: h.chapterTitle,
    text: h.text,
    comment: h.comment,
  }], {
    /* 入库成功后工具条那颗按钮直接改叫「已在复习」，不必等下次开书重查 */
    onAdded: () => setMarkReviewPlanned(book.id, h.id),
  });
}

/**
 * 工具条上的「加入复习」：划了一段还没保存 → 弹三选一制卡。
 *
 * 不先落一条划线：用户点的是「去复习」，不是「在书里标一笔」。钥匙按
 * 「书 + 章节 + 原文」算，同一段文字重复加不会排两次。
 */
export async function addSelectionToReview(
  app: App | undefined,
  sel: {
    text: string;
    bookId: string;
    chapterTitle?: string;
    /** 选区定位串：入库成功后据此补一条划线（PDF 是 `pdf/<页>/…`，EPUB 是 CFI 范围） */
    cfiRange?: string;
    chapterIndex?: number;
  } | null | undefined,
): Promise<void> {
  if (!app || !sel || !String(sel.text ?? '').trim()) return;
  const book = liveBooks().find((b) => b.id === sel.bookId);
  if (!book) return;
  const title = sel.chapterTitle || '';
  const key = aiCardKey(book.id, title, sel.text);
  const api = findReviewApi(app);
  if (api && (await alreadyPlanned(api, key))) {
    notify(t('review.alreadyPlanned'), 'info');
    return;
  }
  openCardsFlow(app, [{
    key,
    bookTitle: book.meta.title || '',
    chapterTitle: title || undefined,
    text: String(sel.text).trim(),
  }], {
    /* 确认加入后把这段文字顺手划上：用户点的是「加入复习」，
       但回头看原文时也该能找到是哪一段（2026-11-19）。
       不先划线、只在这时补，取消弹窗就不会在书里留痕。
       2026-11-20：补完划线立刻清掉正文里的选区高亮（否则选区一直亮着挡正文），
       也不再弹那条带撤销按钮的通知——「已加入 N 条复习」本身就是回执。 */
    onAdded: () => {
      const id = ensureSelectionMark(book, sel);
      if (!id) return;
      setMarkReviewPlanned(book.id, id);
      getShellSource()?.clearSelection();
    },
  });
}

/** 给划选的文字补一条划线（同位置已有就复用，不叠第二条、不改用户颜色） */
function ensureSelectionMark(
  book: ReaderBook,
  sel: { text: string; cfiRange?: string; chapterTitle?: string; chapterIndex?: number },
): string {
  const text = String(sel.text ?? '').trim();
  if (!text || !sel.cfiRange) return '';
  const { highlight, created } = ensureHighlight(book, {
    text,
    cfiRange: sel.cfiRange,
    chapterTitle: sel.chapterTitle,
    chapterIndex: sel.chapterIndex,
    color: DEFAULT_HIGHLIGHT_COLOR,
  });
  if (created) {
    getShellSource()?.store.touch();
    mutateState(() => undefined);
    emitNotesChanged();
  }
  return highlight.id;
}

/** 千分位：字数与条数都要给人看，3,240 比 3240 好读 */
function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US');
}

/** 章节行：标题 + 副标题（条数 / 字数） */
function chapterRow(title: string, sub: string): HTMLElement {
  const row = createDiv();
  row.className = 'setting-item';
  const info = createDiv();
  info.className = 'setting-item-info';
  const name = createDiv();
  name.className = 'setting-item-name';
  name.textContent = title;
  info.appendChild(name);
  if (sub) {
    const desc = createDiv();
    desc.className = 'setting-item-description';
    desc.textContent = sub;
    info.appendChild(desc);
  }
  row.appendChild(info);
  return row;
}

/**
 * 章节行放进纵向 flex 容器后，Obsidian 的 `.setting-item-control` 会被拉满整行
 * （勾选框变成一根横条、标题被挤成两个字宽）。这里把三段宽度钉死：信息区占满、
 * 控件区按内容、勾选框 16px。
 */
function pinRowLayout(row: HTMLElement): HTMLElement {
  /* 移动端 Obsidian 会把 .setting-item 改成竖排（标题在上、控件在下），
     这里显式改回横排：标题占满左半边、勾选框靠右。 */
  row.setCssProps({
    display: 'flex',
    'flex-direction': 'row',
    alignItems: 'center',
    'justify-content': 'space-between',
    gap: '12px',
  });
  row.querySelector<HTMLElement>('.setting-item-info')
    ?.setCssProps({ flex: '1 1 auto', 'min-width': '0' });
  row.querySelector<HTMLElement>('.setting-item-control')
    ?.setCssProps({ flex: '0 0 auto', width: 'auto', 'margin-left': 'auto' });
  row.querySelector<HTMLElement>('input')
    ?.setCssProps({ width: '16px', height: '16px', flex: '0 0 auto' });
  return row;
}

/** 勾选框放进 setting-item 的右侧控件区 */
function withCheckbox(row: HTMLElement, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const ctl = createDiv();
  ctl.className = 'setting-item-control';
  const box = createEl('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  ctl.appendChild(box);
  row.appendChild(ctl);
  return row;
}

class ReviewAddFlow {
  private app: App;
  private book: ReaderBook;
  private api: ReviewApi;
  private settings: ReaderSettings;
  private marks: MarkLite[];
  private groups: MarkChapterGroup[];

  private tab: 'marks' | 'chapters' = 'marks';
  /** 「按划线」选中的章节（`index\u0001title`） */
  private markPicked = new Set<string>();
  /** 「按章节」选中的 section 下标 */
  private chapPicked = new Set<number>();

  /** 全部章节（按章节模式用；第一次切过去时才加载） */
  private chapters: Array<{ index: number; title: string }> | null = null;
  private chapterBodies = new Map<number, string>();
  private loading = false;
  private loadError = false;

  private step: 'pick' | 'confirm' = 'pick';
  private confirmInfo: { chapters: number; marks: number; chars: number; bodyChars: number } | null = null;
  /** 每章最多几张；0 = 不限制 */
  private limit = 0;
  private busy = false;
  /** 原生弹窗：组合而不是继承。继承会让 `extends Modal` 在模块加载时求值，
     而测试环境里没有 obsidian 的 Modal——一个 UI 模块不该让三十多个
     无关测试连导入都失败。 */
  private modal: Modal;

  constructor(app: App, book: ReaderBook, api: ReviewApi, settings: ReaderSettings) {
    this.modal = new Modal(app);
    this.app = app;
    this.book = book;
    this.api = api;
    this.settings = settings;
    this.marks = marksOf(book).map((m) => ({
      id: m.id,
      chapterIndex: m.chapterIndex,
      chapterTitle: m.chapterTitle,
      text: m.text,
      comment: m.comment,
    }));
    this.groups = markChapterGroups(this.marks);
    /* 默认全不选：一次点「加入复习」就把整本书塞进计划，是用户最不想
       发生的事（复习队列会瞬间堆满）。 */
  }

  open(): void {
    this.modal.titleEl.setText(t('review.title'));
    this.modal.onClose = () => this.modal.contentEl.empty();
    this.render();
    this.modal.open();
  }

  /* ─────────── 渲染 ─────────── */

  private render(): void {
    const el = this.modal.contentEl;
    this.syncLayout();
    el.empty();
    if (this.step === 'confirm') {
      this.renderConfirm(el);
      return;
    }
    this.renderPick(el);
  }

  /**
   * 「按章节」这一屏换成半屏高、头尾固定、只有章节列表滚（2026-11-21）。
   *
   * 章节多的书原来会把整窗撑到视口那么高，底部的「下一步」被推出去，
   * 用户得先把列表滚到底才点得到。别的屏不动，保持原来的自适应高度。
   */
  private syncLayout(): void {
    const narrow = this.step === 'pick' && this.tab === 'chapters';
    /* 弹窗挂在 body 上，壳层样式会被构建加 .bzs-shell 前缀（匹配不到），
       所以这里用内联样式，与这个文件其它弹窗同一口径。 */
    if (narrow) {
      this.modal.modalEl.setCssProps({
        'max-height': '50vh',
      });
      this.modal.contentEl.setCssProps({
        display: 'flex',
        'flex-direction': 'column',
        'min-height': '0',
        overflow: 'hidden',
      });
    } else {
      this.modal.modalEl.setCssProps({ 'max-height': '' });
      this.modal.contentEl.setCssProps({
        display: '',
        'flex-direction': '',
        'min-height': '',
        overflow: '',
      });
    }
  }

  /** 顶部：书名 + 两个 tab */
  private renderHead(el: HTMLElement): void {
    const title = this.book.meta.title || t('common.untitled');
    const sub = el.createEl('p');
    sub.setCssProps({ margin: '0 0 8px', color: 'var(--text-muted)' });
    sub.textContent = title;

    const tabs = el.createDiv();
    tabs.setCssProps({ display: 'flex', gap: '4px', margin: '0 0 10px' });
    const mk = (key: 'marks' | 'chapters', label: string): void => {
      const b = tabs.createEl('button', { text: label });
      b.setCssProps({
        padding: '4px 12px',
        borderRadius: '6px',
        border: '1px solid var(--background-modifier-border)',
        background: this.tab === key ? 'var(--interactive-accent)' : 'transparent',
        color: this.tab === key ? 'var(--text-on-accent)' : 'var(--text-normal)',
      });
      b.addEventListener('click', () => {
        if (this.tab === key) return;
        this.tab = key;
        if (key === 'chapters' && !this.chapters && !this.loading) void this.loadChapters();
        this.render();
      });
    };
    mk('marks', t('review.tab.marks'));
    mk('chapters', t('review.tab.chapters'));

    const lead = el.createEl('p');
    lead.setCssProps({ margin: '0 0 8px', fontSize: '0.9em', color: 'var(--text-muted)' });
    lead.textContent = this.tab === 'marks' ? t('review.marksLead') : t('review.chaptersLead');
  }

  private renderPick(el: HTMLElement): void {
    if (this.tab === 'chapters') {
      /* 章节这一屏装在纵向 flex 里：头、全选条、统计、底部按钮都不滚，
         只有中间列表滚（配合 syncLayout 的半屏高度）。 */
      const pane = el.createDiv({ cls: 'bzs-scope-pane' });
      pane.setCssProps({ display: 'flex', 'flex-direction': 'column', 'min-height': '0', flex: '1 1 auto' });
      this.renderHead(pane);
      this.renderChapterPick(pane);
      return;
    }

    this.renderHead(el);

    if (!this.groups.length) {
      const p = el.createEl('p', { text: t('review.emptyBook') });
      p.setCssProps({ color: 'var(--text-muted)' });
      this.renderFooter(el);
      return;
    }

    const list = el.createDiv();
    list.setCssProps({ flex: '1 1 auto', 'min-height': '0', 'overflow-y': 'auto', margin: '0 0 8px' });
    for (const g of this.groups) {
      const key = `${g.index}\u0001${g.title}`;
      const row = chapterRow(g.title || t('common.untitled'), t('review.chapterRow', { n: fmt(g.count), chars: fmt(g.chars) }));
      withCheckbox(row, this.markPicked.has(key), (on) => {
        if (on) this.markPicked.add(key);
        else this.markPicked.delete(key);
        this.render();
      });
      list.appendChild(row);
    }

    const stats = pickedMarkStats(this.marks, Array.from(this.markPicked));
    const allKeys = this.groups.map((g) => `${g.index}\u0001${g.title}`);
    this.renderSelectBar(el, allKeys.length > 0 && allKeys.every((k) => this.markPicked.has(k)), () => {
      const every = allKeys.every((k) => this.markPicked.has(k));
      this.markPicked = new Set(every ? [] : allKeys);
      this.render();
    });
    this.renderSummary(el, t('review.picked', { chapters: fmt(this.markPicked.size), marks: fmt(stats.count), chars: fmt(stats.chars) }));
    this.renderFooter(el);
  }

  private renderChapterPick(el: HTMLElement): void {
    if (this.loading) {
      const p = el.createEl('p', { text: t('review.loading') });
      p.setCssProps({ color: 'var(--text-muted)' });
      return;
    }
    if (this.loadError || !this.chapters) {
      const p = el.createEl('p', { text: t('review.loadFailed') });
      p.setCssProps({ color: 'var(--text-error)' });
      this.renderFooter(el);
      return;
    }
    if (!this.chapters.length) {
      const p = el.createEl('p', { text: t('review.loadFailed') });
      p.setCssProps({ color: 'var(--text-error)' });
      this.renderFooter(el);
      return;
    }

    const list = el.createDiv({ cls: 'bzs-scope-list' });
    list.setCssProps({ flex: '1 1 auto', 'min-height': '0', 'overflow-y': 'auto', margin: '0 0 8px' });
    for (const c of this.chapters) {
      const row = chapterRow(c.title || t('common.untitled'), '');
      withCheckbox(row, this.chapPicked.has(c.index), (on) => {
        if (on) this.chapPicked.add(c.index);
        else this.chapPicked.delete(c.index);
        this.render();
      });
      pinRowLayout(row);
      list.appendChild(row);
    }

    const all = this.chapters.map((c) => c.index);
    this.renderSelectBar(el, all.length > 0 && all.every((i) => this.chapPicked.has(i)), () => {
      const every = all.every((i) => this.chapPicked.has(i));
      this.chapPicked = new Set(every ? [] : all);
      this.render();
    });
    const picked = this.chapters.filter((c) => this.chapPicked.has(c.index));
    this.renderSummary(el, t('review.pickedChapters', { chapters: fmt(picked.length), chars: '—' }));
    this.renderFooter(el);
  }

  /** 全选 / 全不选（按钮文字跟着当前状态走） */
  private renderSelectBar(el: HTMLElement, every: boolean, toggle: () => void): void {
    const bar = el.createDiv();
    bar.setCssProps({ display: 'flex', gap: '8px', margin: '0 0 8px' });
    const b = bar.createEl('button', { text: every ? t('review.selectNone') : t('review.selectAll') });
    b.addEventListener('click', toggle);
  }

  private renderSummary(el: HTMLElement, text: string): void {
    const p = el.createEl('p', { text });
    p.setCssProps({ margin: '0 0 10px', fontWeight: '600' });
  }

  /** 底部按钮：取消 / 下一步 */
  private renderFooter(el: HTMLElement): void {
    const row = el.createDiv({ cls: 'modal-button-container' });
    const cancel = row.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => this.modal.close());
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    next.disabled = this.busy;
    next.addEventListener('click', () => void this.toConfirm());
  }

  /* ─────────── 读章节 ─────────── */

  private async loadFoliate(): Promise<FoliateBook | null> {
    const path = this.book.fileRef?.vaultPath;
    if (!path) return null;
    try {
      const buf = await this.app.vault.adapter.readBinary(path);
      const name = path.split('/').pop() || 'book.epub';
      return await makeBook(new File([buf], name));
    } catch {
      return null;
    }
  }

  /** 全部章节：section 为顺序，标题从目录反查 */
  private async loadChapters(): Promise<void> {
    this.loading = true;
    this.loadError = false;
    this.render();
    const fb = await this.loadFoliate();
    if (!fb) {
      this.loading = false;
      this.loadError = true;
      this.render();
      return;
    }
    const sections = fb.sections ?? [];
    const toc = fb.toc ?? [];
    /* 目录项 → section 下标：同一章被多个目录项指向时取第一个（父项优先） */
    const byIndex = new Map<number, string>();
    const walk = (items: typeof toc): void => {
      for (const it of items) {
        const href = String(it.href || '');
        let index = -1;
        try {
          const r = fb.resolveHref?.(href);
          if (r && Number.isFinite(r.index)) index = r.index;
        } catch {
          index = -1;
        }
        if (index >= 0 && !byIndex.has(index) && String(it.label || '').trim()) {
          byIndex.set(index, String(it.label).trim());
        }
        if (it.subitems?.length) walk(it.subitems);
      }
    };
    walk(toc);
    this.chapters = sections.map((s, i) => ({ index: i, title: byIndex.get(i) || `#${i + 1}` }));
    this.loading = false;
    this.render();
  }

  /** 读某一章正文（读完缓存，确认页与执行阶段共用） */
  private async chapterBody(index: number): Promise<string> {
    const hit = this.chapterBodies.get(index);
    if (hit !== undefined) return hit;
    const fb = await this.loadFoliate();
    if (!fb) return '';
    const sec = fb.sections?.[index];
    if (!sec?.createDocument) return '';
    try {
      const doc = await sec.createDocument();
      const text = String(doc?.body?.textContent ?? '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      this.chapterBodies.set(index, text);
      sec.unload?.();
      return text;
    } catch {
      return '';
    }
  }

  /* ─────────── 第二步：确认 ─────────── */

  private async toConfirm(): Promise<void> {
    if (this.busy) return;
    if (this.tab === 'marks') {
      const stats = pickedMarkStats(this.marks, Array.from(this.markPicked));
      if (!stats.count) {
        notify(t('review.picked', { chapters: '0', marks: '0', chars: '0' }), 'info');
        return;
      }
      this.confirmInfo = { chapters: this.markPicked.size, marks: stats.count, chars: stats.chars, bodyChars: 0 };
      this.step = 'confirm';
      this.render();
      return;
    }

    if (!this.chapPicked.size) {
      notify(t('review.pickedChapters', { chapters: '0', chars: '0' }), 'info');
      return;
    }

    /* 按章节模式：确认页要显示准确字数，所以先把正文读出来 */
    this.busy = true;
    const progress = notifyProgress(t('review.loading'));
    let chars = 0;
    try {
      const list = Array.from(this.chapPicked).sort((a, b) => a - b);
      for (let i = 0; i < list.length; i += 1) {
        const body = await this.chapterBody(list[i]);
        chars += Array.from(body).length;
        progress.setMessage(t('review.loading') + ` ${i + 1}/${list.length}`);
      }
    } finally {
      progress.hide();
      this.busy = false;
    }
    this.confirmInfo = { chapters: this.chapPicked.size, marks: 0, chars, bodyChars: chars };
    this.step = 'confirm';
    this.render();
  }

  private renderConfirm(el: HTMLElement): void {
    const info = this.confirmInfo;
    if (!info) {
      this.step = 'pick';
      this.render();
      return;
    }
    const chars = info.chars;
    const mode = this.tab === 'marks' ? t('review.tab.marks') : t('review.tab.chapters');

    const box = el.createDiv();
    box.setCssProps({ margin: '0 0 12px' });
    const line = (text: string, cls = ''): void => {
      const p = box.createEl('p', { text });
      p.setCssProps({ margin: '0 0 6px' });
      if (cls) p.className = cls;
    };
    line(t('review.confirmMode', { mode }));
    line(
      t('review.confirmScope', {
        scope:
          this.tab === 'marks'
            ? t('review.picked', { chapters: fmt(info.chapters), marks: fmt(info.marks), chars: fmt(chars) })
            : t('review.pickedChapters', { chapters: fmt(info.chapters), chars: fmt(chars) }),
      }),
    );
    line(t('review.confirmChars', { chars: fmt(chars) }));

    /* 每章最多几张：默认 0 = 不限制，由内容和章节决定 */
    const limitRow = el.createDiv({ cls: 'setting-item' });
    const limitInfo = limitRow.createDiv({ cls: 'setting-item-info' });
    limitInfo.createDiv({ cls: 'setting-item-name', text: t('review.limitLabel') });
    limitInfo.createDiv({ cls: 'setting-item-description', text: t('review.limitHint') });
    const limitCtl = limitRow.createDiv({ cls: 'setting-item-control' });
    const input = limitCtl.createEl('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(this.limit);
    input.setCssProps({ width: '72px' });
    input.addEventListener('input', () => {
      this.limit = Math.max(0, Math.round(Number(input.value) || 0));
    });
    el.appendChild(limitRow);

    /* 字数警告：先算清楚，再让人点「开始」 */
    if (chars > AI_BLOCK_CHARS) {
      const warn = el.createEl('p', { text: t('review.blockChars', { chars: fmt(chars), limit: fmt(AI_BLOCK_CHARS) }) });
      warn.setCssProps({ color: 'var(--text-error)', fontWeight: '600' });
    } else if (chars > AI_WARN_CHARS) {
      const warn = el.createEl('p', { text: t('review.warnChars', { chars: fmt(chars) }) });
      warn.setCssProps({ color: 'var(--text-warning, var(--text-error))', fontWeight: '600' });
    }

    const note = el.createEl('p', { text: t('review.confirmNote') });
    note.setCssProps({ color: 'var(--text-muted)', fontSize: '0.9em' });

    const row = el.createDiv({ cls: 'modal-button-container' });
    const back = row.createEl('button', { text: t('review.back') });
    back.addEventListener('click', () => {
      this.step = 'pick';
      this.render();
    });
    const start = row.createEl('button', { text: t('review.start'), cls: 'mod-cta' });
    start.disabled = chars > AI_BLOCK_CHARS || this.busy;
    start.addEventListener('click', () => void this.run());
  }

  /* ─────────── 执行 ─────────── */

  private async run(): Promise<void> {
    if (this.busy) return;
    const info = this.confirmInfo;
    if (!info) return;
    this.busy = true;
    this.render();

    const plan: RunChapter[] =
      this.tab === 'marks'
        ? (() => {
            const picked = pickedMarks(this.marks, Array.from(this.markPicked));
            /* 按章分组后交给执行层：批是按字数切的，但标题要跟着每条走 */
            const byChapter = new Map<string, RunChapter>();
            for (const m of picked) {
              const key = `${m.chapterIndex}\u0001${m.chapterTitle}`;
              let c = byChapter.get(key);
              if (!c) {
                c = { index: m.chapterIndex, title: m.chapterTitle, marks: [] };
                byChapter.set(key, c);
              }
              c.marks.push(m);
            }
            return Array.from(byChapter.values());
          })()
        : this.chapters!.filter((c) => this.chapPicked.has(c.index)).map((c) => ({ index: c.index, title: c.title, marks: [] }));

    const ask = async (prompt: string): Promise<string> =>
      aiPostChat(this.settings, [{ role: 'user', content: prompt }], {});

    const progress = notifyProgress(t('review.running', { done: '0', total: '1' }));
    let res;
    try {
      res = await runReviewAdd(
        {
          book: this.book,
          api: this.api,
          ask,
          chapterText: (i) => this.chapterBody(i),
        },
        { mode: this.tab, chapters: plan, limit: this.limit },
        {
          onProgress: (done, total) => progress.setMessage(t('review.running', { done: String(done), total: String(total) })),
        },
      );
    } finally {
      progress.hide();
      this.busy = false;
    }

    /* 结果说人话：加了几条、几条本来就有、几条超了免费额度、几批没跑通 */
    if (!res.cards) {
      notify(res.failed ? t('review.doneFailed', { n: String(res.failed) }) : t('review.doneEmpty'), 'error');
    } else {
      const parts: string[] = [];
      parts.push(res.exists ? t('review.doneExists', { n: fmt(res.added), exists: fmt(res.exists) }) : t('review.done', { n: fmt(res.added) }));
      if (res.rejected) parts.push(t('review.doneRejected', { n: fmt(res.rejected) }));
      if (res.failed) parts.push(t('review.doneFailed', { n: String(res.failed) }));
      notify(parts.join('；'), res.added ? 'success' : 'error');
    }
    this.modal.close();
  }
}

/* ============================================================
 * 书右键「加入复习」：范围选择 → 解析原文 → 三选一制卡
 * ============================================================ */

/**
 * 书右键菜单那颗「加入复习」的入口。
 *
 * 2026-11-19 起不再在门口拦「没配 AI」：第一屏里「每条一张」根本不调 AI，
 * 先拦掉等于把一个不用 AI 的功能也锁死。要 AI 的那两项点了再引导。
 */
export async function openBookReviewAdd(app: App | undefined, book: ReaderBook | undefined): Promise<void> {
  if (!app || !book) return;
  if (!findReviewApi(app)) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  new BookScopeFlow(app, book, shellSettings()).open();
}

/**
 * 第一屏：选要加入的内容（三张卡片，与第二屏同一套视觉）。
 *
 * 打开时先问一次「哪些划线已经在计划里」——两件事都靠它：
 *   · 卡片副行照实写「共 N 条，其中 M 条已在计划里」；
 *   · 划线全加过时，「每条一张 / 划线重点」两项整块置灰，别让人白点。
 */
class BookScopeFlow {
  private app: App;
  private book: ReaderBook;
  private settings: ReaderSettings;
  private modal: Modal;
  private scope: Scope = 'marks';
  private busy = false;
  private markCount = 0;
  private plannedMarkCount = 0;
  /** 状态查过没有：没查完就别把「全加过」当成事实去禁用选项 */
  private statusDone = false;
  /** 按章节：第一屏选完后的中间步——列全书章节让用户勾选（反馈 2026-11-20） */
  private stage: 'scope' | 'chapters' = 'scope';
  private chapters: ScopeChapter[] | null = null;
  private chapPicked = new Set<number>();

  constructor(app: App, book: ReaderBook, settings: ReaderSettings) {
    this.app = app;
    this.book = book;
    this.settings = settings;
    this.modal = new Modal(app);
  }

  open(): void {
    this.modal.titleEl.setText(t('review.scope.title'));
    this.modal.onClose = () => this.modal.contentEl.empty();
    this.render();
    this.modal.open();
    /* 先查「哪些加过」：查完会重画一次卡片副行与可用状态 */
    void this.loadStatus();
  }

  /** 这本书的全部划线（带章节信息），各入口共用一份口径 */
  private rawMarks(): ScopeMark[] {
    return marksOf(this.book).map((m) => ({
      id: m.id, chapterIndex: m.chapterIndex, chapterTitle: m.chapterTitle, text: m.text, comment: m.comment,
    }));
  }

  /**
   * 查「哪些划线已经在计划里」。
   *
   * 只查划线（第一屏能确定的就是它们）；「按章节」挑的是正文句子，钥匙要等
   * AI 挑完才算得出来，那一步由第二屏统一过滤。
   */
  private async loadStatus(): Promise<void> {
    const list = this.rawMarks();
    this.markCount = list.length;
    try {
      const api = findReviewApi(this.app);
      if (api?.statusOf && list.length) {
        const keys = list.map((m) => markCardKey(this.book.id, m.id));
        const rows = await api.statusOf(keys);
        const planned = new Set(rows.filter((r) => r.planned).map((r) => r.path));
        this.plannedMarkCount = keys.filter((k) => planned.has(k)).length;
      }
    } catch {
      /* 查询失败：按「都没加过」处理，Review 侧后面还会按钥匙去重 */
    }
    this.statusDone = true;
    /* 划线全加过时，默认落到「按章节」——正文里还有没加过的内容 */
    if (this.scope === 'marks' && this.newMarkCount() === 0) this.scope = 'chaptersKey';
    this.render();
  }

  /** 还有多少条划线没加过 */
  private newMarkCount(): number {
    return Math.max(0, this.markCount - this.plannedMarkCount);
  }

  /** 当前该画哪一屏：按章节选中后先画章节勾选屏 */
  private render(): void {
    if (this.stage === 'chapters') {
      this.renderChapterPick(this.modal.contentEl);
      return;
    }
    /* 回到第一屏：撤掉按章节那屏的半屏与纵向 flex，恢复自适应高度 */
    this.modal.modalEl.setCssProps({ 'max-height': '', height: '' });
    this.modal.contentEl.setCssProps({
      display: '',
      'flex-direction': '',
      'min-height': '',
      overflow: '',
    });
    this.renderScopePick(this.modal.contentEl);
  }

  /** 按章节的中间屏：列出这本书的全部章节，勾完才让 AI 读正文挑重点 */
  private renderChapterPick(el: HTMLElement): void {
    el.empty();
    this.modal.titleEl.setText(t('review.tab.chapters'));
    /* 半屏高、头尾固定、章节列表自己滚（2026-11-21）。
       弹窗挂 body，壳层 CSS 会被构建加 .bzs-shell 前缀匹配不到，所以走内联。 */
    /* 至少半屏（手机取六成）：章节列表吃掉中间全部剩余空间 */
    this.modal.modalEl.setCssProps({ 'max-height': '60vh', height: '60vh' });
    el.setCssProps({
      display: 'flex',
      'flex-direction': 'column',
      'min-height': '0',
      overflow: 'hidden',
    });
    el.createEl('p', { cls: 'bzs-review-lead', text: t('review.chaptersLead') })
      .setCssProps({ flex: 'none' });

    if (this.busy || !this.chapters) {
      el.createDiv({ cls: 'bzs-review-loading', text: t('review.loading') });
      return;
    }
    if (!this.chapters.length) {
      el.createEl('p', { cls: 'bzs-review-lead', text: t('review.loadFailed') });
    } else {
      const list = el.createDiv();
      /* 吃掉面板中段的全部剩余高度——章节多时这里是主要阅读区 */
      list.setCssProps({
        flex: '1 1 auto',
        'min-height': '0',
        'overflow-y': 'auto',
        margin: '0 0 8px',
      });
      for (const c of this.chapters) {
        const row = chapterRow(c.title || t('common.untitled'), '');
        withCheckbox(row, this.chapPicked.has(c.index), (on) => {
          if (on) this.chapPicked.add(c.index);
          else this.chapPicked.delete(c.index);
          this.render();
        });
        pinRowLayout(row);
        list.appendChild(row);
      }
      const all = this.chapters.map((c) => c.index);
      const every = all.length > 0 && all.every((i) => this.chapPicked.has(i));
      /* 全选与「已选 N 章」并一行：省下的高度全部给章节列表 */
      const bar = el.createDiv();
      bar.setCssProps({
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: '0 0 8px',
        flex: 'none',
      });
      bar.createEl('button', { text: every ? t('review.selectNone') : t('review.selectAll') })
        .addEventListener('click', () => {
          this.chapPicked = new Set(every ? [] : all);
          this.render();
        });
      const summary = bar.createEl('span', {
        text: t('review.pickedChapters', { chapters: String(this.chapPicked.size), chars: '—' }),
      });
      summary.setCssProps({ fontWeight: '600' });
    }

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    row.setCssProps({ flex: 'none' });
    const back = row.createEl('button', { text: t('review.back') });
    back.addEventListener('click', () => {
      this.stage = 'scope';
      this.modal.titleEl.setText(t('review.scope.title'));
      this.render();
    });
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    next.disabled = this.busy || !this.chapPicked.size;
    next.addEventListener('click', () => void this.runChapters());
  }

  /** 第一屏的三张卡片。**行间不加分隔线**：卡片本身就是边界 */
  private renderScopePick(el: HTMLElement): void {
    /* 查「已在计划里的划线」是异步的，查完会再画一次；不清就会叠出两屏卡片。
       2026-11-20 真机走查撞到：一屏两套「加入划线」，点哪套都容易点错。 */
    el.empty();
    const newMarks = this.newMarkCount();
    /* 没查完之前不把「全加过」当结论：先按可用处理，查完会重画一次 */
    const marksUsable = this.statusDone ? newMarks > 0 : true;
    const opts: Array<{ key: Scope; label: string; sub: string; usable: boolean }> = [
      {
        key: 'marks',
        label: t('review.scope.marks'),
        sub: this.markCount === 0
          ? t('review.scope.marksEmpty')
          : this.plannedMarkCount > 0
            ? t('review.scope.marksSubPlanned', { n: String(this.markCount), planned: String(this.plannedMarkCount) })
            : t('review.scope.marksSub', { n: String(this.markCount) }),
        usable: marksUsable,
      },
      {
        key: 'marksKey',
        label: t('review.scope.marksKey'),
        sub: t('review.scope.marksKeySub', { n: String(newMarks) }),
        usable: marksUsable,
      },
      {
        key: 'chaptersKey',
        label: t('review.scope.chaptersKey'),
        sub: t('review.scope.chaptersKeySub'),
        usable: true,
      },
    ];

    const list = el.createDiv({ cls: 'bzs-review-choice-list' });
    for (const o of opts) {
      const card = list.createDiv({ cls: 'bzs-review-choice' });
      card.createDiv({ cls: 'bzs-review-choice-name', text: o.label });
      card.createDiv({ cls: 'bzs-review-choice-sub', text: o.sub });
      if (this.scope === o.key && o.usable) card.addClass('is-on');
      if (!o.usable) {
        card.addClass('is-off');
        continue;
      }
      card.addEventListener('click', () => {
        if (this.scope === o.key) return;
        this.scope = o.key;
        this.render();
      });
    }

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const cancel = row.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => this.modal.close());
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    const selected = opts.find((o) => o.key === this.scope);
    next.disabled = this.busy || !selected?.usable;
    next.addEventListener('click', () => void this.run());
  }

  /** 读目录（章节重点模式才需要）；失败按空处理，让 resolveScope 跳过 */
  private async loadChapters(): Promise<ScopeChapter[]> {
    const path = this.book.fileRef?.vaultPath;
    if (!path) return [];
    try {
      const buf = await this.app.vault.adapter.readBinary(path);
      const name = path.split('/').pop() || 'book.epub';
      const fb = await makeBook(new File([buf], name));
      const sections = fb.sections ?? [];
      const toc = fb.toc ?? [];
      const byIndex = new Map<number, string>();
      const walk = (items: typeof toc): void => {
        for (const it of items) {
          let index = -1;
          try {
            const r = fb.resolveHref?.(String(it.href || ''));
            if (r && Number.isFinite(r.index)) index = r.index;
          } catch { index = -1; }
          if (index >= 0 && !byIndex.has(index) && String(it.label || '').trim()) {
            byIndex.set(index, String(it.label).trim());
          }
          if (it.subitems?.length) walk(it.subitems);
        }
      };
      walk(toc);
      return sections.map((_, i) => ({ index: i, title: byIndex.get(i) || `#${i + 1}` }));
    } catch {
      return [];
    }
  }

  /** 读某一章正文（每次新开文档，读完即弃） */
  private async chapterBody(index: number): Promise<string> {
    const path = this.book.fileRef?.vaultPath;
    if (!path) return '';
    try {
      const buf = await this.app.vault.adapter.readBinary(path);
      const name = path.split('/').pop() || 'book.epub';
      const fb = await makeBook(new File([buf], name));
      const sec = fb.sections?.[index];
      if (!sec?.createDocument) return '';
      const doc = await sec.createDocument();
      const text = String(doc?.body?.textContent ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      sec.unload?.();
      return text;
    } catch {
      return '';
    }
  }

  /**
   * 点「下一步」。
   *
   *   · 每条一张：不调 AI，直接算出候选交第二屏（那边会再剔一次已在计划里的）；
   *   · 两个「重点」：先确认 AI 可用，再**立刻翻到第二屏**，在那里显示
   *     「正在读章节 / 正在挑重点」，AI 回来后原地变成三选一。
   */
  private async run(): Promise<void> {
    if (this.busy) return;
    const marks = this.rawMarks();
    const scope = this.scope;

    if (scope !== 'marks' && !(await aiReadyShared(this.settings, this.app))) {
      openAiGuide();
      return;
    }

    if (scope === 'marks') {
      const sources = await resolveScope('marks', {
        bookId: this.book.id,
        bookTitle: this.book.meta.title || '',
        marks,
        chapters: [],
        ask: async () => '',
        chapterText: async () => '',
      });
      this.modal.close();
      openCardsFlow(this.app, sources);
      return;
    }

    /* 按章节：先列全书章节给用户勾，选完才让 AI 读正文挑重点（反馈 2026-11-20）。
       划线重点没有「列目录」这一步——它读的就是已有的划线。 */
    if (scope === 'chaptersKey') {
      this.busy = true;
      this.stage = 'chapters';
      this.chapters = null;
      this.chapPicked = new Set();
      this.render();
      this.chapters = await this.loadChapters();
      this.busy = false;
      this.render();
      return;
    }

    this.openMarksKeyLoading(marks);
  }

  /** 划线重点：直接翻到第二屏加载态，文案按「读划线」写 */
  private openMarksKeyLoading(marks: ScopeMark[]): void {
    this.modal.close();
    openCardsFlowLoading(
      this.app,
      () => resolveScope('marksKey', {
        bookId: this.book.id,
        bookTitle: this.book.meta.title || '',
        marks,
        chapters: [],
        ask: (p) => aiPostChat(this.settings, [{ role: 'user', content: p }], {}),
        chapterText: async () => '',
      }),
      'review.loadingScopeMarks',
    );
  }

  /** 章节勾选屏点「下一步」：只把勾中的章节交给 AI，不再全书通读 */
  private async runChapters(): Promise<void> {
    if (this.busy || !this.chapters || !this.chapPicked.size) return;
    const picked = pickedChapters(this.chapters, this.chapPicked);
    const marks = this.rawMarks();
    this.modal.close();
    openCardsFlowLoading(
      this.app,
      () => resolveScope('chaptersKey', {
        bookId: this.book.id,
        bookTitle: this.book.meta.title || '',
        marks,
        chapters: picked,
        ask: (p) => aiPostChat(this.settings, [{ role: 'user', content: p }], {}),
        chapterText: (i) => this.chapterBody(i),
      }),
      'review.loadingScope',
    );
  }
}
