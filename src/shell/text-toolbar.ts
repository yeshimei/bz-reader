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

import { t, type MsgKey } from '../i18n';
import { HIGHLIGHT_COLORS, colorLabel } from '../data/notes';
import { esc } from './render/html';

export interface ToolbarColor {
  value: string;
  css: string;
}

export type ToolbarAct = 'idea' | 'quote' | 'ai' | 'term' | 'passage' | 'bilink' | 'copy' | 'del';

export interface ToolbarItem {
  act: ToolbarAct;
  /** 按钮字按当前界面语言现取（`t(key)`）——常量字符串切完语言不更新 */
  key: MsgKey;
  /**
   * 图标模式下用的宿主图标名（lucide / Obsidian 那一套）。
   *
   * 名字交给 `setIcon` 画，本文件不关心路径——这样主题换了描边、Obsidian 换了
   * 图标集，工具条都跟着走，不会出现「自绘的近似图形和旁边原生图标不是一个东西」。
   */
  icon: string;
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
  { act: 'idea', key: 'tool.idea', icon: 'lightbulb' },
  { act: 'quote', key: 'tool.quote', icon: 'quote' },
  { act: 'ai', key: 'tool.ai', icon: 'sparkles' },
  { act: 'bilink', key: 'tool.bilink', icon: 'link-2' },
  { act: 'copy', key: 'tool.copy', icon: 'copy' },
];

/**
 * 「存为名词 / 存为段落」——只有 AI 知识库打开时才出现。
 *
 * 放在 AI 右边：它们是「把这段交给 AI 之前先存起来」的动作，比双链 / 复制
 * 更靠近 AI；两个四字按钮也是整排里最宽的一对，放中间比放两头更不容易
 * 把色点挤变形。
 */
export const KB_ITEMS: readonly ToolbarItem[] = [
  { act: 'term', key: 'tool.term', icon: 'book-type' },
  { act: 'passage', key: 'tool.passage', icon: 'align-left' },
];

/** 基础项里插入知识库两颗之后的那一整排（顺序即最终顺序） */
export function toolbarItems(kb?: boolean): ToolbarItem[] {
  if (!kb) return [...TOOLBAR_ITEMS];
  const at = TOOLBAR_ITEMS.findIndex((i) => i.act === 'ai');
  return [...TOOLBAR_ITEMS.slice(0, at + 1), ...KB_ITEMS, ...TOOLBAR_ITEMS.slice(at + 1)];
}

export const DELETE_ITEM: ToolbarItem = { act: 'del', key: 'tool.del', icon: 'trash-2', danger: true };

/**
 * 已存过知识盒的那两颗：文案换成「看名词 / 看段落」。
 *
 * 动作名不变——同一个 data-act 由动作表自己判断「存过就打开、没存过就录入」；
 * 这里只负责把字换掉，所以旧 DOM、旧点击路径都不用重学。
 */
const KB_VIEW_KEYS: Partial<Record<ToolbarAct, MsgKey>> = {
  term: 'tool.termView',
  passage: 'tool.passageView',
};

/** 手机上还留在胶囊上的主路径颗数：想法 / 书摘 / AI */
const COMPACT_MAIN = 3;

export interface ToolbarLayoutInput {
  /** 已有划线：多一颗删除 */
  marked: boolean;
  /** 手机：主路径 + ⋯ */
  compact?: boolean;
  /** AI 知识库开着：多出「存为名词 / 存为段落」两颗 */
  kb?: boolean;
  /**
   * 窄窗口：放不下七颗时，把知识库那两颗收进「⋯」。
   *
   * 不按平台硬分：桌面窄到 400px 时七颗按钮同样会挤成一团，
   * 而手机横屏反而放得下。判据是「宽度够不够」，不是「是不是手机」。
   */
  narrow?: boolean;
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
  const del = marked ? [DELETE_ITEM] : [];
  const items = toolbarItems(input.kb);
  if (input.compact) {
    return {
      visible: items.slice(0, COMPACT_MAIN),
      overflow: [...items.slice(COMPACT_MAIN), ...del],
    };
  }
  if (input.narrow && input.kb) {
    /* 主路径（想法 / 书摘 / AI / 双链 / 复制）留在胶囊上，知识库两颗进菜单：
       窄窗里最先牺牲的应该是「用得少」而不是「用得急」。 */
    return {
      visible: [...items.filter((i) => !KB_ITEMS.some((k) => k.act === i.act)), ...del],
      overflow: [...KB_ITEMS],
    };
  }
  return { visible: [...items, ...del], overflow: [] };
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
  term?: string;
  passage?: string;
  bilink?: string;
  copy?: string;
  del?: string;
}

