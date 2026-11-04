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

  /* ── Lizenzstatus ───────────────────────────────────────── */
  'tier.base': 'Basis',
  'tier.paid': 'Pro aktiviert{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'gültig bis {date}',
  'tier.forever': 'unbefristet',

  /* ── Regalrahmen ────────────────────────────────────────── */
  'shelf.tab.library': 'Bibliothek',
  'shelf.tab.notes': 'Notizen',
  'shelf.act.search': 'Suche',
  'shelf.act.stats': 'Statistik',
  'shelf.act.import': 'Bücher importieren',
  'shelf.act.settings': 'Einstellungen',
  'shelf.back': 'Zurück',

  /* ── Bibliotheksseite ───────────────────────────────────── */
  'shelf.filter.all': 'Alle',
  'shelf.filter.reading': 'Am Lesen',
  'shelf.filter.done': 'Gelesen',
  'shelf.filter.new': 'Ungelesen',
  'shelf.filter.fav': 'Favoriten',
  'shelf.sort.recent': 'Zuletzt gelesen',
  'shelf.sort.title': 'Titel',
  'shelf.sort.progress': 'Fortschritt',
  'shelf.sort': 'Sortierung',
  'shelf.empty.all':
    'Das Regal ist noch leer. Über „Bücher importieren" oben rechts ein EPUB hinzufügen oder ein Buch direkt in den Vault legen.',
  'shelf.empty.none': 'Kein Buch passt. Anderer Suchbegriff, oder über „Bücher importieren" eines hinzufügen.',
  'shelf.continue': 'Weiterlesen',
  'shelf.lastChapter': 'Zuletzt bei {chapter}',
  'shelf.lastPercent': 'Zuletzt bei {percent}%',
  'shelf.resume': 'Weiterlesen ›',
  'shelf.detail': 'Buchdetails',
  'shelf.search.ph': 'Titel / Autor / Regal suchen',
  'shelf.collapse': 'Einklappen',
  'shelf.view.list': 'Liste',
  'shelf.view.grid': 'Cover',
  'shelf.shelfline': 'Regale',
  'shelf.count': '{n} Bücher',
  'shelf.badge.done': 'Gelesen',
  'shelf.more': 'Rechtsklick oder lange drücken für mehr',

  /* ── Einstellungen: Über-Leiste ─────────────────────────── */
  'settings.about': 'Über',
  'settings.about.version': 'Version unbekannt',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Basis',
  'settings.about.repo': 'Repository im Browser öffnen',
  'settings.about.video': 'Video-Tutorial',
  'settings.about.wip': 'In Arbeit',
  'settings.about.videoTip': 'Das Tutorial wird noch geschnitten – wir kündigen es in der Gruppe an',
  'settings.about.group': 'Community',
  'settings.about.groupTip': 'Klicken, um die Gruppennummer zu kopieren, dann in QQ suchen',
  'settings.about.changelog': 'Changelog',
  'settings.about.changelogTip': 'Änderungen der einzelnen Versionen ansehen',

  /* ── Einstellungen: Gruppenüberschriften ────────────────── */
  'settings.grp.ui': 'Oberfläche',
  'settings.grp.layout': 'Satz',
  'settings.grp.look': 'Aussehen',
  'settings.grp.header': 'Werkzeugleiste',
  'settings.grp.tts': 'Vorlesen',
  'settings.grp.marks': 'Markierungen',
  'settings.grp.ai': 'KI-Assistent',
  'settings.grp.lic': 'Lizenz',
  'settings.grp.data': 'Daten',
  'settings.grp.keys': 'Tastenkürzel',

  /* ── Einstellungen: Oberfläche ──────────────────────────── */
  'settings.language': 'Sprache',
  'settings.language.auto': 'Obsidian folgen',
  'settings.language.hint':
    'Bei „Obsidian folgen" entscheidet die Sprache des Hosts. Eine eigene Wahl wirkt sofort auf die Oberfläche; Befehlsnamen erst nach einem Neustart von Obsidian.',

  /* ── Einstellungen: Satz ────────────────────────────────── */
  'settings.font': 'Schrift',
  'settings.fontSize': 'Größe',
  'settings.lineHeight': 'Zeilenabstand',
  'settings.margin': 'Ränder',
  'settings.align': 'Ausrichtung',
  'settings.align.justify': 'Blocksatz',
  'settings.align.left': 'Linksbündig',
  'settings.direction': 'Richtung',
  'settings.direction.h': 'Waagerecht',
  'settings.direction.v': 'Senkrecht',
  'settings.columns': 'Spalten',
  'settings.columns.1': 'Eine',
  'settings.columns.2': 'Zwei',
  'settings.footnote': 'Fußnoten',
  'settings.footnote.popup': 'Pop-up oben',
  'settings.footnote.jump': 'Zum Kapitelende',

  /* ── Einstellungen: Aussehen ────────────────────────────── */
  'settings.accent': 'Akzentfarbe',

  /* ── Einstellungen: Werkzeugleiste ──────────────────────── */
  'settings.header.hint': 'Legt fest, welche Symbole erscheinen; ausgeblendete wandern ins ⋮-Menü rechts. Mobil höchstens 3.',

  /* ── Einstellungen: Vorlesen ────────────────────────────── */
  'settings.ttsRate': 'Tempo',
  'settings.ttsFollow': 'Nach dieser Seite',
  'settings.ttsFollow.on': 'Weiterlesen',
  'settings.ttsFollow.off': 'Hier stoppen',
  'settings.locked': 'Pro-Funktion – klicken, um den Umfang zu sehen',

  /* ── Einstellungen: Markierungen ────────────────────────── */
  'settings.pen': 'Standardfarbe',
  'settings.exportDir': 'Exportordner',
  'settings.pickFromList': 'Aus der Ordnerliste wählen',
  'settings.pick': 'Wählen…',
  'settings.exportComments': 'Notizen beim Export einschließen',
  'settings.quoteLink': 'Zitatlink',
  'settings.quoteLink.hint':
    'Wird als Wikilink [[book#location]] kopiert – in eine Notiz einfügen und anklicken, um zur Stelle zurückzuspringen; erscheint auch in den Backlinks.',

  /* ── Einstellungen: KI ──────────────────────────────────── */
  'settings.ai.baseUrl': 'Anbieter',
  'settings.ai.baseUrl.ph': 'Endpunkt-URL, beginnend mit https://',
  'settings.ai.model': 'Modell',
  'settings.ai.model.ph': 'Ein Modellname, den dein Konto nutzen kann',
  'settings.ai.key': 'Schlüssel',
  'settings.ai.key.ph': 'API-Schlüssel',

  /* ── Einstellungen: Lizenz ──────────────────────────────── */
  'settings.lic.status': 'Status',
  'settings.lic.code': 'Lizenzschlüssel',
  'settings.lic.relicense': 'Erneut aktivieren',
  'settings.lic.activate': 'Aktivieren',
  'settings.lic.paid': 'Pro',
  'settings.lic.benefits': 'Export, Statistik, buchübergreifende Suche, weitere Formate',
  'settings.lic.compare': 'Funktionen vergleichen',

  /* ── Einstellungen: Daten ───────────────────────────────── */
  'settings.importDir': 'Bücher importieren nach',
  'settings.pickFolder': 'Ordner wählen',
  'settings.dataDir': 'Datenordner',
  'settings.backupRestore': 'Sicherung & Wiederherstellung',
  'settings.backup': 'Sichern',
  'settings.backup.tip': 'Schreibt eine JSON-Datei in den Datenordner',
  'settings.restore': 'Wiederherstellen',
  'settings.restore.tip':
    'Aus einer Sicherungsdatei wiederherstellen (führt zusammen, überschreibt den aktuellen Fortschritt nie)',
  'settings.data.hint':
    'Eine Sicherung enthält Regal, Fortschritt, Markierungen, Favoriten und Ziele. Lizenzschlüssel und KI-Schlüssel sind nicht enthalten – auf einem neuen Gerät erneut eingeben.',

  /* ── Einstellungen: Tastenkürzel ────────────────────────── */
  'settings.key.unset': 'Nicht belegt',
  'settings.key.tip': 'In den Tastenkürzel-Einstellungen von Obsidian ändern',

  /* ── Kurze Befehlsnamen für die Kürzelzeilen ────────────── */
  'key.pageNext': 'Nächste Seite',
  'key.pagePrev': 'Vorherige Seite',
  'key.open': 'Regal öffnen',
  'key.search': 'Suche (Buch / Bibliothek)',
  'key.sidebar': 'Seitenleiste anzeigen',
  'key.focus': 'Fokusmodus',
  'key.fullscreen': 'Vollbild',
  'key.bookmark': 'Lesezeichen setzen',
  'key.typography': 'Typografie',
  'key.bookmap': 'Buchübersicht',
  'key.tts': 'Vorlesen umschalten',
  'key.continue': 'Zuletzt Gelesenes fortsetzen',
};
