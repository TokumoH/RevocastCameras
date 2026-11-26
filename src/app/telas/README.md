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
| Arquivos | `README.md`, `Entrar.tsx`, `Painel.tsx`, `Painel.test.tsx`, `AbaMembros.tsx`, `AbaMembros.test.tsx`, `Controle.tsx`, `Camera.tsx`, `ObsPalco.tsx`, `ObsCamera.tsx`, `NaoEncontrada.tsx`, `EstadosDeAcesso.tsx` |

## Propósito

Uma tela por rota, as telas dos estados de acesso e as abas do painel. Desde a Tarefa 4 da E1, `/entrar` é real e `/painel` e `/controle` são guardados por papel (`GuardaDeMembro`); desde a Tarefa 5, o `/painel` tem as abas do DES-001 §9 (Episódios, Biblioteca, Cenas, Gestos, Membros só para `admin`, Ao vivo), com a aba Membros real (incluir, trocar o papel e remover e-mails da lista de acesso) e as outras provisórias; o `/controle` continua provisório; as telas de dispositivo (`/camera`, `/obs/palco`, `/obs/camera`) continuam provisórias: logo, título da rota e a etapa em que a tela fica pronta.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). `EstadosDeAcesso.tsx` e a troca de `Entrar`, `Painel` e `Controle` vieram da Tarefa 4 da E1 ([PLA-002](../../../docs/planos/2026-11-26-e1-entrada-e-membros.md), decisões D2 e D3; registro VER-018). As abas do `Painel` e `AbaMembros.tsx` vieram da Tarefa 5 da E1 (decisões D1, D6 e D8; registro VER-019).

## Organização

- Um arquivo por tela, com o nome da rota em PascalCase (`ObsPalco.tsx` para `obs_palco`).
- Telas reais × provisórias: `Entrar` é real (usa `useAcesso`); `Painel` é guardado e mostra as abas (estado do componente, sem rota nova, D8: recarregar volta para "Episódios"); a aba Membros (`AbaMembros.tsx`) é real e as outras dizem a etapa em que ficam prontas (E2 ou E3); `Controle` é guardado e mostra `TelaProvisoria` (E3); `Camera`, `ObsPalco` e `ObsCamera` são provisórias; `NaoEncontrada` tem texto próprio.
- `AbaMembros.tsx` recebe só a porta `RepositorioDeAcesso`, o usuário da sessão e `reavaliar`; as regras (normalizar o e-mail, recusar duplicado, a própria linha e o último `admin`) são do domínio (`domains/acesso/`), e os textos fixos ficam em `TEXTO_DA_ABA`.
- Testes de tela ficam ao lado da tela (`Painel.test.tsx`, pelo `App` com os falsos de `../servicosFalsos.ts`; `AbaMembros.test.tsx`, com a aba renderizada direto).
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
| [`Painel.test.tsx`](Painel.test.tsx) | 8 testes: abas da equipe e do admin (ordem), aba provisória, `tablist`/`tab`/`tabpanel` ligados, teclado (setas, Home, End, sem rolar a página), Membros abre a lista, some quando o admin é rebaixado e não reabre quando o papel volta |
| [`AbaMembros.tsx`](AbaMembros.tsx) | Aba Membros: tabela da lista de acesso (e-mail, nome ou "ainda não entrou", papel, ações), formulário "Incluir", "Salvar papel" e "Remover" com confirmação na linha; a linha da sessão sem controles; mensagens fixas (`TEXTO_DA_ABA`) em regiões `status`/`alert` sempre montadas; foco previsível depois de cada ação (campo, botão da linha, aviso ou mensagem de erro) |
| [`AbaMembros.test.tsx`](AbaMembros.test.tsx) | 27 testes: lista com perfis, inclusão normalizada e recusas locais, duplicado e inválido do banco, reordenação e rascunho descartado na recarga, clique duplo em "Incluir", sessão expirada ao carregar, leitura velha descartada, avisos sempre montados, foco depois de incluir, salvar, remover e no erro, troca de papel, remoção com confirmação, própria linha, último admin, escrita negada reavalia, sessão expirada, falha de rede, falha ao carregar, uma leitura por montagem, clique duplo, nome com HTML literal |
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
- A aba Membros mostra a revogação na tela só na próxima reavaliação (decisão D4: o aviso pelo canal `estudio` é da E3); no banco ela vale na hora.
- Frases de etapa duplicadas nas telas, em `App.test.tsx`, neste README e no DES-001 precisam ser atualizadas à mão quando o plano mudar.
