/* ============================================================
 * bz-reader · 激活码与设备令牌（data/license.ts）
 *
 * 两种凭证，两个公钥：
 *
 *   激活码 `BZR3.<payload>.<sig>`  离线私钥签，证明「这串字是我发的」
 *     payload = { v:3, kind, id, days, maxAct?, redeemBy?, name?, note? }
 *     本身**不解锁任何东西**——v3 码必须先联网核销，换一枚设备令牌。
 *
 *   设备令牌 `BZRT.<payload>.<sig>` 服务端令牌私钥签，才是钥匙
 *     payload = { v:1, cid, iid, kind, exp, iat }
 *     iid 必须等于本机 installId，exp = 0 表示永久。
 *
 * 兼容 `BZR1` / `BZR2` 老码（v1/v2 payload）：纯离线，验签通过即解锁，
 * 已经发出去的码不作废。老码没有 kind，也不会走核销。
 *
 * 为什么 v3 要升前缀：老客户端只认 v1/v2，会把 plan:"trial" 当普通码
 * 直接放行（paid 只看 exp），7 天试用就变成永久免费。升 v3 后老客户端
 * 报「格式不对，请升级插件」——这是安全边界，不是兼容性事故。
 * ============================================================ */

/** 发行公钥：ECDSA P-256（SPKI DER 的 base64）。由 scripts/gen-keys.mjs 生成。 */
const PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDlauLuKMfRhggbifaU3QcR1R+gX7518ibeYfPeyFzLYcQesrjY0vViS/SukngZqMZDPwBbebtPoGqw/pLJRnxg==';

/** 令牌公钥：服务端签 BZRT 用。由 scripts/gen-token-keys.mjs 生成。 */
const TOKEN_PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfYT+rhq0US/lnlokj2UXRptaI25DDPn6jqNFLn1Glr+Z6dpYSkAdbtvznnuWklUffHylaTPO8+eJwnXnyEvEYg==';

export type LicensePlan = 'lifetime' | 'year' | 'trial';
export type LicenseKind = 'universal' | 'paid';

export interface LicensePayload {
  /** 1 / 2 = 老码（离线）；3 = 需要联网核销的新码 */
  v: 1 | 2 | 3;
  /** 码号 / 订单号。服务端账本、撤回、统计都靠它 */
  id?: string;
  /** 购买者署名：设置页会显示出来，等于一枚水印 */
  name?: string;
  plan?: LicensePlan;
  /** 过期毫秒戳；缺省或 0 = 永久（仅 v1/v2 用） */
  exp?: number;
  /** v3：universal = 通用码，paid = 付费码 */
  kind?: LicenseKind;
  /** v3：令牌有效天数，0 = 永久 */
  days?: number;
  /** v3 付费码：最多允许激活几台设备 */
  maxAct?: number;
  /** v3 通用码：兑换截止毫秒戳 */
  redeemBy?: number;
  /** v3：备注，只给人看 */
  note?: string;
}

export interface LicenseCheck {
  ok: boolean;
  message: string;
  payload?: LicensePayload;
  /** v3 码签名有效，但必须先联网核销才能解锁 */
  needRedeem?: boolean;
}

export interface TokenPayload {
  v: 1;
  /** 码号 */
  cid: string;
  /** 激活它的 installId */
  iid: string;
  kind: LicenseKind;
  /** 到期毫秒戳；0 = 永久 */
  exp: number;
  iat: number;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseLicense(
  code: string,
): { payloadBytes: Uint8Array; sig: Uint8Array; payload: LicensePayload } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3) return null;
  const prefix = parts[0];
  if (prefix !== 'BZR1' && prefix !== 'BZR2' && prefix !== 'BZR3') return null;
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    if (payloadBytes.length > 4096) return null;
    const sig = b64urlToBytes(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    /* 前缀与版本必须对得上：BZR3 只认 v3，老前缀只认 v1/v2。
       否则「把 v3 的 payload 塞进 BZR2 前缀」就能让老客户端绕过核销。 */
    if (prefix === 'BZR3') {
      if (payload?.v !== 3) return null;
    } else if (payload?.v !== 1 && payload?.v !== 2) {
      return null;
    }
    return { payloadBytes, sig, payload };
  } catch {
    return null;
  }
}

