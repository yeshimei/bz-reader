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
 * ============================================================ */
import { Modal, type App } from 'obsidian';
import { t } from '../i18n';
import { notify, notifyProgress } from '../core/notice';
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
  type ReviewApi,
  type ReviewQuota,
} from '../data/review-bridge';
import { getShellSource, shellSettings } from './source';

const MODES: readonly ReviewMode[] = ['plain', 'flashcard', 'quiz'];

/** 打开三选一制卡界面。sources 为待制卡的原文（一条就是一张卡）。 */
export function openCardsFlow(app: App | undefined, sources: CardSource[]): void {
  if (!app || !sources.length) return;
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  new CardsFlow(app, api, sources, shellSettings()).open();
}

class CardsFlow {
  private app: App;
  private api: ReviewApi;
  private settings: ReaderSettings;
  private sources: CardSource[];
  private modal: Modal;

  private step: 'mode' | 'edit' = 'mode';
  private mode: ReviewMode;
  private drafts: DraftCard[] = [];
  private states: string[] = [];
  private busy = false;
  private existing = new Set<string>();
  private quota: ReviewQuota = { used: 0, limit: 0, remaining: Infinity, full: false };

  constructor(app: App, api: ReviewApi, sources: CardSource[], settings: ReaderSettings) {
    this.app = app;
    this.api = api;
    this.settings = settings;
    this.sources = sources;
    const last = settings.reviewLastMode;
    this.mode = last === 'plain' || last === 'flashcard' || last === 'quiz' ? last : 'flashcard';
    this.modal = new Modal(app);
  }

  open(): void {
    this.modal.onClose = () => this.modal.contentEl.empty();
    /* 额度与现状是只读查询，失败就按「不标记」处理，不该拦住制卡。 */
    void this.loadStatus();
    this.render();
    this.modal.open();
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
    if (this.step === 'edit') this.render();
  }

  private render(): void {
    const el = this.modal.contentEl;
    /* 标题跟着步骤走：第二步别再顶着「选一种复习方式」，那是上一步的事。 */
    this.modal.titleEl.setText(t(this.step === 'mode' ? 'review.mode.title' : 'review.make.title'));
    el.empty();
    if (this.step === 'mode') this.renderMode(el);
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

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const cancel = row.createEl('button', { text: t('common.cancel') });
    cancel.addEventListener('click', () => this.modal.close());
    const next = row.createEl('button', { text: t('review.next'), cls: 'mod-cta' });
    next.disabled = this.busy;
    next.addEventListener('click', () => void this.toEdit());
  }

  /* ── 生成题面 ── */

