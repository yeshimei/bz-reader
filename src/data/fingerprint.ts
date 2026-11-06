/* ============================================================
 * bz-reader · 内容指纹（data/fingerprint.ts）
 *
 * 一本书的「身份证」：只看文件内容，不看路径、文件名。同一份文件不管
 * 改名、移动、复制几份，指纹都一样——导入/扫描登记前先算它，同一指纹
 * 只允许一条书记录。
 *
 * 为什么只取头尾各 64KB：
 *   · Obsidian 的 vault adapter 没有「只读一段」的接口，只能整份读进来
 *     再切视图；取头尾是为了让「整份读」成为唯一的 IO，而不是多读几遍。
 *   · EPUB/MOBI/CBZ 都是容器格式，头部有签名与主要 entry，尾部有中央
 *     目录（文件名表），两段加起来已经足够区分绝大多数书。
 *   · 已知边界：头尾相同、中间不同的两份文件会算出同一个指纹。测试里
 *     专门记了这条（不假装它是全量哈希）。
 *
 * 版本号进指纹字符串：以后换算法，旧指纹一眼能认出来，不会被当成新算法
 * 的结果混在一起。
 * ============================================================ */

/** 指纹算法版本。改变取样范围/哈希时一起推 */
export const FINGERPRINT_VERSION = 1;

/** 头、尾各取这么多字节参与哈希 */
export const FINGERPRINT_WINDOW = 64 * 1024;

/**
 * 超过这个大小不再为指纹整份读文件（移动端内存上限）。
 * 命中的书退回「按路径去重」——宁可少一层保护，也别把手机读崩。
 */
export const MAX_FINGERPRINT_BYTES = 64 * 1024 * 1024;

/** FNV-1a 32 位。两段各用一个不同种子，拼起来接近 64 位。 */
function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 把文件大小折进指纹：防止「头尾一样、只是被截断」的两份被认成同一本 */
function mix32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * 算一份字节内容的指纹；空内容返回 null（没有内容就没有身份）。
 *
 * 返回形如 `v1-0123456789abcdef01234567`，前三段分别是头、尾、大小。
 */
export function fingerprintOf(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null;
  const head = bytes.subarray(0, Math.min(FINGERPRINT_WINDOW, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - FINGERPRINT_WINDOW));
  const a = fnv1a(head, 0x811c9dc5);
  const b = fnv1a(tail, 0x9e3779b9);
  return `v${FINGERPRINT_VERSION}-${hex8(a)}${hex8(b)}${hex8(mix32(bytes.length))}`;
}
