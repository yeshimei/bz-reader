/* ============================================================
 * bz-reader · 复习卡（data/review-card.ts）
 *
 * 一条划线 → 一篇能进 bz 复习计划的笔记。tz 的复习是「按笔记复习」：
 * 排期表里存的是文件路径，复习时直接打开那篇文件自评。所以这里产出的
 * 不是一个数据对象，而是一份**人也能读的 Markdown**。
 *
 * 四条取舍（都是「复习时只扫一眼」推出来的）：
 *   1. **短**：标题 + 一行原文 + 出处。复习不是重读，信息多了只会划过去
 *      「哦我读过」然后点「容易」，排期就失真了。
 *   2. **认得出**：标题是「书名 · 章节」，frontmatter 带 bookId 与划线 id，
 *      用户改名、移动文件之后机器仍能反查回是哪一条。
 *   3. **跳得回去**：正文留一条回到原文的双链（与导出同一套 wikilink），
 *      复习时想起上下文就点一下。
 *   4. **认得出是自己写的**：末尾一行标记。重新生成时靠它判断「这篇能不能
 *      覆盖」——用户手写的内容被一次点击冲掉是灾难。
 *
 * 纯函数，不碰 vault、不碰 Obsidian。写盘与调 bz 门面在 shell/actions。
 * ============================================================ */
import { formatDay, oneLine, safeName, yamlStr } from './export';
import { t } from '../i18n';

/** 末尾标记：下次生成靠它认「这篇是我们写的」 */
export const REVIEW_CARD_MARK = '<!-- bz-reader:review-card -->';

/** 文件名最长这么多字：再长在文件列表里就只剩省略号了 */
const NAME_MAX = 24;

export interface ReviewCardInput {
  /** 书名（meta.title，已由调用方兜底成「未命名」） */
  bookTitle: string;
  /** 书 id（数据里的 book.id） */
  bookId: string;
  /** 划线 id（数据里的 highlight.id） */
  highlightId: string;
  /** 划线原文 */
  text: string;
  /** 想法（有才写） */
  comment?: string;
  /**
   * 自测题（2026-11-10，可选）。
   *
   * 由用户在菜单里明确点了「AI 出题」才传：**不自动调用 AI** 是这张卡
   * 从第一天起就守着的边界，这条同样不例外。
   */
  question?: string;
  /** 章节名（没有就只写书名） */
  chapterTitle?: string;
  /** 回到原文的双链（data/wikilink.ts 的 wikilinkOfMark 产出；空串不出那一行） */
  backlink: string;
  /** 生成时间（毫秒戳，写进 frontmatter 的日期） */
  createdAt: number;
}

/**
 * 文件名：直接用划线本身。
 *
 * 不用「书名-序号」：用户在 Obsidian 里搜一句话，命中的应该是那张卡，
 * 而不是一页「活着-003」。压空白但**不消中文之间的空格**——那是导出的
 * 排版口径，文件名里保留空格更像原句。
 */
export function reviewCardName(input: Pick<ReviewCardInput, 'text'>): string {
  const one = String(input.text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(one);
  const cut = chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join('') : one;
  /* 空划线的兜底名走语言包：它会出现在文件列表里，是用户看得见的一行字 */
  return safeName(cut, t('common.untitled'));
}

/** 整份卡片 Markdown（frontmatter + 正文 + 标记） */
export function buildReviewCard(input: ReviewCardInput): string {
  const title = yamlStr(input.bookTitle);
  const book = oneLine(String(input.bookTitle ?? '').trim() || t('common.untitled'));
  const chapter = oneLine(String(input.chapterTitle ?? '').trim());
  const lines: string[] = [];

  lines.push('---');
  lines.push(`book: ${title}`);
  lines.push(`bookId: ${yamlStr(input.bookId)}`);
  lines.push(`highlight: ${yamlStr(input.highlightId)}`);
  lines.push(`created: ${formatDay(input.createdAt)}`);
  lines.push('---');
  lines.push('');
  /* 章节名可能带换行（EPUB 标题常被拆成两行），直接拼进 `# ` 会把下半句
     变成正文段落——oneLine 已经压平过了 */
  lines.push(chapter ? `# ${book} · ${chapter}` : `# ${book}`);
  lines.push('');
  /* 自测题（2026-11-10）：放在原文**之前**——复习的顺序是先看题、自己想，
     再往下看原文自评。反过来题目就成了读后感的标题，回忆被跳过。 */
  const question = oneLine(String(input.question ?? '').trim());
  if (question) {
    lines.push(`**${t('review.card.ask')}**`);
    lines.push('');
    lines.push(question);
    lines.push('');
  }

  lines.push(`> ${oneLine(input.text)}`);
  lines.push('');

  const comment = String(input.comment ?? '').trim();
  if (comment) {
    lines.push(`**${t('review.card.idea')}**`);
    lines.push('');
    lines.push(comment);
    lines.push('');
  }

  const back = String(input.backlink ?? '').trim();
  if (back) {
    lines.push(`${t('review.card.back')}${back}`);
    lines.push('');
  }

  lines.push(REVIEW_CARD_MARK);
  return lines.join('\n');
}

/**
 * 这份已有文件是不是本插件为**同一条划线**写的。
 *
 * 只认两样都对得上：末行标记 + frontmatter 里的 highlight id。同名不同卡
 * （两条划线开头一模一样）时宁可另存一份，也不能把别人的卡片覆盖掉。
 */
export function isOurCardOf(markdown: string, highlightId: string): boolean {
  const text = String(markdown ?? '');
  if (!text.includes(REVIEW_CARD_MARK)) return false;
  const fm = text.startsWith('---') ? text.slice(0, text.indexOf('\n---', 3)) : '';
  const m = /^highlight:\s*(.+)$/m.exec(fm);
  if (!m) return false;
  let v = m[1].trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v === highlightId;
}
