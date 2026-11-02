/* ============================================================
 * bz-reader · 应用实例（core/app.ts）
 *
 * Obsidian 的 Plugin 实例上本来就有 `this.app`，但域模块不该为了拿 app
 * 一路把 Plugin 传下去。onload 注入一次，别处读——与 bz 主插件的口径一致。
 * ============================================================ */
import type { App } from 'obsidian';

let current: App | null = null;

export function setApp(app: App): void {
  current = app;
}

export function getApp(): App {
  if (!current) throw new Error('bz-reader：应用实例尚未注入');
  return current;
}

/** 未注入时返回 null（卸载路径与降级分支用，避免抛错） */
export function tryGetApp(): App | null {
  return current;
}
