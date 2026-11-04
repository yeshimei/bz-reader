/**
 * 繁體中文文案包（src/i18n/zh-tw.ts）
 *
 * 不是简体包的字形转换产物，是**台湾用语**的一包：
 *   設定 / 預設 / 匯入 / 匯出 / 檔案 / 資料夾 / 網路 / 資訊 / 影片 / 剪貼簿。
 * 只做字形转换（设置→設置）会读起来像大陆人写的繁体，台湾用户一眼看出来。
 *
 * 与简体包的差异是**受测的**（tests/i18n-packs.test.ts 的「繁中包不是简中包的
 * 复制」）：六成以上条目必须写法不同，并禁掉简体高频字。
 */
import type { MsgKey } from './zh';

export const ZH_TW: Record<MsgKey, string> = {
  /* ── 通用詞 ──────────────────────────────────────────────── */
  'common.default': '預設',
  'common.untitled': '未命名',
  'common.unknownError': '未知錯誤',

  /* ── 外掛入口 ────────────────────────────────────────────── */
  'ribbon.shelf': 'Bz 閱讀：書架',

  /* ── 指令：書架 ──────────────────────────────────────────── */
  'cmd.open': '書架：開啟書架',
  'cmd.continue': '書架：繼續閱讀最近一本',
  'cmd.import': '書架：匯入書籍',
  'cmd.notes': '書架：筆記',
  'cmd.stats': '書架：統計',
  'cmd.prefs': '書架：設定',

  /* ── 指令：閱讀器 ────────────────────────────────────────── */
  'cmd.search': '閱讀：搜尋（本書／全庫）',
  'cmd.sidebar': '閱讀：顯示左側欄',
  'cmd.pageNext': '閱讀：下一頁',
  'cmd.pagePrev': '閱讀：上一頁',
  'cmd.focus': '閱讀：專注模式',
  'cmd.fullscreen': '閱讀：全螢幕',
  'cmd.bookmark': '閱讀：加入書籤',
  'cmd.typography': '閱讀：排版面板',
  'cmd.bookmap': '閱讀：全書鳥瞰',
  'cmd.tts': '閱讀：朗讀開關',
  'notice.needBook': '先開啟一本書再使用這個指令',
  'notice.language.changed': '介面語言已切換，指令名稱需重新啟動 Obsidian 後才會更新',

  /* ── 通知：剪貼簿 ────────────────────────────────────────── */
  'notice.copy.ok': '已複製到剪貼簿',
  'notice.copy.failed': '複製失敗，請改用系統快速鍵',

  /* ── 通知：書籤 ──────────────────────────────────────────── */
  'notice.bookmark.noCfi': '這一頁還沒有定位資訊，翻一頁再試',
  'notice.bookmark.exists': '這一頁已經有一個書籤了',
  'notice.bookmark.added': '已加入書籤',

  /* ── 通知：劃線 / 標註 ───────────────────────────────────── */
  'notice.mark.created': '已用{color}色劃線',
  'notice.mark.recolored': '換成{color}',
  'notice.mark.notFound': '找不到這條劃線',
  'notice.mark.gone': '找不到這個標註，可能已經被刪除了',
  'notice.mark.deleted': '劃線已刪除',
  'notice.mark.deletedN': '已刪除 {n} 條劃線',
  'notice.mark.goneAll': '這些標註已經不在了',
  'notice.idea.saved': '想法已儲存',
  'notice.idea.cleared': '想法已清空',

  /* ── 通知：筆記 / 匯出 ───────────────────────────────────── */
  'notice.note.saved': '已存進 {path}',
  'notice.note.saveFailed': '儲存筆記失敗：{why}',
  'notice.export.needBook': '先開啟一本書，或在筆記頁對某本書點匯出',
  'notice.export.empty': '這本書還沒有劃線或書籤，匯不出東西',
  'notice.export.done': '已匯出 {n} 條劃線到 {path}',
  'notice.export.failed': '匯出失敗：{why}',
  'export.noData': '（還沒有可匯出的資料）',
  'export.noNotes': '（還沒有劃線。去閱讀頁選取一段文字試試。）',
  'export.loose': '零散片段',

  /* ── 通知：書摘卡 ────────────────────────────────────────── */
  'notice.card.copied': '書摘卡已複製為圖片',
  'notice.card.copyFailed': '複製圖片失敗',
  'notice.quote.empty': '沒有可存的引文',

  /* ── 通知：書架動作 ──────────────────────────────────────── */
  'notice.fav.on': '已收藏',
  'notice.fav.off': '已取消收藏',
  'notice.rename.empty': '書名不能為空',
  'notice.rename.done': '書名已變更',
  'notice.book.removed': '已從書架移除《{title}》',
  'notice.select.pick': '先選幾條要刪的',
  'notice.rating.stars': '已記下 {stars} 星',
  'notice.rating.done': '已記下',
  'notice.status.reading': '已標記為在讀',
  'notice.status.done': '已標記讀完',
  'notice.ui.reset': '介面狀態已重設',
  'notice.video.wip': '影片教學還在剪，做好會在交流群裡通知',

  /* ── 通知：匯入 ──────────────────────────────────────────── */
  'notice.import.done': '已加入 {n} 本',
  'notice.import.failed': '加入書架失敗：{why}',
  'notice.import.written': '已匯入 {n} 本到 {folder}',
  'notice.import.error': '匯入失敗：{why}',
  'notice.import.partial': '有 {failed} 個檔案匯入失敗，已匯入 {ok} 個',

  /* ── 通知：搜尋 ──────────────────────────────────────────── */
  'notice.search.empty': '先輸入要搜的字',
  'notice.search.needBook': '先開啟一本書，再來搜尋正文',
  'notice.search.failed': '正文搜尋失敗：{why}',
  'notice.sel.empty': '沒有可複製的選取範圍',
  'notice.toc.missingChapter': '這一章在目錄裡找不到，可能書換了版本',

  /* ── 通知：目錄 / 資料目錄 ───────────────────────────────── */
  'notice.dir.exportRoot': '匯出目錄不能是庫根目錄，請選一個資料夾',
  'notice.dir.dataRoot': '資料目錄不能是庫根目錄，請選一個資料夾',
  'notice.migrate.running': '正在遷移…',
  'notice.goal.set': '每日目標改為 {n} 分鐘',

  /* ── 通知：備份 / 還原 ───────────────────────────────────── */
  'notice.backup.done': '已備份到「{path}」',
  'notice.backup.failed': '備份失敗：{why}',
  'notice.restore.noPick': '沒有選擇檔案',
  'notice.restore.unreadable': '讀不了這個檔案：{why}',
  'notice.restore.done': '已還原，書架現在 {n} 本',
  'notice.restore.dropped': '（有 {n} 筆記錄不完整，已跳過）',

  /* ── 通知：資料檔 ────────────────────────────────────────── */
  'notice.data.broken': '資料檔讀不出來，已留存為 bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': '資料檔讀不出來，也無法留存；本次工作階段不再儲存，避免覆蓋原檔',
  'notice.data.dropped': '有 {n} 筆書記錄缺檔案路徑，已另存為 bz-reader.dropped-*.json',
  'notice.data.loadFailed': '讀取閱讀資料失敗，本次工作階段不儲存，避免用空庫覆蓋原檔',
  'notice.data.saveFailed': '儲存閱讀資料失敗，請檢查磁碟空間',

  /* ── 通知：資料目錄 / 深層連結 ───────────────────────────── */
  'notice.dataDir.multiple': '發現多個資料目錄，無法判斷該用哪一個；請到設定裡選擇',
  'notice.dataDir.found': '資料目錄找回來了：「{dir}」',
  'notice.link.bookMissing': '連結指向的書不在書架上，可能已被移走',
  'notice.link.cfiMiss': '找不到原句，已停在書上次讀到的位置',
  'notice.noReadBook': '還沒有讀過的書',
  'notice.debug.link': '[bz 診斷] {type} · {href}',

  /* ── 通知：閱讀器 ────────────────────────────────────────── */
  'notice.compare.onlyOne': '書架上只有這一本，並排對照需要另一本書',
  'notice.compare.failed': '並排沒開啟：{why}',
  'notice.tts.noText': '這一頁沒有可朗讀的文字',
  'notice.tts.unsupported': '這個環境不支援語音朗讀',
  'notice.open.unsupported': '格式不支援',
  'fault.openFailed': '這本書打不開',
  'notice.load.stalled': '{what}沒有完成，請再試一次',
  'notice.locate.notReady': '這一頁還沒定位好，翻一下再試',
  'notice.bookmark.toggledOn': '已加書籤',
  'notice.bookmark.toggledOff': '已移除書籤',

  /* ── 通知：交流群（QQ） ──────────────────────────────────── */
  'notice.group.trialOk': '已複製群號 {id}，進群後找管理員領取 7 天試用碼',
  'notice.group.trialFail': '複製失敗，群號是 {id}，進群找管理員領取 7 天試用',
  'notice.group.plainOk': '已複製群號 {id}，到 QQ 搜尋就能加入',
  'notice.group.plainFail': '複製失敗，群號是 {id}，到 QQ 搜尋加入',
};
