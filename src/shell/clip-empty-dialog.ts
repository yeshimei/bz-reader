/* ============================================================
 * bz-reader · 剪藏本空库提醒（src/shell/clip-empty-dialog.ts）
 *
 * 只有一个入口：设置页把「剪藏本」开关从关拨到开，而 bz 那边的剪藏本里
 * 一篇文章、一个源、一个 UP 主都没有时，弹一次。
 *
 * 为什么要弹：剪藏成书是把剪藏本里的文章合成一本放进书架。库里没东西，
 * 开关打开之后书架会多出一本空书——用户看到的是「功能坏了」，而实际情况
 * 是「还没开始用」。这时候该给的是下一步，不是解释。
 *
 * 两个出口，主次分明：
 *   · 去设置——打开剪藏本主界面，源在那里配；
 *   · 看教程——链接没定之前由调用方给一句提示，不打开不相干的视频。
 *
 * 版式跟支持作者 / 更新日志同一族（uiModal + .bzr-btn），不另造一套皮。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';

export interface ClipEmptyActions {
  /** 去设置：打开剪藏本主界面。打开失败时的提示由调用方负责 */
  settings: () => void;
  /** 看教程：链接没定之前由调用方给一句提示 */
  tutorial: () => void;
}

/** 当前开着的那一层（单例）；没有就是 null */
let current: (() => void) | null = null;

/**
 * 弹窗正文（抽成纯函数，测试直接断言它）。
 *
 * 两段话分工：第一段说清「为什么现在打开是空的」，第二段给下一步。
 * 只有一句「剪藏本还是空的」会让人以为出了问题；只有两个按钮又不知道
 * 点了会发生什么。
 */
export function clipEmptyHtml(): string {
  return (
    '<div class="bzs-clipempty">' +
    `<p class="bzs-clipempty-lead">${t('clip.empty.body')}</p>` +
    `<p class="bzs-clipempty-hint">${t('clip.empty.hint')}</p>` +
    '<div class="bzs-clipempty-acts">' +
    `<button class="bzr-btn is-primary" type="button" data-role="clipempty-settings">${t('clip.empty.settings')}</button>` +
    `<button class="bzr-btn" type="button" data-role="clipempty-tutorial">${t('clip.empty.tutorial')}</button>` +
    '</div></div>'
  );
}

/**
 * 打开提醒窗，返回关闭函数。
 *
 * 单例：开关连拨两次时两次异步查询可能先后回来，叠两层一模一样的窗只会
 * 让人点错。新的打开前先把旧的收掉。
 *
 * 按钮一律先关窗再执行：去设置会切走界面，看教程会切到浏览器，留在原地
 * 的那一层回来时只剩下「我刚才点了什么」的困惑。
 */
export function openClipEmptyDialog(actions: ClipEmptyActions): () => void {
  current?.();
  const modal = uiModal({
    content: clipEmptyHtml(),
    className: 'bzs-clipempty-dialog',
    head: true,
    title: t('clip.empty.title'),
    maxWidth: 380,
  });

  const close = (): void => {
    if (current === close) current = null;
    modal.close();
  };
  current = close;

  modal.popup.addEventListener('click', (e) => {
    const hit = (e.target as HTMLElement | null)?.closest?.('[data-role]') as HTMLElement | null;
    const role = hit?.dataset?.role;
    if (role !== 'clipempty-settings' && role !== 'clipempty-tutorial') return;
    close();
    if (role === 'clipempty-settings') actions.settings();
    else actions.tutorial();
  });

  return close;
}
