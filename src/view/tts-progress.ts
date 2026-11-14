/* ============================================================
 * bz-reader · 预生成进度卡（view/tts-progress.ts）
 *
 * 一个纯函数：状态 → HTML。事件由阅读视图在卡片上委托，
 * 图标由阅读视图用 Obsidian 的 `setIcon` 填（`data-icon` 占位）——
 * 这里不 import obsidian，测试里也就能直接比字符串。
 *
 * 为什么不再用常驻通知：预生成要跑几分钟到几小时，通知只能改一行字，
 * 说不出「现在处于哪一段、还剩多少、为什么停了」。卡片把三件事分开
 * 摆：阶段名（排队 / 处理中 / 收尾 / 完成）、进度条、剩余量；卡住与
 * 失败各有自己的提示行，不和正常进度混在一句里。
 *
 * 明确不给「大概还要多久」：作者点过名排除时间预估（本地模型快慢
 * 取决于机器，估出来只会更误导），只报还剩多少段、多少章。
 * ============================================================ */

import { t, type MsgKey } from '../i18n';

/** 三种预生成流程共用一张卡，只有标题与结果文案不同 */
export type TtsTaskKind = 'chapter' | 'book' | 'export';

/**
 * 阶段。前三个是进行中，后三个是终态。
 *
 * `pack`（收尾）指拼文件、算时间轴、写库那几步——它们没有段数进度，
 * 但也不能让人看着卡在 100% 不懂在干什么，所以单独一个阶段名。
 */
export type TtsTaskStage = 'queue' | 'synth' | 'pack' | 'done' | 'cancelled' | 'failed';

export interface TtsTaskState {
  kind: TtsTaskKind;
  stage: TtsTaskStage;
  /** 已完成段数 */
  done: number;
  /** 总段数；排队阶段还不知道，给 0 */
  total: number;
  /** 整本才有：当前第几章（1 起） */
  chapter?: number;
  chapters?: number;
  /** 整本才有：已经写进离线包的章数 */
  packed?: number;
  /** 失败原因（已翻译成人话） */
  reason?: string;
  /** 距上次进展多少秒；0 / 省略表示正常 */
  stalled?: number;
  /** 卡得太久：提示升级，停止按钮提成主按钮 */
  longStall?: boolean;
}

const TITLE: Record<TtsTaskKind, MsgKey> = {
  chapter: 'tts.prog.title.chapter',
  book: 'tts.prog.title.book',
  export: 'tts.prog.title.export',
};

const STAGE: Record<TtsTaskStage, MsgKey> = {
  queue: 'tts.prog.stage.queue',
  synth: 'tts.prog.stage.synth',
  pack: 'tts.prog.stage.pack',
  done: 'tts.prog.stage.done',
  cancelled: 'tts.prog.stage.cancelled',
  failed: 'tts.prog.stage.failed',
};

/** 终态：不再有「停止」，改给「关闭」（失败再加「重试」） */
const TERMINAL: readonly TtsTaskStage[] = ['done', 'cancelled', 'failed'];

/**
 * 完成百分比。
 *
 * 完成态直接给 100：跳过几句、或从缓存命中的边界会让 done 差几个数，
 * 那时候还显示 97% 只会让人以为没做完。
 */
export function ttsProgressPercent(s: TtsTaskState): number {
  if (s.stage === 'done') return 100;
  const total = Number(s.total) || 0;
  if (total <= 0) return 0;
  const done = Number(s.done) || 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** 主体说明：随阶段换内容，进行中报剩余量，终态报结果 */
function noteOf(s: TtsTaskState): string {
  const done = Math.max(0, Number(s.done) || 0);
  const total = Math.max(0, Number(s.total) || 0);
  const left = Math.max(0, total - done);
  if (s.stage === 'queue') return t('tts.prog.queue');
  if (s.stage === 'synth') {
    return s.kind === 'book'
      ? t('tts.prog.note.book', {
          chapter: s.chapter ?? 1,
          chapters: s.chapters ?? 1,
          done,
          total,
          left,
        })
      : t('tts.prog.note.chapter', { done, total, left });
  }
  if (s.stage === 'pack') {
    return s.kind === 'book' && s.chapters
      ? t('tts.prog.note.packBook', { chapter: s.chapter ?? 1, chapters: s.chapters })
      : t('tts.prog.note.pack');
  }
  if (s.stage === 'cancelled') return t('tts.prog.cancelled');
  if (s.stage === 'failed') return t('tts.prog.failed', { reason: s.reason || t('notice.tts.failed') });
  /* done */
  if (s.kind === 'book') {
    const packed = Math.max(0, Number(s.packed) || 0);
    return packed > 0 ? t('tts.prog.done.book', { done, packed }) : t('tts.prog.done.bookNoPack', { done });
  }
  if (s.kind === 'export') return t('tts.prog.done.export', { done });
  return t('tts.prog.done.chapter', { total });
}

/** 卡住提示：独立一行，正常时整行不出现（不留空白） */
function hintOf(s: TtsTaskState): string {
  if (s.stage === 'done' || s.stage === 'cancelled') return '';
  if (s.longStall) return t('tts.prog.stalledLong');
  if (s.stalled && s.stalled > 0) return t('tts.prog.stalled', { sec: s.stalled });
  return '';
}

export function ttsProgressHtml(s: TtsTaskState): string {
  const pct = ttsProgressPercent(s);
  const stage = t(STAGE[s.stage] ?? 'tts.prog.stage.synth');
  const title = t(TITLE[s.kind] ?? 'tts.prog.title.chapter');
  const note = noteOf(s);
  const hint = hintOf(s);
  const terminal = TERMINAL.includes(s.stage);
  const long = !!s.longStall;

  const stop = terminal
    ? ''
    : button('progstop', t('tts.prog.stop'), long ? ' is-main' : '');
  const retry = s.stage === 'failed' ? button('progretry', t('tts.prog.retry'), '') : '';
  const close = terminal
    ? `<button class="bzr-ttsprog-x" data-act="progclose" title="${esc(t('tts.prog.close'))}" aria-label="${esc(
        t('tts.prog.close'),
      )}"><span data-icon="x"></span></button>`
    : '';

  return `<div class="bzr-ttsprog is-${s.stage}${long ? ' is-stalled' : ''}" data-role="ttsprog" data-stage="${
    s.stage
  }" data-kind="${s.kind}">
  <div class="bzr-ttsprog-head">
    <span class="bzr-ttsprog-chip">${esc(stage)}</span>
    <span class="bzr-ttsprog-title">${esc(title)}</span>
    <span class="bzr-ttsprog-pct">${pct}%</span>
    ${stop}${retry}${close}
  </div>
  <div class="bzr-ttsprog-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${esc(
    `${stage} ${pct}%`,
  )}"><i style="width:${pct}%"></i></div>
  <div class="bzr-ttsprog-note">${esc(note)}</div>
  ${hint ? `<div class="bzr-ttsprog-hint" role="status">${esc(hint)}</div>` : ''}
</div>`;
}

function button(act: string, label: string, extra = ''): string {
  const safe = esc(label);
  return `<button class="bzr-ttsprog-btn${extra}" data-act="${act}" title="${safe}" aria-label="${safe}">${safe}</button>`;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
