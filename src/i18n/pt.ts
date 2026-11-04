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

  /* ── Status da licença ──────────────────────────────────── */
  'tier.base': 'Base',
  'tier.paid': 'Pro ativado{who} · {until}',
  'tier.who': ' ({name})',
  'tier.until': 'válido até {date}',
  'tier.forever': 'permanente',

  /* ── Painel lateral do leitor ───────────────────────────── */
  'side.tab.toc': 'Sumário',
  'side.tab.bookmarks': 'Marcadores',
  'side.tab.highlights': 'Destaques',
  'side.expand': 'Expandir',
  'side.collapse': 'Recolher',
  'side.toc.count': '{n} seções',
  'side.bookmarks.empty': 'Ainda sem marcadores.',
  'side.bookmarks.emptyHint': 'Onde você parar, clique em «Marcador» na barra de leitura.',
  'side.bookmarks.order': 'Na ordem do livro',
  'side.delete': 'Excluir',
  'side.highlights.empty': 'Ainda sem destaques.',
  'side.highlights.emptyHint':
    'Selecione um texto no livro e escolha uma caneta entre as cores que aparecem.',
  'side.ideaTag': 'Nota',
  'side.ai.hint':
    'Selecione um trecho e toque no botão de IA da barra de seleção, ou pergunte diretamente sobre este livro. As respostas só usam o que você leu até aqui.',
  'side.ai.notReady':
    'Nenhum serviço de IA está configurado. Preencha provedor, modelo e chave em Estante · Configurações e este painel ganha vida.',
  'side.ai.me': 'Eu',
  'side.ai.ask.ph': 'Pergunte sobre este livro…',
  'side.ai.notReady.ph': 'IA não configurada',
  'side.ai.ask': 'Perguntar',
  'side.ai.scope': 'Só até a sua posição · {provider}',
  'side.ai.configHint': 'Configure em Estante · Configurações',
  'side.untitled': 'Sem título',
  'side.noBook': 'Nenhum livro aberto',
  'side.empty': 'Este painel acompanha a leitura.',
  'side.emptyHint':
    'Abra um livro na estante e o sumário, os marcadores e os destaques aparecerão aqui.',
  'side.toc.notReady': 'O sumário ainda não está pronto.',
  'side.toc.openCurrent': 'Abrir este livro',

  /* ── Barra de seleção ───────────────────────────────────── */
  'tool.idea': 'Nota',
  'tool.quote': 'Citação',
  'tool.ai': 'IA',
  'tool.bilink': 'Link',
  'tool.copy': 'Copiar',
  'tool.del': 'Excluir',
  'tool.more': 'Mais',
  'tool.aria': 'Ferramentas de seleção',

  /* ── Moldura da estante ─────────────────────────────────── */
  'shelf.tab.library': 'Biblioteca',
  'shelf.tab.notes': 'Notas',
  'shelf.act.search': 'Pesquisar',
  'shelf.act.stats': 'Estatísticas',
  'shelf.act.import': 'Importar livros',
  'shelf.act.settings': 'Configurações',
  'shelf.back': 'Voltar',

  /* ── Página da biblioteca ───────────────────────────────── */
  'shelf.filter.all': 'Todos',
  'shelf.filter.reading': 'Em leitura',
  'shelf.filter.done': 'Concluídos',
  'shelf.filter.new': 'Não lidos',
  'shelf.filter.fav': 'Favoritos',
  'shelf.sort.recent': 'Leitura recente',
  'shelf.sort.title': 'Título',
  'shelf.sort.progress': 'Progresso',
  'shelf.sort': 'Ordenar',
  'shelf.empty.all':
    'A biblioteca está vazia. Use «Importar livros» no canto superior direito para adicionar um EPUB, ou arraste um livro para o cofre.',
  'shelf.empty.none': 'Nenhum livro corresponde. Tente outra palavra-chave ou adicione um com «Importar livros».',
  'shelf.continue': 'Continuar a leitura',
  'shelf.lastChapter': 'Última posição: {chapter}',
  'shelf.lastPercent': 'Última posição: {percent}%',
  'shelf.resume': 'Continuar ›',
  'shelf.detail': 'Detalhes do livro',
  'shelf.search.ph': 'Pesquisar título / autor / estante',
  'shelf.collapse': 'Recolher',
  'shelf.view.list': 'Lista',
  'shelf.view.grid': 'Capas',
  'shelf.shelfline': 'Estantes',
  'shelf.count': '{n} livros',
  'shelf.badge.done': 'Concluído',
  'shelf.more': 'Clique com o botão direito ou toque e segure para mais',

  /* ── Configurações: faixa Sobre ─────────────────────────── */
  'settings.about': 'Sobre',
  'settings.about.version': 'Versão desconhecida',
  'settings.about.paid': 'Pro',
  'settings.about.base': 'Base',
  'settings.about.repo': 'Abrir o repositório no navegador',
  'settings.about.video': 'Tutorial em vídeo',
  'settings.about.wip': 'Em produção',
  'settings.about.videoTip': 'O tutorial ainda está em edição — avisaremos no grupo',
  'settings.about.group': 'Comunidade',
  'settings.about.groupTip': 'Clique para copiar o número do grupo e pesquise no QQ',
  'settings.about.changelog': 'Registro de versões',
  'settings.about.changelogTip': 'Ver o que mudou em cada versão',

  /* ── Configurações: títulos de grupo ────────────────────── */
  'settings.grp.ui': 'Interface',
  'settings.grp.layout': 'Composição',
  'settings.grp.look': 'Aparência',
  'settings.grp.header': 'Barra de ferramentas',
  'settings.grp.tts': 'Leitura em voz alta',
  'settings.grp.marks': 'Destaques',
  'settings.grp.ai': 'Assistente de IA',
  'settings.grp.lic': 'Licença',
  'settings.grp.data': 'Dados',
  'settings.grp.keys': 'Atalhos',

  /* ── Configurações: interface ───────────────────────────── */
  'settings.language': 'Idioma',
  'settings.language.auto': 'Seguir o Obsidian',
  'settings.language.hint':
    'Com «Seguir o Obsidian» o idioma do anfitrião decide. Uma escolha manual aplica-se logo à interface; os nomes dos comandos, após reiniciar o Obsidian.',

  /* ── Configurações: composição ──────────────────────────── */
  'settings.font': 'Fonte',
  'settings.fontSize': 'Tamanho',
  'settings.lineHeight': 'Entrelinha',
  'settings.margin': 'Margens',
  'settings.align': 'Alinhamento',
  'settings.align.justify': 'Justificado',
  'settings.align.left': 'Esquerda',
  'settings.direction': 'Direção',
  'settings.direction.h': 'Horizontal',
  'settings.direction.v': 'Vertical',
  'settings.columns': 'Colunas',
  'settings.columns.1': 'Uma',
  'settings.columns.2': 'Duas',
  'settings.footnote': 'Notas de rodapé',
  'settings.footnote.popup': 'Janela acima',
  'settings.footnote.jump': 'Ir para o fim do capítulo',

  /* ── Configurações: aparência ───────────────────────────── */
  'settings.accent': 'Cor de destaque',

  /* ── Configurações: barra de ferramentas ────────────────── */
  'settings.header.hint': 'Escolhe quais ícones aparecem; os ocultos vão para o menu ⋮ à direita. No celular, no máximo três.',

  /* ── Configurações: leitura em voz alta ─────────────────── */
  'settings.ttsRate': 'Velocidade',
  'settings.ttsFollow': 'Depois desta página',
  'settings.ttsFollow.on': 'Continuar lendo',
  'settings.ttsFollow.off': 'Parar aqui',
  'settings.locked': 'Recurso Pro — clique para ver o que inclui',

  /* ── Configurações: destaques ───────────────────────────── */
  'settings.pen': 'Cor padrão',
  'settings.exportDir': 'Pasta de exportação',
  'settings.pickFromList': 'Escolher da lista de pastas',
  'settings.pick': 'Escolher…',
  'settings.exportComments': 'Incluir notas na exportação',
  'settings.quoteLink': 'Link de citação',
  'settings.quoteLink.hint':
    'Copiado como wikilink [[book#location]] — cole numa nota e clique para voltar ao trecho; também aparece nos backlinks.',

  /* ── Configurações: IA ──────────────────────────────────── */
  'settings.ai.baseUrl': 'Provedor',
  'settings.ai.baseUrl.ph': 'URL do endpoint, começando com https://',
  'settings.ai.model': 'Modelo',
  'settings.ai.model.ph': 'Um nome de modelo que sua conta possa usar',
  'settings.ai.key': 'Chave',
  'settings.ai.key.ph': 'Chave de API',

  /* ── Configurações: licença ─────────────────────────────── */
  'settings.lic.status': 'Status',
  'settings.lic.code': 'Código de licença',
  'settings.lic.relicense': 'Reativar',
  'settings.lic.activate': 'Ativar',
  'settings.lic.paid': 'Pro',
  'settings.lic.benefits': 'Exportação, estatísticas, pesquisa entre livros, mais formatos',
  'settings.lic.compare': 'Comparar recursos',

  /* ── Configurações: dados ───────────────────────────────── */
  'settings.importDir': 'Importar livros para',
  'settings.pickFolder': 'Escolher uma pasta',
  'settings.dataDir': 'Pasta de dados',
  'settings.backupRestore': 'Backup e restauração',
  'settings.backup': 'Fazer backup',
  'settings.backup.tip': 'Grava um arquivo JSON na pasta de dados',
  'settings.restore': 'Restaurar',
  'settings.restore.tip':
    'Restaurar de um arquivo de backup (mescla, nunca sobrescreve o progresso atual)',
  'settings.data.hint':
    'O backup inclui a estante, o progresso, os destaques, os favoritos e as metas. Não inclui o código de licença nem a chave de IA — informe-os de novo em outro dispositivo.',

  /* ── Configurações: atalhos ─────────────────────────────── */
  'settings.key.unset': 'Não definido',
  'settings.key.tip': 'Altere nos atalhos do Obsidian',

  /* ── Nomes curtos para as linhas de atalhos ─────────────── */
  'key.pageNext': 'Próxima página',
  'key.pagePrev': 'Página anterior',
  'key.open': 'Abrir a estante',
  'key.search': 'Pesquisar (livro / biblioteca)',
  'key.sidebar': 'Mostrar o painel lateral',
  'key.focus': 'Modo concentração',
  'key.fullscreen': 'Tela cheia',
  'key.bookmark': 'Adicionar marcador',
  'key.typography': 'Tipografia',
  'key.bookmap': 'Visão geral do livro',
  'key.tts': 'Ativar a leitura em voz alta',
  'key.continue': 'Continuar a última leitura',
};
