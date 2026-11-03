/* ============================================================
 * bz-reader · 激活服务 · 本地 JSON 存储（server/store-json.mjs）
 *
 * 只给本地 dev 与测试用：一个文件装两张表。
 * 每次读写都重新读盘——这样 `scripts/license-admin.mjs --revoke` 改完，
 * 正在跑的 dev-server 下一次请求就能看见（两个进程各持一份内存会互相盖）。
 *
 * 线上不要用：没有并发控制，也没有备份。
 * ============================================================ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** @param {string} file */
export function jsonStore(file) {
  function read() {
    /** @type {{codes: any[], activations: any[]}} */
    const empty = { codes: [], activations: [] };
    if (!existsSync(file)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed?.codes) || !Array.isArray(parsed?.activations)) return empty;
      return parsed;
    } catch {
      /* 坏文件当空库：本地 dev 而已，别把启动卡死 */
      return empty;
    }
  }

  function save(data) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  const findCode = (data, id) => data.codes.find((c) => c.id === id) ?? null;
  const findAct = (data, codeId, installId) =>
    data.activations.find((a) => a.code_id === codeId && a.install_id === installId) ?? null;
  const count = (data, codeId) => data.activations.filter((a) => a.code_id === codeId).length;

  return {
    async getCode(id) {
      return findCode(read(), id);
    },

    async putCode(p, now) {
      const data = read();
      const hit = findCode(data, p.id);
      if (hit) return hit;
      const row = {
        id: p.id,
        kind: p.kind,
        days: Number(p.days) || 0,
        max_act: p.maxAct ?? null,
        redeem_by: p.redeemBy ?? null,
        revoked: 0,
        note: p.note ?? null,
        created_at: now,
      };
      data.codes.push(row);
      save(data);
      return row;
    },

    async getActivation(codeId, installId) {
      return findAct(read(), codeId, installId);
    },

    async countActivations(codeId) {
      return count(read(), codeId);
    },

    async tryInsertActivation(codeId, installId, now, limit) {
      const data = read();
      if (findAct(data, codeId, installId)) return true;
      if (limit !== null && count(data, codeId) >= limit) return false;
      data.activations.push({ code_id: codeId, install_id: installId, first_at: now });
      save(data);
      return true;
    },
  };
}
