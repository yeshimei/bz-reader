/**
 * 点正文这一下该干什么（纯函数，node 里可直接测）。
 *
 * 为什么单独抽出来：判断分散在 reader-view 的两处（桌面一次、移动端一次），
 * 新加一个「划词条」状态时两边都没补，真机上就变成「点别处先翻一页」。
 *
 * 优先级：划词条 > 浮层 > 翻页。
 */
import { dismissesOnTap, isFloatOverlay, type OverlayKind } from '../shell/state';

export type TapIntent = 'dismiss-selbar' | 'dismiss-overlay' | 'turn' | 'idle';

export interface TapContext {
  /** 划词条（.bzs-selbar）现在挂着 */
  selbar: boolean;
  /** 当前浮层（没有就是空） */
  overlayKind?: OverlayKind | null;
  /** 真实移动端布局 */
  mobile: boolean;
}

export function tapIntent(ctx: TapContext): TapIntent {
  /* 划词条不是 overlay：它挂在阅读视图里，选区塌了要等 320ms 才收。
     不在这里拦，点正文会先翻页、条子随后才消失。 */
  if (ctx.selbar) return 'dismiss-selbar';
  /* 浮层开着时，这一下是关闭请求（写想法也是，只是它自己会先问一句），
     绝不能同时翻页——手机上一划就是掉内容。 */
  if (isFloatOverlay(ctx.overlayKind)) {
    return dismissesOnTap(ctx.overlayKind) ? 'dismiss-overlay' : 'idle';
  }
  /* 桌面也翻页（P2-10）：以前桌面返回 idle，点正文什么都不发生，
     只能用滚轮或键盘。方向由调用方按横向/纵向分区分，这里只回答
     「这一下算翻页」。 */
  return 'turn';
}
