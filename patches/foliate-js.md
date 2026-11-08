# vendor/foliate —— 上游原版 + 我们的改动

来源：`foliate-js@1.0.1`（npm registry 原包，作者 John Factotum，MIT）。
`LICENSE` 随文件保留，**不要删**。

## 本地改动（按文件逐条列）

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `view.js` | `customElements.define('foliate-view', …)` 外层加 `if (!customElements.get(...))` | Obsidian 停用插件再启用会重新执行 main.js，而自定义元素注册表挂在页面上不会清空；原版第二次执行直接抛 `NotSupportedError`，表现是「重新启用插件后打不开书」 |
| `paginator.js` | 同上（`foliate-paginator`） | 同上 |
| `fixed-layout.js` | 同上（`foliate-fxl`） | 同上 |
| `quote-image.js` | 同上（`foliate-quoteimage`） | 同上 |
| `paginator.js` | `--_max-column-count: 2` 改为 `var(--_column-count, 2)` | 栏数要做成用户偏好（单栏/双栏）。#top 的 shadow 规则直接声明了 2，宿主元素上设同名变量进不去（继承只在无直接声明时生效）；换成 var() 引用宿主变量，缺省仍是 2，不设变量时行为与上游逐字一致 |
| `overlayer.js` | `static highlight` 从「整块色块 rect」改成「下半段软色 wash + 底部 1px 实线」，支持 `options.writingMode`（竖排右半 wash + 右缘线） | 原版整块 30% 色块糊在正文上，和原型 reader-v2 的划线（下半笔刷 + 铜线）完全对不上。浓度/混合模式仍走 `--overlayer-highlight-*` 变量，新增 `--overlayer-highlight-line-opacity`（缺省 .8）。`hitTest` 用的是 add() 存的原始 rects，不受绘制改动影响 |
| `paginator.js` | `columnize()` 横排的 documentElement padding 从 `0 gap/2` 改为 `var(--_pad-top, 0px) gap/2 var(--_pad-bottom, 0px)` | 分页模式下 foliate 用内联 !important 把上下 padding 覆成 0，宿主注入的 body padding 只对章首页生效——章中页文字顶到悬浮头栏（2026-11-03 用户反馈）。两个变量由 `engine/theme.ts` 按桌面/移动写死（28/40、18/48），注入在书页文档里；不设变量时与上游逐字一致 |
| `paginator.js` | `columnize()` 里 `requestAnimationFrame` 回调前加 `if (!this.#view) return` | 视图销毁后那一帧仍会跑，`this.#view.docBackground` 直接抛 `Cannot read properties of null`。触发场景：快速关书后立刻从位置链接重开另一本（`#mediaQueryListener` 上游已有同样的判空，这一处漏了） |
| `paginator.js` | `load()` 三条改造：①不用 `display:none` 等 load，改成 `visibility:hidden`（安卓 WebView 对不可见 iframe 可能干脆不加载）；②不依赖 `load` 事件——每 200ms 轮询 `contentDocument`，正文一出现就挂载；③8s 没动静再按 blob 原文重试、15s 仍失败就 `reject` | 上游只挂 `load`、不挂 `error`，地址加载失败时 Promise 既不 resolve 也不 reject，上层 `await` 永远悬着——白屏且无报错，恢复工作区时还会把 Obsidian 钉在「加载工作区中…」 |
| `paginator.js` | `destroy()` 里 `this.#view.destroy()` 改为 `this.#view?.destroy()` | `#view` 在从未装载 / 已被上一次 destroy 置空时为 null，原版直接抛 `Cannot read properties of null`。这一抛会把后面的 `sections[index].unload()` 与 `#mediaQuery.removeEventListener` 全部跳过：整本书的 section 引用和 mediaQuery 监听都泄漏（宿主侧 `host.destroy` 里补了「close 失败也断链」的兜底，但根因在这里） |
| `paginator.js` | `isPointerSelecting` 只对非触摸、非触控笔的指针置真，并补 `pointercancel` 复位 | 上游的「拖选到页外自动翻页」（`checkPointerSelection`，700ms 防抖）本来是给桌面鼠标拖选用的。安卓长按选字后拿到的是 `pointercancel` 而不是 `pointerup`，开关会一直挂在真上；之后拖动选择手柄改选区也走同一条判断，选区一端越过当页边界就整页翻走（2026-11-08 真机录屏：向上拖起点手柄跳上一页，向下拖终点手柄跳下一页）。触摸与触控笔一律不参与，桌面鼠标行为保留 |

> 移动端 `blob:` 帧被宿主 CSP 挡掉的问题**不在 vendor 里修**：`engine/blob-srcdoc.ts`
> 在运行时拦 `iframe.src`，把 blob 读成原文、内联 CSS/图片后写 `srcdoc`。
> 这样四种格式（epub/fb2/txt/mobi）共用一条路，vendor 不需要知道。

前四处都是「已注册就跳过」，不改任何行为语义；除此外与上游逐字一致，升级时可用新版本文件整体替换后再打这 5 个补丁。

## 依赖

`vendor/fflate.js`、`vendor/zip.js` 是上游自带的同级依赖（mobi 解压 / zip 读取），随包拷入，
`construct-style-sheets-polyfill` 走 npm（fixed-layout.js 引用）。

## 打包注意

`mobi.js` 用 BigInt 字面量，构建目标至少 `es2020`（`esbuild.config.mjs` 已设）。
