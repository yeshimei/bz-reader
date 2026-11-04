/**
 * 英文文案包（src/i18n/en.ts）
 *
 * 类型是 `Record<MsgKey, string>`：中文包加了 key 而这里没跟上，
 * `tsc --noEmit` 就会红，不需要额外的 lint。
 *
 * 翻译口径（和中文那几行的注释对着看）：
 *   · 命令名用 `<域>: <动作>` 的短句，Obsidian 的快捷键面板按空格分词搜索，
 *     `Shelf: Open shelf` 能靠 `shelf` 一次过滤出全部书架命令
 *   · 通知用完成态（`Added 3 books`），不用进行时
 *   · 报错保留「还能做什么」那一半，别只翻「failed」
 *   · 专有名词照抄，不翻译：bz Reader、Obsidian、GitHub、Markdown、EPUB、TXT
 *
 * 有几条**故意不逐字对应**中文：中文的「已用琥珀色划线」要带颜色名，
 * 英文用 `Highlight added` 收掉，因为 `琥珀` 这类色名还没进语言包，
 * 硬拼出来就是中英混排。等颜色名也走 t() 之后再补回来。
 */

import type { MsgKey } from './zh';

export const EN: Record<MsgKey, string> = {
  /* ── Shared words ───────────────────────────────────────── */
  'common.default': 'default',
  'common.untitled': 'Untitled',
  'common.unknownError': 'Unknown error',

  /* ── Entry ───────────────────────────────────────────────── */
  'ribbon.shelf': 'bz Reader: shelf',

  /* ── Commands: shelf ────────────────────────────────────── */
  'cmd.open': 'Shelf: Open shelf',
  'cmd.continue': 'Shelf: Continue reading',
  'cmd.import': 'Shelf: Import books',
  'cmd.notes': 'Shelf: Notes',
  'cmd.stats': 'Shelf: Stats',
  'cmd.prefs': 'Shelf: Settings',

  /* ── Commands: reader ───────────────────────────────────── */
  'cmd.search': 'Reader: Search (book / library)',
  'cmd.sidebar': 'Reader: Show sidebar',
  'cmd.pageNext': 'Reader: Next page',
  'cmd.pagePrev': 'Reader: Previous page',
  'cmd.focus': 'Reader: Focus mode',
  'cmd.fullscreen': 'Reader: Fullscreen',
  'cmd.bookmark': 'Reader: Add bookmark',
  'cmd.typography': 'Reader: Typography',
  'cmd.bookmap': 'Reader: Book overview',
  'cmd.tts': 'Reader: Toggle read aloud',
  'notice.needBook': 'Open a book first, then run this command',
  'notice.language.changed': 'Interface language changed — command names update after restarting Obsidian',

  /* ── Notices: clipboard ─────────────────────────────────── */
  'notice.copy.ok': 'Copied to clipboard',
  'notice.copy.failed': 'Copy failed — use the system shortcut instead',

  /* ── Notices: bookmarks ─────────────────────────────────── */
  'notice.bookmark.noCfi': 'This page has no position yet — turn a page and try again',
  'notice.bookmark.exists': 'This page already has a bookmark',
  'notice.bookmark.added': 'Bookmark added',

  /* ── Notices: highlights & annotations ──────────────────── */
  'notice.mark.created': 'Highlight added',
  'notice.mark.recolored': 'Color changed',
  'notice.mark.notFound': 'Highlight not found',
  'notice.mark.gone': 'That annotation is gone — it may have been deleted',
  'notice.mark.deleted': 'Highlight deleted',
  'notice.mark.deletedN': 'Deleted {n} highlight(s)',
  'notice.mark.goneAll': 'Those annotations are already gone',
  'notice.idea.saved': 'Note saved',
  'notice.idea.cleared': 'Note cleared',

  /* ── Notices: notes & export ────────────────────────────── */
  'notice.note.saved': 'Saved to {path}',
  'notice.note.saveFailed': 'Could not save the note: {why}',
  'notice.export.needBook': 'Open a book first, or export from a book in the notes tab',
  'notice.export.empty': 'Nothing to export — this book has no highlights or bookmarks',
  'notice.export.done': 'Exported {n} highlight(s) to {path}',
  'notice.export.failed': 'Export failed: {why}',
  'export.noData': '(Nothing to export yet)',
  'export.noNotes': '(No highlights yet. Select some text in the reader to start.)',
  'export.loose': 'Scraps',

  /* ── Notices: quote card ────────────────────────────────── */
  'notice.card.copied': 'Quote card copied as an image',
  'notice.card.copyFailed': 'Could not copy the image',
  'notice.quote.empty': 'No quotation to save',

  /* ── Notices: shelf actions ─────────────────────────────── */
  'notice.fav.on': 'Added to favourites',
  'notice.fav.off': 'Removed from favourites',
  'notice.rename.empty': 'A title is required',
  'notice.rename.done': 'Title updated',
  'notice.book.removed': 'Removed “{title}” from the shelf',
  'notice.select.pick': 'Select a few to delete first',
  'notice.rating.stars': 'Rated {stars} stars',
  'notice.rating.done': 'Rating saved',
  'notice.status.reading': 'Marked as reading',
  'notice.status.done': 'Marked as finished',
  'notice.ui.reset': 'UI state reset',
  'notice.video.wip': 'The video tutorial is still in the edit — we will announce it in the group',

  /* ── Notices: import ────────────────────────────────────── */
  'notice.import.done': 'Added {n} book(s) to the shelf',
  'notice.import.failed': 'Could not add to shelf: {why}',
  'notice.import.written': 'Imported {n} book(s) to {folder}',
  'notice.import.error': 'Import failed: {why}',
  'notice.import.partial': '{failed} file(s) failed to import, {ok} imported',

  /* ── Notices: search ────────────────────────────────────── */
  'notice.search.empty': 'Type something to search for',
  'notice.search.needBook': 'Open a book first, then search inside it',
  'notice.search.failed': 'Search failed: {why}',
  'notice.sel.empty': 'Nothing selected to copy',
  'notice.toc.missingChapter': 'This chapter is no longer in the contents — the file may have changed',

  /* ── Notices: folders ───────────────────────────────────── */
  'notice.dir.exportRoot': 'The export folder cannot be the vault root — pick a subfolder',
  'notice.dir.dataRoot': 'The data folder cannot be the vault root — pick a subfolder',
  'notice.migrate.running': 'Moving files…',
  'notice.goal.set': 'Daily goal set to {n} minutes',

  /* ── Notices: backup & restore ──────────────────────────── */
  'notice.backup.done': 'Backed up to “{path}”',
  'notice.backup.failed': 'Backup failed: {why}',
  'notice.restore.noPick': 'No file selected',
  'notice.restore.unreadable': 'Could not read that file: {why}',
  'notice.restore.done': 'Restored — the shelf now has {n} book(s)',
  'notice.restore.dropped': ' ({n} incomplete record(s) skipped)',

  /* ── Notices: data file ─────────────────────────────────── */
  'notice.data.broken': 'Could not read the data file; a copy was kept as bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': 'Could not read the data file, and could not keep a copy; nothing will be saved this session so the original is not overwritten',
  'notice.data.dropped': '{n} book record(s) had no file path; a copy was kept as bz-reader.dropped-*.json',
  'notice.data.loadFailed': 'Could not load reading data; nothing will be saved this session so an empty library does not overwrite the original',
  'notice.data.saveFailed': 'Could not save reading data — check free disk space',

  /* ── Notices: data folder & deep links ──────────────────── */
  'notice.dataDir.multiple': 'Several data folders were found and it is unclear which to use; pick one in Settings',
  'notice.dataDir.found': 'Data folder recovered: “{dir}”',
  'notice.link.bookMissing': 'The linked book is not on the shelf — it may have been moved',
  'notice.link.cfiMiss': 'Could not find that passage; stopped at where you last were in this book',
  'notice.noReadBook': 'No book has been read yet',
  'notice.debug.link': '[bz debug] {type} · {href}',

  /* ── Notices: reader ────────────────────────────────────── */
  'notice.compare.onlyOne': 'Only one book on the shelf — side-by-side needs a second book',
  'notice.compare.failed': 'Could not open side-by-side: {why}',
  'notice.tts.noText': 'Nothing on this page to read aloud',
  'notice.tts.unsupported': 'Read aloud is not supported in this environment',
  'notice.open.unsupported': 'Unsupported format',
  'fault.openFailed': 'Could not open this book',
  'notice.load.stalled': '{what} did not finish — please try again',
  'notice.locate.notReady': 'This page is not located yet — turn a page and try again',
  'notice.bookmark.toggledOn': 'Bookmark added',
  'notice.bookmark.toggledOff': 'Bookmark removed',

  /* ── Notices: community group (QQ) ──────────────────────── */
  'notice.group.trialOk': 'Copied group {id} — join and ask an admin for a 7-day trial code',
  'notice.group.trialFail': 'Copy failed. Group is {id} — join and ask an admin for a 7-day trial',
  'notice.group.plainOk': 'Copied group {id} — search for it in QQ to join',
  'notice.group.plainFail': 'Copy failed. Group is {id} — search for it in QQ to join',
};
