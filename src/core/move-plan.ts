/* ============================================================
 * bz-reader · 目录迁移清单（core/move-plan.ts）
 *
 * 把「这次要把哪些文件搬到哪」算成一张纯清单，真正动手交给调用方
 * （用 Obsidian 的 `fileManager.renameFile`，链接自动改写）。
 *
 * 纯函数是为了能测：目录迁移一旦搬错，用户的书和书摘就换地方了。
 * ============================================================ */

export interface MovePlan {
  ok: boolean;
  /** 失败时给人看的一句话 */
  reason?: string;
  moves: Array<{ from: string; to: string }>;
}

function trimSlashes(dir: string): string {
  return String(dir || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

/**
 * @param paths 候选文件（vault 相对路径）
 * @param from  当前目录（vault 相对，`'/'` 表示库根——但库根不允许迁移）
 * @param to    目标目录
 */
export function planMove(paths: string[], from: string, to: string): MovePlan {
  const src = trimSlashes(from);
  const dst = trimSlashes(to);
  const fail = (reason: string): MovePlan => ({ ok: false, reason, moves: [] });

  if (!src) return fail('不能从库根目录迁移，请先选一个具体的文件夹');
  if (!dst) return fail('目标不能是库根目录，请选一个具体的文件夹');
  if (src === dst) return fail('新目录和当前目录相同');
  /* A→A/B 会把 B 复制进自己，删 A 时连 B 一起没；反向同理。 */
  if (dst.startsWith(`${src}/`) || src.startsWith(`${dst}/`)) {
    return fail('不能迁到当前目录的上级或下级文件夹');
  }

  const moves: MovePlan['moves'] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = String(raw || '').replace(/\\/g, '/');
    if (!path.startsWith(`${src}/`)) continue;
    const target = `${dst}/${path.slice(src.length + 1)}`;
    if (seen.has(target)) return fail(`目标路径重复：${target}`);
    seen.add(target);
    moves.push({ from: path, to: target });
  }
  return { ok: true, moves };
}
