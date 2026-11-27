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
| Arquivos | `README.md`, `Entrar.tsx`, `Painel.tsx`, `Painel.test.tsx`, `AbaMembros.tsx`, `AbaMembros.test.tsx`, `AbaBiblioteca.tsx`, `AbaBiblioteca.test.tsx`, `Controle.tsx`, `Camera.tsx`, `ObsPalco.tsx`, `ObsCamera.tsx`, `NaoEncontrada.tsx`, `EstadosDeAcesso.tsx` |

## Propósito

Uma tela por rota, as telas dos estados de acesso e as abas do painel. Desde a Tarefa 4 da E1, `/entrar` é real e `/painel` e `/controle` são guardados por papel (`GuardaDeMembro`); desde a Tarefa 5, o `/painel` tem as abas do DES-001 §9 (Episódios, Biblioteca, Cenas, Gestos, Membros só para `admin`, Ao vivo), com a aba Membros real (incluir, trocar o papel e remover e-mails da lista de acesso) e, desde a Tarefa 5 da E2, a aba Biblioteca real (envio de sons e imagens, uso do limite, sons, prévia e exclusão); as outras continuam provisórias; o `/controle` continua provisório; as telas de dispositivo (`/camera`, `/obs/palco`, `/obs/camera`) continuam provisórias: logo, título da rota e a etapa em que a tela fica pronta.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). `EstadosDeAcesso.tsx` e a troca de `Entrar`, `Painel` e `Controle` vieram da Tarefa 4 da E1 ([PLA-002](../../../docs/planos/2026-11-26-e1-entrada-e-membros.md), decisões D2 e D3; registro VER-018). As abas do `Painel` e `AbaMembros.tsx` vieram da Tarefa 5 da E1 (decisões D1, D6 e D8; registro VER-019). `AbaBiblioteca.tsx` veio da Tarefa 5 da E2 ([PLA-003](../../../docs/planos/2026-11-26-e2-preparar-episodio.md), decisões D6, D7 e D11; registro [VER-028](../../../docs/verificacoes/2026-11-26-028-e2-aba-biblioteca.md)).

## Organização

