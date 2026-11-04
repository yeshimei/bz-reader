/* ============================================================
 * bz-reader · 找回数据目录时的候选比较（core/data-dir-pick.ts）
 *
 * 数据目录指针丢了（清缓存 / 重装 / 只拷了书）时，库根可能同时躺着好几个
 * 带 `bz-reader.json` 的目录。以前直接 `found[0]`：数组顺序由 `list('/')`
 * 决定，等于随机挑一个——挑错的那个会被写成指针，用户看到的是「换了个空库」。
 *
 * 这里只做两个纯步骤：
 *   1. 读每个候选：书数 + 数据文件 mtime（读不出来记 0，不猜）；
 *   2. 选书最多的；并列取 mtime 更新的；仍然并列就**不选**——
 *      两个同样新的库，哪个才是用户要的只有他自己知道，交给设置页。
 * ============================================================ */
import type { App } from 'obsidian';

export interface DataDirCandidate {
  dir: string;
  /** `bz-reader.json` 里的 books.length；文件缺失/坏 JSON 记 0 */
  books: number;
  /** 数据文件 mtime（毫秒）；拿不到记 0 */
  mtime: number;
}

export interface DataDirPick {
  dir: string | null;
  /** 并列第一且无法用 mtime 决出：调用方应提示用户去设置里手选，且不要写指针 */
  ambiguous: boolean;
}

/** 读一个目录的数据文件元信息。任何失败都降级成 0，启动流程不能因此中断 */
async function inspect(app: App, dir: string): Promise<DataDirCandidate> {
  const adapter = app.vault.adapter;
  const file = dir ? `${dir}/bz-reader.json` : 'bz-reader.json';
  let books = 0;
  try {
    const raw = await adapter.read(file);
    const parsed = JSON.parse(raw) as { books?: unknown };
    books = Array.isArray(parsed.books) ? parsed.books.length : 0;
  } catch {
    /* 文件不存在 / 半截 JSON：0 本，但仍然参与比较（mtime 可能仍是新的） */
  }
  let mtime = 0;
  try {
    const st = await adapter.stat(file);
    mtime = typeof st?.mtime === 'number' ? st.mtime : 0;
  } catch {
    /* 拿不到 mtime 就按最旧处理 */
  }
  return { dir, books, mtime };
}

export async function collectDataDirCandidates(
  app: App,
  dirs: ReadonlyArray<string>,
): Promise<DataDirCandidate[]> {
  const out: DataDirCandidate[] = [];
  for (const dir of dirs) out.push(await inspect(app, dir));
  return out;
}

/**
 * 选一个数据目录。返回 `dir: null` 有两种含义：
 *   · `ambiguous: false` —— 没有候选；
 *   · `ambiguous: true`  —— 有多个同样好的，调用方必须问用户。
 */
export function pickDataDir(candidates: ReadonlyArray<DataDirCandidate>): DataDirPick {
  if (!candidates.length) return { dir: null, ambiguous: false };
  const most = Math.max(...candidates.map((c) => c.books));
  let top = candidates.filter((c) => c.books === most);
  if (top.length > 1) {
    const newest = Math.max(...top.map((c) => c.mtime));
    top = top.filter((c) => c.mtime === newest);
  }
  return top.length === 1
    ? { dir: top[0].dir, ambiguous: false }
    : { dir: null, ambiguous: true };
}
