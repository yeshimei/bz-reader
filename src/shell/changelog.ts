/* ============================================================
 * bz-reader · 更新日志数据与判定（shell/changelog.ts）
 *
 * 一、数据是**内置**的（照 bz 插件的做法）：不下载、不联网、不读远端文件。
 *     好处是升级后离线也能弹；坏处是每发一版要手工在最前面插一条——
 *     忘了插的代价是「这一版不弹」，不会弹错版本，这是刻意选的失败方向。
 *     发版时 version 必须与 manifest.json 完全一致（pickReleaseFor 是全等
 *     匹配，不做就近匹配）。
 *
 * 二、什么时候弹（planChangelog 一张表说清）：
 *     · 升级过（记录比当前旧）          → 弹，等用户第一次进书库
 *     · 老库没有记录（功能上线之前）    → 当升级，弹一次
 *     · 真新装（data.json 本来就不存在）→ 只记账不弹：他没用过旧版，
 *       给他看一屏「修好了什么」是纯噪音（bz 也是这么定的）
 *     · 同一版已记过                    → 跳过，一个字节都不写
 *     · 降级 / 回滚                     → 记账不弹
 *
 * 三、文案口径：一条日志只讲**用户能感知的变化**。构建方式、依赖升级这类
 *     内部改动写成「包体更小 / 装得更快」，别把 commit message 抄进来。
 * ============================================================ */

/**
 * 一条日志的双语文本。
 *
 * **更新日志是全仓唯一只做两版的文案**（见 `i18n.changelogLang`）：每次发版
 * 手写，八种语言维护一轮就是八倍工作量。中文给简中与繁中共用，其余六种语言
 * 读英文——读日志的人本来就知道自己在看什么，这不是「假装看得懂」。
 */
export interface L10nText {
  zh: string;
  en: string;
}

/** 一条日志：domain 是左侧那枚域名小标签，text 是一句话 */
export interface ChangelogEntry {
  domain: L10nText;
  text: L10nText;
}

/** 一个版本的日志块 */
export interface ChangelogRelease {
  version: string;
  /** YYYY-MM-DD；弹窗里格式化成 2026.11.04 */
  date?: string;
  added?: ChangelogEntry[];
  improved?: ChangelogEntry[];
  fixed?: ChangelogEntry[];
}

