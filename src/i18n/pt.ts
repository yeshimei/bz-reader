/**
 * Textos em português (src/i18n/pt.ts)
 *
 * Critérios de redação:
 *   · Nomes de comando com prefixo de domínio (`Estante:` / `Leitura:`) — a paleta
 *     de comandos do Obsidian filtra palavra por palavra.
 *   · Avisos no particípio («Destaque adicionado»), nunca no gerúndio.
 *   · Erros dizem o que fazer em seguida; «falhou» sozinho não ajuda ninguém.
 *   · Nomes próprios sem tradução: bz Reader, Obsidian, GitHub, Markdown, EPUB, TXT, QQ.
 *
 * Variante brasileira: é onde está a maior parte dos usuários de língua portuguesa
 * do Obsidian, e as diferenças com Portugal (gerúndio, «ficheiro»/«arquivo»,
 * «ecrã»/«tela») aparecem justamente nos termos que usamos aqui.
 */
import type { MsgKey } from './zh';

export const PT: Record<MsgKey, string> = {
  /* ── Palavras comuns ────────────────────────────────────── */
  'common.default': 'padrão',
  'common.untitled': 'Sem título',
  'common.unknownError': 'Erro desconhecido',

  /* ── Entrada do plugin ──────────────────────────────────── */
  'ribbon.shelf': 'bz Reader: estante',

  /* ── Comandos: estante ──────────────────────────────────── */
  'cmd.open': 'Estante: abrir a estante',
  'cmd.continue': 'Estante: continuar a última leitura',
  'cmd.import': 'Estante: importar livros',
  'cmd.notes': 'Estante: notas',
  'cmd.stats': 'Estante: estatísticas',
  'cmd.prefs': 'Estante: configurações',

  /* ── Comandos: leitor ───────────────────────────────────── */
  'cmd.search': 'Leitura: pesquisar (livro / biblioteca)',
  'cmd.sidebar': 'Leitura: mostrar o painel lateral',
  'cmd.pageNext': 'Leitura: próxima página',
  'cmd.pagePrev': 'Leitura: página anterior',
  'cmd.focus': 'Leitura: modo concentração',
  'cmd.fullscreen': 'Leitura: tela cheia',
  'cmd.bookmark': 'Leitura: adicionar marcador',
  'cmd.typography': 'Leitura: tipografia',
  'cmd.bookmap': 'Leitura: visão geral do livro',
  'cmd.tts': 'Leitura: ativar a leitura em voz alta',
  'notice.needBook': 'Abra um livro primeiro e execute o comando de novo',
  'notice.language.changed': 'Idioma da interface alterado — os nomes dos comandos serão atualizados após reiniciar o Obsidian',

  /* ── Avisos: área de transferência ──────────────────────── */
  'notice.copy.ok': 'Copiado para a área de transferência',
  'notice.copy.failed': 'Falha ao copiar — use o atalho do sistema',

  /* ── Avisos: marcadores ─────────────────────────────────── */
  'notice.bookmark.noCfi': 'Esta página ainda não tem posição — vire uma página e tente de novo',
  'notice.bookmark.exists': 'Esta página já tem um marcador',
  'notice.bookmark.added': 'Marcador adicionado',

  /* ── Avisos: destaques e anotações ──────────────────────── */
  'notice.mark.created': 'Destaque em {color} adicionado',
  'notice.mark.recolored': 'Cor alterada: {color}',
  'notice.mark.notFound': 'Destaque não encontrado',
  'notice.mark.gone': 'Essa anotação não existe mais — pode ter sido excluída',
  'notice.mark.deleted': 'Destaque excluído',
  'notice.mark.deletedN': '{n} destaque(s) excluído(s)',
  'notice.mark.goneAll': 'Essas anotações não existem mais',
  'notice.idea.saved': 'Nota salva',
  'notice.idea.cleared': 'Nota apagada',

  /* ── Avisos: notas e exportação ─────────────────────────── */
  'notice.note.saved': 'Salvo em {path}',
  'notice.note.saveFailed': 'Não foi possível salvar a nota: {why}',
  'notice.export.needBook': 'Abra um livro primeiro ou exporte de um livro na aba de notas',
  'notice.export.empty': 'Nada para exportar — este livro não tem destaques nem marcadores',
  'notice.export.done': '{n} destaque(s) exportado(s) para {path}',
  'notice.export.failed': 'Falha ao exportar: {why}',
  'export.noData': '(Nada para exportar ainda)',
  'export.noNotes': '(Ainda sem destaques. Selecione um texto no leitor para começar.)',
  'export.loose': 'Fragmentos',

  /* ── Avisos: cartão de citação ──────────────────────────── */
  'notice.card.copied': 'Cartão de citação copiado como imagem',
  'notice.card.copyFailed': 'Não foi possível copiar a imagem',
  'notice.quote.empty': 'Nenhuma citação para salvar',

  /* ── Avisos: ações da estante ───────────────────────────── */
  'notice.fav.on': 'Adicionado aos favoritos',
  'notice.fav.off': 'Removido dos favoritos',
  'notice.rename.empty': 'Um título é obrigatório',
  'notice.rename.done': 'Título atualizado',
  'notice.book.removed': '«{title}» removido da estante',
  'notice.select.pick': 'Selecione primeiro alguns para excluir',
  'notice.rating.stars': 'Avaliado com {stars} estrelas',
  'notice.rating.done': 'Avaliação salva',
  'notice.status.reading': 'Marcado como em leitura',
  'notice.status.done': 'Marcado como concluído',
  'notice.ui.reset': 'Estado da interface redefinido',
  'notice.video.wip': 'O tutorial em vídeo ainda está em edição — avisaremos no grupo',

  /* ── Avisos: importação ─────────────────────────────────── */
  'notice.import.done': '{n} livro(s) adicionado(s)',
  'notice.import.failed': 'Não foi possível adicionar à estante: {why}',
  'notice.import.written': '{n} livro(s) importado(s) para {folder}',
  'notice.import.error': 'Falha ao importar: {why}',
  'notice.import.partial': '{failed} arquivo(s) não importado(s), {ok} importado(s)',

  /* ── Avisos: pesquisa ───────────────────────────────────── */
  'notice.search.empty': 'Digite algo para pesquisar',
  'notice.search.needBook': 'Abra um livro primeiro e pesquise dentro dele',
  'notice.search.failed': 'Falha na pesquisa: {why}',
  'notice.sel.empty': 'Nada selecionado para copiar',
  'notice.toc.missingChapter': 'Este capítulo não está mais no sumário — o arquivo pode ter mudado',

  /* ── Avisos: pastas ─────────────────────────────────────── */
  'notice.dir.exportRoot': 'A pasta de exportação não pode ser a raiz do cofre — escolha uma subpasta',
  'notice.dir.dataRoot': 'A pasta de dados não pode ser a raiz do cofre — escolha uma subpasta',
  'notice.migrate.running': 'Movendo arquivos…',
  'notice.goal.set': 'Meta diária definida para {n} minutos',

  /* ── Avisos: backup e restauração ───────────────────────── */
  'notice.backup.done': 'Backup criado em «{path}»',
  'notice.backup.failed': 'Falha no backup: {why}',
  'notice.restore.noPick': 'Nenhum arquivo selecionado',
  'notice.restore.unreadable': 'Não foi possível ler esse arquivo: {why}',
  'notice.restore.done': 'Restaurado — a estante agora tem {n} livro(s)',
  'notice.restore.dropped': ' ({n} registro(s) incompleto(s) ignorado(s))',

  /* ── Avisos: arquivo de dados ───────────────────────────── */
  'notice.data.broken': 'Não foi possível ler o arquivo de dados; uma cópia foi mantida como bz-reader.broken-*.json',
  'notice.data.brokenUnarchived': 'Não foi possível ler o arquivo de dados nem manter uma cópia; nada será salvo nesta sessão para não sobrescrever o original',
  'notice.data.dropped': '{n} registro(s) de livro sem caminho de arquivo; uma cópia foi mantida como bz-reader.dropped-*.json',
  'notice.data.loadFailed': 'Não foi possível carregar os dados de leitura; nada será salvo nesta sessão para que uma biblioteca vazia não sobrescreva o original',
  'notice.data.saveFailed': 'Não foi possível salvar os dados de leitura — verifique o espaço em disco',

  /* ── Avisos: pasta de dados e links ─────────────────────── */
  'notice.dataDir.multiple': 'Várias pastas de dados foram encontradas e não está claro qual usar; escolha uma nas configurações',
  'notice.dataDir.found': 'Pasta de dados recuperada: «{dir}»',
  'notice.link.bookMissing': 'O livro vinculado não está na estante — pode ter sido movido',
  'notice.link.cfiMiss': 'Não foi possível encontrar esse trecho; parado na última posição neste livro',
  'notice.noReadBook': 'Nenhum livro foi lido ainda',
  'notice.debug.link': '[bz diagnóstico] {type} · {href}',

  /* ── Avisos: leitor ─────────────────────────────────────── */
  'notice.compare.onlyOne': 'Só um livro na estante — a comparação lado a lado precisa de um segundo',
  'notice.compare.failed': 'Não foi possível abrir a comparação lado a lado: {why}',
  'notice.tts.noText': 'Não há texto para ler em voz alta nesta página',
  'notice.tts.unsupported': 'A leitura em voz alta não é compatível com este ambiente',
  'notice.open.unsupported': 'Formato não compatível',
  'fault.openFailed': 'Não foi possível abrir este livro',
  'notice.load.stalled': '{what} não terminou — tente de novo',
  'notice.locate.notReady': 'Esta página ainda não está localizada — vire uma página e tente de novo',
  'notice.bookmark.toggledOn': 'Marcador adicionado',
  'notice.bookmark.toggledOff': 'Marcador removido',

  /* ── Avisos: grupo (QQ) ─────────────────────────────────── */
  'notice.group.trialOk': 'Número do grupo {id} copiado — entre e peça a um administrador um código de teste de 7 dias',
  'notice.group.trialFail': 'Falha ao copiar. O grupo é {id} — entre e peça a um administrador um teste de 7 dias',
  'notice.group.plainOk': 'Número do grupo {id} copiado — pesquise no QQ para entrar',
  'notice.group.plainFail': 'Falha ao copiar. O grupo é {id} — pesquise no QQ para entrar',
};
