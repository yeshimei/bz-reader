# AGENTS.md 精简总结（含文件与路径）

## 核心原则
1. **只有一个完整功能包**：功能是否可用由激活码在运行期决定（`can()` → `entitlement().unlocked`），没有 base / pro 两个入口；不要写 `dist/base`（历史产物）。
2. **改代码前先讲人话**：先勘察相关代码细节，不要直接修改代码；然后按顺序列五个清单，每个清单和清单内每项都要编号，用通俗简洁的话说明，不附代码细节/技术细节：
   1. 针对需求，说明如何理解、准备怎么做；
   2. 指出我可能疏忽、会导致问题的地方，并附建议；
   3. 就以上问题列出可优化、增强的方向；
   4. 列出你不确认、需要我回答的问题；**每个问题末尾都要附上你推荐的选择**（写成「建议：…」），这样我可以只说「都按你的来」，不必逐条回答；
   5. 做完就直接合并到主分支，部署到测试库。
   等我确认后再改动代码。
3. **再走 TDD**：先写 `tests/<模块>.test.ts` 让它红，再改实现让它绿；修 bug 先写复现断言并永久保留，测试与实现同一提交；纯样式（CSS）例外，提交信息写「无逻辑变更，走真机冒烟」并说明冒烟了什么。
4. **多语言只在准备上架那一版时补齐**：日常开发、修 bug、feature 分支**不**给外语配翻译。新增文案只把 `zh`（基准包）和 `en` 写实，其余六包放占位顶住门禁——`ja`/`de`/`fr`/`es`/`pt` 直接放英文原值，`zh-TW` 必须放繁体写法（`tests/i18n-packs.test.ts` 会查简体字）。正式翻译、术语统一、润色统一放到发版前一次做完，见「上架」的上架顺序第 2 步。
   - 更新日志永远只有中英两版（`changelogLang()`），任何版本都不补其余六种。

## 提交前必过三道门
在仓库 `D:\Obsidian\bz-reader` 跑：
```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node esbuild.config.mjs once
```
三条全绿才能 commit；只跑 tsc 不算过门。上架前再加 `node scripts/lint-obsidian.mjs`（见「上架」一节）。

## 部署
- 日常开发**只把产物部署到测试库**；真实库（`叫我包仔`）只在发版时跟一份，平时不碰。
- “部署”按目标算：日常部署 = 测试库一处；发版部署 = 三处（仓库根 + 测试库 + 真实库），缺一不算。
- 先过三道门，在 `D:\Obsidian\bz-reader` 跑日常构建（`BZ_READER_VAULT` 显式设 `test`，只落测试库）：
```powershell
$env:BZ_READER_VAULT='test'
node esbuild.config.mjs once
```
- 发版才用 `production`，并显式 `all`，一次落三处：
```powershell
$env:BZ_READER_VAULT='all'
node esbuild.config.mjs production
```
- `production` 压缩、无 sourcemap，**只有它**落仓库根；`once` 只写 `dist/pro` 和测试库，不是发版部署。
- `BZ_READER_VAULT` 指**插件目录**，不是库根；`all` = 测试库 + 真实库，也可填 `test` / `main`（缺省 `test`），或用 `;` 分隔多个完整路径。
- 只部署已合并到 master 的产物；worktree 内构建把 `BZ_READER_VAULT` 指向不存在的目录，只验产物。
- 验收：日常只查测试库 `main.js` 时间戳是本次构建、重载生效；发版再查仓库根与两个库 `main.js` 字节数一致。
- 部署 ≠ 发版；tag / Release 走 `bz-release`。