/**
 * 内置日志，**最新在前**。
 *
 * 发版流程里记得加一条（docs/note-v<版本>.md 与 GitHub Release 用同一批句子，
 * 别在这里另写一版）。条数多了从末尾裁掉最旧的——弹窗只回溯到第一个上架版本，
 * 再往前没有用户走过。
 *
 * 英文那半边**不是机翻**：它是给海外用户看的版本，句子按英文习惯重写，
 * 不是把中文逐字对过去（逐字对过去读起来像说明书）。
 */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: '0.3.3',
    date: '2026-11-08',
    improved: [
      {
        domain: { zh: '搜索合并', en: 'One search box' },
        text: {
          zh: '本书与全库两档，书名、章节、标注与正文一次搜完。',
          en: 'Both scopes now search titles, chapters, highlights and body text in one go.',
        },
      },
      {
        domain: { zh: '搜索高亮', en: 'Search results' },
        text: {
          zh: '结果里的关键词加底色，没作者的书只显示书名。',
          en: 'Keywords are highlighted in the results, and a book with no author now shows just its title.',
        },
      },
      {
        domain: { zh: '搜索浮层', en: 'Search popover' },
        text: {
          zh: '关掉再打开，还停在原来的词、结果和位置。',
          en: 'Close the search popover and open it again: the same query, the same results, the same position.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '移动端滑杆', en: 'Sliders on mobile' },
        text: {
          zh: '设置页往下滚，手指扫过滑轨不再改字号与行距。',
          en: 'Scrolling the settings page no longer changes font size or line spacing when a finger brushes a slider.',
        },
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-11-08',
    improved: [
      {
        domain: { zh: '书架头栏', en: 'Shelf header' },
        text: {
          zh: '进搜索、导入、统计、设置不再换头栏，页签和四颗图标一直在。',
          en: 'Search, import, stats and settings no longer swap the header — the tabs and the four icons stay right where they are.',
        },
      },
      {
        domain: { zh: '返回', en: 'Going back' },
        text: {
          zh: '再点一次亮着的那颗图标，就回到进来之前那一页。',
          en: 'Tap the lit icon again and you are back on the page you came from.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: 'iPhone 翻页', en: 'iPhone page turns' },
        text: {
          zh: '章节正文重新允许脚本，点按与滑动恢复响应。',
          en: 'Chapter documents may run scripts again, so taps and swipes respond on iPhone.',
        },
      },
      {
        domain: { zh: '首装读盘', en: 'First launch' },
        text: {
          zh: 'iPhone 第一次打开不再误报读取失败。',
          en: 'A fresh install on iPhone no longer reports a read failure.',
        },
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-11-08',
    improved: [
      {
        domain: { zh: '朗读语言', en: 'Read-aloud language' },
        text: {
          zh: '按书的语言挑发音，英文按句号断句，不再一页念成一句。',
          en: 'Speech now follows the book’s own language, and English sentences are split at full stops instead of being read as one long page.',
        },
      },
      {
        domain: { zh: '弹窗读屏', en: 'Screen readers' },
        text: {
          zh: '弹窗补上读屏标签与焦点圈闭，键盘 Tab 不会跑出窗。',
          en: 'Dialogs now carry screen-reader labels and trap keyboard focus, so Tab can no longer wander out behind them.',
        },
      },
      {
        domain: { zh: '翻页方向', en: 'Page turning' },
        text: {
          zh: '点按、键盘、拖拽共用一条规则，从右往左的书不再翻反。',
          en: 'Tap, keyboard and drag now share one direction rule — right-to-left books no longer turn the wrong way.',
        },
      },
      {
        domain: { zh: '手势', en: 'Gestures' },
        text: {
          zh: '删掉双指捏合与 Ctrl+滚轮改字号，不再和系统缩放抢同一只手。',
          en: 'Pinch-to-zoom and Ctrl+scroll no longer change the font size, so they stop fighting the system zoom gesture.',
        },
      },
      {
        domain: { zh: '书架重绘', en: 'Shelf repaint' },
        text: {
          zh: '内容没变不再整页重画，封面墙翻起来更顺。',
          en: 'The shelf skips repainting when nothing changed, so scrolling a wall of covers feels smoother.',
        },
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-07',
    added: [
      {
        domain: { zh: '全书问答', en: 'Whole-book Q&A' },
        text: {
          zh: '在侧栏就能就整本书提问，回答附上出处，点一下跳到那一章。',
          en: 'Ask about the whole book right in the sidebar — answers cite their sources, and one click jumps to that chapter.',
        },
      },
      {
        domain: { zh: '全书索引', en: 'Book index' },
        text: {
          zh: '每本书单独建一份索引，向量化检索或 AI 信息压缩两种建法任选。',
          en: 'Each book gets its own index, built either from vector search or from AI compression.',
        },
      },
      {
        domain: { zh: '知识盒', en: 'Knowledge box' },
        text: {
          zh: '划词条里多出「存为名词 / 存为段落」，存进 bz 知识盒并回写双链。',
          en: 'The selection toolbar gains Save as term and Save as passage: entries land in bz’s knowledge box and link back to the highlight.',
        },
      },
      {
        domain: { zh: '文件失联', en: 'Missing files' },
        text: {
          zh: '书文件被移走时书卡打上角标，点一下重新定位。',
          en: 'A book whose file has moved away shows a badge on its card; tap it to point the plugin at the new location.',
        },
      },
      {
        domain: { zh: '沉浸提示', en: 'Immersive mode' },
        text: {
          zh: '进入沉浸模式时提示退出方式，桌面按 ESC、手机双指轻按。',
          en: 'Entering immersive mode now says how to leave: ESC on desktop, a two-finger tap on mobile.',
        },
      },
      {
        domain: { zh: '书卡直达', en: 'Open from the shelf' },
        text: {
          zh: '点书卡直接进阅读，不用再点一次「继续」。',
          en: 'Tap a book card to start reading — no second tap on Continue.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '书架去重', en: 'Shelf dedupe' },
        text: {
          zh: '同一份文件改名、换目录、复制一份，都只留一条记录。',
          en: 'A renamed, moved or copied file still keeps a single record on the shelf.',
        },
      },
      {
        domain: { zh: '移除书库', en: 'Removing books' },
        text: {
          zh: '改成移出书架，进度、划线、想法全留着，重新导入就接上。',
          en: 'Removing a book now only takes it off the shelf: progress, highlights and notes stay, and re-importing picks them up.',
        },
      },
      {
        domain: { zh: '划词条', en: 'Selection toolbar' },
        text: {
          zh: '去掉与「问 AI」重复的翻译入口。',
          en: 'Dropped the translate entry that duplicated Ask AI.',
        },
      },
      {
        domain: { zh: '手机', en: 'Mobile' },
        text: {
          zh: '正文上下留白收窄，底部不再重复让出安全区。',
          en: 'Tighter top and bottom margins in the text, and the bottom inset is no longer counted twice.',
        },
      },
      {
        domain: { zh: '目录', en: 'Contents' },
        text: {
          zh: '点目录时自动切到目录页签并顶到前面。',
          en: 'Tapping the contents switches to the Contents tab and brings it to the front.',
        },
      },
      {
        domain: { zh: '群入口', en: 'Community group' },
        text: {
          zh: '解锁弹层里的加群按钮常驻，文案统一成「QQ交流群」。',
          en: 'The unlock dialog always shows the group button, labelled QQ group.',
        },
      },
      {
        domain: { zh: 'AI 卡片', en: 'AI card' },
        text: {
          zh: '关掉卡片就停掉请求，不会在后台跑完照扣费。',
          en: 'Closing the card stops the request instead of letting it run — and bill — in the background.',
        },
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-05',
    added: [
      {
        domain: { zh: '双向链接', en: 'Wikilinks' },
        text: {
          zh: '划线可以复制成 `[[书#定位|原文]]` 双链，点一下跳回那一句，反链面板里也看得见。',
          en: 'Copy a highlight as a `[[book#locator|text]]` wikilink: clicking it jumps straight back to that sentence, and the link shows up in the backlinks pane.',
        },
      },
      {
        domain: { zh: '多语言', en: 'Languages' },
        text: {
          zh: '界面支持中文、繁體中文、English、日本語、Deutsch、Français、Español、Português 八种语言，可跟随 Obsidian 或手动选择。',
          en: 'The interface speaks eight languages — Chinese, Traditional Chinese, English, Japanese, German, French, Spanish and Portuguese — following Obsidian or picked by hand.',
        },
      },
      {
        domain: { zh: '划词工具条', en: 'Selection toolbar' },
        text: {
          zh: '划词和点划线合并成同一枚工具条，复制、AI、双链都在一处。',
          en: 'Selecting text and tapping a highlight now open the same toolbar, so copy, AI and wikilinks all live in one place.',
        },
      },
      {
        domain: { zh: '阅读页图标', en: 'Header icons' },
        text: {
          zh: '头栏图标扩到十项，可在设置里排序、收起，收起的进「⋮」菜单。',
          en: 'The reader header holds ten actions; reorder or hide them in Settings, and hidden ones move into the ⋮ menu.',
        },
      },
      {
        domain: { zh: '关于条', en: 'About bar' },
        text: {
          zh: '设置页顶部新增关于条，版本、GitHub、视频教程、交流群与更新日志收在一处。',
          en: 'A new About bar sits at the top of Settings, gathering the version, GitHub, video guide, community group and changelog in one place.',
        },
      },
      {
        domain: { zh: '更新日志', en: 'Changelog' },
        text: {
          zh: '升级后第一次打开书库时自动弹一次。',
          en: 'The first time you open your library after an update, the changelog pops up once.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '基础版', en: 'Free tier' },
        text: {
          zh: '单栏 / 双栏下放基础版，不再需要激活码。',
          en: 'Single and two-column layouts are now part of the free tier — no activation code needed.',
        },
      },
      {
        domain: { zh: '删除划线', en: 'Highlights' },
        text: {
          zh: '桌面改成贴字确认条，不再弹大卡。',
          en: 'Deleting a highlight on desktop now asks with an inline confirmation strip instead of a full dialog.',
        },
      },
      {
        domain: { zh: '书库', en: 'Library' },
        text: {
          zh: '头栏文字与图标放大一档，桌面排序拆成三颗平铺。',
          en: 'The library header is a notch larger, and desktop sorting is split into three flat buttons.',
        },
      },
      {
        domain: { zh: '设置', en: 'Settings' },
        text: {
          zh: '分组重新排序，阅读页图标移到外观之前。',
          en: 'Settings groups are reordered, with the reader icon moved ahead of Appearance.',
        },
      },
      {
        domain: { zh: '强调色', en: 'Accent color' },
        text: {
          zh: '从 5 档扩到 8 档，第一档叫「跟随 Obsidian」。',
          en: 'Accent colors grow from five to eight; the first one is called “Follow Obsidian”.',
        },
      },
      {
        domain: { zh: '朗读', en: 'Read aloud' },
        text: {
          zh: '语速与朗读跟随从排版浮层搬到设置页，单独成组。',
          en: 'Speech rate and follow-along moved from the typography popover into their own Settings group.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '阅读页', en: 'Reader' },
        text: {
          zh: '打开书不再自动展开侧栏与目录。',
          en: 'Opening a book no longer unfolds the sidebar and contents on its own.',
        },
      },
      {
        domain: { zh: '阅读页', en: 'Reader' },
        text: {
          zh: '导入后立即显示作者，滚动模式读完一章自动进下一章。',
          en: 'The author shows up as soon as a book is imported, and scroll mode moves to the next chapter when one ends.',
        },
      },
      {
        domain: { zh: '阅读页', en: 'Reader' },
        text: {
          zh: '重启后版式读本平台那一份，不再串到另一套。',
          en: 'After a restart the layout comes from this platform’s own settings instead of drifting to the other set.',
        },
      },
      {
        domain: { zh: '手机', en: 'Mobile' },
        text: {
          zh: '想法 / 书摘弹窗不再被输入法遮挡，正文底部让出安全区。',
          en: 'Note and excerpt dialogs are no longer covered by the keyboard, and body text leaves room for the safe area.',
        },
      },
      {
        domain: { zh: '书库', en: 'Library' },
        text: {
          zh: '筛选行不再被误判成手机，按窗口宽度摊开。',
          en: 'The filter row is no longer mistaken for a phone layout and spreads across the window width.',
        },
      },
      {
        domain: { zh: '目录迁移', en: 'Data folder' },
        text: {
          zh: '三个目录选择器恢复正常，迁移失败会回滚。',
          en: 'All three folder pickers work again, and a failed move rolls back.',
        },
      },
      {
        domain: { zh: 'AI 输入框', en: 'AI input' },
        text: {
          zh: '输入期间不再落盘，打一个字不会失焦。',
          en: 'Typing in the AI box no longer saves on every keystroke, so it stops losing focus mid-sentence.',
        },
      },
      {
        domain: { zh: '文件', en: 'Files' },
        text: {
          zh: '不再抢 `.txt` 扩展名。',
          en: 'The plugin no longer claims the `.txt` extension.',
        },
      },
      {
        domain: { zh: '备份', en: 'Backup' },
        text: {
          zh: '备份与恢复同时带上桌面与手机两套版式。',
          en: 'Backups and restores now carry both the desktop and mobile layout sets.',
        },
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-11-04',
    improved: [
      {
        domain: { zh: '安装包', en: 'Bundle' },
        text: {
          zh: '渲染内核改走依赖打包，包体更小、装上更快。',
          en: 'The rendering core now ships as a bundled dependency — smaller download, faster install.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '社区市场', en: 'Marketplace' },
        text: {
          zh: '修掉上架审核报的错，现在能搜到并正常安装。',
          en: 'Fixed the errors from the directory review; the plugin can be found and installed again.',
        },
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-11-04',
    added: [
      {
        domain: { zh: '阅读', en: 'Reading' },
        text: {
          zh: 'EPUB 与 TXT 开箱即读，桌面和手机是同一个包。',
          en: 'EPUB and TXT open out of the box, from a single build for desktop and mobile.',
        },
      },
      {
        domain: { zh: '书架', en: 'Shelf' },
        text: {
          zh: '封面墙、继续阅读、分组筛选，一本书读到哪一眼就看到。',
          en: 'Cover wall, continue reading and group filters — see where you are in a book at a glance.',
        },
      },
      {
        domain: { zh: '标注', en: 'Highlights' },
        text: {
          zh: '四色划线、书签、想法；划过的话能带着定位复制成链接。',
          en: 'Four highlight colours, bookmarks and notes; copy a highlight as a link that keeps its position.',
        },
      },
      {
        domain: { zh: '排版', en: 'Typography' },
        text: {
          zh: '字号、行距、页边距、单双栏与竖排，边调边看。',
          en: 'Font size, line height, margins, one or two columns and vertical text — all adjusted live.',
        },
      },
      {
        domain: { zh: '笔记', en: 'Notes' },
        text: {
          zh: '划线导出成结构化的 Markdown，留在自己的笔记库里。',
          en: 'Export highlights as structured Markdown that stays in your own vault.',
        },
      },
      {
        domain: { zh: 'AI', en: 'AI' },
        text: {
          zh: '接自己的 OpenAI 兼容接口，划词提问、解释、翻译、摘要。',
          en: 'Plug in your own OpenAI-compatible endpoint to ask, explain, translate and summarise a selection.',
        },
      },
    ],
  },
];

/** 去掉 v 前缀与首尾空白；空值给空串（调用方据此判「没有版本」） */
export function normalizeVersion(v: string | null | undefined): string {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .trim();
}

function segments(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(/[.\-+]/)) {
    const n = Number(part);
    if (Number.isFinite(n) && part.trim() !== '') out.push(n);
  }
  return out;
}

/**
 * 比版本号：按段比数字，缺的段当 0。
 *
 * 不按字符串比——`0.1.10` 会被判成比 `0.1.9` 旧，于是升级永远等不到弹窗
 * （反而更难查：界面一切正常，只是「更新日志不见了」）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = segments(normalizeVersion(a));
  const pb = segments(normalizeVersion(b));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 取与 version 完全相等的那个日志块；找不到 → null（调用方据此不弹、只记账） */
export function pickReleaseFor(
  releases: readonly ChangelogRelease[],
  version: string,
): ChangelogRelease | null {
  const target = normalizeVersion(version);
  if (!target) return null;
  return releases.find((r) => normalizeVersion(r?.version || '') === target) || null;
}

/** 这一版有多少条改动（三段求和） */
export function releaseEntryCount(release: ChangelogRelease): number {
  return (release.added?.length || 0) + (release.improved?.length || 0) + (release.fixed?.length || 0);
}

export type ChangelogPlan =
  /** 弹：等到第一次进书库时把 version 这一版推给用户 */
  | { action: 'show'; version: string }
  /** 只记账：把记录推到 version，别打扰 */
  | { action: 'record'; version: string }
  /** 什么都不做 */
  | { action: 'skip'; version: '' };

/**
 * 该不该弹（见文件头的判定表）。
 *
 * `freshInstall` 必须由 onload 时「data.json 存不存在」来给：
 * 光看 seen 为空分不出「新装」与「老库第一次跑到这个功能」。
 */
export function planChangelog(input: {
  current: string;
  seen: string;
  freshInstall: boolean;
}): ChangelogPlan {
  const current = normalizeVersion(input.current);
  if (!current) return { action: 'skip', version: '' };
  if (input.freshInstall) return { action: 'record', version: current };
  const seen = normalizeVersion(input.seen);
  if (!seen) return { action: 'show', version: current };
  const cmp = compareVersions(current, seen);
  if (cmp > 0) return { action: 'show', version: current };
  if (cmp < 0) return { action: 'record', version: current };
  return { action: 'skip', version: '' };
}
