# AGENTS.md 精简总结（含文件与路径）

## 核心原则
1. **只有一个完整功能包**：功能是否可用由激活码在运行期决定（`can()` → `entitlement().unlocked`），没有 base / pro 两个入口；不要写 `dist/base`（历史产物）。
2. **「探索中」的功能一实现就转高级版，三件事同批做完**：对照表把那行从「探索中」搬进正式段并打勾、挂能力位、入口加 `requireCap` 拦截；README、`docs/afdian-store.md`、`docs/images/plan-compare.png` 同一批同步。只改表不加运行期拦截 = 基础版白送（2026-11-13 剪藏成书就漏了这道门，1.3.1 补），算严重事故。
3. **改代码前先讲人话**：先分清轻重，简单改动直接做，不用走下面的清单流程。「简单」只有两类：只动文档、注释、文案、错别字或排版格式；或用户已经把改法说死、照做即可且只碰一个文件、不改行为、没有取舍的小修（例如删掉一句话、改一个数字、换一个链接）。其余情况，先勘察相关代码细节，不要直接修改代码；然后按顺序列五个清单，每个清单和清单内每项都要编号，用通俗简洁的话说明，不附代码细节/技术细节：
   1. 针对需求，说明如何理解、准备怎么做；
   2. 指出我可能疏忽、会导致问题的地方，并附建议；
   3. 就以上问题列出可优化、增强的方向；
   4. 列出你不确认、需要我回答的问题；**每个问题末尾都要附上你推荐的选择**（写成「建议：…」），这样我可以只说「都按你的来」，不必逐条回答；
   5. 每次都在 worktree 里改代码，改完只部署到测试库；没有我的明确指令，不得合并到主分支。
   等我确认后再改动代码。
4. **再走 TDD**：先写 `tests/<模块>.test.ts` 让它红，再改实现让它绿；修 bug 先写复现断言并永久保留，测试与实现同一提交；纯样式（CSS）例外，提交信息写「无逻辑变更，走真机冒烟」并说明冒烟了什么。
5. **多语言只在准备上架那一版时补齐**：日常开发、修 bug、feature 分支**不**给外语配翻译。新增文案只把 `zh`（基准包）和 `en` 写实，其余六包放占位顶住门禁——`ja`/`de`/`fr`/`es`/`pt` 直接放英文原值，`zh-TW` 必须放繁体写法（`tests/i18n-packs.test.ts` 会查简体字）。正式翻译、术语统一、润色统一放到发版前一次做完，见「上架」的发版步骤第 2 步。
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
- 部署 ≠ 发版；tag / Release 走 `bz-reader-release`（bz 主仓才走 `bz-release`）。

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

## 支持者名单
- 名单**不在本仓库**：唯一源是 bz 主仓的 `docs/patrons.json`，运行期由 `src/data/patrons.ts` 从 GitHub / 码云两个地址并发读取，本机缓存 6 小时。
- 加人 / 改名 / 删除去 bz 仓库跑 `node scripts/patron-add.mjs --name … --amount …`（流程见 skill `bz-reward`）。**不要改代码、不要为名单发版**。
- 名单是公开只读数据，README「网络访问」已披露；改动读取逻辑时别绕过 `requestUrl`（码云 raw 没有跨域头）。

## 上架
分两段，**中间必须停住等作者说「预览审核通过」**。2026-11-13 起，社区目录的预览扫描、正式提交、催审核由作者本人手动做，agent 不跑。

**第一段（agent 做）**：lint 0/0 → 补齐多语言 → 三道门 → 版本号与 note·changelog 对账 → 提交并推送 master → **停**
**第二段（作者说通过之后）**：production 构建 → 打 tag → 发 Release（三件套）→ 确认转正 → 部署三处 → `push-gitee` 镜像码云（顺带 `push-quark` 更新网盘）→ 校验两通道下载到的 `manifest.json` 版本

