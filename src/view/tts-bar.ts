/* ============================================================
 * bz-reader · 朗读控制条（view/tts-bar.ts）
 *
 * 一个纯函数：状态 → HTML。事件由阅读视图在 rootEl 上委托，
 * 图标由阅读视图用 Obsidian 的 `setIcon` 填（`data-icon` 占位）——
 * 这里不 import obsidian，测试里也就能直接比字符串。
 *
 * 只留一排按钮（2026-11-14 用户要求）：旁白/对白标签、第几段、
 * 预估费用、正在念的那句原文全部去掉。听书时眼睛不在屏幕上，
 * 那些字只会挡住正文；真正要点的只有「暂停、跳段、停止」。
 * ============================================================ */

import { t } from '../i18n';

export interface TtsBarState {
  /** 暂停中：主按钮换成「继续」的播放图标 */
  paused: boolean;
}

/** 图标名都是 Obsidian 自带的 lucide（setIcon 按名取） */
const ICONS = {
  prev: 'skip-back',
  pause: 'pause',
  play: 'play',
  stop: 'square',
  next: 'skip-forward',
  prefetch: 'download',
  export: 'share',
} as const;

export function ttsBarHtml(s: TtsBarState): string {
  const playLabel = s.paused ? t('tts.bar.resume') : t('tts.bar.pause');
  const prev = t('tts.bar.prev');
  const stop = t('tts.bar.stop');
  const next = t('tts.bar.next');
  const prefetch = t('tts.bar.prefetch');
  const exp = t('tts.bar.export');
  return `<div class="bzr-ttsbar" data-role="ttsbar">
    ${button('ttsprev', ICONS.prev, prev)}
    ${button('ttstoggle', s.paused ? ICONS.play : ICONS.pause, playLabel, ' is-main')}
    ${button('ttsstop', ICONS.stop, stop)}
    ${button('ttsnext', ICONS.next, next)}
    ${button('ttsprefetch', ICONS.prefetch, prefetch, ' is-minor')}
    ${button('ttsexport', ICONS.export, exp, ' is-minor')}
  </div>`;
}

function button(act: string, icon: string, label: string, extra = ''): string {
  const safe = escapeHtml(label);
  return `<button class="bzr-ttsbtn${extra}" data-act="${act}" title="${safe}" aria-label="${safe}"><span class="bzr-ttsicon" data-icon="${icon}"></span></button>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
