/**
 * 动态 z-index 分配器（ADR-0067）：层级规则只有一条——谁后显示谁在上。
 *
 * 全站 overlay（遮罩/弹窗/抽屉/浮层/toast）不再持有静态档位，显示时发号；
 * show/hide 复用的面板每次显示重新发号（topifyZ），「最后显示的」恒在最上。
 * 计数器单调递增，起点高于历史最高静态档（toast 100000），与任何残留静态值
 * 共存时不钻底；上限 2^31-1，按每次显示数档的速率可使用数十年。
 */
let zCounter = 100000;

/** 恒顶层（如 smartcat 桌宠小橘——用户拍板保持最高）：永远压过一切动态 overlay，
 *  由分配器在每次分配后自动抬到最新档之上；离场元素由 sync 兜底清扫（C8） */
const alwaysOnTop = new Set<HTMLElement>();

/** 注册恒顶元素（幂等）：注册即抬到当前最高档 */
export function registerAlwaysOnTop(el: HTMLElement): void {
  alwaysOnTop.add(el);
  syncAlwaysOnTop();
}

/** 注销恒顶元素（幂等，C8）：域卸载/元素移除时显式出队 */
export function unregisterAlwaysOnTop(el: HTMLElement): void {
  alwaysOnTop.delete(el);
}

function syncAlwaysOnTop(): void {
  // C8：离场（!isConnected）元素及时出队——原先只跳过赋值，Set 只进不出，
  // 重挂载型组件（如小橘每次重挂载）每轮滞留一棵 DOM 子树引用无法回收
  for (const el of alwaysOnTop) {
    if (!el.isConnected) {
      alwaysOnTop.delete(el);
      continue;
    }
    el.style.zIndex = String(zCounter);
  }
}

/**
 * 分配一段连续区间 [返回值, 返回值+n-1]（成对遮罩/本体取相邻档，本体=遮罩+1）。
 * 区间上方紧邻一档留给恒顶层（永远比最新 overlay 高 1）。
 */
function allocZBlock(n: number): number {
  const base = ++zCounter;
  zCounter += n - 1;
  zCounter++; // 恒顶层档
  syncAlwaysOnTop();
  return base;
}

/** 分配下一个顶层 z（单元素显示时调一次） */
export function allocZ(): number {
  return allocZBlock(1);
}

/**
 * 取一档**严格高于**给定元素现有层级的号。
 *
 * 用于「自己的层级是别人给的、又必须盖住那一层」：如更新日志的二次确认弹窗
 * 挂 body，主窗遮罩是 allocZ() 发的号，写死一个常数就会被压在主窗下面。
 * 传进来的元素读不到数字（auto / 空串 / 没写）时忽略，退化成普通发号。
 */
export function allocZAbove(...els: (HTMLElement | undefined | null)[]): number {
  let top = 0;
  for (const el of els) {
    const raw = el?.style?.zIndex;
    const z = Number(raw);
    if (raw !== '' && Number.isFinite(z) && z > top) top = z;
  }
  const next = allocZ();
  /* 正常情况 next 已经比 top 高；外部带着更大静态档时才用 top+1 兜一次 */
  return next > top ? next : top + 1;
}

/** topifyZ(els...)：显示时抬顶。按传入顺序发号（遮罩在前、本体在后，保持成对上下关系） */
export function topifyZ(...els: (HTMLElement | undefined | null)[]): void {
  const live = els.filter((el): el is HTMLElement => !!el);
  if (live.length === 0) return;
  const base = allocZBlock(live.length);
  live.forEach((el, i) => {
    el.style.zIndex = String(base + i);
  });
}

/** 测试专用：重置计数器起点（jsdom 每文件独立环境一般无需调用；跨用例断言确定性时用） */
export function __resetZForTests(): void {
  zCounter = 100000;
}
