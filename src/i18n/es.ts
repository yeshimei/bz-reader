/**
 * Textos en español (src/i18n/es.ts)
 *
 * Criterios de redacción:
 *   · Nombres de comando con prefijo de dominio (`Estantería:` / `Lectura:`) —
 *     la paleta de comandos de Obsidian filtra palabra por palabra.
 *   · Avisos en pretérito perfecto («Subrayado añadido»), nunca en presente.
 *   · Los errores dicen qué hacer después; «error» a secas no ayuda a nadie.
 *   · Nombres propios sin traducir: bz Reader, Obsidian, GitHub, Markdown, EPUB, TXT, QQ.
 *
 * Se usa español neutro (no `vosotros`), entendible en España y en Latinoamérica.
 * «Vault» se traduce como «bóveda», que es el término de Obsidian en español.
 */
import type { MsgKey } from './zh';

export const ES: Record<MsgKey, string> = {
  /* ── Palabras comunes ───────────────────────────────────── */
  'common.default': 'predeterminado',
  'common.untitled': 'Sin título',
  'common.unknownError': 'Error desconocido',

  /* ── Entrada del plugin ─────────────────────────────────── */
  'ribbon.shelf': 'bz Reader: estantería',

  /* ── Comandos: estantería ───────────────────────────────── */
  'cmd.open': 'Estantería: abrir la estantería',
  'cmd.continue': 'Estantería: continuar la última lectura',
  'cmd.import': 'Estantería: importar libros',
  'cmd.notes': 'Estantería: notas',
  'cmd.stats': 'Estantería: estadísticas',
  'cmd.prefs': 'Estantería: ajustes',

  /* ── Comandos: lector ───────────────────────────────────── */
  'cmd.search': 'Lectura: buscar (libro / biblioteca)',
  'cmd.sidebar': 'Lectura: mostrar el panel lateral',
  'cmd.pageNext': 'Lectura: página siguiente',
  'cmd.pagePrev': 'Lectura: página anterior',
  'cmd.focus': 'Lectura: modo concentración',
  'cmd.fullscreen': 'Lectura: pantalla completa',
  'cmd.bookmark': 'Lectura: añadir marcador',
  'cmd.typography': 'Lectura: tipografía',
  'cmd.bookmap': 'Lectura: vista general del libro',
  'cmd.tts': 'Lectura: activar la lectura en voz alta',
  'notice.needBook': 'Abre primero un libro y vuelve a ejecutar el comando',
  'notice.language.changed': 'Idioma de la interfaz cambiado: los nombres de los comandos se actualizarán al reiniciar Obsidian',

  /* ── Avisos: portapapeles ───────────────────────────────── */
  'notice.copy.ok': 'Copiado al portapapeles',
  'notice.copy.failed': 'Error al copiar: usa el atajo del sistema',

  /* ── Avisos: marcadores ─────────────────────────────────── */
  'notice.bookmark.noCfi': 'Esta página aún no tiene posición: pasa una página e inténtalo de nuevo',
  'notice.bookmark.exists': 'Esta página ya tiene un marcador',
  'notice.bookmark.added': 'Marcador añadido',

  /* ── Avisos: subrayados y anotaciones ───────────────────── */
  'notice.mark.created': 'Subrayado en {color} añadido',
  'notice.mark.recolored': 'Color cambiado: {color}',
  'notice.mark.notFound': 'Subrayado no encontrado',
  'notice.mark.gone': 'Esa anotación ya no existe: puede que se haya borrado',
  'notice.mark.deleted': 'Subrayado eliminado',
  'notice.mark.deletedN': '{n} subrayado(s) eliminado(s)',
  'notice.mark.goneAll': 'Esas anotaciones ya no existen',
  'notice.idea.saved': 'Nota guardada',
  'notice.idea.cleared': 'Nota borrada',

  /* ── Avisos: notas y exportación ────────────────────────── */
  'notice.note.saved': 'Guardado en {path}',
  'notice.note.saveFailed': 'No se pudo guardar la nota: {why}',
  'notice.export.needBook': 'Abre primero un libro o exporta desde un libro en la pestaña de notas',
  'notice.export.empty': 'No hay nada que exportar: este libro no tiene subrayados ni marcadores',
  'notice.export.done': '{n} subrayado(s) exportado(s) a {path}',
  'notice.export.failed': 'Error al exportar: {why}',
  'export.noData': '(Nada que exportar todavía)',
  'export.noNotes': '(Aún no hay subrayados. Selecciona texto en el lector para empezar.)',
  'export.loose': 'Fragmentos',

  /* ── Avisos: tarjeta de cita ────────────────────────────── */
  'notice.card.copied': 'Tarjeta de cita copiada como imagen',
  'notice.card.copyFailed': 'No se pudo copiar la imagen',
  'notice.quote.empty': 'No hay ninguna cita que guardar',

  /* ── Avisos: acciones de la estantería ──────────────────── */
  'notice.fav.on': 'Añadido a favoritos',
  'notice.fav.off': 'Quitado de favoritos',
  'notice.rename.empty': 'Se requiere un título',
  'notice.rename.done': 'Título actualizado',
  'notice.book.removed': '«{title}» eliminado de la estantería',
  'notice.select.pick': 'Selecciona primero algunos para borrar',
  'notice.rating.stars': 'Valorado con {stars} estrellas',
  'notice.rating.done': 'Valoración guardada',
  'notice.status.reading': 'Marcado como en lectura',
  'notice.status.done': 'Marcado como terminado',
  'notice.ui.reset': 'Estado de la interfaz restablecido',
  'notice.video.wip': 'El tutorial en vídeo aún se está editando: lo anunciaremos en el grupo',

  /* ── Avisos: importación ────────────────────────────────── */
  'notice.import.done': '{n} libro(s) añadido(s)',
  'notice.import.failed': 'No se pudo añadir a la estantería: {why}',
  'notice.import.written': '{n} libro(s) importado(s) a {folder}',
  'notice.import.error': 'Error al importar: {why}',
  'notice.import.partial': '{failed} archivo(s) no importado(s), {ok} importado(s)',

  /* ── Avisos: búsqueda ───────────────────────────────────── */
  'notice.search.empty': 'Escribe algo que buscar',
  'notice.search.needBook': 'Abre primero un libro y busca dentro de él',
  'notice.search.failed': 'Error en la búsqueda: {why}',
  'notice.sel.empty': 'No hay nada seleccionado que copiar',
  'notice.toc.missingChapter': 'Este capítulo ya no está en el índice: puede que el archivo haya cambiado',

  /* ── Avisos: carpetas ───────────────────────────────────── */
  'notice.dir.exportRoot': 'La carpeta de exportación no puede ser la raíz de la bóveda: elige una subcarpeta',
  'notice.dir.dataRoot': 'La carpeta de datos no puede ser la raíz de la bóveda: elige una subcarpeta',
  'notice.migrate.running': 'Moviendo archivos…',
  'notice.goal.set': 'Objetivo diario fijado en {n} minutos',

  /* ── Avisos: copia de seguridad y restauración ──────────── */
  'notice.backup.done': 'Copia de seguridad creada en «{path}»',
  'notice.backup.failed': 'Error en la copia de seguridad: {why}',
  'notice.restore.noPick': 'Ningún archivo seleccionado',
  'notice.restore.unreadable': 'No se pudo leer ese archivo: {why}',
  'notice.restore.done': 'Restaurado: la estantería tiene ahora {n} libro(s)',
  'notice.restore.dropped': ' ({n} registro(s) incompleto(s) omitido(s))',

  /* ── Avisos: archivo de datos ───────────────────────────── */
  'notice.data.broken': 'No se pudo leer el archivo de datos; se guardó una copia como bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': 'No se pudo leer el archivo de datos ni guardar una copia; no se guardará nada en esta sesión para no sobrescribir el original',
  'notice.data.dropped': '{n} registro(s) de libro sin ruta de archivo; se guardó una copia como bz-reader.dropped-*.json',
  'notice.data.loadFailed': 'No se pudieron cargar los datos de lectura; no se guardará nada en esta sesión para que una biblioteca vacía no sobrescriba el original',
  'notice.data.saveFailed': 'No se pudieron guardar los datos de lectura: comprueba el espacio en disco',

  /* ── Avisos: carpeta de datos y enlaces ─────────────────── */
  'notice.dataDir.multiple': 'Se encontraron varias carpetas de datos y no está claro cuál usar; elige una en los ajustes',
  'notice.dataDir.found': 'Carpeta de datos recuperada: «{dir}»',
  'notice.link.bookMissing': 'El libro enlazado no está en la estantería: puede que se haya movido',
  'notice.link.cfiMiss': 'No se encontró ese pasaje; se detuvo en tu última posición en este libro',
  'notice.noReadBook': 'Todavía no se ha leído ningún libro',
  'notice.debug.link': '[bz diagnóstico] {type} · {href}',

  /* ── Avisos: lector ─────────────────────────────────────── */
  'notice.compare.onlyOne': 'Solo hay un libro en la estantería: la comparación en paralelo necesita un segundo',
  'notice.compare.failed': 'No se pudo abrir la comparación en paralelo: {why}',
  'notice.tts.noText': 'No hay texto que leer en voz alta en esta página',
  'notice.tts.unsupported': 'La lectura en voz alta no es compatible con este entorno',
  'notice.open.unsupported': 'Formato no compatible',
  'fault.openFailed': 'No se puede abrir este libro',
  'notice.load.stalled': '{what} no terminó; inténtalo de nuevo',
  'notice.locate.notReady': 'Esta página aún no está localizada: pasa una página e inténtalo de nuevo',
  'notice.bookmark.toggledOn': 'Marcador añadido',
  'notice.bookmark.toggledOff': 'Marcador eliminado',

  /* ── Avisos: grupo (QQ) ─────────────────────────────────── */
  'notice.group.trialOk': 'Número de grupo {id} copiado: únete y pide a un administrador un código de prueba de 7 días',
  'notice.group.trialFail': 'Error al copiar. El grupo es {id}: únete y pide a un administrador una prueba de 7 días',
  'notice.group.plainOk': 'Número de grupo {id} copiado: búscalo en QQ para unirte',
  'notice.group.plainFail': 'Error al copiar. El grupo es {id}: búscalo en QQ para unirte',
};
