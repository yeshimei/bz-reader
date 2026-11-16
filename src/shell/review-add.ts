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
import { aiReady } from '../data/settings';
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
import { marksOf } from './domain';
import { liveBooks, shellSettings } from './source';
import { runReviewAdd, type RunChapter } from './review-run';
import { openCardsFlow } from './review-cards-ui';
import { resolveScope, type Scope, type ScopeChapter, type ScopeMark } from './review-scope';

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
  if (!aiReady(settings)) {
    notify(t('review.needAI'), 'info');
    return;
  }
  new ReviewAddFlow(app, book, api, settings).open();
}

/**
 * 工具条上的「加入复习」：点开一条已经划好的线 → 弹三选一制卡。
 *
 * 一条划线就是一张卡，没有「挑哪些章节」的问题。重复点不会排两次——
 * 钥匙由 `reader:<书>:<划线>` 决定，Review 那边见到已存在就跳过。
 */
export async function addMarkToReview(app: App | undefined, book: ReaderBook | undefined, markId: string | undefined): Promise<void> {
  if (!app || !book) return;
  const h = (book.notes?.highlights ?? []).find((x) => x.id === markId);
  if (!h) {
    notify(t('notice.mark.notFound'), 'error');
    return;
  }
  openCardsFlow(app, [{
    key: markCardKey(book.id, h.id),
    bookTitle: book.meta.title || '',
    chapterTitle: h.chapterTitle,
    text: h.text,
    comment: h.comment,
  }]);
}

/**
 * 工具条上的「加入复习」：划了一段还没保存 → 弹三选一制卡。
 *
 * 不先落一条划线：用户点的是「去复习」，不是「在书里标一笔」。钥匙按
 * 「书 + 章节 + 原文」算，同一段文字重复加不会排两次。
 */
export async function addSelectionToReview(
  app: App | undefined,
  sel: { text: string; bookId: string; chapterTitle?: string } | null | undefined,
): Promise<void> {
  if (!app || !sel || !String(sel.text ?? '').trim()) return;
  const book = liveBooks().find((b) => b.id === sel.bookId);
  if (!book) return;
  const title = sel.chapterTitle || '';
  openCardsFlow(app, [{
    key: aiCardKey(book.id, title, sel.text),
    bookTitle: book.meta.title || '',
    chapterTitle: title || undefined,
    text: String(sel.text).trim(),
  }]);
}

/** 千分位：字数与条数都要给人看，3,240 比 3240 好读 */
function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US');
}

/** 章节行：标题 + 副标题（条数 / 字数） */
function chapterRow(title: string, sub: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'setting-item';
  const info = document.createElement('div');
  info.className = 'setting-item-info';
  const name = document.createElement('div');
  name.className = 'setting-item-name';
  name.textContent = title;
  info.appendChild(name);
  if (sub) {
    const desc = document.createElement('div');
    desc.className = 'setting-item-description';
    desc.textContent = sub;
    info.appendChild(desc);
  }
  row.appendChild(info);
  return row;
}

