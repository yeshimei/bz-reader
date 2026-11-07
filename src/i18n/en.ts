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
 * 英文早期用 `Highlight added` 收掉，因为颜色名还没本地化。颜色名现在走
 * `data/notes.ts` 的 `colorLabel()`（八种语言一张表），所以这里补回了
 * `{color}`——占位符与中文必须一致，这是 tests/i18n-packs.test.ts 守的。
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
  'notice.mark.created': '{color} highlight added',
  'notice.mark.recolored': 'Switched to {color}',
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
  'notice.book.archived': 'Moved “{title}” off the shelf — all data kept',
  'notice.book.revived': 'Restored {n} book(s) — progress and highlights are back',
  'notice.missing.found': 'Found it: {path}',
  'notice.missing.notFound': 'No copy of this file found in the vault — pick one manually',
  'notice.missing.wrong': 'That file is not the same book (content differs)',
  'notice.missing.picked': 'Relocated to {path}',
  'notice.missing.tooBig': 'File is too large to verify — put it back in the vault, then use “Look in vault”',
  'notice.missing.noFingerprint': 'This book has no content fingerprint yet — pick the file once manually, then auto-locate works',
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
  'notice.import.skipped': '{n} book(s) already on the shelf (same file) — skipped',

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

  /* ── Licence status ─────────────────────────────────────── */
  'tier.base': 'Base',
  'tier.paid': 'Pro activated{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'valid until {date}',
  'tier.forever': 'perpetual',

  /* ── Stats page ─────────────────────────────────────────── */
  'stats.thisWeek': 'This week',
  'stats.weeksAgo': '{n} weeks ago',
  'stats.noRecord': 'No record',
  'stats.minutes': '{n} min',
  'stats.days': '{n} days',
  'stats.books': '{n} books',
  'stats.kpi.streak': 'Reading streak · days',
  'stats.kpi.done': 'Finished · books',
  'stats.kpi.total': 'Total time · hours',
  'stats.kpi.today': 'Today · minutes',
  'stats.goal.caption': 'Yearly goal',
  'stats.goal.progress': '{done} / {goal} books',
  'stats.goal.reached': 'Goal reached. Raise the number, or pick a harder book.',
  'stats.goal.remaining': '{n} books to go this year. The goal only moves this ring — nothing else changes.',
  'stats.goal.adjust': 'Adjust goal',
  'stats.goal.poster': 'Year poster',
  'stats.checkin': 'Daily check-in',
  'stats.checkin.streak': 'Streak',
  'stats.checkin.today': 'Today',
  'stats.checkin.month': 'This month',
  'stats.checkin.goal': 'Daily goal',
  'stats.checkin.reached': 'Done · {n} min',
  'stats.checkin.remaining': '{n} min, {left} min to go',
  'stats.checkin.monthTitle': 'Check-ins for each day this month',
  'stats.checkin.hint': 'Reading {n} minutes a day counts as a check-in.',
  'stats.checkin.doneToday': 'Today is already marked.',
  'stats.checkin.almost': 'Almost there — ten minutes before bed is enough.',
  'stats.heat': 'Last 20 weeks',
  'stats.heat.oldest': '20 weeks ago',
  'stats.heat.today': 'Today',
  'stats.heat.hint': 'Brighter cells are longer reads.',
  'stats.heat.streak': 'Unbroken for {n} days.',
  'stats.heat.noStreak': 'No streak yet.',
  'stats.weekly': 'Weekly time',
  'stats.weekly.today': 'Today’s time',
  'stats.weekly.activeDays': 'Days with activity',
  'stats.byBook': 'Time per book',
  'stats.byBook.empty': 'No reading recorded yet.',
  'stats.empty': 'Stats only count real reading sessions. Open a book for a few minutes and this page lights up.',
  'stats.locked': 'Reading stats are a Pro feature.',
  'stats.lockedHint': 'Total time, heatmap, per-book progress and finished books all live here once unlocked.',
  'stats.locked.cta': 'See what Pro adds',

  /* ── Notes page ─────────────────────────────────────────── */
  'notes.pick': 'Select',
  'notes.unpick': 'Deselect',
  'notes.review.kick': 'DAILY REVIEW',
  'notes.review.title': 'Look back at this one',
  'notes.review.next': 'Next ›',
  'notes.jump': 'Back to the passage',
  'notes.bilink': 'Wikilink',
  'notes.pro': 'Pro',
  'notes.filter.all': 'All',
  'notes.filter.comment': 'With notes',
  'notes.selected': '{n} selected',
  'notes.selectAll': 'Select all',
  'notes.selectNone': 'Clear selection',
  'notes.exitSelect': 'Exit selection',
  'notes.delete': 'Delete',
  'notes.deleteN': 'Delete {n}',
  'notes.count': '{n}',
  'notes.exportThis': 'Export this book',
  'notes.empty': 'No matching annotations. Select some text in the reader and pick a pen.',
  'notes.search.ph': 'Search highlights, notes, titles',
  'notes.summary': '{n} items · {ideas} with notes',
  'notes.select': 'Select',
  'notes.export': 'Export as Markdown',

  /* ── Reader sidebar ─────────────────────────────────────── */
  'side.tab.toc': 'Contents',
  'side.tab.bookmarks': 'Bookmarks',
  'side.tab.highlights': 'Highlights',
  'side.expand': 'Expand',
  'side.collapse': 'Collapse',
  'side.toc.count': '{n} sections',
  'side.bookmarks.empty': 'No bookmarks yet.',
  'side.bookmarks.emptyHint': 'Wherever you stop, click “Bookmark” on the reader bar to drop one.',
  'side.bookmarks.order': 'In book order',
  'side.delete': 'Delete',
  'side.highlights.empty': 'No highlights yet.',
  'side.highlights.emptyHint': 'Select some text in the book, then pick a pen from the colours that pop up.',
  'side.ideaTag': 'Note',
  'side.ai.hint':
    'Select a passage and tap the AI button in the selection toolbar, or just ask a question about this book. Answers only draw on what you have read so far.',
  'side.ai.notReady':
    'No AI service is configured. Fill in provider, model and key under Shelf · Settings and this pane comes alive.',
  'side.ai.me': 'Me',
  'side.ai.ask.ph': 'Ask about this book…',
  'side.ai.notReady.ph': 'AI not configured',
  'side.ai.ask': 'Ask',
  'side.ai.scope': 'Only up to your position · {provider}',
  'side.ai.configHint': 'Configure under Shelf · Settings',
  'side.untitled': 'Untitled',
  'side.noBook': 'No book open',
  'side.empty': 'This pane follows your reading.',
  'side.emptyHint': 'Open a book from the shelf and its contents, bookmarks and highlights appear here.',
  'side.toc.notReady': 'The contents are not ready yet.',
  'side.toc.openCurrent': 'Open this book',

  /* ── Selection toolbar ──────────────────────────────────── */
  'tool.idea': 'Note',
  'tool.quote': 'Quote',
  'tool.ai': 'AI',
  'tool.bilink': 'Link',
  'tool.copy': 'Copy',
  'tool.del': 'Delete',
  'tool.more': 'More',
  'tool.aria': 'Selection tools',

  /* ── Shelf shell ────────────────────────────────────────── */
  'shelf.tab.library': 'Library',
  'shelf.tab.notes': 'Notes',
  'shelf.act.search': 'Search',
  'shelf.act.stats': 'Stats',
  'shelf.act.import': 'Import books',
  'shelf.act.settings': 'Settings',
  'shelf.back': 'Back',

  /* ── Library page ───────────────────────────────────────── */
  'shelf.filter.all': 'All',
  'shelf.filter.reading': 'Reading',
  'shelf.filter.done': 'Finished',
  'shelf.filter.new': 'Unread',
  'shelf.filter.fav': 'Favorites',
  'shelf.sort.recent': 'Recent',
  'shelf.sort.title': 'Title',
  'shelf.sort.progress': 'Progress',
  'shelf.sort': 'Sort',
  'shelf.empty.all':
    'The shelf is empty. Use “Import books” at the top right to add an EPUB, or drop a book straight into your vault.',
  'shelf.empty.none': 'No book matches. Try another keyword, or add one with “Import books”.',
  'shelf.continue': 'Continue reading',
  'shelf.lastChapter': 'Last at {chapter}',
  'shelf.lastPercent': 'Last at {percent}%',
  'shelf.resume': 'Resume ›',
  'shelf.detail': 'Book details',
  'shelf.search.ph': 'Search title / author / shelf',
  'shelf.collapse': 'Collapse',
  'shelf.view.list': 'List',
  'shelf.view.grid': 'Covers',
  'shelf.shelfline': 'Shelves',
  'shelf.count': '{n} books',
  'shelf.badge.done': 'Finished',
  'shelf.missing': 'File missing',
  'shelf.missing.tip': 'The file is no longer where it was — click to relocate',
  'shelf.more': 'Right-click or long-press for more',

  /* ── Settings: about bar ────────────────────────────────── */
  'settings.about': 'About',
  'settings.about.version': 'Unknown version',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Base',
  'settings.about.repo': 'Open the repository in your browser',
  'settings.about.video': 'Video tutorial',
  'settings.about.wip': 'In the works',
  'settings.about.videoTip': 'The tutorial is still being edited — we will announce it in the group',
  'settings.about.group': 'Community group',
  'settings.about.groupTip': 'Click to copy the group number, then search for it in QQ',
  'settings.about.changelog': 'Changelog',
  'settings.about.changelogTip': 'See what changed in each release',

  /* ── Settings: group headings ───────────────────────────── */
  'settings.grp.ui': 'Interface',
  'settings.grp.layout': 'Layout',
  'settings.grp.look': 'Appearance',
  'settings.grp.header': 'Reader toolbar',
  'settings.grp.tts': 'Read aloud',
  'settings.grp.marks': 'Highlights',
  'settings.grp.ai': 'AI assistant',
  'settings.grp.lic': 'License',
  'settings.grp.data': 'Data',
  'settings.grp.keys': 'Hotkeys',

  /* ── Settings: interface ────────────────────────────────── */
  'settings.language': 'Language',
  'settings.language.auto': 'Follow Obsidian',
  'settings.language.hint':
    'With “Follow Obsidian” the host language decides. Picking one applies to the interface immediately; command names update after restarting Obsidian.',

  /* ── Settings: layout ───────────────────────────────────── */
  'settings.font': 'Font',
  'settings.fontSize': 'Size',
  'settings.lineHeight': 'Line height',
  'settings.margin': 'Margins',
  'settings.align': 'Alignment',
  'settings.align.justify': 'Justified',
  'settings.align.left': 'Left',
  'settings.direction': 'Direction',
  'settings.direction.h': 'Horizontal',
  'settings.direction.v': 'Vertical',
  'settings.columns': 'Columns',
  'settings.columns.1': 'One',
  'settings.columns.2': 'Two',
  'settings.footnote': 'Footnotes',
  'settings.footnote.popup': 'Popup above',
  'settings.footnote.jump': 'Jump to chapter end',

  /* ── Settings: appearance ───────────────────────────────── */
  'settings.accent': 'Accent',

  /* ── Settings: reader toolbar ───────────────────────────── */
  'settings.header.hint':
    'Toggle what appears; hidden icons move into the ⋮ menu on the right. Mobile shows at most 3.',

  /* ── Settings: read aloud ───────────────────────────────── */
  'settings.ttsRate': 'Speed',
  'settings.ttsFollow': 'After this page',
  'settings.ttsFollow.on': 'Keep reading',
  'settings.ttsFollow.off': 'Stop at the end',
  'settings.locked': 'Pro feature — click to see what it includes',

  /* ── Settings: highlights ───────────────────────────────── */
  'settings.pen': 'Default colour',
  'settings.exportDir': 'Export folder',
  'settings.pickFromList': 'Pick from the folder list',
  'settings.pick': 'Choose…',
  'settings.exportComments': 'Include notes in exports',
  'settings.quoteLink': 'Excerpt link',
  'settings.quoteLink.hint':
    'Copies as a wikilink [[book#location]] — paste it into a note and click to jump back to the passage; it also shows up in the backlinks pane.',

  /* ── Settings: AI ───────────────────────────────────────── */
  'settings.ai.baseUrl': 'Provider',
  'settings.ai.baseUrl.ph': 'Endpoint URL, starting with https://',
  'settings.ai.model': 'Model',
  'settings.ai.model.ph': 'A model name your account can use',
  'settings.ai.key': 'Key',
  'settings.ai.key.ph': 'API key',

  /* ── Settings: license ──────────────────────────────────── */
  'settings.lic.status': 'Status',
  'settings.lic.code': 'License code',
  'settings.lic.relicense': 'Re-activate',
  'settings.lic.activate': 'Activate',
  'settings.lic.paid': 'Pro',
  'settings.lic.benefits': 'Export, stats, cross-book search, more formats',
  'settings.lic.compare': 'Compare features',

  /* ── Settings: data ─────────────────────────────────────── */
  'settings.importDir': 'Import books into',
  'settings.pickFolder': 'Pick a folder',
  'settings.dataDir': 'Data folder',
  'settings.backupRestore': 'Backup & restore',
  'settings.backup': 'Back up',
  'settings.backup.tip': 'Write a single JSON file into the data folder',
  'settings.restore': 'Restore',
  'settings.restore.tip': 'Restore from a backup file (merges; current progress is never overwritten)',
  'settings.data.hint':
    'A backup holds the shelf, progress, highlights, favourites and goals. It does not include your license code or AI key — re-enter those on a new device.',

  /* ── Settings: hotkeys ──────────────────────────────────── */
  'settings.key.unset': 'Not set',
  'settings.key.tip': 'Change this in Obsidian’s hotkey settings',

  /* ── Short command names for the hotkey rows ────────────── */
  'key.pageNext': 'Next page',
  'key.pagePrev': 'Previous page',
  'key.open': 'Open shelf',
  'key.search': 'Search (book / library)',
  'key.sidebar': 'Show sidebar',
  'key.focus': 'Focus mode',
  'key.fullscreen': 'Fullscreen',
  'key.bookmark': 'Add bookmark',
  'key.typography': 'Typography',
  'key.bookmap': 'Book overview',
  'key.tts': 'Toggle read aloud',
  'key.continue': 'Continue last book',

  /* ── AI 知识库 / 全书画像（2026-11-07） ─────────────────── */
  'bz.missing': 'bz isn\'t installed yet — install it from Obsidian\'s community plugins first',
  'bz.disabled': 'bz is installed but turned off — enable it in Settings → Community plugins',
  'bz.outdated': 'Your bz version ({version}) is too old — update it to use this',
  'bz.callFailed': 'bz didn\'t take the request: {message}',
  'bz.noFolder': 'Set up the literature folder in bz first, then try again',
  'settings.ai.knowledge': 'AI knowledge base',
  'settings.ai.knowledge.hint': 'When on: the selection bar gains save-as-term / save-as-passage, and the sidebar AI can use your bz knowledge base and whole books.',
  'tool.term': 'Term',
  'tool.passage': 'Passage',
  'notice.kb.term': 'Saved to the knowledge box as a term',
  'notice.kb.passage': 'Saved to the knowledge box as a passage',
  'notice.kb.failed': 'Couldn\'t write to the knowledge box: {message}',
  'side.ai.scope.screen': 'This screen',
  'side.ai.scope.brain': 'Knowledge base',
  'side.ai.scope.book': 'Whole book',
  'side.ai.scope.aria': 'Answer scope',
  'side.ai.brain.notReady': 'bz\'s index isn\'t built yet — build it in bz\'s second brain. Answering from this screen for now.',
  'side.ai.brain.noHit': 'Nothing relevant in your knowledge base — answering from this screen for now.',
  'side.ai.book.none': 'This book has no portrait yet — build one to answer from the whole book.',
  'side.ai.sources': 'Sources',
  'side.ai.source.chapter': 'Chapter',
  'pt.title': 'Whole-book Q&A setup',
  'pt.plan.vector': 'A. Vector search',
  'pt.plan.compress': 'B. AI compression',
  'pt.how': 'How',
  'pt.good': 'Upside',
  'pt.cost': 'Cost',
  'pt.fit': 'Best for',
  'pt.vector.how': 'Turns the book into vectors block by block and retrieves the most relevant blocks per question.',
  'pt.vector.good': 'Cheap (only embedding cost), fast, and answers point to specific chapters.',
  'pt.vector.cost': 'Only sees the retrieved fragments, so big-picture questions drift; bz\'s embedding service must be running.',
  'pt.vector.fit': 'Questions like "where does the book discuss this?" or "what does this line mean?".',
  'pt.compress.how': 'Sends the book to the AI block by block and compresses it; every question carries the whole digest.',
  'pt.compress.good': 'A global view: it can answer what the book is about and what the author\'s core claim is.',
  'pt.compress.cost': 'Many LLM calls (billed to your own key), slow, and details get squeezed out.',
  'pt.compress.fit': 'Overviews such as "summarise the whole book" or "what is it about?".',
  'pt.estimate.vector': '{blocks} blocks, about {requests} embedding calls',
  'pt.estimate.compress': '{blocks} blocks, about {requests} AI calls',
  'pt.start': 'Start',
  'pt.close': 'Close',
  'pt.rebuild': 'Rebuild',
  'pt.pause': 'Pause',
  'pt.resume': 'Resume',
  'pt.stop': 'Cancel',
  'pt.ask': 'Start asking',
  'pt.saveNote': 'Save as note',
  'pt.block': 'Block {done} / {total}',
  'pt.extract': 'Reading the book: chapter {done} / {total}',
  'pt.done': 'Portrait ready',
  'pt.meta': '{blocks} blocks · {time} · {failed} failed · {model}',
  'pt.retryFailed': 'Retry failed blocks only',
  'pt.failedBlocks': '{n} blocks failed',
  'pt.mobile': 'Portraits are built on desktop only — build it there and it works on mobile.',
  'pt.choose': 'Pick one of the two plans; nothing runs until you confirm.',
  'pt.overviewLabel': 'Book overview',
  'detail.portrait': 'Book portrait',
  'detail.portrait.none': 'not built',
  'detail.portrait.ready': 'ready',
  'detail.portrait.building': 'half built',
  'detail.portrait.stale': 'needs rebuild',
  'detail.portrait.open': 'Build portrait…',
  'pt.clean': 'Clean orphan portraits',
  'pt.clean.empty': 'No orphan portraits — every portrait still matches a book.',
  'pt.clean.confirm': 'These portraits no longer match any book. Deleting is permanent:',
  'bookmap.digestLabel': 'In one line',
  'ack.title': 'What gets sent to the AI',
  'ack.body.brain': 'Your question and the retrieved note excerpts go to the AI endpoint you configured (billed to your key).',
  'ack.body.book': 'While building, the whole book is sent block by block to the AI / embedding service; later questions send only the relevant blocks.',
  'ack.ok': 'Got it',
  'notice.kb.off': 'The AI knowledge base is off — turn on “AI knowledge base” in Settings → AI assistant to use these two buttons',
  'notice.note.missing': 'That note isn\'t there anymore: {path}',
  'pt.blockCount': '{n} blocks',
  'pt.clean.done': 'Removed {n} orphan portrait(s)',
  'pt.needOpen': 'A portrait reads the whole book — open it in the reader first, then come back',
  'side.ai.source.block': 'Block {n}',
  'side.ai.book.stale': 'This portrait was built with a different embedding model — rebuild it, or the retrieved blocks won\'t line up.',
  'side.ai.book.cancelled': 'No portrait built — answering from this screen for now.',
};
