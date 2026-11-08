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
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.unknownError': 'Unbekannter Fehler',
  'common.dialog': 'Dialog',

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

  /* ── Hinweise: Immersivmodus ─────────────────────────────── */
  'notice.immersive.exitDesktop': 'Immersive mode on. Press ESC to exit',
  'notice.immersive.exitMobile': 'Immersive mode on. Tap the page with two fingers to exit',

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
  'notice.book.archived': '„{title}“ aus dem Regal entfernt — Daten bleiben erhalten',
  'notice.book.revived': '{n} Buch/Bücher wiederhergestellt — Fortschritt und Markierungen sind zurück',
  'notice.missing.found': 'Gefunden: {path}',
  'notice.missing.notFound': 'Keine Kopie dieser Datei im Vault gefunden — bitte manuell auswählen',
  'notice.missing.wrong': 'Diese Datei ist nicht dasselbe Buch (Inhalt weicht ab)',
  'notice.missing.picked': 'Neu verknüpft mit {path}',
  'notice.missing.tooBig': 'Datei zu groß zum Prüfen — legen Sie sie zurück in den Vault und nutzen Sie „Im Vault suchen“',
  'notice.missing.noFingerprint': 'Dieses Buch hat noch keinen Inhaltsfingerabdruck — wählen Sie die Datei einmal manuell, danach funktioniert das automatische Finden',
  'notice.select.pick': 'Wähle zuerst einige zum Löschen aus',
  'notice.rating.stars': '{stars} Sterne gespeichert',
  'notice.rating.done': 'Bewertung gespeichert',
  'notice.status.reading': 'Als „am Lesen" markiert',
  'notice.status.done': 'Als „gelesen" markiert',
  'notice.ui.reset': 'Oberfläche zurückgesetzt',

  /* ── Hinweise: Import ───────────────────────────────────── */
  'notice.import.done': '{n} Buch/Bücher hinzugefügt',
  'notice.import.failed': 'Hinzufügen zum Regal fehlgeschlagen: {why}',
  'notice.import.written': '{n} Buch/Bücher nach {folder} importiert',
  'notice.import.error': 'Import fehlgeschlagen: {why}',
  'notice.import.partial': '{failed} Datei(en) nicht importiert, {ok} übernommen',
  'notice.import.skipped': '{n} Buch/Bücher bereits im Regal (gleiche Datei) — übersprungen',

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
  'notice.group.plainOk': 'Gruppennummer {id} kopiert – suche sie in QQ, um beizutreten',
  'notice.group.plainFail': 'Kopieren fehlgeschlagen. Gruppe ist {id} – suche sie in QQ, um beizutreten',
  /* Dev-build only: feedback from the tier toggle commands */
  'notice.dev.tier.free': 'Dev: switched to the free tier (test vault only)',
  'notice.dev.tier.paid': 'Dev: switched to the pro tier (test vault only)',
  'notice.dev.tier.real': 'Dev: real license restored',

  /* ── Lizenzstatus ───────────────────────────────────────── */
  'tier.base': 'Basis',
  'tier.paid': 'Pro aktiviert{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'gültig bis {date}',
  'tier.forever': 'unbefristet',

  /* ── Statistikseite ─────────────────────────────────────── */
  'stats.thisWeek': 'Diese Woche',
  'stats.weeksAgo': 'vor {n} Wochen',
  'stats.noRecord': 'Keine Aufzeichnung',
  'stats.minutes': '{n} Min.',
  'stats.days': '{n} Tage',
  'stats.kpi.streak': 'Lese-Serie · Tage',
  'stats.kpi.done': 'Gelesen · Bücher',
  'stats.kpi.total': 'Gesamtzeit · Stunden',
  'stats.kpi.today': 'Heute · Minuten',
  'stats.goal.caption': 'Jahresziel',
  'stats.goal.progress': '{done} / {goal} Bücher',
  'stats.goal.reached': 'Ziel erreicht. Zahl höher setzen – oder ein sperrigeres Buch wählen.',
  'stats.goal.remaining':
    'Noch {n} Bücher dieses Jahr. Das Ziel bewegt nur diesen Ring, sonst nichts.',
  'stats.goal.adjust': 'Ziel anpassen',
  'stats.goal.poster': 'Jahresposter',
  'stats.checkin': 'Täglicher Check-in',
  'stats.checkin.streak': 'Serie',
  'stats.checkin.today': 'Heute',
  'stats.checkin.month': 'Diesen Monat',
  'stats.checkin.goal': 'Tagesziel',
  'stats.checkin.reached': 'Erreicht · {n} Min.',
  'stats.checkin.remaining': '{n} Min., noch {left} Min.',
  'stats.checkin.monthTitle': 'Check-ins für jeden Tag dieses Monats',
  'stats.checkin.hint': '{n} Minuten Lesen am Tag zählen als Check-in.',
  'stats.checkin.doneToday': 'Heute ist schon abgehakt.',
  'stats.checkin.almost': 'Fast geschafft – zehn Minuten vor dem Schlafen reichen.',
  'stats.heat': 'Letzte 20 Wochen',
  'stats.heat.oldest': 'vor 20 Wochen',
  'stats.heat.today': 'Heute',
  'stats.heat.hint': 'Hellere Kästchen heißt länger gelesen.',
  'stats.heat.streak': '{n} Tage ohne Unterbrechung.',
  'stats.heat.noStreak': 'Noch keine Serie.',
  'stats.weekly': 'Zeit pro Woche',
  'stats.weekly.today': 'Zeit heute',
  'stats.weekly.activeDays': 'Tage mit Aktivität',
  'stats.byBook': 'Zeit pro Buch',
  'stats.byBook.empty': 'Noch keine Leseaufzeichnung.',
  'stats.empty':
    'Die Statistik zählt nur echte Lesesitzungen. Öffne ein Buch für ein paar Minuten – dann wird diese Seite lebendig.',
  'stats.locked': 'Die Lesestatistik ist eine Pro-Funktion.',
  'stats.lockedHint':
    'Gesamtzeit, Heatmap, Fortschritt pro Buch und Gelesen-Liste erscheinen hier, sobald du freischaltest.',
  'stats.locked.cta': 'Pro-Funktionen ansehen',

  /* ── Notizenseite ───────────────────────────────────────── */
  'notes.pick': 'Auswählen',
  'notes.unpick': 'Abwählen',
  'notes.review.kick': 'T Ä G L I C H E R   R Ü C K B L I C K',
  'notes.review.title': 'Noch einmal ansehen',
  'notes.review.next': 'Weiter ›',
  'notes.jump': 'Zur Stelle zurück',
  'notes.bilink': 'Wikilink',
  'notes.pro': 'Pro',
  'notes.filter.all': 'Alle',
  'notes.filter.comment': 'Mit Notizen',
  'notes.selected': '{n} ausgewählt',
  'notes.selectAll': 'Alle auswählen',
  'notes.selectNone': 'Auswahl aufheben',
  'notes.exitSelect': 'Auswahl beenden',
  'notes.delete': 'Löschen',
  'notes.deleteN': '{n} löschen',
  'notes.count': '{n}',
  'notes.exportThis': 'Dieses Buch exportieren',
  'notes.empty': 'Keine passenden Anmerkungen. Im Lesemodus Text markieren und einen Stift wählen.',
  'notes.search.ph': 'Markierungen, Notizen, Titel durchsuchen',
  'notes.summary': '{n} Einträge · {ideas} mit Notizen',
  'notes.select': 'Auswählen',
  'notes.export': 'Als Markdown exportieren',

  /* ── Seitenleiste im Lesemodus ──────────────────────────── */
  'side.tab.toc': 'Inhalt',
  'side.tab.bookmarks': 'Lesezeichen',
  'side.tab.highlights': 'Markierungen',
  'side.expand': 'Ausklappen',
  'side.collapse': 'Einklappen',
  'side.toc.count': '{n} Abschnitte',
  'side.bookmarks.empty': 'Noch keine Lesezeichen.',
  'side.bookmarks.emptyHint': 'Wo du aufhörst, in der Leseleiste auf „Lesezeichen" klicken.',
  'side.bookmarks.order': 'In Buchreihenfolge',
  'side.delete': 'Löschen',
  'side.highlights.empty': 'Noch keine Markierungen.',
  'side.highlights.emptyHint': 'Text im Buch markieren und dann einen Stift aus den eingeblendeten Farben wählen.',
  'side.ideaTag': 'Notiz',
  'side.ai.hint': 'Text markieren, um die KI zu fragen – oder hier direkt zum Buch fragen. Antworten stützen sich auf die relevantesten Stellen des ganzen Buchs; die aktuelle Seite wird nicht gesendet.',
  'side.ai.notReady':
    'Es ist kein KI-Dienst eingerichtet. Anbieter, Modell und Schlüssel unter Regal · Einstellungen eintragen, dann wird diese Leiste lebendig.',
  'side.ai.me': 'Ich',
  'side.ai.ask.ph': 'Frag zu diesem Buch…',
  'side.ai.ask': 'Fragen',
  'side.ai.index.loading': 'Index wird gelesen…',
  'side.ai.index.lead': 'Zuerst einen Index für dieses Buch erstellen – Antworten beziehen sich dann auf das ganze Buch.',
  'side.ai.index.build': 'Index erstellen',
  'side.ai.index.tutorial': 'Video-Tutorial ansehen',
  'side.ai.index.choose': 'Eine Methode wählen; gestartet wird erst nach Bestätigung.',
  'side.ai.index.running': 'Index wird erstellt',
  'side.ai.index.done': 'Index fertig – du kannst jetzt fragen.',
  'side.ai.index.rebuild': 'Index neu erstellen',
  'side.ai.rebuild.confirm': 'Neu erstellen löscht den jetzigen Index dieses Buchs und rechnet alles noch einmal – unterbrechen oder rückgängig machen geht nicht.',
  'side.ai.scope.book': 'Antworten aus dem ganzen Buch',
  'side.untitled': 'Ohne Titel',
  'side.noBook': 'Kein Buch geöffnet',
  'side.empty': 'Diese Leiste folgt dem Lesen.',
  'side.emptyHint': 'Öffne ein Buch im Regal — Inhalt, Lesezeichen und Markierungen erscheinen hier.',
  'side.toc.notReady': 'Der Inhalt ist noch nicht bereit.',
  'side.toc.openCurrent': 'Dieses Buch öffnen',

  /* ── Auswahlwerkzeugleiste ──────────────────────────────── */
  'tool.idea': 'Notiz',
  'ai.mode.explain': 'Erklären',
  'ai.mode.translate': 'Übersetzen',
  'ai.mode.summarize': 'Zusammenfassen',
  'tool.quote': 'Zitat',
  'tool.ai': 'KI',
  'tool.bilink': 'Link',
  'tool.copy': 'Kopieren',
  'tool.del': 'Löschen',
  'tool.more': 'Mehr',
  'tool.aria': 'Auswahlwerkzeuge',

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
  'shelf.missing': 'Datei fehlt',
  'shelf.missing.tip': 'Die Datei liegt nicht mehr am alten Ort — zum Neuverknüpfen klicken',
  'shelf.more': 'Rechtsklick oder lange drücken für mehr',

  /* ── Einstellungen: Über-Leiste ─────────────────────────── */
  'settings.about': 'Über',
  'settings.about.version': 'Version unbekannt',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Basis',
  'settings.about.repo': 'Repository im Browser öffnen',
  'settings.about.video': 'Video-Tutorial',
  'settings.about.videoTip': 'Das Tutorial-Video auf Bilibili ansehen',
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
  'settings.lic.benefits': 'Export, Statistik, buchübergreifende Suche, KI, weitere Formate',
  'settings.lic.compare': 'Funktionen vergleichen',

  /* ── 解锁弹层：功能对照表 ─────────────────────────────── */
  'unlock.title': 'Pro',
  'unlock.activated': 'Aktiviert',
  'unlock.col.feature': 'Funktion',
  'unlock.col.base': 'Basis',
  'unlock.col.pro': 'Pro',
  'unlock.part': 'Teilweise',
  'unlock.buy': 'Pro kaufen',
  'unlock.group': 'QQ group {id}',
  'unlock.hint': 'Nach dem Kauf erhältst du einen Lizenzcode; gib ihn unten ein.',
  'unlock.haveCode': 'Code bereits vorhanden',

  /* ── Einstellungen: Daten ───────────────────────────────── */
  'settings.importDir': 'Bücher importieren nach',
  'settings.pickFolder': 'Ordner wählen',
  'settings.dataDir': 'Datenordner',
  'settings.backupRestore': 'Sicherung & Wiederherstellung',
  'settings.backup': 'Sichern',
  'settings.backup.tip': 'Schreibt eine JSON-Datei in den Datenordner',
  'settings.restore': 'Wiederherstellen',
  'settings.restore.tip':
    'Aus einer Sicherungsdatei wiederherstellen (ersetzt alles – der aktuelle Stand bleibt nicht erhalten)',
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

  /* ── AI 知识库（2026-11-07） ─────────────────── */
  'bz.missing': 'bz ist noch nicht installiert – installiere es zuerst über die Community-Plugins von Obsidian',
  'bz.noEmbedModel': 'Im Second Brain ist noch kein Embedding-Modell gewählt — dort eins auswählen, dann kann hier ein Index entstehen.',
  'settings.ai.kb': 'Mit der BZ AI Knowledge Base verbinden',
  'settings.ai.kb.on': 'Verbunden',
  'settings.ai.kb.off': 'Nicht verbunden',
  'settings.ai.kb.hint': 'Über „als Begriff / Absatz speichern“ in der Markierung lässt sich ein lokaler Vektorindex für das Buch aufbauen; Fragen beziehen auch die Notizen der Bibliothek mit ein.',
  'bz.disabled': 'bz ist installiert, aber deaktiviert – aktiviere es unter Einstellungen → Community-Plugins',
  'bz.outdated': 'Deine bz-Version ({version}) ist zu alt – aktualisiere sie',
  'bz.callFailed': 'bz hat die Anfrage nicht angenommen: {message}',
  'bz.noFolder': 'Richte zuerst den Literaturordner in bz ein und versuche es erneut',
  'tool.term': 'Begriff',
  'tool.passage': 'Absatz',
  'notice.kb.term': 'Als Begriff in der Wissensbox gespeichert',
  'notice.kb.passage': 'Als Absatz in der Wissensbox gespeichert',
  'notice.kb.failed': 'Konnte nicht in die Wissensbox schreiben: {message}',
  'side.ai.book.none': 'Für dieses Buch gibt es noch kein Gesamtbild – erstelle eins.',
  'side.ai.embedNotReady': 'Vektoren liefert das Second Brain: bz aktivieren, dort ein Embedding-Modell wählen, dann den Index erstellen.',
  'side.ai.book.noHit': 'Keine passende Stelle im Buch gefunden: anders formulieren oder den Index neu erstellen.',
  'side.ai.sources': 'Quellen',
  'side.ai.source.chapter': 'Kapitel',
  'pt.plan.vector': 'A. Vektorsuche',
  'pt.plan.compress': 'B. KI-Komprimierung',
  'pt.estimate.vector': '{blocks} Blöcke, etwa {requests} Embedding-Aufrufe',
  'pt.estimate.compress': '{blocks} Blöcke, etwa {requests} KI-Aufrufe',
  'pt.start': 'Starten',
  'pt.close': 'Schließen',
  'pt.pause': 'Pause',
  'pt.resume': 'Fortsetzen',
  'pt.stop': 'Abbrechen',
  'pt.block': 'Block {done} / {total}',
  'pt.extract': 'Buch wird gelesen: Kapitel {done} / {total}',
  'pt.retryFailed': 'Nur fehlgeschlagene Blöcke wiederholen',
  'pt.failedBlocks': '{n} Blöcke fehlgeschlagen',
  'pt.mobile': 'Gesamtbilder entstehen nur am Desktop – dort erstellen, am Handy nutzen.',
  'detail.portrait': 'Buch-Gesamtbild',
  'detail.portrait.none': 'nicht erstellt',
  'detail.portrait.ready': 'fertig',
  'detail.portrait.building': 'halb fertig',
  'detail.portrait.stale': 'muss neu erstellt werden',
  'detail.portrait.open': 'Gesamtbild erstellen…',
  'pt.clean': 'Verwaiste Gesamtbilder löschen',
  'pt.clean.empty': 'Keine verwaisten Gesamtbilder – jedes gehört noch zu einem Buch.',
  'pt.clean.confirm': 'Diese Gesamtbilder gehören zu keinem Buch mehr. Löschen ist endgültig:',
  'ack.title': 'Was an die KI gesendet wird',
  'ack.body.book': 'Beim Erstellen des Index wird das ganze Buch in Abschnitten an Ihren eigenen Embedding-Dienst gesendet; Fragen senden nur die gefundenen Abschnitte, bei aktiver Freigabe auch Notizen aus der bz-Wissensbasis.',
  'ack.ok': 'Verstanden',
  'notice.note.missing': 'Diese Notiz gibt es nicht mehr: {path}',
  'pt.blockCount': '{n} Blöcke',
  'pt.clean.done': '{n} verwaiste Gesamtbilder gelöscht',
  'pt.needOpen': 'Ein Gesamtbild liest das ganze Buch – öffne es zuerst im Reader',
  'side.ai.source.block': 'Block {n}',
  'side.ai.book.stale': 'Dieses Gesamtbild wurde mit einem anderen Embedding-Modell erstellt – neu erstellen, sonst passen die gefundenen Blöcke nicht.',
  'notice.portrait.busy': 'Another book is still building its index — stop that one first',
  'notice.import.tooBig': '{n} file(s) are too large — import them on a computer first',
  'menu.compare.title': 'Compare book: {title}',
  'menu.compare.none': 'None',
  'menu.compare.empty': 'No other books on the shelf yet',
  'menu.compare.more': '{n} more — filter the shelf first',
  'menu.para.close': 'Close side by side',
  'menu.tts.stop': 'Stop reading aloud',
  'menu.immersive.exit': 'Exit immersive mode',

  /* ── restore confirmation / shell guards (C-batch; placeholder EN) ── */
  'notice.bookmark.gone': 'That bookmark is gone',
  'notice.license.checkFailed': 'License check failed, running as not activated. Restart the plugin; contact me if it persists.',
  'notice.migrate.busy': 'Another folder is still being migrated — wait for it to finish',
  'notice.migrate.failed': 'Migration failed: {why}',
  'notice.ai.evidenceTimeout': 'Timed out gathering sources: the AI service did not respond in 20s — try again later',
  'notice.portrait.removeFailed': 'Could not delete the index — try again later',
  'pt.rebuild.cleared': 'Index cleared — you can build it again',
  'restore.title': 'Restore from backup',
  'restore.sub': 'Full replacement — cannot be undone',
  'restore.body': 'Restoring replaces your entire library, progress, highlights, favourites and goal with the backup. Your current data will not be kept.',
  'restore.hint': 'The data folder stays where it is. Consider making a backup first.',
  'restore.do': 'Restore now',
};
