/* ============================================================
 * bz-reader · 激活码（data/license.ts）
 *
 * 格式 `BZR1.<base64url(payload)>.<base64url(sig)>`：
 *   payload = UTF-8 JSON `{ v: 1, name?: string, exp?: number }`，
 *   exp 是毫秒时间戳，缺省/0 = 永久；sig = ECDSA P-256 + SHA-256，
 *   **IEEE-P1363 裸格式（r||s 各 32 字节）**——WebCrypto 的 subtle.verify
 *   只认这个，签发脚本里从 DER 转过来。
 *
 * 离线验签，不联网：激活一次管到 exp 为止。公钥内嵌在 base 包里
 * （验签不含任何 pro 功能代码，进 base 无妨）。
 * ============================================================ */

/** ECDSA P-256 公钥（SPKI DER 的 base64）。由 scripts/gen-keys.mjs 生成。 */
const PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDlauLuKMfRhggbifaU3QcR1R+gX7518ibeYfPeyFzLYcQesrjY0vViS/SukngZqMZDPwBbebtPoGqw/pLJRnxg==';

export interface LicensePayload {
  v: 1;
  name?: string;
  /** 过期毫秒戳；缺省或 0 = 永久 */
  exp?: number;
}

export interface LicenseCheck {
  ok: boolean;
  message: string;
  payload?: LicensePayload;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseLicense(code: string): { payloadBytes: Uint8Array; sig: Uint8Array; payload: LicensePayload } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'BZR1') return null;
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (payload?.v !== 1) return null;
    return { payloadBytes, sig, payload };
  } catch {
    return null;
  }
}

function spkiToCryptoKey(spki: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/**
 * 验一枚激活码。任何一步不过都给人话，不抛——设置页直接显示 message。
 */
export async function verifyLicense(code: string): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, message: '还没有填激活码。' };
  if (!PUBKEY_SPKI_B64) return { ok: false, message: '发行方还没配置公钥（开发阶段先用签发脚本自测）。' };
  const parsed = parseLicense(code);
  if (!parsed) return { ok: false, message: '激活码格式不对：应为 BZR1.开头的三段式。' };
  try {
    const key = await spkiToCryptoKey(
      Uint8Array.from(atob(PUBKEY_SPKI_B64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer,
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      parsed.sig.buffer as ArrayBuffer,
      parsed.payloadBytes.buffer as ArrayBuffer,
    );
    if (!ok) return { ok: false, message: '激活码验签失败：内容或签名被改过。' };
    const exp = parsed.payload.exp ?? 0;
    if (exp && Date.now() > exp) {
      const d = new Date(exp);
      return { ok: false, message: `激活码已于 ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} 过期。` };
    }
    const who = parsed.payload.name ? `，${parsed.payload.name}` : '';
    const until = exp
      ? `有效期到 ${new Date(exp).getFullYear()}-${new Date(exp).getMonth() + 1}-${new Date(exp).getDate()}`
      : '永久有效';
    return { ok: true, message: `已激活${who}，${until}。`, payload: parsed.payload };
  } catch (e) {
    return { ok: false, message: `验签出错：${(e as Error)?.message || '环境不支持 WebCrypto'}` };
  }
}

/** 设置页的授权状态行。没验过的不说死，等用户点激活。 */
export function licenseSummary(code: string): string {
  const parsed = parseLicense(code);
  if (!parsed) return '';
  const exp = parsed.payload.exp ?? 0;
  if (exp && Date.now() > exp) return `当前激活码已过期（${new Date(exp).toLocaleDateString()}），高级功能不可用。`;
  const who = parsed.payload.name ? `（${parsed.payload.name}）` : '';
  const until = exp ? `有效期到 ${new Date(exp).toLocaleDateString()}` : '永久有效';
  return `当前已激活${who}：${until}。`;
}
