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
| `paginator.js` | 十四处调用 `globalThis.__bzrDbg?.(…)`：`focusin` / `anchor` / `afterScroll` / `goTo` / `scrollTo` / `pageTurn` / `snap` / `render` / `chapter` / `selRaw` / `selDrag` / `touchEnd` / `scrollSel` / `snapBack` | 调试日志（`data/debug-log`）的 vendor 埋点。`scrollTo` 是所有程序性位置写入的唯一出口，`scrollSel` 只在「有选区时容器被原生滚走」时记，两者一对照就能分清页面是被代码挪的还是被浏览器 scrollIntoView 推的；`pageTurn` 记谁调了 `prev`/`next`，`selRaw` 带选区相对当前页的越界方向（`before`/`after`）。全局钩子在 `plugin.onload` 里常驻安装，未开启开关时是空操作 |
| `paginator.js` | 删掉「拖选越界自动翻页」整段（`checkPointerSelection` 与它的 `isPointerSelecting` 开关），只留键盘选择那条 | 真机日志（`debug.json`）里两次跳章都是它：拖起点手柄向上让选区越过页首（`selRaw out=before`），700ms 后 `pageTurn dir=-1`、没有 `hostTurn`，直接 `goTo` 到上一章末尾的固定位置。上游把这段当「用户想选到页外」，移动端长按选字拿到 `pointercancel` 让开关卡住就误触。试过「只关触摸」「只吸回」都会伤到扩选，最终按用户决定**完全禁止跨页选择** |
| `paginator.js` | 粗指针（`pointer: coarse`）且正文有非空选区时，把 `containerPosition` 吸回整页边界 | 禁掉自动翻页后还有第二处动页面：浏览器为了让选区进入视野，会把 `#container` 滚走（`overflow: hidden` 拦不住程序滚动）。分页模式下 `scrollLeft` 就是页位置，于是整页横移半屏：左边每行少一个字、右边露出下一列每行的第一个字（2026-11-08 安卓日志里的 `scrollSel`）。移动端拖选要求页面完全不动；`#locked`（翻页动画）期间不插手，桌面鼠标不动它 |
| `paginator.js` | 有选区的 `touchmove` 直接 `preventDefault()`，不再让浏览器滚容器 | 吸回是「滚完再拉回」，日志里能看到 `scrollSel 534 → snapBack 383`：页面先横移 150px 再弹回来，视觉上还是闪一下。手指压在选区上滑动这一路页面能收到 `touchmove`，拦住它就根本不滚；选择手柄走系统层、收不到事件，那一头继续由吸回兜底 |

> 移动端 `blob:` 帧被宿主 CSP 挡掉的问题**不在 vendor 里修**：`engine/blob-srcdoc.ts`
> 在运行时拦 `iframe.src`，把 blob 读成原文、内联 CSS/图片后写 `srcdoc`。
> 这样四种格式（epub/fb2/txt/mobi）共用一条路，vendor 不需要知道。

前四处都是「已注册就跳过」，不改任何行为语义；除此外与上游逐字一致，升级时可用新版本文件整体替换后再打这 5 个补丁。

## 依赖

`vendor/fflate.js`、`vendor/zip.js` 是上游自带的同级依赖（mobi 解压 / zip 读取），随包拷入，
`construct-style-sheets-polyfill` 走 npm（fixed-layout.js 引用）。

## 打包注意

`mobi.js` 用 BigInt 字面量，构建目标至少 `es2020`（`esbuild.config.mjs` 已设）。
