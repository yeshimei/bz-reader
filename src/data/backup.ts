/* ============================================================
 * bz-reader · 数据备份 / 恢复（data/backup.ts）
 *
 * 备份的是**用户内容**：书架、进度、标注、收藏、分组、目标、排版偏好。
 * 不备份两样东西，而且是故意的：
 *   · 激活码（`data.json` 里）——它是设备凭证，备份里带上就等于把授权
 *     复制到每一台恢复了备份的机器上；
 *   · AI Key（同上）——用户会把备份文件发给别人看，不该顺手把自己的 Key
 *     一起发出去。
 *
 * 恢复走**合并**而不是替换：按书 id 对齐、`updatedAt` 大的赢。替换会让
 * 「在另一台设备上多读的那几章」凭空消失——那是数据丢失，不是恢复。
 *
 * 格式是一个自描述的单文件 JSON，带 `app` 与 `version`：用户把它改名、
 * 扔进任何目录，插件都能认出来这是自己的备份，而不是拿一份任意 JSON
 * 去覆盖书架。
 * ============================================================ */
import type { ReaderData } from './schema';
import { sanitizeDataDetailed } from './store';

export const BACKUP_APP = 'bz-reader';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  /** 业务数据。**不含 settings / license**，见文件头 */
  data: ReaderData;
}

/** 备份文件名：`bz-reader-backup-20261104-0812.json` */
export function backupFileName(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `bz-reader-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** 生成备份文本（缩进 2 格：用户可能真的会打开看） */
export function buildBackup(data: ReaderData, now = Date.now()): string {
  const file: BackupFile = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now,
    data: {
      version: 1,
      books: data.books,
      prefs: data.prefs,
      goal: data.goal,
      /* 打卡与每日目标也是用户攒出来的数据，换电脑后应该跟着走 */
      checkins: data.checkins,
      dailyGoalMinutes: data.dailyGoalMinutes,
    },
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 恢复时的合并：书架按 `updatedAt` 合，偏好类字段以**备份**为准。
 *
 * 为什么不直接用 `mergeData`：那个函数的语义是「外部改动并进来、本地优先」，
 * 用于写盘前的同步合并；而恢复是用户主动选了一份备份，`prefs / goal /
 * dailyGoalMinutes` 应该按备份来，否则「恢复」出来跟没恢复一样。
 *
 * 打卡按天取较大秒数：它是当天累计值，取大只会「打上卡」，不会把记录抹掉。
 * `dataDir` 保留本机的——备份来自另一台电脑，那个路径在这里没有意义。
 */
export function mergeRestore(local: ReaderData, backup: ReaderData): ReaderData {
  const byId = new Map(backup.books.map((b) => [b.id, b]));
  const books = local.books.map((b) => {
    const other = byId.get(b.id);
    if (!other) return b;
    byId.delete(b.id);
    return (other.updatedAt ?? 0) > (b.updatedAt ?? 0) ? other : b;
  });
  for (const b of byId.values()) books.push(b);

  const checkins: Record<string, number> = { ...(local.checkins ?? {}) };
  for (const [day, sec] of Object.entries(backup.checkins ?? {})) {
    const n = Number(sec) || 0;
    if (n > (checkins[day] ?? 0)) checkins[day] = n;
  }

  return {
    ...local,
    books,
    prefs: backup.prefs ?? local.prefs,
    goal: typeof backup.goal === 'number' ? backup.goal : local.goal,
    checkins,
    dailyGoalMinutes:
      typeof backup.dailyGoalMinutes === 'number' ? backup.dailyGoalMinutes : local.dailyGoalMinutes,
  };
}

export type ParseBackupResult =
  | { ok: true; data: ReaderData; exportedAt: number; dropped: number }
  | { ok: false; message: string };

/**
 * 校验一份备份。
 *
 * 三种坏法都给人话，而不是「恢复失败」四个字：
 *   · 不是 JSON → 文件坏了 / 选错文件
 *   · 没有 app 标记 → 拿别的 JSON 来恢复
 *   · books 不是数组 → 结构不符
 */
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: '这不是一个合法的 JSON 文件' };
  }
  const f = raw as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object') return { ok: false, message: '文件内容是空的' };
  if (f.app !== BACKUP_APP) {
    return { ok: false, message: '这不是 bz 阅读的备份文件（缺少 app 标记）' };
  }
  const clean = sanitizeDataDetailed(f.data);
  if (!clean) return { ok: false, message: '备份里的书架数据不完整，读不出来' };
  return {
    ok: true,
    data: clean.data,
    exportedAt: typeof f.exportedAt === 'number' ? f.exportedAt : 0,
    dropped: clean.dropped.length,
  };
}
