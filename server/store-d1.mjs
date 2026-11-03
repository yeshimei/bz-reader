/* ============================================================
 * bz-reader · 激活服务 · D1 存储（server/store-d1.mjs）
 *
 * 线上用这份。表结构见 server/schema.sql。
 * 两个关键点都落在 SQL 里，不在 JS 里：
 *   · (code_id, install_id) 主键 → 幂等
 *   · INSERT … SELECT … WHERE 计数 → 原子，不超发
 * ============================================================ */

/** @param {D1Database} db */
export function d1Store(db) {
  async function getCode(id) {
    const row = await db
      .prepare(
        'SELECT id, kind, days, max_act, redeem_by, revoked, note, created_at FROM codes WHERE id = ?',
      )
      .bind(id)
      .first();
    return row ?? null;
  }

  async function getActivation(codeId, installId) {
    const row = await db
      .prepare('SELECT code_id, install_id, first_at FROM activations WHERE code_id = ? AND install_id = ?')
      .bind(codeId, installId)
      .first();
    return row ?? null;
  }

  async function countActivations(codeId) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM activations WHERE code_id = ?')
      .bind(codeId)
      .first();
    return Number(row?.n ?? 0);
  }

  return {
    getCode,

    async putCode(p, now) {
      await db
        .prepare(
          `INSERT INTO codes (id, kind, days, max_act, redeem_by, revoked, note, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          p.id,
          p.kind,
          Number(p.days) || 0,
          p.maxAct ?? null,
          p.redeemBy ?? null,
          p.note ?? null,
          now,
        )
        .run();
      return getCode(p.id);
    },

    getActivation,
    countActivations,

    /**
     * 原子占位。limit = null 表示不限（通用码）。
     * 返回 true 表示「这台机器现在有名额」——包括本来就已存在的情况。
     */
    async tryInsertActivation(codeId, installId, now, limit) {
      const res = await db
        .prepare(
          `INSERT INTO activations (code_id, install_id, first_at)
           SELECT ?1, ?2, ?3
           WHERE ?4 IS NULL
              OR (SELECT COUNT(*) FROM activations WHERE code_id = ?1) < ?4
           ON CONFLICT(code_id, install_id) DO NOTHING`,
        )
        .bind(codeId, installId, now, limit)
        .run();
      if ((res?.meta?.changes ?? 0) > 0) return true;
      // 没插进去：要么名额满了，要么这台机器已经占过位（并发重放）
      return (await getActivation(codeId, installId)) !== null;
    },
  };
}