/** 勾选框放进 setting-item 的右侧控件区 */
function withCheckbox(row: HTMLElement, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const ctl = document.createElement('div');
  ctl.className = 'setting-item-control';
  const box = document.createElement('input');
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
    el.empty();
    if (this.step === 'confirm') {
      this.renderConfirm(el);
      return;
    }
    this.renderPick(el);
  }

  /** 顶部：书名 + 两个 tab */
  private renderHead(el: HTMLElement): void {
    const title = this.book.meta.title || t('common.untitled');
    const sub = el.createEl('p');
    sub.style.margin = '0 0 8px';
    sub.style.color = 'var(--text-muted)';
    sub.textContent = title;

    const tabs = el.createDiv();
    tabs.style.display = 'flex';
    tabs.style.gap = '4px';
    tabs.style.margin = '0 0 10px';
    const mk = (key: 'marks' | 'chapters', label: string): void => {
      const b = tabs.createEl('button', { text: label });
      b.style.padding = '4px 12px';
      b.style.borderRadius = '6px';
      b.style.border = '1px solid var(--background-modifier-border)';
      b.style.background = this.tab === key ? 'var(--interactive-accent)' : 'transparent';
      b.style.color = this.tab === key ? 'var(--text-on-accent)' : 'var(--text-normal)';
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
    lead.style.margin = '0 0 8px';
    lead.style.fontSize = '0.9em';
    lead.style.color = 'var(--text-muted)';
    lead.textContent = this.tab === 'marks' ? t('review.marksLead') : t('review.chaptersLead');
  }

  private renderPick(el: HTMLElement): void {
    this.renderHead(el);

    if (this.tab === 'chapters') {
      this.renderChapterPick(el);
      return;
    }

    if (!this.groups.length) {
      const p = el.createEl('p', { text: t('review.emptyBook') });
      p.style.color = 'var(--text-muted)';
      this.renderFooter(el);
      return;
    }

    const list = el.createDiv();
    list.style.maxHeight = '46vh';
    list.style.overflowY = 'auto';
    list.style.margin = '0 0 8px';
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
      p.style.color = 'var(--text-muted)';
      return;
    }
    if (this.loadError || !this.chapters) {
      const p = el.createEl('p', { text: t('review.loadFailed') });
      p.style.color = 'var(--text-error)';
      this.renderFooter(el);
      return;
    }
    if (!this.chapters.length) {
      const p = el.createEl('p', { text: t('review.loadFailed') });
      p.style.color = 'var(--text-error)';
      this.renderFooter(el);
      return;
    }

    const list = el.createDiv();
    list.style.maxHeight = '46vh';
    list.style.overflowY = 'auto';
    list.style.margin = '0 0 8px';
    for (const c of this.chapters) {
      const row = chapterRow(c.title || t('common.untitled'), '');
      withCheckbox(row, this.chapPicked.has(c.index), (on) => {
        if (on) this.chapPicked.add(c.index);
        else this.chapPicked.delete(c.index);
        this.render();
      });
      list.appendChild(row);
    }

    const all = this.chapters!.map((c) => c.index);
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
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.margin = '0 0 8px';
    const b = bar.createEl('button', { text: every ? t('review.selectNone') : t('review.selectAll') });
    b.addEventListener('click', toggle);
  }

  private renderSummary(el: HTMLElement, text: string): void {
    const p = el.createEl('p', { text });
    p.style.margin = '0 0 10px';
    p.style.fontWeight = '600';
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
        const body = await this.chapterBody(list[i]!);
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
    box.style.margin = '0 0 12px';
    const line = (text: string, cls = ''): void => {
      const p = box.createEl('p', { text });
      p.style.margin = '0 0 6px';
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
    input.style.width = '72px';
    input.addEventListener('input', () => {
      this.limit = Math.max(0, Math.round(Number(input.value) || 0));
    });
    el.appendChild(limitRow);

    /* 字数警告：先算清楚，再让人点「开始」 */
    if (chars > AI_BLOCK_CHARS) {
      const warn = el.createEl('p', { text: t('review.blockChars', { chars: fmt(chars), limit: fmt(AI_BLOCK_CHARS) }) });
      warn.style.color = 'var(--text-error)';
      warn.style.fontWeight = '600';
    } else if (chars > AI_WARN_CHARS) {
      const warn = el.createEl('p', { text: t('review.warnChars', { chars: fmt(chars) }) });
      warn.style.color = 'var(--text-warning, var(--text-error))';
      warn.style.fontWeight = '600';
    }

    const note = el.createEl('p', { text: t('review.confirmNote') });
    note.style.color = 'var(--text-muted)';
    note.style.fontSize = '0.9em';

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

/** 书右键菜单那颗「加入复习」的入口 */
export function openBookReviewAdd(app: App | undefined, book: ReaderBook | undefined): void {
  if (!app || !book) return;
  if (!findReviewApi(app)) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  const settings = shellSettings();
  if (!aiReady(settings)) {
    notify(t('review.needAI'), 'info');
    return;
  }
  new BookScopeFlow(app, book, settings).open();
}

/** 选范围的小弹窗（划线每条 / 划线重点 / 章节重点） */
class BookScopeFlow {
  private app: App;
  private book: ReaderBook;
  private settings: ReaderSettings;
  private modal: Modal;
  private scope: Scope = 'marks';
  private chapters: ScopeChapter[] = [];
  private busy = false;

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
  }

  private render(): void {
    const el = this.modal.contentEl;
    el.empty();
    const opts: Array<{ key: Scope; label: string }> = [
      { key: 'marks', label: t('review.scope.marks') },
      { key: 'marksKey', label: t('review.scope.marksKey') },
      { key: 'chaptersKey', label: t('review.scope.chaptersKey') },
    ];
    for (const o of opts) {
      const row = el.createDiv({ cls: 'setting-item' });
      const info = row.createDiv({ cls: 'setting-item-info' });
      info.createDiv({ cls: 'setting-item-name', text: o.label });
      const ctl = row.createDiv({ cls: 'setting-item-control' });
      const radio = ctl.createEl('input');
      radio.type = 'radio';
      radio.name = 'review-scope';
      radio.checked = this.scope === o.key;
      radio.addEventListener('change', () => { if (radio.checked) this.scope = o.key; });
    }
    const row = el.createDiv({ cls: 'modal-button-container' });
    const cancel = row.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => this.modal.close());
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    next.disabled = this.busy;
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

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const progress = notifyProgress(t('review.loading'));
    try {
      if (this.scope === 'chaptersKey' && !this.chapters.length) this.chapters = await this.loadChapters();
      const marks: ScopeMark[] = marksOf(this.book).map((m) => ({
        id: m.id, chapterIndex: m.chapterIndex, chapterTitle: m.chapterTitle, text: m.text, comment: m.comment,
      }));
      const sources = await resolveScope(this.scope, {
        bookId: this.book.id,
        bookTitle: this.book.meta.title || '',
        marks,
        chapters: this.chapters,
        ask: (p) => aiPostChat(this.settings, [{ role: 'user', content: p }], {}),
        chapterText: (i) => this.chapterBody(i),
      });
      this.modal.close();
      if (!sources.length) {
        notify(t('review.doneEmpty'), 'info');
        return;
      }
      openCardsFlow(this.app, sources);
    } catch {
      notify(t('review.addFailed', { why: t('common.unknownError') }), 'error');
    } finally {
      progress.hide();
      this.busy = false;
    }
  }
}
