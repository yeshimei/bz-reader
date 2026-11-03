# UI 观感改进清单

_2026-11-03。回答「整体有一股廉价味道，有哪些改进方向」。_

## 本轮落地情况（2026-11-03 晚）

| 项 | 状态 |
| --- | --- |
| A1 字号 19→8 档 | ✅ 188 处（< 11px 提到 11px、.5 档并入整数档） |
| A2 圆角 20→5 档 | ✅ 158 处 |
| A3 间距网格 | ⏸ **没做**：padding / gap 一改错就是挤压溢出，只能看着界面调 |
| A4 字距归零 | ✅ 60 处 ≥ .1em 的装饰性字距归零 |
| A5 衬线退出 UI | ✅ 16 处（徽记 / 按钮 / 表头 / 元信息）；书名与引文保留衬线 |
| A6 focus-visible / disabled | ✅ 两个态补齐（之前一处都没有） |
| A7 阴影两级 | ⏸ 变量建好了，使用点没换（换阴影属于"看效果"类改动） |
| A8 热力图硬编码铜色 | ✅ 改 color-mix |
| B1 字符图标换 SVG | ✅ ★ ☆ ✦ ✓ × 🔥 全部换成 ico() 的 16px SVG |
| B2 印章式徽记 | 🟡 做了一半：字距归零 + 衬线退出，分隔线与徽记边框还在 |
| B3 上标数字 / 竖线 | ⏸ 没做 |
| B4 骨架屏无限呼吸动画 | ⏸ 没做 |
| B5 全属性过渡 | ✅ 23 处改成逐属性 + 统一 easing |
| C1 卡片信息 6 层 | ⏸ 没做（要砍信息，得先定砍哪几层） |
| C2 空状态 | ⏸ 没做 |
| C3 封面 | ✅ 链路接通（shell/covers.ts），色块占位 → 真封面就地换图 |
| C4 z-index 5 档 | ✅ 33 处并到 3 档 |
| C5 tabular-nums | ✅ |
| C6 backdrop-filter 30 处 | ⏸ 没做（要逐层判断哪些该留） |

尺度变量全部进了 `tokens.css`，批量替换在 `scripts/normalize-scale.mjs`
（可重复跑：改过的再跑不变，谁又写进裸数字跑一遍就收回去）。

⏸ 的七项不是"不想做"，是**必须看着界面调**：脚本盲改这类值，改完大概率
是另一种丑。等你在 Obsidian 里看过一轮，再按屏调。

结论先说：廉价感不是"配色不好看"，而是 **尺度不统一 + 装饰性排版**。配色已经完全跟随 Obsidian，
问题出在字号/圆角/间距各自为政、中文被衬线和字距拉伸、以及用字符当图标。下面每条都给了固化值，
不是滑块。

证据来自 `src/shell/styles/*.css` 与 `styles.css` 的取值统计。

---

## A 档 · 尺度不统一（改这几条，观感立刻不一样）

### A1 字号 19 档，且 ≤12px 用了近 250 处

`font-size` 统计（出现次数）：12px×71、10.5px×66、10px×60、12.5px×54、11px×47、
13px×41、11.5px×41、9.5px×20、17px×20、14px×20、15px×18、13.5px×11、26px×10、
16px×8、9px×7、20px×5、22px×4、8px×2、8.5px×2。

两个问题：一是档位过密，11px 与 11.5px、12px 与 12.5px 视觉上没有区别，混用只会让页面"抖"；
二是小字太多，中文在 Windows 上低于 12px 就开始发虚、触发点阵，这是廉价感最直接的来源。

**改法** — UI 层压到 5 档，写进 tokens：

```
--fs-caption: 11px   /* 角标、计数、时间戳 */
--fs-mini:    12px   /* 副标题、次要行 */
--fs-body:    13px   /* 正文、列表项 */
--fs-strong:  15px   /* 卡片标题、对话框标题 */
--fs-title:   18px   /* 页面标题 */
```

数据展示另留 26px / 38px 两档（统计大数、封面首字）。禁止 < 11px。
现有 10 / 10.5 / 11.5 / 12.5 / 13.5 / 9.5 / 9 / 8.5 / 8 全部就近合并。

### A2 圆角 20+ 档

2/3/4/5/6/7/8/9/10/11/12/13/14/16/18/99，另有 18px 18px 0 0 这种手写值。

**改法** — 4 档：

```
--r-chip:  4px    /* 徽记、进度条、tag */
--r-ctl:   6px    /* 输入框、按钮、小控件 */
--r-card: 10px    /* 卡片、浮层、面板 */
--r-pill: 999px   /* 胶囊 */
```

书封 / 书脊这类"物"用 2px（书是直角的），`--r-book: 2px` 单独一档。

### A3 间距没有网格

`padding` 有 88 种不同写法，`gap` 出现 2/3/5/7/9 这种奇数，说明每个组件都是拍脑袋定的。

**改法** — 4px 基准，6 个值：`4 / 8 / 12 / 16 / 24 / 32`。
删掉 5、7、9、11、13、14、22。区块之间的呼吸用 24/32，组件内部用 4/8/12。

