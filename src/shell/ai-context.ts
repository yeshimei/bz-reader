/* ============================================================
 * bz-reader · 侧栏 A 版：待发送上下文（shell/ai-context.ts）
 *
 * 「问全书」的输入条可以挂四类上下文：划线、当前正文、框选截图、库内笔记。
 * 这一层只做纯计算，不碰 DOM：
 *   · 拼给模型的那段提问（【上下文】…【问题】…）
 *   · chip 上显示的那截摘要（按字符数截断，中英文都算 1 个）
 *   · 发送按钮亮不亮（只有空白不算有内容，有上下文就算）
 *
 * 从这里往外只有两条路：render/sidebar.ts 把 chip 画出来，
 * shell/actions.ts 在发送时把上下文拼进 ask。
 * ============================================================ */

export type AiContextKind = 'quote' | 'body' | 'shot' | 'note';

/**
 * 截图框选的结果。阅读视图只负责「框到了什么」，怎么显示与怎么拼进提问
 * 由壳层决定。
 */
export interface AiShotCapture {
  /** 缩略图：PDF 是 data URL；EPUB 是序列化后的书页文档（sandbox iframe） */
  thumb: string;
  w: number;
  h: number;
  /** EPUB 快照定位用；PDF 没有 */
  geom?: AiShotGeom;
  /** 框选区里的文字：拼提问时当截图说明用（没有就不写） */
  text?: string;
}

/**
 * 截图快照的几何：把一个书页区域按 scale 缩进 thumbnail 时要它。
 *
 * `start` 是当前屏在整章横轴上的起点（EPUB 分页器 scrollLeft），
 * `pageW/pageH` 是一屏的尺寸，`x/y/w/h` 是框选区在这一屏里的位置。
 */
export interface AiShotGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  pageW: number;
  pageH: number;
  /** 位移轴：分页模式 x、滚动模式 y（只用于排查，渲染已在快照里转好） */
  axis?: 'x' | 'y';
}

export interface AiContextItem {
  kind: AiContextKind;
  /** 划线 / 正文的原文；笔记是标题 */
  text?: string;
  /** 划线出处、笔记路径、截图尺寸（`250 × 152`） */
  meta?: string;
  /**
   * 截图缩略图。PDF 是一张 data URL；EPUB 是序列化后的书页文档，
   * 由 render/sidebar.ts 装进 sandbox iframe。
   */
  thumb?: string;
  /** 笔记的库内路径 */
  path?: string;
  /** 正文的字数（插入那一刻算好，重绘不再扫一遍） */
  chars?: number;
  /** 截图几何（只给 EPUB 快照定位用） */
  shot?: AiShotGeom;
}

/** 单条上下文最多带多少字：一屏正文通常 800–1200 字，再长就是整章了 */
export const AI_CTX_ITEM_LIMIT = 1200;

/** 所有上下文加起来的字数上限。超了从尾部截断（后插入的让位） */
export const AI_CTX_TOTAL_LIMIT = 6000;

/** chip 上默认露多少个字（原型 A 版输入条是 10） */
export const AI_CTX_CHIP_CHARS = 10;

/** 一问的标签。调用方从 i18n 取，纯函数不内置中文，测试也好换语言 */
export interface AiPromptLabels {
  context: string;
  question: string;
  quote: string;
  body: string;
  shot: string;
  note: string;
  chars: (n: number) => string;
  onlyContext: string;
}

/** 按「人看到的字符」计数：中文、英文、emoji 都算 1 个 */
export function charCount(text: string | null | undefined): number {
  return Array.from(String(text ?? '')).length;
}
/**
 * 按字符数截断，超出补一个「…」。
 *
 * 不用 `String.slice`：它按 UTF-16 码元切，emoji 会被切成半个。
 */
export function clipChars(text: string | null | undefined, max: number): string {
  const chars = Array.from(String(text ?? ''));
  if (max <= 0) return '';
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}…`;
}

/** 一条上下文在提问里的标题行（不带序号与正文） */
function contextHead(item: AiContextItem, labels: AiPromptLabels): string {
  switch (item.kind) {
    case 'quote':
      return `${labels.quote}${item.meta ? ` · ${item.meta}` : ''}`;
    case 'body':
      return `${labels.body} · ${labels.chars(item.chars ?? charCount(item.text))}`;
    case 'shot':
      return `${labels.shot}${item.meta ? ` · ${item.meta}` : ''}`;
    case 'note':
      return `${labels.note}${item.text ? ` · ${clipChars(item.text, 120)}` : ''}`;
    default:
      return '';
  }
}

/**
 * 把待发送上下文拼成一段提问。
 *
 * 没有上下文 → 原样返回问题（一个字都不补，模型看到的就是用户打的）。
 * 有上下文 → `【上下文】…【问题】…`；只有上下文没打字时问题段落给占位句。
 * 顺序严格按插入顺序；单条超过 `AI_CTX_ITEM_LIMIT` 先截，整段超过
 * `AI_CTX_TOTAL_LIMIT` 再从头截断（尾部补「…」）。
 */
export function composeAiPrompt(
  items: readonly AiContextItem[],
  question: string,
  labels: AiPromptLabels,
): string {
  if (!items.length) return question;

  const blocks = items.map((item, index) => {
    const head = `${index + 1}. ${contextHead(item, labels)}`;
    if (item.kind === 'shot') {
      /* 截图没有图片通道，框选区里的文字就是模型能看到的全部内容 */
      const quoted = clipChars(item.text, AI_CTX_ITEM_LIMIT);
      return quoted ? `${head}\n${quoted}` : head;
    }
    if (item.kind === 'note') {
      const path = String(item.path ?? '').trim();
      return path ? `${head}\n${path}` : head;
    }
    const text = clipChars(item.text, AI_CTX_ITEM_LIMIT);
    return text ? `${head}\n${text}` : head;
  });

  let context = blocks.join('\n');
  if (charCount(context) > AI_CTX_TOTAL_LIMIT) {
    context = clipChars(context, AI_CTX_TOTAL_LIMIT);
  }

  const asked = question.trim() || labels.onlyContext;
  return `${labels.context}\n${context}\n${labels.question}\n${asked}`;
}

/**
 * chip 上那一截。
 *
 * 划线露原文前 `max` 个字；正文只报字数（正文有上千字，塞进 chip 只会把
 * 输入框顶高）；笔记露标题；截图用固定文案。
 */
export function ctxChipText(
  item: AiContextItem,
  labels: AiPromptLabels,
  max = AI_CTX_CHIP_CHARS,
): string {
  switch (item.kind) {
    case 'quote':
      return clipChars(item.text, max);
    case 'body':
      return `${labels.body} · ${labels.chars(item.chars ?? charCount(item.text))}`;
    case 'note':
      return clipChars(item.text, max);
    case 'shot':
      return labels.shot;
    default:
      return '';
  }
}

/** 发送按钮亮不亮：问题只有空白不算，有上下文就算 */
export function canSendAi(draft: string | null | undefined, items: readonly AiContextItem[]): boolean {
  return !!String(draft ?? '').trim() || items.length > 0;
}

/** 追加一条上下文；同一条重复插入不去重（原型也允许重复） */
export function addAiContext(
  items: readonly AiContextItem[],
  item: AiContextItem,
): AiContextItem[] {
  return [...items, item];
}
