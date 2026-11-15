/* ============================================================
 * bz-reader · 续听浮窗（view/tts-resume.ts）
 *
 * 一个纯函数：记录 → HTML。和 tts-bar / tts-progress 一样不 import
 * obsidian，事件由阅读视图在容器上委托，测试里就能直接比字符串。
 *
 * 位置复用朗读工具栏那一块（底部居中、同样的状态栏抬升）：用户刚在那
 * 儿看见过朗读条，停下来之后「同一位置出现两条小按钮」比在屏幕别处
 * 再冒一个浮层更容易接上（2026-11-15 用户要求）。
 * ============================================================ */

import { t } from '../i18n';
import type { TtsResumePoint } from '../core/tts-resume';

/**
 * 浮窗只认「有几句」和「哪一章」：段号是 0-based，显示时 +1。
 * 章名为空就不拼那个间隔点，别留一条孤零零的「·」。
 */
export function ttsResumeHtml(p: Pick<TtsResumePoint, 'index' | 'chapterTitle'>): string {
  const n = String(Math.max(0, Math.round(Number(p.index) || 0)) + 1);
  const chapter = String(p.chapterTitle ?? '').trim();
  const where = chapter
    ? t('tts.resume.whereChapter', { n, chapter })
    : t('tts.resume.where', { n });
  return `<div class="bzr-ttsresume" data-role="ttsresume">
  <span class="bzr-ttsresume-tx">${escapeHtml(where)}</span>
  <button class="bzr-ttsresume-btn is-main" data-act="ttsresume">${escapeHtml(t('tts.resume.go'))}</button>
  <button class="bzr-ttsresume-btn" data-act="ttsresumeclose">${escapeHtml(t('tts.resume.close'))}</button>
</div>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
