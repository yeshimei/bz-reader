/* ============================================================
 * bz-reader · foliate 运行时门面（engine/foliate.ts）
 *
 * 全仓唯一允许 import vendor/foliate 的地方。理由：vendor 是上游原版 JS，
 * TS 从 JS 推断出的类型不可用（View 被推断成 HTMLElement，导出也没有类型名），
 * 在这里一次性 cast 成 types/foliate.ts 的形状，业务侧只认这份。
 * ============================================================ */
import * as viewModule from '../vendor/foliate/view.js';
import type { FoliateBook, FoliateView } from '../types/foliate';

export type { FoliateBook, FoliateTOCItem, FoliateView, FoliateLocation } from '../types/foliate';

/** 从 File / Blob / 字符串（zip 路径）造书；按扩展名派发到对应格式的 loader */
export const makeBook = (viewModule as unknown as {
  makeBook: (file: File | Blob | string) => Promise<FoliateBook>;
}).makeBook;

/** 自定义元素类：使用前需 customElements.define('foliate-view', View) */
export const View = (viewModule as unknown as {
  View: CustomElementConstructor & (new () => FoliateView);
}).View;
