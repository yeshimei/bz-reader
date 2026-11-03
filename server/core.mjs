/* ============================================================
 * bz-reader · 激活服务 · 核销核心（server/core.mjs）
 *
 * 一个纯函数：输入「码 + 安装标识 + 存储 + 两把密钥」，输出 HTTP 状态与响应体。
 * 不碰数据库、不碰 HTTP 框架——D1、本地 JSON、测试里的内存存储都只是换一个
 * store 实现，核销规则只有这一份。
 *
 * 两条不变量（改代码前先读这两行）：
 *   1. (code_id, install_id) 唯一：同一台机器重复激活不重复计数。用户会双击、
 *      会超时重试、会重装，没有这条，5 次激活在 1 个人手里就烧完了。
 *   2. 名额判断与插入必须是同一条原子语句（store.tryInsertActivation），
 *      不能「先 COUNT 再 INSERT」——两个人同时点会超发。
 *
 * 隐私红线：只收 code / installId / version，不落 IP、不记书名。
 * ============================================================ */

import { verifyCode, signToken } from './crypto.mjs';

const DAY = 86_400_000;

/**
 * @typedef {Object} CodeRow
 * @property {string} id
 * @property {'universal'|'paid'} kind
 * @property {number} days
 * @property {number|null} max_act
 * @property {number|null} redeem_by
 * @property {number} revoked
 * @property {string|null} note
 * @property {number} created_at
 *
 * @typedef {Object} Store
 * @property {(id: string) => Promise<CodeRow|null>} getCode
 * @property {(p: any, now: number) => Promise<CodeRow>} putCode
 * @property {(codeId: string, installId: string) => Promise<object|null>} getActivation
 * @property {(codeId: string, installId: string, now: number, limit: number|null) => Promise<boolean>} tryInsertActivation
 * @property {(codeId: string) => Promise<number>} countActivations
 */

/** @returns {{status: number, body: any}} */
function fail(status, error, message) {
  return { status, body: { error, message } };
}

function isKind(v) {
  return v === 'universal' || v === 'paid';
}

/**
 * @param {Object} opts
 * @param {any} opts.body            请求体 { code, installId, version }
 * @param {Store} opts.store
 * @param {CryptoKey} opts.codeKey   发行公钥（只验，不签）
 * @param {CryptoKey} opts.tokenKey  令牌私钥（只签）
 * @param {number} [opts.now]
 */
export async function handleRedeem({ body, store, codeKey, tokenKey, now = Date.now() }) {
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const installId = typeof body?.installId === 'string' ? body.installId.trim() : '';
  const version = typeof body?.version === 'string' ? body.version.slice(0, 32) : '';

  if (!code) return fail(400, 'bad_request', '缺少激活码。');
  if (code.length > 8192) return fail(400, 'bad_request', '激活码过长。');
  if (installId.length < 8 || installId.length > 128) {
    return fail(400, 'bad_request', '安装标识不合法。');
  }

  const payload = await verifyCode(code, codeKey);
  if (!payload) return fail(400, 'invalid_code', '激活码格式不对，或签名无效。');

  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id || !isKind(payload.kind)) return fail(400, 'bad_payload', '激活码内容不完整。');

  /* 自注册：码是签过名的，首次见到就按 payload 建一行。
     省掉「签完码再跑 SQL 入库」，也不会出现签了忘入库。
     之后以库里的行为准（撤回、加次数、延兑换期都改库，不改已发出的码）。 */
  let row = await store.getCode(id);
  if (!row) row = await store.putCode(payload, now);

  if (row.revoked) return fail(410, 'revoked', '这枚激活码已停用。');

  const redeemBy = row.redeem_by ?? payload.redeemBy ?? 0;
  if (redeemBy && now > redeemBy) {
    return fail(410, 'expired', '这枚激活码已过兑换期。');
  }

  const kind = row.kind ?? payload.kind;
  const days = Number.isFinite(row.days) ? row.days : Number(payload.days) || 0;
  const maxAct = kind === 'paid' ? Number(row.max_act ?? payload.maxAct) || 0 : null;

  if (kind === 'paid' && maxAct < 1) {
    return fail(400, 'bad_payload', '付费码没有配置激活次数上限。');
  }
  if (kind === 'universal' && days < 1) {
    return fail(400, 'bad_payload', '通用码没有配置有效天数。');
  }

  /* 幂等：这台机器已经激活过，直接重发令牌，不占新次数 */
  const existing = await store.getActivation(id, installId);
  if (!existing) {
    const ok = await store.tryInsertActivation(id, installId, now, kind === 'paid' ? maxAct : null);
    if (!ok) {
      return fail(409, 'activation_limit', `这枚激活码的 ${maxAct} 次激活已用完。`);
    }
  }

  const used = await store.countActivations(id);
  const exp = days > 0 ? now + days * DAY : 0;
  const token = await signToken(
    { v: 1, cid: id, iid: installId, kind, exp, iat: now },
    tokenKey,
  );

  return {
    status: 200,
    body: {
      token,
      kind,
      days,
      exp,
      used,
      maxAct,
    },
  };
}
