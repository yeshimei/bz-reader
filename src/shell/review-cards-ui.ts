/* ============================================================
 * bz-reader · 三选一制卡界面（shell/review-cards-ui.ts）
 *
 * 从「一段内容」到「复习卡」的中间那一屏：选方式 → AI 出题 → 改题面 → 入库。
 * 这是「加入复习」的核心交互，两种入口共用：
 *   · 文字工具栏点一条划线 / 一段选中文字 → 一张卡
 *   · 书右键菜单选范围 → 一批原文 → 一批卡（统一方式）
 *
 * 三选一（全文回忆 / 抽认卡 / 做题）对应 Review 的 plain / flashcard / quiz。
 * 界面只做编排与展示；生成、转换、汇总都是纯函数（review-modes / cards-ai），
 * 可测的部分不放在这里。
 *
 * 2026-11-19 改版：
 *   · 三选一可以勾「以后都用这个方式」——勾过就记住，下次直接进确认题面；
 *   · 出题不再只靠角标 Notice，弹窗里自己给加载态（进度原地跳）；
 *   · 重新生成 / 补一道题也进加载态，期间按钮禁用；
 *   · 背面原文改成可编辑；重新生成会覆盖手改内容时先问一句；
 *   · 关窗即取消在途请求，生成结果不再往已关闭的弹窗里写。
 * ============================================================ */
import { Modal, type App } from 'obsidian';
import { t } from '../i18n';
import { notify } from '../core/notice';
import type { ReaderSettings } from '../data/settings';
import { aiPostChat } from '../data/ai';
import {
  confirmCardView,
  estimateSendChars,
  markCardStates,
  mergeDraftQuestions,
  modeOptionParts,
  toCardPayload,
  summaryParts,
  type CardSource,
  type DraftCard,
  type DraftQuestion,
  type ReviewMode,
} from '../data/review-modes';
import { generateDrafts } from '../data/review-cards-ai';
import {
  findReviewApi,
  type ReviewAddSummary,
  type ReviewApi,
  type ReviewQuota,
} from '../data/review-bridge';
import { getShellSource, shellSettings } from './source';

const MODES: readonly ReviewMode[] = ['plain', 'flashcard', 'quiz'];

/** 加入成功后要补做的事（例如给划选的文字补一条划线）。 */
export interface CardsFlowHooks {
  onAdded?: (res: ReviewAddSummary) => void;
}

/** 打开三选一制卡界面。sources 为待制卡的原文（一条就是一张卡）。 */
export function openCardsFlow(app: App | undefined, sources: CardSource[], hooks: CardsFlowHooks = {}): void {
  if (!app || !sources.length) return;
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  new CardsFlow(app, api, sources, shellSettings(), hooks).open();
}

class CardsFlow {
  private app: App;
  private api: ReviewApi;
  private settings: ReaderSettings;
  private sources: CardSource[];
  private modal: Modal;
  private hooks: CardsFlowHooks;

  private step: 'mode' | 'edit' = 'mode';
  private mode: ReviewMode;
  private drafts: DraftCard[] = [];
  private states: string[] = [];
  private busy = false;
  /** 首次出题（整屏）加载态：确认题面里还没内容 */
  private generating = false;
  private genDone = 0;
  private loadingLabel: HTMLElement | null = null;
  /** 单卡重新生成的下标；-1 = 没有 */
  private regenIndex = -1;
  /** 单卡补题（保留已有题目，只在末尾转圈） */
  private fillIndex = -1;
  /** 勾了「以后不再问」 */
  private rememberMode = false;
  /** 被手改过的卡：重新生成前要确认 */
  private touched = new Set<number>();
  /** 等用户确认「覆盖手改内容」的卡 */
  private pendingRegen = new Set<number>();
  private abort: AbortController | null = null;
  private closed = false;
  private existing = new Set<string>();
  private quota: ReviewQuota = { used: 0, limit: 0, remaining: Infinity, full: false };

  constructor(app: App, api: ReviewApi, sources: CardSource[], settings: ReaderSettings, hooks: CardsFlowHooks = {}) {
    this.app = app;
    this.api = api;
    this.settings = settings;
    this.sources = sources;
    this.hooks = hooks;
    const last = settings.reviewLastMode;
    this.mode = last === 'plain' || last === 'flashcard' || last === 'quiz' ? last : 'flashcard';
    /* 上次勾过「不再出现这一屏」：直接落到确认题面，生成过程由它自己的加载态显示 */
    if (settings.reviewAskMode === false) this.step = 'edit';
    this.modal = new Modal(app);
  }

