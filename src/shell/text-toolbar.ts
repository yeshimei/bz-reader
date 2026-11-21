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

export type ToolbarAct =
  | 'ocr'
  | 'idea'
  | 'quote'
  | 'review'
  | 'ai'
  | 'term'
  | 'passage'
  | 'bilink'
  | 'copy'
  | 'del';

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
  /* 加入复习（2026-11-16）：紧跟「书摘」——两者都是「把这段留下来」，
     只是书摘留在库里、复习交给 bz Review 排期。 */
  { act: 'review', key: 'tool.review', icon: 'layers' },
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

/**
 * 整排按钮（顺序即最终顺序）。
 *
 * 知识盒两颗插在 AI 之后：它们都是「把这段文字加工成别的东西」，
 * 双链 / 复制这类「搬出去」的动作仍在右边。
 *
 * 2026-11-21：「复习」不再随装了没装隐藏——没装 / 没启用也照样出现，
 * 点了由入口层引导去设置页安装。工具条不再需要一个 `review` 开关。
 */
export function toolbarItems(kb?: boolean): ToolbarItem[] {
  let items = [...TOOLBAR_ITEMS];
  if (kb) {
    const at = items.findIndex((i) => i.act === 'ai');
    items = [...items.slice(0, at + 1), ...KB_ITEMS, ...items.slice(at + 1)];
  }
  return items;
}

export const DELETE_ITEM: ToolbarItem = { act: 'del', key: 'tool.del', icon: 'trash-2', danger: true };

/**
 * 扫描页框选时的「识别」。
 *
 * 不出现在普通划词条里：有文字层的页能直接划词，这一颗只会让用户以为
 * 要「转换」什么。只在 PDF 框选（`only: ['ocr', ...]`）时插到最左——
 * 那一刻用户想做的第一件事就是「让这块能选」。
 *
 * 点下去认**整页**，不是框里那一块：只有整页都有文字层，之后才能在页面上
 * 任意划线；只认一块的话，出了这块就又不能选了。
 */
export const OCR_ITEM: ToolbarItem = { act: 'ocr', key: 'tool.ocr', icon: 'scan' };

/**
 * 框选矩形（没有原文的标注）的工具条只留这几颗。
 *
 * 未保存的框选：识别 / 想法 / 双链；保存之后再点开，`marked` 会自动补一颗
 * 删除。书摘 / AI / 存为名词 / 存为段落 / 复制都要原文，框里没有，一颗都
 * 不出现——露出来就是「点了没反应」。
 *
 * 只按定位串里的 `/r=` 判断，普通划词与普通划线一个字不动；EPUB 上根本
 * 不会出现这个形状。
 */
export const REGION_ACTS: readonly ToolbarAct[] = ['ocr', 'idea', 'bilink'];

/** 定位串里带 `/r=` 的是框选矩形（`pdf/<页>/r=…`），不是文字划线 */
export function isRegionLocator(cfiRange?: string | null): boolean {
  return !!cfiRange && cfiRange.includes('/r=');
}

