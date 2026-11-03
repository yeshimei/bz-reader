/* ============================================================
 * bz-reader · blob 注册表（engine/blob-registry.ts）
 *
 * `blob-srcdoc` 需要留住 foliate 造的 Blob：换章时它会 `revokeObjectURL`，
 * 而我们之后还要读原文来生成 srcdoc。所以「revoke」不能真的删表。
 *
 * 但只按条数（旧版 96 条）上限有两个问题：
 *   - 漫画每页一张图，96 张就能钉住上百 MB；
 *   - 反过来，别的插件造够 96 个 URL 就把书里的挤掉，之后只能退回 fetch，
 *     而 foliate 已经 revoke 过的 URL 取不到，失败还是静默的。
 *
 * 现在按**字节**算总量，淘汰顺序是「已 revoke 的最旧条目 → 最旧条目」。
 * 纯 Map 操作，好测；DOM 那一层只管调它。
 * ============================================================ */

export interface KeptBlob {
  blob: Blob;
  /** 登记时间，淘汰按它排序 */
  at: number;
  /** foliate 已经 revoke 过：句柄废了，但对象还要留着读原文 */
  revoked: boolean;
}

/** 总量上限。一本图多的书整章内联大约几十 MB，64MB 是「不 OOM」和「不误杀」的折中 */
export const MAX_BLOB_BYTES = 64 * 1024 * 1024;

export function totalBytesOf(map: Map<string, KeptBlob>): number {
  let n = 0;
  for (const k of map.values()) n += k.blob?.size ?? 0;
  return n;
}

/**
 * 按字节淘汰，直到总量回到上限以内。
 *
 * 先扔「已 revoke 且最旧」的——那些是 foliate 已经翻过去的章节；
 * 实在没有可扔的才扔最旧的活条目。**至少留一条**：正在渲染的那一章
 * 就是最新一条，扔光了 srcdoc 就没内容可读。
 */
export function pruneBlobs(map: Map<string, KeptBlob>, maxBytes = MAX_BLOB_BYTES): number {
  let removed = 0;
  while (map.size > 1 && totalBytesOf(map) > maxBytes) {
    let victim: string | null = null;
    for (const [url, k] of map) {
      if (!k.revoked) continue;
      const cur = victim ? map.get(victim) : null;
      if (!cur || k.at < cur.at) victim = url;
    }
    if (!victim) {
      for (const [url, k] of map) {
        const cur = victim ? map.get(victim) : null;
        if (!cur || k.at < cur.at) victim = url;
      }
    }
    if (!victim) break;
    map.delete(victim);
    removed += 1;
  }
  return removed;
}

/** 登记一条。同一 URL 重复登记（重建）时按新对象替换，不重复计费 */
export function keepBlob(
  map: Map<string, KeptBlob>,
  url: string,
  blob: Blob,
  now = Date.now(),
): void {
  map.delete(url); // 旧对象可能还挂着，先摘掉再算总量
  map.set(url, { blob, at: now, revoked: false });
  pruneBlobs(map);
}
