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
| Arquivos | `README.md`, `Entrar.tsx`, `Painel.tsx`, `Controle.tsx`, `Camera.tsx`, `ObsPalco.tsx`, `ObsCamera.tsx`, `NaoEncontrada.tsx`, `EstadosDeAcesso.tsx` |

## Propósito

Uma tela por rota e as telas dos estados de acesso. Desde a Tarefa 4 da E1, `/entrar` é real e `/painel` e `/controle` são guardados por papel (`GuardaDeMembro`), com o conteúdo ainda provisório; as telas de dispositivo (`/camera`, `/obs/palco`, `/obs/camera`) continuam provisórias: logo, título da rota e a etapa em que a tela fica pronta.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). `EstadosDeAcesso.tsx` e a troca de `Entrar`, `Painel` e `Controle` vieram da Tarefa 4 da E1 ([PLA-002](../../../docs/planos/2026-11-26-e1-entrada-e-membros.md), decisões D2 e D3; registro VER-018).

## Organização

- Um arquivo por tela, com o nome da rota em PascalCase (`ObsPalco.tsx` para `obs_palco`).
- Telas reais × provisórias: `Entrar` é real (usa `useAcesso`); `Painel` e `Controle` são guardados e mostram `TelaProvisoria` (E1 Tarefa 5 e E3); `Camera`, `ObsPalco` e `ObsCamera` são provisórias; `NaoEncontrada` tem texto próprio.
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
| [`Painel.tsx`](Painel.tsx) | `/painel` — guardado (equipe e admin); conteúdo provisório até a Tarefa 5 da E1 |
| [`Controle.tsx`](Controle.tsx) | `/controle` — guardado (os três papéis); conteúdo provisório até a E3 |
| [`Camera.tsx`](Camera.tsx) | `/camera` — etapa E4 |
| [`ObsPalco.tsx`](ObsPalco.tsx) | `/obs/palco` — etapa E3 |
| [`ObsCamera.tsx`](ObsCamera.tsx) | `/obs/camera` — etapa E4 |
| [`NaoEncontrada.tsx`](NaoEncontrada.tsx) | Qualquer caminho desconhecido |
| [`EstadosDeAcesso.tsx`](EstadosDeAcesso.tsx) | Telas dos estados de acesso, `TelaDeAcesso`, `CabecalhoDoMembro` e `TEXTO_DO_AVISO` |

## Lógica

O `App` importa cada tela e a escolhe pelo nome da rota ([`../App.tsx`](../App.tsx)); só `Entrar`, `Painel` e `Controle` recebem `dependencias`. `Entrar` chama [`useAcesso`](../useAcesso.ts) direto; `Painel` e `Controle` passam pela [`GuardaDeMembro`](../GuardaDeMembro.tsx), que usa o mesmo hook. As duas mostram `TelaDeAcesso` para todo estado que não é `membro`. As etapas das frases seguem a seção 14 do DES-001.

## Exemplo

Para trocar o conteúdo de `/painel` pelo real (Tarefa 5 da E1): trocar a função `children` da `GuardaDeMembro` em `Painel.tsx` (ela recebe `usuario`, `papel`, `servicos` e `reavaliar`); o `App` e a guarda não mudam.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Os textos dos avisos e das telas de acesso estão em `EstadosDeAcesso.tsx` e repetidos nos testes (`../acesso.test.tsx`) e no registro VER-018.
- Frases de etapa duplicadas nas telas, em `App.test.tsx`, neste README e no DES-001 precisam ser atualizadas à mão quando o plano mudar.
