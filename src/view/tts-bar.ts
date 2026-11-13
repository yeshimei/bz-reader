/* ============================================================
 * bz-reader · 朗读控制条（view/tts-bar.ts）
 *
 * 一个纯函数：状态 → HTML。事件由阅读视图在 rootEl 上委托，
 * 这里不碰 DOM、不碰播放器。
 *
 * 为什么要有这条：以前朗读只有一颗头栏开关，念到哪、念的是旁白还是
 * 对白、这一页花了多少钱，全看不见。听书时用户最常做的三件事是
 * 暂停、跳过这一段、确认还要不要继续花钱——都得有地方点。
 * ============================================================ */

import { t } from '../i18n';
import type { ScriptKind } from '../core/tts-script';

export interface TtsBarState {
  /** 当前是否在出声（loading 也算，按钮显示暂停） */
  active: boolean;
  paused: boolean;
  index: number;
  total: number;
  kind: ScriptKind;
  /** 当前段开头几个字，认位置用 */
  snippet: string;
  chars: number;
  cost: number;
}

export function ttsBarHtml(s: TtsBarState): string {
  const kind = s.kind === 'dialogue' ? t('tts.bar.dialogue') : t('tts.bar.narration');
  const cost = s.cost >= 0.01 ? s.cost.toFixed(2) : s.cost.toFixed(3);
  const playLabel = s.paused ? t('tts.bar.resume') : t('tts.bar.pause');
  return `<div class="bzr-ttsbar" data-role="ttsbar">
    <div class="bzr-ttsbar-head">
      <span class="bzr-ttsbar-kind is-${s.kind}">${kind}</span>
      <span class="bzr-ttsbar-pos">${Math.min(s.index + 1, s.total)}/${s.total}</span>
      <span class="bzr-ttsbar-cost" title="${t('notice.tts.cost', { chars: String(s.chars), cost })}">${t(
        'tts.bar.cost',
        { cost },
      )}</span>
    </div>
    <div class="bzr-ttsbar-text">${escapeHtml(s.snippet)}</div>
    <div class="bzr-ttsbar-btns">
      <button class="bzr-ttsbtn" data-act="ttsprev" title="${t('tts.bar.prev')}" aria-label="${t('tts.bar.prev')}">⏮</button>
      <button class="bzr-ttsbtn is-main" data-act="ttstoggle" title="${playLabel}" aria-label="${playLabel}">${
        s.paused ? '▶' : '⏸'
      }</button>
      <button class="bzr-ttsbtn" data-act="ttsstop" title="${t('tts.bar.stop')}" aria-label="${t('tts.bar.stop')}">■</button>
      <button class="bzr-ttsbtn" data-act="ttsnext" title="${t('tts.bar.next')}" aria-label="${t('tts.bar.next')}">⏭</button>
      <button class="bzr-ttsbtn is-minor" data-act="ttsprefetch" title="${t('tts.bar.prefetch')}" aria-label="${t(
        'tts.bar.prefetch',
      )}">⤓</button>
      <button class="bzr-ttsbtn is-minor" data-act="ttsexport" title="${t('tts.bar.export')}" aria-label="${t(
        'tts.bar.export',
      )}">⭳</button>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