- 推完 master 就交棒：**没听到「预览审核通过」不许打 tag、不许发 Release、不许部署真实库、不许镜像码云**。作者要跑扫描和提交，得先让仓库上有这版代码。
- 第二段一旦开始就必须走完（Release → 三处部署 → 镜像 → 校验），不要停在中间。

每次上架前必须跑官方 lint：
```powershell
node scripts/lint-obsidian.mjs
```
- 必须 **0 error / 0 warning**；退出码非 0 就停。
- 依赖装在仓库外 `%LOCALAPPDATA%\bz-reader-lint`，首次自动安装，不碰项目 `node_modules`。
- 脚本自己生成、跑完删掉 `eslint.config.mjs`；不要把配置文件提交进仓库。
- 唯一豁免 `@typescript-eslint/no-deprecated`：`caretRangeFromPoint` 与 `Workspace.activeLeaf` 在 minAppVersion 1.7.2 下没有等价替代。

### 第一段：做到推 master
1. `node scripts/lint-obsidian.mjs` → 0/0（TypeScript 与 CSS 两道都在这条命令里）；
2. **补齐本版多语言**：把本次改动新增/改动的文案在 `src/i18n/` 里七种外语全部换成正式翻译（替换开发期留的英文/繁体占位）。自查四条——key 集合与 `zh.ts` 一致、无空串、`{占位符}`与中文逐条相同、拉丁语系包无汉字且 `zh-TW` 无简体字（跑 `vitest run tests/i18n-packs.test.ts` 就是这套）；
3. 三道门（tsc / vitest / esbuild）；
4. `manifest.json` 的 `version`、`versions.json` 同步（README 徽章由 shields 实时取 GitHub，不用再手动刷图）；`docs/note-v<版本>.md` 与 `src/shell/changelog.ts` 的本版块逐条同口径（`tests/changelog-data.test.ts` 对账）；
5. 提交并推送 master；
6. **停**，把版本号与 GitHub 上的 sha 报给作者，等他说预览审核通过。

### 第二段：通过之后才发
7. `node esbuild.config.mjs production`（落仓库根三件套：`main.js` / `manifest.json` / `styles.css`）。这一步必须在打 tag 之前，仓库根的三件套常常还是上一版；
8. 打 tag 并推送——**tag 与 `manifest.version` 逐字相同，不带 `v`**；
9. `gh release create <版本> --title <版本> --notes-file docs/note-v<版本>.md main.js manifest.json styles.css`（`--title` 必须与版本逐字相同：社区目录会检查 Release name 是否匹配 `manifest.version`），随后 `gh release view <版本>` 确认已转正、不再是 draft；
10. 发版部署：`BZ_READER_VAULT=all node esbuild.config.mjs production` 落三处（仓库根 + 测试库 + 真实库），核对三处 `main.js` 字节数一致；
11. `node scripts/push-gitee.mjs`：镜像到码云（代码 + tag + Release 页 + 三件套），跑完顺带 `push-quark --product=reader` 更新网盘；
12. 校验两通道：
```powershell
curl.exe -sL https://github.com/yeshimei/bz-reader/releases/latest/download/manifest.json
curl.exe -sL https://gitee.com/ntbl/bz-reader/releases/download/<版本>/manifest.json
```
两边 `version` 都要等于 `manifest.version`。

镜像放在最后：等 Release 与三处部署都完成再推国内通道，别让码云先于正本上线。目录那边若报 Error 要改，涨补丁号重发，**不挪已经发出去的 tag**。

目录规则约束（人工上架前自查）：仓库根有 `README.md` / `LICENSE` / `manifest.json`；`manifest.json` 的 `description` **不能出现 “Obsidian”**（目录规则：上下文已蕴含，重复即 Error）；Release 附三件套；`README` 披露「完整功能需付费」与网络访问。

## 不要做
- 不提交 `.scratch*` 临时脚本、`dist/`、库里的调试日志。
- 不为修一个 bug 顺手重构无关模块。