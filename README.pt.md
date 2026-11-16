<div align="center">
  <p><sub><a href="README.md">简体中文</a> · <a href="README.md#english">English</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · Português</sub></p>
</div>

## Português

Transforme o Obsidian num lugar para ler. Desktop e celular, vários formatos (incluindo PDF), interface multilíngue, perguntas de IA sobre o livro inteiro, wikilinks. Todos os dados ficam locais.

### Instalação

Instalação pelo diretório da comunidade (visível quando a primeira revisão passar):

1. Abra **Configurações → Plugins da comunidade** e desative o modo restrito.
2. Clique em **Procurar**, pesquise **bz Reader** e instale.
3. Ative — um ícone bz aparece na faixa da esquerda; comece pela estante.

Enquanto a revisão estiver pendente, ou se a busca não encontrar, adicione este repositório com o [BRAT](https://github.com/TfTHacker/obsidian42-brat), ou baixe `main.js`, `manifest.json` e `styles.css` do Release e coloque em `<seu cofre>/.obsidian/plugins/bz-reader/`, depois ative.

### Recursos

| Categoria | Recurso | Base | Pro |
|---|:---|:---:|:---:|
| **Leitura e estante** | EPUB / TXT prontos para ler | ✓ | ✓ |
|  | Uma ou duas colunas | ✓ | ✓ |
|  | Sumário, marcadores, quatro cores de destaque e notas | ✓ | ✓ |
|  | Pesquisa dentro do livro | ✓ | ✓ |
|  | Voltar à posição anterior: um toque depois de qualquer salto | ✓ | ✓ |
|  | Notas de rodapé em pop-up: sem sair da página | ✓ | ✓ |
|  | Imagens de cartões de citação | ✓ | ✓ |
|  | Gestão de categorias | ✓ | ✓ |
| **Formatos e exportação** | Família Kindle (MOBI / AZW3), FB2, quadrinhos em CBZ, PDF | — | ✓ |
|  | Destaques como wikilinks: voltar ao texto pela nota | — | ✓ |
|  | Aba Citações: quais notas citam este livro | — | ✓ |
|  | Exportar todos os excertos, cada um com um wikilink | — | ✓ |
| **Leitura de PDF** | Abrir um PDF: zoom, rotação, uma ou duas páginas, rolagem; vista por livro | — | ✓ |
|  | Miniaturas: achar uma página num livro longo | — | ✓ |
|  | Copiar links de página: página / vista / incorporação / anotação | — | ✓ |
|  | Retrolinks desta página e anotações do arquivo | — | ✓ |
|  | Exportar uma página como imagem | — | ✓ |
|  | OCR de páginas digitalizadas: selecioná-las, pesquisá-las e destacá-las como texto | — | ✓ |
| **Estatísticas e busca** | Painel de dados: tempo, tendências, ritmo, detalhe por livro | — | ✓ |
|  | Pôster de leitura: resumo anual e imagem longa | — | ✓ |
|  | Pesquisa em toda a biblioteca, texto de PDF incluído | — | ✓ |
| **IA** | IA: explicar, traduzir, resumir e perguntar de novo — numa seleção | — | ✓ |
|  | Perguntas IA sobre o livro inteiro: destaques, texto da página, capturas e notas como base | — | ✓ |
|  | As conversas de IA ficam guardadas e podem ser exportadas para uma nota | — | ✓ |
|  | Companheiro IA: pergunte enquanto lê, guia por capítulo | — | ✓ |
|  | Base de conhecimento IA: leitura incremental, entrada de conhecimento e um ciclo até a saída | — | ✓ |
| **Avançado** | Composição vertical: EPUB / TXT | — | ✓ |
|  | Leitura em voz alta: EPUB, TXT e PDF, vira a página sozinha | — | ✓ |
|  | Ler dois livros lado a lado | — | ✓ |
|  | Visão geral do livro | — | ✓ |
|  | PDF reflow: fixed layouts read as flowing text | — | — |
|  | Manga mode: panels, right-to-left, spreads | — | — |
|  | Chapter translation: source and translation side by side | — | — |
|  | Review: reread in full, with AI flashcards and quizzes | — | — |
|  | E Ink optimization: crisper black and white, no page-turn flashing | — | — |
|  | Interface motion: page turns, chapter changes and shelf transitions, can be turned off | — | — |
|  | Clipbook to EPUB: bind clipped articles into one EPUB and read it on the shelf | — | — |

### Idiomas da interface

A interface segue o idioma do Obsidian, e você também pode escolher um dos oito em **Estante → Configurações → Interface**: 简体中文, 繁體中文, English, 日本語, Deutsch, Français, Español, Português.

A troca vale na hora para a interface; os nomes dos comandos, após reiniciar o Obsidian. O chinês tradicional não é conversão de glifos do simplificado: é um pacote separado com vocabulário de Taiwan (設定 / 預設 / 匯入 / 匯出 / 檔案). **O registro de versões é a única exceção**: é escrito à mão a cada lançamento e só existe em chinês e inglês; os outros seis idiomas mostram os itens em inglês.

### Recursos Pro

A edição base é gratuita. Os recursos Pro exigem uma chave de licença; o preço atual está na [página de compra](https://wzyp.cn/shop/IFCEI5I3).

- A chave é informada em **Estante → Configurações → Licença**. A verificação é local, sem chamada de rede.
- Não está atrelada a um número de dispositivos: basta informá-la de novo no novo aparelho.
- Uma única compilação cobre desktop e celular — sem compra dupla.

### Como funciona a IA

- Cada livro mantém localmente um **retrato** (pedaços + vetores / resumos).
- Uma pergunta passa primeiro pelo **roteamento** e depois pela **busca híbrida**; só entram no prompt as evidências dentro do orçamento.
- A resposta volta por SSE e passa depois por uma **verificação de citações**.

#### Por que os embeddings vêm do bz

- O plugin é distribuído em três arquivos (`main.js`, `manifest.json`, `styles.css`) e não pode incluir pesos de modelo nem um runtime. Um modelo pequeno fixo limitaria a precisão da busca para todos.
- A camada de embeddings vem do bz (Second Brain). Você escolhe o modelo: um modelo local mais pesado ou um serviço em nuvem. Mais capacidade de cálculo permite um modelo mais forte e acertos mais precisos.
- Os trechos do livro e as notas precisam estar no mesmo **espaço vetorial** (notas encontradas também são evidência). Um nome de modelo diferente do do bz produzia antes resultados **silenciosamente errados**.
- O bz fornece e registra o nome do modelo; ao trocá-lo, os retratos antigos são invalidados. Os vetores ficam apenas em `portraits/` no dispositivo.

#### Retrato e divisão em pedaços

- `portraits/<id do livro>.json`: `plan / model / dim / chunkChars / overlap / blocks[] / overview / guides / done`; cada bloco guarda `chapter / vec / digest / summary / text`.
- Vetores em **Float32Array** base64, similaridade de cosseno calculada localmente, escritas atômicas; cache **LRU** de 50 vetores de consulta.
- A divisão segue limites de parágrafo, com ajuste no início do capítulo.
- **A Busca vetorial**: 1000 caracteres por bloco, 120 de sobreposição, 8 blocos por lote. **B Compressão de informação**: 8000 caracteres por bloco, condensados pelo modelo de conversa, fora da busca vetorial.
- Apenas um livro por vez, indisponível no celular.

#### Busca híbrida e reordenação

- **Canal literal**: bigramas chineses com **BM25** (k1 1,2 / b 0,75), campo de nome de capítulo com peso ×2,5.
- **Canal vetorial**: consulta reformulada, busca de vizinhos, limite absoluto 0,2 / relativo 0,6.
- **Fusão RRF por posição** (k = 60): cosseno e BM25 não são comparáveis, então as posições são fundidas sem normalizar pontuações.
- **Fechamento adaptativo**: piso 3 / teto 30 / rel 0,3 / abs 1e-4, deduplicado por capítulo.
- **Expansão para vizinhos**: blocos ±1 em torno dos três melhores candidatos entram com peso 0,85; **compensação de início de capítulo** mantém o primeiro bloco do capítulo encontrado.
- **Orçamento**: top 6 / 8000 caracteres; busca semântica entre livros: 3 por livro, 20 no total.

#### Roteamento estrutural, geração e verificação

- **Mapa de capítulos**: uma linha por capítulo, números de seção substituídos pelos nomes reais, pontuação literal 3/1, «capítulo N» como condição rígida, sem chamada de modelo.
- **Leitura do capítulo inteiro**: sumário:texto 3:7, pelo menos 600 caracteres por capítulo, truncamento sinalizado; para perguntas sobre todo o livro, `bookSpread` amostra cada capítulo.
- **Barreira anti-spoiler**: corta no último bloco do capítulo atual e limpa a visão geral; comum às três rotas e às continuações, desligada por padrão.
- **Prompt**: 8000 caracteres de evidência e as últimas 6 rodadas; citações entre 「」 com nome do capítulo.
- **SSE em fluxo**: `TextDecoder(stream:true)` para UTF-8 dividido, tempo medido entre bytes, atualização do DOM limitada a 80 ms, resposta parcial preservada.
- **Verificação de citações**: trechos de 4–80 caracteres são comparados com as evidências realmente enviadas (sobreposição de bigramas ≥ 0,8); os curtos devem coincidir exatamente; até 8 fontes, com salto para o trecho.

#### Caminho IA puro sem índice

- Explicar / traduzir / resumir: apenas a seleção é enviada (resumo ≤100, explicação ≤120 caracteres).
- Continuação: texto original ≤2000 caracteres + opcionalmente 3 blocos / 1200 caracteres; consulta = 120 caracteres antes do destaque + pergunta atual.
- Contexto da barra lateral: 1200 caracteres por item, 6000 no total.

### PDF escaneado: anotar e buscar

- **OCR**: o menu «Reconhecer páginas escaneadas» oferece esta página / as próximas 20 / todo o livro / tentar novamente as falhas. Processamento sequencial, 20 páginas por lote. Modelo de visão ou serviço OCR próprio / da rede local (no celular, apenas visão). O processamento completo pede confirmação porque as páginas são cobradas.
- **Resultado**: um JSON auxiliar por livro, por padrão `bz-reader/storage/ocr/<id do livro>.json` (pasta de dados configurável); o PDF não é alterado. Os resultados sobrevivem ao reinício; as páginas com falha ficam registradas para «tentar N páginas novamente», sem tentativa automática.
- **Camada de texto**: as linhas reconhecidas são colocadas como uma camada transparente e selecionável sobre a digitalização. Só páginas com caixas de linha permitem selecionar texto; páginas com texto simples podem ser lidas e buscadas, mas não selecionadas.
- **Anotações**: páginas OCR usam os mesmos destaques, quatro cores, notas e wikilinks de PDFs normais; âncora = «número da página + deslocamento de caractere na camada de texto». Sem camada de texto, arrastar cria um retângulo, com notas, links e exportação em cartão de citação; o texto citado exige OCR.
- **Busca**: a busca literal em toda a biblioteca e dentro do PDF lê o JSON diretamente, sem reconstruir índice. Os resultados saltam para a página e desenham retângulos na camada transparente; 40 destaques por página, 300 resultados no total e 50 por livro.
- **Busca semântica**: exige um retrato. Seu texto vem do OCR página por página, então o OCR precisa acontecer **antes** da construção do retrato; páginas reconhecidas depois exigem reconstrução. O retrato deve estar completo e o modelo de embeddings precisa coincidir. Um resultado semântico não tem âncora exata: ao abri-lo, uma busca textual é relançada com o trecho.

### Leitura em voz alta: como funciona

- **Texto**: EPUB / TXT usam a passagem visível ou um capítulo inteiro; PDF lê apenas a camada de texto da página atual, páginas digitalizadas precisam de OCR primeiro e não há pré-geração por capítulo em PDF.
- **Três motores**: voz do sistema (totalmente offline, sem cache nem pré-busca), online (endpoint oficial ou compatível com OpenAI) e serviço de voz próprio. As configurações de TTS são independentes das de IA; no celular, o modo online é obrigatório.
- **Divisão em frases**: separar narração e diálogo, depois cortar nos sinais de pontuação; alvo de 240 caracteres, frases longas recuam para uma vírgula, fragmentos curtos são unidos, fragmentos só de símbolos não são lidos. Voz do sistema: 220 / 4000 caracteres.
- **Reprodução**: áudio frase por frase com avanço automático; pré-busca de 3 frases (o serviço local prepara o capítulo inteiro), no máximo 2 requisições simultâneas; mudar de posição cancela só requisições obsoletas, não a pré-busca. Frases rejeitadas são ignoradas, falha de pré-busca é tentada uma vez em silêncio, outras falhas param com «Continuar ouvindo».
- **Cache**: chave formada por livro + motor + modelo + voz + texto, guardada localmente; um acerto só atualiza o horário. 300 MB por padrão, ajustável até 2 GB.
- **Destaque**: online e local, cada frase é mapeada de volta ao texto por uma âncora, sem eventos de fala nem temporizadores; o áudio offline de capítulo inteiro usa um eixo temporal, a voz do sistema usa um retorno de chamada de início.
- **Pré-geração**: o áudio de um capítulo é reunido em um arquivo, com uma lista de tempos e intervalos de bytes por frase; gravação atômica e verificação por releitura. Seis estados (fila / síntese / empacotamento / pronto / cancelado / falha), sem previsão de tempo; a parada vale em limites de frase; o cache é o progresso e pode ser retomado ou refeito. Por capítulo é Pro; o livro inteiro só com motor local e não no celular.
- **Escuta offline**: copiar a pasta inteira (áudio + manifesto) para `bz-reader/offline/` dentro do cofre. Só um nível é varrido, primeiro pelo título e depois pelo ID do livro; copiar apenas mp3 não funciona. A reprodução corta pelos intervalos de bytes ou, na falta deles, toca o capítulo inteiro com eixo temporal; texto editado é realinhado e o próximo capítulo começa sozinho.
- **Retomar**: só a última posição é salva ao parar, localmente e com granularidade de frase. Recuperação: mesmo capítulo com deslocamento → busca no capítulo inteiro → início da página. A posição não acompanha para outro dispositivo.

### Acesso à rede

Só os recursos de IA e a lista de apoiadores em «Apoiar o autor» acessam a rede; todo o resto funciona offline.

- As requisições vão para o endpoint compatível com OpenAI que você configurar (servidor próprio ou API de terceiros). O plugin não tem servidor próprio.
- Ao montar o índice do livro, o texto é enviado em blocos ao seu serviço de embeddings; uma pergunta envia só os poucos blocos recuperados, além do título do livro, nome do capítulo e as últimas trocas quando necessário. Os vetores e o índice ficam na pasta do plugin e não são enviados.
- Os embeddings vêm do plugin bz (segundo cérebro): sem ele não há busca vetorial, só o caminho dos pontos-chave condensados.
- Sua chave de API fica com os demais ajustes em `data.json`, na pasta do plugin. Ela nunca é enviada ao autor; só vai para o endpoint que você configurou, como cabeçalho da requisição.
- Ao abrir «Apoiar o autor» (e o registro de alterações), uma lista pública de apoiadores é carregada: o mesmo JSON estático do GitHub e do Gitee ao mesmo tempo, vence a primeira resposta. Apenas essa lista é buscada, sem dados pessoais nem estatísticas. A lista fica em cache local; se as duas fontes falharem, aparece «Não foi possível carregar a lista» com um botão para tentar de novo. A lista é pública e idêntica nos dois plugins.

### Perguntas frequentes

- **Quais formatos?** EPUB e TXT de imediato; mobi, azw3, fb2, quadrinhos e PDF no Pro.
- **Conflita com outros plugins?** O leitor é uma view nativa do Obsidian e o sumário é uma aba do painel lateral esquerdo. Os destaques podem ser copiados como links Markdown com posição que voltam ao trecho exato — nenhum índice separado é criado.
- **Troquei de computador?** O cofre leva a estante, o progresso e as anotações. Informe a chave de licença de novo no novo aparelho.
- **Preciso pagar de novo no celular?** Não. Uma única compilação cobre desktop e celular.

### Plugins recomendados

- [bz](https://github.com/yeshimei/bz) — Diário, notas, livros e filmes, jogos, recortes da web, pomodoro, revisão, criptografia segura, base de conhecimento com IA, dock de ferramentas e um gato de estimação na área de trabalho.

### Licença

Publicado sob a licença [MIT](LICENSE). O motor de renderização é o [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (MIT, distribuído como dependência npm; patches locais em [patches/foliate-js@1.0.1.patch](patches/foliate-js@1.0.1.patch)).
