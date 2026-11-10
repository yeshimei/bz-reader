/* ============================================================
 * bz-reader · 「几选一」分段按钮（shell/render/seg.ts）
 *
 * 同一个控件以前写过三份：设置页一份、排版浮层一份、统计页一份。
 * 设置页与浮层连属性顺序都一样，统计页换了个外层类、动作也不同——
 * 改一处样式或补一个属性（比如 aria）就得记着另外两处。
 *
 * 这里只统一**结构**：外层容器 + 一排带 `on` 的按钮。外层类名与点击动作
 * 由调用点给——统计页的视觉是复刻原型的另一套（`.seg`），不该被顺手改掉。
 * ============================================================ */

export interface SegOption {
  /** 写进 data-v 的值 */
  v: string;
  /** 按钮上的文字 */
  k: string;
}

export interface SegAttrs {
  /** 点击动作，缺省 `setpref` */
  act?: string;
  /** 设置项名，写了才有 `data-k`（统计页的范围 / 口径不需要） */
  name?: string;
  /** 外层类名，缺省 `bzs-seg`（统计页传 `seg`） */
  cls?: string;
  /** 外层标签，缺省 `div`（统计页那套是行内 `span`） */
  tag?: 'div' | 'span';
  /**
   * 整组禁用（未激活的基础版：AI 组能看不能改）。
   *
   * 按钮不是输入框，`readonly` 对它无效；不禁用的话点一下会直接换掉配置，
   * 让基础版用户以为「填了就能用」。
   */
  disabled?: boolean;
}

/** 一排分段按钮；`cur` 那一项带 `on` */
export function segHtml(opts: readonly SegOption[], cur: string, attrs: SegAttrs = {}): string {
  const act = attrs.act ?? 'setpref';
  const cls = attrs.cls ?? 'bzs-seg';
  const off = attrs.disabled ? ' disabled' : '';
  const tag = attrs.tag ?? 'div';
  const name = attrs.name ? ` data-k="${attrs.name}"` : '';
  const buttons = opts
    .map(
      (o) =>
        `<button class="${cur === o.v ? 'on' : ''}" data-act="${act}"${name} data-v="${o.v}"${off}>${o.k}</button>`,
    )
    .join('');
  return `<${tag} class="${cls}">${buttons}</${tag}>`;
}
