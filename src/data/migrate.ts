/* ============================================================
 * bz-reader · 数据目录迁移（data/migrate.ts）
 *
 * 两处用到：
 *   1. 老版本的数据在 `<插件>/storage/`，第一次升级时静默搬到 `bz 阅读/`；
 *   2. 用户在设置里换了数据目录，确认后整体搬过去。
 *
 * 迁移只有一条铁律：**先复制、验过、再删旧**。
 * 反过来（先删后写）一旦中途失败，用户几百条划线就没了；而多留一份旧目录
 * 最多是占点空间，用户自己也能删。所以这里宁可留下残留，也绝不先动旧文件。
 * ============================================================ */
import type { App } from 'obsidian';

export interface CopyResult {
  files: number;
  dirs: number;
  /** 复制失败的源路径，非空即视为迁移不完整 */
  failed: string[];
}

/** 递归复制整棵目录（vault 相对路径）。目标已存在时合并覆盖。 */
export async function copyTree(app: App, from: string, to: string): Promise<CopyResult> {
  const res: CopyResult = { files: 0, dirs: 0, failed: [] };
  const src = from.replace(/\/+$/, '');
  const dst = to.replace(/\/+$/, '');
  if (!src || !dst || src === dst) return res;
  await walk(app, src, dst, res, new Set<string>());
  return res;
}

async function walk(app: App, src: string, dst: string, res: CopyResult, seen: Set<string>): Promise<void> {
  if (seen.has(src)) return; // 符号链接成环时兜底
  seen.add(src);

  const adapter = app.vault.adapter;
  await adapter.mkdir(dst).catch(() => undefined);
  res.dirs += 1;

  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(src);
  } catch {
    res.failed.push(src);
    return;
  }

  for (const f of listing.files) {
    const name = f.slice(src.length + 1);
    if (!name) continue;
    try {
      const buf = await adapter.readBinary(f);
      await adapter.writeBinary(`${dst}/${name}`, buf);
      res.files += 1;
    } catch {
      res.failed.push(f);
    }
  }

  for (const d of listing.folders) {
    const name = d.slice(src.length + 1);
    if (!name) continue;
    await walk(app, d, `${dst}/${name}`, res, seen);
  }
}

/** 递归删目录。只在「新目录已经写入且校验通过」之后调用。 */
export async function removeTree(app: App, dir: string): Promise<boolean> {
  const adapter = app.vault.adapter;
  const p = dir.replace(/\/+$/, '');
  if (!p || p === '.' || p === '/') return false;
  try {
    await adapter.rmdir(p, true);
    return true;
  } catch {
    return false;
  }
}

/** 目录里有没有东西（用来判断「新目录是不是已经有一份数据」） */
export async function dirHasFiles(app: App, dir: string): Promise<boolean> {
  try {
    const l = await app.vault.adapter.list(dir);
    return l.files.length > 0 || l.folders.length > 0;
  } catch {
    return false;
  }
}
