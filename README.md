# bz-reader

Obsidian 插件：EPUB / TXT 阅读器，与 [bz](../bz) 生态联动。独立仓库，独立插件 id，**不依赖 bz 也能读书**。

- 插件 id：`bz-reader` · 显示名：`bz 阅读`
- 数据落位：`<插件目录>/storage/bz-reader.json`（ADR-0270 口径，不占 `CONFIG/STORAGE`）
- 渲染内核：`src/vendor/foliate/`，foliate-js 1.0.1 上游原版（MIT），本地改动见该目录 `PATCHES.md`

## 两版一仓

同一个仓库构建两个包，**物理隔离**：基础版 bundle 里没有高级代码。

| 包 | 入口 | 谁拿 | 内容 |
|---|---|---|---|
| base | `src/entry/base.ts` | 免费 | 打开 EPUB/TXT、书架、目录、翻页、排版、主题、进度 |
| pro | `src/entry/pro.ts` | 激活码 | 划线批注、书签、脚注、全书搜索、标注导出、统计、多格式、漫画/竖排/双栏、AI |

两版同一个 id，覆盖安装；`data.json` 与 `storage/` 不在三件套内，书架与进度不丢。

## 基础版做了什么

| 能力 | 状态 |
|---|---|
| 打开 EPUB / TXT | ✅ 书架扫 vault 自动出现；导入分「库内登记」与「库外写入」两条 |
| 阅读载体 | ✅ **Obsidian 原生页签**（ItemView），可与笔记并排、能被布局记住、能拖到侧栏 |
| 书架 | ✅ 弹窗形态（840×600）：五列书墙 / 列表切换、全部/在读/未读/读完筛选、书名搜索、继续阅读条；封面取 EPUB 内的 cover-image，落盘缓存，取不到才退回色块 |
| 导入 | ✅ 列出库内未上架的书批量勾选；库外文件走系统选择器写进 `Books/` |
| 目录 | ✅ 桌面是 Obsidian 原生左侧栏 leaf（开书自动展开、隐藏滚动条）；移动端占满全屏；当前章节高亮 |
| 翻页 | ✅ 点左右三区、上下页按钮、方向键 / PageUp / PageDown / 空格、滚轮、鼠标横拖、移动端滑动 |
| 缩放 | ✅ ⌘/Ctrl + 滚轮调字号、移动端双指捏合 |
| 排版 | ✅ 字号 / 行距 / 页边距 / 字体 / 对齐，桌面右下浮层、移动端底部 sheet，改完立即生效 |
| 主题 | ✅ 跟随 Obsidian / 纸白 / 米黄 / 护眼 / 暗夜；**栏框跟着正文一起换色** |
| 阅读位置 | ✅ CFI 优先，解析不出来退回百分比 |
| 进度 | ✅ 桌面：底栏百分比 + 剩余时间 + 底边 2px 进度线；移动端：底栏「进度」开整书跳转 sheet |
| 搜索 | ✅ 本章内搜索，命中词高亮（全书搜索是高级版） |
| 会话计时 | ✅ 只记「人在看」的时间，闲置 60s 断档，写入 `reading.sessions[]` |

**界面按 [`prototype/ui.html`](prototype/ui.html) 一比一落地**：桌面 5 屏（书架 / 阅读 / 三块面板 / 导入）+ 移动 3 屏（书架 / 阅读 / 面板 / 导入）。移动端是独立骨架，不是同一套缩窄：书架走「大标题 + 继续阅读卡 + 三列 + 悬浮胶囊」，阅读默认无工具栏、点中间浮出上下两条。

**还没做（按顺序）**：书签、划线批注、全屏/双栏、移动端键盘避让、`bz-reader.json` 与 bz 书架/读书报告的对接。

## 命令

```bash
pnpm install
node esbuild.config.mjs once      # 出 dist/base + dist/pro，并同步当前激活版到测试库
node esbuild.config.mjs          # watch
node node_modules/typescript/bin/tsc --noEmit
```

环境变量：

