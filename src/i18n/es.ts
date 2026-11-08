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
  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.unknownError': 'Error desconocido',
  'common.dialog': 'Dialog',

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

  /* ── Avisos: modo inmersivo ──────────────────────────────── */
  'notice.immersive.exitDesktop': 'Immersive mode on. Press ESC to exit',
  'notice.immersive.exitMobile': 'Immersive mode on. Tap the page with two fingers to exit',

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
  'notice.book.archived': '«{title}» retirado de la estantería — datos conservados',
  'notice.book.revived': '{n} libro(s) restaurado(s) — progreso y subrayados vuelven',
  'notice.missing.found': 'Encontrado: {path}',
  'notice.missing.notFound': 'No hay copia de este archivo en la bóveda — elígelo manualmente',
  'notice.missing.wrong': 'Ese archivo no es el mismo libro (el contenido no coincide)',
  'notice.missing.picked': 'Reubicado en {path}',
  'notice.missing.tooBig': 'El archivo es demasiado grande para verificarlo — vuelve a ponerlo en la bóveda y usa «Buscar en la bóveda»',
  'notice.missing.noFingerprint': 'Este libro aún no tiene huella de contenido — elige el archivo una vez a mano y luego podrá buscarse solo',
  'notice.select.pick': 'Selecciona primero algunos para borrar',
  'notice.rating.stars': 'Valorado con {stars} estrellas',
  'notice.rating.done': 'Valoración guardada',
  'notice.status.reading': 'Marcado como en lectura',
  'notice.status.done': 'Marcado como terminado',
  'notice.ui.reset': 'Estado de la interfaz restablecido',

  /* ── Avisos: importación ────────────────────────────────── */
  'notice.import.done': '{n} libro(s) añadido(s)',
  'notice.import.failed': 'No se pudo añadir a la estantería: {why}',
  'notice.import.written': '{n} libro(s) importado(s) a {folder}',
  'notice.import.error': 'Error al importar: {why}',
  'notice.import.partial': '{failed} archivo(s) no importado(s), {ok} importado(s)',
  'notice.import.skipped': '{n} libro(s) ya en la estantería (mismo archivo) — omitido(s)',

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
  'notice.group.plainOk': 'Número de grupo {id} copiado: búscalo en QQ para unirte',
  'notice.group.plainFail': 'Error al copiar. El grupo es {id}: búscalo en QQ para unirte',
  /* Dev-build only: feedback from the tier toggle commands */
  'notice.dev.tier.free': 'Dev: switched to the free tier (test vault only)',
  'notice.dev.tier.paid': 'Dev: switched to the pro tier (test vault only)',
  'notice.dev.tier.real': 'Dev: real license restored',

  /* ── Estado de la licencia ──────────────────────────────── */
  'tier.base': 'Base',
  'tier.paid': 'Pro activado{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'válido hasta {date}',
  'tier.forever': 'permanente',

  /* ── Página de estadísticas ─────────────────────────────── */
  'stats.thisWeek': 'Esta semana',
  'stats.weeksAgo': 'hace {n} semanas',
  'stats.noRecord': 'Sin registro',
  'stats.minutes': '{n} min',
  'stats.days': '{n} días',
  'stats.kpi.streak': 'Racha de lectura · días',
  'stats.kpi.done': 'Terminados · libros',
  'stats.kpi.total': 'Tiempo total · horas',
  'stats.kpi.today': 'Hoy · minutos',
  'stats.goal.caption': 'Objetivo anual',
  'stats.goal.progress': '{done} / {goal} libros',
  'stats.goal.reached': 'Objetivo cumplido. Sube la cifra o elige un libro más difícil.',
  'stats.goal.remaining':
    'Faltan {n} libros este año. El objetivo solo mueve este anillo, nada más cambia.',
  'stats.goal.adjust': 'Ajustar objetivo',
  'stats.goal.poster': 'Póster del año',
  'stats.checkin': 'Registro diario',
  'stats.checkin.streak': 'Racha',
  'stats.checkin.today': 'Hoy',
  'stats.checkin.month': 'Este mes',
  'stats.checkin.goal': 'Objetivo diario',
  'stats.checkin.reached': 'Cumplido · {n} min',
  'stats.checkin.remaining': '{n} min, faltan {left} min',
  'stats.checkin.monthTitle': 'Registros de cada día de este mes',
  'stats.checkin.hint': 'Leer {n} minutos al día cuenta como registro.',
  'stats.checkin.doneToday': 'Hoy ya está marcado.',
  'stats.checkin.almost': 'Casi — diez minutos antes de dormir bastan.',
  'stats.heat': 'Últimas 20 semanas',
  'stats.heat.oldest': 'hace 20 semanas',
  'stats.heat.today': 'Hoy',
  'stats.heat.hint': 'Cuanto más brillante la celda, más larga la lectura.',
  'stats.heat.streak': '{n} días sin interrupción.',
  'stats.heat.noStreak': 'Aún sin racha.',
  'stats.weekly': 'Tiempo por semana',
  'stats.weekly.today': 'Tiempo de hoy',
  'stats.weekly.activeDays': 'Días con actividad',
  'stats.byBook': 'Tiempo por libro',
  'stats.byBook.empty': 'Aún no hay lecturas registradas.',
  'stats.empty':
    'Las estadísticas solo cuentan sesiones reales de lectura. Abre un libro unos minutos y esta página se iluminará.',
  'stats.locked': 'Las estadísticas de lectura son una función Pro.',
  'stats.lockedHint':
    'Tiempo total, mapa de calor, progreso por libro y libros terminados aparecerán aquí al desbloquear.',
  'stats.locked.cta': 'Ver qué añade Pro',

  /* ── Página de notas ────────────────────────────────────── */
  'notes.pick': 'Seleccionar',
  'notes.unpick': 'Anular selección',
  'notes.review.kick': 'R E V I S I Ó N   D I A R I A',
  'notes.review.title': 'Vuelve a este pasaje',
  'notes.review.next': 'Siguiente ›',
  'notes.jump': 'Volver al pasaje',
  'notes.bilink': 'Wikienlace',
  'notes.pro': 'Pro',
  'notes.filter.all': 'Todos',
  'notes.filter.comment': 'Con notas',
  'notes.selected': '{n} seleccionados',
  'notes.selectAll': 'Seleccionar todo',
  'notes.selectNone': 'Anular selección',
  'notes.exitSelect': 'Salir de la selección',
  'notes.delete': 'Eliminar',
  'notes.deleteN': 'Eliminar {n}',
  'notes.count': '{n}',
  'notes.exportThis': 'Exportar este libro',
  'notes.empty': 'No hay anotaciones coincidentes. Selecciona texto en el lector y elige un lápiz.',
  'notes.search.ph': 'Buscar subrayados, notas y títulos',
  'notes.summary': '{n} elementos · {ideas} con notas',
  'notes.select': 'Seleccionar',
  'notes.export': 'Exportar como Markdown',

  /* ── Panel lateral del lector ───────────────────────────── */
  'side.tab.toc': 'Índice',
  'side.tab.bookmarks': 'Marcadores',
  'side.tab.highlights': 'Subrayados',
  'side.expand': 'Expandir',
  'side.collapse': 'Contraer',
  'side.toc.count': '{n} secciones',
  'side.bookmarks.empty': 'Aún no hay marcadores.',
  'side.bookmarks.emptyHint': 'Donde te detengas, pulsa «Marcador» en la barra de lectura.',
  'side.bookmarks.order': 'En orden del libro',
  'side.delete': 'Eliminar',
  'side.highlights.empty': 'Aún no hay subrayados.',
  'side.highlights.emptyHint':
    'Selecciona texto en el libro y elige un lápiz entre los colores que aparecen.',
  'side.ideaTag': 'Nota',
  'side.ai.hint': 'Selecciona texto para preguntar a la IA, o pregunta por este libro aquí. Las respuestas se basan en los pasajes más relevantes del libro completo; no se envía la página actual.',
  'side.ai.notReady':
    'No hay ningún servicio de IA configurado. Rellena proveedor, modelo y clave en Estantería · Ajustes y este panel cobrará vida.',
  'side.ai.me': 'Yo',
  'side.ai.ask.ph': 'Pregunta sobre este libro…',
  'side.ai.ask': 'Preguntar',
  'side.ai.index.loading': 'Leyendo el índice…',
  'side.ai.index.lead': 'Primero crea un índice de este libro: las respuestas abarcarán todo el libro.',
  'side.ai.index.build': 'Crear índice',
  'side.ai.index.tutorial': 'Ver tutorial en vídeo',
  'side.ai.index.choose': 'Elige un método; no se inicia hasta que confirmes.',
  'side.ai.index.running': 'Creando índice',
  'side.ai.index.done': 'Índice listo: ya puedes preguntar.',
  'side.ai.index.rebuild': 'Recrear índice',
  'side.ai.rebuild.confirm': 'Recrear borra el índice actual de este libro y vuelve a calcularlo entero: no se puede pausar ni deshacer.',
  'side.ai.scope.book': 'Respuestas de todo el libro',
  'side.untitled': 'Sin título',
  'side.noBook': 'Ningún libro abierto',
  'side.empty': 'Este panel sigue tu lectura.',
  'side.emptyHint':
    'Abre un libro desde la estantería y su índice, marcadores y subrayados aparecerán aquí.',
  'side.toc.notReady': 'El índice aún no está listo.',
  'side.toc.openCurrent': 'Abrir este libro',

  /* ── Barra de selección ─────────────────────────────────── */
  'tool.idea': 'Nota',
  'ai.mode.explain': 'Explicar',
  'ai.mode.translate': 'Traducir',
  'ai.mode.summarize': 'Resumir',
  'tool.quote': 'Cita',
  'tool.ai': 'IA',
  'tool.bilink': 'Enlace',
  'tool.copy': 'Copiar',
  'tool.del': 'Eliminar',
  'tool.more': 'Más',
  'tool.aria': 'Herramientas de selección',

  /* ── Marco de la estantería ─────────────────────────────── */
  'shelf.tab.library': 'Biblioteca',
  'shelf.tab.notes': 'Notas',
  'shelf.act.search': 'Buscar',
  'shelf.act.stats': 'Estadísticas',
  'shelf.act.import': 'Importar libros',
  'shelf.act.settings': 'Ajustes',
  'shelf.back': 'Volver',

  /* ── Página de biblioteca ───────────────────────────────── */
  'shelf.filter.all': 'Todos',
  'shelf.filter.reading': 'En lectura',
  'shelf.filter.done': 'Terminados',
  'shelf.filter.new': 'Sin leer',
  'shelf.filter.fav': 'Favoritos',
  'shelf.sort.recent': 'Lectura reciente',
  'shelf.sort.title': 'Título',
  'shelf.sort.progress': 'Progreso',
  'shelf.sort': 'Ordenar',
  'shelf.empty.all':
    'La biblioteca está vacía. Usa «Importar libros» arriba a la derecha para añadir un EPUB, o arrastra un libro directamente a la bóveda.',
  'shelf.empty.none': 'Ningún libro coincide. Prueba otra palabra clave o añade uno con «Importar libros».',
  'shelf.continue': 'Continuar la lectura',
  'shelf.lastChapter': 'Última posición: {chapter}',
  'shelf.lastPercent': 'Última posición: {percent}%',
  'shelf.resume': 'Continuar ›',
  'shelf.detail': 'Detalles del libro',
  'shelf.search.ph': 'Buscar título / autor / estante',
  'shelf.collapse': 'Contraer',
  'shelf.view.list': 'Lista',
  'shelf.view.grid': 'Portadas',
  'shelf.shelfline': 'Estantes',
  'shelf.count': '{n} libros',
  'shelf.badge.done': 'Terminado',
  'shelf.missing': 'Archivo perdido',
  'shelf.missing.tip': 'El archivo ya no está en su sitio — pulsa para reubicarlo',
  'shelf.more': 'Clic derecho o pulsación larga para más',

  /* ── Ajustes: banda Acerca de ───────────────────────────── */
  'settings.about': 'Acerca de',
  'settings.about.version': 'Versión desconocida',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Base',
  'settings.about.repo': 'Abrir el repositorio en el navegador',
  'settings.about.video': 'Tutorial en vídeo',
  'settings.about.videoTip': 'Ver el tutorial en vídeo en Bilibili',
  'settings.about.group': 'Comunidad',
  'settings.about.groupTip': 'Haz clic para copiar el número del grupo y búscalo en QQ',
  'settings.about.changelog': 'Registro de versiones',
  'settings.about.changelogTip': 'Ver qué cambió en cada versión',

  /* ── Ajustes: títulos de grupo ──────────────────────────── */
  'settings.grp.ui': 'Interfaz',
  'settings.grp.layout': 'Composición',
  'settings.grp.look': 'Aspecto',
  'settings.grp.header': 'Barra de herramientas',
  'settings.grp.tts': 'Lectura en voz alta',
  'settings.grp.marks': 'Subrayados',
  'settings.grp.ai': 'Asistente de IA',
  'settings.grp.lic': 'Licencia',
  'settings.grp.data': 'Datos',
  'settings.grp.keys': 'Atajos',

  /* ── Ajustes: interfaz ──────────────────────────────────── */
  'settings.language': 'Idioma',
  'settings.language.auto': 'Seguir Obsidian',

  /* ── Ajustes: composición ───────────────────────────────── */
  'settings.font': 'Fuente',
  'settings.fontSize': 'Tamaño',
  'settings.lineHeight': 'Interlineado',
  'settings.margin': 'Márgenes',
  'settings.align': 'Alineación',
  'settings.align.justify': 'Justificado',
  'settings.align.left': 'Izquierda',
  'settings.direction': 'Dirección',
  'settings.direction.h': 'Horizontal',
  'settings.direction.v': 'Vertical',
  'settings.columns': 'Columnas',
  'settings.columns.1': 'Una',
  'settings.columns.2': 'Dos',
  'settings.footnote': 'Notas al pie',
  'settings.footnote.popup': 'Ventana emergente arriba',
  'settings.footnote.jump': 'Ir al final del capítulo',

  /* ── Ajustes: aspecto ───────────────────────────────────── */
  'settings.accent': 'Color de acento',

  /* ── Ajustes: barra de herramientas ─────────────────────── */
  'settings.header.hint': 'Elige qué iconos aparecen; los ocultos pasan al menú ⋮ de la derecha. En móvil, tres como máximo.',

  /* ── Ajustes: lectura en voz alta ───────────────────────── */
  'settings.ttsRate': 'Velocidad',
  'settings.ttsFollow': 'Tras esta página',
  'settings.ttsFollow.on': 'Seguir leyendo',
  'settings.ttsFollow.off': 'Detenerse aquí',
  'settings.locked': 'Función Pro: haz clic para ver qué incluye',

  /* ── Ajustes: subrayados ────────────────────────────────── */
  'settings.pen': 'Color predeterminado',
  'settings.exportDir': 'Carpeta de exportación',
  'settings.pickFromList': 'Elegir de la lista de carpetas',
  'settings.pick': 'Elegir…',
  'settings.exportComments': 'Incluir notas al exportar',

  /* ── Ajustes: IA ────────────────────────────────────────── */
  'settings.ai.baseUrl': 'Proveedor',
  'settings.ai.baseUrl.ph': 'URL del punto de acceso, empezando por https://',
  'settings.ai.model': 'Modelo',
  'settings.ai.model.ph': 'Un nombre de modelo que tu cuenta pueda usar',
  'settings.ai.key': 'Clave',
  'settings.ai.key.ph': 'Clave de API',

  /* ── Ajustes: licencia ──────────────────────────────────── */
  'settings.lic.status': 'Estado',
  'settings.lic.code': 'Código de licencia',
  'settings.lic.relicense': 'Reactivar',
  'settings.lic.activate': 'Activar',
  'settings.lic.paid': 'Pro',
  'settings.lic.benefits': 'Exportación, estadísticas, búsqueda entre libros, IA, más formatos',
  'settings.lic.compare': 'Comparar funciones',

  /* ── 解锁弹层：功能对照表 ─────────────────────────────── */
  'unlock.title': 'Pro',
  'unlock.activated': 'Activado',
  'unlock.col.feature': 'Función',
  'unlock.col.base': 'Base',
  'unlock.col.pro': 'Pro',
  'unlock.part': 'Parcial',
  'unlock.buy': 'Comprar Pro',
  'unlock.group': 'QQ group {id}',
  'unlock.hint': 'Tras la compra recibirás un código de licencia; introdúcelo abajo.',
  'unlock.haveCode': 'Ya tengo un código',

  /* ── Ajustes: datos ─────────────────────────────────────── */
  'settings.importDir': 'Importar libros en',
  'settings.pickFolder': 'Elegir una carpeta',
  'settings.dataDir': 'Carpeta de datos',
  'settings.backupRestore': 'Copia de seguridad y restauración',
  'settings.backup': 'Hacer copia',
  'settings.backup.tip': 'Escribe un archivo JSON en la carpeta de datos',
  'settings.restore': 'Restaurar',
  'settings.restore.tip':
    'Restaurar desde un archivo de copia (reemplazo completo: el estado actual no se conserva)',
  'settings.data.hint':
    'La copia incluye la estantería, el progreso, los subrayados, los favoritos y los objetivos. No incluye el código de licencia ni la clave de IA: vuelve a introducirlos en otro dispositivo.',

  /* ── Ajustes: atajos ────────────────────────────────────── */
  'settings.key.unset': 'Sin asignar',
  'settings.key.tip': 'Cámbialo en los atajos de Obsidian',

  /* ── Nombres cortos para las filas de atajos ────────────── */
  'key.pageNext': 'Página siguiente',
  'key.pagePrev': 'Página anterior',
  'key.open': 'Abrir la estantería',
  'key.search': 'Buscar (libro / biblioteca)',
  'key.sidebar': 'Mostrar el panel lateral',
  'key.focus': 'Modo concentración',
  'key.fullscreen': 'Pantalla completa',
  'key.bookmark': 'Añadir marcador',
  'key.typography': 'Tipografía',
  'key.bookmap': 'Vista general del libro',
  'key.tts': 'Activar la lectura en voz alta',
  'key.continue': 'Continuar la última lectura',

  /* ── AI 知识库（2026-11-07） ─────────────────── */
  'bz.missing': 'bz aún no está instalado: instálalo desde los plugins de la comunidad de Obsidian',
  'bz.noEmbedModel': 'El Second Brain aún no tiene modelo de embeddings: elige uno en bz para crear el índice aquí.',
  'settings.ai.kb': 'Conectar con la base de conocimiento BZ AI',
  'settings.ai.kb.on': 'Conectado',
  'settings.ai.kb.off': 'Sin conectar',
  'settings.ai.kb.hint': 'Guardar como término / pasaje desde una selección permite crear un índice vectorial local del libro; las preguntas también usan las notas de la biblioteca.',
  'bz.disabled': 'bz está instalado pero desactivado: actívalo en Ajustes → Complementos de la comunidad',
  'bz.outdated': 'Tu versión de bz ({version}) es demasiado antigua: actualízala',
  'bz.callFailed': 'bz no aceptó la solicitud: {message}',
  'bz.noFolder': 'Configura primero la carpeta de literatura en bz y vuelve a intentarlo',
  'tool.term': 'Término',
  'tool.passage': 'Párrafo',
  'notice.kb.term': 'Guardado como término en la caja de conocimiento',
  'notice.kb.passage': 'Guardado como párrafo en la caja de conocimiento',
  'notice.kb.failed': 'No se pudo escribir en la caja de conocimiento: {message}',
  'side.ai.book.none': 'Este libro aún no tiene retrato: créalo para responder con todo el libro.',
  'side.ai.embedNotReady': 'Los vectores los aporta el Second Brain: activa bz, elige allí un modelo de embeddings y crea el índice.',
  'side.ai.book.noHit': 'No hay ningún pasaje de este libro relacionado: prueba otra formulación o reconstruye el índice.',
  'side.ai.sources': 'Fuentes',
  'side.ai.source.chapter': 'Capítulo',
  'pt.plan.vector': 'A. Búsqueda vectorial',
  'pt.plan.compress': 'B. Compresión con IA',
  'pt.estimate.vector': '{blocks} bloques, unas {requests} llamadas de embedding',
  'pt.estimate.compress': '{blocks} bloques, unas {requests} llamadas de IA',
  'pt.start': 'Empezar',
  'pt.close': 'Cerrar',
  'pt.pause': 'Pausar',
  'pt.resume': 'Reanudar',
  'pt.stop': 'Cancelar',
  'pt.block': 'Bloque {done} / {total}',
  'pt.extract': 'Leyendo el libro: capítulo {done} / {total}',
  'pt.retryFailed': 'Reintentar solo los bloques fallidos',
  'pt.failedBlocks': '{n} bloques fallidos',
  'pt.mobile': 'Los retratos se crean en el ordenador; luego funcionan en el móvil.',
  'detail.portrait': 'Retrato del libro',
  'detail.portrait.none': 'sin crear',
  'detail.portrait.ready': 'listo',
  'detail.portrait.building': 'a medias',
  'detail.portrait.stale': 'hay que rehacerlo',
  'detail.portrait.open': 'Crear retrato…',
  'pt.clean': 'Limpiar retratos huérfanos',
  'pt.clean.empty': 'No hay retratos huérfanos: todos corresponden a un libro.',
  'pt.clean.confirm': 'Estos retratos ya no corresponden a ningún libro. Borrarlos es definitivo:',
  'ack.title': 'Qué se envía a la IA',
  'ack.body.book': 'Al crear el índice se envía el libro entero, por bloques, a tu propio servicio de embeddings; al preguntar solo se envían los bloques recuperados y, si la compartición está activa, fragmentos de notas de bz.',
  'ack.ok': 'Entendido',
  'notice.note.missing': 'Esa nota ya no está: {path}',
  'pt.blockCount': '{n} bloques',
  'pt.clean.done': '{n} retratos huérfanos eliminados',
  'pt.needOpen': 'Un retrato lee todo el libro: ábrelo primero en el lector',
  'side.ai.source.block': 'Bloque {n}',
  'side.ai.book.stale': 'Este retrato se creó con otro modelo de embeddings: vuelve a crearlo o los bloques recuperados no coincidirán.',
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
