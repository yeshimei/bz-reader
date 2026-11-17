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
  estimateSendChars,
  markCardStates,
  mergeDraftQuestions,
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

function modeName(m: ReviewMode): string {
  return t(m === 'plain' ? 'review.mode.plain' : m === 'flashcard' ? 'review.mode.flashcard' : 'review.mode.quiz');
}
function modeDesc(m: ReviewMode): string {
  return t(
    m === 'plain' ? 'review.mode.plain.desc' : m === 'flashcard' ? 'review.mode.flashcard.desc' : 'review.mode.quiz.desc',
  );
}

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
    this.modal.titleEl.setText(t('review.mode.title'));
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
    el.empty();
    if (this.step === 'mode') this.renderMode(el);
    else this.renderEdit(el);
  }

  /* ── 第一步：三选一 ── */

  private renderMode(el: HTMLElement): void {
    const lead = el.createEl('p', { text: t('review.make.lead') });
    lead.setCssProps({ color: 'var(--text-muted)', margin: '0 0 10px' });

    const list = el.createDiv();
    list.setCssProps({ display: 'flex', flexDirection: 'column', gap: '6px' });
    for (const m of MODES) {
      const card = list.createDiv();
      card.className = 'bzs-review-mode';
      const on = this.mode === m;
      card.setCssProps({
        border: '1px solid var(--background-modifier-border)',
        borderRadius: '8px',
        padding: '8px 10px',
        cursor: 'pointer',
        ...(on ? { background: 'var(--interactive-accent)', color: 'var(--text-on-accent)' } : {}),
      });
      const head = card.createDiv();
      head.setCssProps({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' });
      head.createSpan({ text: modeName(m) }).setCssProps({ fontWeight: '600' });
      const chars = estimateSendChars(m, this.sources);
      head.createSpan({
        text: chars ? t('review.mode.estChars', { chars: fmt(chars) }) : t('review.mode.noAI'),
      }).setCssProps({ fontSize: '0.85em' });
      const desc = card.createDiv({ text: modeDesc(m) });
      desc.setCssProps({ fontSize: '0.9em', marginTop: '2px', opacity: '0.85' });
      card.addEventListener('click', () => {
        if (this.mode === m) return;
        this.mode = m;
        getShellSource()?.setSettings({ reviewLastMode: m });
        this.render();
      });
    }

    const row = el.createDiv({ cls: 'modal-button-container' });
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
    lead.setCssProps({ color: 'var(--text-muted)', margin: '0 0 8px' });

    const list = el.createDiv();
    list.setCssProps({ maxHeight: '52vh', overflowY: 'auto', marginBottom: '10px' });
    this.drafts.forEach((d, i) => list.appendChild(this.renderCard(d, i)));

    /* 批量做题：全部补齐 / 全部重新生成 */
    if (this.drafts.length > 1 && this.mode === 'quiz') {
      const bar = el.createDiv();
      bar.setCssProps({ display: 'flex', gap: '8px', marginBottom: '8px' });
      bar.createEl('button', { text: t('review.make.fillAll') }).addEventListener('click', () => void this.fillAll());
      bar.createEl('button', { text: t('review.make.regenAll') }).addEventListener('click', () => void this.regenAll());
    }

    const row = el.createDiv({ cls: 'modal-button-container' });
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
    box.setCssProps({ border: '1px solid var(--background-modifier-border)', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' });

    const head = box.createDiv();
    head.setCssProps({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' });
    head.createSpan({ text: `${i + 1}. ${d.chapterTitle || d.bookTitle}` }).setCssProps({ fontWeight: '600' });
    const state = this.states[i] ?? 'new';
    const tag = head.createSpan({ text: stateLabel(state) });
    tag.setCssProps({ fontSize: '0.8em', padding: '1px 6px', borderRadius: '10px', ...stateStyle(state) });

    const src = box.createEl('p', { text: d.text });
    src.setCssProps({ fontSize: '0.85em', color: 'var(--text-muted)', margin: '0 0 6px' });

    if (d.mode === 'plain') {
      /* 全文回忆：题面就是原文，无需编辑 */
      return box;
    }

    if (d.mode === 'flashcard') {
      const input = box.createEl('input');
      input.type = 'text';
      input.value = d.front;
      input.placeholder = t('review.make.front');
      input.setCssProps({ width: '100%', marginBottom: '4px' });
      input.addEventListener('input', () => { d.front = input.value; });
      const back = box.createDiv({ text: `${t('review.make.back')}：${d.back}` });
      back.setCssProps({ fontSize: '0.85em', color: 'var(--text-muted)', marginBottom: '6px' });
      box.createEl('button', { text: t('review.make.regenerate') }).addEventListener('click', () => void this.regenOne(i));
      return box;
    }

    /* quiz：逐题列出，可删、可改题干、可补齐 */
    const qs = box.createDiv();
    if (!d.questions.length) {
      const empty = qs.createEl('p', { text: t('review.make.emptyQuiz') });
      empty.setCssProps({ fontSize: '0.85em', color: 'var(--text-error)' });
    }
    d.questions.forEach((q, qi) => {
      qs.appendChild(this.renderQuestion(d, qi, q));
    });
    const bar = box.createDiv();
    bar.setCssProps({ display: 'flex', gap: '6px', marginTop: '4px' });
    bar.createEl('button', { text: t('review.make.addQuestion') }).addEventListener('click', () => void this.fillOne(i));
    bar.createEl('button', { text: t('review.make.regenerate') }).addEventListener('click', () => void this.regenOne(i));
    return box;
  }

  private renderQuestion(d: DraftCard, qi: number, q: DraftQuestion): HTMLElement {
    const row = el_div();
    row.setCssProps({ borderTop: '1px solid var(--background-modifier-border)', padding: '6px 0' });
    const input = row.createEl('input');
    input.type = 'text';
    input.value = q.q;
    input.setCssProps({ width: '100%', marginBottom: '4px' });
    input.addEventListener('input', () => { q.q = input.value; });
    const opt = row.createDiv({ text: q.options.map((o, oi) => `${q.correct.includes(oi) ? '✓' : '○'}${o}`).join('   ') });
    opt.setCssProps({ fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' });
    const del = row.createEl('button', { text: t('review.make.delQuestion'), cls: 'mod-warning' });
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
function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US');
}
function stateLabel(s: string): string {
  return s === 'exists' ? t('review.state.exists') : s === 'over' ? t('review.state.over') : t('review.state.new');
}
function stateStyle(s: string): Record<string, string> {
  if (s === 'exists') return { background: 'var(--background-modifier-hover)', color: 'var(--text-muted)' };
  if (s === 'over') return { background: 'var(--text-error)', color: 'var(--text-on-accent)' };
  return { background: 'var(--interactive-accent)', color: 'var(--text-on-accent)' };
}
