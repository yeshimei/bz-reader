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
 *
 * **试用码要求「必须最新版」（2026-11-22 定，同日改过一次口径）**：
 * 码里不写版本，只写到到期时间；插件启动时拿线上最新版跟自己的版本比，
 * 不是最新版就不解锁。判定放在 data/entitlement（那里才有最新版缓存），
 * 本文件只负责签名与到期，保持纯离线。
 * ============================================================ */

import { t } from '../i18n';

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
  /**
   * 赞助人标记（2026-11-09）：商品页承诺「使用此高级版激活码，会额外在
   * 插件中标识赞助人身份」。老码没有这个字段，判定一律按 false。
   */
  patron?: boolean;
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
 *
 * 「试用码不是最新版」不在这张表里：那是运行期联网判定的结论，不是验码
 * 失败的结论（签名、到期都没问题），归 entitlement 管。
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

/**
 * 用发行方公钥验一段任意字节的签名（P1363 裸格式 r||s）。
 *
 * 停用名单（data/revoked）复用它：名单是公开文件，必须验签，否则代理 /
 * 机场塞一份假名单就能把所有付费用户打回基础版——那是比盗版更糟的事故。
 * 验签环境异常一律返回 false：「验不了」不能当成「验过了」。
 */
export async function verifySignedBytes(bytes: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (!PUBKEY_SPKI_B64) return false;
  try {
    const key = await spkiToCryptoKey(
      Uint8Array.from(atob(PUBKEY_SPKI_B64), (c) => c.charCodeAt(0)).buffer,
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(sig).buffer,
      new Uint8Array(bytes).buffer,
    );
  } catch {
    return false;
  }
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 这枚码是不是试用码。只认 `plan === 'trial'`——买断码与赞助人码
 * 「什么都不限制」，这条判定放在唯一入口，调用方不必各自记得。
 */
export function isTrialCode(payload: LicensePayload | null | undefined): boolean {
  return payload?.plan === 'trial';
}

/** 剩余天数，向上取整；没有到期时间或已过期 → 0 */
export function trialDaysLeft(exp: number, now = Date.now()): number {
  if (!exp || exp <= now) return 0;
  return Math.ceil((exp - now) / 86_400_000);
}

/** 试用码的人话前缀：署名 + 剩余天数 + 到期日（两个调用点共用，免得多语言文案写两份） */
function trialHead(payload: LicensePayload, exp: number, now: number): string {
  const who = payload.name ? t('tier.who', { name: payload.name }) : '';
  return t('license.trialHead', {
    who,
    days: trialDaysLeft(exp, now),
    until: dateText(exp),
  });
}

/**
 * 验一枚激活码。任何一步不过都给人话，不抛——设置页直接显示 message。
 * 成功后把 plan / exp / name 交给调用方写进 entitlement。
 *
 * **只管签名与到期**：试用码「必须是最新版」的判定要联网拿线上版本，
 * 放在 data/entitlement 里做（那里才知道当前插件版本与最新版缓存）。
 * 这样验码本身保持纯离线，网络失败不会影响一枚真码的签名结论。
 *
 * `now` 由调用方传 `trustedNow()`：到期判定不能直接读系统时钟，
 * 否则把时间往回拨就能让过期码一直「还没到」。默认值只给纯函数测试
 * 与不关心时钟的调用方留一条退路。
 */
export async function verifyLicense(code: string, now: number = Date.now()): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, reason: 'empty', message: t('license.empty') };
  if (!PUBKEY_SPKI_B64) {
    return { ok: false, reason: 'no-pubkey', message: t('license.noPubkey') };
  }
  const parsed = parseLicense(code);
  if (!parsed) {
    return { ok: false, reason: 'format', message: t('license.format') };
  }
  try {
    const key = await spkiToCryptoKey(
      Uint8Array.from(atob(PUBKEY_SPKI_B64), (c) => c.charCodeAt(0)).buffer,
    );
    /* 复制一份拿到确定的 ArrayBuffer：`Uint8Array.buffer` 的类型是
       ArrayBufferLike（可能是 SharedArrayBuffer），crypto.subtle 只收 ArrayBuffer。 */
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(parsed.sig).buffer,
      new Uint8Array(parsed.payloadBytes).buffer,
    );
    if (!ok) return { ok: false, reason: 'invalid', message: t('license.invalid') };
    const exp = parsed.payload.exp ?? 0;
    if (exp && now > exp) {
      return { ok: false, reason: 'expired', message: t('license.expired', { date: dateText(exp) }) };
    }
    if (parsed.payload.plan === 'trial' && exp) {
      return {
        ok: true,
        message: t('license.trialOk', { head: trialHead(parsed.payload, exp, now) }),
        payload: parsed.payload,
      };
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
export function licenseSummary(code: string, now: number = Date.now()): string {
  const parsed = parseLicense(code);
  if (!parsed) return '';
  const payload = parsed.payload;
  const exp = payload.exp ?? 0;
  if (exp && now > exp) return t('license.summaryExpired', { date: dateText(exp) });
  if (payload.plan === 'trial' && exp) {
    return t('license.summaryTrial', { head: trialHead(payload, exp, now) });
  }
  const who = payload.name ? `（${payload.name}）` : '';
  const until = exp ? t('tier.until', { date: dateText(exp) }) : t('tier.forever');
  return t('license.summaryPaid', { who, until });
}