/** 工具条的 `only`：区域框收窄，其余返回 undefined（显示全部） */
export function onlyForRegion(cfiRange?: string | null): readonly ToolbarAct[] | undefined {
  return isRegionLocator(cfiRange) ? REGION_ACTS : undefined;
}

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
   * 已废弃（2026-11-21）：「复习」改成常显，装没装都不再影响排布。
   * 字段保留只为老调用点不报错；新代码不要再传。
   */
  review?: boolean;
  /**
   * 窄窗口：放不下七颗时，把知识库那两颗收进「⋯」。
   *
   * 不按平台硬分：桌面窄到 400px 时七颗按钮同样会挤成一团，
   * 而手机横屏反而放得下。判据是「宽度够不够」，不是「是不是手机」。
   */
  narrow?: boolean;
  /**
   * 只保留这几颗动作：PDF 框选没有文字，书摘 / AI / 名词 / 段落无从下手，
   * 只留「识别 / 想法 / 双链」；保存后的「删除」由 marked 单独追加。
   */
  only?: readonly ToolbarAct[];
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
  /* `only` 过一遍：不在这几颗里的动作连按钮都不出现，免得点了没反应 */
  const items = toolbarItems(input.kb).filter(
    (i) => !input.only || input.only.includes(i.act),
  );
  /* 扫描页框选：把「识别」插到最左（它就是这一刻的主路径），
     其余两颗（双链 / 复制）不动。 */
  if (input.only?.includes('ocr')) items.unshift(OCR_ITEM);
  if (input.compact) {
    return {
      visible: items.slice(0, COMPACT_MAIN),
      overflow: [...items.slice(COMPACT_MAIN), ...del],
    };
  }
  /* 窄窗里先牺牲「用得少」的：知识盒两颗进「⋯」，顺序与摊开时一致——
     用户从菜单里找同一颗按钮，位置不该变。 */
  const extras: ToolbarItem[] = [...(input.kb ? KB_ITEMS : [])];
  if (input.narrow && extras.length) {
    return {
      visible: [...items.filter((i) => !extras.some((k) => k.act === i.act)), ...del],
      overflow: extras,
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
  /** 扫描页框选时的「识别本页」 */
  ocr?: string;
  idea?: string;
  quote?: string;
  /** 加入复习（划词时先落一条划线再加；点划线时直接加那一条） */
  review?: string;
  ai?: string;
  term?: string;
  passage?: string;
  bilink?: string;
  copy?: string;
  del?: string;
}

export const SELECTION_ACTS: ToolbarActs = {
  dot: 'selpen',
  ocr: 'selocr',
  idea: 'selidea',
  quote: 'selquote',
  review: 'selreview',
  ai: 'selai',
  term: 'selterm',
  passage: 'selpassage',
  bilink: 'selbilink',
  copy: 'selcopy',
};

export const MARK_ACTS: ToolbarActs = {
  dot: 'hlcolor',
  /* 已划好的框选上也要能「识别本页」：点开那块矩形，第一件事通常还是让这页有点字 */
  ocr: 'hlocr',
  idea: 'hlidea',
  quote: 'hlquote',
  review: 'hlreview',
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
  /**
   * 这条划线已经在复习计划里：按钮按到期状态显示「去复习 / 已排期」。
   * data-act 仍是同一个，但动作层会分流——已加入的跳去 Review，不再重复加入。
   */
  reviewPlanned?: boolean;
  /** 下次复习状态：逾期 / 今天 / 未来，由 Review 的 nextReviewDate 算出来 */
  reviewDue?: 'overdue' | 'today' | 'future' | null;
  /** 距下次复习的天数（逾期取正数，今天为 0） */
  reviewDays?: number | null;
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
        )}" data-v="${esc(c.value)}"${attrs} style="background:${esc(c.css)}"><span class="bzs-sr-only">${esc(
          colorLabel(c.value),
        )}</span></button>`,
    )
    .join('');

  const labelOf = (item: ToolbarItem): string => {
    if (item.act === 'review' && input.reviewPlanned) {
      if (input.reviewDue === 'overdue') return t('tool.reviewOverdue');
      if (input.reviewDue === 'today') return t('tool.reviewGo');
      const days = input.reviewDays;
      return days && days > 0
        ? `${t('tool.reviewScheduled')} ${t('tool.reviewDays', { n: String(days) })}`
        : t('tool.reviewScheduled');
    }
    const viewKey = KB_VIEW_KEYS[item.act];
    return t(viewKey && input.kbDone?.[item.act as 'term' | 'passage'] ? viewKey : item.key);
  };

  const btn = (item: ToolbarItem): string => {
    const cls = [
      'bzs-sbtn',
      item.act === 'idea' ? 'pri' : '',
      item.act === 'review' && input.reviewPlanned ? 'is-planned' : '',
      item.act === 'review' && input.reviewDue === 'overdue' ? 'is-overdue' : '',
      item.danger ? 'danger' : '',
      active === item.act ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const label = labelOf(item);
    const icon = item.act === 'review' && input.reviewPlanned ? 'calendar-check' : item.icon;
    if (input.icon) {
      return `<button type="button" class="${cls}" data-act="${esc(actOf(item.act))}"${attrs}><span class="bzs-sr-only">${esc(
        label,
      )}</span><span class="bzs-tbi" data-icon="${esc(icon)}"></span></button>`;
    }
    return `<button type="button" class="${cls}" data-act="${esc(actOf(item.act))}"${attrs}>${esc(label)}</button>`;
  };

  const parts = [dots, '<span class="div"></span>', visible.map(btn).join('')];
  if (overflow.length) {
    const more = input.icon
      ? `<span class="bzs-tbi" data-icon="more-horizontal"></span>`
      : '⋯';
    parts.push(
      `<button type="button" class="bzs-sbtn more" data-act="${MORE_ACT}" aria-haspopup="menu" aria-expanded="false"><span class="bzs-sr-only">${t('tool.more')}</span>${more}</button>`,
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
  return `<div class="bzs-tb${input.icon ? ' is-icon' : ''}" role="toolbar"><span class="bzs-sr-only">${t('tool.aria')}</span>${parts.join(
    '',
  )}</div>`;
}
