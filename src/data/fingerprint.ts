/* ============================================================
 * bz-reader · 内容指纹（data/fingerprint.ts）
 *
 * 一本书的「身份证」：只看文件内容，不看路径、文件名。同一份文件不管
 * 改名、移动、复制几份，指纹都一样——导入/扫描登记前先算它，同一指纹
 * 只允许一条书记录。
 *
 * v1（2026-11-06）用 FNV-1a 取头尾各 64KB + 大小。已知边界：头尾相同、
 * 中间不同的两份文件会算出同一个指纹——用户换版本（同路径覆盖成另一版）
 * 时因此认不出，进度/划线被错误接过去。
 *
 * v2（2026-11-21）改为整本书 SHA-256，消掉上面那个边界。实测 82MB 约
 * 60ms（原生 crypto.subtle，异步不挡主线程），比 v1 的 FNV 双遍跑全书
 * （416ms）还快；取消 64MB 上限，所有书都算，桌面手机同一套算法。
 * 大小继续拼进指纹串做双保险：真撞了（概率可忽略）也不会把不同大小串一起。
 *
 * 算法版本进指纹字符串：v1/v2 一眼能认出来，后台升级据此判断谁要重算。
 * ============================================================ */

/** 指纹算法版本。改变算法时一起推，旧版本由后台升级替换。 */
export const FINGERPRINT_VERSION = 2;

/**
 * 当前版本的指纹是不是 v2。老数据（v1 或没有）返回 false，需要后台升级。
 */
export function isCurrentFingerprint(fp: string | undefined | null): boolean {
  return !!fp && fp.startsWith(`v${FINGERPRINT_VERSION}-`);
}

/** 这条指纹需不需要补算/升级到 v2。 */
export function needsFingerprintUpgrade(fp: string | undefined | null): boolean {
  return !isCurrentFingerprint(fp);
}

/**
 * 算一份字节内容的指纹；空内容返回 null（没有内容就没有身份）。
 *
 * 返回形如 `v2-<sha256 hex 64位>-<字节数>`。异步：用系统原生 crypto.subtle，
 * 不阻塞主线程；同一本书桌面与手机算出完全一样的值。
 */
export async function fingerprintOf(bytes: Uint8Array): Promise<string | null> {
  if (!bytes || bytes.length === 0) return null;
  /* crypto.subtle 只收 ArrayBuffer；Uint8Array.buffer 的类型是
     ArrayBufferLike（可能是 SharedArrayBuffer），先复制成确定的 ArrayBuffer。 */
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `v${FINGERPRINT_VERSION}-${hex}-${bytes.byteLength}`;
}
