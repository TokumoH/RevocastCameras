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
| Arquivos | `README.md`, `Entrar.tsx`, `Painel.tsx`, `Controle.tsx`, `Camera.tsx`, `ObsPalco.tsx`, `ObsCamera.tsx`, `NaoEncontrada.tsx` |

## Propósito

Uma tela por rota. Nesta etapa as seis telas de rota são provisórias: logo, título da rota e a etapa em que a tela fica pronta.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md).

## Organização

- Um arquivo por tela, com o nome da rota em PascalCase (`ObsPalco.tsx` para `obs_palco`).
- As seis telas de rota usam `TelaProvisoria` (de `shared/ui`); `NaoEncontrada` tem texto próprio.

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
| [`Entrar.tsx`](Entrar.tsx) | `/entrar` — etapa E1 |
| [`Painel.tsx`](Painel.tsx) | `/painel` — etapa E1 |
| [`Controle.tsx`](Controle.tsx) | `/controle` — etapa E3 |
| [`Camera.tsx`](Camera.tsx) | `/camera` — etapa E4 |
| [`ObsPalco.tsx`](ObsPalco.tsx) | `/obs/palco` — etapa E3 |
| [`ObsCamera.tsx`](ObsCamera.tsx) | `/obs/camera` — etapa E4 |
| [`NaoEncontrada.tsx`](NaoEncontrada.tsx) | Qualquer caminho desconhecido |

## Lógica

O `App` importa cada tela e a escolhe pelo nome da rota ([`../App.tsx`](../App.tsx)). As etapas das frases seguem a seção 14 do DES-001.

## Exemplo

Para trocar a tela `/painel` pela real (E1): substituir o corpo de `Painel.tsx`; o `App` não muda.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Frases de etapa duplicadas nas telas, em `App.test.tsx`, neste README e no DES-001 precisam ser atualizadas à mão quando o plano mudar.