- Um arquivo por tela, com o nome da rota em PascalCase (`ObsPalco.tsx` para `obs_palco`).
- Telas reais × provisórias: `Entrar` é real (usa `useAcesso`); `Painel` é guardado e mostra as abas (estado do componente, sem rota nova, D8: recarregar volta para "Episódios"); as abas Membros (`AbaMembros.tsx`) e, desde a Tarefa 5 da E2, Biblioteca (`AbaBiblioteca.tsx`) são reais e as outras dizem a etapa em que ficam prontas (E2 ou E3); `Controle` é guardado e mostra `TelaProvisoria` (E3); `Camera`, `ObsPalco` e `ObsCamera` são provisórias; `NaoEncontrada` tem texto próprio.
- `AbaMembros.tsx` recebe só a porta `RepositorioDeAcesso`, o usuário da sessão e `reavaliar`; as regras (normalizar o e-mail, recusar duplicado, a própria linha e o último `admin`) são do domínio (`domains/acesso/`), e os textos fixos ficam em `TEXTO_DA_ABA`.
- `AbaBiblioteca.tsx` recebe só `ServicosDePreparacao`, o usuário da sessão e `reavaliar`; a ordem entre Storage e banco é do domínio (`enviarMidia`, `excluirMidia`), o uso e a mídia em uso também (`usoDaBiblioteca`, `usosDaMidia`); os textos fixos ficam em `TEXTO_DA_BIBLIOTECA`. O `Painel` obtém os serviços da Preparação uma vez (`useState(obterPreparacao)`), dentro da guarda.
- Testes de tela ficam ao lado da tela (`Painel.test.tsx`, pelo `App` com os falsos de `../servicosFalsos.ts`; `AbaMembros.test.tsx` e `AbaBiblioteca.test.tsx`, com a aba renderizada direto).
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
| [`Painel.test.tsx`](Painel.test.tsx) | 9 testes: abas da equipe e do admin (ordem), aba provisória (Cenas, desde a E2), `biblioteca-no-painel` (área de envio, sem "Em construção", serviços da Preparação obtidos uma vez), `tablist`/`tab`/`tabpanel` ligados, teclado (setas, Home, End, sem rolar a página), Membros abre a lista, some quando o admin é rebaixado e não reabre quando o papel volta |
| [`AbaMembros.tsx`](AbaMembros.tsx) | Aba Membros: tabela da lista de acesso (e-mail, nome ou "ainda não entrou", papel, ações), formulário "Incluir", "Salvar papel" e "Remover" com confirmação na linha; a linha da sessão sem controles; mensagens fixas (`TEXTO_DA_ABA`) em regiões `status`/`alert` sempre montadas; foco previsível depois de cada ação (campo, botão da linha, aviso ou mensagem de erro) |
| [`AbaMembros.test.tsx`](AbaMembros.test.tsx) | 27 testes: lista com perfis, inclusão normalizada e recusas locais, duplicado e inválido do banco, reordenação e rascunho descartado na recarga, clique duplo em "Incluir", sessão expirada ao carregar, leitura velha descartada, avisos sempre montados, foco depois de incluir, salvar, remover e no erro, troca de papel, remoção com confirmação, própria linha, último admin, escrita negada reavalia, sessão expirada, falha de rede, falha ao carregar, uma leitura por montagem, clique duplo, nome com HTML literal |
| [`AbaBiblioteca.tsx`](AbaBiblioteca.tsx) | Aba Biblioteca: uso ("123,4 MB de 1 GB", aviso a partir de 80 %), área de envio (`<input type="file" multiple>` com rótulo e `drop`), fila com barra de progresso e "Cancelar" (um arquivo de cada vez, uso reconferido entre um e outro, `AbortController` abortado no "Cancelar" e na desmontagem; "Registrando…" sem botão depois que os bytes sobem; recusa ou falha fica na linha com a mensagem fixa e "Dispensar"; sessão expirada ou acesso negado param a fila; aviso fixo de que trocar de aba ou sair cancela os envios e `beforeunload` enquanto houver envio pendente), Sons (rótulo, emoji, volume 0–100 %, "Salvar", "Ouvir") e Imagens ("Ver"), prévia por URL assinada pedida só no clique, "Excluir" com confirmação na linha que diz os usos (D11); mensagens fixas (`TEXTO_DA_BIBLIOTECA`) em regiões `status`/`alert` sempre montadas; foco previsível (`useLayoutEffect`) |
| [`AbaBiblioteca.test.tsx`](AbaBiblioteca.test.tsx) | 33 testes: lista e uso, envio (caminho sem o nome do arquivo), recusas locais, sem espaço, progresso, cancelar (em curso e na fila), fila um de cada vez, uso reconferido, soltar arquivos, desmontagem aborta, exclusões (som em gesto, imagem em avisos, `em_uso` do banco, arquivo que ficou), nome com HTML literal, prévia só ao pedir, salvar som, escrita negada reavalia, falha de rede, sessão expirada ao carregar, avisos sempre montados; da revisão 1: recusa fica na fila, aviso da fila e `beforeunload`, foco no mesmo commit do aviso (`MutationObserver`), `sem_resposta`, URL de prévia recusada, nome de exibição na fila, sessão expirada para a fila, "Registrando…" sem "Cancelar"; da re-revisão: sessão expirada também na leitura (1 `reavaliar`) e dispensar só uma linha |
| [`Controle.tsx`](Controle.tsx) | `/controle` — guardado (os três papéis); conteúdo provisório até a E3 |
| [`Camera.tsx`](Camera.tsx) | `/camera` — etapa E4 |
| [`ObsPalco.tsx`](ObsPalco.tsx) | `/obs/palco` — etapa E3 |
| [`ObsCamera.tsx`](ObsCamera.tsx) | `/obs/camera` — etapa E4 |
| [`NaoEncontrada.tsx`](NaoEncontrada.tsx) | Qualquer caminho desconhecido |
| [`EstadosDeAcesso.tsx`](EstadosDeAcesso.tsx) | Telas dos estados de acesso, `TelaDeAcesso`, `CabecalhoDoMembro` e `TEXTO_DO_AVISO` |

## Lógica

O `App` importa cada tela e a escolhe pelo nome da rota ([`../App.tsx`](../App.tsx)); só `Entrar`, `Painel` e `Controle` recebem `dependencias`. `Entrar` chama [`useAcesso`](../useAcesso.ts) direto; `Painel` e `Controle` passam pela [`GuardaDeMembro`](../GuardaDeMembro.tsx), que usa o mesmo hook. As duas mostram `TelaDeAcesso` para todo estado que não é `membro`. As etapas das frases seguem a seção 14 do DES-001.

## Exemplo

Para dar conteúdo a uma aba provisória (por exemplo, Episódios na E2): criar a tela da aba neste diretório (`AbaEpisodios.tsx`, com o seu teste ao lado) e trocá-la pelo parágrafo "Em construção" no `ConteudoDoPainel` de `Painel.tsx`, como a aba Membros já faz; a lista `ABAS_DO_PAINEL`, o `App` e a guarda não mudam.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Os textos dos avisos e das telas de acesso estão em `EstadosDeAcesso.tsx` e repetidos nos testes (`../acesso.test.tsx`) e no registro VER-018; os da aba Membros estão em `TEXTO_DA_ABA` (`AbaMembros.tsx`) e repetidos em `AbaMembros.test.tsx` e no registro VER-019.
- A aba Biblioteca é desmontada ao trocar de aba (o `Abas` só monta o painel ativo): um envio em curso é cancelado nessa hora (remoção de boa-fé do objeto, D6). Os textos fixos estão em `TEXTO_DA_BIBLIOTECA` e repetidos em `AbaBiblioteca.test.tsx` e no VER-028.
- A aba Membros mostra a revogação na tela só na próxima reavaliação (decisão D4: o aviso pelo canal `estudio` é da E3); no banco ela vale na hora.
- Frases de etapa duplicadas nas telas, em `App.test.tsx`, neste README e no DES-001 precisam ser atualizadas à mão quando o plano mudar.