### A4 中文被字距拉散（17 种 letter-spacing）

`.bzs-stunav button span` 是 `.16em`，`.bzs-sect-h` 是 `.3em`，还有 `.5em` / `.28em` / `.26em` / `.24em`。
中文本身是等宽方块字，加字距只会把它拉成一盘散沙 —— 这是"Word 默认排版"味的主要来源。

**改法** — 中文标签一律 `letter-spacing: 0`。字距只留给纯英文/数字的小标签，上限 `.06em`。
导航 `.16em`、分区标题 `.3em` 全部归零，靠字号和颜色分级，不靠字距。

### A5 衬线字体用在 UI 上，fallback 到 SimSun

`--serif: Georgia, "Times New Roman", "STZhongsong", "SimSun", "Songti SC", serif`，
被用在导航、分区标题、书名、徽记、浮层标题等 25 处（overlay.css 一处 20 个）。
Windows 上中文会落到 SimSun，12–14px 的 SimSun 就是点阵宋体，怎么调都像 2005 年的界面。

**改法** — 衬线只留给"书"：书名、正文、引文，且 ≥ 15px。
导航、徽记、按钮、统计数字、表头全部回到 `--ui`。
真要书卷气，显式指定 `"Source Han Serif SC", "Noto Serif CJK SC"` 并限制在 ≥15px，别让 SimSun 兜底。

### A6 交互态缺失：focus-visible 0 处、disabled 0 处

全仓 `:hover` 40 处、`:focus` 7 处、`:active` 4 处，`:focus-visible` 和 `:disabled` 一处都没有。
键盘 tab 过去没有任何反馈，禁用按钮和可用按钮长得一模一样 —— 半成品感。

**改法**：

```css
.bzs-shell button:focus-visible { outline: 0; box-shadow: 0 0 0 2px var(--copper); }
.bzs-shell button:disabled { opacity: .45; cursor: default; }
.bzs-shell button:disabled:hover { background: none; border-color: var(--line); }
```

### A7 阴影过重 + 硬编码 rgba

`--shadow: 0 12px 32px rgba(0,0,0,.16)` 被用在书封小卡片上（`.bzs-bkcard .bzs-cov`），
32px 的模糊半径贴在 200px 宽的卡片上，是典型的网页弹窗味。另有 `inset 4px 0 9px rgba(0,0,0,.32)`
这类手写硬编码。

**改法** — 两级就够：

```
--sh-card: 0 1px 2px rgba(0,0,0,.06)   /* 卡片：1px 边框 + 极浅阴影 */
--sh-float: 0 12px 32px rgba(0,0,0,.16) /* 只给浮层/弹层 */
```

卡片 hover 从 `translateY(-5px)` 收到 `-2px`，5px 的抬升是弹跳不是反馈。

### A8 热力图两档硬编码铜色

`study.css:797` `rgba(200,164,100,.32)`、`:801` `rgba(200,164,100,.58)`。
用户把强调色换成靛蓝或苔绿，热力图还是一块脏黄 —— 这个不是"不精致"，是 bug。

**改法**：`color-mix(in srgb, var(--copper) 32%, transparent)`，四档 12/32/58/85%。

---

## B 档 · 装饰性排版（做完 A 之后，这些是第二层噪音）

### B1 用字符当图标

`★ ☆ ✦ ✓ 🔥` 出现在 `shell/overlay.ts:467/571/611/648`、`ui/stats-panel.ts:141`（🔥 连续天数）、
`✕` 在 prefs-panel / search-panel 当关闭按钮。字符图标的粗细、基线、字重完全由字体决定，
跨平台必然不齐 —— 这是最典型的廉价信号。

**改法**：全部换成 `setIcon()`（lucide，Obsidian 自带）的 16px SVG。
星星用 `star`（fill 通过 `fill: currentColor` 控制），关闭用 `x`，火焰用 `flame` 或直接去掉。

### B2 印章式徽记

`.bzs-badge` 是衬线 10px + 圆角 99px + 铜色边框 + `.06em`；`.bzs-sect-h b` 是衬线 + 铜色 + `.1em`；
`.bzs-sect-h` 本身是 10.5px + `.3em` + 一条贯穿的分隔线。三套"印记"叠在同一个界面里就是噪音。

**改法**：分区标题去掉分隔线，只留 12px / `--t3` / 无字距。徽记保留一种：`--fs-caption`、
无衬线、1px 边框、`--r-chip`，颜色用 `--t2` 而不是强调色（强调色留给真正的操作）。

### B3 上标数字与竖线标记

`.bzs-stunav button .n` 用 `font-size: 9.5px; vertical-align: super` 做计数上标 —— 中文旁边基线对不齐。
另有 `border-left: 3px` 与 `2px` 混用的竖线标记。

**改法**：计数改成行内小徽标，11px、`--r-chip`、`margin-left: 6px`、垂直居中。
竖线标记统一 2px。

### B4 无限呼吸动画

