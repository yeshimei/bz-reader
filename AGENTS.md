# AGENTS.md — bz 阅读（Obsidian 插件）

给在这个仓库干活的 agent：先读这一页，再动手。

## 1. 只有一个包

- 只有完整功能版；功能是否可用由激活码在运行期决定（`can()` → `entitlement().unlocked`），没有 base / pro 两个入口。
- 构建：`node esbuild.config.mjs once`；设 `$env:BZ_READER_VAULT` 可同步到指定库。
- `dist/base` 是历史产物，不要再往里写。

## 2. 铁律：TDD

- 任何代码改动都必须先有/同时有测试：先写 `tests/<模块>.test.ts` 让它**红**，再改实现让它**绿**。
- 修 bug 先写能复现的断言，修完永久保留；测试与实现同一提交。
- 唯一例外是纯样式（CSS）改动：提交信息写「无逻辑变更，走真机冒烟」并说明冒烟了什么。

## 3. 提交前跑三道门（缺一不可）

```powershell
node node_modules/typescript/bin/tsc --noEmit   # 类型
node node_modules/vitest/vitest.mjs run         # 全量测试
node esbuild.config.mjs once                    # 构建
```

三条全绿才能 commit。只跑 tsc 不算过门。

**上架（打 tag 发 Release）前再加一道：`node scripts/lint-obsidian.mjs`**，见第 10 节。

## 4. 部署

「部署」= 把**同一份**构建产物同时落到**主仓库**和**测试库**，缺一不算部署。先过三道门（第 3 节），然后在 `D:\Obsidian\bz-reader` 跑：

```powershell
$env:BZ_READER_VAULT='E:\Obsidian\测试\.obsidian\plugins\bz-reader'
node esbuild.config.mjs production
```

一条命令同时完成两处：

- **主仓库**：`main.js` / `manifest.json` / `styles.css` 复制到仓库根——发布与社区审核都按根目录核对；代码本身仍按第 5 节的 worktree 流程合并，部署前 master 必须是干净的。
- **测试库**：同一份产物同步到 `BZ_READER_VAULT` 指向的插件目录。

几个要点：

- `production` 是压缩、无 sourcemap，并且**只有它**会落仓库根；`once` 不压缩、带 inline sourcemap，只写 `dist/pro` 和 vault，**不落仓库根**——所以 `once` 不是部署。
- `BZ_READER_VAULT` 必须指到**插件目录**，不是库根：指到库根会把三件套写进 vault 根目录（2026-11-05 踩过，已清理）。
- 只部署**已合并到 master** 的产物；worktree 内构建把 `BZ_READER_VAULT` 指向不存在的目录，只验产物，不污染正在用的库。
- 验收：仓库根与测试库的 `main.js` 字节数一致、时间戳都是本次构建；测试库重载 Obsidian 后生效。
- 部署 ≠ 发版：tag / Release 走 `bz-release`，那是另一条流程。

## 5. 改动走 worktree

主仓随时可构建、可发布；功能、修复在仓库外的 worktree 里做。

```powershell
git worktree add -b fix/<主题> D:\Obsidian\bz-reader-wt-<主题> master
# node_modules 用目录联接指回主仓，只读使用：
New-Item -ItemType Junction -Path D:\Obsidian\bz-reader-wt-<主题>\node_modules -Target D:\Obsidian\bz-reader\node_modules
```

- 目录与分支主题一致：`bz-reader-wt-<主题>` 对 `feat/…` 或 `fix/…`。
- 建完先跑 tsc + vitest 对基线。
- worktree 内构建把 `BZ_READER_VAULT` 指向不存在的目录，只验产物，不污染正在用的库；比产物只比行为，不比字节。
- 合并用 `git merge --ff-only`；master 前进过就先 `rebase master` 并重跑三道门；合并前工作区必须干净。
- 收尾顺序：`rmdir` 摘掉 junction → `git worktree remove` → `git branch -d`。不要 `Remove-Item -Recurse`。
- 纯文档（`README.md` / `AGENTS.md`）可直接在主仓提交。
- 不要和别的 worktree 同时改同一批文件。

## 6. 测试规范

- 放 `tests/`，一模块一文件。
- 优先测纯函数；逻辑抽不出来就先抽（参考 `shell/anchored-style.ts`）。
- 需要 `document` 的用 `tests/helpers/dom-stub.ts` 的 `installDomStub()`，`afterAll` 卸掉。
- 没装 jsdom：不测真实布局、`getBoundingClientRect`、触摸事件。
- 断言行为，不断言实现细节（状态翻转 + 重渲被调用，而不是某个 class 字符串）。

## 7. 真机问题排查

**插件不往库里写日志**（`bz-reader-debug.md` 已移除），**插件目录也保持只读**——里面
只有 Obsidian 自己的 `main.js` / `manifest.json` / `styles.css` / `data.json`，插件不往
那里放任何自有文件。排查走这三条：

