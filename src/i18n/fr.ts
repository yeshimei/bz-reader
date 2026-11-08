/**
 * Textes français (src/i18n/fr.ts)
 *
 * Choix de rédaction :
 *   · Noms de commandes préfixés par le domaine (`Bibliothèque :` / `Lecture :`) —
 *     la palette de commandes d'Obsidian filtre mot par mot.
 *   · Notifications au passé composé (« Surlignage ajouté »), jamais au présent.
 *   · Les erreurs disent quoi faire ensuite ; « échec » seul n'aide personne.
 *   · Noms propres inchangés : bz Reader, Obsidian, GitHub, Markdown, EPUB, TXT, QQ.
 *
 * Typographie française : espace insécable avant `:` et `?`, guillemets « ».
 * Le `:` des commandes reste collé (c'est un préfixe technique, pas une ponctuation
 * de phrase) — sinon la palette affiche un espace bizarre en début de nom.
 */
import type { MsgKey } from './zh';

export const FR: Record<MsgKey, string> = {
  /* ── Mots courants ──────────────────────────────────────── */
  'common.default': 'par défaut',
  'common.untitled': 'Sans titre',
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.unknownError': 'Erreur inconnue',

  /* ── Entrée du plugin ───────────────────────────────────── */
  'ribbon.shelf': 'bz Reader : bibliothèque',

  /* ── Commandes : bibliothèque ───────────────────────────── */
  'cmd.open': 'Bibliothèque : ouvrir la bibliothèque',
  'cmd.continue': 'Bibliothèque : reprendre la dernière lecture',
  'cmd.import': 'Bibliothèque : importer des livres',
  'cmd.notes': 'Bibliothèque : notes',
  'cmd.stats': 'Bibliothèque : statistiques',
  'cmd.prefs': 'Bibliothèque : réglages',

  /* ── Commandes : lecteur ────────────────────────────────── */
  'cmd.search': 'Lecture : rechercher (livre / bibliothèque)',
  'cmd.sidebar': 'Lecture : afficher le panneau latéral',
  'cmd.pageNext': 'Lecture : page suivante',
  'cmd.pagePrev': 'Lecture : page précédente',
  'cmd.focus': 'Lecture : mode concentration',
  'cmd.fullscreen': 'Lecture : plein écran',
  'cmd.bookmark': 'Lecture : ajouter un signet',
  'cmd.typography': 'Lecture : typographie',
  'cmd.bookmap': 'Lecture : vue d’ensemble',
  'cmd.tts': 'Lecture : activer la lecture vocale',
  'notice.needBook': 'Ouvrez d’abord un livre, puis relancez cette commande',
  'notice.language.changed': 'Langue de l’interface modifiée — les noms des commandes seront mis à jour après un redémarrage d’Obsidian',

  /* ── Notifications : mode immersif ──────────────────────── */
  'notice.immersive.exitDesktop': 'Immersive mode on. Press ESC to exit',
  'notice.immersive.exitMobile': 'Immersive mode on. Tap the page with two fingers to exit',

  /* ── Notifications : presse-papiers ─────────────────────── */
  'notice.copy.ok': 'Copié dans le presse-papiers',
  'notice.copy.failed': 'Échec de la copie — utilisez le raccourci système',

  /* ── Notifications : signets ────────────────────────────── */
  'notice.bookmark.noCfi': 'Cette page n’a pas encore de position — tournez une page et réessayez',
  'notice.bookmark.exists': 'Cette page a déjà un signet',
  'notice.bookmark.added': 'Signet ajouté',

  /* ── Notifications : surlignages et annotations ─────────── */
  'notice.mark.created': 'Surlignage {color} ajouté',
  'notice.mark.recolored': 'Couleur changée : {color}',
  'notice.mark.notFound': 'Surlignage introuvable',
  'notice.mark.gone': 'Cette annotation n’existe plus — elle a peut-être été supprimée',
  'notice.mark.deleted': 'Surlignage supprimé',
  'notice.mark.deletedN': '{n} surlignage(s) supprimé(s)',
  'notice.mark.goneAll': 'Ces annotations n’existent plus',
  'notice.idea.saved': 'Note enregistrée',
  'notice.idea.cleared': 'Note effacée',

  /* ── Notifications : notes et export ────────────────────── */
  'notice.note.saved': 'Enregistré dans {path}',
  'notice.note.saveFailed': 'Impossible d’enregistrer la note : {why}',
  'notice.export.needBook': 'Ouvrez d’abord un livre, ou exportez depuis un livre dans l’onglet Notes',
  'notice.export.empty': 'Rien à exporter — ce livre n’a ni surlignage ni signet',
  'notice.export.done': '{n} surlignage(s) exporté(s) vers {path}',
  'notice.export.failed': 'Échec de l’export : {why}',
  'export.noData': '(Rien à exporter pour l’instant)',
  'export.noNotes': '(Aucun surlignage. Sélectionnez du texte dans le lecteur pour commencer.)',
  'export.loose': 'Fragments',

  /* ── Notifications : carte de citation ──────────────────── */
  'notice.card.copied': 'Carte de citation copiée en image',
  'notice.card.copyFailed': 'Impossible de copier l’image',
  'notice.quote.empty': 'Aucune citation à enregistrer',

  /* ── Notifications : actions de la bibliothèque ─────────── */
  'notice.fav.on': 'Ajouté aux favoris',
  'notice.fav.off': 'Retiré des favoris',
  'notice.rename.empty': 'Un titre est requis',
  'notice.rename.done': 'Titre modifié',
  'notice.book.archived': '« {title} » retiré de l’étagère — données conservées',
  'notice.book.revived': '{n} livre(s) restauré(s) — progression et surlignages conservés',
  'notice.missing.found': 'Trouvé : {path}',
  'notice.missing.notFound': 'Aucune copie de ce fichier dans la bibliothèque — choisissez-le manuellement',
  'notice.missing.wrong': 'Ce fichier n’est pas le même livre (contenu différent)',
  'notice.missing.picked': 'Relocalisé vers {path}',
  'notice.missing.tooBig': 'Fichier trop volumineux pour vérifier — remettez-le dans le coffre, puis utilisez « Chercher dans le coffre »',
  'notice.missing.noFingerprint': 'Ce livre n’a pas encore d’empreinte de contenu — choisissez le fichier une fois manuellement, la recherche automatique marchera ensuite',
  'notice.select.pick': 'Sélectionnez d’abord quelques éléments à supprimer',
  'notice.rating.stars': 'Noté {stars} étoiles',
  'notice.rating.done': 'Note enregistrée',
  'notice.status.reading': 'Marqué comme en cours de lecture',
  'notice.status.done': 'Marqué comme terminé',
  'notice.ui.reset': 'État de l’interface réinitialisé',

  /* ── Notifications : import ─────────────────────────────── */
  'notice.import.done': '{n} livre(s) ajouté(s)',
  'notice.import.failed': 'Impossible d’ajouter à la bibliothèque : {why}',
  'notice.import.written': '{n} livre(s) importé(s) dans {folder}',
  'notice.import.error': 'Échec de l’import : {why}',
  'notice.import.partial': '{failed} fichier(s) non importé(s), {ok} importé(s)',
  'notice.import.skipped': '{n} livre(s) déjà dans la bibliothèque (même fichier) — ignoré(s)',

  /* ── Notifications : recherche ──────────────────────────── */
  'notice.search.empty': 'Saisissez quelque chose à rechercher',
  'notice.search.needBook': 'Ouvrez d’abord un livre, puis recherchez dedans',
  'notice.search.failed': 'Échec de la recherche : {why}',
  'notice.sel.empty': 'Rien de sélectionné à copier',
  'notice.toc.missingChapter': 'Ce chapitre n’est plus dans la table des matières — le fichier a peut-être changé',

  /* ── Notifications : dossiers ───────────────────────────── */
  'notice.dir.exportRoot': 'Le dossier d’export ne peut pas être la racine du coffre — choisissez un sous-dossier',
  'notice.dir.dataRoot': 'Le dossier de données ne peut pas être la racine du coffre — choisissez un sous-dossier',
  'notice.migrate.running': 'Déplacement des fichiers…',
  'notice.goal.set': 'Objectif quotidien fixé à {n} minutes',

  /* ── Notifications : sauvegarde et restauration ─────────── */
  'notice.backup.done': 'Sauvegarde créée dans « {path} »',
  'notice.backup.failed': 'Échec de la sauvegarde : {why}',
  'notice.restore.noPick': 'Aucun fichier sélectionné',
  'notice.restore.unreadable': 'Impossible de lire ce fichier : {why}',
  'notice.restore.done': 'Restauré — la bibliothèque contient maintenant {n} livre(s)',
  'notice.restore.dropped': ' ({n} enregistrement(s) incomplet(s) ignoré(s))',

  /* ── Notifications : fichier de données ─────────────────── */
  'notice.data.broken': 'Fichier de données illisible ; une copie a été conservée sous bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': 'Fichier de données illisible et aucune copie possible ; rien ne sera enregistré durant cette session pour ne pas écraser l’original',
  'notice.data.dropped': '{n} fiche(s) de livre sans chemin de fichier ; une copie a été conservée sous bz-reader.dropped-*.json',
  'notice.data.loadFailed': 'Impossible de charger les données de lecture ; rien ne sera enregistré durant cette session pour qu’une bibliothèque vide n’écrase pas l’original',
  'notice.data.saveFailed': 'Impossible d’enregistrer les données de lecture — vérifiez l’espace disque',

  /* ── Notifications : dossier de données et liens ────────── */
  'notice.dataDir.multiple': 'Plusieurs dossiers de données ont été trouvés et le choix est ambigu ; sélectionnez-en un dans les réglages',
  'notice.dataDir.found': 'Dossier de données retrouvé : « {dir} »',
  'notice.link.bookMissing': 'Le livre lié n’est pas dans la bibliothèque — il a peut-être été déplacé',
  'notice.link.cfiMiss': 'Ce passage est introuvable ; arrêt à votre dernière position dans ce livre',
  'notice.noReadBook': 'Aucun livre n’a encore été lu',
  'notice.debug.link': '[bz diagnostic] {type} · {href}',

  /* ── Notifications : lecteur ────────────────────────────── */
  'notice.compare.onlyOne': 'Un seul livre dans la bibliothèque — la comparaison côte à côte en demande un second',
  'notice.compare.failed': 'Impossible d’ouvrir la comparaison côte à côte : {why}',
  'notice.tts.noText': 'Rien à lire à voix haute sur cette page',
  'notice.tts.unsupported': 'La lecture à voix haute n’est pas prise en charge dans cet environnement',
  'notice.open.unsupported': 'Format non pris en charge',
  'fault.openFailed': 'Impossible d’ouvrir ce livre',
  'notice.load.stalled': '{what} ne s’est pas terminé — veuillez réessayer',
  'notice.locate.notReady': 'Cette page n’est pas encore localisée — tournez une page et réessayez',
  'notice.bookmark.toggledOn': 'Signet ajouté',
  'notice.bookmark.toggledOff': 'Signet retiré',

  /* ── Notifications : groupe (QQ) ────────────────────────── */
  'notice.group.plainOk': 'Numéro de groupe {id} copié — recherchez-le dans QQ pour le rejoindre',
  'notice.group.plainFail': 'Échec de la copie. Le groupe est {id} — recherchez-le dans QQ pour le rejoindre',
  /* Dev-build only: feedback from the tier toggle commands */
  'notice.dev.tier.free': 'Dev: switched to the free tier (test vault only)',
  'notice.dev.tier.paid': 'Dev: switched to the pro tier (test vault only)',
  'notice.dev.tier.real': 'Dev: real license restored',

  /* ── État de la licence ─────────────────────────────────── */
  'tier.base': 'Base',
  'tier.paid': 'Pro activé{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'valable jusqu’au {date}',
  'tier.forever': 'à vie',

  /* ── Page statistiques ──────────────────────────────────── */
  'stats.thisWeek': 'Cette semaine',
  'stats.weeksAgo': 'il y a {n} semaines',
  'stats.noRecord': 'Aucune donnée',
  'stats.minutes': '{n} min',
  'stats.days': '{n} jours',
  'stats.kpi.streak': 'Série de lecture · jours',
  'stats.kpi.done': 'Terminés · livres',
  'stats.kpi.total': 'Temps total · heures',
  'stats.kpi.today': 'Aujourd’hui · minutes',
  'stats.goal.caption': 'Objectif annuel',
  'stats.goal.progress': '{done} / {goal} livres',
  'stats.goal.reached': 'Objectif atteint. Augmentez le chiffre, ou prenez un livre plus coriace.',
  'stats.goal.remaining':
    'Encore {n} livres cette année. L’objectif ne bouge que cet anneau, rien d’autre.',
  'stats.goal.adjust': 'Ajuster l’objectif',
  'stats.goal.poster': 'Affiche de l’année',
  'stats.checkin': 'Pointage quotidien',
  'stats.checkin.streak': 'Série',
  'stats.checkin.today': 'Aujourd’hui',
  'stats.checkin.month': 'Ce mois-ci',
  'stats.checkin.goal': 'Objectif quotidien',
  'stats.checkin.reached': 'Atteint · {n} min',
  'stats.checkin.remaining': '{n} min, encore {left} min',
  'stats.checkin.monthTitle': 'Pointages de chaque jour de ce mois',
  'stats.checkin.hint': 'Lire {n} minutes par jour compte comme un pointage.',
  'stats.checkin.doneToday': 'Aujourd’hui est déjà coché.',
  'stats.checkin.almost': 'Presque — dix minutes avant de dormir suffisent.',
  'stats.heat': '20 dernières semaines',
  'stats.heat.oldest': 'il y a 20 semaines',
  'stats.heat.today': 'Aujourd’hui',
  'stats.heat.hint': 'Plus la case est claire, plus la lecture a été longue.',
  'stats.heat.streak': '{n} jours sans interruption.',
  'stats.heat.noStreak': 'Pas encore de série.',
  'stats.weekly': 'Temps par semaine',
  'stats.weekly.today': 'Temps aujourd’hui',
  'stats.weekly.activeDays': 'Jours avec activité',
  'stats.byBook': 'Temps par livre',
  'stats.byBook.empty': 'Aucune lecture enregistrée.',
  'stats.empty':
    'Les statistiques ne comptent que les vraies sessions de lecture. Ouvrez un livre quelques minutes et cette page s’allumera.',
  'stats.locked': 'Les statistiques de lecture sont une fonction Pro.',
  'stats.lockedHint':
    'Temps total, carte de chaleur, progression par livre et livres terminés apparaîtront ici après déverrouillage.',
  'stats.locked.cta': 'Voir ce qu’apporte Pro',

  /* ── Page notes ─────────────────────────────────────────── */
  'notes.pick': 'Sélectionner',
  'notes.unpick': 'Désélectionner',
  'notes.review.kick': 'R E V U E   D U   J O U R',
  'notes.review.title': 'Revoir ce passage',
  'notes.review.next': 'Suivant ›',
  'notes.jump': 'Revenir au passage',
  'notes.bilink': 'Wikilien',
  'notes.pro': 'Pro',
  'notes.filter.all': 'Tous',
  'notes.filter.comment': 'Avec notes',
  'notes.selected': '{n} sélectionné(s)',
  'notes.selectAll': 'Tout sélectionner',
  'notes.selectNone': 'Tout désélectionner',
  'notes.exitSelect': 'Quitter la sélection',
  'notes.delete': 'Supprimer',
  'notes.deleteN': 'Supprimer {n}',
  'notes.count': '{n}',
  'notes.exportThis': 'Exporter ce livre',
  'notes.empty': 'Aucune annotation correspondante. Sélectionnez du texte dans le lecteur et choisissez un stylo.',
  'notes.search.ph': 'Rechercher surlignages, notes et titres',
  'notes.summary': '{n} éléments · {ideas} avec notes',
  'notes.select': 'Sélectionner',
  'notes.export': 'Exporter en Markdown',

  /* ── Panneau latéral du lecteur ─────────────────────────── */
  'side.tab.toc': 'Sommaire',
  'side.tab.bookmarks': 'Signets',
  'side.tab.highlights': 'Surlignages',
  'side.expand': 'Déplier',
  'side.collapse': 'Replier',
  'side.toc.count': '{n} sections',
  'side.bookmarks.empty': 'Aucun signet pour l’instant.',
  'side.bookmarks.emptyHint': 'Là où vous vous arrêtez, cliquez sur « Signet » dans la barre de lecture.',
  'side.bookmarks.order': 'Dans l’ordre du livre',
  'side.delete': 'Supprimer',
  'side.highlights.empty': 'Aucun surlignage pour l’instant.',
  'side.highlights.emptyHint':
    'Sélectionnez du texte dans le livre, puis choisissez un stylo parmi les couleurs affichées.',
  'side.ideaTag': 'Note',
  'side.ai.hint': 'Sélectionnez du texte pour interroger l’IA, ou posez une question sur ce livre ici. Les réponses s’appuient sur les passages les plus pertinents du livre entier ; la page en cours n’est pas envoyée.',
  'side.ai.notReady':
    'Aucun service d’IA n’est configuré. Renseignez fournisseur, modèle et clé sous Bibliothèque · Réglages et ce panneau s’animera.',
  'side.ai.me': 'Moi',
  'side.ai.ask.ph': 'Poser une question sur ce livre…',
  'side.ai.ask': 'Demander',
  'side.ai.index.loading': 'Lecture de l’index…',
  'side.ai.index.lead': 'Créez d’abord un index pour ce livre : les réponses porteront sur tout le livre.',
  'side.ai.index.build': 'Créer l’index',
  'side.ai.index.tutorial': 'Voir le tutoriel vidéo',
  'side.ai.index.choose': 'Choisissez une méthode ; rien ne démarre avant confirmation.',
  'side.ai.index.running': 'Création de l’index',
  'side.ai.index.done': 'Index prêt — vous pouvez poser vos questions.',
  'side.ai.index.rebuild': 'Recréer l’index',
  'side.ai.rebuild.confirm': 'Recréer supprime l’index actuel de ce livre et relance tout le calcul : ni pause, ni retour en arrière.',
  'side.ai.scope.book': 'Réponses sur tout le livre',
  'side.untitled': 'Sans titre',
  'side.noBook': 'Aucun livre ouvert',
  'side.empty': 'Ce panneau suit votre lecture.',
  'side.emptyHint':
    'Ouvrez un livre depuis la bibliothèque : sommaire, signets et surlignages apparaîtront ici.',
  'side.toc.notReady': 'Le sommaire n’est pas encore prêt.',
  'side.toc.openCurrent': 'Ouvrir ce livre',

  /* ── Barre d’outils de sélection ────────────────────────── */
  'tool.idea': 'Note',
  'ai.mode.explain': 'Expliquer',
  'ai.mode.translate': 'Traduire',
  'ai.mode.summarize': 'Résumer',
  'tool.quote': 'Citation',
  'tool.ai': 'IA',
  'tool.bilink': 'Lien',
  'tool.copy': 'Copier',
  'tool.del': 'Supprimer',
  'tool.more': 'Plus',
  'tool.aria': 'Outils de sélection',

  /* ── Cadre de la bibliothèque ───────────────────────────── */
  'shelf.tab.library': 'Bibliothèque',
  'shelf.tab.notes': 'Notes',
  'shelf.act.search': 'Rechercher',
  'shelf.act.stats': 'Statistiques',
  'shelf.act.import': 'Importer des livres',
  'shelf.act.settings': 'Réglages',
  'shelf.back': 'Retour',

  /* ── Page bibliothèque ──────────────────────────────────── */
  'shelf.filter.all': 'Tous',
  'shelf.filter.reading': 'En cours',
  'shelf.filter.done': 'Terminés',
  'shelf.filter.new': 'Non lus',
  'shelf.filter.fav': 'Favoris',
  'shelf.sort.recent': 'Lecture récente',
  'shelf.sort.title': 'Titre',
  'shelf.sort.progress': 'Progression',
  'shelf.sort': 'Trier',
  'shelf.empty.all':
    'La bibliothèque est vide. Utilisez « Importer des livres » en haut à droite pour ajouter un EPUB, ou déposez un livre dans le coffre.',
  'shelf.empty.none': 'Aucun livre ne correspond. Essayez un autre mot-clé, ou ajoutez-en un avec « Importer des livres ».',
  'shelf.continue': 'Reprendre la lecture',
  'shelf.lastChapter': 'Dernière position : {chapter}',
  'shelf.lastPercent': 'Dernière position : {percent}%',
  'shelf.resume': 'Reprendre ›',
  'shelf.detail': 'Détails du livre',
  'shelf.search.ph': 'Rechercher un titre / auteur / rayon',
  'shelf.collapse': 'Réduire',
  'shelf.view.list': 'Liste',
  'shelf.view.grid': 'Couvertures',
  'shelf.shelfline': 'Rayons',
  'shelf.count': '{n} livres',
  'shelf.badge.done': 'Terminé',
  'shelf.missing': 'Fichier introuvable',
  'shelf.missing.tip': 'Le fichier n’est plus à sa place — cliquez pour le relocaliser',
  'shelf.more': 'Clic droit ou appui long pour plus',

  /* ── Réglages : bandeau À propos ────────────────────────── */
  'settings.about': 'À propos',
  'settings.about.version': 'Version inconnue',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Base',
  'settings.about.repo': 'Ouvrir le dépôt dans le navigateur',
  'settings.about.video': 'Tutoriel vidéo',
  'settings.about.videoTip': 'Regarder le tutoriel vidéo sur Bilibili',
  'settings.about.group': 'Communauté',
  'settings.about.groupTip': 'Cliquez pour copier le numéro du groupe, puis cherchez-le dans QQ',
  'settings.about.changelog': 'Journal des versions',
  'settings.about.changelogTip': 'Voir les changements de chaque version',

  /* ── Réglages : titres de groupe ────────────────────────── */
  'settings.grp.ui': 'Interface',
  'settings.grp.layout': 'Composition',
  'settings.grp.look': 'Apparence',
  'settings.grp.header': 'Barre d’outils',
  'settings.grp.tts': 'Lecture vocale',
  'settings.grp.marks': 'Surlignages',
  'settings.grp.ai': 'Assistant IA',
  'settings.grp.lic': 'Licence',
  'settings.grp.data': 'Données',
  'settings.grp.keys': 'Raccourcis',

  /* ── Réglages : interface ───────────────────────────────── */
  'settings.language': 'Langue',
  'settings.language.auto': 'Suivre Obsidian',

  /* ── Réglages : composition ─────────────────────────────── */
  'settings.font': 'Police',
  'settings.fontSize': 'Taille',
  'settings.lineHeight': 'Interligne',
  'settings.margin': 'Marges',
  'settings.align': 'Alignement',
  'settings.align.justify': 'Justifié',
  'settings.align.left': 'Gauche',
  'settings.direction': 'Sens',
  'settings.direction.h': 'Horizontal',
  'settings.direction.v': 'Vertical',
  'settings.columns': 'Colonnes',
  'settings.columns.1': 'Une',
  'settings.columns.2': 'Deux',
  'settings.footnote': 'Notes de bas de page',
  'settings.footnote.popup': 'Infobulle au-dessus',
  'settings.footnote.jump': 'Aller en fin de chapitre',

  /* ── Réglages : apparence ───────────────────────────────── */
  'settings.accent': 'Couleur d’accent',

  /* ── Réglages : barre d’outils ──────────────────────────── */
  'settings.header.hint': 'Choisit les icônes affichées ; les icônes masquées passent dans le menu ⋮ à droite. Trois au maximum sur mobile.',

  /* ── Réglages : lecture vocale ──────────────────────────── */
  'settings.ttsRate': 'Vitesse',
  'settings.ttsFollow': 'Après cette page',
  'settings.ttsFollow.on': 'Continuer',
  'settings.ttsFollow.off': 'S’arrêter ici',
  'settings.locked': 'Fonction Pro — cliquez pour voir ce qu’elle inclut',

  /* ── Réglages : surlignages ─────────────────────────────── */
  'settings.pen': 'Couleur par défaut',
  'settings.exportDir': 'Dossier d’export',
  'settings.pickFromList': 'Choisir dans la liste des dossiers',
  'settings.pick': 'Choisir…',
  'settings.exportComments': 'Inclure les notes dans l’export',

  /* ── Réglages : IA ──────────────────────────────────────── */
  'settings.ai.baseUrl': 'Fournisseur',
  'settings.ai.baseUrl.ph': 'URL du point d’accès, commençant par https://',
  'settings.ai.model': 'Modèle',
  'settings.ai.model.ph': 'Un nom de modèle utilisable par votre compte',
  'settings.ai.key': 'Clé',
  'settings.ai.key.ph': 'Clé API',

  /* ── Réglages : licence ─────────────────────────────────── */
  'settings.lic.status': 'État',
  'settings.lic.code': 'Code de licence',
  'settings.lic.relicense': 'Réactiver',
  'settings.lic.activate': 'Activer',
  'settings.lic.paid': 'Pro',
  'settings.lic.benefits': 'Export, statistiques, recherche multi-livres, IA, formats supplémentaires',
  'settings.lic.compare': 'Comparer les fonctions',

  /* ── 解锁弹层：功能对照表 ─────────────────────────────── */
  'unlock.title': 'Pro',
  'unlock.activated': 'Activé',
  'unlock.col.feature': 'Fonction',
  'unlock.col.base': 'Base',
  'unlock.col.pro': 'Pro',
  'unlock.part': 'Partiel',
  'unlock.buy': 'Acheter Pro',
  'unlock.group': 'QQ group {id}',
  'unlock.hint': 'Vous recevrez un code de licence après l’achat ; saisissez-le ci-dessous.',
  'unlock.haveCode': 'Déjà un code',

  /* ── Réglages : données ─────────────────────────────────── */
  'settings.importDir': 'Importer les livres dans',
  'settings.pickFolder': 'Choisir un dossier',
  'settings.dataDir': 'Dossier de données',
  'settings.backupRestore': 'Sauvegarde et restauration',
  'settings.backup': 'Sauvegarder',
  'settings.backup.tip': 'Écrit un fichier JSON dans le dossier de données',
  'settings.restore': 'Restaurer',
  'settings.restore.tip':
    'Restaurer depuis un fichier de sauvegarde (fusionne, n’écrase jamais la progression actuelle)',
  'settings.data.hint':
    'Une sauvegarde contient la bibliothèque, la progression, les surlignages, les favoris et les objectifs. Elle n’inclut ni le code de licence ni la clé IA — à ressaisir sur un nouvel appareil.',

  /* ── Réglages : raccourcis ──────────────────────────────── */
  'settings.key.unset': 'Non défini',
  'settings.key.tip': 'À modifier dans les raccourcis d’Obsidian',

  /* ── Noms courts pour les lignes de raccourcis ──────────── */
  'key.pageNext': 'Page suivante',
  'key.pagePrev': 'Page précédente',
  'key.open': 'Ouvrir la bibliothèque',
  'key.search': 'Rechercher (livre / bibliothèque)',
  'key.sidebar': 'Afficher le panneau latéral',
  'key.focus': 'Mode concentration',
  'key.fullscreen': 'Plein écran',
  'key.bookmark': 'Ajouter un signet',
  'key.typography': 'Typographie',
  'key.bookmap': 'Vue d’ensemble',
  'key.tts': 'Activer la lecture vocale',
  'key.continue': 'Reprendre la dernière lecture',

  /* ── AI 知识库（2026-11-07） ─────────────────── */
  'bz.missing': 'bz n\'est pas encore installé : installe-le depuis les plugins communautaires d\'Obsidian',
  'bz.noEmbedModel': 'Aucun modèle d’embedding choisi dans le Second Brain : choisissez-en un dans bz pour créer un index ici.',
  'settings.ai.kb': 'Se connecter à la base de connaissances BZ AI',
  'settings.ai.kb.on': 'Connecté',
  'settings.ai.kb.off': 'Non connecté',
  'settings.ai.kb.hint': 'Enregistrer un terme / passage depuis une sélection permet de construire un index vectoriel local du livre ; les questions tiennent aussi compte des notes de la bibliothèque.',
  'bz.disabled': 'bz est installé mais désactivé : active-le dans Paramètres → Modules complémentaires',
  'bz.outdated': 'Ta version de bz ({version}) est trop ancienne : mets-la à jour',
  'bz.callFailed': 'bz n\'a pas pris la requête : {message}',
  'bz.noFolder': 'Configure d\'abord le dossier de littérature dans bz, puis réessaie',
  'tool.term': 'Terme',
  'tool.passage': 'Passage',
  'notice.kb.term': 'Enregistré comme terme dans la base de connaissances',
  'notice.kb.passage': 'Enregistré comme passage dans la base de connaissances',
  'notice.kb.failed': 'Impossible d\'écrire dans la base : {message}',
  'side.ai.book.none': 'Ce livre n\'a pas encore de portrait : crées-en un pour répondre sur tout le livre.',
  'side.ai.embedNotReady': 'Les vecteurs viennent du Second Brain : activez bz, choisissez-y un modèle d’embedding, puis créez l’index.',
  'side.ai.book.noHit': 'Aucun passage de ce livre ne correspond : reformulez ou recréez l’index.',
  'side.ai.sources': 'Sources',
  'side.ai.source.chapter': 'Chapitre',
  'pt.plan.vector': 'A. Recherche vectorielle',
  'pt.plan.compress': 'B. Compression IA',
  'pt.estimate.vector': '{blocks} blocs, environ {requests} appels d\'embedding',
  'pt.estimate.compress': '{blocks} blocs, environ {requests} appels IA',
  'pt.start': 'Démarrer',
  'pt.close': 'Fermer',
  'pt.pause': 'Pause',
  'pt.resume': 'Reprendre',
  'pt.stop': 'Annuler',
  'pt.block': 'Bloc {done} / {total}',
  'pt.extract': 'Lecture du livre : chapitre {done} / {total}',
  'pt.retryFailed': 'Ne réessayer que les blocs en échec',
  'pt.failedBlocks': '{n} blocs en échec',
  'pt.mobile': 'Les portraits se construisent sur ordinateur ; ensuite ils marchent sur mobile.',
  'detail.portrait': 'Portrait du livre',
  'detail.portrait.none': 'non créé',
  'detail.portrait.ready': 'prêt',
  'detail.portrait.building': 'à moitié',
  'detail.portrait.stale': 'à reconstruire',
  'detail.portrait.open': 'Créer le portrait…',
  'pt.clean': 'Nettoyer les portraits orphelins',
  'pt.clean.empty': 'Aucun portrait orphelin : chacun correspond encore à un livre.',
  'pt.clean.confirm': 'Ces portraits ne correspondent plus à aucun livre. La suppression est définitive :',
  'ack.title': 'Ce qui est envoyé à l\'IA',
  'ack.body.book': 'La création de l’index envoie le livre entier, par blocs, à votre propre service d’embedding ; les questions n’envoient que les blocs retrouvés, plus des extraits de notes bz si le partage est activé.',
  'ack.ok': 'Compris',
  'notice.note.missing': 'Cette note n\'existe plus : {path}',
  'pt.blockCount': '{n} blocs',
  'pt.clean.done': '{n} portraits orphelins supprimés',
  'pt.needOpen': 'Un portrait lit tout le livre : ouvre-le d\'abord dans le lecteur',
  'side.ai.source.block': 'Bloc {n}',
  'side.ai.book.stale': 'Ce portrait a été créé avec un autre modèle d\'embedding : reconstruis-le, sinon les blocs récupérés ne correspondront pas.',
  'notice.portrait.busy': 'Another book is still building its index — stop that one first',
  'notice.import.tooBig': '{n} file(s) are too large — import them on a computer first',
  'menu.compare.title': 'Compare book: {title}',
  'menu.compare.none': 'None',
  'menu.compare.empty': 'No other books on the shelf yet',
  'menu.compare.more': '{n} more — filter the shelf first',
  'menu.para.close': 'Close side by side',
  'menu.tts.stop': 'Stop reading aloud',
  'menu.immersive.exit': 'Exit immersive mode',
};
