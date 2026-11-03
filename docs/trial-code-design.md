# 激活码联网核销：通用码 + 付费码

> 状态：设计稿 v2（2026-11-03）。取代本文 v1 的「名额 / 并发设备」模型。
> 相关：`docs/pricing-and-license.md`（整体付费方案）、`src/data/license.ts`（BZR1/BZR2 离线验签）、`src/data/entitlement.ts`（三态状态机）。

## 0. 结论

1. 两种码，**一套服务**：通用码（不限名额、7 天、可随时撤）与付费码（记录最多激活次数）都只走一个接口 `POST /v1/redeem`。
2. **通用码也必须过一次服务器**——不是为了限名额，是为了「随时能撤」。签名码一旦发出去，离线就撤不回来。
3. 7 天试用**不需要心跳**：令牌寿命 7 天，激活后完全离线；付费码的令牌永久，激活后也不再联网。
4. 联网**不影响上架**，但有三条披露义务（README 写清服务、字段、原因）和两条禁令（客户端遥测、代码混淆）。
5. 服务选型：**Cloudflare Workers + D1 + 自有域名**（¥0 计算 + 域名 ~¥50/年，不需要备案）。国内访问是唯一风险，见 §8。

## 1. 两种码

| | 通用码 | 付费码 |
|---|---|---|
| 用途 | QQ 群福利 | 买断 |
| 名额 | 不限 | 不按设备限，只记「最多激活几次」 |
| 时长 | 激活后 7 天 | 永久（`days: 0`） |
| 撤回 | 服务端 `revoked=1`，立刻停止新激活 | 同上（已激活的令牌不受影响） |
| 兑换截止 | `redeemBy`（发码 + N 天） | 无 |
| 签名 | 离线私钥 | 离线私钥 |
| 解锁凭证 | 服务端令牌 | 服务端令牌 |

两者都**不是**「码本身解锁」。码是兑换券，令牌才是钥匙。

## 2. 为什么通用码也要联网

「随时可以撤下来」= 你按下撤回之后，码不能再被激活。这个判断必须发生在你按下之后、别人激活之前——只有服务端能提供这个时间点。

离线签名码做不到：它一旦发出去，任何拿到的人在任何时候都能验签通过。码里能写 `redeemBy`（比如 11 月 10 日），到期自然失效，但那是「定时」，不是「随时」。

**撤回的边界要说清楚**：`revoked=1` 只拦**新的**激活；已经换到令牌的人，7 天照常走完。要「连已激活的也立刻掐断」，就得把令牌做成 24 小时有效、每天续一次——那又回到心跳模型，为一个免费福利码不值得。

## 3. 码格式（BZR3）

```json
// 通用码
{ "v": 3, "kind": "universal", "id": "U-20261103-01", "days": 7,
  "redeemBy": 1796198399000, "note": "QQ群 2026-11 第 1 批" }

// 付费码
{ "v": 3, "kind": "paid", "id": "P-20261103-0001", "name": "张三",
  "days": 0, "maxAct": 5 }
```

| 字段 | 说明 |
|---|---|
| `kind` | 客户端据此决定：`universal` 失败可降级离线；`paid` 必须核销成功 |
| `days` | 令牌寿命，0 = 永久 |
| `maxAct` | 付费码允许的不同 installId 数量；通用码不写 |
| `redeemBy` | 兑换截止时间戳；通用码必填，付费码可空 |
| `name` | 署名水印，设置页显示「本副本授权给 张三」 |
| `id` | 账本主键；撤销与统计靠它 |

**为什么升 BZR3**：老客户端只认 v1/v2，会把 `kind` 当不存在、按 `plan` 放行。通用码 `days:7` 但老客户端不看 `days`，只看 `exp`——没有 `exp` 就等于永久。升 v3 后老客户端报「格式不对，请升级插件」，这是安全边界，不是兼容性事故。

签发：

```
node scripts/issue-license.mjs --kind universal --days 7 --redeem-by 2026-12-03
node scripts/issue-license.mjs --kind paid --max-act 5 --name 张三
```

## 4. 服务端

### 4.1 两张表

