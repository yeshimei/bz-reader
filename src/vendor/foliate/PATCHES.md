# vendor/foliate —— 上游原版 + 我们的改动

来源：`foliate-js@1.0.1`（npm registry 原包，作者 John Factotum，MIT）。
`LICENSE` 随文件保留，**不要删**。

## 本地改动（只有这 5 处）

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `view.js` | `customElements.define('foliate-view', …)` 外层加 `if (!customElements.get(...))` | Obsidian 停用插件再启用会重新执行 main.js，而自定义元素注册表挂在页面上不会清空；原版第二次执行直接抛 `NotSupportedError`，表现是「重新启用插件后打不开书」 |
| `paginator.js` | 同上（`foliate-paginator`） | 同上 |
| `fixed-layout.js` | 同上（`foliate-fxl`） | 同上 |
| `quote-image.js` | 同上（`foliate-quoteimage`） | 同上 |
| `paginator.js` | `--_max-column-count: 2` 改为 `var(--_column-count, 2)` | 栏数要做成用户偏好（单栏/双栏）。#top 的 shadow 规则直接声明了 2，宿主元素上设同名变量进不去（继承只在无直接声明时生效）；换成 var() 引用宿主变量，缺省仍是 2，不设变量时行为与上游逐字一致 |

前四处都是「已注册就跳过」，不改任何行为语义；除此外与上游逐字一致，升级时可用新版本文件整体替换后再打这 5 个补丁。

## 依赖

`vendor/fflate.js`、`vendor/zip.js` 是上游自带的同级依赖（mobi 解压 / zip 读取），随包拷入，
`construct-style-sheets-polyfill` 走 npm（fixed-layout.js 引用）。

## 打包注意

`mobi.js` 用 BigInt 字面量，构建目标至少 `es2020`（`esbuild.config.mjs` 已设）。
