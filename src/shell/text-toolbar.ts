/**
 * 划词工具条（S11 定稿）：**划词与点划线共用这一枚**。
 *
 * 定下来的三条：
 *   1. 桌面 A：色点 ｜ 想法 书摘 AI 双链 复制（已有划线时再加删除），全部摊开；
 *      手机 B：只留想法 / 书摘 / AI，其余收进「⋯」。
 *   2. 动作顺序固定：想法在最左（最常点），复制在删除前，删除永远最后、
 *      且是唯一的破坏性动作。
 *   3. 两端只差「放得下放不下」，不差按钮含义——所以按钮**在数据上只有一份**，
 *      划词与点划线只换 `data-act`（sel* / hl*），不换结构。
 *
 * 这里全是纯函数：HTML 由调用方塞进壳层，阅读视图与浮层各自负责定位。
 */

export interface ToolbarColor {
  value: string;
  label: string;
  css: string;
}

export type ToolbarAct = 'idea' | 'quote' | 'ai' | 'bilink' | 'copy' | 'del';

export interface ToolbarItem {
  act: ToolbarAct;
  label: string;
  /** 破坏性动作：单独排在最后、用朱砂色 */
  danger?: boolean;
}

/**
 * 按钮的唯一真相。
 *
 * 顺序即定稿：想法 / 书摘 / AI / 双链 / 复制，删除另算（见 DELETE_ITEM）。
 * AI 只有两个字母——旁边就是「书摘」，四个字会把整排推宽。
 */
export const TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  { act: 'idea', label: '想法' },
  { act: 'quote', label: '书摘' },
  { act: 'ai', label: 'AI' },
  { act: 'bilink', label: '双链' },
  { act: 'copy', label: '复制' },
];

export const DELETE_ITEM: ToolbarItem = { act: 'del', label: '删除', danger: true };

/** 手机上还留在胶囊上的主路径颗数：想法 / 书摘 / AI */
const COMPACT_MAIN = 3;

export interface ToolbarLayoutInput {
  /** 已有划线：多一颗删除 */
  marked: boolean;
  /** 手机：主路径 + ⋯ */
  compact?: boolean;
}

export interface ToolbarLayout {
  /** 直接摆在胶囊上的按钮 */
  visible: ToolbarItem[];
  /** 收进「⋯」里的按钮（为空表示不需要 ⋯） */
  overflow: ToolbarItem[];
}

/**
 * 两端各自的排布。
 *
 * 桌面上没有 ⋯：说过「A 全平铺」，二十几毫米的差距不值得多一次点击。
 * 手机上只用三颗主路径，双链 / 复制 / 删除进菜单——它们在手机上都属于
 * 「想到了才点」的动作，常年占着位置反而把想法挤小了。
 */
export function toolbarLayout(input: ToolbarLayoutInput): ToolbarLayout {
  const marked = !!input.marked;
  if (!input.compact) {
    return {
      visible: marked ? [...TOOLBAR_ITEMS, DELETE_ITEM] : [...TOOLBAR_ITEMS],
      overflow: [],
    };
  }
  return {
    visible: TOOLBAR_ITEMS.slice(0, COMPACT_MAIN),
    overflow: [...TOOLBAR_ITEMS.slice(COMPACT_MAIN), ...(marked ? [DELETE_ITEM] : [])],
  };
}

/**
 * 同一颗按钮在两种上下文里要发不同的动作：
 * 「想法」在划词时是 selidea（先落一条线再开输入框），点划线时是 hlidea。
 * 结构不换，只换名字——这就是「同一条」的落点。
 */
export interface ToolbarActs {
  dot: string;
  idea?: string;
  quote?: string;
  ai?: string;
  bilink?: string;
  copy?: string;
  del?: string;
}

export const SELECTION_ACTS: ToolbarActs = {
  dot: 'selpen',
  idea: 'selidea',
  quote: 'selquote',
  ai: 'selai',
  bilink: 'selbilink',
  copy: 'selcopy',
};

export const MARK_ACTS: ToolbarActs = {
  dot: 'hlcolor',
  idea: 'hlidea',
  quote: 'hlquote',
  ai: 'hlai',
  bilink: 'copylink',
  copy: 'hlcopy',
  del: 'hldel',
};

/**
 * 「⋯」按钮的 data-act。
 *
 * 它是这条工具条上唯一**不是业务动作**的按钮：点它只开合自己的菜单，
 * 不进动作表。以前浮层里这枚按钮没有单独分支，点下去被当成一次普通动作
 * 派发、派发完再整块重画——菜单刚画出来就被新 DOM 换掉，
 * 手机上看起来就是「闪一下，打不开」。
 */
export const MORE_ACT = 'more';

/** 一次点击工具条的处置：开合菜单 / 交给动作表 / 什么都没点中 */
export type ToolbarHitPlan = { kind: 'more' } | { kind: 'act'; act: string } | { kind: 'ignore' };

/**
 * 工具条上的点击该干什么——**必须在派发之前判定**。
 *
 * 两处（阅读视图里的划词条、浮层里的工具条）共用这一个判断，
 * 免得一处记得开合、另一处又把「⋯」当动作发出去。
 */
