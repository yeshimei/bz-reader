/* ============================================================
 * bz-reader · 「去装 bz Review」的统一出口（shell/review-settings.ts）
 *
 * 三处入口（书右键、工具条单条、划选）在没装 / 没启用时都往这里走：
 * 打开书架设置页，滚到「插件」组并高亮那张卡。用户不用知道插件 id、
 * 下载页或目录在哪。
 * ============================================================ */
import { closeOverlay } from './state';
import { requestSettingsFocus } from './settings-focus';
import { getShellSource } from './source';

/** 打开设置页的「插件」组（安装 / 启用 bz Review 的唯一入口） */
export function openReviewSettings(): void {
  /* 跳去书架前先收掉书里的浮层与选区：留一张贴着划线的工具条悬在设置页上，
     用户既不知道它属于哪本书，也关不掉。 */
  closeOverlay();
  getShellSource()?.clearSelection?.();
  requestSettingsFocus('plugins');
  getShellSource()?.openStudy?.('settings');
}
