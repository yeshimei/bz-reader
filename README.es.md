<div align="center">
  <p><sub><a href="README.md">简体中文</a> · <a href="README.md#english">English</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · Español · <a href="README.pt.md">Português</a></sub></p>
</div>

## Español

Convierte Obsidian en un lugar donde leer. Escritorio y móvil, varios formatos (incluido PDF), interfaz multilingüe, preguntas de IA sobre todo el libro, wikienlaces. Todos los datos se guardan en local.

### Instalación

Instalación desde el directorio comunitario (visible cuando pase la primera revisión):

1. Abre **Ajustes → Complementos de la comunidad** y desactiva el modo restringido.
2. Pulsa **Explorar**, busca **bz Reader** e instala.
3. Actívalo: aparece un icono bz en la cinta izquierda; empieza por la estantería.

Mientras la revisión esté pendiente, o si la búsqueda no lo encuentra, añade este repositorio con [BRAT](https://github.com/TfTHacker/obsidian42-brat), o descarga `main.js`, `manifest.json` y `styles.css` desde la Release y colócalos en `<tu bóveda>/.obsidian/plugins/bz-reader/`, luego actívalo.

### Funciones

| Categoría | Función | Base | Pro |
|---|:---|:---:|:---:|
| **Lectura y estantería** | EPUB / TXT listos para leer | ✓ | ✓ |
|  | Una o dos columnas | ✓ | ✓ |
|  | Índice, marcadores, cuatro colores de subrayado y notas | ✓ | ✓ |
|  | Búsqueda dentro del libro | ✓ | ✓ |
|  | Volver a la posición anterior: un toque tras cualquier salto | ✓ | ✓ |
|  | Notas al pie en ventana: sin salir de la página | ✓ | ✓ |
|  | Imágenes de tarjetas de cita | ✓ | ✓ |
|  | Gestión de categorías | ✓ | ✓ |
| **Formatos y exportación** | Familia Kindle (MOBI / AZW3), FB2, cómics en CBZ, PDF | — | ✓ |
|  | Subrayados como wikienlaces: volver al texto desde la nota | — | ✓ |
|  | Pestaña Citas: qué notas citan este libro | — | ✓ |
|  | Exportar todos los extractos, cada uno con un wikienlace | — | ✓ |
| **Lectura de PDF** | Abrir un PDF: zoom, rotación, una o dos páginas, desplazamiento; vista por libro | — | ✓ |
|  | Miniaturas: encontrar una página en un libro largo | — | ✓ |
|  | Copiar enlaces de página: página / vista / incrustación / anotación | — | ✓ |
|  | Retroenlaces de esta página y anotaciones del archivo | — | ✓ |
|  | Exportar una página como imagen | — | ✓ |
|  | OCR de páginas escaneadas: seleccionarlas, buscarlas y resaltarlas como texto | — | ✓ |
| **Estadísticas y búsqueda** | Panel de datos: tiempo, tendencias, ritmo, detalle por libro | — | ✓ |
|  | Póster de lectura: resumen anual e imagen larga | — | ✓ |
|  | Búsqueda en toda la biblioteca, texto de PDF incluido | — | ✓ |
| **IA** | IA: explicar, traducir, resumir y repreguntar — sobre una selección | — | ✓ |
|  | Preguntas IA sobre todo el libro: subrayados, texto de la página, capturas y notas como base | — | ✓ |
|  | Las conversaciones de IA se guardan y se pueden exportar a una nota | — | ✓ |
|  | Compañero IA: pregunta mientras lees, guía por capítulo | — | ✓ |
|  | Base de conocimiento IA: lectura incremental, entrada de conocimiento y un ciclo hasta la salida | — | ✓ |
| **Avanzado** | Composición vertical: EPUB / TXT | — | ✓ |
|  | Lectura en voz alta: EPUB, TXT y PDF, pasa de página sola | — | ✓ |
|  | Leer dos libros en paralelo | — | ✓ |
|  | Vista general del libro | — | ✓ |
|  | PDF reflow: fixed layouts read as flowing text | — | — |
|  | Manga mode: panels, right-to-left, spreads | — | — |
|  | Chapter translation: source and translation side by side | — | — |
|  | Review: reread in full, with AI flashcards and quizzes | — | — |
|  | E Ink optimization: crisper black and white, no page-turn flashing | — | — |
|  | Interface motion: page turns, chapter changes and shelf transitions, can be turned off | — | — |
|  | Clipbook to EPUB: bind clipped articles into one EPUB and read it on the shelf | — | — |

### Idiomas de la interfaz

La interfaz sigue el idioma de Obsidian, y también puedes elegir uno de los ocho en **Estantería → Ajustes → Interfaz**: 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

El cambio se aplica al instante en la interfaz; los nombres de comando, tras reiniciar Obsidian. El chino tradicional no es una conversión de glifos del simplificado: es un paquete aparte con vocabulario de Taiwán (設定 / 預設 / 匯入 / 匯出 / 檔案). **El registro de versiones es la única excepción**: se escribe a mano en cada publicación y solo existe en chino e inglés; los otros seis idiomas muestran las entradas en inglés.

### Funciones Pro

La edición base es gratuita. Las funciones Pro requieren una clave de licencia; el precio actual está en la [página de compra](https://wzyp.cn/shop/IFCEI5I3).

- La clave se introduce en **Estantería → Ajustes → Licencia**. Se verifica en local, sin llamada de red.
- No está ligada a un número de dispositivos: vuelve a introducirla en el nuevo dispositivo.
- Una sola compilación cubre escritorio y móvil; no hace falta comprar dos veces.

### Cómo funciona la IA

- Cada libro mantiene en local un **retrato** (fragmentos + vectores / resúmenes).
- Una pregunta pasa primero por el **enrutamiento** y después por la **búsqueda híbrida**; solo entran en el prompt las evidencias que caben en el presupuesto.
- La respuesta llega por SSE y luego se somete a una **verificación de citas**.

#### Por qué los embeddings vienen de bz

- El plugin se distribuye en tres archivos (`main.js`, `manifest.json`, `styles.css`) y no puede incluir pesos de modelo ni un entorno de ejecución. Un modelo pequeño fijo limitaría la precisión de búsqueda de todos.
- La capa de embeddings la proporciona bz (Second Brain). Tú eliges el modelo: uno local más pesado o un servicio en la nube. Más potencia permite un modelo más preciso y ubicaciones más exactas.
- Los fragmentos del libro y las notas deben compartir un mismo **espacio vectorial** (las notas encontradas también son evidencia). Si el nombre del modelo difería del de bz, antes se producían resultados **silenciosamente erróneos**.
- bz entrega y registra el nombre del modelo; al cambiarlo, los retratos antiguos quedan invalidados. Los vectores siguen en `portraits/` en local.

#### Retrato y fragmentación

- `portraits/<id del libro>.json`: `plan / model / dim / chunkChars / overlap / blocks[] / overview / guides / done`; cada bloque guarda `chapter / vec / digest / summary / text`.
- Vectores en **Float32Array** base64, similitud coseno calculada en local, escrituras atómicas; caché **LRU** de 50 vectores de consulta.
- Fragmentación por párrafos, con ajuste en el inicio de capítulo.
- **A Búsqueda vectorial**: 1000 caracteres por bloque, 120 de solapamiento, 8 bloques por lote. **B Compresión de información**: 8000 caracteres por bloque, condensados por el modelo de chat, fuera de la búsqueda vectorial.
- Solo un libro a la vez, no disponible en móvil.

#### Búsqueda híbrida y reordenación

- **Canal literal**: bigramas chinos con **BM25** (k1 1,2 / b 0,75), campo de nombre de capítulo ponderado ×2,5.
- **Canal vectorial**: consulta reformulada, búsqueda de vecinos, umbral absoluto 0,2 / relativo 0,6.
- **Fusión RRF por rango** (k = 60): coseno y BM25 no son comparables, así que se fusionan rangos sin normalizar puntuaciones.
- **Cierre adaptativo**: suelo 3 / techo 30 / rel 0,3 / abs 1e-4, deduplicado por capítulo.
- **Extensión a vecinos**: los bloques ±1 alrededor de los tres mejores candidatos entran con peso 0,85; **compensación de inicio de capítulo** conserva el primer bloque del capítulo encontrado.
- **Presupuesto**: top 6 / 8000 caracteres; búsqueda semántica entre libros: 3 por libro, 20 en total.

#### Enrutamiento estructural, generación y verificación

- **Mapa de capítulos**: una línea por capítulo, números de sección sustituidos por nombres reales, puntuación literal 3/1, «capítulo N» como condición estricta, sin llamadas al modelo.
- **Lectura de capítulo completo**: índice:texto 3:7, al menos 600 caracteres por capítulo, truncamiento señalado; para preguntas sobre todo el libro, `bookSpread` toma muestras de cada capítulo.
- **Barrera anti-spoiler**: corta en el último bloque del capítulo actual y vacía la visión general; común a las tres vías y a las continuaciones, desactivada por defecto.
- **Prompt**: 8000 caracteres de evidencia y las últimas 6 rondas; citas entre 「」 con nombre de capítulo.
- **SSE en flujo**: `TextDecoder(stream:true)` para UTF-8 partido, tiempo de espera medido entre bytes, actualización del DOM limitada a 80 ms, respuestas a medias conservadas.
- **Verificación de citas**: los pasajes de 4–80 caracteres se comparan con las evidencias realmente enviadas (solapamiento de bigramas ≥ 0,8); los cortos deben coincidir exactamente; hasta 8 fuentes con salto al pasaje.

#### Vía IA pura sin índice

- Explicar / traducir / resumir: solo se envía la selección (resumen ≤100, explicación ≤120 caracteres).
- Continuación: texto original ≤2000 caracteres + opcionalmente 3 bloques / 1200 caracteres; consulta = 120 caracteres antes del subrayado + pregunta actual.
- Contexto de la barra lateral: 1200 caracteres por elemento, 6000 en total.

### PDF escaneados: anotar y buscar

- **OCR**: el menú «Reconocer páginas escaneadas» ofrece esta página / las siguientes 20 / todo el libro / reintentar fallidas. Proceso secuencial, 20 páginas por lote. Modelo de visión o servicio OCR propio / de red local (en móvil solo visión). El procesamiento completo pide confirmación porque las páginas se facturan.
- **Resultado**: un JSON auxiliar por libro, por defecto `bz-reader/storage/ocr/<id del libro>.json` (carpeta de datos configurable); el PDF no se toca. Los resultados sobreviven al reinicio; las páginas fallidas se guardan para «reintentar N páginas», sin reintento automático.
- **Capa de texto**: las líneas reconocidas se colocan como una capa transparente y seleccionable sobre el escaneo. Solo las páginas con cajas de línea permiten seleccionar texto; las que solo tienen texto se pueden leer y buscar, pero no seleccionar.
- **Anotaciones**: las páginas OCR usan los mismos subrayados, cuatro colores, notas y wikilinks que los PDF normales; ancla = «número de página + desplazamiento de carácter en la capa de texto». Sin capa de texto, arrastrar crea un rectángulo, con notas, enlaces y exportación a tarjeta de cita; el texto citado requiere OCR.
- **Búsqueda**: la búsqueda literal en toda la biblioteca y dentro del PDF leen el JSON directamente, sin reconstruir índices. Los resultados saltan a la página y dibujan rectángulos en la capa transparente; 40 resaltados por página, 300 resultados en total y 50 por libro.
- **Búsqueda semántica**: necesita un retrato. Su texto viene del OCR página por página, así que el OCR debe hacerse **antes** de construir el retrato; las páginas reconocidas después exigen reconstruirlo. El retrato debe estar completo y el modelo de embeddings coincidir. Un resultado semántico no tiene ancla exacta: al abrirlo se relanza una búsqueda de texto con el fragmento.

### Lectura en voz alta: cómo funciona

- **Texto**: EPUB / TXT usan el pasaje visible o un capítulo entero; PDF solo lee la capa de texto de la página actual, las páginas escaneadas requieren OCR previo y no hay pregeneración por capítulo en PDF.
- **Tres motores**: voz del sistema (sin conexión, sin caché ni precarga), en línea (endpoint oficial o compatible con OpenAI) y servicio de voz propio. Los ajustes de TTS son independientes de los de IA; en móvil se fuerza el modo en línea.
- **Segmentación**: separar narración y diálogo, y cortar por puntuación; objetivo 240 caracteres, las frases largas retroceden a una coma, los fragmentos cortos se unen, los fragmentos solo de símbolos no se leen. Voz del sistema: 220 / 4000 caracteres.
- **Reproducción**: audio frase por frase con avance automático; precarga de 3 frases (el servicio local prepara todo el capítulo), como máximo 2 peticiones simultáneas; cambiar de posición solo cancela peticiones obsoletas, no la precarga. Las frases rechazadas se omiten, un fallo de precarga se reintenta una vez en silencio, los demás fallos se detienen con «Seguir escuchando».
- **Caché**: clave formada por libro + motor + modelo + voz + texto, guardada en local; un acierto solo actualiza la marca de tiempo. 300 MB por defecto, ajustable hasta 2 GB.
- **Resaltado**: en línea y local, cada frase se proyecta sobre el texto mediante un ancla, sin eventos de voz ni temporizadores; el audio sin conexión por capítulo usa un eje temporal, la voz del sistema una devolución de llamada de inicio.
- **Pregeneración**: el audio de un capítulo se une en un archivo con una lista de tiempos y rangos de bytes por frase; escritura atómica y verificación por relectura. Seis estados (cola / síntesis / empaquetado / listo / cancelado / error), sin estimación de tiempo; la parada surte efecto en límites de frase; la caché es el progreso y puede continuarse o rehacerse. Por capítulo es Pro; todo el libro solo con motor local y no en móvil.
- **Escucha sin conexión**: copiar la carpeta completa (audio + manifiesto) en `bz-reader/offline/` dentro del vault. Solo se explora un nivel, primero por título y después por ID del libro; copiar solo mp3 no funciona. La reproducción corta por rangos de bytes o, si faltan, reproduce el capítulo completo con eje temporal; un texto editado se realinea y se pasa al capítulo siguiente automáticamente.
- **Continuar**: solo se guarda la última posición al detenerse, en local y a nivel de frase. Restauración: mismo capítulo con desplazamiento → buscar en todo el capítulo → inicio de página. La posición no viaja a otro dispositivo.

### Acceso a la red

Solo las funciones de IA y la lista de mecenas de «Apoyar al autor» se conectan; todo lo demás funciona sin conexión.

- Las peticiones van al punto de acceso compatible con OpenAI que configures (tu propio servidor o una API de terceros). El plugin no tiene servidor propio.
- Al construir el índice del libro se envía el texto por bloques a tu servicio de embeddings; una pregunta solo envía los pocos bloques recuperados, y cuando hace falta el título del libro, el nombre del capítulo y los últimos turnos. Los vectores y el índice se quedan en la carpeta del plugin y no se suben.
- Los embeddings los aporta el plugin bz (segundo cerebro): sin él no hay búsqueda vectorial, solo la vía de los puntos clave condensados.
- Tu clave de API se guarda con el resto de ajustes en `data.json`, dentro de la carpeta del plugin. Nunca se envía al autor; solo viaja al punto de acceso que hayas configurado, como cabecera de la petición.
- Al abrir «Apoyar al autor» (y el registro de cambios) se carga una lista pública de mecenas: el mismo JSON estático de GitHub y Gitee a la vez, gana la primera respuesta. Solo se recoge esa lista, sin datos personales ni estadísticas. La lista se guarda en caché local; si fallan las dos fuentes, aparece «No se pudo cargar la lista» con un botón para reintentar. La lista es pública e idéntica en los dos plugins.

### Preguntas frecuentes

- **¿Qué formatos?** EPUB y TXT de serie; mobi, azw3, fb2, cómic y PDF con Pro.
- **¿Choca con otros plugins?** El lector es una vista nativa de Obsidian y el índice una pestaña del panel lateral izquierdo. Los subrayados se copian como enlaces Markdown con posición que vuelven al pasaje exacto: no se construye ningún índice aparte.
- **¿Cambio de ordenador?** La bóveda se lleva la estantería, el progreso y las anotaciones. Vuelve a introducir la clave de licencia en el nuevo dispositivo.
- **¿Pago otra vez en el móvil?** No. Una sola compilación cubre escritorio y móvil.

### Plugins recomendados

- [bz](https://github.com/yeshimei/bz) — Diario, notas, libros y películas, juegos, recortes web, pomodoro, repaso, cifrado seguro, base de conocimiento con IA, dock de herramientas y un gato de escritorio.

### Licencia

Publicado bajo licencia [MIT](LICENSE). El motor de renderizado es [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distribuido como dependencia npm; parches locales en [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).
