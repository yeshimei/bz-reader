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