- 控制台：桌面端 `Ctrl+Shift+I`；移动端用 `chrome://inspect` 连。
- 阅读视图角标：`localStorage['bz-reader:debug-probe']='1'` 后重开书，屏幕上直接显示
  点击次数、上下分区、翻页前后的位置指纹。
- 调试入口：往 `<数据目录>/debug-open.json` 写
  `{"command":"open"|"continue"|"book","bookId":"…"}`，下次启动执行一次后自删。

两类已知坑（都源于 iframe 分页时被整体平移）：

1. `clientX/clientY` 带平移量，不能当屏幕坐标用 → 用 `screenX/screenY`；
2. 选区 rect 同理 → 先过 `frameGeom()` 换回宿主坐标，别直接拿 `getClientRects()` 的值。

## 8. 移动端交互约定

- 点正文：下方 = 下一页，上方 = 上一页（纵向分区，不看左右）。
- 两指同时轻按：切换沉浸。
- 划词：不自动划线，保留系统选区与手柄；工具条贴选区下方（桌面在选区上方）。
- 文字类弹窗（想法 / 书摘 / 划线）：移动端贴底小卡，桌面贴选区上方。

## 9. 发激活码（发行台账）

私钥和已发出去的码都在 `scripts/keys/`（整目录 gitignore）。**永远不要**提交、贴进 `docs/`、README 或 issue —— 发出去的码就是钱。

- 台账：`scripts/keys/issued/ledger.json`，`nextSeq` 是下一个可用序号
- 码文件：`scripts/keys/issued/afdian-batch-XX.txt`，一行一枚
- 人读的号段表：`docs/license-ledger.md`

**签新一批按顺序来，一步都不能跳：**

1. 读 `ledger.json` 拿 `nextSeq`；没有台账说明这是第一批，从 0001 起
2. 从 `nextSeq` 开始**连续**签发，id 用 `BZR-AF-<年>-<四位序号>`：
   `node scripts/issue-license.mjs --plan lifetime --id BZR-AF-2026-0021`
3. 签完自查三件事：id 不重复、码全文不重复、序号连续没有空号
4. 新批次追加进 `batches`，`nextSeq` 推到下一个未用号
5. 码写进新的 `afdian-batch-XX.txt`，**同时更新 `docs/license-ledger.md` 的号段表**

**不许**从 0001 重来，**不许**复用已经发过、删掉或标 revoked 的号——号段只增不减。

也不要往任何会被 git 跟踪的文件里放码；`docs/afdian-store.md` 只留两行示例就是为这个。

## 10. 上架（Obsidian 社区目录）

上架 = 打 tag 发 Release + 在 [community.obsidian.md](https://community.obsidian.md) 提交。
**不再走 `obsidian-releases` 的 PR**——那个仓库已禁用 PR，社区目录改成了网页提交
（要 Obsidian 账号登录并关联 GitHub 验证仓库归属）。

**每次上架前必须跑官方 lint，缺一不可：**

```powershell
node scripts/lint-obsidian.mjs        # eslint-plugin-obsidianmd recommended
```

- 必须 **0 error / 0 warning**。规则与社区目录的自动审核同源：error 直接卡审，
  warning 是审核意见的高频来源。脚本退出码非 0 就停下，不许带着问题打包。
- 依赖装在仓库外（`%LOCALAPPDATA%\bz-reader-lint`，首次自动安装），**不碰项目
  `node_modules`**：主仓那份是历史 pnpm 链接，`pnpm add` 会报 UNEXPECTED_VIRTUAL_STORE。
- 脚本自己生成、跑完删掉 `eslint.config.mjs`；**不要把配置文件提交进仓库**。
- 唯一豁免是 `@typescript-eslint/no-deprecated`（脚本生成的配置里已关掉并写了
  理由）：`caretRangeFromPoint` 与 `Workspace.activeLeaf` 在 minAppVersion 1.7.2
  下没有等价替代。

上架顺序（lint 在最前）：

1. `node scripts/lint-obsidian.mjs` → 0/0
2. 三道门（第 3 节：tsc / vitest / esbuild once）
3. `manifest.json` 的 `version`、`versions.json`、README badge 三处同步
4. `node esbuild.config.mjs production`（落仓库根三件套）
5. 提交、推送、打 tag——**tag 与 `manifest.version` 逐字相同，不带 `v`**
6. `gh release create <版本> --notes-file docs/note-v<版本>.md main.js manifest.json styles.css`
7. community.obsidian.md 提交

目录审核要点：仓库根有 `README.md` / `LICENSE` / `manifest.json`；Release 附三件套；
README 必须披露「完整功能需付费」与网络访问（两节都已在 README 里）。

## 11. 不要做的事

- 不提交 `.scratch*` 临时脚本、`dist/`、库里的调试日志。
- 不为修一个 bug 顺手重构无关模块。
- 不在没跑门禁的情况下 commit。
- 不动别的 worktree 正在改的文件。
