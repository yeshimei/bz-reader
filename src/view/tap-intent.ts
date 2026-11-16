/**
 * 点正文这一下该干什么（纯函数，node 里可直接测）。
 *
 * 为什么单独抽出来：判断分散在 reader-view 的两处（桌面一次、移动端一次），
 * 新加一个「划词条」状态时两边都没补，真机上就变成「点别处先翻一页」。
 *
 * 优先级：划词条 > 浮层 > 翻页。桌面端默认连「翻页」都没有（见下）。
 */
import { dismissesOnTap, isFloatOverlay, type OverlayKind } from '../shell/state';

export type TapIntent = 'dismiss-selbar' | 'dismiss-overlay' | 'turn' | 'idle';

export interface TapContext {
  /** 划词条（.bzs-selbar）现在挂着 */
  selbar: boolean;
  /** 当前浮层（没有就是空） */
  overlayKind?: OverlayKind | null;
  /**
   * 这张浮层被「定住」了（2026-11-16）。
   *
   * 定住的 AI 卡点书页正文不关：读的时候要点着看，一碰就消失等于
   * 没法用。**只管书页这一块**——点界面其它地方（工具条、侧栏、页签）
   * 走的是宿主文档那条路，那里照关（见 overlay 的 onDocPointer）。
   */
  pinned?: boolean;
  /** 真实移动端布局 */
  mobile: boolean;
  /**
   * 桌面端「点击翻页」开关（prefs.desktopTapTurn）。
   * 手机不读它；缺省 = 关。
   */
  desktopTurn?: boolean;
}

export function tapIntent(ctx: TapContext): TapIntent {
  /* 划词条不是 overlay：它挂在阅读视图里，选区塌了要等 320ms 才收。
     不在这里拦，点正文会先翻页、条子随后才消失。 */
  if (ctx.selbar) return 'dismiss-selbar';
  /* 定住的浮层不认点空白：这一下就是「继续读」，什么都不该发生。
     排在关闭判断之前，否则定住等于没定。 */
  if (ctx.pinned && isFloatOverlay(ctx.overlayKind)) return 'idle';
  /* 浮层开着时，这一下是关闭请求（写想法也是，只是它自己会先问一句），
     绝不能同时翻页——手机上一划就是掉内容。 */
  if (isFloatOverlay(ctx.overlayKind)) {
    return dismissesOnTap(ctx.overlayKind) ? 'dismiss-overlay' : 'idle';
  }
  /* 手机：点按是唯一的翻页手势，一直翻。
     桌面：默认**不翻**（2026-11-12 改）——以前点正文按左右半区翻页，
     可桌面这点下去的第一用途是选字、点链接、落焦点，一页被卷走比
     「点了没反应」更恼人。触屏笔记本想用手指点，去设置里打开「点击翻页」；
     开了才走和手机一样的翻页分支，方向仍由调用方按平台分区。 */
  return ctx.mobile || ctx.desktopTurn ? 'turn' : 'idle';
}