```sql
CREATE TABLE codes (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,          -- universal | paid
  days       INTEGER NOT NULL,       -- 0 = 永久
  max_act    INTEGER,                -- NULL = 不限
  redeem_by  INTEGER,
  revoked    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE activations (
  code_id    TEXT NOT NULL,
  install_id TEXT NOT NULL,
  first_at   INTEGER NOT NULL,
  PRIMARY KEY (code_id, install_id)
);
```

`activations` 的一行 = 一次激活。主键保证**同一台机器重复激活不重复计数**——这是整套设计最重要的一行。

### 4.2 核销

```
1. 公钥验签，要求 v=3                          ← 服务器只有公钥，签不出付费码
2. codes 里没有这个 id → 用 payload 自注册      ← 省掉「签完码再入库」
3. revoked → 410
4. universal 且 now > redeem_by → 410
5. (code_id, install_id) 已有行 → 直接签发令牌   ← 幂等
6. paid：COUNT(*) >= max_act → 409 activation_limit
7. INSERT activation（原子条件插入）
8. 签发令牌 { cid, iid, kind, exp: days ? now + days*86400e3 : 0 }
```

第 5 步：用户会双击、会超时重试、会重装。没有幂等，5 次激活在 1 个人手里就烧完了。
第 7 步：不能「先 COUNT 再 INSERT」，两个人同时点会超发；用 `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < max_act` 让数据库裁决。

### 4.3 令牌

```
BZRT.<b64url({v:1, cid, iid, kind, exp, iat})>.<b64url(ECDSA P-256 sig)>
```

- **第二把密钥**：离线发码私钥不进服务器，Worker 只放令牌私钥。被拖库最多伪造试用令牌，签不出买断码。
- 客户端存令牌原文，`exp` / `iid` 每次现解；启动时异步真验一次（沿用 `revalidateLicense` 的思路：只存原文，不存结论）。
- 令牌里带 `iid`，客户端比对本地 installId。拷走别人 localStorage 会连身份一起拷走——接受。

### 4.4 撤销

```sql
UPDATE codes SET revoked = 1 WHERE id = 'U-20261103-01';
```

一行 SQL，立刻生效（对新激活）。没有后台也能用 `wrangler d1 execute` 敲。

## 5. 客户端改动

| 文件 | 改什么 |
|---|---|
| `src/data/license.ts` | `parseLicense` 认 `BZR3`；`verifyLicense` 遇到 v3 返回 `needRedeem` 而不是 ok |
| `src/data/redeem.ts`（新） | `requestUrl` POST；存令牌；错误映射成人话 |
| `src/data/entitlement.ts` | `Ent` 加 `token`；tier 多一个来源；`revalidateToken()` |
| `src/shell/actions.ts` | `activate`：验签 → 需要核销就联网 → 成功才落库 |
| `src/shell/render/settings.ts` | 试用剩余天数 / 已激活次数 / 需要联网 |
| `src/plugin.ts` | onload 只做本地验签，**不发网络请求** |
| `README.md` | 网络披露 + 付费披露（见 §7） |

`requestUrl` 不是 `fetch`：绕过 CORS、审核偏好。当前仓库只有 `ai.ts` 用 `fetch`（连用户自己的 baseUrl），激活服务这条必须用 `requestUrl`。

请求体只有三个字段：

```ts
await requestUrl({
  url: 'https://lic.bz-reader.dev/v1/redeem',
  method: 'POST',
  contentType: 'application/json',
  body: JSON.stringify({ code, installId, version }),
  throw: false,
});
```

## 6. 离线与失败矩阵

| 场景 | 通用码 | 付费码 |
|---|---|---|
| 首次激活断网 | 提示「连不上激活服务，稍后再试」，不解锁 | 同左 |
| 已激活后断网 | 完全可用，直到 7 天 | 完全可用，永久 |
| 服务 5xx / 超时 | 同上降级 | 明确报错 + 重试，不消耗次数 |
| 码被撤回 | 新激活 410；已激活的走完 7 天 | 新激活 410；已激活的不受影响 |
| 超过兑换截止 | 410 | — |
| 激活次数用完 | — | 409 + 「请联系作者扩容」 |
| 重装插件 | localStorage 还在，installId 不变，重新激活不计数 | 同左 |
| 换机器 / 清空应用数据 | 新 installId，重新激活 | **会吃一次激活次数** |
| 同一机器两个 vault | installId 不变（localStorage 全局），不重复计数 | 同左 |
| 令牌过期 | 降级 free，数据全在、可导出 | — |
| 系统时钟回拨 | 按本地时间判 exp，配合现有 clockAnomaly | 同左 |