export function planToolbarHit(act?: string | null): ToolbarHitPlan {
  const a = (act ?? '').trim();
  if (!a) return { kind: 'ignore' };
  if (a === MORE_ACT) return { kind: 'more' };
  return { kind: 'act', act: a };
}

/** 菜单与胶囊之间的间隙（CSS 里 top: calc(100% + 6px) 的那个 6） */
export const MORE_MENU_GAP = 6;

/**
 * 菜单往哪边弹。
 *
 * 手机上工具条常常已经贴着屏幕底（贴选区下方），再往下弹就出屏了——
 * 用户看到的是「点了没反应」。所以打开时量一次：下方放不下就翻到上方。
 */
export function moreMenuOpensUp(barBottom: number, menuHeight: number, viewportHeight: number): boolean {
  return barBottom + MORE_MENU_GAP + menuHeight > viewportHeight;
}

/**
 * 开合「⋯」菜单：就地切类、**不重画**（重画会把手指底下的按钮换掉）。
 *
 * 打开时顺手量一下可用空间，放不下就加 `is-more-up` 让它向上弹；
 * 收起时把这个类一起摘掉，免得下次打开还记着上一次的方向。
 * 返回开合之后的状态。
 */
export function toggleMoreMenu(bar: HTMLElement | null, viewportHeight: number): boolean {
  if (!bar) return false;
  const open = bar.classList.toggle('is-more');
  if (!open) {
    bar.classList.remove('is-more-up');
    return false;
  }
  const menu = bar.querySelector<HTMLElement>('.bzs-tb-more');
  /* 菜单刚被打开，同一帧里能量到它的高度（display 已经从 none 换成 flex） */
  const menuHeight = menu?.getBoundingClientRect().height ?? 0;
  const bottom = bar.getBoundingClientRect().bottom;
  bar.classList.toggle('is-more-up', moreMenuOpensUp(bottom, menuHeight, viewportHeight));
  return true;
}

export interface ToolbarHtmlInput extends ToolbarLayoutInput {
  /** 当前笔色（已有划线时给色点加圈） */
  color?: string;
  colors?: readonly ToolbarColor[];
  /** 当前打开的面板：对应的按钮亮起 */
  active?: string | null;
  acts?: ToolbarActs;
  /** 额外挂在每颗按钮上的 data-*（点划线要带 data-id / data-book） */
  attrs?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

const DEFAULT_COLORS: readonly ToolbarColor[] = [
  { value: 'amber', label: '琥珀', css: '#e8b53a' },
  { value: 'vermilion', label: '朱红', css: '#e2571c' },
  { value: 'green', label: '松绿', css: '#4f9a63' },
  { value: 'blue', label: '黛蓝', css: '#4a83d0' },
];

/**
 * 整枚工具条（不含定位外壳）。
 *
 * ```html
 * <div class="bzs-tb">
 *   ● ● ● ● ｜ 想法 书摘 AI [⋯] ｜ 删除
 * </div>
 * ```
 *
 * 「⋯」菜单常驻在 DOM 里、默认收起：点开只是给胶囊加一个 `is-more`，
 * 不重新渲染——重画会把正在按住的手指下面的按钮换掉。
 */
export function toolbarHtml(input: ToolbarHtmlInput): string {
  const colors = input.colors ?? DEFAULT_COLORS;
  const acts = input.acts ?? SELECTION_ACTS;
  const attrs = input.attrs ? ` ${input.attrs.trim()}` : '';
  const { visible, overflow } = toolbarLayout(input);
  const active = input.active ?? '';
  const actOf = (k: string): string => (acts as unknown as Record<string, string>)[k] ?? '';

  const dots = colors
    .map(
      (c) =>
        `<button type="button" class="bzs-pendot${c.value === input.color ? ' on' : ''}" data-act="${esc(
          acts.dot,
        )}" data-v="${esc(c.value)}"${attrs} style="background:${esc(c.css)}" aria-label="${esc(
          c.label,
        )}" title="${esc(c.label)}"></button>`,
    )
    .join('');

  const btn = (item: ToolbarItem): string => {
    const cls = [
      'bzs-sbtn',
      item.act === 'idea' ? 'pri' : '',
      item.danger ? 'danger' : '',
      active === item.act ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<button type="button" class="${cls}" data-act="${esc(actOf(item.act))}"${attrs}>${esc(
      item.label,
    )}</button>`;
  };

  const parts = [dots, '<span class="div"></span>', visible.map(btn).join('')];
  if (overflow.length) {
    parts.push(
      `<button type="button" class="bzs-sbtn more" data-act="${MORE_ACT}" aria-label="更多" aria-haspopup="menu" aria-expanded="false">⋯</button>`,
      `<div class="bzs-tb-more" role="menu">${overflow
        .map(
          (item) =>
            `<button type="button" class="bzs-tb-mi${item.danger ? ' danger' : ''}" data-act="${esc(
              actOf(item.act),
            )}"${attrs}>${esc(item.label)}</button>`,
        )
        .join('')}</div>`,
    );
  }
  return `<div class="bzs-tb" role="toolbar" aria-label="划词工具">${parts.join('')}</div>`;
}