  open(): void {
    this.modal.onClose = () => {
      this.closed = true;
      this.abort?.abort();
      this.modal.contentEl.empty();
    };
    /* 额度与现状是只读查询，失败就按「不标记」处理，不该拦住制卡。 */
    void this.loadStatus();
    /* 跳过三选一：第一帧就得是加载态，不能先闪一下空列表 */
    const auto = this.step === 'edit';
    if (auto) {
      this.generating = true;
      this.busy = true;
    }
    this.render();
    this.modal.open();
    if (auto) void this.generate(true);
  }

  private async loadStatus(): Promise<void> {
    try {
      if (this.api.statusOf) {
        const rows = await this.api.statusOf(this.sources.map((s) => s.key));
        this.existing = new Set(rows.filter((r) => r.planned).map((r) => r.path));
      }
      if (this.api.quota) this.quota = await this.api.quota();
    } catch {
      /* 查询失败：清空状态标记，照常制卡 */
    }
    if (this.step === 'edit' && !this.generating) this.render();
  }

  private render(): void {
    const el = this.modal.contentEl;
    /* 标题跟着步骤走：第二步别再顶着「选一种复习方式」，那是上一步的事。 */
    this.modal.titleEl.setText(t(this.step === 'mode' ? 'review.mode.title' : 'review.make.title'));
    this.loadingLabel = null;
    el.empty();
    if (this.step === 'mode') this.renderMode(el);
    else if (this.generating) this.renderLoading(el);
    else this.renderEdit(el);
  }

  /* ── 第一步：三选一 ── */

