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
  'notice.book.removed': '已从书架移除《{title}》',
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
} as const;

export type MsgKey = keyof typeof ZH;
