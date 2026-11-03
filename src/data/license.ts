/* ============================================================
 * bz-reader · 激活码（data/license.ts）
 *
 * 格式 `BZR2.<base64url(payload)>.<base64url(sig)>`：
 *   payload = UTF-8 JSON `{ v: 2, id, name?, plan, exp? }`
 *   exp 是毫秒时间戳，缺省/0 = 永久；
 *   sig = ECDSA P-256 + SHA-256，**IEEE-P1363 裸格式（r||s 各 32 字节）**
 *   ——WebCrypto 的 subtle.verify 只认这个，签发脚本里从 DER 转过来。
 *
 * **离线验签，不联网**：公钥内嵌在包里，激活一次管到 exp 为止。
 * 这不影响上架政策——签名逻辑（含公钥）公开是常态，安全靠私钥，
 * 不靠藏代码。Bases Power Pack 用的是同一套做法（Ed25519 版）。
 *
 * 兼容 `BZR1`（v1 payload 只有 name/exp，没有 id/plan）。已经发出去的
 * 老码不作废——作废老码等于得罪最早那批付费用户。
 *
 * 不做设备上限：码可复制这件事无法靠离线签名解决，而真要做限制就得
 * 上服务端记账，那会把「换机 / 重装 / 多 vault」全部变成客服工单。
 * 防线放在别处：个性化署名、短期码续期、在线吊销名单。
 * ============================================================ */

/** ECDSA P-256 公钥（SPKI DER 的 base64）。由 scripts/gen-keys.mjs 生成。 */
const PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDlauLuKMfRhggbifaU3QcR1R+gX7518ibeYfPeyFzLYcQesrjY0vViS/SukngZqMZDPwBbebtPoGqw/pLJRnxg==';

export type LicensePlan = 'lifetime' | 'year' | 'trial';

export interface LicensePayload {
  /** 1 = 老码，2 = 带 id/plan 的新码 */
  v: 1 | 2;
  /** 码号 / 订单号。服务端吊销名单与「谁泄露了」都靠它 */
  id?: string;
  /** 购买者署名：设置页会显示出来，等于一枚水印 */
  name?: string;
  plan?: LicensePlan;
  /** 过期毫秒戳；缺省或 0 = 永久 */
  exp?: number;
}

/**
 * 验签失败的原因分类。
 *
 * 调用方靠它决定「这枚码还能不能留」——早先只有 ok / !ok 两态，于是
 * 「到期」和「验签环境抖动」走同一条 `clearLicense()`：年费用户到期当天
 * 启动一次，码就被抹了，续费后还得翻邮件；移动端 WebView 偶发一次
 * `crypto.subtle` 异常，付费用户当场掉回基础版。
 *
 *   empty      没填
 *   format     三段式都对不上（手输错、复制不全）
 *   no-pubkey  发行方没配公钥（开发期）
 *   invalid    签名不对 / 内容被改 —— 只有这种才该清码
 *   expired    签名是对的，只是到期 —— 保留码、只降级
 *   env-error  WebCrypto 不可用 / 抛错 —— 完全不动，沿用上次结论
 */
export type LicenseFail = 'empty' | 'format' | 'no-pubkey' | 'invalid' | 'expired' | 'env-error';

export interface LicenseCheck {
  ok: boolean;
  message: string;
  payload?: LicensePayload;
  reason?: LicenseFail;
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
  if (parts[0] !== 'BZR1' && parts[0] !== 'BZR2') return null;
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (payload?.v !== 1 && payload?.v !== 2) return null;
    return { payloadBytes, sig, payload };
  } catch {
    return null;
  }
}

function spkiToCryptoKey(spki: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 验一枚激活码。任何一步不过都给人话，不抛——设置页直接显示 message。
 * 成功后把 plan / exp / name 交给调用方写进 entitlement。
 */
export async function verifyLicense(code: string): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, reason: 'empty', message: '还没有填激活码。' };
  if (!PUBKEY_SPKI_B64) {
    return { ok: false, reason: 'no-pubkey', message: '发行方还没配置公钥（开发阶段先用签发脚本自测）。' };
  }
  const parsed = parseLicense(code);
  if (!parsed) {
    return { ok: false, reason: 'format', message: '激活码格式不对：应为 BZR1 / BZR2 开头的三段式。' };
  }
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
    if (!ok) return { ok: false, reason: 'invalid', message: '激活码验签失败：内容或签名被改过。' };
    const exp = parsed.payload.exp ?? 0;
    if (exp && Date.now() > exp) {
      return { ok: false, reason: 'expired', message: `激活码已于 ${dateText(exp)} 过期。` };
    }
    const who = parsed.payload.name ? `，${parsed.payload.name}` : '';
    const until = exp ? `有效期到 ${dateText(exp)}` : '永久有效';
    return { ok: true, message: `已激活${who}，${until}。`, payload: parsed.payload };
  } catch (e) {
    return {
      ok: false,
      reason: 'env-error',
      message: `验签出错：${(e as Error)?.message || '环境不支持 WebCrypto'}`,
    };
  }
}

/** 设置页的授权状态行（不再单独判过期——状态由 entitlement 统一算） */
export function licenseSummary(code: string): string {
  const parsed = parseLicense(code);
  if (!parsed) return '';
  const exp = parsed.payload.exp ?? 0;
  if (exp && Date.now() > exp) return `当前激活码已过期（${dateText(exp)}），高级功能不可用。`;
  const who = parsed.payload.name ? `（${parsed.payload.name}）` : '';
  const until = exp ? `有效期到 ${dateText(exp)}` : '永久有效';
  return `当前已激活${who}：${until}。`;
}
