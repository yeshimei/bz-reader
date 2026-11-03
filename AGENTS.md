# AGENTS.md — bz 阅读（Obsidian 插件）

给在这个仓库里干活的 agent 看的工作约定。**先读这一页，再动手。**

---

## 1. 只有一个包：完整功能版

**没有 base / pro 两条线了。** 代码全部打进一个包，功能是否可用由**激活码**
在运行期决定（`can()` → `entitlement().unlocked`）。

```powershell
node esbuild.config.mjs once                      # 出包到 dist/pro 并同步到测试库
$env:BZ_READER_VAULT='E:/Obsidian/叫我包仔/.obsidian/plugins/bz-reader'
node esbuild.config.mjs once                      # 同步到主库
```

**踩过的坑**：以前有两个入口，用户装到 base 包时 `proBuild=false`，
`can()` 第一行就返回 false——授权有效但高级功能全不可用。现在不存在这个可能。

`dist/base` 是历史产物，不要再往里写东西。

---

## 2. 铁律：测试驱动（TDD）

**任何一次代码修改都必须先有/同时有测试。没有测试的提交不许进主干。**

顺序固定，不许颠倒：

1. 先写（或改）`tests/<模块>.test.ts`，让它**红**；
2. 再改实现，让它**绿**；
3. 最后跑三道门（下面第 3 节），全绿才 commit。

具体要求：

- 修 bug：先写一条**能复现该 bug 的断言**，再修。修完这条测试永久留在仓库里。
- 加功能：先写行为断言（输入 → 期望输出/状态），再写实现。
- 纯逻辑抽不出来就先抽：`src/shell/anchored-style.ts` 就是从 overlay.ts 里
  拆出来才测得动的（overlay.ts 拖进 foliate 的 DOM 依赖，node 里 import 就炸）。
- 测试文件与实现文件**同一提交**进入 git；提交信息里写清测试覆盖了什么。
- 允许例外只有一种：纯样式（CSS）改动。此时必须在提交信息里写明
  「无逻辑变更，走真机冒烟」并说明冒烟了什么。

违反这条的提交，一律回滚重做。

---

## 3. 提交前必须跑的三道门（缺一不可）

```powershell
node node_modules/typescript/bin/tsc --noEmit   # 1. 类型
node node_modules/vitest/vitest.mjs run         # 2. 全量测试
node esbuild.config.mjs once                    # 3. 构建（现在只有一个包）
```

三条全绿才 `git commit`。**只跑 tsc 不算过门**——历史上「设置页开关点了不刷新」
就是这样漏出去的。

---

## 4. 测试规范

- 测试放 `tests/`，命名 `tests/<模块名>.test.ts`，一模块一文件。
- **新增/修改一个模块，同一次提交里必须带它的测试。**
- 优先测**纯函数**：把逻辑从 DOM/事件里抽出来再测，不要为了测试去造 DOM。
- 需要 `document` 的（如 `engine/theme.ts` 的 `buildChapterCSS`）用
  `tests/helpers/dom-stub.ts` 的 `installDomStub()`，用完 `afterAll` 卸掉。
- 项目没装 jsdom（离线环境装不了），**不要**在测试里 依赖 真实布局、
  `getBoundingClientRect` 或触摸事件——这类走真机冒烟。
- 断言「行为」而不是「实现」：例如切开关后要断言**状态翻转 + 重渲被调用**，
  不是断言某个 div 的 class 字符串。

已经覆盖的模块：

| 模块 | 测试 |
|---|---|
| `data/prefs.ts` | `tests/prefs.test.ts` |
| `data/schema.ts` / `engine/theme.ts` | `tests/theme-schema.test.ts` |
| `data/license.ts` | `tests/license.test.ts` |
| `data/notes.ts`、导出 | `tests/notes.test.ts`、`tests/export.test.ts` |

**还没覆盖**（改到哪个就补哪个）：`shell/*`（settings/actions/overlay/state）、
`ui/*`、`engine/host.ts`、`view/reader-view.ts`。

---

## 5. 真机问题的排查方式

不要靠用户截图猜。插件会往**库根目录**写 `bz-reader-debug.md`：

```
boot / viewport / tap / turn / tap.blockSnap / paginator.* / relocate / nav.timeout / sel
```

复现一次，把文件拿回来读，按时间戳还原「点了哪儿 → 判成哪区 → 翻到哪页」。

**已知的两类坑**（都源于 iframe 在分页时被整体平移）：

1. `clientX/clientY` 带着平移量，不能当屏幕坐标用 → 用 `screenX/screenY`；
2. 选区 rect 同理 → `sel` 日志里记了 `gl/gt/gs/rl/rt/al/at`，对不上时按这几项定位。

---

## 6. 交互约定（移动端）

- 点正文：**下方 = 下一页，上方 = 上一页**（纵向分区，不看左右）。
- 两指同时轻按：切换沉浸（藏宿主上下两条栏）。
- 划词：选中后**不自动划线**，保留系统选区与手柄；工具条贴选区下方（桌面在上方）。
- 文字类弹窗（想法/书摘/划线）最终形态：移动端贴底小卡，桌面端贴选区上方。

---

## 7. 不要做的事

- 不要提交 `.scratch*` 临时脚本、`dist/`、库里的调试日志。
- 不要为了修一个 bug 顺手重构无关模块。
- 不要在没跑门禁的情况下 commit。
- 不要动别的 worktree（`bz-reader-offline` 等）正在改的文件。
