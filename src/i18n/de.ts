/**
 * Deutsche Texte (src/i18n/de.ts)
 *
 * Sprachliche Festlegungen:
 *   · Befehlsnamen mit Domänenpräfix (`Regal:` / `Lesen:`) — die Befehlspalette
 *     von Obsidian filtert über Leerzeichen getrennte Wörter, so findet man mit
 *     einem Wort alle Befehle einer Domäne.
 *   · Hinweise im Perfekt („Markierung hinzugefügt"), nicht im Präsens.
 *   · Fehler nennen den nächsten Schritt; „fehlgeschlagen" allein hilft niemandem.
 *   · Eigennamen bleiben stehen: bz Reader, Obsidian, GitHub, Markdown, EPUB, TXT, QQ.
 *
 * Deutsche Komposita sind lang. Wo eine Übersetzung das Layout sprengt, wurde die
 * kürzere Formulierung gewählt (z. B. „Regal" statt „Bücherregal").
 */
import type { MsgKey } from './zh';

export const DE: Record<MsgKey, string> = {
  /* ── Gemeinsame Wörter ──────────────────────────────────── */
  'common.default': 'Standard',
  'common.untitled': 'Ohne Titel',
  'common.unknownError': 'Unbekannter Fehler',

  /* ── Einstieg ───────────────────────────────────────────── */
  'ribbon.shelf': 'bz Reader: Regal',

  /* ── Befehle: Regal ─────────────────────────────────────── */
  'cmd.open': 'Regal: Regal öffnen',
  'cmd.continue': 'Regal: Zuletzt Gelesenes fortsetzen',
  'cmd.import': 'Regal: Bücher importieren',
  'cmd.notes': 'Regal: Notizen',
  'cmd.stats': 'Regal: Statistik',
  'cmd.prefs': 'Regal: Einstellungen',

  /* ── Befehle: Leseansicht ───────────────────────────────── */
  'cmd.search': 'Lesen: Suche (Buch / Bibliothek)',
  'cmd.sidebar': 'Lesen: Seitenleiste anzeigen',
  'cmd.pageNext': 'Lesen: Nächste Seite',
  'cmd.pagePrev': 'Lesen: Vorherige Seite',
  'cmd.focus': 'Lesen: Fokusmodus',
  'cmd.fullscreen': 'Lesen: Vollbild',
  'cmd.bookmark': 'Lesen: Lesezeichen setzen',
  'cmd.typography': 'Lesen: Typografie',
  'cmd.bookmap': 'Lesen: Buchübersicht',
  'cmd.tts': 'Lesen: Vorlesen umschalten',
  'notice.needBook': 'Öffne zuerst ein Buch und führe den Befehl dann erneut aus',
  'notice.language.changed': 'Sprache geändert – Befehlsnamen werden erst nach einem Neustart von Obsidian aktualisiert',

  /* ── Hinweise: Zwischenablage ───────────────────────────── */
  'notice.copy.ok': 'In die Zwischenablage kopiert',
  'notice.copy.failed': 'Kopieren fehlgeschlagen – bitte die Systemtastenkombination verwenden',

  /* ── Hinweise: Lesezeichen ──────────────────────────────── */
  'notice.bookmark.noCfi': 'Diese Seite hat noch keine Position – blättere weiter und versuche es erneut',
  'notice.bookmark.exists': 'Diese Seite hat bereits ein Lesezeichen',
  'notice.bookmark.added': 'Lesezeichen gesetzt',

  /* ── Hinweise: Markierungen und Anmerkungen ─────────────── */
  'notice.mark.created': 'Markierung in {color} hinzugefügt',
  'notice.mark.recolored': 'Farbe geändert: {color}',
  'notice.mark.notFound': 'Markierung nicht gefunden',
  'notice.mark.gone': 'Diese Anmerkung ist nicht mehr vorhanden – vermutlich gelöscht',
  'notice.mark.deleted': 'Markierung gelöscht',
  'notice.mark.deletedN': '{n} Markierung(en) gelöscht',
  'notice.mark.goneAll': 'Diese Anmerkungen sind nicht mehr vorhanden',
  'notice.idea.saved': 'Notiz gespeichert',
  'notice.idea.cleared': 'Notiz geleert',

  /* ── Hinweise: Notizen und Export ───────────────────────── */
  'notice.note.saved': 'Gespeichert unter {path}',
  'notice.note.saveFailed': 'Notiz konnte nicht gespeichert werden: {why}',
  'notice.export.needBook': 'Öffne zuerst ein Buch oder exportiere im Notizen-Tab aus einem Buch',
  'notice.export.empty': 'Nichts zu exportieren – dieses Buch hat keine Markierungen oder Lesezeichen',
  'notice.export.done': '{n} Markierung(en) nach {path} exportiert',
  'notice.export.failed': 'Export fehlgeschlagen: {why}',
  'export.noData': '(Noch nichts zu exportieren)',
  'export.noNotes': '(Noch keine Markierungen. Markiere in der Leseansicht etwas Text.)',
  'export.loose': 'Einzelfunde',

  /* ── Hinweise: Zitatkarte ───────────────────────────────── */
  'notice.card.copied': 'Zitatkarte als Bild kopiert',
  'notice.card.copyFailed': 'Bild konnte nicht kopiert werden',
  'notice.quote.empty': 'Kein Zitat zum Speichern',

  /* ── Hinweise: Regalaktionen ────────────────────────────── */
  'notice.fav.on': 'Zu Favoriten hinzugefügt',
  'notice.fav.off': 'Aus Favoriten entfernt',
  'notice.rename.empty': 'Ein Titel ist erforderlich',
  'notice.rename.done': 'Titel geändert',
  'notice.book.removed': '„{title}“ aus dem Regal entfernt',
  'notice.select.pick': 'Wähle zuerst einige zum Löschen aus',
  'notice.rating.stars': '{stars} Sterne gespeichert',
  'notice.rating.done': 'Bewertung gespeichert',
  'notice.status.reading': 'Als „am Lesen" markiert',
  'notice.status.done': 'Als „gelesen" markiert',
  'notice.ui.reset': 'Oberfläche zurückgesetzt',
  'notice.video.wip': 'Das Video-Tutorial wird noch geschnitten – wir kündigen es in der Gruppe an',

  /* ── Hinweise: Import ───────────────────────────────────── */
  'notice.import.done': '{n} Buch/Bücher hinzugefügt',
  'notice.import.failed': 'Hinzufügen zum Regal fehlgeschlagen: {why}',
  'notice.import.written': '{n} Buch/Bücher nach {folder} importiert',
  'notice.import.error': 'Import fehlgeschlagen: {why}',
  'notice.import.partial': '{failed} Datei(en) nicht importiert, {ok} übernommen',

  /* ── Hinweise: Suche ────────────────────────────────────── */
  'notice.search.empty': 'Gib etwas zum Suchen ein',
  'notice.search.needBook': 'Öffne zuerst ein Buch und suche dann darin',
  'notice.search.failed': 'Textsuche fehlgeschlagen: {why}',
  'notice.sel.empty': 'Nichts zum Kopieren ausgewählt',
  'notice.toc.missingChapter': 'Dieses Kapitel steht nicht mehr im Inhaltsverzeichnis – die Datei wurde vermutlich geändert',

  /* ── Hinweise: Ordner ───────────────────────────────────── */
  'notice.dir.exportRoot': 'Der Exportordner darf nicht das Vault-Stammverzeichnis sein – bitte einen Unterordner wählen',
  'notice.dir.dataRoot': 'Der Datenordner darf nicht das Vault-Stammverzeichnis sein – bitte einen Unterordner wählen',
  'notice.migrate.running': 'Dateien werden verschoben …',
  'notice.goal.set': 'Tagesziel auf {n} Minuten gesetzt',

  /* ── Hinweise: Sicherung und Wiederherstellung ──────────── */
  'notice.backup.done': 'Sicherung erstellt unter „{path}“',
  'notice.backup.failed': 'Sicherung fehlgeschlagen: {why}',
  'notice.restore.noPick': 'Keine Datei ausgewählt',
  'notice.restore.unreadable': 'Diese Datei konnte nicht gelesen werden: {why}',
  'notice.restore.done': 'Wiederhergestellt – das Regal enthält jetzt {n} Buch/Bücher',
  'notice.restore.dropped': ' ({n} unvollständige Datensätze übersprungen)',

  /* ── Hinweise: Datendatei ───────────────────────────────── */
  'notice.data.broken': 'Datendatei nicht lesbar; eine Kopie wurde als bz-reader.broken-*.json aufbewahrt',
  'notice.data.brokenUnarchived': 'Datendatei nicht lesbar und keine Kopie möglich; in dieser Sitzung wird nichts gespeichert, damit die Originaldatei nicht überschrieben wird',
  'notice.data.dropped': '{n} Buchdatensatz/-datensätze ohne Dateipfad; eine Kopie wurde als bz-reader.dropped-*.json aufbewahrt',
  'notice.data.loadFailed': 'Lesedaten konnten nicht geladen werden; in dieser Sitzung wird nichts gespeichert, damit eine leere Bibliothek die Originaldatei nicht überschreibt',
  'notice.data.saveFailed': 'Lesedaten konnten nicht gespeichert werden – bitte freien Speicherplatz prüfen',

  /* ── Hinweise: Datenordner und Deep Links ───────────────── */
  'notice.dataDir.multiple': 'Mehrere Datenordner gefunden, unklar welcher gilt; bitte in den Einstellungen einen auswählen',
  'notice.dataDir.found': 'Datenordner wiedergefunden: „{dir}“',
  'notice.link.bookMissing': 'Das verlinkte Buch ist nicht im Regal – es wurde vermutlich verschoben',
  'notice.link.cfiMiss': 'Diese Stelle wurde nicht gefunden; an der letzten Leseposition in diesem Buch angehalten',
  'notice.noReadBook': 'Noch kein Buch gelesen',
  'notice.debug.link': '[bz Diagnose] {type} · {href}',

  /* ── Hinweise: Leseansicht ──────────────────────────────── */
  'notice.compare.onlyOne': 'Nur ein Buch im Regal – für die Nebeneinander-Ansicht wird ein zweites benötigt',
  'notice.compare.failed': 'Nebeneinander-Ansicht konnte nicht geöffnet werden: {why}',
  'notice.tts.noText': 'Auf dieser Seite gibt es keinen Text zum Vorlesen',
  'notice.tts.unsupported': 'Vorlesen wird in dieser Umgebung nicht unterstützt',
  'notice.open.unsupported': 'Format wird nicht unterstützt',
  'fault.openFailed': 'Dieses Buch lässt sich nicht öffnen',
  'notice.load.stalled': '{what} wurde nicht abgeschlossen – bitte erneut versuchen',
  'notice.locate.notReady': 'Diese Seite ist noch nicht verortet – blättere weiter und versuche es erneut',
  'notice.bookmark.toggledOn': 'Lesezeichen gesetzt',
  'notice.bookmark.toggledOff': 'Lesezeichen entfernt',

  /* ── Hinweise: Gruppe (QQ) ──────────────────────────────── */
  'notice.group.trialOk': 'Gruppennummer {id} kopiert – tritt bei und frage einen Admin nach einem 7-Tage-Testcode',
  'notice.group.trialFail': 'Kopieren fehlgeschlagen. Gruppe ist {id} – tritt bei und frage einen Admin nach einem 7-Tage-Test',
  'notice.group.plainOk': 'Gruppennummer {id} kopiert – suche sie in QQ, um beizutreten',
  'notice.group.plainFail': 'Kopieren fehlgeschlagen. Gruppe ist {id} – suche sie in QQ, um beizutreten',
};
