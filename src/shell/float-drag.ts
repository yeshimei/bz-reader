/* ============================================================
 * bz-reader · 拖动浮窗的落点（shell/float-drag.ts）
 *
 * AI 卡定住之后可以拖到任意地方（2026-11-16）。坐标是「本次打开」的
 * 临时位置，不写进 state：`overlayKey` 里带着锚点，一写进去每移动一像素
 * 就要整棵 DOM 重画，输入框的焦点和半句话都会跟着没。
 *
 * 这里只算落点，不碰 DOM：手一滑把窗口甩到屏幕外，没有标题栏可点、
 * 也没有滚动条，就再也抓不回来了，所以四边都要夹住。
 *
 * **位置写进卡片自己的内联样式，而不是事后补一个位移**（2026-11-16
 * 真机反馈「点一下会弹回原文旁边再弹回来」）：事后补就是先按原文旁边
 * 画出来、下一拍再挪走，卡片每重画一次就闪一次；写进模板则第一次画
 * 出来就在最终坐标上。位置也不再依赖卡片高度——内容变多、重画、
 * 切状态都不会把它挪走。
 * ============================================================ */

export interface FloatPos {
  left: number;
  top: number;
}

/** 一张拖出来的卡片：视口坐标 + 拖下去那一刻的宽度（高度交给内容） */
export interface FloatBox extends FloatPos {
  width: number;
}

export interface FloatSize {
  width: number;
  height: number;
}

export interface FloatViewport {
  width: number;
  height: number;
  /** 视觉视口顶端的偏移（手机键盘 / 工具栏占位），桌面是 0 */
  top?: number;
}

/**
 * 「这张卡」的身份：用来判断拖出来的位置还属不属于眼前这张卡。
 *
 * **故意不含 `markId`**（2026-11-16 真机反馈）：追问发出去那一刻会新建
 * 划线，markId 从空变成线 id。把它算进身份，等于手刚摆好窗口、一发送
 * 就判定「换卡」并把位置清掉——用户看着卡弹回原文旁边。
 *
 * `aiclear`（清空对话的二次确认）算同一张卡：它带着卡片的全部字段，
 * 点「取消」会原地开回来，位置与定住都得还在。
 */
export function aiFloatIdentity(
  o: { kind?: string; menu?: boolean; bookId?: string; mode?: string; text?: string } | null | undefined,
): string {
  if (o?.kind !== 'ai' && o?.kind !== 'aiclear') return '';
  return `${o.menu ? 'menu' : 'card'}|${o.bookId ?? ''}|${o.mode ?? ''}|${o.text ?? ''}`;
}

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return v < min ? min : v > max ? max : v;
}

/**
 * 松手那一刻的落点：起点 + 位移，夹在可视区内。
 *
 * 面板比视口还大时（窄窗口 + 长回答）夹到 0 / top，宁可露出一条边也不
 * 让它整块跑到外面去。
 */
export function dragPosition(
  start: FloatPos,
  delta: { dx: number; dy: number },
  size: FloatSize,
  view: FloatViewport,
): FloatPos {
  const top = view.top ?? 0;
  const maxLeft = Math.max(0, view.width - size.width);
  const maxTop = Math.max(top, top + view.height - size.height);
  return {
    left: clamp(start.left + delta.dx, 0, maxLeft),
    top: clamp(start.top + delta.dy, top, maxTop),
  };
}

/**
 * 拖出来的卡片自己的内联样式（模板里就写死，画出来即在最终坐标）。
 *
 * 为什么不是事后挪：`paint()` 整块换 DOM，事后的位移要「量一次自然位置、
 * 再补一个 translate」两步；任何一次重画（点图钉、点卡片里的按钮、答案
 * 回来）都会把这两步重演一遍，屏幕上就是「弹回原文旁边再弹回来」。
 *
 * 也不用 `transform`：卡片变成固定定位之后，位置与内容高度彻底解耦——
 * 回答变长、正文重排、窗口缩放都不会再推着它走。
 *
 * `max-height` 跟着视口算：拖到靠下的位置时卡片自己收短、消息区内部滚，
 * 不会半个身子挂在屏幕外。宽度的 `min()` 兜住窄窗口。
 *
 * 「它自己的窗口」是一个很短的过渡状态（2026-11-16 补）：起播那一刻卡片
 * 已经脱离原文、落点也是算好的，就直接定在 `pos`；但**用户没拖过**时
 * 它还该跟着工具条回原文旁边——文字工具条一收，两张皮就分家了（作者
 * 截图）。所以只有 `pinned` 才当常驻窗口，其余情况浮层里那一份回到普通
 * 流布局，外层浮层还它一个位置。
 */
export function floatBoxStyle(box: FloatBox, keep?: boolean): string {
  const left = Math.round(box.left);
  const top = Math.round(box.top);
  const width = Math.round(box.width);
  const size = [
    `width:min(${width}px,calc(100vw - 24px))`,
    `max-height:calc(100vh - ${top}px - 12px)`,
  ];
  if (!keep) {
    /* 只留尺寸：位置交回外层浮层，工具条一收它跟着走 */
    return ['position:relative', 'left:auto', 'top:auto', ...size].join(';');
  }
  return ['position:fixed', `left:${left}px`, `top:${top}px`, ...size].join(';');
}
