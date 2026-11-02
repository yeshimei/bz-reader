/* ============================================================
 * bz-reader · 快捷键读取（core/hotkeys.ts）
 *
 * 我们不自己管键位。所有能按的动作都注册成 Obsidian 命令，用户去
 * 「设置 → 快捷键」里改；这里只做两件事：
 *   1. 把某条命令当前绑的键读出来（含用户改过的），给设置页显示；
 *   2. 点某一行时，打开宿主的快捷键设置并把搜索框填成这条命令的名字。
 *
 * 为什么不在插件里自建一套键位表：宿主已经有一套（可搜索、可导出、
 * 与其它插件冲突时能看全貌），再维护一份只会和它打架。
 * ============================================================ */
import { Platform, type App } from 'obsidian';

/** 与 Obsidian 内部 Hotkey 同形，只取用得上的两个字段 */
interface RawHotkey {
  modifiers: string[];
  key: string;
}

export interface HotkeyRow {
  /** 命令 id，形如 bz-reader:page-next */
  id: string;
  /** 给人看的功能名 */
  label: string;
  /** 当前绑定的键（可能多条；空数组 = 没绑） */
  keys: string[];
  /** 阅读页内置的单键（不经过宿主，仅做提示） */
  builtin?: string;
}

const MOD_SYMBOL: Record<string, string> = {
  Mod: Platform.isMacOS ? '⌘' : 'Ctrl',
  Ctrl: 'Ctrl',
  Meta: Platform.isMacOS ? '⌘' : 'Win',
  Shift: Platform.isMacOS ? '⇧' : 'Shift',
  Alt: Platform.isMacOS ? '⌥' : 'Alt',
};

const KEY_LABEL: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Space',
};

/**
 * 一个 Hotkey → 「Ctrl + →」这样的一行。
 * macOS 用符号（⌘⇧⌥）更要紧：那边用户认的就是符号，写 Ctrl 反而看不懂。
 */
export function formatHotkey(h: RawHotkey): string {
  const mods = (h.modifiers ?? []).map((m) => MOD_SYMBOL[m] ?? m);
  const key = KEY_LABEL[h.key] ?? (h.key.length === 1 ? h.key.toUpperCase() : h.key);
  if (Platform.isMacOS) return mods.join('') + key;
  return [...mods, key].join(' + ');
}

/** 读一组命令的当前键位。拿不到 hotkeyManager 就返回空键，界面显示「未设置」 */
export function readHotkeys(app: App | undefined, list: Array<Omit<HotkeyRow, 'keys'>>): HotkeyRow[] {
  const mgr = (app as unknown as { hotkeyManager?: { getHotkeys?: (id: string) => RawHotkey[] } } | undefined)
    ?.hotkeyManager;
  return list.map((row) => {
    let keys: string[] = [];
    try {
      keys = (mgr?.getHotkeys?.(row.id) ?? []).map(formatHotkey);
    } catch {
      keys = [];
    }
    return { ...row, keys };
  });
}

/**
 * 打开宿主的快捷键设置并定位到这条命令。
 *
 * 宿主没有「定位到某条命令」的 API，能做的就是打开那一页 + 填搜索框。
 * 三个环节都可能是空的（版本差异），所以每一步都单独兜住：
 * 搜不到就只是打开设置页，不至于什么都不发生。
 */
export function openHotkeySettings(app: App | undefined, query: string): void {
  const setting = (app as unknown as {
    setting?: { open?: () => void; openTabById?: (id: string) => void };
  })?.setting;
  setting?.open?.();
  setting?.openTabById?.('hotkeys');

  window.setTimeout(() => {
    const input =
      document.querySelector<HTMLInputElement>('.mod-hotkeys input[type="search"]') ??
      document.querySelector<HTMLInputElement>('.mod-hotkeys .search-input-container input') ??
      document.querySelector<HTMLInputElement>('.vertical-tab-content input[type="search"]');
    if (!input) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, 140);
}
