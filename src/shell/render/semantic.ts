/* ============================================================
 * bz-reader · 按意思搜的结果呈现（shell/render/semantic.ts）
 *
 * 一份结果，三个出口：命令面板的跨书搜索弹窗、书架搜索页、阅读页搜索浮层。
 * 以前这段「按书分组 + 行内截断 + 章名小字」只写在 ui/semantic-panel.ts 里，
 * 两个新入口再抄一遍就会三处各长一副样子。这里只做纯字符串：
 *   · 状态句（提示 / 正在搜 / 原因 / 找到几条）；
 *   · 按书分组的命中行，行上带 data-act / data-idx，点击由各宿主自己接。
 *
 * 2026-11-16（检索台改版）：搜索页与搜索浮层不再沿用 `bzr-xs-*` 的旧列表，
 * 改成与字面结果同一套书卡；`semanticGroupsHtml` 仍留给命令面板，别动。
 * 相关度是**本次结果内归一化**的四道小格：最高分 4 格、最低 1 格。
 * 跨查询的分数不可比，不能拿绝对阈值卡档。
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

/** 分布条 / 书脊的色阶：与字面结果同一公式（第 1 本最深） */
function tone(index: number): string {
  if (index <= 0) return 'var(--copper)';
  if (index === 1) return 'var(--copper-2)';
  return 'var(--copper-3)';
}

/** 相关度分档：本次结果内归一化，最高 4 格、最低 1 格 */
function levelOf(score: number, min: number, max: number): number {
  if (!Number.isFinite(score)) return 1;
  if (max <= min) return 4;
  return Math.max(1, Math.min(4, Math.round(1 + (3 * (score - min)) / (max - min))));
}

function semCardsHtml(v: SemanticView, books: readonly ReaderBook[]): string {
  const byBook = new Map<string, Array<{ hit: SemanticHit; idx: number }>>();
  (v.hits ?? []).forEach((hit, idx) => {
    if (!hit) return;
    const id = String(hit.bookId ?? '');
    const list = byBook.get(id) ?? [];
    list.push({ hit, idx });
    byBook.set(id, list);
  });
  const scores = v.hits.map((h) => Number(h.score)).filter((n) => Number.isFinite(n));
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 0;

  const groups: string[] = [];
  let index = 0;
  for (const [bookId, list] of byBook) {
    const book = books.find((b) => b.id === bookId);
    const title = book?.meta.title || list[0]?.hit.title || t('common.untitled');
    const author = book?.meta.author?.trim() || '';
    const rows = list
      .map(({ hit, idx }) => {
        const level = levelOf(Number(hit.score), min, max);
        const bars = [1, 2, 3, 4]
          .map((n) => `<i class="${n <= level ? 'on' : ''}"></i>`)
          .join('');
        return `<div class="bzs-srch-hit bzs-srch-semrow" role="button" tabindex="0" data-act="semhittotext" data-book="${esc(
          hit.bookId,
        )}" data-idx="${idx}">
          <span class="bzs-srch-sig">${bars}</span>
          <span class="bzs-srch-tx">${esc(semanticRowText(hit.chunk))}</span>
          <span class="bzs-srch-loc">${esc(hit.chapter ?? '')}</span>
          <span class="bzs-srch-go">↗</span>
        </div>`;
      })
      .join('');
    groups.push(`<section class="bzs-srch-book">
      <div class="bzs-srch-bhead">
        <span class="bzs-srch-spine" style="--tone:${tone(index)}"></span>
        <div class="bzs-srch-bt"><b>${esc(title)}</b>${author ? `<span>${esc(author)}</span>` : ''}</div>
        <span class="bzs-srch-cnt">${esc(t('search.count.passages', { n: list.length }))}</span>
        <button type="button" class="bzs-srch-open" data-act="openbook" data-id="${esc(
          bookId,
        )}">${esc(t('search.open'))} ↗</button>
      </div>
      <div class="bzs-srch-rows">${rows}</div>
    </section>`);
    index += 1;
  }
  return groups.join('');
}

/**
 * 搜索页 / 搜索浮层里的整块语义结果。
 *
 * 状态句永远在（哪怕没有命中），不静默失败；有命中时统计行 + 提示 + 书卡，
 * 与字面结果同一套语汇。书卡的 `data-act`（翻到那一段 / 打开书）由宿主接。
 */
export function semanticResultsHtml(
  v: SemanticView,
  books: readonly ReaderBook[],
  surface: SearchSurface,
  hasBook: boolean,
): string {
  if (surface === 'book' && !hasBook) {
    return `<div class="bzs-empty">${esc(t('search.needBook'))}</div>`;
  }
  /* 不能搜的时候给一条出口（2026-11-16）：以前这里只有一句原因，
     用户看到的就是「这个词搜不了」。同一个词用字面搜索是现成的能力——
     没画像、服务挂了、没激活，三种情况都该让人一键换条路，而不是卡死。 */
  if (v.problem) {
    return `<div class="bzs-srch-miss">
      <div class="bzs-srch-mark">“</div>
      <h3>${esc(v.problem)}</h3>
      <p>${esc(t('search.sem.literal.hint'))}</p>
      <div class="bzs-srch-acts">
        <button type="button" data-act="searchmode" data-v="literal">${esc(
          t('search.semantic.literal'),
        )}</button>
      </div>
    </div>`;
  }
  if (!v.kw) return `<div class="bzs-srch-semstatus">${esc(t('search.semantic.hint'))}</div>`;
  if (v.running) return `<div class="bzs-srch-semstatus">${esc(t('search.semantic.searching'))}</div>`;
  if (!v.ran) return `<div class="bzs-srch-semstatus">${esc(t('search.semantic.hint'))}</div>`;
  if (!v.hits.length) {
    return `<div class="bzs-srch-miss">
      <div class="bzs-srch-mark">“</div>
      <h3>${esc(t('search.semantic.empty', { n: v.books }))}</h3>
      <p>${esc(t('search.sem.hint'))}</p>
      <div class="bzs-srch-acts">
        <button type="button" data-act="searchmode" data-v="literal">${esc(
          t('search.semantic.literal'),
        )}</button>
        <button type="button" data-act="searchclear">${esc(t('search.clear'))}</button>
      </div>
    </div>`;
  }

  const total = v.hits.length;
  const cards = semCardsHtml(v, books);
  const bookCount = new Set(v.hits.map((h) => String(h.bookId ?? ''))).size;
  return `<div class="bzs-srch-sum">${t('search.sem.total', {
    n: `<b>${total}</b>`,
  })}<span class="bzs-srch-sep">·</span>${t('search.sum.books', {
    n: `<b>${bookCount}</b>`,
  })}<button type="button" class="bzs-srch-clr" data-act="searchclear">${esc(
    t('search.clear'),
  )}</button></div>
  <div class="bzs-srch-semhint">${esc(t('search.sem.hint'))}</div>
  ${cards}`;
}
