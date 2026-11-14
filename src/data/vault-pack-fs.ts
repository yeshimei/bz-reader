/* ============================================================
 * bz-reader · 离线包的文件系统适配（data/vault-pack-fs.ts）
 *
 * 把 Obsidian 的 `vault.adapter` 收成 `PackFS` 那六个动作。单独一层是为了
 * 让 `offline-store` 完全不 import obsidian ——那边全部逻辑都能在 node 里
 * 用内存假盘跑，这个文件是唯一需要真宿主的地方。
 *
 * 为什么走 `adapter` 而不是 `vault.createBinary`：后者要求路径已经在
 * Obsidian 的文件索引里，刚建的目录/刚写的文件会报「找不到父目录」；
 * adapter 是直接落到磁盘，适合「用户看不见的音频缓存目录」。
 * ============================================================ */

import type { App } from 'obsidian';
import type { PackFS } from './offline-store';

export function vaultPackFS(app: App): PackFS {
  const adapter = app.vault.adapter;
  return {
    exists: (path) => adapter.exists(path),
    mkdir: async (path) => {
      try {
        await adapter.mkdir(path);
      } catch (e) {
        /* 并发建目录 / 已经存在：只要最后存在就算成功 */
        if (!(await adapter.exists(path))) throw e;
      }
    },
    writeBinary: (path, data) => adapter.writeBinary(path, data),
    readBinary: (path) => adapter.readBinary(path),
    readText: (path) => adapter.read(path),
    list: (path) => adapter.list(path),
    remove: (path) => adapter.remove(path),
    /* 写清单要的是「一步换上去」：adapter.rename 在同一目录内覆盖目标 */
    rename: (from, to) => adapter.rename(from, to),
    rmdir: (path, recursive = true) => adapter.rmdir(path, recursive),
  };
}