  private renderMode(el: HTMLElement): void {
    const lead = el.createEl('p', { text: t('review.make.lead') });
    lead.className = 'bzs-review-mode-lead';

    const list = el.createDiv({ cls: 'bzs-review-mode-list' });
    for (const m of MODES) {
      const card = list.createDiv({ cls: 'bzs-review-mode' });
      /* 标题在上、发送字数在下；全文回忆只有标题，不再写「不用 AI」。 */
      const parts = modeOptionParts(m, estimateSendChars(m, this.sources));
      card.createDiv({ cls: 'bzs-review-mode-name', text: t(parts.titleKey as never) });
      if (parts.hintKey) {
        card.createDiv({ cls: 'bzs-review-mode-chars', text: t(parts.hintKey as never, parts.hintParams) });
      }
      if (this.mode === m) card.addClass('is-on');
      card.addEventListener('click', () => {
        if (this.mode === m) return;
        this.mode = m;
        getShellSource()?.setSettings({ reviewLastMode: m });
        this.render();
      });
    }

    /* 「不再出现这一屏」：勾上就记住方式 + 下次直接出题。这里也是唯一的入口，
       回头路在设置页「加入复习先选方式」。 */
    const remember = el.createEl('label', { cls: 'bzs-review-remember' });
    const box = remember.createEl('input');
    box.type = 'checkbox';
    box.checked = this.rememberMode;
    box.addEventListener('change', () => {
      this.rememberMode = box.checked;
    });
    const text = remember.createDiv({ cls: 'bzs-review-remember-text' });
    text.createEl('b', { text: t('review.make.remember') });
    text.createEl('small', { text: t('review.make.remember.hint') });

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const cancel = row.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => this.modal.close());
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    next.disabled = this.busy;
    next.addEventListener('click', () => {
      if (this.rememberMode) {
        getShellSource()?.setSettings({ reviewAskMode: false, reviewLastMode: this.mode });
        this.settings.reviewAskMode = false;
      }
      void this.generate();
    });
  }

  /* ── 生成题面（整屏加载） ── */

  private async generate(autoStart = false): Promise<void> {
    /* autoStart：跳过三选一时 open() 已经把 busy 置上了，这里不能再被自己挡住 */
    if (this.busy && !autoStart) return;
    this.busy = true;
    this.generating = true;
    this.genDone = 0;
    this.step = 'edit';
    this.render();

    const ac = new AbortController();
    this.abort = ac;
    const ask = (p: string): Promise<string> =>
      aiPostChat(this.settings, [{ role: 'user', content: p }], { signal: ac.signal });
    try {
      this.drafts = await generateDrafts(this.mode, this.sources, (p) => {
        this.genDone += 1;
        this.paintLoading();
        return ask(p);
      });
    } catch (e) {
      if (!this.closed && !ac.signal.aborted) {
        notify(t('review.addFailed', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
      }
    } finally {
      this.abort = null;
      this.generating = false;
      this.busy = false;
    }
    if (this.closed) return;
    this.states = markCardStates(
      this.drafts.map((d) => d.key),
      this.existing,
      this.quota.remaining,
    );
    this.render();
  }

  private renderLoading(el: HTMLElement): void {
    const box = el.createDiv({ cls: 'bzs-review-loading' });
    box.createDiv({ cls: 'bzs-review-spinner' });
    const text = box.createDiv({ cls: 'bzs-review-loading-text' });
    this.loadingLabel = text.createEl('b');
    text.createEl('small', { text: t('review.make.lead') });
    this.paintLoading();

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const back = row.createEl('button', { text: t('review.back') });
    back.disabled = true;
    const confirm = row.createEl('button', { text: t('review.confirmAdd', { n: '0' }), cls: 'mod-cta' });
    confirm.disabled = true;
  }

  private paintLoading(): void {
    this.loadingLabel?.setText(
      t('review.make.generating', { done: String(this.genDone), total: String(this.sources.length) }),
    );
  }

  /* ── 第二步：改题面 + 确认 ── */

  private renderEdit(el: HTMLElement): void {
    const lead = el.createEl('p', { text: t('review.make.lead') });
    lead.className = 'bzs-review-mode-lead';

    const list = el.createDiv({ cls: 'bzs-review-card-list' });
    const scrollTop = this.lastScrollTop;
    this.lastScrollTop = 0;
    this.drafts.forEach((d, i) => list.appendChild(this.renderCard(d, i)));
    /* 重画后把滚动位置放回去：单卡重生成时用户不该被弹回顶部 */
    list.scrollTop = scrollTop;

    /* 批量做题：全部补齐 / 全部重新生成 */
    if (this.drafts.length > 1 && this.mode === 'quiz') {
      const bar = el.createDiv({ cls: 'bzs-review-bulk' });
      const fillAll = bar.createEl('button', { text: t('review.make.fillAll') });
      fillAll.disabled = this.busy;
      fillAll.addEventListener('click', () => void this.fillAll());
      const regenAll = bar.createEl('button', { text: t('review.make.regenAll') });
      regenAll.disabled = this.busy;
      regenAll.addEventListener('click', () => void this.regenAll());
    }

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const back = row.createEl('button', { text: t('review.back') });
    back.disabled = this.busy;
    back.addEventListener('click', () => {
      this.step = 'mode';
      this.render();
    });
    const n = this.drafts.length;
    const confirm = row.createEl('button', { text: t('review.confirmAdd', { n: String(n) }), cls: 'mod-cta' });
    confirm.disabled = this.busy || !n;
    confirm.addEventListener('click', () => void this.submit());
  }

  /** 列表滚动位置：重画前手动记一下（Modal 里没有别的状态容器） */
  private lastScrollTop = 0;

  private renderCard(d: DraftCard, i: number): HTMLElement {
    const box = el_div();
    box.className = 'bzs-review-card';

    const head = box.createDiv({ cls: 'bzs-review-card-head' });
    head.createSpan({ cls: 'bzs-review-card-title', text: `${i + 1}. ${d.chapterTitle || d.bookTitle}` });
    const state = this.states[i] ?? 'new';
    const tag = head.createSpan({ cls: 'bzs-review-card-state', text: stateLabel(state) });
    tag.setCssProps(stateStyle(state));

    const body = box.createDiv({ cls: 'bzs-review-card-body' });

    /* 正在重新生成这一张：内容整块换成骨架，别让旧题和按钮留着可点 */
    if (this.regenIndex === i) {
      const sk = body.createDiv({ cls: 'bzs-review-skeleton' });
      sk.createSpan();
      sk.createSpan();
      sk.createSpan();
      const busy = body.createDiv({ cls: 'bzs-review-card-loading' });
      busy.createDiv({ cls: 'bzs-review-spinner' });
      busy.createSpan({ text: t('review.make.regenLoading') });
      this.renderCardTools(body, i);
      return box;
    }

    const view = confirmCardView(d);
    if (view.showSource) {
      /* 全文回忆的题面就是原文；其余方式别在这里再贴一遍。 */
      const src = body.createEl('p', { cls: 'bzs-review-card-source', text: d.text });
      void src;
    }

    if (d.mode === 'flashcard') {
      const field = body.createDiv({ cls: 'bzs-review-card-field' });
      field.createSpan({ cls: 'bzs-review-card-label', text: t('review.make.front') });
      const input = field.createEl('input', { cls: 'bzs-review-input' });
      input.type = 'text';
      input.value = d.front;
      input.placeholder = t('review.make.front');
      input.addEventListener('input', () => {
        d.front = input.value;
        this.touched.add(i);
      });
      if (view.showBack) {
        const back = body.createDiv({ cls: 'bzs-review-card-back' });
        const label = back.createSpan({ cls: 'bzs-review-card-label' });
        label.setText(t('review.make.back'));
        label.createSpan({ cls: 'bzs-review-card-editable', text: t('review.make.backEditable') });
        /* 背面原文可改：AI 偶尔会把原文裁短，用户自己补一句比重新生成省事 */
        const area = back.createEl('textarea', { cls: 'bzs-review-textarea' });
        area.value = d.back;
        area.rows = Math.min(8, Math.max(2, Math.ceil(d.back.length / 42)));
        area.addEventListener('input', () => {
          d.back = area.value;
          this.touched.add(i);
        });
      }
      this.renderCardTools(body, i);
      return box;
    }

    if (d.mode === 'quiz') {
      const qs = body.createDiv({ cls: 'bzs-review-q-list' });
      if (!d.questions.length && this.fillIndex !== i) {
        qs.createEl('p', { cls: 'bzs-review-card-empty', text: t('review.make.emptyQuiz') });
      }
      d.questions.forEach((q, qi) => qs.appendChild(this.renderQuestion(d, i, qi, q)));
      if (this.fillIndex === i) {
        const busy = qs.createDiv({ cls: 'bzs-review-card-loading' });
        busy.createDiv({ cls: 'bzs-review-spinner' });
        busy.createSpan({ text: t('review.make.generating', { done: '0', total: '1' }) });
      }
      this.renderCardTools(body, i);
      return box;
    }

    return box;
  }

  /** 卡片底部：补一道题 / 重新生成（含「覆盖手改」这一步确认） */
  private renderCardTools(body: HTMLElement, i: number): void {
    const d = this.drafts[i];
    if (!d) return;
    const quiz = d.mode === 'quiz';

    if (this.pendingRegen.has(i)) {
      const ask = body.createDiv({ cls: 'bzs-review-regen-confirm' });
      ask.createSpan({ text: t('review.make.regenOverwrite') });
      const yes = ask.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.regenContinue') });
      yes.addEventListener('click', () => {
        this.pendingRegen.delete(i);
        void this.regenOne(i);
      });
      const no = ask.createEl('button', { cls: 'bzs-review-mini-btn', text: t('common.cancel') });
      no.addEventListener('click', () => {
        this.pendingRegen.delete(i);
        this.render();
      });
      return;
    }

    const bar = body.createDiv({ cls: 'bzs-review-mini-row' });
    if (quiz) {
      const add = bar.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.addQuestion') });
      add.disabled = this.busy;
      add.addEventListener('click', () => void this.fillOne(i));
    }
    const regen = bar.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.regenerate') });
    regen.disabled = this.busy;
    regen.addEventListener('click', () => {
      /* 手改过的题面重新生成会被覆盖：先问一句，别悄悄冲掉用户写的东西 */
      if (this.touched.has(i)) {
        this.pendingRegen.add(i);
        this.render();
        return;
      }
      void this.regenOne(i);
    });
  }

  private renderQuestion(d: DraftCard, cardIndex: number, qi: number, q: DraftQuestion): HTMLElement {
    const row = el_div();
    row.className = 'bzs-review-q';

    const head = row.createDiv({ cls: 'bzs-review-q-head' });
    head.createSpan({ cls: 'bzs-review-q-no', text: String(qi + 1) });
    const del = head.createEl('button', { cls: 'bzs-review-q-del' });
    del.createSpan({ cls: 'bzs-review-q-x', text: '✕' });
    del.createSpan({ cls: 'bzs-sr-only', text: t('review.make.delQuestion') });
    del.disabled = this.busy;
    del.addEventListener('click', () => {
      d.questions.splice(qi, 1);
      this.render();
    });

    const input = row.createEl('input', { cls: 'bzs-review-q-text' });
    input.type = 'text';
    input.value = q.q;
    input.addEventListener('input', () => {
      q.q = input.value;
      this.touched.add(cardIndex);
    });

    /* 选项竖排成行：原来挤成一行「✓A ○B ○C」，读题时要来回数；
       正确项整行点亮，扫一眼就知道答案在哪。 */
    const opts = row.createDiv({ cls: 'bzs-review-q-opts' });
    q.options.forEach((o, oi) => {
      const line = opts.createDiv({ cls: 'bzs-review-opt' });
      if (q.correct.includes(oi)) line.addClass('is-correct');
      line.createSpan({ cls: 'bzs-review-opt-k', text: optionKey(oi) });
      line.createSpan({ cls: 'bzs-review-opt-t', text: o });
      if (q.correct.includes(oi)) line.createSpan({ cls: 'bzs-review-opt-mark', text: '✓' });
    });
    return row;
  }

  /* ── 批量操作 ── */

  private ask(): (p: string) => Promise<string> {
    const signal = this.abort?.signal;
    return (p) => aiPostChat(this.settings, [{ role: 'user', content: p }], signal ? { signal } : {});
  }

  private async regenOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    this.regenIndex = i;
    this.captureScroll();
    this.render();
    const fresh = await generateDrafts(d.mode, [
      { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text, comment: d.comment },
    ], this.ask());
    this.busy = false;
    this.regenIndex = -1;
    if (this.closed) return;
    const nd = fresh[0];
    if (nd) {
      d.front = nd.front;
      d.back = nd.back;
      d.questions = nd.questions;
      this.touched.delete(i);
    }
    this.render();
  }

  private async fillOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    this.fillIndex = i;
    this.captureScroll();
    this.render();
    /* 补一道：让 AI 出三道，按题面去重后追加，已有的不重复 */
    const fresh = await generateDrafts('quiz', [
      { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text },
    ], this.ask());
    this.busy = false;
    this.fillIndex = -1;
    if (this.closed) return;
    d.questions = mergeDraftQuestions(d.questions, fresh[0]?.questions ?? []);
    this.render();
  }

  private async fillAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.fillIndex = -1;
    this.captureScroll();
    this.render();
    for (let i = 0; i < this.drafts.length; i += 1) {
      const d = this.drafts[i];
      if (!d.questions.length) {
        this.fillIndex = i;
        this.render();
        const fresh = await generateDrafts('quiz', [
          { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text },
        ], this.ask());
        if (this.closed) return;
        d.questions = mergeDraftQuestions(d.questions, fresh[0]?.questions ?? []);
      }
    }
    this.busy = false;
    this.fillIndex = -1;
    this.render();
  }

  private async regenAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.captureScroll();
    this.render();
    const fresh = await generateDrafts('quiz', this.drafts.map((d) => ({
      key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text,
    })), this.ask());
    this.busy = false;
    if (this.closed) return;
    this.drafts.forEach((d, i) => {
      d.questions = fresh[i]?.questions ?? [];
    });
    this.touched.clear();
    this.render();
  }

  private captureScroll(): void {
    const list = this.modal.contentEl.querySelector<HTMLElement>('.bzs-review-card-list');
    this.lastScrollTop = list?.scrollTop ?? 0;
  }

  /* ── 入库 ── */

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.captureScroll();
    this.render();
    const payloads = this.drafts.map(toCardPayload);
    try {
      const res = await this.api.addCards(payloads);
      const parts = summaryParts({
        added: res.added,
        exists: res.exists,
        rejected: res.rejected ?? 0,
        failed: 0,
      });
      const text = parts.map((p) => t(p.key as never, p.params)).join('，');
      notify(text, res.added ? 'success' : 'info');
      /* 入库后回调（给划选的文字补一条划线 / 记下这条线已在复习里） */
      this.closed = true;
      try {
        this.hooks.onAdded?.(res);
      } catch {
        /* 补划线失败不该回滚已经进计划的卡：卡在，只是书页上少一道痕 */
      }
      this.modal.close();
    } catch (e) {
      notify(t('review.addFailed', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
      this.busy = false;
      this.render();
    }
  }
}

/* ── 小工具 ── */

function el_div(): HTMLElement {
  return createDiv();
}
function stateLabel(s: string): string {
  return s === 'exists' ? t('review.state.exists') : s === 'over' ? t('review.state.over') : t('review.state.new');
}
function stateStyle(s: string): Record<string, string> {
  if (s === 'exists') return { background: 'var(--background-modifier-hover)', color: 'var(--text-muted)' };
  if (s === 'over') return { background: 'var(--text-error)', color: 'var(--text-on-accent)' };
  return { background: 'var(--interactive-accent)', color: 'var(--text-on-accent)' };
}
/** 选项序号：A B C D…，超过 26 个（不该出现）退回数字 */
function optionKey(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}