function spkiToCryptoKey(b64: string): Promise<CryptoKey> {
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    'spki',
    der.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

/* importKey 每次都算一遍太浪费：can() 在每次重绘里都会走到同步判定，
   启动验签也只跑一次，缓存 Promise 就够了。 */
let codeKeyPromise: Promise<CryptoKey> | null = null;
let tokenKeyPromise: Promise<CryptoKey> | null = null;

function codeKey(): Promise<CryptoKey> {
  if (!codeKeyPromise) codeKeyPromise = spkiToCryptoKey(PUBKEY_SPKI_B64);
  return codeKeyPromise;
}

function tokenKey(): Promise<CryptoKey> {
  if (!tokenKeyPromise) tokenKeyPromise = spkiToCryptoKey(TOKEN_PUBKEY_SPKI_B64);
  return tokenKeyPromise;
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 验一枚激活码。任何一步不过都给人话，不抛——设置页直接显示 message。
 *
 * v3 码在这里**不会**返回 ok：签名通过后返回 needRedeem，由调用方去
 * 联网换令牌。真正解锁的是令牌，不是这串码。
 */
export async function verifyLicense(code: string): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, message: '还没有填激活码。' };
  if (!PUBKEY_SPKI_B64) return { ok: false, message: '发行方还没配置公钥（开发阶段先用签发脚本自测）。' };
  const parsed = parseLicense(code);
  if (!parsed) return { ok: false, message: '激活码格式不对：应为 BZR3 / BZR2 / BZR1 开头的三段式。' };
  try {
    const key = await codeKey();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      parsed.sig.buffer as ArrayBuffer,
      parsed.payloadBytes.buffer as ArrayBuffer,
    );
    if (!ok) return { ok: false, message: '激活码验签失败：内容或签名被改过。' };

    const p = parsed.payload;

    if (p.v === 3) {
      const redeemBy = p.redeemBy ?? 0;
      if (redeemBy && Date.now() > redeemBy) {
        return { ok: false, message: `这枚激活码已于 ${dateText(redeemBy)} 截止兑换。`, payload: p };
      }
      const days = p.days ?? 0;
      const until = days > 0 ? `之后 ${days} 天离线可用` : '之后永久离线可用';
      return {
        ok: false,
        needRedeem: true,
        message: `这枚激活码需要联网核销一次，${until}。`,
        payload: p,
      };
    }

    const exp = p.exp ?? 0;
    if (exp && Date.now() > exp) {
      return { ok: false, message: `激活码已于 ${dateText(exp)} 过期。` };
    }
    const who = p.name ? `，${p.name}` : '';
    const until = exp ? `有效期到 ${dateText(exp)}` : '永久有效';
    return { ok: true, message: `已激活${who}，${until}。`, payload: p };
  } catch (e) {
    return { ok: false, message: `验签出错：${(e as Error)?.message || '环境不支持 WebCrypto'}` };
  }
}

/**
 * 拆设备令牌（不验签）。同步判定用它取 exp / iid / kind。
 * 和激活码同一条原则：只存原文，结论现解。
 */
export function parseToken(token: string): TokenPayload | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'BZRT') return null;
  try {
    const bytes = b64urlToBytes(parts[1]);
    if (bytes.length > 4096) return null;
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as TokenPayload;
    if (payload?.v !== 1) return null;
    if (typeof payload.iid !== 'string' || !payload.iid) return null;
    if (typeof payload.exp !== 'number') return null;
    if (payload.kind !== 'universal' && payload.kind !== 'paid') return null;
    return payload;
  } catch {
    return null;
  }
}

/** 真验一枚设备令牌（异步）。启动时跑一次，挡掉手写 localStorage 的假令牌。 */
export async function verifyToken(
  token: string,
): Promise<{ ok: boolean; message: string; payload?: TokenPayload }> {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'BZRT') {
    return { ok: false, message: '设备令牌格式不对。' };
  }
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const key = await tokenKey();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sig.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer,
    );
    if (!ok) return { ok: false, message: '设备令牌验签失败。' };
    const payload = parseToken(token);
    if (!payload) return { ok: false, message: '设备令牌内容不合法。' };
    return { ok: true, message: 'ok', payload };
  } catch (e) {
    return { ok: false, message: `令牌验签出错：${(e as Error)?.message || '环境不支持 WebCrypto'}` };
  }
}

/** 设置页的授权状态行。v3 码的结论由 entitlement 统一算，这里不重复判断。 */
export function licenseSummary(code: string): string {
  const parsed = parseLicense(code);
  if (!parsed) return '';
  if (parsed.payload.v === 3) return '';
  const exp = parsed.payload.exp ?? 0;
  if (exp && Date.now() > exp) return `当前激活码已过期（${dateText(exp)}），高级功能不可用。`;
  const who = parsed.payload.name ? `（${parsed.payload.name}）` : '';
  const until = exp ? `有效期到 ${dateText(exp)}` : '永久有效';
  return `当前已激活${who}：${until}。`;
}
