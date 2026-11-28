/* ============================================================
 * 已吊销码号（内置名单）—— 自动生成，别手改
 *
 * 由 `npm run gen:revoked` 从 docs/revoked.json 生成，随每个版本发布。
 * 作用：断网 / 清存储 / 屏蔽域名时，这些码仍然会被判停用。
 * 解封靠 updatedAt 闸门：设备拿到过不早于本版本的线上名单后，
 * 这份快照即失效（见 src/data/revoked.ts 的 builtinRevokedHit）。
 * ============================================================ */

/** 生成时名单的版本号；运行时拿它和设备见过的名单版本比 */
export const BUILTIN_REVOKED_UPDATED_AT = 1795774798462;

export const BUILTIN_REVOKED_IDS: readonly string[] = [
  'BZR-AF-2026-0383',
];

export const BUILTIN_REVOKED_HASHES: readonly string[] = [];