  private async toEdit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const progress = notifyProgress(t('review.make.generating', { done: '0', total: String(this.sources.length) }));
    const ask = async (prompt: string): Promise<string> => aiPostChat(this.settings, [{ role: 'user', content: prompt }], {});
    let done = 0;
    try {
      this.drafts = await generateDrafts(this.mode, this.sources, async (p) => {
        done += 1;
        progress.setMessage(t('review.make.generating', { done: String(done), total: String(this.sources.length) }));
        return ask(p);
      });
    } finally {
      progress.hide();
      this.busy = false;
    }
    this.states = markCardStates(
      this.drafts.map((d) => d.key),
      this.existing,
      this.quota.remaining,
    );
    this.step = 'edit';
    this.render();
  }

  /* ── 第二步：改题面 + 确认 ── */

  private renderEdit(el: HTMLElement): void {
    const lead = el.createEl('p', { text: t('review.make.lead') });
    lead.className = 'bzs-review-mode-lead';

    const list = el.createDiv({ cls: 'bzs-review-card-list' });
    this.drafts.forEach((d, i) => list.appendChild(this.renderCard(d, i)));

    /* 批量做题：全部补齐 / 全部重新生成 */
    if (this.drafts.length > 1 && this.mode === 'quiz') {
      const bar = el.createDiv({ cls: 'bzs-review-bulk' });
      bar.createEl('button', { text: t('review.make.fillAll') }).addEventListener('click', () => void this.fillAll());
      bar.createEl('button', { text: t('review.make.regenAll') }).addEventListener('click', () => void this.regenAll());
    }

    const row = el.createDiv({ cls: 'bzs-review-actions' });
    const back = row.createEl('button', { text: t('review.back') });
    back.addEventListener('click', () => {
      this.step = 'mode';
      this.render();
    });
    const n = this.drafts.length;
    const confirm = row.createEl('button', { text: t('review.confirmAdd', { n: String(n) }), cls: 'mod-cta' });
    confirm.disabled = this.busy || !n;
    confirm.addEventListener('click', () => void this.submit());
  }

  private renderCard(d: DraftCard, i: number): HTMLElement {
    const box = el_div();
    box.className = 'bzs-review-card';

    const head = box.createDiv({ cls: 'bzs-review-card-head' });
    head.createSpan({ cls: 'bzs-review-card-title', text: `${i + 1}. ${d.chapterTitle || d.bookTitle}` });
    const state = this.states[i] ?? 'new';
    const tag = head.createSpan({ cls: 'bzs-review-card-state', text: stateLabel(state) });
    tag.setCssProps(stateStyle(state));

    const view = confirmCardView(d);
    if (view.showSource) {
      /* 全文回忆的题面就是原文；其余方式别在这里再贴一遍。 */
      const src = box.createEl('p', { cls: 'bzs-review-card-source', text: d.text });
      void src;
    }

    if (d.mode === 'flashcard') {
      const field = box.createDiv({ cls: 'bzs-review-card-field' });
      field.createSpan({ cls: 'bzs-review-card-label', text: t('review.make.front') });
      const input = field.createEl('input', { cls: 'bzs-review-input' });
      input.type = 'text';
      input.value = d.front;
      input.placeholder = t('review.make.front');
      input.addEventListener('input', () => { d.front = input.value; });
      if (view.showBack) {
        const back = box.createDiv({ cls: 'bzs-review-card-back' });
        back.createSpan({ cls: 'bzs-review-card-label', text: t('review.make.back') });
        back.createDiv({ text: d.back });
      }
      box.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.regenerate') })
        .addEventListener('click', () => void this.regenOne(i));
      return box;
    }

    if (d.mode === 'quiz') {
      const qs = box.createDiv({ cls: 'bzs-review-q-list' });
      if (!d.questions.length) {
        qs.createEl('p', { cls: 'bzs-review-card-empty', text: t('review.make.emptyQuiz') });
      }
      d.questions.forEach((q, qi) => qs.appendChild(this.renderQuestion(d, qi, q)));
      const bar = box.createDiv({ cls: 'bzs-review-mini-row' });
      bar.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.addQuestion') })
        .addEventListener('click', () => void this.fillOne(i));
      bar.createEl('button', { cls: 'bzs-review-mini-btn', text: t('review.make.regenerate') })
        .addEventListener('click', () => void this.regenOne(i));
      return box;
    }

    return box;
  }

  private renderQuestion(d: DraftCard, qi: number, q: DraftQuestion): HTMLElement {
    const row = el_div();
    row.className = 'bzs-review-q';
    const input = row.createEl('input', { cls: 'bzs-review-input' });
    input.type = 'text';
    input.value = q.q;
    input.addEventListener('input', () => { q.q = input.value; });
    const opt = row.createDiv({ cls: 'bzs-review-q-opts', text: q.options.map((o, oi) => `${q.correct.includes(oi) ? '✓' : '○'}${o}`).join('   ') });
    void opt;
    const del = row.createEl('button', { cls: 'mod-warning bzs-review-mini-btn', text: t('review.make.delQuestion') });
    del.addEventListener('click', () => {
      d.questions.splice(qi, 1);
      this.render();
    });
    return row;
  }

  /* ── 批量操作 ── */

  private ask(): (p: string) => Promise<string> {
    return (p) => aiPostChat(this.settings, [{ role: 'user', content: p }], {});
  }

  private async regenOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    const fresh = await generateDrafts(d.mode, [
      { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text, comment: d.comment },
    ], this.ask());
    const nd = fresh[0];
    if (nd) {
      d.front = nd.front;
      d.back = nd.back;
      d.questions = nd.questions;
    }
    this.busy = false;
    this.render();
  }

  private async fillOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    /* 补一道：让 AI 出三道，按题面去重后追加，已有的不重复 */
    const fresh = await generateDrafts('quiz', [
      { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text },
    ], this.ask());
    d.questions = mergeDraftQuestions(d.questions, fresh[0]?.questions ?? []);
    this.busy = false;
    this.render();
  }

  private async fillAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    for (const d of this.drafts) {
      if (!d.questions.length) {
        const fresh = await generateDrafts('quiz', [
          { key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text },
        ], this.ask());
        d.questions = mergeDraftQuestions(d.questions, fresh[0]?.questions ?? []);
      }
    }
    this.busy = false;
    this.render();
  }

  private async regenAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const fresh = await generateDrafts('quiz', this.drafts.map((d) => ({
      key: d.key, bookTitle: d.bookTitle, chapterTitle: d.chapterTitle, text: d.text,
    })), this.ask());
    this.drafts.forEach((d, i) => {
      d.questions = fresh[i]?.questions ?? [];
    });
    this.busy = false;
    this.render();
  }

  /* ── 入库 ── */

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
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
