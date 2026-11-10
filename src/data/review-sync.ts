/* ============================================================
 * bz-reader · 划线 → 复习卡（data/review-sync.ts）
 *
 * 一条划线变成「一篇卡片笔记 + 一条复习排期」。两件事必须按顺序做：
 *   1. 先把 Markdown 落进库（bz 的排期表以文件路径为钥匙，文件不在就是挂起）；
 *   2. 再通过 bz 的门面登记进复习计划。
 * 顺序反了只会得到一条删除线记录，复习时点开是空的。
 *
 * 三条取舍：
 *   · **不覆盖用户的编辑**：划线上记过卡片路径、且文件还在，就直接复用，
 *     不再重写。用户往卡片里补的想法是他自己的，一次「加入复习」不该冲掉。
 *   · **同名让开**：两条划线开头一模一样时，第二张卡叫 `名字 (2).md`，
 *     绝不把别人的卡片覆盖掉——与导出同一套规矩。
 *   · **数据丢了也能接管**：路径记录丢了但同名文件恰好是本插件为这条划线
 *     写的（靠末尾标记 + highlight id 认），直接接管那份，不新造一张。
 *
 * 纯数据层：不碰 UI、不弹通知，成败由调用方提示。
 * ============================================================ */
import type { App } from 'obsidian';
import type { Highlight, ReaderBook } from './schema';
import type { ReaderSettings } from './settings';
import type { BzReviewFacade } from './bz-bridge';
import { ensureDir } from './export';
import { buildReviewCard, isOurCardOf, reviewCardName } from './review-card';
import { wikilinkOfMark } from './wikilink';
import { t } from '../i18n';

export interface ReviewSyncInput {
  app: App;
  book: ReaderBook;
  highlight: Highlight;
  settings: ReaderSettings;
  /** bz 的复习门面；null = 这台 bz 没有这个能力（老版本 / 没装） */
  plan: BzReviewFacade | null;
}

export interface ReviewSyncResult {
  /** 卡片在库里的路径 */
  path: string;
  /** 这次真的写了文件（复用时为 false） */
  written: boolean;
  /** 复用了已经记过路径的卡片 */
  reused: boolean;
  /** 有没有进复习计划 */
  added: boolean;
  /** 没进去的原因：已在计划中 / 文件不存在（正常情况不会出现） */
  reason?: 'exists' | 'notFound';
}

/**
 * 复习卡目录归一。
 *
 * `'/'` 与空串都表示库根；其余去掉首尾斜杠——直接拼会得到 `//卡片.md`
 * （绝对路径），在移动端根本写不进去。与设置页的 cleanDir 同口径。
 */
export function normalizeReviewDir(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s === '/') return '';
  return s.replace(/^\/+|\/+$/g, '');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}.md` : `${name}.md`;
}

/**
 * 找一张空位：`名字.md`、`名字 (2).md`…
 *
 * 同名文件恰好是**本插件为这条划线写的**（记录丢失后的重建）时直接接管；
 * 是别人的笔记时一路让开，最坏退到带时间戳的名字。
 */
async function resolveNewPath(app: App, dir: string, name: string, highlightId: string): Promise<string> {
  const adapter = app.vault.adapter;
  for (let n = 1; n <= 50; n += 1) {
    const target = joinPath(dir, n === 1 ? name : `${name} (${n})`);
    if (!(await adapter.exists(target))) return target;
    try {
      if (isOurCardOf(await adapter.read(target), highlightId)) return target;
    } catch {
      /* 读不出来就别赌它是不是自己的：让开，换下一个候选名 */
      continue;
    }
  }
  return joinPath(dir, `${name} (${Date.now()})`);
}

/** 原子写：先写 .tmp 再改名，中途崩溃不会留半截 Markdown（与导出同规矩） */
async function writeAtomic(app: App, path: string, text: string): Promise<void> {
  const adapter = app.vault.adapter;
  const tmp = `${path}.tmp`;
  try {
    await adapter.write(tmp, text);
    await adapter.rename(tmp, path);
  } catch {
    await adapter.write(path, text);
    await adapter.remove(tmp).catch(() => undefined);
  }
}

/** 卡片 Markdown（拆出来是为了测试能单独钉住产物，不碰盘） */
export function reviewCardFor(input: Omit<ReviewSyncInput, 'app' | 'settings' | 'plan'>, now = Date.now()): string {
  const { book, highlight: h } = input;
  return buildReviewCard({
    bookTitle: String(book.meta.title ?? '').trim() || t('common.untitled'),
    bookId: book.id,
    highlightId: h.id,
    text: h.text,
    comment: h.comment,
    chapterTitle: h.chapterTitle,
    backlink: wikilinkOfMark(book, h),
    createdAt: now,
  });
}

/**
 * 生成 / 复用卡片，并登记进复习计划。
 *
 * `plan` 为 null 时仍然写文件（卡片本身有用），只是返回 `added: false`——
 * 调用方据此提示「更新 bz 后可用」，而不是把用户刚划的那段丢掉。
 */
export async function syncReviewCard(input: ReviewSyncInput, now = Date.now()): Promise<ReviewSyncResult> {
  const { app, book, highlight: h, settings, plan } = input;
  const dir = normalizeReviewDir(settings.reviewDir);
  const remembered = String(h.review?.path ?? '').trim();

  let path = '';
  let reused = false;
  if (remembered && (await app.vault.adapter.exists(remembered))) {
    path = remembered;
    reused = true;
  }

  let written = false;
  if (!path) {
    await ensureDir(app, dir);
    path = await resolveNewPath(app, dir, reviewCardName({ text: h.text }), h.id);
    await writeAtomic(app, path, reviewCardFor({ book, highlight: h }, now));
    written = true;
  }

  if (!plan) return { path, written, reused, added: false, reason: 'notFound' };
  const res = await plan.addNote(path);
  return { path, written, reused, added: res.added, reason: res.reason };
}
