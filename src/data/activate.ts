/* ============================================================
 * bz-reader · 激活入口（data/activate.ts）
 *
 * 两个设置页（书架第四页 / 原生设置页）都只调这一个函数，避免两处
 * 各写一遍「验签 → 联网 → 落库」的顺序。
 *
 * 顺序是有讲究的：
 *   1. 先本地验签（离线也能判断码真伪，假码不必打扰服务器）
 *   2. v3 码再联网核销（换令牌）
 *   3. 先 setLicense 再 setToken —— setLicense 发现换了码会清旧令牌，
 *      反过来会把刚拿到的令牌清掉
 * ============================================================ */

import { setLicense, setToken } from './entitlement';
import { verifyLicense } from './license';
import { redeemLicense } from './redeem';

export interface ActivateResult {
  ok: boolean;
  message: string;
}

export async function activateCode(code: string, version: string): Promise<ActivateResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, message: '还没有填激活码。' };

  const check = await verifyLicense(trimmed);

  /* 老码（BZR1 / BZR2）：验签通过即解锁，不联网 */
  if (check.ok) {
    setLicense(trimmed);
    return { ok: true, message: check.message };
  }

  /* v3 码：签名有效，但必须先核销 */
  if (check.needRedeem) {
    const res = await redeemLicense(trimmed, version);
    if (!res.ok) return { ok: false, message: res.message };
    setLicense(trimmed);
    if (res.token) setToken(res.token);
    return { ok: true, message: res.message };
  }

  return { ok: false, message: check.message };
}
