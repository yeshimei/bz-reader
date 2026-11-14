/* ============================================================
 * bz-reader · 朗读控制条（view/tts-bar.ts）
 *
 * 一个纯函数：状态 → HTML。事件由阅读视图在 rootEl 上委托，
 * 图标由阅读视图用 Obsidian 的 `setIcon` 填（`data-icon` 占位）——
 * 这里不 import obsidian，测试里也就能直接比字符串。
 *
 * 2026-11-14 收敛入口：常驻只留「上一段 / 播放暂停 / 下一段 / 停止」，
 * 预生成、导出、朗读设置收进「更多」。听书时眼睛不在屏幕上，一排按钮
 * 铺七八个，每个都变小、每个都难点。左边再加一个来源徽标（缓存 / 离线 /
 * 实时），让用户知道这段声音是存的还是刚合的。
 * ============================================================ */

import { t } from '../i18n';

export interface TtsBarState {
  /** 暂停中：主按钮换成「继续」的播放图标 */
  paused: boolean;
  /**
   * 正在等音频（首次开声，或缓冲被念空）。
   *
   * 本地模型一句要合 3–8 秒，这段时间如果主按钮还画着「暂停」，用户会
   * 以为点了没反应、或者已经在播了。转圈 + 点一下就停，比一个死按钮诚实。
   */
  loading?: boolean;
  /** 「更多」展开中 */
  more?: boolean;
  /**
   * 音频来源说明，比如「缓存 12 · 实时 3」「离线」。
   *
   * 一章里可能一半命中缓存、一半现合，所以这里是一句话而不是一个枚举。
   * 空串 = 还不知道（刚点开），整块不画，别留一个空壳占位置。
   */
  source?: string;
}

/** 已经听过的音频来源统计 */
export interface TtsSourceCount {
  cached: number;
  live: number;
  offline: number;
}

/**
 * 来源徽标文案。
 *
 * 一章里可能一半命中本机缓存、一半现合成，所以不是一个词而是一句短语；
 * 离线包播放时整章都来自包，直接说「离线」——两种来源不会同时成立。
 */
export function ttsSourceLabel(c: TtsSourceCount): string {
  if (c.offline > 0) return t('tts.src.offline');
  const parts: string[] = [];
  if (c.cached > 0) parts.push(t('tts.src.cached', { n: String(c.cached) }));
  if (c.live > 0) parts.push(t('tts.src.live', { n: String(c.live) }));
  return parts.join(' · ');
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
  tune: 'sliders-horizontal',
  more: 'more-horizontal',
} as const;

export function ttsBarHtml(s: TtsBarState): string {
  const playLabel = s.paused ? t('tts.bar.resume') : t('tts.bar.pause');
  const prev = t('tts.bar.prev');
  const stop = t('tts.bar.stop');
  const next = t('tts.bar.next');
  const prefetch = t('tts.bar.prefetch');
  const exp = t('tts.bar.export');
  const tune = t('tts.bar.tune');
  const more = t('tts.bar.more');
  const main = s.loading
    ? `<button class="bzr-ttsbtn is-main is-loading" data-act="ttstoggle" title="${escapeHtml(
        t('tts.bar.loading'),
      )}" aria-label="${escapeHtml(t('tts.bar.loading'))}" aria-busy="true"><span class="bzr-ttsspin"></span></button>`
    : button('ttstoggle', s.paused ? ICONS.play : ICONS.pause, playLabel, ' is-main');
  const src = String(s.source ?? '').trim();
  return `<div class="bzr-ttsbar" data-role="ttsbar">
    ${src ? `<span class="bzr-ttssrc" title="${escapeHtml(src)}">${escapeHtml(src)}</span>` : ''}
    ${button('ttsprev', ICONS.prev, prev)}
    ${main}
    ${button('ttsnext', ICONS.next, next)}
    ${button('ttsstop', ICONS.stop, stop)}
    ${button('ttsmore', ICONS.more, more, ` is-minor${s.more ? ' is-on' : ''}`)}
  </div>
  <div class="bzr-ttsmore" data-role="ttsmore"${s.more ? '' : ' hidden'}>
    ${button('ttsprefetch', ICONS.prefetch, prefetch, ' is-minor')}
    ${button('ttsexport', ICONS.export, exp, ' is-minor')}
    ${button('ttstune', ICONS.tune, tune, ' is-minor')}
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
