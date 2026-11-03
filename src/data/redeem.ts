/* ============================================================
 * bz-reader · 联网核销（data/redeem.ts）
 *
 * 唯一一处向激活服务发请求的地方。只发三个字段：
 *   code       激活码原文
 *   installId  本机随机 UUID（不是硬件指纹）
 *   version    插件版本号
 *
 * 不发送：书名、笔记、划线、阅读时长、任何 vault 内容。
 * 用 Obsidian 的 requestUrl（绕过 CORS），不用 fetch。
 *
 * 端点默认是线上地址；本地联调在控制台写：
 *   localStorage.setItem('bzs-license-endpoint', 'http://127.0.0.1:8787/v1/redeem')
 * ============================================================ */

import { requestUrl } from 'obsidian';
import { installId } from './entitlement';
import { verifyToken } from './license';

const DEFAULT_ENDPOINT = 'https://lic.bz-reader.dev/v1/redeem';
const ENDPOINT_KEY = 'bzs-license-endpoint';

export interface RedeemResult {
  ok: boolean;
  message: string;
  /** 成功时带回令牌，由调用方落库（redeem 自己不写状态） */
  token?: string;
  kind?: 'universal' | 'paid';
  days?: number;
  used?: number;
  maxAct?: number | null;
}

/** 当前端点。localStorage 有覆盖就用覆盖，方便本地联调。 */
export function licenseEndpoint(): string {
  try {
    const override = window.localStorage.getItem(ENDPOINT_KEY);
    if (override) return override;
  } catch {
    /* 读不到就用默认 */
  }
  return DEFAULT_ENDPOINT;
}

interface RedeemBody {
  token?: string;
  kind?: 'universal' | 'paid';
  days?: number;
  exp?: number;
  used?: number;
  maxAct?: number | null;
  error?: string;
  message?: string;
}

/**
 * 核销一枚 BZR3 码。成功时返回令牌，**不写本地状态**——
 * 落库顺序（先记码、再记令牌）由 data/activate.ts 保证。
 */
export async function redeemLicense(code: string, version: string): Promise<RedeemResult> {
  let res;
  try {
    res = await requestUrl({
      url: licenseEndpoint(),
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ code: code.trim(), installId: installId(), version }),
      throw: false,
    });
  } catch {
    return {
      ok: false,
      message: '连不上激活服务。检查网络后再点一次「激活」——这次不会消耗激活次数。',
    };
  }

  let data: RedeemBody | null = null;
  try {
    data = res.json as RedeemBody;
  } catch {
    data = null;
  }

  if (res.status === 200 && data?.token) {
    /* 先本地验一遍：能挡住「端点被换成假服务」和「客户端公钥没跟上服务端换钥」 */
    const check = await verifyToken(data.token);
    if (!check.ok) {
      return { ok: false, message: '服务端返回的令牌验签失败，请更新插件后再试。' };
    }
    const kind = data.kind ?? check.payload?.kind ?? 'universal';
    const days = data.days ?? 0;
    const used = data.used ?? 0;
    const maxAct = data.maxAct ?? null;
    const message =
      kind === 'paid'
        ? `已激活${maxAct ? ` · 本码已用 ${used}/${maxAct} 次` : ''}。`
        : days > 0
          ? `试用已开始 · ${days} 天内高级功能全部可用。`
          : '已激活。';
    return { ok: true, message, token: data.token, kind, days, used, maxAct };
  }

  const fallback = data?.message;
  if (res.status === 409) {
    return { ok: false, message: fallback || '这枚激活码的激活次数已用完。' };
  }
  if (res.status === 410) {
    return { ok: false, message: fallback || '这枚激活码已停用，或过了兑换期。' };
  }
  if (res.status === 400) {
    return { ok: false, message: fallback || '激活码无效。' };
  }
  return {
    ok: false,
    message: fallback || `激活服务暂时不可用（${res.status}），稍后再试。`,
  };
}