付费码「重装吃次数」是这条路线唯一的真实代价。缓解：`maxAct` 给宽一点（5 而不是 1），并留一个手动加次数的命令。

## 7. Obsidian 上架：政策原文与要写的话

### 7.1 政策怎么说

`Developer policies`（官方文档，2026-11 核对）：

> **Disclosures** — The following are only allowed if clearly indicated in your README:
> - Payment is required for full access.
> - An account is required for full access.
> - **Network use. Clearly explain which remote services are used and why they're needed.**
> - Server-side telemetry. Link to a privacy policy that explains how the data is handled must be included.

> **Not allowed** — Plugins must not: obfuscate code to hide its purpose; insert dynamic ads loaded over the internet; include client-side telemetry; install or update themselves or their dependencies.

结论：**联网本身完全允许**，激活服务器不构成上架障碍。真正的三条红线是：

1. **README 必须写清**用哪个服务、发什么、为什么（不写 = 违规）。
2. **不能有客户端遥测**——只发 `code + installId + version` 是安全的；一旦带上书名、阅读时长、笔记内容就是 telemetry，直接违规。
3. **不能混淆代码**——验签与判定逻辑必须可读，别写成谜题。

另外两条容易踩的：

- **不能自更新**：不要用激活服务下发新版 `main.js`。
- **服务端日志**：如果记 IP，属于 server-side telemetry，要附隐私政策链接。最省事的做法是**不记 IP**。

### 7.2 listing 的 payment 类型

`Community directory FAQ`：

> **Optional payment**: choose this if you rely on a third-party service that requires payment, or if you lock certain features behind payment.
> **Paid**: choose this if your plugin or theme is accessible by payment only.

bz 阅读免费版能完整读完一本书 → 选 **Optional payment**（锁部分功能），不是 Paid。注意 FAQ 同时提醒：**「有限免费试用不构成免费」**——如果你的免费层其实读不了书，就是 Paid。

### 7.3 README 要加的两段（可直接用）

```md
## 付费说明 / Pricing

完整功能需要付费。免费版可以完整阅读 EPUB / TXT（目录、翻页、排版、主题、进度、划线、书签、本章搜索）。
付费版解锁：结构化导出、书摘卡片、阅读统计、跨书搜索、AI、mobi/azw3/fb2/cbz、竖排双栏、朗读、并排、Book Map。
购买：https://afdian.com/a/bz-reader ｜ 交流群：https://qm.qq.com/q/bzreader

## 网络使用 / Network access

插件只在两种情况下联网，其余时间完全离线：

1. **激活码核销**（仅在你点击「激活」时）
   - 地址：`https://lic.bz-reader.dev/v1/redeem`
   - 发送：激活码、随机安装标识（UUID）、插件版本号
   - 用途：确认激活码有效 / 未被停用，并记录该码已激活的设备数
   - **不发送**：书名、笔记、划线、阅读时长或任何 vault 内容
2. **AI 功能**（仅在你填了自己的 API Key 并主动调用时）
   - 地址：你自己填的 baseUrl；插件不代理、不记录

