/** 移动端判定（与 bz 同口径：obsidian Platform.isMobile） */
import { Platform } from 'obsidian';

export function isMobileEnv(): boolean {
  return typeof Platform !== 'undefined' && !!Platform.isMobile;
}

/**
 * 「是不是按手机形态承载」——决定书架用 tab 还是全屏弹窗、
 * 阅读页按不按窄屏折叠工具条。
 *
 * 比 isMobileEnv 多一条：`localStorage['bz-reader:force-mobile'] === '1'`
 * 时在桌面也按手机形态跑。这条不是给用户用的开关，是为了能在桌面上
 * 验收移动端布局——真机调试一个样式要重新打包、装到手机上、截图，
 * 一轮几分钟；桌面改个 localStorage 就能看。
 *
 * 只影响界面承载，不参与任何授权判断，所以不存在「开了它绕过付费」
 * 的问题（授权只看 entitlement，与承载形态无关）。
 */
export function isMobileShell(): boolean {
  if (isMobileEnv()) return true;
  try {
    return window.localStorage?.getItem('bz-reader:force-mobile') === '1';
  } catch {
    return false;
  }
}

/**
 * 书库筛选行摊开所需的最小宽度（px）。
 *
 * 摊开 = 搜索井 + 五个分类 + 「排序」抬头 + 三个排序 + 两个视图，
 * 实测约 950px（含内边距）。留一点余量取 1000。
 */
export const LIBRARY_WIDE = 1000;

/**
 * 书库筛选行要不要收成下拉。
 *
 * **只看这一块有多宽，不看平台**：
 *   · 手机 390 / 横屏 844 → 收；
 *   · 桌面、宽平板 → 摊开。
 *
 * 原来这里用的是 `isMobileShell()`，桌面验收开着 force-mobile 时它返回
 * true，1725×1152 的窗口里整行被收成四个下拉——用户的原话是
 * 「能放得下就别用下拉」。移动形态（Modal 承载、长按、工具条折叠）
 * 仍归 isMobileShell 管，这里只问宽度。
 *
 * 宽度拿不到（视图还没参与布局，clientWidth 为 0）时按摊开处理：
 * 随后那次 resize 会纠正，反过来会在桌面上闪一下下拉。
 */
export function isCompactLibrary(width: number): boolean {
  if (!(width > 0)) return false;
  return width < LIBRARY_WIDE;
}
