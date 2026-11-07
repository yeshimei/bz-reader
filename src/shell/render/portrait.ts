/* ============================================================
 * bz-reader · 全书画像的界面片段（shell/render/portrait.ts）
 *
 * 准备 / 进行中 / 完成，三种状态各一块。放在这里而不是 overlay.ts：
 * 这三块的字都很密（两种方案的做法、好处、代价、适合），塞进那个已经
 * 一千多行的文件里就再也找不着了。这里只出 HTML，动作由 actions 接。
 *
 * 一条硬规矩：**准备页要把代价写在按钮上面**。用户按下「开始」之前
 * 必须知道大概几次请求、花谁的钱；按完再说就是事后通知。
 * ============================================================ */
import { t, type MsgKey } from '../../i18n';
import { esc } from './html';
import { estimateOf, type BuildProgress } from '../../data/portrait-build';
import {
  chapterDigests,
  estimateRequests,
  portraitState,
  type PortraitFile,
  type PortraitPlan,
} from '../../data/portrait';

export interface PortraitView {
  /** 手机上不建画像，只提示去电脑上建 */
  mobile: boolean;
  /** 当前选中（还没开始跑）的方案 */
  chosen: PortraitPlan;
  /** 正文体积（预估值用） */
  chars: number;
  bookTitle: string;
  progress: BuildProgress;
  /** 已建好的画像（完成页与详情页读它） */
  portrait: PortraitFile | null;
  /** 当前嵌入模型名（判断「需要重建」） */
  model: string;
}

interface PlanKeys {
  name: MsgKey;
  how: MsgKey;
  good: MsgKey;
  cost: MsgKey;
  fit: MsgKey;
  est: MsgKey;
}

const PLAN_KEYS: Record<PortraitPlan, PlanKeys> = {
  vector: {
    name: 'pt.plan.vector',
    how: 'pt.vector.how',
    good: 'pt.vector.good',
    cost: 'pt.vector.cost',
    fit: 'pt.vector.fit',
    est: 'pt.estimate.vector',
  },
  compress: {
    name: 'pt.plan.compress',
    how: 'pt.compress.how',
    good: 'pt.compress.good',
    cost: 'pt.compress.cost',
    fit: 'pt.compress.fit',
    est: 'pt.estimate.compress',
  },
};

/** 块数：切完块就用真实值，没切之前按字数估（界面上一律写「约」） */
export function portraitEstimate(chars: number, plan: PortraitPlan, total = 0): { blocks: number; requests: number } {
  if (total > 0) return { blocks: total, requests: estimateRequests(total, plan) };
  return estimateOf(chars, plan);
}

function planCard(plan: PortraitPlan, v: PortraitView): string {
  const keys = PLAN_KEYS[plan];
  const on = v.chosen === plan;
  const running = v.progress.status !== 'idle' && v.progress.total > 0;
  const est = portraitEstimate(v.chars, plan, running ? v.progress.total : 0);
  return `<button type="button" class="bzs-pt-plan${on ? ' on' : ''}" data-act="ptplan" data-v="${plan}" aria-pressed="${on}">
      <b>${esc(t(keys.name))}</b>
      <dl>
        <dt>${esc(t('pt.how'))}</dt><dd>${esc(t(keys.how))}</dd>
        <dt>${esc(t('pt.good'))}</dt><dd>${esc(t(keys.good))}</dd>
        <dt>${esc(t('pt.cost'))}</dt><dd>${esc(t(keys.cost))}</dd>
        <dt>${esc(t('pt.fit'))}</dt><dd>${esc(t(keys.fit))}</dd>
      </dl>
      <span class="est">${esc(t(keys.est, { blocks: est.blocks, requests: est.requests }))}</span>
    </button>`;
}

function prepareBody(v: PortraitView): string {
  /* 已经建过却还看到准备页，得说清为什么（换了嵌入模型，向量对不上）。
     不说的话，用户会以为「我明明建过」——然后不敢点。 */
  const stale = portraitState(v.portrait, v.model) === 'stale';
  return `<div class="bzs-pt">
      <div class="bzs-pt-lead">${esc(t('pt.choose'))}</div>
      ${stale ? `<div class="bzs-mini is-bad" style="margin:-4px 0 8px;line-height:1.8">${esc(t('side.ai.book.stale'))}</div>` : ''}
      <div class="bzs-pt-plans">${planCard('vector', v)}${planCard('compress', v)}</div>
    </div>`;
}

function runBody(v: PortraitView): string {
  const p = v.progress;
  const extracting = p.phase === 'extract' || p.status === 'extract';
  const line = extracting
    ? t('pt.extract', { done: p.extractDone, total: p.extractTotal })
    : p.total
      ? t('pt.block', { done: p.done, total: p.total })
      : t('pt.extract', { done: 0, total: 0 });
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 4;
  const note = p.failed ? t('pt.failedBlocks', { n: p.failed }) : p.status === 'paused' ? t('pt.pause') : '';
  return `<div class="bzs-pt-run" data-role="pt-run">
      <div class="line">${esc(line)}</div>
      <div class="bzs-pt-bar"><i style="width:${pct}%"></i></div>
      <div class="bzs-mini">${esc(note)}</div>
      ${p.message ? `<div class="bzs-mini is-bad">${esc(p.message)}</div>` : ''}
    </div>`;
}