无客户端遥测，不自动更新，不在后台轮询。
```

英文段直接对照翻译即可（审核者是英文母语，README 双语是上架前置项）。

### 7.4 移动端

iOS 上不要放「去购买」按钮（App Store 站外支付规则），只放「已购买请激活」。联网核销本身没问题。

## 8. 服务选型

### 8.1 对比

| 方案 | 国内可达 | 备案 | 成本 | 部署 | 备注 |
|---|---|---|---|---|---|
| **Cloudflare Workers + D1 + 自有域名** | 中（150–400ms，偶发抖动） | 不需要 | 域名 ~¥50/年，计算免费 | 低（wrangler 一条命令） | `workers.dev` 国内常不通，**必须绑自定义域名** |
| 腾讯云 CloudBase（云函数 + 云数据库） | 好（<50ms） | 自定义域名需 ICP | 免费体验版 3000 点/月（半年一续），正式几十元/月 | 低 | 默认域名只建议测试：有访问提示中间页、限频、风控关停风险 |
| 阿里云函数计算 FC | 好 | 自定义域名需 ICP | 按量，几分钱/月 | 中 | 需实名；默认域名同样只建议测试 |
| 香港轻量服务器 + Node | 较好（50–150ms） | 不需要 | ~¥25/月 | 中（自己运维） | 完全可控，但证书/进程/备份都归你 |
| Vercel / Netlify | 差（域名被墙或不稳） | — | — | 低 | 不推荐 |
| Deno Deploy | 不稳 | — | 免费 | 低 | 不推荐 |
| Supabase | 差；免费项目长期无请求会被暂停 | — | 免费 | 低 | 低频激活服务最怕这个 |

### 8.2 推荐

**首选 Cloudflare Workers + D1 + 一个自有子域名**（如 `lic.bz-reader.dev`）。

- 免费额度：Workers 10 万请求/天，D1 500 万行读/天、10 万行写/天。1000 个用户一年也就 1000 次请求。
- 不需要备案：域名解析到 Cloudflare，服务器不在大陆。
- 代码量：一个 worker 约 100 行 + 两张表。
- 唯一风险是国内链路。缓解：只发一次请求、失败给明确重试（不消耗次数）、激活后完全离线。

**如果国内访问实测不可接受**，再迁 CloudBase（要备案域名）或香港轻量。因为接口只有一个，迁移成本约半天——先把 API 契约定死，服务商是可替换的。

### 8.3 域名与 HTTPS

- 注册任意 `.dev` / `.com`（¥50–80/年），只用来做 API，不需要建站。
- Cloudflare 免费套餐自带证书与 CDN。
- 不要用 `workers.dev` 裸域名——国内大概率连不上。

## 9. 零服务器退路（先不建服务时）

| | 通用码 | 付费码 |
|---|---|---|
| 做法 | 签名码 + `redeemBy`，客户端本地算 `now + 7d` | 一人一码，下单时脚本签，`maxAct` 只写进码里当软限制 |
| 撤回 | **做不到**，只能等到期 | 做不到 |
| 次数 | 不限 | 不计数，只靠「一人一码」防扩散 |
| 成本 | 0 | 0 |
| 适用 | 前 100 人 | 前 50 单 |

这条路唯一丢的是「撤回」和「计数」。如果第一批只是想验证有没有人用，可以先走它；等你要撤回一个已经传开的码，或者有人拿一枚付费码装 10 台，再上服务。

## 10. 待拍板

- [ ] 通用码撤回后，已激活的 7 天是否允许走完？（建议允许，否则要心跳）
- [ ] 付费码 `maxAct` 定几次？（建议 5）
- [ ] 付费码重装吃次数，接受吗？（建议接受，给宽一点 + 手动加次数）
- [ ] 先上 Cloudflare，还是先零服务器卖前 50 单？

## 11. 实现状态（2026-11-03）

已落地：

| 模块 | 文件 |
|---|---|
| 核销核心（唯一一份规则） | `server/core.mjs` |
| 密码学（WebCrypto，Workers/Node 同一条路径） | `server/crypto.mjs` |
| 本地存储 / D1 存储 | `server/store-json.mjs` / `server/store-d1.mjs` |
| 本地服务 / Worker | `server/dev-server.mjs` / `server/worker.mjs` |
| 建表 / 部署配置 | `server/schema.sql` / `server/wrangler.toml` |
| 签发 | `scripts/issue-license.mjs`（`--kind` / `--max-act` / `--redeem-by` / `--legacy`） |
| 令牌密钥 | `scripts/gen-token-keys.mjs` |
| 本地运维 | `scripts/license-admin.mjs`（`--list` / `--revoke` / `--set-max` / `--stats`） |
| 客户端 | `src/data/license.ts`（BZR3 + 令牌验签）、`redeem.ts`、`activate.ts`、`entitlement.ts` |
| 接线 | `shell/actions.ts`、`shell/render/settings.ts`、`ui/settings-tab.ts`、`plugin.ts` |

本地实测：通用码核销 → 7 天令牌；同一 installId 重放 `used` 不变；付费码 `maxAct=2` 第 3 台 409；
撤回后新激活 410、已发令牌仍可验；客户端 `verifyToken` 通过，改一个字节即失败。

还没做：部署到 Cloudflare（需要账号 + 域名）、把 `DEFAULT_ENDPOINT` 换成真实域名、README 英文段。