export const SELECTION_ACTS: ToolbarActs = {
  dot: 'selpen',
  idea: 'selidea',
  quote: 'selquote',
  ai: 'selai',
  term: 'selterm',
  passage: 'selpassage',
  bilink: 'selbilink',
  copy: 'selcopy',
};

export const MARK_ACTS: ToolbarActs = {
  dot: 'hlcolor',
  idea: 'hlidea',
  quote: 'hlquote',
  ai: 'hlai',
  term: 'hlterm',
  passage: 'hlpassage',
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
  /** 图标模式：只画图标，文案进 title / aria-label */
  icon?: boolean;
  /**
   * 这条划线已经存进知识盒的格子：对应按钮从「存为名词」变「看名词」。
   *
   * 只影响文案，`data-act` 不变——动作表自己会判断「存过就打开」。
   */
  kbDone?: Partial<Record<'term' | 'passage', boolean>>;
}

/* 转义只有一份：render/html.ts 的 esc（D8）。这里原先自己抄了一份，
   两份一旦分叉，注入就落在少转义的那一份上。 */

/* 颜色名不再随配置走：`colorLabel()` 按当前界面语言取，语言切了重画就是新的，
   所以这里只需要色值本身（与 data/notes 的 HIGHLIGHT_COLORS 同源）。 */
const DEFAULT_COLORS: readonly ToolbarColor[] = HIGHLIGHT_COLORS;

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
          colorLabel(c.value),
        )}" title="${esc(colorLabel(c.value))}"></button>`,
    )
    .join('');

  const labelOf = (item: ToolbarItem): string => {
    const viewKey = KB_VIEW_KEYS[item.act];
    return t(viewKey && input.kbDone?.[item.act as 'term' | 'passage'] ? viewKey : item.key);
  };

  const btn = (item: ToolbarItem): string => {
    const cls = [
      'bzs-sbtn',
      item.act === 'idea' ? 'pri' : '',
      item.danger ? 'danger' : '',
      active === item.act ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const label = labelOf(item);
    if (input.icon) {
      return `<button type="button" class="${cls}" data-act="${esc(actOf(item.act))}" aria-label="${esc(
        label,
      )}" title="${esc(label)}"${attrs}><span class="bzs-tbi" data-icon="${esc(item.icon)}"></span></button>`;
    }
    return `<button type="button" class="${cls}" data-act="${esc(actOf(item.act))}"${attrs}>${esc(label)}</button>`;
  };

  const parts = [dots, '<span class="div"></span>', visible.map(btn).join('')];
  if (overflow.length) {
    const more = input.icon
      ? `<span class="bzs-tbi" data-icon="more-horizontal"></span>`
      : '⋯';
    parts.push(
      `<button type="button" class="bzs-sbtn more" data-act="${MORE_ACT}" aria-label="${t('tool.more')}" aria-haspopup="menu" aria-expanded="false">${more}</button>`,
      `<div class="bzs-tb-more" role="menu">${overflow
        .map(
          /* 菜单项保持文字：菜单里空间够，图标反而要多想一下 */
          (item) =>
            `<button type="button" class="bzs-tb-mi${item.danger ? ' danger' : ''}" data-act="${esc(
              actOf(item.act),
            )}"${attrs}>${esc(labelOf(item))}</button>`,
        )
        .join('')}</div>`,
    );
  }
  return `<div class="bzs-tb${input.icon ? ' is-icon' : ''}" role="toolbar" aria-label="${t('tool.aria')}">${parts.join(
    '',
  )}</div>`;
}
