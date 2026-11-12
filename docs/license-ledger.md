# 发行台账 · 激活码号段

> 这里只记**号段**，不放码。码在 `scripts/keys/issued/`（整目录 gitignore，不进仓库）。
> 台账机器版：`scripts/keys/issued/ledger.json`。

| 批次 | 号段 | 数量 | 日期 | 状态 | 码文件 |
|---|---|---:|---|---|---|
| 1 | `BZR-AF-2026-0001` – `BZR-AF-2026-0020` | 20 | 2026-11-04 | 已交付爱发电 | `afdian-batch-01.txt` |
| 2 | `BZR-AF-2026-0021` | 1 | 2026-11-04 | 已签发（自用/测试未交付） | `afdian-batch-02.txt` |
| 3 | `BZR-AF-2026-0022` | 1 | 2026-11-04 | 已签发（灰测，署名「灰测」） | `afdian-batch-03.txt` |
| 4 | `BZR-AF-2026-0023` | 1 | 2026-11-04 | 已签发（灰测 7 天，署名「灰测7天」） | `afdian-batch-04.txt` |
| 5 | `BZR-AF-2026-0024` | 1 | 2026-11-04 | 已签发（已过期测试码，署名「过期测试」） | `afdian-batch-05.txt` |
| 6 | `BZR-AF-2026-0025` – `BZR-AF-2026-0124` | 100 | 2026-11-09 | 已签发（待交付爱发电） | `afdian-batch-06.txt` |
| 7 | `BZR-AF-2026-0125` – `BZR-AF-2026-0174` | 50 | 2026-11-09 | 已签发（赞助人批次，待交付爱发电） | `afdian-batch-07.txt` |
| 8 | `BZR-AF-2026-0175` | 1 | 2026-11-10 | 已签发（赞助人定制码，署名「面包」） | `afdian-batch-08.txt` |
| 9 | `BZR-AF-2026-0176` | 1 | 2026-11-12 | 已签发（赞助人定制码，署名「Pomodorinettina」） | `afdian-batch-09.txt` |

**下一个可用序号：`0177`**

## 规矩

- 序号只增不减，**不复用**——发过、删掉、标 revoked 的号都不再分配。
- 新批次从台账 `nextSeq` 起连续签，签完自查：id 不重复、码不重复、序号不空号。
- 发现某枚码被公开传播：爱发电那边删掉对应行止血，台账里把这枚标 `revoked`，号**不回收**。
- 插件是离线验签，没有远程吊销。台账是"发过什么"的唯一事实来源，别只靠记忆。

## 签发命令

```powershell
# 普通批次码：不署名，插件徽章写「赞助人」
node scripts/issue-license.mjs --plan lifetime --patron --id BZR-AF-2026-0175

# 定制昵称码：加群报名字后逐枚签，插件徽章直接显示昵称
node scripts/issue-license.mjs --plan lifetime --patron --name 小明 --id BZR-AF-2026-0175
```

`--plan lifetime` + 不传 `--days/--until` = 永久（payload 无 `exp`）。
`--patron` 让插件在「关于」条画赞助人徽章；带 `--name` 时徽章文字换成昵称。
定制码占同一号段，签完同样要更新 `ledger.json` 与上表。