function doneBody(v: PortraitView): string {
  const p = v.progress;
  const portrait = v.portrait;
  const blocks = portrait?.blocks.length ?? p.total;
  const seconds = Math.max(0, Math.round(p.elapsedMs / 1000));
  const time = seconds >= 60 ? `${Math.round(seconds / 60)} 分` : `${seconds} 秒`;
  const model = portrait?.model || v.model || '—';
  const digests = portrait && portrait.plan === 'compress' ? chapterDigests(portrait).slice(0, 3) : [];
  return `<div class="bzs-pt-done">
      <b>${esc(t('pt.done'))}</b>
      <div class="bzs-mini">${esc(t('pt.meta', { blocks, time, failed: p.failed, model }))}</div>
      ${
        digests.length
          ? `<ul class="bzs-pt-preview">${digests
              .map((d) => `<li><em>${esc(d.chapter)}</em>${esc(d.line)}</li>`)
              .join('')}</ul>`
          : ''
      }
    </div>`;
}

/** 手机端：不建、只说 */
function mobileBody(): string {
  return `<div class="bzs-pt"><div class="bzs-pt-lead">${esc(t('pt.mobile'))}</div></div>`;
}

export type PortraitStage = 'prepare' | 'run' | 'done' | 'mobile';

export function portraitStage(v: PortraitView): PortraitStage {
  if (v.mobile && v.progress.status !== 'done') return 'mobile';
  if (v.progress.status === 'done') return 'done';
  if (v.progress.status === 'extract' || v.progress.status === 'running' || v.progress.status === 'paused') return 'run';
  /* error：有块就还停在进度上（能重试），一块都没有就退回准备页 */
  if (v.progress.status === 'error' && v.progress.total > 0) return 'run';
  return 'prepare';
}

/** 弹层正文（外层容器由 overlay 包，这块只替换 [data-role="portrait-body"] 里的内容） */
export function portraitBody(v: PortraitView): string {
  switch (portraitStage(v)) {
    case 'mobile':
      return mobileBody();
    case 'run':
      return runBody(v);
    case 'done':
      return doneBody(v);
    default:
      return prepareBody(v);
  }
}

/** 底部按钮：同一时刻只出一条主路径，互斥的动作不并列 */
export function portraitFoot(v: PortraitView): string {
  const stage = portraitStage(v);
  if (stage === 'mobile') return `<button class="bzs-btn pri" data-act="ptclose">${esc(t('pt.close'))}</button>`;
  if (stage === 'prepare') {
    return `<button class="bzs-btn" data-act="ptclose">${esc(t('pt.close'))}</button>
      <button class="bzs-btn pri" data-act="ptstart">${esc(t('pt.start'))}</button>`;
  }
  if (stage === 'run') {
    const paused = v.progress.status === 'paused';
    return `<button class="bzs-btn" data-act="ptstop">${esc(t('pt.stop'))}</button>
      <button class="bzs-btn pri" data-act="${paused ? 'ptresume' : 'ptpause'}">${esc(
        paused ? t('pt.resume') : t('pt.pause'),
      )}</button>`;
  }
  const failed = v.progress.failed > 0;
  return `<button class="bzs-btn sm" data-act="ptclose">${esc(t('pt.close'))}</button>
    <button class="bzs-btn sm" data-act="ptrebuild">${esc(t('pt.rebuild'))}</button>
    <button class="bzs-btn sm" data-act="ptnote">${esc(t('pt.saveNote'))}</button>
    ${failed ? `<button class="bzs-btn sm" data-act="ptretry">${esc(t('pt.retryFailed'))}</button>` : ''}
    <button class="bzs-btn pri" data-act="ptask">${esc(t('pt.ask'))}</button>`;
}

/** 详情页那一行：已建 / 未建 / 建到一半 / 需要重建 */
export function portraitStatusLine(portrait: PortraitFile | null, model: string, building = false): string {
  if (building) return t('detail.portrait.building');
  if (!portrait) return t('detail.portrait.none');
  if (!portrait.done) return t('detail.portrait.building');
  if (portrait.plan === 'vector' && portrait.model && model && portrait.model !== model) {
    return t('detail.portrait.stale');
  }
  return t('detail.portrait.ready');
}

/**
 * 「存为笔记」的正文。
 *
 * 只写人看得懂的那部分：方案、模型、块数、总述、每章一句话。
 * 向量不进笔记——那串 base64 对读者没有任何意义，它的归宿是画像文件。
 */
export function portraitNoteMarkdown(p: PortraitFile): string {
  const when = new Date(p.updatedAt || Date.now());
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  const plan = p.plan === 'vector' ? t('pt.plan.vector') : t('pt.plan.compress');
  const lines = [
    `# ${p.bookTitle || t('common.untitled')}`,
    '',
    `- ${plan}`,
    `- ${p.model || '—'} · ${t('pt.blockCount', { n: p.blocks.length })}`,
    `- ${date}`,
    '',
  ];
  const overview = (p.overview || '').trim();
  if (overview) lines.push(`## ${t('pt.overviewLabel')}`, '', overview, '');
  const digests = chapterDigests(p);
  if (digests.length) {
    lines.push(`## ${t('bookmap.digestLabel')}`, '');
    for (const d of digests) lines.push(`### ${d.chapter}`, '', d.line, '');
  }
  if (p.plan === 'vector') {
    lines.push(`> ${t('pt.vector.how')}`, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
