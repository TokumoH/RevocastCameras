# src/app/telas

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-app-telas |
| Título | `telas` |
| Tipo | código · telas |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/app/telas/README.md` |
| Arquivos | `README.md`, `Entrar.tsx`, `Painel.tsx`, `Painel.test.tsx`, `AbaMembros.tsx`, `AbaMembros.test.tsx`, `AbaBiblioteca.tsx`, `AbaBiblioteca.test.tsx`, `AbaCenas.tsx`, `AbaCenas.test.tsx`, `AbaGestos.tsx`, `AbaGestos.test.tsx`, `AbaEpisodios.tsx`, `AbaEpisodios.test.tsx`, `Controle.tsx`, `Camera.tsx`, `ObsPalco.tsx`, `ObsCamera.tsx`, `NaoEncontrada.tsx`, `EstadosDeAcesso.tsx` |

## Propósito

Uma tela por rota, as telas dos estados de acesso e as abas do painel. Desde a Tarefa 4 da E1, `/entrar` é real e `/painel` e `/controle` são guardados por papel (`GuardaDeMembro`); desde a Tarefa 5, o `/painel` tem as abas do DES-001 §9 (Episódios, Biblioteca, Cenas, Gestos, Membros só para `admin`, Ao vivo), com a aba Membros real (incluir, trocar o papel e remover e-mails da lista de acesso) e, desde a Tarefa 5 da E2, a aba Biblioteca real (envio de sons e imagens, uso do limite, sons, prévia e exclusão) e, desde a Tarefa 6, as abas Cenas (cenas do OBS: incluir, editar, ordenar, excluir) e Gestos (mapa global dos 7 gestos) reais e, desde a Tarefa 7, a aba Episódios real (episódios e avisos; iniciar e encerrar o ao vivo ficam para a E3); só Ao vivo continua provisória; o `/controle` continua provisório; as telas de dispositivo (`/camera`, `/obs/palco`, `/obs/camera`) continuam provisórias: logo, título da rota e a etapa em que a tela fica pronta.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). `EstadosDeAcesso.tsx` e a troca de `Entrar`, `Painel` e `Controle` vieram da Tarefa 4 da E1 ([PLA-002](../../../docs/planos/2026-11-26-e1-entrada-e-membros.md), decisões D2 e D3; registro VER-018). As abas do `Painel` e `AbaMembros.tsx` vieram da Tarefa 5 da E1 (decisões D1, D6 e D8; registro VER-019). `AbaBiblioteca.tsx` veio da Tarefa 5 da E2 ([PLA-003](../../../docs/planos/2026-11-26-e2-preparar-episodio.md), decisões D6, D7 e D11; registro [VER-028](../../../docs/verificacoes/2026-11-26-028-e2-aba-biblioteca.md)). `AbaCenas.tsx` e `AbaGestos.tsx` vieram da Tarefa 6 da E2 (decisões D11 e D12; registro [VER-029](../../../docs/verificacoes/2026-11-27-029-e2-cenas-e-gestos.md)). `AbaEpisodios.tsx` veio da Tarefa 7 da E2 (decisão D2; registro [VER-030](../../../docs/verificacoes/2026-11-27-030-e2-episodios-e-avisos.md)). O foco da aba Membros passou a `useLayoutEffect` no VER-033 ([registro](../../../docs/verificacoes/2026-11-27-033-membros-foco-no-mesmo-commit.md)).

## Organização

- Um arquivo por tela, com o nome da rota em PascalCase (`ObsPalco.tsx` para `obs_palco`).
- Telas reais × provisórias: `Entrar` é real (usa `useAcesso`); `Painel` é guardado e mostra as abas (estado do componente, sem rota nova, D8: recarregar volta para "Episódios"); as abas Membros (`AbaMembros.tsx`) e, desde a E2, Biblioteca (`AbaBiblioteca.tsx`, Tarefa 5), Cenas (`AbaCenas.tsx`) e Gestos (`AbaGestos.tsx`, Tarefa 6) e Episódios (`AbaEpisodios.tsx`, Tarefa 7) são reais e só Ao vivo diz a etapa em que fica pronta (E3); `Controle` é guardado e mostra `TelaProvisoria` (E3); `Camera`, `ObsPalco` e `ObsCamera` são provisórias; `NaoEncontrada` tem texto próprio.
- `AbaMembros.tsx` recebe só a porta `RepositorioDeAcesso`, o usuário da sessão e `reavaliar`; as regras (normalizar o e-mail, recusar duplicado, a própria linha e o último `admin`) são do domínio (`domains/acesso/`), e os textos fixos ficam em `TEXTO_DA_ABA`.
- `AbaBiblioteca.tsx` recebe só `ServicosDePreparacao`, o usuário da sessão e `reavaliar`; a ordem entre Storage e banco é do domínio (`enviarMidia`, `excluirMidia`), o uso e a mídia em uso também (`usoDaBiblioteca`, `usosDaMidia`); os textos fixos ficam em `TEXTO_DA_BIBLIOTECA`. O `Painel` obtém os serviços da Preparação uma vez (`useState(obterPreparacao)`), dentro da guarda.
- `AbaCenas.tsx` e `AbaGestos.tsx` recebem só `ServicosDePreparacao` e `reavaliar`; as regras são do domínio (`conferirCena`, `trocarOrdem`, `usosDaCena`; `normalizarGesto`, `conferirGesto`, `sugestoesDeSom`) e os textos fixos ficam em `TEXTO_DAS_CENAS` e `TEXTO_DOS_GESTOS`. A aba Gestos só altera as 7 linhas da E0 (nunca insere nem apaga).
- `AbaEpisodios.tsx` recebe só `ServicosDePreparacao`, o usuário da sessão (`criadoPor`) e `reavaliar`; as regras são do domínio (`conferirEpisodio`, `podeExcluirEpisodio`, `conferirAviso`, `normalizarLink`, `trocarOrdem`) e os textos fixos ficam em `TEXTO_DOS_EPISODIOS`. Nunca escreve `estado` nem `gestos_ligados` (D2). A miniatura da imagem do aviso usa `urlDePreviaAceita`, exportada de `AbaBiblioteca.tsx` (a mesma regra da prévia da Biblioteca).
- Testes de tela ficam ao lado da tela (`Painel.test.tsx`, pelo `App` com os falsos de `../servicosFalsos.ts`; `AbaMembros.test.tsx`, `AbaBiblioteca.test.tsx`, `AbaCenas.test.tsx`, `AbaGestos.test.tsx` e `AbaEpisodios.test.tsx`, com a aba renderizada direto).
- `EstadosDeAcesso.tsx` reúne as telas de cada estado de acesso (carregando, configuração incompleta, erro inesperado, entrada com o aviso, fora da lista, sem acesso, falha) e o cabeçalho do membro, com os textos fixos dos avisos (`TEXTO_DO_AVISO`); `TelaDeAcesso` escolhe a tela pelo estado e é usada por `Entrar` e por `GuardaDeMembro`.

## Por que esta organização

Um arquivo por tela mantém cada etapa (E1 a E4) tocando só os arquivos das suas telas.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Todas as telas em um arquivo | Cada etapa mexeria no mesmo arquivo |
| Telas dentro de `App.tsx` | Mistura escolha de rota com conteúdo |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`Entrar.tsx`](Entrar.tsx) | `/entrar` — real: membro vai para a área do papel (`navegar`); os demais veem a tela do seu estado |
| [`Painel.tsx`](Painel.tsx) | `/painel` — guardado (equipe e admin); abas do DES-001 §9 com `Abas` (`shared/ui`); Membros só quando `podeGerenciarMembros(papel)`; se o papel muda e a aba escolhida some, a escolha volta para "Episódios" (e Membros não reabre sozinha se o papel voltar) |
| [`Painel.test.tsx`](Painel.test.tsx) | 11 testes: abas da equipe e do admin (ordem), aba provisória (só Ao vivo, desde a Tarefa 7 da E2; as quatro abas da E2 sem "Em construção"), `episodios-no-painel` (a aba inicial mostra a lista e a nota da E3), `biblioteca-no-painel` (área de envio, sem "Em construção", serviços da Preparação obtidos uma vez), `cenas-e-gestos-no-painel` (formulário de cenas e as 7 linhas do mapa, sem "Em construção"), `tablist`/`tab`/`tabpanel` ligados, teclado (setas, Home, End, sem rolar a página), Membros abre a lista, some quando o admin é rebaixado e não reabre quando o papel volta |
| [`AbaMembros.tsx`](AbaMembros.tsx) | Aba Membros: tabela da lista de acesso (e-mail, nome ou "ainda não entrou", papel, ações), formulário "Incluir", "Salvar papel" e "Remover" com confirmação na linha; a linha da sessão sem controles; mensagens fixas (`TEXTO_DA_ABA`) em regiões `status`/`alert` sempre montadas; foco previsível depois de cada ação (campo, botão da linha, aviso ou mensagem de erro), aplicado em `useLayoutEffect` no mesmo commit do aviso (VER-033) |
| [`AbaMembros.test.tsx`](AbaMembros.test.tsx) | 28 testes: lista com perfis, inclusão normalizada e recusas locais, duplicado e inválido do banco, reordenação e rascunho descartado na recarga, clique duplo em "Incluir", sessão expirada ao carregar, leitura velha descartada, avisos sempre montados, foco depois de incluir, salvar, remover e no erro, `foco-no-mesmo-commit-do-aviso` (lê o foco com `MutationObserver` no instante em que o aviso entra), troca de papel, remoção com confirmação, própria linha, último admin, escrita negada reavalia, sessão expirada, falha de rede, falha ao carregar, uma leitura por montagem, clique duplo, nome com HTML literal |
| [`AbaBiblioteca.tsx`](AbaBiblioteca.tsx) | Aba Biblioteca: uso ("123,4 MB de 1 GB", aviso a partir de 80 %), área de envio (`<input type="file" multiple>` com rótulo e `drop`), fila com barra de progresso e "Cancelar" (um arquivo de cada vez, uso reconferido entre um e outro, `AbortController` abortado no "Cancelar" e na desmontagem; "Registrando…" sem botão depois que os bytes sobem; recusa ou falha fica na linha com a mensagem fixa e "Dispensar"; sessão expirada ou acesso negado param a fila; aviso fixo de que trocar de aba ou sair cancela os envios e `beforeunload` enquanto houver envio pendente), Sons (rótulo, emoji, volume 0–100 %, "Salvar", "Ouvir") e Imagens ("Ver"), prévia por URL assinada pedida só no clique (regra `urlDePreviaAceita`, exportada para a aba Episódios), "Excluir" com confirmação na linha que diz os usos (D11); mensagens fixas (`TEXTO_DA_BIBLIOTECA`) em regiões `status`/`alert` sempre montadas; foco previsível (`useLayoutEffect`) |
| [`AbaBiblioteca.test.tsx`](AbaBiblioteca.test.tsx) | 33 testes: lista e uso, envio (caminho sem o nome do arquivo), recusas locais, sem espaço, progresso, cancelar (em curso e na fila), fila um de cada vez, uso reconferido, soltar arquivos, desmontagem aborta, exclusões (som em gesto, imagem em avisos, `em_uso` do banco, arquivo que ficou), nome com HTML literal, prévia só ao pedir, salvar som, escrita negada reavalia, falha de rede, sessão expirada ao carregar, avisos sempre montados; da revisão 1: recusa fica na fila, aviso da fila e `beforeunload`, foco no mesmo commit do aviso (`MutationObserver`), `sem_resposta`, URL de prévia recusada, nome de exibição na fila, sessão expirada para a fila, "Registrando…" sem "Cancelar"; da re-revisão: sessão expirada também na leitura (1 `reavaliar`) e dispensar só uma linha |
| [`AbaCenas.tsx`](AbaCenas.tsx) | Aba Cenas: formulário "Incluir cena" (nome na tela aparado, nome no OBS gravado como digitado, com a dica de que maiúsculas e espaços contam), tabela (Ordem, Nome na tela, Nome no OBS, Ações) com "Subir"/"Descer" (`trocarOrdem`; grava cada cena cuja ordem mudou, inclusive a renumeração do empate; falha no meio recarrega), "Editar" na linha (Enter salva, Esc cancela; uma edição por vez) e "Excluir" com confirmação que diz os gestos que usam a cena (bloqueada, D11; `em_uso` do banco também); mensagens fixas (`TEXTO_DAS_CENAS`) em regiões `status`/`alert` sempre montadas; foco previsível (`useLayoutEffect`); clique duplo não duplica |
| [`AbaCenas.test.tsx`](AbaCenas.test.tsx) | 24 testes: lista na ordem, inclusão (OBS como digitado), recusas locais, duplicado local e do banco, subir (par), subir com empate (lista renumerada), pontas desabilitadas, falha no meio da troca recarrega, editar (duplicado local e salvar), editar e cancelar, excluir, excluir cena em gesto (bloqueada, nenhuma chamada), `em_uso` do banco, nome com HTML literal, escrita negada reavalia, sessão expirada na escrita, falha ao carregar, clique duplo, avisos sempre montados, foco no mesmo commit do aviso; da revisão 1: nome no OBS longo gravado inteiro (sem `maxLength`), Enter salva a edição (Esc cancela), "Editar" de outra linha desabilitado com uma edição aberta |
| [`AbaGestos.tsx`](AbaGestos.tsx) | Aba Gestos: uma linha por gesto na ordem de `GESTOS` (emoji, nome, seletor de ação com os rótulos de `ACOES`, seletor de cena ou de som quando a ação pede, "Salvar"); "Som" e "Cena" desabilitados sem sons ou sem cenas, com os textos da D12; sugestões do DES-001 §7 ("Ligar 👍 ao som …"); grava a linha normalizada (`normalizarGesto`) e conferida (`conferirGesto`); só `update` (gesto sem linha não é inserido); alvo que sumiu (`invalido` do `CHECK` ou `em_uso` da chave estrangeira) → mensagem e recarga; mensagens fixas (`TEXTO_DOS_GESTOS`) |
| [`AbaGestos.test.tsx`](AbaGestos.test.tsx) | 22 testes: sete linhas na ordem, som e cena sem alvo (nenhuma chamada), opções desabilitadas sem sons e sem cenas, troca para cena, troca para clipe e de som para cena zeram o outro alvo, ligar som, sugestão liga aplauso e some depois da recarga, sem sugestão com gesto ocupado, alvo que sumiu (`invalido`, `em_uso` e alvo fora da lista), escrita negada reavalia, falha de rede, nomes com HTML literal, sessão expirada ao carregar, gesto sem linha no banco, clique duplo, avisos sempre montados, foco no mesmo commit do aviso; da revisão 1: sessão expirada ao salvar (só `reavaliar()`, sem mensagem nem recarga) |
| [`AbaEpisodios.tsx`](AbaEpisodios.tsx) | Aba Episódios: nota fixa "Iniciar e encerrar o ao vivo chegam na etapa E3."; lista (Título, Data, Estado com "Rascunho"/"Ao vivo"/"Encerrado", "Abrir"; mais recente primeiro), "Novo episódio" (título e data com `<input type="date">`, padrão hoje; `criadoPor` = sessão); episódio aberto com título e data editáveis ("Salvar" grava só `{ titulo, data }`), "Excluir episódio" só em rascunho (D2; nos outros estados, "Só rascunhos podem ser excluídos.") com confirmação que diz quantos avisos saem, e os avisos em ordem (cartão com título, texto literal com `white-space: pre-line`, link como `<a target="_blank" rel="noopener noreferrer">` só se `normalizarLink` aceitar, imagem da Biblioteca com miniatura pedida no clique ou "Sem imagem", duração; "Subir"/"Descer" gravando só os avisos cuja ordem mudou, "Editar" uma de cada vez, "Excluir" com confirmação); formulário de aviso (título, texto em `<textarea>`, link, imagem só entre as imagens, duração padrão 10); `em_uso` na escrita do aviso = imagem apagada (mensagem e recarga); mensagens fixas (`TEXTO_DOS_EPISODIOS`) em regiões `status`/`alert` sempre montadas; foco previsível (`useLayoutEffect`); clique duplo não duplica |
| [`AbaEpisodios.test.tsx`](AbaEpisodios.test.tsx) | 32 testes: lista com estados, cria episódio (data padrão hoje), recusas do episódio (sem `maxLength`), edita só título e data, excluir só rascunho, ao vivo fica para a E3, `duplicado` do banco, aviso com HTML literal, link recusado, link aceito vira âncora (e `http://x` salvo por fora fica texto), links salvos por fora (`data:` e `JAVASCRIPT:` ficam texto; `HTTPS://` vira âncora normalizada), aviso com imagem (só imagens no seletor; miniatura no clique), prévia com URL recusada, imagem apagada mostra "Sem imagem", imagem inexistente do banco, ordem dos avisos (par), ordem com empate (renumeração; só o que mudou), falha no meio recarrega, duração padrão 10, aviso sem título, editar aviso (Enter salva; uma edição por vez), editar e cancelar, excluir aviso, escrita negada reavalia (`nada_alterado` e `negado`), aviso em edição que sumiu (a edição é desfeita), episódio que sumiu fecha, sessão expirada na escrita, falha ao carregar, clique duplo, avisos sempre montados, foco ao abrir, foco no mesmo commit do aviso |
| [`Controle.tsx`](Controle.tsx) | `/controle` — guardado (os três papéis); conteúdo provisório até a E3 |
| [`Camera.tsx`](Camera.tsx) | `/camera` — etapa E4 |
| [`ObsPalco.tsx`](ObsPalco.tsx) | `/obs/palco` — etapa E3 |
| [`ObsCamera.tsx`](ObsCamera.tsx) | `/obs/camera` — etapa E4 |
| [`NaoEncontrada.tsx`](NaoEncontrada.tsx) | Qualquer caminho desconhecido |
| [`EstadosDeAcesso.tsx`](EstadosDeAcesso.tsx) | Telas dos estados de acesso, `TelaDeAcesso`, `CabecalhoDoMembro` e `TEXTO_DO_AVISO` |

