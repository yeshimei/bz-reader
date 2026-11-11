/* ============================================================
 * bz-reader · 按意思搜的结果呈现（shell/render/semantic.ts）
 *
 * 一份结果，三个出口：命令面板的跨书搜索弹窗、书架搜索页、阅读页搜索浮层。
 * 以前这段「按书分组 + 行内截断 + 章名小字」只写在 ui/semantic-panel.ts 里，
 * 两个新入口再抄一遍就会三处各长一副样子。这里只做纯字符串：
 *   · 状态句（提示 / 正在搜 / 原因 / 找到几条）；
 *   · 按书分组的命中行，行上带 data-act / data-idx，点击由各宿主自己接。
 * 样式沿用 `bzr-xs-*`：它本来就是这套跨书搜索的语汇，弹窗与搜索页共用。
 * ============================================================ */
import type { SemanticHit } from '../../data/book-search';
import type { ReaderBook } from '../../data/schema';
import { t } from '../../i18n';
import type { SearchSurface } from '../search-semantic';
import { esc } from './html';

/** 结果行里最多露多少字：够认出是哪一段，又不至于把面板撑成阅读器 */
export const SEMANTIC_ROW_CHARS = 90;

export interface SemanticView {
  /** 这一轮检索的词（空串 = 还没搜） */
  kw: string;
  running: boolean;
  /** 是否已经真正跑过一轮（区分「没按回车」与「跑完 0 条」） */
  ran: boolean;
  hits: readonly SemanticHit[];
  /** 不能搜的原因（没建画像 / 没激活 / 嵌入服务挂了） */
  problem: string | null;
  /** 参与检索的书本数 */
  books: number;
}

/** 摘录压成一行，过长截断 */
export function semanticRowText(chunk: string): string {
  const flat = String(chunk ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > SEMANTIC_ROW_CHARS ? `${flat.slice(0, SEMANTIC_ROW_CHARS)}…` : flat;
}

/**
 * 状态句：先给「为什么不能用」，再说进度 / 结果。
 *
 * 没建画像、没激活、嵌入服务不可用都从 `problem` 进来——这些是用户能处理
 * 的事，不能折成一句「没有找到」。
 */
export function semanticStatusText(v: SemanticView, surface: SearchSurface, hasBook: boolean): string {
  if (surface === 'book' && !hasBook) return t('search.needBook');
  if (v.problem) return v.problem;
  if (!v.kw) return t('search.semantic.hint');
  if (v.running) return t('search.semantic.searching');
  if (!v.ran) return t('search.semantic.hint');
  if (!v.hits.length) return t('search.semantic.empty', { n: v.books });
  return surface === 'book'
    ? t('search.semantic.foundOne', { n: v.hits.length })
    : t('search.semantic.found', { n: v.hits.length, books: v.books });
}

/**
 * 按书分组。
 *
 * 接口已按分数排好，这里只把同书的归到一起，不重排——跨查询的分数不可比，
 * 但同一次返回里的先后是有意义的。`data-idx` 是这一条在原始 hits 里的下标，
 * 动作层靠它取回完整片段（行里只露截断后的一段）。
 */
export function semanticGroupsHtml(hits: readonly SemanticHit[], books: readonly ReaderBook[]): string {
  const byBook = new Map<string, Array<{ hit: SemanticHit; idx: number }>>();
  (hits ?? []).forEach((hit, idx) => {
    if (!hit) return;
    const id = String(hit.bookId ?? '');
    const list = byBook.get(id) ?? [];
    list.push({ hit, idx });
    byBook.set(id, list);
  });

  const groups: string[] = [];
  for (const [bookId, list] of byBook) {
    const book = books.find((b) => b.id === bookId);
    const title = book?.meta.title || list[0]?.hit.title || t('common.untitled');
    const rows = list
      .map(({ hit, idx }) => {
        const loc = hit.chapter ? `<span class="bzr-xs-loc">${esc(hit.chapter)}</span>` : '';
        return `<div class="bzr-xs-hit" role="button" tabindex="0" data-act="semhittotext" data-book="${esc(
          hit.bookId,
        )}" data-idx="${idx}">${loc}${esc(semanticRowText(hit.chunk))}</div>`;
      })
      .join('');
    groups.push(`<div class="bzr-xs-group"><span class="bzr-xs-group-t">${esc(title)}</span>${rows}</div>`);
  }
  return groups.join('');
}

/**
 * 搜索页 / 搜索浮层里的整块结果。
 *
 * 状态句永远在（哪怕没有命中），不静默失败；`is-inline` 去掉弹窗那份
 * 固定高度与内边距，让它像普通结果列表一样跟着页面流。
 */
export function semanticResultsHtml(
  v: SemanticView,
  books: readonly ReaderBook[],
  surface: SearchSurface,
  hasBook: boolean,
): string {
  const status = esc(semanticStatusText(v, surface, hasBook));
  const groups = v.hits.length ? semanticGroupsHtml(v.hits, books) : '';
  return `<div class="bzr-xs is-inline"><div class="bzr-xs-status">${status}</div><div class="bzr-xs-hits">${groups}</div></div>`;
}