- `BZ_READER_VAULT` —— 产物同步落点，缺省 `E:/Obsidian/测试/.obsidian/plugins/bz-reader`（开发用测试库，别推主库）
- `BZ_READER_ACTIVE=pro` —— 让 `dist/pro` 参与同步（缺省 base）

## 目录

```
src/
├─ plugin.ts        插件主体（两版共用的那段逻辑）
├─ entry/           base.ts / pro.ts 两个构建入口
├─ core/            壳层：弹窗、通知、ESC、遮罩、层级、焦点、路径
│  └─ ui/           设计令牌 + 居中模态（前缀 bzr-，与 bz 的 bz- 不撞）
├─ view/            原生视图
│  └─ reader-view.ts  阅读页签（ItemView），一个书 id 一个页面
├─ engine/          引擎层，零 UI
│  ├─ foliate.ts    全仓唯一 import vendor 的地方（类型在此收口）
│  ├─ host.ts       装载 · 渲染 · 翻页 · 手势 · 销毁
│  ├─ theme.ts      章节样式（iframe 文档内注入，全仓唯一 style 注入点）
│  └─ activity.ts   有效阅读计时
├─ data/            schema · 原子写存储 · 书架仓储 · 偏好 · 导入 · 封面
├─ ui/              书架弹窗 / 导入面板 / 目录抽屉（移动端）/ 排版 / 搜索
├─ types/           foliate 接口类型 · 全局声明
└─ vendor/foliate/  上游内核（勿在业务代码里直接引用）
prototype/ui.html   界面原型（桌面 8 屏 + 移动 7 屏）
```

## 硬约束

- **样式源只有 `src/styles.css`**（`core/ui/tokens.css` 在构建时拼在它前面）。运行时注入 `<style>` 只有一处允许：`engine/theme.ts` 往书页 iframe 文档里注入章节样式。
- **视觉四条**（改样式前先读 `styles.css` 文件头）：表面只三层、强调色只做当前进度/当前章节/主按钮、圆角按层级递增、正文用衬线界面用无衬线。
- **阅读栏框必须跟正文同色**：`.bzr-reader` 上的 `--rear-bg` / `--rear-fg` 由 `applyChrome()` 按当前主题写入，别在具体控件里直接写死 `--bzr-surface-*`，否则白底书会顶一条黑栏。
- **业务代码不许直接 import `src/vendor/foliate/*`**，一律走 `engine/foliate.ts`。vendor 是 JS，类型在上面那道门面收口。
- **阅读 = 原生 ItemView，书架 = 弹窗**。别把阅读退回 Modal：弹窗会盖住笔记，也就丢掉了「一边读一边对照写」这个原生视图唯一的理由。
- **输入归引擎**：点击三区、滚轮、拖拽、捏合的判定都在 `engine/host.ts`，因为它才知道 iframe 的 document 什么时候被换掉。视图层只接收语义事件（`onTap` / `onTurn` / `onFontSize`）。
- **目录 = Obsidian 左侧栏里的 leaf（`bz-reader-toc`），不是阅读视图里的浮层**。桌面开书自动展开，移动端仍用整屏抽屉。目录与阅读视图之间只通过 `view/toc-state.ts` 的单向快照通信：阅读写、目录读，谁先 onOpen 都不会错。
- **关书结算顺序**：结算会话 → 落最后位置 → flush → destroy 引擎。反了会丢最后一页进度。
- **继承 Obsidian 基类时，绝不声明与基类同名的字段**。`View` 有 `app` / `icon` / `navigation` / `leaf` / `containerEl` / `scope`，`ItemView` 有 `contentEl` / `titleEl`。子类字段用定义语义写进实例，会把基类构造时赋好的值覆盖成 `null` —— 表现是点开书只报 `Cannot read properties of null (reading 'setText')`，因为 `ItemView.load()` 里第一句就是 `this.titleEl.setText(this.getDisplayText())`。阅读视图里那个书名元素叫 `bookTitleEl`，就是为了躲开它。
- 新增弹窗先看 `styles.css` 里 `.bzr-*-popup` 的写法，别裸用 `uiModal`（默认 400px 窄卡 + 82vh 限高）。
