/* ============================================================
 * bz-reader · 扫描页识别的控制条（view/ocr-bar.ts）
 *
 * 和朗读条同一个位置、同一个理由：识别一页要几秒、一批要几分钟，
 * 右上角的通知只能说一句「正在识别」，说不出「认到第几页、这批多少页、
 * 卡住没有、能不能停」。条子浮在正文底部，眼睛不用离开页面。
 *
 * 纯函数：状态 → HTML。事件由阅读视图在根节点上委托（data-act），
 * 图标交给 Obsidian 的 setIcon 填（data-icon 占位）——
 * 这里不 import obsidian，测试里也就能直接比字符串。
 * ============================================================ */

import { t } from '../i18n';

/** 条子现在要说什么。终态只有一次，不会自己变回运行态 */
export type OcrBarStage =
  /** 正在跑：页号是「正在认哪一页」，done/total 是这一批的进度 */
  | { kind: 'running'; page: number; done: number; total: number }
  /** 单页认完：layout=false 表示只回了文字，没给行位置 */
  | { kind: 'page'; page: number; layout: boolean; empty?: boolean }
  /** 单页没认成 */
  | { kind: 'page-failed'; page: number }
  /** 一批跑完：failed 是没成功的页号 */
  | { kind: 'batch'; pages: number; failed: readonly number[] }
  /** 用户手动停的 */
  | { kind: 'stopped'; pages: number; failed: readonly number[] };

export interface OcrBarInput {
  stage: OcrBarStage;
  /** 这本书已经认过几页 / 共几页；给了才显示「已认 12/278」 */
  recognized?: number;
  totalPages?: number;
  /** 这次走的通道：本地服务 / DeepSeek 看图。只在运行态标出来 */
  engine?: 'http' | 'deepseek';
  /** 失败原因（长文本），只进 title，条上仍说短句 */
  why?: string;
}

const ICONS = {
  stop: 'square',
  close: 'x',
  retry: 'rotate-ccw',
} as const;

/** 失败页最多列几个：再长就把条子撑开了，剩下的用「等」 */
const MAX_PAGES = 6;

/**
 * 进度百分比。
 *
 * 总量未知（0）时给 0 而不是满格：满格会让「刚开始」看起来像「已完成」。
 */
export function ocrBarProgress(done: number, total: number): number {
  const all = Math.floor(Number(total) || 0);
  if (all <= 0) return 0;
  const n = Math.floor(Number(done) || 0);
  return Math.min(100, Math.max(0, Math.round((n / all) * 100)));
}

/**
 * 终态里哪些该自己收掉。
 *
 * 单页认完只是「这一页好了」，用户还要接着读，条子留着挡正文；
 * 失败、批量结束、手动停都有下一步（重试 / 看结果），必须等用户点。
 */
export function ocrBarAutoHide(stage: OcrBarStage): boolean {
  return stage.kind === 'page';
}

