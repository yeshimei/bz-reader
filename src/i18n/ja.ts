/**
 * 日本語文案パック（src/i18n/ja.ts）
 *
 * 訳語の口径：
 *   · コマンド名は `本棚：` / `読書：` の接頭辞つき。Obsidian のホットキー画面は
 *     スペース区切りで絞り込むので、接頭辞があると一語でまとめて出せる。
 *   · 通知は完了形（「保存しました」）。進行形は使わない。
 *   · エラーは「次に何ができるか」まで書く。「失敗しました」だけで終わらせない。
 *   · 固有名詞はそのまま：bz Reader / Obsidian / GitHub / Markdown / EPUB / TXT / QQ。
 *
 * 中国語の「想法」は訳さず **メモ** にした：日本語の読書文脈で「感想」は
 * レビュー、「想法」に当たるのは「メモ」か「コメント」。UI では短い方が強い。
 */
import type { MsgKey } from './zh';

export const JA: Record<MsgKey, string> = {
  /* ── 共通語 ──────────────────────────────────────────────── */
  'common.default': '既定',
  'common.untitled': '無題',
  'common.unknownError': '不明なエラー',

  /* ── プラグイン入口 ──────────────────────────────────────── */
  'ribbon.shelf': 'bz Reader：本棚',

  /* ── コマンド：本棚 ──────────────────────────────────────── */
  'cmd.open': '本棚：本棚を開く',
  'cmd.continue': '本棚：最近読んだ本の続きを読む',
  'cmd.import': '本棚：書籍をインポート',
  'cmd.notes': '本棚：ノート',
  'cmd.stats': '本棚：統計',
  'cmd.prefs': '本棚：設定',

  /* ── コマンド：リーダー ──────────────────────────────────── */
  'cmd.search': '読書：検索（本文／ライブラリ全体）',
  'cmd.sidebar': '読書：サイドバーを表示',
  'cmd.pageNext': '読書：次のページ',
  'cmd.pagePrev': '読書：前のページ',
  'cmd.focus': '読書：集中モード',
  'cmd.fullscreen': '読書：フルスクリーン',
  'cmd.bookmark': '読書：ブックマークを追加',
  'cmd.typography': '読書：組版パネル',
  'cmd.bookmap': '読書：全体マップ',
  'cmd.tts': '読書：読み上げの切り替え',
  'notice.needBook': '先に本を開いてからこのコマンドを実行してください',
  'notice.language.changed': '表示言語を切り替えました。コマンド名は Obsidian の再起動後に反映されます',

  /* ── 通知：クリップボード ───────────────────────────────── */
  'notice.copy.ok': 'クリップボードにコピーしました',
  'notice.copy.failed': 'コピーできませんでした。OS のショートカットをお使いください',

  /* ── 通知：ブックマーク ─────────────────────────────────── */
  'notice.bookmark.noCfi': 'このページはまだ位置情報がありません。ページをめくってからもう一度お試しください',
  'notice.bookmark.exists': 'このページにはすでにブックマークがあります',
  'notice.bookmark.added': 'ブックマークを追加しました',

  /* ── 通知：ハイライト・注釈 ─────────────────────────────── */
  'notice.mark.created': '{color}色でハイライトしました',
  'notice.mark.recolored': '{color}に変更しました',
  'notice.mark.notFound': 'このハイライトは見つかりません',
  'notice.mark.gone': 'この注釈は見つかりません。削除された可能性があります',
  'notice.mark.deleted': 'ハイライトを削除しました',
  'notice.mark.deletedN': '{n} 件のハイライトを削除しました',
  'notice.mark.goneAll': 'これらの注釈はすでにありません',
  'notice.idea.saved': 'メモを保存しました',
  'notice.idea.cleared': 'メモを消去しました',

  /* ── 通知：ノート・エクスポート ─────────────────────────── */
  'notice.note.saved': '{path} に保存しました',
  'notice.note.saveFailed': 'ノートを保存できませんでした：{why}',
  'notice.export.needBook': '先に本を開くか、ノート画面で本を選んでエクスポートしてください',
  'notice.export.empty': 'この本にはハイライトもブックマークもないため、エクスポートできません',
  'notice.export.done': '{n} 件のハイライトを {path} にエクスポートしました',
  'notice.export.failed': 'エクスポートに失敗しました：{why}',
  'export.noData': '（エクスポートできるデータがまだありません）',
  'export.noNotes': '（ハイライトがまだありません。本文を選択して試してみてください。）',
  'export.loose': '断片',

  /* ── 通知：引用カード ───────────────────────────────────── */
  'notice.card.copied': '引用カードを画像としてコピーしました',
  'notice.card.copyFailed': '画像をコピーできませんでした',
  'notice.quote.empty': '保存できる引用がありません',

  /* ── 通知：本棚の操作 ───────────────────────────────────── */
  'notice.fav.on': 'お気に入りに追加しました',
  'notice.fav.off': 'お気に入りから外しました',
  'notice.rename.empty': 'タイトルを入力してください',
  'notice.rename.done': 'タイトルを変更しました',
  'notice.book.removed': '「{title}」を本棚から削除しました',
  'notice.select.pick': '削除する項目を選んでください',
  'notice.rating.stars': '星 {stars} 個で記録しました',
  'notice.rating.done': '記録しました',
  'notice.status.reading': '読書中に設定しました',
  'notice.status.done': '読了に設定しました',
  'notice.ui.reset': '表示状態をリセットしました',
  'notice.video.wip': '動画チュートリアルは編集中です。完成したら交流グループでお知らせします',

  /* ── 通知：インポート ───────────────────────────────────── */
  'notice.import.done': '{n} 冊を追加しました',
  'notice.import.failed': '本棚に追加できませんでした：{why}',
  'notice.import.written': '{n} 冊を {folder} にインポートしました',
  'notice.import.error': 'インポートに失敗しました：{why}',
  'notice.import.partial': '{failed} 件のファイルをインポートできませんでした（{ok} 件は成功）',

  /* ── 通知：検索 ─────────────────────────────────────────── */
  'notice.search.empty': '検索する文字を入力してください',
  'notice.search.needBook': '先に本を開いてから本文を検索してください',
  'notice.search.failed': '本文検索に失敗しました：{why}',
  'notice.sel.empty': 'コピーできる選択範囲がありません',
  'notice.toc.missingChapter': 'この章は目次に見つかりません。本のバージョンが変わった可能性があります',

  /* ── 通知：フォルダ ─────────────────────────────────────── */
  'notice.dir.exportRoot': 'エクスポート先に保管庫のルートは指定できません。フォルダを選んでください',
  'notice.dir.dataRoot': 'データフォルダに保管庫のルートは指定できません。フォルダを選んでください',
  'notice.migrate.running': '移動しています…',
  'notice.goal.set': '1 日の目標を {n} 分に変更しました',

  /* ── 通知：バックアップ・復元 ───────────────────────────── */
  'notice.backup.done': '「{path}」にバックアップしました',
  'notice.backup.failed': 'バックアップに失敗しました：{why}',
  'notice.restore.noPick': 'ファイルが選択されていません',
  'notice.restore.unreadable': 'このファイルを読み込めません：{why}',
  'notice.restore.done': '復元しました。本棚は {n} 冊です',
  'notice.restore.dropped': '（{n} 件の不完全な記録をスキップしました）',

  /* ── 通知：データファイル ───────────────────────────────── */
  'notice.data.broken': 'データファイルを読み込めませんでした。bz-reader.broken-*.json として退避しました',
  'notice.data.brokenUnarchived': 'データファイルを読み込めず、退避もできませんでした。元のファイルを上書きしないよう、このセッションでは保存しません',
  'notice.data.dropped': '{n} 件の書籍記録にファイルパスがありませんでした。bz-reader.dropped-*.json として別途保存しました',
  'notice.data.loadFailed': '読書データを読み込めませんでした。空のライブラリで元のファイルを上書きしないよう、このセッションでは保存しません',
  'notice.data.saveFailed': '読書データを保存できませんでした。ディスクの空き容量を確認してください',

  /* ── 通知：データフォルダ・深いリンク ───────────────────── */
  'notice.dataDir.multiple': 'データフォルダが複数見つかり、どれを使うか判断できません。設定から選んでください',
  'notice.dataDir.found': 'データフォルダを復元しました：「{dir}」',
  'notice.link.bookMissing': 'リンク先の本が本棚にありません。移動された可能性があります',
  'notice.link.cfiMiss': '該当箇所が見つかりません。この本の前回の位置に移動しました',
  'notice.noReadBook': 'まだ読んだ本がありません',
  'notice.debug.link': '[bz 診断] {type} · {href}',

  /* ── 通知：リーダー ─────────────────────────────────────── */
  'notice.compare.onlyOne': '本棚にはこの 1 冊しかありません。並べて表示するにはもう 1 冊必要です',
  'notice.compare.failed': '並べて表示を開けませんでした：{why}',
  'notice.tts.noText': 'このページに読み上げる文字がありません',
  'notice.tts.unsupported': 'この環境では読み上げに対応していません',
  'notice.open.unsupported': 'この形式には対応していません',
  'fault.openFailed': 'この本を開けません',
  'notice.load.stalled': '{what}が完了しませんでした。もう一度お試しください',
  'notice.locate.notReady': 'このページはまだ位置が決まっていません。ページをめくってからもう一度お試しください',
  'notice.bookmark.toggledOn': 'ブックマークを追加しました',
  'notice.bookmark.toggledOff': 'ブックマークを削除しました',

  /* ── 通知：交流グループ（QQ） ───────────────────────────── */
  'notice.group.trialOk': 'グループ番号 {id} をコピーしました。参加したら管理者に 7 日間の試用コードをお求めください',
  'notice.group.trialFail': 'コピーできませんでした。グループ番号は {id} です。参加して管理者に 7 日間の試用をお求めください',
  'notice.group.plainOk': 'グループ番号 {id} をコピーしました。QQ で検索して参加できます',
  'notice.group.plainFail': 'コピーできませんでした。グループ番号は {id} です。QQ で検索して参加してください',
};
