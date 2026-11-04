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
  'notice.book.removed': '« {title} » retiré de la bibliothèque',
  'notice.select.pick': 'Sélectionnez d’abord quelques éléments à supprimer',
  'notice.rating.stars': 'Noté {stars} étoiles',
  'notice.rating.done': 'Note enregistrée',
  'notice.status.reading': 'Marqué comme en cours de lecture',
  'notice.status.done': 'Marqué comme terminé',
  'notice.ui.reset': 'État de l’interface réinitialisé',
  'notice.video.wip': 'Le tutoriel vidéo est encore en montage — nous l’annoncerons dans le groupe',

  /* ── Notifications : import ─────────────────────────────── */
  'notice.import.done': '{n} livre(s) ajouté(s)',
  'notice.import.failed': 'Impossible d’ajouter à la bibliothèque : {why}',
  'notice.import.written': '{n} livre(s) importé(s) dans {folder}',
  'notice.import.error': 'Échec de l’import : {why}',
  'notice.import.partial': '{failed} fichier(s) non importé(s), {ok} importé(s)',

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
  'notice.group.trialOk': 'Numéro de groupe {id} copié — rejoignez-le et demandez un code d’essai de 7 jours à un administrateur',
  'notice.group.trialFail': 'Échec de la copie. Le groupe est {id} — rejoignez-le et demandez un essai de 7 jours à un administrateur',
  'notice.group.plainOk': 'Numéro de groupe {id} copié — recherchez-le dans QQ pour le rejoindre',
  'notice.group.plainFail': 'Échec de la copie. Le groupe est {id} — recherchez-le dans QQ pour le rejoindre',
};