export function ocrBarHtml(input: OcrBarInput): string {
  const s = input.stage;
  const pct = s.kind === 'running' ? ocrBarProgress(s.done, s.total) : 100;
  const text = ocrBarText(s);
  const bad = isBad(s);
  const why = String(input.why ?? '').trim();
  const parts: string[] = [];

  if (s.kind === 'running' && input.engine) {
    parts.push(`<span class="bzr-ocrsrc">${escapeHtml(engineLabel(input.engine))}</span>`);
  }
  parts.push(
    `<span class="bzr-ocrtxt${bad ? ' is-err' : ''}"${why ? `` : ''}><span class="bzs-sr-only">${escapeHtml(why)}</span>${escapeHtml(
      text,
    )}</span>`,
  );
  /* 失败原因以前只进 title：手机上没有 hover，等于永远看不见。
     失败 / 手动停这两种终态把它摆成一行短字，长文本由 CSS 截断，完整版仍在 title。 */
  if (why && (bad || s.kind === 'stopped')) {
    parts.push(`<span class="bzr-ocrwhy"><span class="bzs-sr-only">${escapeHtml(why)}</span>${escapeHtml(why)}</span>`);
  }
  if (s.kind === 'running') {
    parts.push(
      `<span class="bzr-ocrprog" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.max(
        0,
        Math.floor(s.total),
      )}" aria-valuenow="${Math.max(0, Math.floor(s.done))}"><i style="width:${pct}%"></i></span>`,
    );
  }
  /* 批量 / 手动停有失败：把页号单独摆出来，能直接翻过去看是哪几页 */
  if ((s.kind === 'batch' || s.kind === 'stopped') && s.failed.length) {
    parts.push(`<span class="bzr-ocrpages">${escapeHtml(ocrBarPages(s.failed))}</span>`);
  }
  const stat = ocrBarStat(input);
  if (stat) parts.push(`<span class="bzr-ocrstat">${escapeHtml(stat)}</span>`);

  if (s.kind === 'running') {
    parts.push(button('ocrstop', ICONS.stop, t('pdf.ocrBar.stop')));
  } else {
    /* 手动停也可能留下失败页：以前停止态不给重试，只能回头栏菜单找 */
    if (
      s.kind === 'page-failed' ||
      (s.kind === 'batch' && s.failed.length) ||
      (s.kind === 'stopped' && s.failed.length)
    ) {
      const n = s.kind === 'page-failed' ? 1 : s.failed.length;
      parts.push(
        button(
          'ocrretry',
          ICONS.retry,
          n > 1 ? t('pdf.ocrBar.retry', { n: String(n) }) : t('pdf.ocrBar.retryOne'),
        ),
      );
    }
    parts.push(button('ocrclose', ICONS.close, t('pdf.ocrBar.close')));
  }

  return `<div class="bzr-ocrbar" data-role="ocrbar" data-stage="${s.kind}" role="status" aria-live="polite">${parts.join(
    '',
  )}</div>`;
}

/** 条子左边那句话 */
export function ocrBarText(s: OcrBarStage): string {
  switch (s.kind) {
    case 'running':
      return t('pdf.ocrBar.running', {
        done: String(s.done),
        total: String(s.total),
        page: String(s.page),
      });
    case 'page':
      if (s.empty) return t('pdf.ocrBar.pageEmpty', { n: String(s.page) });
      if (!s.layout) return t('pdf.ocrBar.pageTextOnly', { n: String(s.page) });
      return t('pdf.ocrBar.pageDone', { n: String(s.page) });
    case 'page-failed':
      return t('pdf.ocrBar.pageFailed', { n: String(s.page) });
    case 'batch':
      if (!s.failed.length) return t('pdf.ocrBar.batchDone', { n: String(s.pages) });
      return t('pdf.ocrBar.batchPartial', {
        done: String(s.pages),
        failed: String(s.failed.length),
      });
    case 'stopped':
      return t('pdf.ocrBar.stopped', { n: String(s.pages) });
  }
}

/** 失败页号那句（批量终态才显示） */
export function ocrBarPages(failed: readonly number[]): string {
  const list = failed.slice(0, MAX_PAGES).join('、');
  if (!list) return '';
  return failed.length > MAX_PAGES
    ? t('pdf.ocrBar.pagesMore', { pages: list, rest: String(failed.length - MAX_PAGES) })
    : t('pdf.ocrBar.pages', { pages: list });
}

function ocrBarStat(input: OcrBarInput): string {
  const done = Number(input.recognized);
  const total = Number(input.totalPages);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return '';
  /* 运行态左边已经有 3/20，再放「已认 12/278」两串数字会看花 */
  if (input.stage.kind === 'running') return '';
  return t('pdf.ocrBar.stat', { done: String(done), total: String(total) });
}

function isBad(s: OcrBarStage): boolean {
  return s.kind === 'page-failed' || (s.kind === 'batch' && s.failed.length > 0);
}

function engineLabel(engine: 'http' | 'deepseek'): string {
  return engine === 'http' ? t('pdf.ocrBar.engine.http') : t('pdf.ocrBar.engine.deepseek');
}

function button(act: string, icon: string, label: string): string {
  const safe = escapeHtml(label);
  return `<button type="button" class="bzr-ocrbtn" data-act="${act}"><span class="bzs-sr-only">${safe}</span><span class="bzr-ocricon" data-icon="${icon}"></span></button>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