## Lógica

O `App` importa cada tela e a escolhe pelo nome da rota ([`../App.tsx`](../App.tsx)); só `Entrar`, `Painel` e `Controle` recebem `dependencias`. `Entrar` chama [`useAcesso`](../useAcesso.ts) direto; `Painel` e `Controle` passam pela [`GuardaDeMembro`](../GuardaDeMembro.tsx), que usa o mesmo hook. As duas mostram `TelaDeAcesso` para todo estado que não é `membro`. As etapas das frases seguem a seção 14 do DES-001.

## Exemplo

Para dar conteúdo a uma aba provisória (por exemplo, Ao vivo na E3, como Episódios, Cenas e Gestos fizeram na E2): criar a tela da aba neste diretório (`AbaAoVivo.tsx`, com o seu teste ao lado) e trocá-la pelo parágrafo "Em construção" no `ConteudoDoPainel` de `Painel.tsx`, como a aba Membros já faz; a lista `ABAS_DO_PAINEL`, o `App` e a guarda não mudam.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Os textos dos avisos e das telas de acesso estão em `EstadosDeAcesso.tsx` e repetidos nos testes (`../acesso.test.tsx`) e no registro VER-018; os da aba Membros estão em `TEXTO_DA_ABA` (`AbaMembros.tsx`) e repetidos em `AbaMembros.test.tsx` e no registro VER-019.
- A aba Biblioteca é desmontada ao trocar de aba (o `Abas` só monta o painel ativo): um envio em curso é cancelado nessa hora (remoção de boa-fé do objeto, D6). Os textos fixos estão em `TEXTO_DA_BIBLIOTECA` e repetidos em `AbaBiblioteca.test.tsx` e no VER-028.
- Os textos de Cenas e Gestos estão em `TEXTO_DAS_CENAS` e `TEXTO_DOS_GESTOS` e repetidos nos testes e no VER-029. A troca de ordem de cenas grava uma cena por vez (não há transação); uma falha no meio deixa parte das ordens novas, e a aba recarrega para mostrar o que o banco tem.
- Os textos de Episódios estão em `TEXTO_DOS_EPISODIOS` e repetidos em `AbaEpisodios.test.tsx` e no VER-030. A troca de ordem dos avisos grava um aviso por vez (sem transação; falha no meio recarrega). A E2 não muda `estado`: o banco ainda deixa `equipe` excluir episódio fora de rascunho e mudar `estado` pela API (limite da D2, decisão da E3).
- A aba Membros mostra a revogação na tela só na próxima reavaliação (decisão D4: o aviso pelo canal `estudio` é da E3); no banco ela vale na hora.
- Frases de etapa duplicadas nas telas, em `App.test.tsx`, neste README e no DES-001 precisam ser atualizadas à mão quando o plano mudar.
