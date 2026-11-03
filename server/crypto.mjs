/* ============================================================
 * bz-reader · 激活服务 · 密码学（server/crypto.mjs）
 *
 * 只依赖 WebCrypto（Workers 与 Node 18+ 都有），不 import node:crypto，
 * 这样同一份代码在 `wrangler dev` / 本地 Node / 线上 Worker 里跑的是同一条路径。
 *
 * 两把密钥，各管一段：
 *   CODE 公钥  验 BZR3 激活码（私钥离线，永不进服务器）
 *   TOKEN 私钥 签 BZRT 设备令牌（Worker secret）
 *
 * ECDSA P-256 + SHA-256。WebCrypto 的 sign/verify 用的就是 IEEE-P1363
 * 裸格式（r||s 各 32 字节），跟客户端一致，不需要 DER 转换。
 * ============================================================ */

const te = new TextEncoder();
const td = new TextDecoder();

/** base64（标准或 url-safe）→ 字节。两种都吃，省得调用方分不清 */
export function b64ToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 字节 → base64url（无填充），激活码与令牌用这个 */
export function bytesToB64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PEM（PKCS8）→ DER 字节 */
export function pemToDer(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return b64ToBytes(body);
}

/** 发行公钥：SPKI base64（scripts/keys/public-spki.b64 的内容） */
export function importCodeKey(spkiB64) {
  return crypto.subtle.importKey(
    'spki',
    b64ToBytes(spkiB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

/** 令牌私钥：PKCS8 PEM（scripts/keys/token-private.pem 的内容） */
export function importTokenKey(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * 验一枚 BZR3 激活码。
 * 返回 payload（已验签）或 null。任何异常都当验签失败，不抛。
 */
export async function verifyCode(code, key) {
  try {
    const parts = String(code).trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'BZR3') return null;
    const payloadBytes = b64ToBytes(parts[1]);
    const sig = b64ToBytes(parts[2]);
    if (payloadBytes.length > 4096) return null;
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sig,
      payloadBytes,
    );
    if (!ok) return null;
    const payload = JSON.parse(td.decode(payloadBytes));
    if (!payload || payload.v !== 3) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 签一枚 BZRT 设备令牌 */
export async function signToken(payload, key) {
  const bytes = te.encode(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes),
  );
  return `BZRT.${bytesToB64url(bytes)}.${bytesToB64url(sig)}`;
}
