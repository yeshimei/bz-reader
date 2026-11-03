# 激活服务（server/）

一个接口、两张表。负责两件事：

- **通用码**：不限名额、激活后 7 天、随时可撤回。
- **付费码**：永久，但最多允许激活 N 台设备（按 installId 计数，重复激活不重复算）。

激活码本身仍是**离线 ECDSA 签名**的（`BZR3.…`，私钥在 `scripts/keys/private.pem`，不进服务器）。
服务器只拿公钥验签，签不出新码；它签的是**设备令牌**（`BZRT.…`），客户端拿令牌离线解锁。

## 本地跑

```bash
node scripts/gen-token-keys.mjs        # 只需一次，生成令牌密钥
node server/dev-server.mjs             # 127.0.0.1:8787，存储落 .scratch/license-store.json
```

客户端把端点指到本地（Obsidian 控制台）：

```js
localStorage.setItem('bzs-license-endpoint', 'http://127.0.0.1:8787/v1/redeem')
```

清掉就回默认线上地址：

```js
localStorage.removeItem('bzs-license-endpoint')
```

## 签发与核销

```bash
# 通用码：7 天，12 月 3 日前可兑换
node scripts/issue-license.mjs --kind universal --days 7 --redeem-by 2026-12-03 --note "QQ群第1批"

# 付费码：永久，最多 5 台
node scripts/issue-license.mjs --kind paid --max-act 5 --name 张三
```

```bash
curl -s http://127.0.0.1:8787/v1/redeem \
  -H 'content-type: application/json' \
  -d '{"code":"BZR3.…","installId":"test-install-0001","version":"0.1.0"}'
```

## 撤回 / 加次数（本地）

```bash
node scripts/license-admin.mjs --list
node scripts/license-admin.mjs --revoke U-20261103-01
node scripts/license-admin.mjs --unrevoke U-20261103-01
node scripts/license-admin.mjs --set-max P-20261103-0001 10
node scripts/license-admin.mjs --stats P-20261103-0001
```

线上（D1）：

```bash
npx wrangler d1 execute bz-license --remote \
  --command "UPDATE codes SET revoked = 1 WHERE id = 'U-20261103-01'"
npx wrangler d1 execute bz-license --remote \
  --command "SELECT code_id, COUNT(*) AS used FROM activations GROUP BY code_id"
```

## 部署

```bash
npx wrangler d1 create bz-license          # 把 database_id 填进 wrangler.toml
npx wrangler d1 execute bz-license --file=server/schema.sql --remote
npx wrangler secret put TOKEN_PRIVATE_KEY  # 粘 scripts/keys/token-private.pem 全文
npx wrangler deploy
```

然后给 Worker 绑一个自定义域名（如 `lic.bz-reader.dev`），**不要用 `workers.dev` 裸域名**——国内经常连不上。
`src/data/redeem.ts` 里的 `DEFAULT_ENDPOINT` 改成这个域名。

## 两条不变量

1. `(code_id, install_id)` 唯一 → 同一台机器重复激活不重复计数。
2. 名额判断与插入是**同一条 SQL**（`INSERT … SELECT … WHERE (SELECT COUNT(*)) < max_act`），不是「先 COUNT 再 INSERT」，否则并发会超发。

## 隐私

- 只收 `code + installId + version`，不落 IP、不记书名、不记阅读行为。
- 本地 dev 的日志只有「码号前 6 位 + installId 前 8 位 + 状态」。
- 线上如果要加访问日志，别带 IP——带了就属于 server-side telemetry，Obsidian 要求 README 附隐私政策。

## 成本

Workers 免费额度 10 万请求/天，D1 免费 500 万行读/天、10 万行写/天。
一次核销大约 4 次查询 + 1 次写入；几百个用户一年也就几百次请求。
