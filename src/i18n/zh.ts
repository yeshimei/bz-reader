/**
 * 中文文案包（src/i18n/zh.ts）—— **基准包**
 *
 * 这个文件的 key 集合就是全局类型真源：`MsgKey = keyof typeof ZH`，
 * 英文包漏一条 `tsc` 直接红。所以新增文案永远先加这里。
 *
 * 命名：`域名.动作`，一律扁平带点（不用嵌套对象——嵌套会让「补一条文案」
 * 变成「改三层结构」，历史上这类结构的文案包最后都长歪了）。
 *
 * 文案口径（沿用壳层原有的写法，改语言不该顺手改中文）：
 *   · 通知用完成态，不用「正在…」：「已导出 3 条划线」，不是「导出中」
 *   · 报错说清下一步能做什么：「检查 Key」而不是「请求失败」
 *   · 命令名带域前缀（书架：/ 阅读：），快捷键面板里能靠搜一个词过滤
 *
 * 范围（P0）：命令、ribbon、通知。壳层页面（书架 / 设置 / 弹窗 / 更新日志）
 * 仍是中文，见 docs/i18n-assessment.md 的 P1–P2。data 层返回的错误消息
 * （license / backup / store）也还没错误码化，同样留给后续阶段。
 */

export const ZH = {
  /* ── 通用词 ──────────────────────────────────────────────── */
  'common.default': '默认',
  'common.untitled': '未命名',
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.unknownError': '未知错误',

  /* ── 插件入口 ────────────────────────────────────────────── */
  'ribbon.shelf': 'Bz 阅读：书架',

  /* ── 命令：书架 ──────────────────────────────────────────── */
  'cmd.open': '书架：打开书架',
  'cmd.continue': '书架：继续阅读最近一本',
  'cmd.import': '书架：导入书籍',
  'cmd.notes': '书架：笔记',
  'cmd.stats': '书架：统计',
  'cmd.prefs': '书架：设置',

  /* ── 命令：阅读器 ────────────────────────────────────────── */
  'cmd.search': '阅读：搜索（本书 / 全库）',
  'cmd.sidebar': '阅读：显示左侧栏',
  'cmd.pageNext': '阅读：下一页',
  'cmd.pagePrev': '阅读：上一页',
  'cmd.focus': '阅读：专注模式',
  'cmd.fullscreen': '阅读：全屏',
  'cmd.bookmark': '阅读：记一枚书签',
  'cmd.typography': '阅读：排版面板',
  'cmd.bookmap': '阅读：全书鸟瞰',
  'cmd.tts': '阅读：朗读开关',
  'notice.needBook': '先打开一本书再用这个命令',
  'notice.language.changed': '界面语言已切换，命令名需重启 Obsidian 后更新',

  /* ── 通知：剪贴板 ────────────────────────────────────────── */
  'notice.copy.ok': '已复制到剪贴板',
  'notice.copy.failed': '复制失败，请用系统快捷键',

  /* ── 通知：书签 ──────────────────────────────────────────── */
  'notice.bookmark.noCfi': '这一页还没有定位信息，翻一页再试',
  'notice.bookmark.exists': '这一页已经有一枚书签了',
  'notice.bookmark.added': '已记一枚书签',

  /* ── 通知：划线 / 标注 ───────────────────────────────────── */
  'notice.mark.created': '已用{color}色划线',
  'notice.mark.recolored': '换成{color}',
  'notice.mark.notFound': '没找到这条划线',
  'notice.mark.gone': '找不到这条标注，可能已经被删掉了',
  'notice.mark.deleted': '划线已删',
  'notice.mark.deletedN': '已删除 {n} 条划线',
  'notice.mark.goneAll': '这些标注已经不在了',
  'notice.idea.saved': '想法已保存',
  'notice.idea.cleared': '想法已清空',

  /* ── 通知：笔记 / 导出 ───────────────────────────────────── */
  'notice.note.saved': '已存进 {path}',
  'notice.note.saveFailed': '存笔记失败：{why}',
  'notice.export.needBook': '先打开一本书，或在笔记页对某本书点导出',
  'notice.export.empty': '这本书还没有划线或书签，导不出东西',
  'notice.export.done': '已导出 {n} 条划线到 {path}',
  'notice.export.failed': '导出失败：{why}',
  'export.noData': '（还没有可导出的数据）',
  'export.noNotes': '（还没有划线。去阅读页选中一段文字试试。）',
  'export.loose': '零散片段',

  /* ── 通知：书摘卡 ────────────────────────────────────────── */
  'notice.card.copied': '书摘卡已复制为图片',
  'notice.card.copyFailed': '复制图片失败',
  'notice.quote.empty': '没有可存的引文',

  /* ── 通知：书架动作 ──────────────────────────────────────── */
  'notice.fav.on': '已收藏',
  'notice.fav.off': '已取消收藏',
  'notice.rename.empty': '书名不能为空',
  'notice.rename.done': '书名已改',
  'notice.book.archived': '已把《{title}》移出书架，数据都保留',
  'notice.book.revived': '已恢复 {n} 本，进度和划线都接上了',
  'notice.missing.found': '找到了：{path}',
  'notice.missing.notFound': '库里没找到同一份文件，可以手动选一个',
  'notice.missing.wrong': '这个文件不是同一本（内容对不上）',
  'notice.missing.picked': '已重新定位到 {path}',
  'notice.missing.tooBig': '文件太大，无法校验内容：请把它放回库里，再用「在库里找一找」',
  'notice.missing.noFingerprint': '这本书还没有内容指纹：请先手动选择一次文件，之后就能自动找',
  'notice.select.pick': '先选几条要删的',
  'notice.rating.stars': '已记下 {stars} 星',
  'notice.rating.done': '已记下',
  'notice.status.reading': '已标记为在读',
  'notice.status.done': '已标记读完',
  'notice.ui.reset': '界面状态已重置',
  'notice.video.wip': '视频教程还在剪，做好会在交流群里通知',

  /* ── 通知：导入 ──────────────────────────────────────────── */
  'notice.import.done': '已加入 {n} 本',
  'notice.import.failed': '加入书架失败：{why}',
  'notice.import.written': '已导入 {n} 本到 {folder}',
  'notice.import.error': '导入失败：{why}',
  'notice.import.partial': '有 {failed} 个文件导入失败，已导入 {ok} 个',
  'notice.import.skipped': '有 {n} 本已经在书架（同一份文件），没有重复加入',

  /* ── 通知：搜索 ──────────────────────────────────────────── */
  'notice.search.empty': '先输入要搜的字',
  'notice.search.needBook': '先打开一本书，再来搜正文',
  'notice.search.failed': '正文搜索失败：{why}',
  'notice.sel.empty': '没有可复制的选区',
  'notice.toc.missingChapter': '这一章在目录里找不到，可能书换了版本',

  /* ── 通知：目录 / 数据目录 ───────────────────────────────── */
  'notice.dir.exportRoot': '导出目录不能是库根目录，请选一个文件夹',
  'notice.dir.dataRoot': '数据目录不能是库根目录，请选一个文件夹',
  'notice.migrate.running': '正在迁移…',
  'notice.goal.set': '每日目标改为 {n} 分钟',

  /* ── 通知：备份 / 恢复 ───────────────────────────────────── */
  'notice.backup.done': '已备份到「{path}」',
  'notice.backup.failed': '备份失败：{why}',
  'notice.restore.noPick': '没有选择文件',
  'notice.restore.unreadable': '读不了这个文件：{why}',
  'notice.restore.done': '已恢复，书架现在 {n} 本',
  'notice.restore.dropped': '（有 {n} 条记录不完整，已跳过）',

  /* ── 通知：数据文件 ──────────────────────────────────────── */
  'notice.data.broken': '数据文件读不出来，已留档为 bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': '数据文件读不出来，也没能留档；本次会话不再保存，避免覆盖原文件',
  'notice.data.dropped': '有 {n} 条书记录缺文件路径，已另存为 bz-reader.dropped-*.json',
  'notice.data.loadFailed': '读取阅读数据失败，本次会话不保存，避免用空库覆盖原文件',
  'notice.data.saveFailed': '保存阅读数据失败，请检查磁盘空间',

  /* ── 通知：数据目录 / 深链 ───────────────────────────────── */
  'notice.dataDir.multiple': '发现多个数据目录，无法判断该用哪一个；请到设置里选择',
  'notice.dataDir.found': '数据目录找回来了：「{dir}」',
  'notice.link.bookMissing': '链接指向的书不在书架上，可能已被移走',
  'notice.link.cfiMiss': '没找到原句，已停在这本书上次读到的位置',
  'notice.noReadBook': '还没有读过的书',
  'notice.debug.link': '[bz 诊断] {type} · {href}',

  /* ── 通知：阅读器 ────────────────────────────────────────── */
  'notice.compare.onlyOne': '书架上只有这一本，并排对照需要另一本书',
  'notice.compare.failed': '并排没打开：{why}',
  'notice.tts.noText': '这一页没有可朗读的文字',
  'notice.tts.unsupported': '这个环境不支持语音朗读',
  'notice.open.unsupported': '格式不受支持',
  'fault.openFailed': '这本书打不开',
  'notice.load.stalled': '{what}没有完成，请再试一次',
  'notice.locate.notReady': '这一页还没定位好，翻一下再试',
  'notice.bookmark.toggledOn': '已加书签',
  'notice.bookmark.toggledOff': '已移除书签',

  /* ── 通知：交流群（QQ） ──────────────────────────────────── */
  'notice.group.trialOk': '已复制群号 {id}，进群后找管理员领取 7 天试用码',
  'notice.group.trialFail': '复制失败，群号是 {id}，进群找管理员领取 7 天试用',
  'notice.group.plainOk': '已复制群号 {id}，去 QQ 搜索就能加群',
  'notice.group.plainFail': '复制失败，群号是 {id}，去 QQ 搜索加群',

  /* ── 统计页 ──────────────────────────────────────────────── */
  'stats.thisWeek': '本周',
  'stats.weeksAgo': '{n} 周前',
  'stats.noRecord': '没有记录',
  'stats.minutes': '{n} 分',
  'stats.days': '{n} 天',
  'stats.kpi.streak': '连续阅读 · 天',
  'stats.kpi.done': '已读完 · 本',
  'stats.kpi.total': '累计时长 · 小时',
  'stats.kpi.today': '今日 · 分钟',
  'stats.goal.caption': '年度目标',
  'stats.goal.progress': '{done} / {goal} 本',
  'stats.goal.reached': '目标已经达成。把数字调高一点，或者换一本难啃的。',
  'stats.goal.remaining': '今年还差 {n} 本。目标只影响这圈铜线，不影响别处的统计。',
  'stats.goal.adjust': '调整目标',
  'stats.goal.poster': '年度海报',
  'stats.checkin': '每日打卡',
  'stats.checkin.streak': '连续',
  'stats.checkin.today': '今天',
  'stats.checkin.month': '本月',
  'stats.checkin.goal': '每日目标',
  'stats.checkin.reached': '已达标 · {n} 分',
  'stats.checkin.remaining': '{n} 分，还差 {left} 分',
  'stats.checkin.monthTitle': '这个月每天的打卡',
  'stats.checkin.hint': '每天读满 {n} 分钟就算打卡。',
  'stats.checkin.doneToday': '今天已经打上了。',
  'stats.checkin.almost': '还差一点，睡前十分钟就够。',
  'stats.heat': '近 20 周',
  'stats.heat.oldest': '20 周前',
  'stats.heat.today': '今天',
  'stats.heat.hint': '格子越亮，那天读得越久。',
  'stats.heat.streak': '连续 {n} 天没有断过。',
  'stats.heat.noStreak': '还没有连续的记录。',
  'stats.weekly': '每周时长',
  'stats.weekly.today': '今日时长',
  'stats.weekly.activeDays': '有记录的天数',
  'stats.byBook': '按书时长',
  'stats.byBook.empty': '还没有阅读记录。',
  'stats.empty': '统计只统计真实的阅读会话。打开一本书读几分钟，这里就会亮起来。',
  'stats.locked': '阅读统计属于高级版。',
  'stats.lockedHint': '累计时长、热力图、每本书的进度与读完记录，解锁后都在这里。',
  'stats.locked.cta': '查看高级版功能',

  /* ── 笔记页 ──────────────────────────────────────────────── */
  'notes.pick': '选中',
  'notes.unpick': '取消选中',
  'notes.review.kick': '每 日 回 顾',
  'notes.review.title': '回来看看这条',
  'notes.review.next': '下一条 ›',
  'notes.jump': '回到原文',
  'notes.bilink': '双向链接',
  'notes.pro': '高级',
  'notes.filter.all': '全部',
  'notes.filter.comment': '有想法',
  'notes.selected': '已选 {n} 条',
  'notes.selectAll': '全选',
  'notes.selectNone': '取消全选',
  'notes.exitSelect': '退出选择',
  'notes.delete': '删除',
  'notes.deleteN': '删除 {n} 条',
  'notes.count': '{n} 条',
  'notes.exportThis': '导出这本',
  'notes.empty': '没有匹配的标注。去阅读页选中一段文字，挑一支笔。',
  'notes.search.ph': '搜划线、想法、书名',
  'notes.summary': '{n} 条 · {ideas} 条想法',
  'notes.select': '选择',
  'notes.export': '导出为 Markdown',

  /* ── 阅读页左侧栏 ────────────────────────────────────────── */
  'side.tab.toc': '目录',
  'side.tab.bookmarks': '书签',
  'side.tab.highlights': '划线',
  'side.expand': '展开',
  'side.collapse': '折叠',
  'side.toc.count': '共 {n} 节',
  'side.bookmarks.empty': '还没有书签。',
  'side.bookmarks.emptyHint': '读到的地方，点阅读栏「签」记一枚。',
  'side.bookmarks.order': '按书中先后',
  'side.delete': '删除',
  'side.highlights.empty': '还没有划线。',
  'side.highlights.emptyHint': '在正文里选中一段文字，浮出的色点里挑一支笔。',
  'side.ideaTag': '想 法',
  'side.ai.hint': '选中一段文字可以问 AI；或直接在这里问这本书。回答依据是整本书里最相关的几段，不会带上你正在看的那一屏。',
  'side.ai.notReady': '还没有配置 AI 服务。到书架 · 设置里填好服务商、模型与密钥，这里就能用了。',
  'side.ai.me': '我',
  'side.ai.ask.ph': '问这本书…',
  'side.ai.ask': '问',
  'side.ai.index.loading': '正在读取索引…',
  'side.ai.index.lead': '先给这本书建一份索引，之后提问都按全书回答。',
  'side.ai.index.build': '建立索引',
  'side.ai.index.tutorial': '观看视频教程',
  'side.ai.index.choose': '选一种建法，确认之后才开始跑。',
  'side.ai.index.running': '正在建立索引',
  'side.ai.index.done': '索引已建好，可以提问了。',
  'side.ai.index.rebuild': '重建索引',
  'side.ai.rebuild.confirm': '重建会删掉这本书现在的索引，之后要整本重算——中途停不下来，也算不回去。',
  'side.ai.scope.book': '按全书回答',
  'side.untitled': '未命名',
  'side.noBook': '没有打开的书',
  'side.empty': '左侧栏跟着阅读走。',
  'side.emptyHint': '在书架点开一本书，目录、书签与划线就会出现在这里。',
  'side.toc.notReady': '目录还没准备好。',
  'side.toc.openCurrent': '打开当前书籍',

  /* ── 划词工具条 ──────────────────────────────────────────── */
  'tool.idea': '想法',
  'ai.mode.explain': '解释',
  'ai.mode.translate': '翻译',
  'ai.mode.summarize': '摘要',
  'tool.quote': '书摘',
  'tool.ai': 'AI',
  'tool.bilink': '双链',
  'tool.copy': '复制',
  'tool.del': '删除',
  'tool.more': '更多',
  'tool.aria': '划词工具',

  /* ── 书架外壳 ────────────────────────────────────────────── */
  'shelf.tab.library': '书库',
  'shelf.tab.notes': '笔记',
  'shelf.act.search': '搜索',
  'shelf.act.stats': '统计',
  'shelf.act.import': '导入书籍',
  'shelf.act.settings': '设置',
  'shelf.back': '返回',

  /* ── 书库页 ──────────────────────────────────────────────── */
  'shelf.filter.all': '全部',
  'shelf.filter.reading': '在读',
  'shelf.filter.done': '已读',
  'shelf.filter.new': '未读',
  'shelf.filter.fav': '收藏',
  'shelf.sort.recent': '最近阅读',
  'shelf.sort.title': '书名',
  'shelf.sort.progress': '进度',
  'shelf.sort': '排序',
  'shelf.empty.all': '书库还是空的。点右上「导入」放一本 epub 进来，或把书直接拖进笔记库。',
  'shelf.empty.none': '没有匹配的书。换个关键词，或点右上「导入」放一本进来。',
  'shelf.continue': '继续阅读',
  'shelf.lastChapter': '上次读到 {chapter}',
  'shelf.lastPercent': '上次读到 {percent}%',
  'shelf.resume': '接着读 ›',
  'shelf.detail': '书籍详情',
  'shelf.search.ph': '搜索书名 / 作者 / 分类',
  'shelf.collapse': '收起',
  'shelf.view.list': '列表',
  'shelf.view.grid': '封面墙',
  'shelf.shelfline': '书架',
  'shelf.count': '{n} 本',
  'shelf.badge.done': '已读完',
  'shelf.missing': '文件失联',
  'shelf.missing.tip': '文件不在原位了，点它重新定位',
  'shelf.more': '右键 / 长按更多',

  /* ── 设置页：关于条 ──────────────────────────────────────── */
  'settings.about': '关于',
  'settings.about.version': '版本未知',
  'settings.about.paid': '高级版',
  'settings.about.base': '基础版',
  'settings.about.repo': '在浏览器里打开仓库',
  'settings.about.video': '视频教程',
  'settings.about.wip': '制作中',
  'settings.about.videoTip': '教程还在剪，做好会在交流群里通知',
  'settings.about.group': 'QQ 交流群',
  'settings.about.groupTip': '点一下复制群号，去 QQ 搜索',
  'settings.about.changelog': '更新日志',
  'settings.about.changelogTip': '看看每一版改了什么',

  /* ── 授权状态（设置页状态行、解锁弹层共用） ──────────────── */
  'tier.base': '基础版',
  'tier.paid': '高级版已激活{who} · {until}',
  'tier.who': '（{name}）',
  'tier.until': '有效期到 {date}',
  'tier.forever': '永久有效',

  /* ── 设置页：分组标题 ────────────────────────────────────── */
  'settings.grp.ui': '界面',
  'settings.grp.layout': '版式',
  'settings.grp.look': '外观',
  'settings.grp.header': '阅读页图标',
  'settings.grp.tts': '朗读',
  'settings.grp.marks': '标注',
  'settings.grp.ai': 'AI 助手',
  'settings.grp.lic': '授权',
  'settings.grp.data': '数据',
  'settings.grp.keys': '快捷键',

  /* ── 设置页：界面 ────────────────────────────────────────── */
  'settings.language': '语言',
  'settings.language.auto': '跟随 Obsidian',

  /* ── 设置页：版式 ────────────────────────────────────────── */
  'settings.font': '字体',
  'settings.fontSize': '字号',
  'settings.lineHeight': '行距',
  'settings.margin': '页边距',
  'settings.align': '对齐',
  'settings.align.justify': '两端',
  'settings.align.left': '居左',
  'settings.direction': '方向',
  'settings.direction.h': '横排',
  'settings.direction.v': '竖排',
  'settings.columns': '分栏',
  'settings.columns.1': '单栏',
  'settings.columns.2': '双栏',
  'settings.footnote': '脚注',
  'settings.footnote.popup': '上方浮窗',
  'settings.footnote.jump': '跳到章末',

  /* ── 设置页：外观 ────────────────────────────────────────── */
  'settings.accent': '强调色',

  /* ── 设置页：阅读页图标 ──────────────────────────────────── */
  'settings.header.hint': '开关控制显示 / 收起；收起的进最右侧 ⋮（Obsidian 自带的更多菜单）。移动端最多露 3 颗。',

  /* ── 设置页：朗读 ────────────────────────────────────────── */
  'settings.ttsRate': '语速',
  'settings.ttsFollow': '朗读跟随',
  'settings.ttsFollow.on': '念完续页',
  'settings.ttsFollow.off': '只念本页',
  'settings.locked': '高级版功能：点一下看看包含什么',

  /* ── 设置页：标注 ────────────────────────────────────────── */
  'settings.pen': '默认笔色',
  'settings.exportDir': '导出目录',
  'settings.pickFromList': '从文件夹清单里选',
  'settings.pick': '选择…',
  'settings.exportComments': '导出时带上想法',

  /* ── 设置页：AI ──────────────────────────────────────────── */
  'settings.ai.baseUrl': '服务商',
  'settings.ai.baseUrl.ph': '填写服务商接口地址，以 https:// 开头',
  'settings.ai.model': '模型',
  'settings.ai.model.ph': '填写你的账号可用的模型名',
  'settings.ai.key': '密钥',
  'settings.ai.key.ph': '填写 API 密钥',

  /* ── 设置页：授权 ────────────────────────────────────────── */
  'settings.lic.status': '状态',
  'settings.lic.code': '激活码',
  'settings.lic.relicense': '重新激活',
  'settings.lic.activate': '激活',
  'settings.lic.paid': '高级版',
  'settings.lic.benefits': '导出、统计、跨书搜索、AI 与多格式等',
  'settings.lic.compare': '查看功能对照',

  /* ── 解锁弹层：功能对照表 ─────────────────────────────── */
  'unlock.title': '高级版',
  'unlock.activated': '已激活',
  'unlock.col.feature': '功能',
  'unlock.col.base': '基础版',
  'unlock.col.pro': '高级版',
  'unlock.part': '部分',
  'unlock.buy': '去购买',
  'unlock.hint': '购买后拿到激活码，填在下面即可',
  'unlock.haveCode': '已有激活码',

  /* ── 设置页：数据 ────────────────────────────────────────── */
  'settings.importDir': '书籍导入位置',
  'settings.pickFolder': '选择一个文件夹',
  'settings.dataDir': '数据目录',
  'settings.backupRestore': '备份与恢复',
  'settings.backup': '备份',
  'settings.backup.tip': '导出成一份 JSON，存进数据目录',
  'settings.restore': '恢复',
  'settings.restore.tip': '从备份文件恢复（合并，不覆盖现有进度）',
  'settings.data.hint': '备份含书架、进度、标注、收藏与目标。不含激活码和 AI Key，换设备需重填。',

  /* ── 设置页：快捷键 ──────────────────────────────────────── */
  'settings.key.unset': '未设置',
  'settings.key.tip': '在 Obsidian 的快捷键设置里改',

  /* ── 快捷键行的命令名（短名；命令面板里那套带「书架：/阅读：」前缀， */
  /*    设置页一行放不下，所以另立一套短的） ──────────────────── */
  'key.pageNext': '下一页',
  'key.pagePrev': '上一页',
  'key.open': '打开书架',
  'key.search': '搜索（本书 / 全库）',
  'key.sidebar': '显示左侧栏',
  'key.focus': '专注模式',
  'key.fullscreen': '全屏',
  'key.bookmark': '记一枚书签',
  'key.typography': '排版面板',
  'key.bookmap': '全书鸟瞰',
  'key.tts': '朗读开关',
  'key.continue': '继续阅读最近一本',

  /* ── AI 知识库（2026-11-07） ─────────────────────────── */
  'bz.missing': 'bz 插件还没装：先在 Obsidian 的第三方插件里装上 bz',
  'bz.noEmbedModel': '第二大脑还没选嵌入模型：在 bz 的设置里选一个，这边才能建索引。',
  'settings.ai.kb': '连接至 BZ AI 知识库',
  'settings.ai.kb.on': '已连接',
  'settings.ai.kb.off': '未连接',
  'settings.ai.kb.hint': '在划词中添加存为名词 / 存为段落，可以为书籍建立本地向量化索引，提问时会一并参考库里的笔记。',
  'bz.disabled': 'bz 插件没有启用：到「设置 → 第三方插件」里把 bz 打开',
  'bz.outdated': 'bz 版本太旧（{version}）：更新到最新版才能用这项功能',
  'bz.callFailed': 'bz 没接住这次请求：{message}',
  'bz.noFolder': 'bz 里需要先配好文献文件夹，配好后再点一次',
  'tool.term': '存为名词',
  'tool.passage': '存为段落',
  'notice.kb.term': '已存为知识盒名词',
  'notice.kb.passage': '已存为知识盒段落',
  'notice.kb.failed': '没能写进知识盒：{message}',
  'side.ai.book.none': '这本书还没建全书画像，先建一次才能按全书回答。',
  'side.ai.embedNotReady': '向量由第二大脑提供：装上并启用 bz，在它的设置里选好嵌入模型，再来建索引。',
  'side.ai.book.noHit': '这本书里没有找到和问题相关的段落：换个问法，或重建一次全书依据。',
  'side.ai.sources': '依据',
  'side.ai.source.chapter': '本章',
  'pt.plan.vector': 'A. 向量化检索',
  'pt.plan.compress': 'B. AI 信息压缩',
  'pt.estimate.vector': '共 {blocks} 块，约 {requests} 次嵌入请求',
  'pt.estimate.compress': '共 {blocks} 块，约 {requests} 次 AI 请求',
  'pt.start': '开始',
  'pt.close': '关闭',
  'pt.pause': '暂停',
  'pt.resume': '继续',
  'pt.stop': '取消',
  'pt.block': '第 {done} / {total} 块',
  'pt.extract': '正在读书：第 {done} / {total} 章',
  'pt.retryFailed': '只重试失败块',
  'pt.failedBlocks': '{n} 块失败',
  'pt.mobile': '手机端不建画像：请在电脑上建好，建好之后手机上直接能用。',
  'detail.portrait': '全书画像',
  'detail.portrait.none': '未建',
  'detail.portrait.ready': '已建',
  'detail.portrait.building': '建到一半',
  'detail.portrait.stale': '需要重建',
  'detail.portrait.open': '建画像…',
  'pt.clean': '清理无主画像',
  'pt.clean.empty': '没有无主画像：每一份画像都还对应着书架上的书。',
  'pt.clean.confirm': '这些画像对应的书已经不在了，删掉后无法恢复：',
  'ack.title': '这会把什么发给 AI',
  'ack.body.book': '建全书依据时，整本书的正文会分块发给你自己配置的嵌入服务；提问时只发检索到的那几块，打开共享时再加上 bz 知识库的笔记片段。',
  'ack.ok': '知道了',
  'notice.note.missing': '这条笔记不在了：{path}',
  'pt.blockCount': '{n} 块',
  'pt.clean.done': '已清理 {n} 份无主画像',
  'pt.needOpen': '画像要读整本书的正文：先在阅读视图里打开这本书，再回来建',
  'side.ai.source.block': '第 {n} 块',
  'side.ai.book.stale': '这本书的画像用另一个嵌入模型建的：需要重建一次，否则检索出来的块对不上。',
} as const;

export type MsgKey = keyof typeof ZH;
