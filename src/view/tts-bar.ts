/* ============================================================
 * bz-reader · 朗读控制条（view/tts-bar.ts）
 *
 * 一个纯函数：状态 → HTML。事件由阅读视图在 rootEl 上委托，
 * 图标由阅读视图用 Obsidian 的 `setIcon` 填（`data-icon` 占位）——
 * 这里不 import obsidian，测试里也就能直接比字符串。
 *
 * 2026-11-14 收敛成「更多」之后，用户要求再摊开：听书时最常见的
 * 音色、生成本章、导出、设置各占一颗，藏进二级菜单等于每次多点一下。
 * 现在是一排平铺、不折叠，窄窗口整条左右滑（CSS 负责）。
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
  /**
   * 音频来源说明，比如「缓存 12 · 实时 3」「离线」。
   *
   * 一章里可能一半命中缓存、一半现合，所以这里是一句话而不是一个枚举。
   * 空串 = 还不知道（刚点开），整块不画，别留一个空壳占位置。
   */
  source?: string;
  /**
   * 「音色」按钮为谁来开弹窗。
   *
   * 系统语音没有音色可选，这时按在线服务开——总比弹一个空列表好。
   */
  voiceEngine?: 'local' | 'online';
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
  voice: 'mic',
  prefetch: 'download',
  export: 'share',
  tune: 'settings',
} as const;

/**
 * 状态栏会挡住朗读条右下角的那几颗（2026-11-14 真机截图：齿轮被状态栏
 * 里的图标压住）。
 *
 * 不写死高度：主题 / 缩放 / 插件图标数量都会变，量一次再写入
 * `--bzr-tts-lift`，CSS 那边只负责加。量不到（全屏、隐藏状态栏）就当 0。
 */
export function ttsBarLift(statusBar?: HTMLElement | null): number {
  if (!statusBar) return 0;
  const h = statusBar.getBoundingClientRect?.().height ?? 0;
  return Number.isFinite(h) && h > 0 ? Math.round(h) : 0;
}

export function ttsBarHtml(s: TtsBarState): string {
  const playLabel = s.paused ? t('tts.bar.resume') : t('tts.bar.pause');
  const main = s.loading
    ? `<button class="bzr-ttsbtn is-main is-loading" data-act="ttstoggle" title="${escapeHtml(
        t('tts.bar.loading'),
      )}" aria-label="${escapeHtml(t('tts.bar.loading'))}" aria-busy="true"><span class="bzr-ttsspin"></span></button>`
    : button('ttstoggle', s.paused ? ICONS.play : ICONS.pause, playLabel, ' is-main');
  const src = String(s.source ?? '').trim();
  const engine = s.voiceEngine === 'local' ? 'local' : 'online';
  return `<div class="bzr-ttsbar" data-role="ttsbar">
    ${src ? `<span class="bzr-ttssrc" title="${escapeHtml(src)}">${escapeHtml(src)}</span>` : ''}
    ${button('ttsprev', ICONS.prev, t('tts.bar.prev'))}
    ${main}
    ${button('ttsnext', ICONS.next, t('tts.bar.next'))}
    ${button('ttsstop', ICONS.stop, t('tts.bar.stop'))}
    <span class="bzr-ttssep" aria-hidden="true"></span>
    ${button('ttsvoices', ICONS.voice, t('tts.bar.voice'), ' is-minor', ` data-v="${engine}"`)}
    ${button('ttsprefetch', ICONS.prefetch, t('tts.bar.prefetch'), ' is-minor')}
    ${button('ttsexport', ICONS.export, t('tts.bar.export'), ' is-minor')}
    ${button('ttstune', ICONS.tune, t('tts.bar.settings'), ' is-minor')}
  </div>`;
}

function button(act: string, icon: string, label: string, extra = '', attrs = ''): string {
  const safe = escapeHtml(label);
  return `<button class="bzr-ttsbtn${extra}" data-act="${act}"${attrs} title="${safe}" aria-label="${safe}"><span class="bzr-ttsicon" data-icon="${icon}"></span></button>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
