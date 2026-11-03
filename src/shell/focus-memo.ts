/**
 * 输入框焦点备忘（纯函数）。
 *
 * 壳层是「全量 innerHTML + 事件委托」，重绘会把输入框换掉，所以每次重绘前
 * 记住焦点、重绘后按选择器还回去。**键必须带上 data-k**：设置页有多个
 * `data-role="setting"` 输入框（导出目录 / 服务商 / 模型 / 密钥），只按 role
 * 找会命中第一个，用户敲第二个字符时焦点就被抢到导出目录去了。
 */
export interface FocusMemo {
  role: string;
  /** 同一 role 下的细分键（设置项的 data-k）；没有就不带 */
  k?: string;
  start: number;
  end: number;
}

/** 还焦点用的选择器 */
export function focusSelector(role: string, k?: string): string {
  return k ? `[data-role="${role}"][data-k="${k}"]` : `[data-role="${role}"]`;
}
