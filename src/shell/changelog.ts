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
    version: '1.4.0',
    date: '2026-11-14',
    added: [
      {
        domain: { zh: '朗读', en: 'Read aloud' },
        text: {
          zh: 'EPUB、TXT 与 PDF 都能念。整章一段脚本，念到屏幕外自动翻页；起播是这一页的第一个字，高亮跟着文字走，翻页、缩放、双栏与深色模式都不跑偏。',
          en: 'EPUB, TXT and PDF all read aloud. One script per chapter turns the page when the voice reaches the edge; playback starts at the first word on screen, and the highlight rides the text through page turns, zoom, two-column and dark mode.',
        },
      },
      {
        domain: { zh: '朗读方式', en: 'Engines' },
        text: {
          zh: '系统语音、DeepSeek 在线语音、或自己电脑上跑的 OpenAI 兼容服务（如 CosyVoice）三选一；在线也能填别家的兼容接口。',
          en: 'Three ways to speak: the system voice, DeepSeek online, or an OpenAI-compatible service on your own machine such as CosyVoice. Online also accepts other compatible endpoints.',
        },
      },
      {
        domain: { zh: '离线听书', en: 'Offline audio' },
        text: {
          zh: '预生成时把每章拼成一个 mp3，连同逐句时间轴存进库里的 bz-reader/offline。拷到手机或别的库，不连网也能听，高亮照常。',
          en: 'While pre-building, each chapter becomes one mp3 with a per-sentence timeline under bz-reader/offline in your vault. Copy it to a phone or another vault: it plays without a network, highlighting included.',
        },
      },
      {
        domain: { zh: '书库多选', en: 'Multi-select' },
        text: {
          zh: '书库可以多选，批量归入分类或移出书架；移出只是从书架拿走，进度、划线、书签与想法都留着。',
          en: 'The shelf selects several books at once and moves them into a category or off the shelf in one go; removing only takes the book off the shelf — progress, highlights, bookmarks and notes stay.',
        },
      },
    ],
    /* 本版说明按作者定稿只留「新增」四条，这里不写优化段 */
    improved: [],
  },
  {
    version: '1.3.1',
    date: '2026-11-14',
    added: [
      {
        domain: { zh: '汇总范围', en: 'Summary scope' },
        text: {
          zh: '设置里给剪藏成书加了三选一：全部 / 未读 / 今日+未读，默认未读——每天翻开的都是还没读的部分。',
          en: 'Clipbook gets a three-way scope in settings — everything, unread, or today plus unread. Unread is the default, so the volume opens on what you have not read yet.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '看视频', en: 'Watch' },
        text: {
          zh: '功能对照里 AI 知识盒与剪藏成书两行带「看视频」，点开就是对应的教程。',
          en: 'The plan table links straight to the tutorial for the AI knowledge box and the clipbook.',
        },
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-13',
    added: [
      {
        domain: { zh: '剪藏成书', en: 'Clipbook book' },
        text: {
          zh: '书架里多一本活书，内容直接读 bz 剪藏本，按订阅分卷；进章自动标已读，每章读了几分钟也记在里面。',
          en: 'A live volume on your shelf that reads your bz clipbook directly, grouped by subscription — chapters are marked read as you enter them, and time per chapter is kept.',
        },
      },
      {
        domain: { zh: '生成摘要', en: 'Summaries' },
        text: {
          zh: '读订阅文章时，头栏可以按篇生成 AI 摘要，写在标题下方；剪藏本更新后按文章迁回原来的位置。',
          en: 'In a subscription article, the header can generate an AI summary per piece and place it under the title; after the clipbook changes, your place moves back by article.',
        },
      },
      {
        domain: { zh: 'bz 组', en: 'bz group' },
        text: {
          zh: '设置页把剪藏本和 AI 知识盒归到「bz」组，检测到 bz 才出现开关，两项各有自己的教程。',
          en: 'Settings now gathers the clipbook and the AI knowledge box into a “bz” group: the switches only appear when bz is detected, and each item has its own tutorial.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '宽屏', en: 'Wide screens' },
        text: {
          zh: '每栏宽度跟着阅读区走，宽屏下不再两侧一片空白。',
          en: 'Column widths follow the reading area, so wide screens no longer leave blank bands on both sides.',
        },
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-12',
    added: [
      {
        domain: { zh: '页码', en: 'Page numbers' },
        text: {
          zh: '阅读页右下角可以显示页码，关掉、只数本章、还是全书累计，自己挑。',
          en: 'Page numbers in the corner of the reading view — off, per chapter, or counted across the whole book.',
        },
      },
      {
        domain: { zh: '章节名', en: 'Chapter name' },
        text: {
          zh: '沉浸模式左上角显示当前章节，也可以单独关掉。',
          en: 'Immersive mode shows the current chapter in the top corner, and you can switch it off.',
        },
      },
      {
        domain: { zh: '点击翻页', en: 'Click to turn' },
        text: {
          zh: '桌面端点正文左右两侧就能翻页，默认关，触屏笔记本可以打开。',
          en: 'On desktop, clicking either side of the text turns the page. Off by default; handy on a touchscreen laptop.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: 'PDF 缩放', en: 'PDF zoom' },
        text: {
          zh: '排版面板补上放大缩小，以及适合宽度、适合页面、实际大小。',
          en: 'The PDF layout panel now has zoom in and out, plus fit width, fit page and actual size.',
        },
      },
      {
        domain: { zh: 'PDF 面板', en: 'PDF panel' },
        text: {
          zh: '排版面板贴着按钮弹出，底栏改成卡片。',
          en: 'The layout panel opens against its button, and the bottom bar is now a card.',
        },
      },
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-11',
    improved: [
      {
        domain: { zh: '手机设置', en: 'Phone settings' },
        text: {
          zh: '分栏、朗读、快捷键收起来，头栏和菜单也不再出现这几项。',
          en: 'Columns, read-aloud and hotkeys are gone on phones — and so are those entries in the header and menu.',
        },
      },
      {
        domain: { zh: '设置页', en: 'Settings' },
        text: {
          zh: '两列重新分档，朗读挪到 AI 上方，图标表每行补上同款图标。',
          en: 'The two columns are rebalanced, read-aloud sits above AI, and each icon row now shows its icon.',
        },
      },
      {
        domain: { zh: '默认版式', en: 'Default layout' },
        text: {
          zh: '新装默认 26px 字号、1.7 行距、8px 边距，手机上一屏读一段。',
          en: 'Fresh installs start at 26px type, 1.7 line height and 8px margins — one comfortable paragraph per screen on a phone.',
        },
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-11',
    added: [
      {
        domain: { zh: '按意思搜', en: 'Search by meaning' },
        text: {
          zh: '书架和书里都能按意思找，不用先想到原话。',
          en: 'Search by meaning, in this book or across the shelf — the exact wording is not needed.',
        },
      },
      {
        domain: { zh: '本章导读', en: 'Chapter guide' },
        text: {
          zh: '读的时候点一下，先看这一章该带着什么读。',
          en: 'One tap while reading shows what this chapter is worth carrying into it.',
        },
      },
      {
        domain: { zh: '问这摞书', en: 'Ask these books' },
        text: {
          zh: '勾几本一起问，答案标明出自哪一本。',
          en: 'Tick a few books and ask them together; every answer says which book it came from.',
        },
      },
      {
        domain: { zh: '主题书单', en: 'Reading list' },
        text: {
          zh: '给一个主题，找出相关的书并排成一条阅读路线。',
          en: 'Give a topic and the matching books come back as one reading route.',
        },
      },
      {
        domain: { zh: 'AI 追问', en: 'AI follow-up' },
        text: {
          zh: '对着一段话接着问，答案能存进想法。',
          en: 'Keep asking about the passage you selected, and keep any answer as a note.',
        },
      },
      {
        domain: { zh: '对话存档', en: 'Archive a chat' },
        text: {
          zh: '侧栏聊完，整段存成一篇笔记。',
          en: 'Save a whole sidebar conversation as one note.',
        },
      },
      {
        domain: { zh: '补全信息', en: 'Fill in details' },
        text: {
          zh: '书卡菜单一下补齐简介与分类。',
          en: 'One menu item fills a book’s missing description and categories.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: 'PDF 翻页', en: 'PDF paging' },
        text: {
          zh: '翻页方式与单双页归 PDF 自己管，打开就是连续滚动。',
          en: 'Paging and spread are PDF settings of their own now, and a PDF opens in continuous scroll.',
        },
      },
      {
        domain: { zh: '设置页', en: 'Settings' },
        text: {
          zh: '阅读页图标挪到页尾，紧挨快捷键。',
          en: 'The reader icon list moved to the end of the page, right above the hotkeys.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: 'PDF 双指', en: 'PDF two-finger tap' },
        text: {
          zh: '两指轻按真的切得动沉浸，划词后的点击不再误跳页。',
          en: 'A two-finger tap really toggles immersive mode, and a tap after selecting text no longer jumps the page.',
        },
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-10',
    added: [
      {
        domain: { zh: 'PDF 阅读', en: 'PDF reading' },
        text: {
          zh: '支持 PDF 阅读。',
          en: 'PDFs open in the reader.',
        },
      },
      {
        domain: { zh: 'PDF 排版', en: 'PDF layout' },
        text: {
          zh: '缩放、旋转、单双页、缩略图与跳页，每本书记住自己的设置。',
          en: 'Zoom, rotate, one- and two-page views, thumbnails, and page jumps; each book remembers its own settings.',
        },
      },
      {
        domain: { zh: 'PDF 双链', en: 'PDF links' },
        text: {
          zh: '页码、视图、嵌入与批注四种链接都能复制，兼容 PDF++ 与原生写法。',
          en: 'Copy page, view, embed, and annotation links, compatible with both PDF++ and the native format.',
        },
      },
      {
        domain: { zh: 'PDF 反链', en: 'PDF backlinks' },
        text: {
          zh: '看本页被哪些笔记引用，文件自带的批注也能标出来。',
          en: 'See which notes cite the current page, and spot the annotations the file already carries.',
        },
      },
      {
        domain: { zh: 'PDF 页图', en: 'Page image' },
        text: {
          zh: '当前页存成图片，扫描件也能留一张。',
          en: 'Save the current page as an image — scans included.',
        },
      },
      {
        domain: { zh: '回到上一处', en: 'Back to previous spot' },
        text: {
          zh: '点目录或链接跳走之后，一键回原来的位置，EPUB 同样可用。',
          en: 'Jump to a chapter or a link and come straight back; EPUB gets the same button.',
        },
      },
      {
        domain: { zh: '引用页签', en: 'Citations tab' },
        text: {
          zh: '笔记里指向本书具体位置的链接按书聚在一起，点一条回到原文那一句。',
          en: 'Links in your notes that point to a specific place in the book gather here; click one to return to that sentence.',
        },
      },
      {
        domain: { zh: '导出这本书', en: 'Export this book' },
        text: {
          zh: '书卡右键直接导出整本摘录，每条摘录本身就是能点回原文的双链。',
          en: 'Export a whole book from its context menu; every excerpt is itself a link back to the original line.',
        },
      },
      {
        domain: { zh: '划线颜色', en: 'Highlight colour' },
        text: {
          zh: '设置页里选默认笔色，和划词条上的色点用的是同一份。',
          en: 'Pick the default pen colour in settings; the dots on the selection bar share the same value.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '全库搜索', en: 'Library search' },
        text: {
          zh: '每本先列 50 条并注明已显示多少，打不开的书单独列一行。',
          en: 'Each book lists 50 hits first and says how many are left; books that fail to open get a line of their own.',
        },
      },
      {
        domain: { zh: '划词工具条', en: 'Selection bar' },
        text: {
          zh: '图标模式松开一档间距，双链、存为名词、存为段落点完就落线，笔色记住上次选择。',
          en: 'Icon mode has room to breathe; wikilink, save-as-term, and save-as-passage drop the mark right away, and the pen colour is remembered.',
        },
      },
      {
        domain: { zh: '支持弹窗', en: 'Support dialog' },
        text: {
          zh: '跟随设置页的强调色，手机端贴底并避开安全距。',
          en: 'Follows the accent colour from settings and sits above the safe area on phones.',
        },
      },
      {
        domain: { zh: '书摘图片', en: 'Quote card images' },
        text: {
          zh: '基础版也能把划线复制成图片。',
          en: 'The free tier can copy highlights as images too.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '长想法', en: 'Long notes' },
        text: {
          zh: '再长也不会把侧栏顶出一条横向滚动条。',
          en: 'A long note no longer pushes a horizontal scrollbar into the sidebar.',
        },
      },
      {
        domain: { zh: 'PDF 双指', en: 'PDF gestures' },
        text: {
          zh: '手机上两指轻按正文能进入或退出沉浸模式。',
          en: 'A two-finger tap in a PDF toggles immersive mode on mobile.',
        },
      },
    ],
  },
  {
    version: '0.4.1',
    date: '2026-11-09',
    improved: [
      {
        domain: { zh: '高级版对照表', en: 'Upgrade table' },
        text: {
          zh: '按阅读与书架、格式与导出、统计与检索、AI、进阶分成五段，勾选列统一居中，段题前不再有竖条。',
          en: 'Grouped into five sections — reading, formats, stats, AI and advanced — with the check column centred and no rule before each heading.',
        },
      },
      {
        domain: { zh: '目录页签', en: 'Contents tab' },
        text: {
          zh: '去掉名字后面的计数。',
          en: 'The count after each name is gone.',
        },
      },
      {
        domain: { zh: '书签与划线', en: 'Bookmarks and highlights' },
        text: {
          zh: '侧栏里改用实心铜点，和正文的强调色对上。',
          en: 'Solid copper dots in the sidebar, matching the accent used in the book.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '长想法', en: 'Long notes' },
        text: {
          zh: '再长也不会把侧栏顶出一条横向滚动条。',
          en: 'A long note no longer pushes a horizontal scrollbar into the sidebar.',
        },
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-09',
    added: [
      {
        domain: { zh: '分类管理', en: 'Shelf categories' },
        text: {
          zh: '书架分类可以新建、改名、排序、删除。',
          en: 'Create, rename, reorder and delete shelf categories.',
        },
      },
      {
        domain: { zh: '归入分类', en: 'Assign a category' },
        text: {
          zh: '书卡菜单里直接挑一个分类，名字后面跟着本数。',
          en: 'Pick a category straight from the book menu; each one shows how many books it holds.',
        },
      },
      {
        domain: { zh: '统计页', en: 'Reading stats' },
        text: {
          zh: '时长、趋势、节律、目标与打卡、书籍明细、口径对照。',
          en: 'Time, trends, rhythm, goals and check-ins, per-book detail, and time-source comparison.',
        },
      },
      {
        domain: { zh: '书名开目录', en: 'Title opens contents' },
        text: {
          zh: '点头栏书名直接打开左侧目录。',
          en: 'Clicking the book title in the header opens the contents sidebar.',
        },
      },
      {
        domain: { zh: '划词条', en: 'Selection bar' },
        text: {
          zh: '新增图标模式。',
          en: 'A new icon mode for the selection bar.',
        },
      },
      {
        domain: { zh: '调试日志', en: 'Debug log' },
        text: {
          zh: '设置里可开启。',
          en: 'A switch in settings turns it on.',
        },
      },
    ],
    improved: [
      {
        domain: { zh: '分类条', en: 'Category bar' },
        text: {
          zh: '换成圆形筛选的语汇，顺序按自己排的来，书自带的分类接在后面。',
          en: 'Round filter chips, your own order, and categories that came with the book follow after.',
        },
      },
      {
        domain: { zh: '想法气泡', en: 'Note bubble' },
        text: {
          zh: '划线旁的想法带「想」字印，长想法限高可滚，点开看全文。',
          en: 'Notes on a highlight get a small seal; long ones scroll and open in full.',
        },
      },
      {
        domain: { zh: '知识盒链接', en: 'Knowledge box links' },
        text: {
          zh: '存过名词或段落的划线多一枚可点的链接。',
          en: 'Highlights saved to the knowledge box now carry a clickable link.',
        },
      },
      {
        domain: { zh: '想法输入框', en: 'Note editor' },
        text: {
          zh: '三行起，按内容撑高，长想法不用挤在一行里。',
          en: 'Starts at three lines and grows with the text, so a long note is not stuck in one row.',
        },
      },
      {
        domain: { zh: '书摘印章', en: 'Excerpt card' },
        text: {
          zh: '书摘展示窗去掉「bz 阅读」印章。',
          en: 'The excerpt card no longer stamps "bz Reader" on it.',
        },
      },
    ],
    fixed: [
      {
        domain: { zh: '划词闪动', en: 'Selection jitter' },
        text: {
          zh: '拖选时正文横移、高亮忽大忽小，已恢复稳定。',
          en: 'Dragging a selection no longer shifts the page or makes the highlight jump in size.',
        },
      },
    ],
  },
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