`styles.css:6418` `@keyframes bzs-wv` + `animation: bzs-wv 1s ease-in-out infinite alternate`
（骨架屏）。无限往复的呼吸动画是廉价加载感的标配。

**改法**：骨架屏改成静态低对比块（`--surface-2`），或者一次性的 opacity 脉冲（1 次，0.4s）。
进场动画 `bzs-float-in .16s` 保留，但补一个 0.12s 的退场。

### B5 全属性过渡

`transition: .2s` 出现 22 处（还有 `.15s` 18 处、`.18s` 4 处）。不写属性 = 所有属性一起渐变，
hover 时 border、shadow、transform 同时动，就是"果冻味"。

**改法**：统一两条 ——

```css
--ease: cubic-bezier(.2, .8, .2, 1);
transition: background .16s var(--ease), border-color .16s var(--ease), color .16s var(--ease);
transform: translateY(0); transition: transform .18s var(--ease);  /* 位移单独写 */
```

---

## C 档 · 结构与密度

### C1 一张卡片 6 层信息

`.bzs-bkcard` 里同时有：封面、书名(14px)、副标题(11px t3)、meta em、进度条、flag、rowacts 按钮组。
六层全靠字号和灰阶区分，结果是糊成一团。

**改法**：卡片上只留 封面 / 书名 / 作者 / 进度条。其余（状态、操作）进 hover 层或详情页。
`rowacts` 现在的 hover 显隐已经做了，把 flag 也收进去。

### C2 空状态只有一行灰字

`.bzs-empty` 是 13px + `--t3` + `padding: 40px` 居中。大留白配灰字，第一眼是"加载失败"。

**改法**：32px 图标（opacity .35）+ 一句说明 + 一个主行动按钮。三段间距 8/16。

### C3 封面全是色块

`meta.coverPath` 全仓没有写入点，`data/cover.ts` 的缓存只有废弃的 `ui/shelf.ts` 在调，
书籍详情还硬编码 `coverUrl: null`。书架 90% 的视觉靠封面，现在是清一色色块 + 居中大书名。

**改法**：
1. 接通 epub 封面提取（cover.ts 已有，补调用点）；
2. 失败时的兜底不要用高饱和色块 —— 按书名 hash 生成 HSL，S 固定 18–24%、L 固定 72%，
   只留书名首字。低饱和才像书，高饱和像占位图。

### C4 z-index 十档

1/2/3/8/9/30/40/45/60/9000，没有层级表，浮层之间互相穿插只是时间问题。

**改法**：5 档，写成变量 —— 内容 0 / 吸顶 10 / 浮层 100 / 弹层 500 / toast 1000。

### C5 数字没有 tabular-nums

统计页数字全仓没有 `font-variant-numeric: tabular-nums`，翻页或刷新时数字会左右跳。

**改法**：`.bzs-shell` 上给所有数字类（统计值、进度百分比、时间）加 `font-variant-numeric: tabular-nums`。

### C6 backdrop-filter 用了 30 处

`styles.css` 里 30 处毛玻璃。毛玻璃叠毛玻璃在高 DPI 上会脏，也是性能负担。

**改法**：只保留最高一层浮层（弹层/抽屉）用，其余改成实色 `--surface` + 1px 边框。

---

## D · 建议固化的一组值

| 项 | 值 |
| --- | --- |
| 字号 | 11 / 12 / 13 / 15 / 18（数据 26 / 38） |
| 圆角 | 2（书）/ 4（chip）/ 6（控件）/ 10（卡片）/ 999（胶囊） |
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 |
| 字距 | 中文 0；英文小标签 ≤ .06em |
| 字重 | 400 / 500 两种，不用 600/700 |
| 阴影 | `--sh-card` 0 1px 2px .06；`--sh-float` 0 12px 32px .16 |
| 动效 | .16s 颜色 / .18s 位移，ease `cubic-bezier(.2,.8,.2,1)`，hover 抬升 2px |
| 层级 | 0 / 10 / 100 / 500 / 1000 |
| 颜色 | 只保留 `--copper` 一支强调色 + `--vermilion` 一支错误色，其余用宿主灰阶 |

---

## 不建议做的

- **别加颜色。** 现在配色已经全读 Obsidian，加任何自持色都会重复五套皮肤翻车的老路。
- **别加动效。** 现在的观感问题不是"不够动"，是"动得太随意"。先做减法。
- **别加图标密度。** 图标不是越多越专业，导航四个 + 每行一到两个操作就够。

## 动手顺序

1. A1–A3（tokens 里补齐 scale，然后批量替换）—— 收益最大，纯体力活
2. A4–A5（字距归零 + 衬线退出 UI）
3. A6–A8（交互态、阴影、硬编码色）
4. B1（字符换 SVG 图标）
5. C3（封面链路）—— 书架观感的分水岭
6. 其余按 A→B→C 顺序

改 1–3 之后重新看一次，如果还觉得廉价，问题就不在 CSS，在信息架构（C1 那种卡片塞太多东西）。
