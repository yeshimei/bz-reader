/* ============================================================
 * bz-reader · AI 未配置的引导窗（src/shell/ai-guide.ts）
 *
 * 2026-11-19 用户口径：AI 相关功能在「自己没配 + 共享也没借到」时不能只是
 * 一句灰字提示，要给一个能点的出口——点了直接落到设置页的「AI 助手」组。
 *
 * 为什么统一成一个窗：加入复习的三个入口（文字工具栏 / 书右键 / 侧栏）
 * 原来各弹一句 `review.needAI`，用户看完还是不知道去哪儿填。文案与出口
 * 只写一份，改口径时不用满仓库找。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { t } from '../i18n';
import { getShellSource } from './source';

/** 当前开着的那一层（单例）：连点两次不该叠两层一模一样的窗 */
let current: (() => void) | null = null;

/**
 * 弹窗正文（纯函数，测试直接断言）。
 *
 * 两段话分工：第一段说「现在为什么用不了」，第二段给「填在哪儿 / 也可以
 * 借用对方」。共享开关那一句必须写出来——不然用户会以为两个插件要各填一遍。
 */
export function aiGuideHtml(): string {
  return (
    '<div class="bzs-aiguide">' +
    `<p class="bzs-aiguide-lead">${t('review.aiGuide.body')}</p>` +
    `<p class="bzs-aiguide-hint">${t('review.aiGuide.hint')}</p>` +
    '<div class="bzs-aiguide-acts">' +
    `<button class="bzr-btn is-primary" type="button" data-role="aiguide-settings">${t('review.aiGuide.go')}</button>` +
    `<button class="bzr-btn" type="button" data-role="aiguide-later">${t('review.aiGuide.later')}</button>` +
    '</div></div>'
  );
}

/**
 * 打开设置页并滚到「AI 助手」组。
 *
 * 设置页是异步渲染的（书架视图要先建出来才有 DOM），所以这里按 100ms
 * 重试几次；找不到就停——总比一直轮询好。
 */
export function openReaderAiSettings(tries = 12): void {
  const src = getShellSource();
  if (!src) {
    notify(t('review.aiGuide.noShell'), 'error');
    return;
  }
  src.openStudy('settings');
  const seek = (left: number): void => {
    const el = document.querySelector<HTMLElement>('#bz-set-ai');
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (left <= 0) return;
    window.setTimeout(() => seek(left - 1), 100);
  };
  window.setTimeout(() => seek(tries), 80);
}

/** 打开引导窗，返回关闭函数（单例） */
export function openAiGuide(): () => void {
  current?.();
  const modal = uiModal({
    content: aiGuideHtml(),
    className: 'bzs-aiguide-dialog',
    head: true,
    title: t('review.aiGuide.title'),
    maxWidth: 400,
  });

  const close = (): void => {
    if (current === close) current = null;
    modal.close();
  };
  current = close;

  modal.popup.addEventListener('click', (e) => {
    const hit = (e.target as HTMLElement | null)?.closest?.('[data-role]') as HTMLElement | null;
    const role = hit?.dataset?.role;
    if (role !== 'aiguide-settings' && role !== 'aiguide-later') return;
    close();
    if (role === 'aiguide-settings') openReaderAiSettings();
  });

  return close;
}
