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

两版同一个 id，覆盖安装；`data.json` 与 `storage/` 不在三件套内，书库与进度不丢。

## 基础版做了什么

| 能力 | 状态 |
|---|---|
| 打开 EPUB / TXT | ✅ 书架扫 vault 自动出现，也可「导入」写进 `Books/` |
| 书架 | ✅ 网格 / 列表切换、全部/在读/未读/读完筛选、书名搜索、继续阅读条 |
| 目录 | ✅ 左侧抽屉，支持多级，当前章节高亮 |
| 翻页 | ✅ 点左右三区、上下页按钮、方向键 / PageUp / PageDown / 空格、移动端滑动（foliate 手势） |
| 排版 | ✅ 字号 / 行距 / 页边距 / 字体 / 对齐，面板改完立即生效 |
| 主题 | ✅ 跟随 Obsidian / 纸白 / 米黄 / 护眼 / 暗夜 |
| 阅读位置 | ✅ CFI 优先，解析不出来退回百分比 |
| 进度 | ✅ 百分比 + 剩余时间 + 章节名；读完自动打点 |
| 搜索 | ✅ 本章内搜索（全书搜索是高级版） |
| 会话计时 | ✅ 只记「人在看」的时间，闲置 60s 断档，写入 `reading.sessions[]` |

**还没做（按顺序）**：封面抽取、书签、划线批注、全屏/双栏、移动端键盘避让、`bz-reader.json` 与 bz 书库的对接。

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
├─ engine/          引擎层，零 UI
│  ├─ foliate.ts    全仓唯一 import vendor 的地方（类型在此收口）
│  ├─ host.ts       装载 · 渲染 · 翻页 · 销毁
│  ├─ theme.ts      章节样式（iframe 文档内注入，全仓唯一 style 注入点）
│  └─ activity.ts   有效阅读计时
├─ data/            schema · 原子写存储 · 书库仓储
├─ ui/              书架 / 阅读弹窗
├─ types/           foliate 接口类型 · 全局声明
└─ vendor/foliate/  上游内核（勿在业务代码里直接引用）
```

## 硬约束

- **样式源只有 `src/styles.css`**（`core/ui/tokens.css` 在构建时拼在它前面）。运行时注入 `<style>` 只有一处允许：`engine/theme.ts` 往书页 iframe 文档里注入章节样式。
- **业务代码不许直接 import `src/vendor/foliate/*`**，一律走 `engine/foliate.ts`。vendor 是 JS，类型在上面那道门面收口。
- **关书结算顺序**：结算会话 → 落最后位置 → flush → destroy 引擎。反了会丢最后一页进度。
- 新增弹窗先看 `styles.css` 里 `.bzr-*-popup` 的写法，别裸用 `uiModal`（默认 400px 窄卡 + 82vh 限高）。
