/* ============================================================
 * bz-reader · 对话页（shell/render/history.ts）
 *
 * 原型：prototype/ai-history/index.html（两个 stage：按书 / 按时间）。
 * 这里只画 HTML，不碰 DOM、不写状态——动作全挂 `data-act`，由
 * shell/actions.ts 收口。
 *
 * 三种排法的分工：
 *   · 按书：默认视图。每本书一组，组头右侧是「导出本书」；
 *   · 按时间：回看用。今天 / 昨天 / 更早，组头一条日期线；
 *   · 筛选与搜索**先于**分组：两种排法吃的是同一份结果，切排法不改筛选。
 *
 * 统计带永远按**全量**算，不跟着筛选变：它是「我一共攒了多少」，
 * 不是「当前这一屏有多少」。
 * ============================================================ */
import type { AiSession, AiSessionKind } from '../../data/ai-session';
import { aiKindLabel } from '../../data/ai-session';
import { t, type MsgKey } from '../../i18n';
import { safeName } from '../../data/export';
import { MAG, esc } from './html';

export type AiGroupBy = 'book' | 'time';
export type AiKindFilter = 'all' | AiSessionKind;

/** 卡片顶那一段类型色：解释跟着强调色走，其余四色是原型定稿值 */
const KIND_COLOR: Record<AiSessionKind, string> = {
  explain: 'var(--copper)',
  translate: '#3f6d9e',
  summarize: '#3f7a52',
  follow: '#7a5a8e',
  book: '#a67c2e',
};

/** 类型 chips：`all` 在最前，其余按原型顺序 */
export const AI_KIND_CHIPS: Array<[AiKindFilter, MsgKey]> = [
  ['all', 'shelf.ai.kind.all'],
  ['explain', 'shelf.ai.kind.explain'],
  ['translate', 'shelf.ai.kind.translate'],
  ['summarize', 'shelf.ai.kind.summarize'],
  ['follow', 'shelf.ai.kind.follow'],
  ['book', 'shelf.ai.kind.book'],
];

const DAY_ORDER: Array<['today' | 'yesterday' | 'older', MsgKey]> = [
  ['today', 'shelf.ai.today'],
  ['yesterday', 'shelf.ai.yesterday'],
  ['older', 'shelf.ai.older'],
];

export interface HistoryView {
  sessions: readonly AiSession[];
  kind: AiKindFilter;
  kw: string;
  group: AiGroupBy;
  /** 展开的会话 id */
  open: readonly string[];
  /** 测试里钉死；界面用 Date.now() */
  now?: number;
  /** 导出目录（确认层列路径用）；空串 = 库根 */
  dir?: string;
}

export interface SessionBookGroup {
  bookId: string;
  bookTitle: string;
  author?: string;
  items: AiSession[];
}

export interface DayGroup {
  key: 'today' | 'yesterday' | 'older';
  items: AiSession[];
}

export interface HistoryStats {
  total: number;
  month: number;
  books: number;
  archived: number;
  /** 0..100 的整数；列表为空时是 0（不除零） */
  ratio: number;
}

export interface ExportTarget {
  bookId: string;
  bookTitle: string;
  /** vault 相对路径 */
  path: string;
  count: number;
}

/* ─────────── 筛选 ─────────── */

