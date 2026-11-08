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
 * 恢复走**整份替换**（2026-11-08 用户拍板）：选了哪份备份就回到哪份状态。
 * 不做按 id 的跨设备合并——「另一台多读的那几章」要不要留，是用户自己的
 * 同步工具该决定的事，插件替他算一遍只会得到一份谁都说不清的数据。
 * `dataDir` 例外：那是本机的路径，永远保留本机值。
 *
 * 格式是一个自描述的单文件 JSON，带 `app` 与 `version`：用户把它改名、
 * 扔进任何目录，插件都能认出来这是自己的备份，而不是拿一份任意 JSON
 * 去覆盖书架。
 * ============================================================ */
import { SCHEMA_VERSION, type ReaderData } from './schema';
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
      schemaVersion: SCHEMA_VERSION,
      books: data.books,
      prefs: data.prefs,
      /* 版式是两个平台槽存的（见 data/prefs.ts 的 pickPrefs）。只搬旧的全局
         prefs 的话，换设备恢复后两份槽都空着，字号行距全回到默认——
         用户会以为自己调好的版式丢了。 */
      prefsDesktop: data.prefsDesktop,
      prefsMobile: data.prefsMobile,
      goal: data.goal,
      /* 打卡与每日目标也是用户攒出来的数据，换电脑后应该跟着走 */
      checkins: data.checkins,
      dailyGoalMinutes: data.dailyGoalMinutes,
    },
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 恢复：**整份替换**，不是合并（2026-11-08 改）。
 *
 * 以前这里是「按 id 对齐、`updatedAt` 大的赢」的合并。用户拍板删掉：
 * 恢复就是恢复——我选了一份备份，我要回到那个状态，不是要一份两边掺起来的
 * 东西。合并还带来一个说不清的后果：恢复完书架里有几本、进度是哪一份，
 * 连写代码的人都得算一遍才说得明白，用户更不可能预期。
 *
 * `dataDir` 必须保留本机的：备份可能来自另一台电脑，那个路径在这里不存在，
 * 拿过来当天就会「数据目录丢了」。
 *
 * 双端偏好（`prefsDesktop` / `prefsMobile`）同理：它们是「这台机器怎么读」的
 * 口径，不是书的内容。0.2.0 之前的备份没有这两个键，整份替换会把本机调好的
 * 字号 / 行距直接抹掉——那是恢复数据，不是恢复设置。
 */
export function replaceWithBackup(local: ReaderData, backup: ReaderData): ReaderData {
  return {
    ...backup,
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    dataDir: local.dataDir,
    prefsDesktop: backup.prefsDesktop ?? local.prefsDesktop,
    prefsMobile: backup.prefsMobile ?? local.prefsMobile,
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
