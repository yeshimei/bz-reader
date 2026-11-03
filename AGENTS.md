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

## 4. 改动走 worktree

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

## 5. 测试规范

- 放 `tests/`，一模块一文件。
- 优先测纯函数；逻辑抽不出来就先抽（参考 `shell/anchored-style.ts`）。
- 需要 `document` 的用 `tests/helpers/dom-stub.ts` 的 `installDomStub()`，`afterAll` 卸掉。
- 没装 jsdom：不测真实布局、`getBoundingClientRect`、触摸事件。
- 断言行为，不断言实现细节（状态翻转 + 重渲被调用，而不是某个 class 字符串）。

## 6. 真机问题排查

插件往库根目录写 `bz-reader-debug.md`（`boot / viewport / tap / turn / relocate / sel` 等）。复现一次，读日志按时间戳还原「点了哪儿 → 判成哪区 → 翻到哪页」，不要猜。

两类已知坑（都源于 iframe 分页时被整体平移）：

1. `clientX/clientY` 带平移量，不能当屏幕坐标用 → 用 `screenX/screenY`；
2. 选区 rect 同理 → `sel` 日志记了 `gl/gt/gs/rl/rt/al/at`，对不上时按这几项定位。

## 7. 移动端交互约定

- 点正文：下方 = 下一页，上方 = 上一页（纵向分区，不看左右）。
- 两指同时轻按：切换沉浸。
- 划词：不自动划线，保留系统选区与手柄；工具条贴选区下方（桌面在选区上方）。
- 文字类弹窗（想法 / 书摘 / 划线）：移动端贴底小卡，桌面贴选区上方。

## 8. 不要做的事

- 不提交 `.scratch*` 临时脚本、`dist/`、库里的调试日志。
- 不为修一个 bug 顺手重构无关模块。
- 不在没跑门禁的情况下 commit。
- 不动别的 worktree 正在改的文件。