## 改动流程
- 功能、修复在仓库外 worktree 做：
```powershell
git worktree add -b fix/<主题> D:\Obsidian\bz-reader-wt-<主题> master
New-Item -ItemType Junction -Path D:\Obsidian\bz-reader-wt-<主题>\node_modules -Target D:\Obsidian\bz-reader\node_modules
```
- 目录与分支主题一致：`bz-reader-wt-<主题>` 对 `feat/…` / `fix/…`；建完先跑 tsc + vitest 对基线。
- 合并用 `git merge --ff-only`；master 前进过先 `rebase master` 并重跑三道门；合并前工作区干净。
- 收尾：`rmdir` 摘 junction → `git worktree remove` → `git branch -d`，不要 `Remove-Item -Recurse`。
- 纯文档（`README.md` / `AGENTS.md`）可直接在主仓提交；不同时改别的 worktree 正在改的文件。

## 测试
- 放 `tests/`，一模块一文件；优先测纯函数，逻辑抽不出来先抽（参考 `shell/anchored-style.ts`）。
- 需要 `document` 的用 `tests/helpers/dom-stub.ts` 的 `installDomStub()`，`afterAll` 卸掉。
- 没装 jsdom：不测真实布局、`getBoundingClientRect`、触摸事件。
- 断言行为，不断言实现细节（状态翻转 + 重渲被调用，而不是某个 class 字符串）。

## 真机排查
- 插件不往库里写日志，插件目录保持只读（只有 Obsidian 自己的 `main.js` / `manifest.json` / `styles.css` / `data.json`）。
- 排查三条：
  - 控制台：桌面端 `Ctrl+Shift+I`；移动端 `chrome://inspect`。
  - 阅读视图角标：`localStorage['bz-reader:debug-probe']='1'` 后重开书。
  - 调试入口：往 `<数据目录>/debug-open.json` 写 `{"command":"open"|"continue"|"book","bookId":"…"}`，下次启动执行一次后自删。
- 已知坑：iframe 分页被整体平移导致坐标偏差；点击用 `screenX/screenY`，不要用带平移量的 `clientX/clientY`；选区 rect 先过 `frameGeom()` 换回宿主坐标，别直接拿 `getClientRects()`。

## 移动端交互
- 点正文：下方 = 下一页，上方 = 上一页（纵向分区，不看左右）。
- 两指同时轻按：切换沉浸。
- 划词：不自动划线，保留系统选区与手柄；工具条贴选区下方（桌面在选区上方）。
- 文字类弹窗（想法 / 书摘 / 划线）：移动端贴底小卡，桌面贴选区上方。

## 发激活码
- 私钥和已发码都在 `scripts/keys/`（整目录 gitignore）。**永远不要**提交、贴进 `docs/`、`README` 或 issue。
- 台账 `scripts/keys/issued/ledger.json`，`nextSeq` 是下一个可用序号；码文件 `scripts/keys/issued/afdian-batch-XX.txt`，一行一枚；号段表 `docs/license-ledger.md`。
- 签新一批：
  1. 读 `ledger.json` 拿 `nextSeq`；没台账说明第一批，从 0001 起。
  2. 从 `nextSeq` 开始**连续**签发，id 用 `BZR-AF-<年>-<四位序号>`：
```powershell
node scripts/issue-license.mjs --plan lifetime --id BZR-AF-2026-0021
```
  3. 自查：id 不重复、码全文不重复、序号连续无空号。
  4. 新批次追加进 `batches`，`nextSeq` 推到下一个未用号。
  5. 码写进新的 `scripts/keys/issued/afdian-batch-XX.txt`，同时更新 `docs/license-ledger.md` 号段表。
- **不许**从 0001 重来，**不许**复用已发、删掉或 revoked 的号；号段只增不减。不要往 git 跟踪的文件里放码；`docs/afdian-store.md` 只留两行示例。

## 上架
上架分两段：**先发 Release，再送审**。不走 `obsidian-releases` 的 PR，社区目录在 `community.obsidian.md` 网页提交。

