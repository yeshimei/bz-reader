/** 移动端判定（与 bz 同口径：obsidian Platform.isMobile） */
import { Platform } from 'obsidian';

export function isMobileEnv(): boolean {
  return typeof Platform !== 'undefined' && !!Platform.isMobile;
}