/** 类型 + 关键词。关键词同时搜引文、问题、回答（大小写不敏感） */
export function filterSessions(list: readonly AiSession[], kind: string, kw: string): AiSession[] {
  const q = kw.trim().toLowerCase();
  return list.filter((s) => {
    if (kind !== 'all' && s.kind !== kind) return false;
    if (!q) return true;
    const hay = [s.quote ?? '', ...s.turns.map((x) => x.text)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** 时间倒序（不原地改传入的数组） */
export function sortByRecent(list: readonly AiSession[]): AiSession[] {
  return [...list].sort((a, b) => b.when - a.when);
}

/* ─────────── 分组 ─────────── */

/**
 * 按书分组：书顺序按各自最近一条对话，组内也是时间倒序。
 *
 * 因为输入先做了全局时间倒序，这里只需按首次出现的顺序收组——
 * 第一次遇到某本书时，那条就是它最新的一条。
 */
export function groupSessionsByBook(list: readonly AiSession[]): SessionBookGroup[] {
  const order: string[] = [];
  const at = new Map<string, SessionBookGroup>();
  for (const s of sortByRecent(list)) {
    let g = at.get(s.bookId);
    if (!g) {
      g = { bookId: s.bookId, bookTitle: s.bookTitle, author: s.author, items: [] };
      at.set(s.bookId, g);
      order.push(s.bookId);
    }
    g.items.push(s);
  }
  return order.map((id) => at.get(id)!);
}

function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 落在哪一天：按本地日历日算，不用 24 小时窗口 */
export function dayBucket(when: number, now: number): 'today' | 'yesterday' | 'older' {
  const today = dayStart(now);
  const d = new Date(when);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (start === today) return 'today';
  const y = new Date(now);
  const yesterday = new Date(y.getFullYear(), y.getMonth(), y.getDate() - 1).getTime();
  if (start === yesterday) return 'yesterday';
  return 'older';
}

/** 按天分组：顺序固定 今天 → 昨天 → 更早，空组不出现 */
export function groupSessionsByDay(list: readonly AiSession[], now = Date.now()): DayGroup[] {
  const sorted = sortByRecent(list);
  return DAY_ORDER.map(([key]) => ({
    key,
    items: sorted.filter((s) => dayBucket(s.when, now) === key),
  })).filter((g) => g.items.length > 0);
}

/* ─────────── 统计 ─────────── */

export function historyStats(list: readonly AiSession[], now = Date.now()): HistoryStats {
  const total = list.length;
  const d = new Date(now);
  const month = list.filter((s) => {
    const x = new Date(s.when);
    return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
  }).length;
  const books = new Set(list.map((s) => s.bookId)).size;
  const archived = list.filter((s) => !!s.archivedAt).length;
  return { total, month, books, archived, ratio: total ? Math.round((archived / total) * 100) : 0 };
}

/* ─────────── 时间文案 ─────────── */

function dateLabel(when: number, now: number): string {
  const d = new Date(when);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear()) {
    return t('shelf.ai.date.md', { m: d.getMonth() + 1, day: d.getDate() });
  }
  return t('shelf.ai.date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() });
}

function hm(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours() < 10 ? '0' : ''}${d.getHours()}:${d.getMinutes() < 10 ? '0' : ''}${d.getMinutes()}`;
}

/** 卡片右上角：今天 14:32 / 昨天 22:10 / 11月14日 */
export function fmtSessionWhen(when: number, now = Date.now()): string {
  const bucket = dayBucket(when, now);
  if (bucket === 'today') return `${t('shelf.ai.today')} ${hm(when)}`;
  if (bucket === 'yesterday') return `${t('shelf.ai.yesterday')} ${hm(when)}`;
  return dateLabel(when, now);
}

/** 副标题里的「最近 X」：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期 */
export function fmtAgo(when: number, now = Date.now()): string {
  const diff = Math.max(0, now - when);
  if (diff < 60_000) return t('shelf.ai.ago.now');
  if (diff < 3_600_000) return t('shelf.ai.ago.min', { n: Math.floor(diff / 60_000) });
  const bucket = dayBucket(when, now);
  if (bucket === 'today') return t('shelf.ai.ago.hour', { n: Math.floor(diff / 3_600_000) });
  if (bucket === 'yesterday') return t('shelf.ai.ago.yesterday');
  const days = Math.round((dayStart(now) - dayStart(when)) / 86_400_000);
  if (days < 7) return t('shelf.ai.ago.day', { n: days });
  return dateLabel(when, now);
}

/* ─────────── 导出 ─────────── */

function cleanDir(dir: string): string {
  return String(dir ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

/**
 * 导出目标：一本书一份笔记，按书首次出现的顺序（输入时间倒序）。
 *
 * 路径与笔记页的导出目录设置同源：默认 `bz-reader/notes/书名.md`。
 * 书名过 safeName 那一关（斜杠 / Windows 保留名），不能把一个书名写成一个目录。
 */
export function exportTargets(list: readonly AiSession[], dir = 'bz-reader/notes'): ExportTarget[] {
  const base = cleanDir(dir);
  const order: string[] = [];
  const at = new Map<string, ExportTarget>();
  for (const s of sortByRecent(list)) {
    let x = at.get(s.bookId);
    if (!x) {
      const name = safeName(s.bookTitle);
      x = {
        bookId: s.bookId,
        bookTitle: s.bookTitle,
        path: base ? `${base}/${name}.md` : `${name}.md`,
        count: 0,
      };
      at.set(s.bookId, x);
      order.push(s.bookId);
    }
    x.count += 1;
  }
  return order.map((id) => at.get(id)!);
}

/* ─────────── 视图 ─────────── */

/** 按字符截断（原型 cut() 同口径），超长补省略号 */
function cut(s: string, n: number): string {
  const chars = Array.from(String(s ?? ''));
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

function cardHtml(s: AiSession, open: boolean, now: number): string {
  const ask = s.turns.find((x) => x.me)?.text ?? '';
  const answer = s.turns.find((x) => !x.me)?.text ?? '';
  const archived = !!s.archivedAt;
  const turns = s.turns.map((x) =>
    x.me
      ? `<p class="me"><b>${t('shelf.ai.you')}</b>：${esc(x.text)}</p>`
      : `<p><b>${t('shelf.ai.ai')}</b>：${esc(x.text)}</p>`,
  );
  return `<article class="bzs-dcard" data-id="${esc(s.id)}" style="--k:${KIND_COLOR[s.kind] ?? KIND_COLOR.explain}">
    <div class="bzs-dtop">
      <span class="bzs-dkind">${aiKindLabel(s.kind)}</span>
      <span class="bzs-dwhen">${esc(fmtSessionWhen(s.when, now))}</span>
      <span class="bzs-dn">${t('shelf.ai.lines', { n: s.turns.length })}</span>
    </div>
    ${s.quote ? `<p class="bzs-dquote">「${esc(cut(s.quote, 46))}」</p>` : ''}
    <p class="bzs-dq"><span class="bzs-qmark">${t('shelf.ai.you')}</span>${esc(cut(ask, 30))}</p>
    <p class="bzs-da">${esc(cut(answer, 62))}</p>
    <div class="bzs-dfoot">
      <button data-act="aiexpand" data-id="${esc(s.id)}">${
        open ? t('shelf.ai.collapse') : t('shelf.ai.expand')
      }</button>
      ${
        archived
          ? `<span class="bzs-adone">${t('shelf.ai.archived')}</span>`
          : `<button data-act="aiarchive" data-id="${esc(s.id)}">${t('shelf.ai.archive')}</button>`
      }
      <button class="x" data-act="aidelete" data-id="${esc(s.id)}">${t('shelf.ai.delete')}</button>
    </div>
    ${open ? `<div class="bzs-aconv">${turns.join('')}</div>` : ''}
  </article>`;
}

function bookGroupHtml(g: SessionBookGroup, open: ReadonlySet<string>, now: number): string {
  const done = g.items.filter((s) => !!s.archivedAt).length;
  const cnt = done
    ? t('shelf.ai.turnCountArchived', { n: g.items.length, done })
    : t('shelf.ai.turnCount', { n: g.items.length });
  return `<section class="bzs-aibook">
    <div class="bzs-aibhead">
      <span class="bzs-aispine" aria-hidden="true"></span>
      <b>${esc(g.bookTitle)}</b>
      ${g.author ? `<span class="bzs-aiby">${esc(g.author)}</span>` : ''}
      <span class="bzs-aicnt">${cnt}</span>
      <button class="bzs-aiexp" data-act="aiexportbook" data-id="${esc(g.bookId)}">${t('shelf.ai.exportBook')}</button>
    </div>
    <div class="bzs-aigrid">${g.items.map((s) => cardHtml(s, open.has(s.id), now)).join('')}</div>
  </section>`;
}

function dayGroupHtml(g: DayGroup, open: ReadonlySet<string>, now: number): string {
  const label = DAY_ORDER.find(([key]) => key === g.key)?.[1] ?? 'shelf.ai.older';
  return `<section class="bzs-aibook">
    <div class="bzs-athead"><b>${t(label)}</b><i></i><span>${t('shelf.ai.turnCount', { n: g.items.length })}</span></div>
    <div class="bzs-aigrid">${g.items.map((s) => cardHtml(s, open.has(s.id), now)).join('')}</div>
  </section>`;
}

export function viewHistory(v: HistoryView): string {
  const now = v.now ?? Date.now();
  const all = [...v.sessions];
  const shown = sortByRecent(filterSessions(all, v.kind, v.kw));
  const stats = historyStats(all, now);
  const open = new Set(v.open);

  const latest = all.reduce((m, s) => (s.when > m ? s.when : m), 0);
  const sub = t('shelf.ai.sub', { n: stats.total, books: stats.books }) + (latest ? t('shelf.ai.sub.recent', { ago: fmtAgo(latest, now) }) : '');

  const chips = AI_KIND_CHIPS.map(
    ([value, key]) =>
      `<button class="bzs-aichip${v.kind === value ? ' on' : ''}" data-act="aifilter" data-v="${value}">${t(key)}</button>`,
  ).join('');

  const groups = v.group === 'time' ? groupSessionsByDay(shown, now) : groupSessionsByBook(shown);
  const body = groups.length
    ? v.group === 'time'
      ? (groups as DayGroup[]).map((g) => dayGroupHtml(g, open, now)).join('')
      : (groups as SessionBookGroup[]).map((g) => bookGroupHtml(g, open, now)).join('')
    : `<div class="bzs-aiempty">
        <div class="bzs-aimark" aria-hidden="true">“</div>
        <p>${t('shelf.ai.empty.1')}<br>${t('shelf.ai.empty.2')}</p>
        <button class="bzs-aighost" data-act="aiclearkw">${t('shelf.ai.clearKw')}</button>
      </div>`;

  return `<div class="bzs-aipage">
    <div class="bzs-aihero">
      <div class="bzs-aihero-l">
        <h2>${t('shelf.tab.ai')}</h2>
        <p>${esc(sub)}</p>
      </div>
      <button class="bzs-aiexportall" data-act="aiexportall">${t('shelf.ai.exportAll')}</button>
    </div>

    <div class="bzs-aistats">
      <div class="bzs-aistat"><b>${stats.month}</b><span>${t('shelf.ai.stat.month')}</span></div>
      <div class="bzs-aistat"><b>${stats.books}</b><span>${t('shelf.ai.stat.books')}</span></div>
      <div class="bzs-aistat"><b>${stats.archived}</b><span>${t('shelf.ai.stat.archived')}</span></div>
      <div class="bzs-aistat wide">
        <span class="bzs-aimeter"><i style="width:${stats.ratio}%"></i></span>
        <span class="bzs-aicap">${t('shelf.ai.ratio', { pct: stats.ratio })}</span>
      </div>
    </div>

    <div class="bzs-aitool">
      <label class="bzs-aiwell">${MAG}<input data-role="aikw" placeholder="${t(
        'shelf.ai.search.ph',
      )}" value="${esc(v.kw)}"></label>
      <div class="bzs-aichips">${chips}</div>
      <span class="sp"></span>
      <div class="bzs-aiseg">
        <button class="${v.group === 'book' ? 'on' : ''}" data-act="aigroup" data-v="book">${t('shelf.ai.by.book')}</button>
        <button class="${v.group === 'time' ? 'on' : ''}" data-act="aigroup" data-v="time">${t('shelf.ai.by.time')}</button>
      </div>
    </div>

    ${body}
  </div>`;
}

/**
 * 导出确认层。
 *
 * 它是书架整页的遮罩（原型里 `.confirm` 挂在 `.app` 上，盖住页签），
 * 所以不放在 `bzs-stubody` 的滚动内容里——由 studyShell 作为页面级
 * layer 挂在 `.bzs-studio` 下，`position: absolute; inset: 0` 才对得齐。
 */
export function historyConfirmLayer(
  title: string,
  ids: readonly string[],
  sessions: readonly AiSession[],
  dir = 'bz-reader/notes',
): string {
  const picked = sessions.filter((s) => ids.includes(s.id));
  if (!picked.length) return '';
  const targets = exportTargets(picked, dir);
  return `<div class="bzs-aiconfirm">
    <div class="bzs-aibox" role="dialog" aria-modal="true"><span class="bzs-sr-only">${esc(title)}</span>
      <b>${esc(title)}</b>
      <p>${t('shelf.ai.confirm.sub', { n: picked.length })}</p>
      <ul>${targets
        .map(
          (x) =>
            `<li>${esc(x.path)}<span>${t('shelf.ai.turnCount', { n: x.count })}</span></li>`,
        )
        .join('')}</ul>
      <div class="acts">
        <button data-act="aicancel">${t('shelf.ai.confirm.cancel')}</button>
        <button class="pri" data-act="aiexportok">${t('shelf.ai.confirm.ok')}</button>
      </div>
    </div>
  </div>`;
}