顺序由平台定，不是我们挑的：审评系统拿 `manifest.version` 去 GitHub 找同名 Release，**找不到就直接报「没有发布能匹配你的清单版本」**，连扫描都不会开始。2026-11-11 的 1.1.0 撞过这一条——manifest 已经是 1.1.0，Release 还停在 1.0.0，页面上只有那一句错误，看不出别的毛病。

所以现在的硬顺序是：**推 master → 打 tag → 发 Release（挂三件套）→ 再去送审**。
代价要认：审评期间用户已经能从 Release 装到这一版；审评不过就改代码、涨个补丁号（1.1.0 → 1.1.1）重发一版，不要挪已经发出去的 tag。
码云镜像仍放在最后——审评通过之后再镜像，别让国内通道先于正本上线。

每次上架前必须跑官方 lint：
```powershell
node scripts/lint-obsidian.mjs
```
- 必须 **0 error / 0 warning**；退出码非 0 就停。
- 依赖装在仓库外 `%LOCALAPPDATA%\bz-reader-lint`，首次自动安装，不碰项目 `node_modules`。
- 脚本自己生成、跑完删掉 `eslint.config.mjs`；不要把配置文件提交进仓库。
- 唯一豁免 `@typescript-eslint/no-deprecated`：`caretRangeFromPoint` 与 `Workspace.activeLeaf` 在 minAppVersion 1.7.2 下没有等价替代。

### 第一段：准备并发 Release
1. `node scripts/lint-obsidian.mjs` → 0/0（TypeScript 与 CSS 两道都在这条命令里）；
2. **补齐本版多语言**：把本次改动新增/改动的文案在 `src/i18n/` 里七种外语全部换成正式翻译（替换开发期留的英文/繁体占位）。自查四条——key 集合与 `zh.ts` 一致、无空串、`{占位符}`与中文逐条相同、拉丁语系包无汉字且 `zh-TW` 无简体字（跑 `vitest run tests/i18n-packs.test.ts` 就是这套）；
3. 三道门（tsc / vitest / esbuild）；
4. `manifest.json` 的 `version`、`versions.json` 同步（README 徽章由 shields 实时取 GitHub，不用再手动刷图）；
5. 提交并推送 master；
6. `node esbuild.config.mjs production`（落仓库根三件套：`main.js` / `manifest.json` / `styles.css`）。这一步必须在打 tag 之前，仓库根的三件套常常还是上一版；
7. 打 tag 并推送——**tag 与 `manifest.version` 逐字相同，不带 `v`**；
8. `gh release create <版本> --title <版本> --notes-file docs/note-v<版本>.md main.js manifest.json styles.css`（`--title` 必须与版本逐字相同：社区目录会检查 Release name 是否匹配 `manifest.version`），随后 `gh release view <版本>` 确认已转正、不再是 draft；
9. 发版部署：`BZ_READER_VAULT=all node esbuild.config.mjs production` 落三处（仓库根 + 测试库 + 真实库），核对三处 `main.js` 字节数一致。

### 第二段：送审与镜像
10. 在 `community.obsidian.md` 提交，等官方审评（预览检查）。
    - **不通过**：照报错在 master 上改。只是配置或资产没对上（Release 缺资产、名字不匹配、CSS 告警）→ 修好补发同一个版本再提交；**动过代码** → 涨补丁号（1.1.0 → 1.1.1），从第 6 步重来，**不要挪已经发出去的 tag**。
    - **通过**：进第 11 步。
11. `node scripts/push-gitee.mjs`：镜像到码云（Release 页 + 三件套资产）。

目录审核要点：仓库根有 `README.md` / `LICENSE` / `manifest.json`；`manifest.json` 的 `description` **不能出现 “Obsidian”**（目录规则：上下文已蕴含，重复即 Error，会让预览直接 Failed）；Release 附三件套；`README` 披露「完整功能需付费」与网络访问。

## 不要做
- 不提交 `.scratch*` 临时脚本、`dist/`、库里的调试日志。
- 不为修一个 bug 顺手重构无关模块。