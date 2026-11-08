/* ============================================================
 * bz-reader · 诊断角标开关（view/debug-probe.ts）
 *
 * 阅读页角标能一行说清「触摸有没有进来、手势挂没挂上、点了到底翻没翻」，
 * 是手机上唯一的排查面——iPhone 开不了 `Ctrl+Shift+I`，也没有控制台。
 *
 * 以前只有 `localStorage['bz-reader:debug-probe']='1'` 一条开关，那在手机上
 * 根本没有入口，等于这个角标在真机上永远打不开。现在加一条命令面板入口
 * （`阅读：诊断角标`），会话内生效、不落盘：重启 Obsidian 自动关掉，
 * 不会把用户的界面一直留着调试信息。
 * ============================================================ */

const STORAGE_KEY = 'bz-reader:debug-probe';

/** 会话内开关（命令面板切换，不落盘） */
let sessionOn = false;

/** 角标要不要显示。桌面排查仍可用 localStorage 那条老口令。 */
export function probeEnabled(): boolean {
  if (sessionOn) return true;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 翻一下开关，返回翻完之后的状态（命令的提示文案用它） */
export function toggleProbe(): boolean {
  sessionOn = !sessionOn;
  return sessionOn;
}
