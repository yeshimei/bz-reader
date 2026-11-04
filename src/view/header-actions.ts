/**
 * 阅读页头栏的动作清单与开关态（纯函数，node 里可直接测）。
 *
 * 为什么要单独抽出来：
 *   · 动作数量原来按 `isMobileShell()` 判——桌面验收时打开 force-mobile，
 *     桌面窗口也只露 3 颗，另外两颗（排版 / 并排对照）折进 ⋮，用户以为
 *     「放得下却收起来了」。数量只该看**真实承载**：手机 3 颗、桌面 5 颗。
 *   · 书签图标要「这一页签过了就亮」，判据是 `bookmarkAt(book, 当前 cfi)`；
 *     这段以前写在视图里、还被 `void on` 吞掉，测不到也修不掉。
 */
import { bookmarkAt } from '../data/notes';
import type { ReaderBook } from '../data/schema';

export type HeaderActionId = 'toc' | 'search' | 'mark' | 'type' | 'para';

export interface HeaderActionSpec {
  id: HeaderActionId;
  icon: string;
  label: string;
}

/** 顺序即视觉顺序：目录 → 搜索 → 书签 →（桌面）排版 → 并排对照 */
const SPEC: readonly HeaderActionSpec[] = [
  { id: 'toc', icon: 'list', label: '目录（s）' },
  { id: 'search', icon: 'search', label: '搜索' },
  { id: 'mark', icon: 'bookmark', label: '记书签（b）' },
  { id: 'type', icon: 'type', label: '排版（t）' },
  { id: 'para', icon: 'columns-2', label: '并排对照' },
];

/**
 * 头栏要挂哪几颗。
 *
 * @param mobile 真实移动端（`isMobileEnv()`，**不是** `isMobileShell()`——
 *   后者含桌面验收用的 force-mobile，会让桌面也折起来）
 */
export function headerActionIds(mobile: boolean): HeaderActionId[] {
  return SPEC.filter((s) => !mobile || s.id === 'toc' || s.id === 'search' || s.id === 'mark').map((s) => s.id);
}

export function headerActionSpec(id: HeaderActionId): HeaderActionSpec {
  return SPEC.find((s) => s.id === id) ?? SPEC[0];
}

export interface HeaderActive {
  /** 当前页是否已有一枚书签（决定书签图标亮不亮） */
  mark: boolean;
  /** 并排对照开着 */
  para: boolean;
}

export function headerActive(book: ReaderBook | null, cfi: string, parallelOn: boolean): HeaderActive {
  return {
    mark: !!book && !!cfi && !!bookmarkAt(book, cfi),
    para: parallelOn,
  };
}
