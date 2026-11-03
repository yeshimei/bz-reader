-- bz-reader 激活服务 · D1 表结构
-- 部署：npx wrangler d1 execute bz-license --file=server/schema.sql --remote

CREATE TABLE IF NOT EXISTS codes (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,              -- universal | paid
  days       INTEGER NOT NULL DEFAULT 0, -- 0 = 永久（付费码）
  max_act    INTEGER,                    -- NULL = 不限（通用码）
  redeem_by  INTEGER,                    -- 兑换截止毫秒戳，NULL = 不限期
  revoked    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activations (
  code_id    TEXT NOT NULL,
  install_id TEXT NOT NULL,
  first_at   INTEGER NOT NULL,
  PRIMARY KEY (code_id, install_id)      -- 幂等：同一台机器只占一行
);

CREATE INDEX IF NOT EXISTS idx_activations_code ON activations(code_id);
