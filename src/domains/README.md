# src/domains

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-domains |
| Título | `domains` |
| Tipo | código · domínios (DDD) |
| Data | 2026-11-26 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- src/domains/README.md` |
| Arquivos | `README.md`, `arquitetura.test.ts`, `acesso/`, `preparacao/`, `aovivo/` |

## Propósito

Guarda os domínios do RevoCast Câmeras (DDD): regras de negócio puras e as **portas** (interfaces) pelas quais cada domínio fala com o mundo de fora. Nada aqui conhece React, Supabase, `src/shared/` ou `src/app/`; quem implementa as portas são os adaptadores de `src/shared/infra/`, e quem os liga às telas é a composição em `src/app/`.

## Origem

Criado na Tarefa 1 da etapa E1 ([PLA-002](../../docs/planos/2026-11-26-e1-entrada-e-membros.md)), que faz nascer o primeiro domínio, `acesso/`. O segundo, `preparacao/`, nasce na Tarefa 1 da E2 ([PLA-003](../../docs/planos/2026-11-26-e2-preparar-episodio.md), decisão D1). O terceiro, `aovivo/`, nasce na Tarefa 1 da E3 ([PLA-004](../../docs/planos/2026-11-27-e3-ao-vivo-por-toque.md), decisão D1), que também põe o pareamento de dispositivos em `acesso/`. A pasta já estava prevista no [DES-001](../../docs/desenho/2026-11-16-revocast-cameras-desenho.md) (§6) e no [PLA-001](../../docs/planos/2026-11-17-e0-fundacao.md) ("novos domínios entram em `src/domains/<domínio>/`").

## Organização

- Uma subpasta por domínio (`acesso/` desde a E1; `preparacao/` desde a E2, com mídias, sons, cenas, gestos, episódios e avisos; o pareamento entra em `acesso/` na E3, como no DES-001 §6.1; `aovivo/` desde a E3, com mensagens validadas dos canais, comandos, estado no ar, registro e portas), cada uma com o seu `README.md`.
- Um domínio pode importar **tipos** de outro (`aovivo/` usa `Dispositivo` de `acesso/` e `Cena`, `Som`, `Aviso`, `Episodio` e `AcaoDoGesto` de `preparacao/`); a seta vai só de Ao vivo para Acesso e Preparação (nenhum deles importa `aovivo/`), e as regras de import de fora continuam valendo para todos.
- Dentro do domínio: um arquivo por conceito ou agregado (`papeis.ts`, `email.ts`, `midia.ts`, `cenas.ts`, …), um arquivo de portas (`portas.ts`) e os serviços de domínio (`resolverAcesso.ts`, `biblioteca.ts`), cada um com o `.test.ts` ao lado.
- `arquitetura.test.ts`, na raiz da pasta, vale para **todos** os domínios: lê o texto de cada arquivo `.ts`, `.tsx`, `.mts`, `.cts`, `.js` ou `.jsx` (menos os `.test.*`) e recusa import de `react`, `@supabase/*`, `shared/` ou `app/`.

## Por que esta organização

O domínio é a parte que muda menos e que mais precisa de prova: deixá-lo sem dependência de biblioteca permite testá-lo com objetos simples, sem jsdom nem cliente Supabase, e trocar a infraestrutura sem mexer na regra. As portas no domínio e os adaptadores fora (GRASP Pure Fabrication) mantêm a seta de dependência apontando para dentro. O teste de arquitetura transforma essa regra em falha de teste, em vez de depender de revisão.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Regras dentro das telas (`src/app/telas`) | Mistura decisão de acesso com apresentação; só testável com jsdom; repete regra entre telas |
| Regras em `src/shared/` | `shared/` é reuso técnico (estilos, componentes, infraestrutura); misturaria negócio e biblioteca |
| Portas em `src/shared/infra/` junto dos adaptadores | O domínio passaria a importar a infraestrutura, invertendo a dependência que o DDD pede |
| Regra de import só por convenção, sem teste | Um import de Supabase no domínio passaria em revisão sem ninguém notar |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`arquitetura.test.ts`](arquitetura.test.ts) | 3 testes: o glob acha os arquivos; nenhum arquivo de domínio importa React, Supabase, `shared/` ou `app/`; o detector reconhece as formas de import proibidas |
| [`acesso/`](acesso/) | Domínio Acesso: papéis, e-mail, lista de acesso, estados da sessão, retorno do login, portas e `resolverAcesso`; desde a E3, dispositivos e pareamento (`dispositivos.ts`, `portasDeDispositivo.ts`, `resolverDispositivo`) |
| [`aovivo/`](aovivo/) | Domínio Ao vivo: mensagens dos canais `estudio` e `:controle` validadas no recebimento, `Comando`, `EstadoNoAr`, `Revogados`, resolução do comando em ação do OBS, linha do registro e as portas dos canais, dos repositórios do ao vivo e do palco e do executor |
| [`preparacao/`](preparacao/) | Domínio Preparação: tipos aceitos pelos bytes, limites de 50 MB e 1 GB, caminho no Storage, cenas, mapa de gestos, episódios e avisos, mídia em uso, portas e o serviço da Biblioteca (`enviarMidia`, `excluirMidia`) |

## Lógica

```mermaid
flowchart RL
    I["shared/infra (adaptadores)"] -- implementa --> P["domains/*/portas.ts"]
    A["app/ (composição e telas)"] -- usa --> D["domains/* (regras e serviços)"]
    A -- cria --> I
    D --> P
```

1. O domínio declara o que precisa (portas) e decide (regras e serviços), sem importar nada de fora.
2. `shared/infra` implementa as portas com o Supabase (Acesso: E1, Tarefa 3; Preparação: E2, Tarefa 4; dispositivos e Ao vivo: E3, Tarefa 4).
3. `app/` cria os adaptadores e entrega ao domínio (composição), e mostra o resultado nas telas.
4. `arquitetura.test.ts` roda no `npm test` e falha se um arquivo de domínio importar React, Supabase, `shared/` ou `app/`.

## Exemplo

Para saber quem pode abrir `/painel`: `acesso/papeis.ts`, função `podeAbrir('painel', papel)`. Para saber se um arquivo pode entrar na Biblioteca: `preparacao/midia.ts`, função `conferirArquivo`. Para saber se uma mensagem do canal pode ter efeito: `aovivo/mensagens.ts`, `lerComando` e os outros leitores. Para criar um domínio novo: `src/domains/<dominio>/` com `README.md` (11 seções), as regras e as portas; o teste de arquitetura passa a cobri-lo sem configuração.

## Verificação

- `npx vitest run src/domains`: 16 arquivos, 269 testes (7 arquivos e 46 testes até a E1; `preparacao/` soma 6 arquivos e 66 testes; na E3, `acesso/dispositivos.test.ts` soma 52 e `aovivo/` 2 arquivos e 105).
- Sabotagem do teste de arquitetura: `import type { SupabaseClient } from '@supabase/supabase-js'` em `acesso/portas.ts` → o teste falha citando `./acesso/portas.ts` (VER-015); o mesmo import em `preparacao/portas.ts` derruba o teste (VER-024), e em `aovivo/portas.ts` também (VER-035).
- Links relativos, "Onde", campo "Arquivos" e README do subdiretório conferidos por `npm run check-docs`.

## Riscos

- O teste de arquitetura lê o texto dos arquivos com expressões regulares: um import montado de forma exótica (por exemplo, o caminho numa variável) escaparia; nenhum arquivo de domínio faz isso hoje.
- O glob lê `./**/*.{ts,tsx,mts,cts,js,jsx}` e pula os `.test.*`; outra extensão de código (por exemplo `.mjs`) ficaria de fora. Conferido: um `.tsx`, um `.mts` e um `.js` com `import { useState } from 'react'` em `acesso/` derrubam o teste; um `.test.tsx` com o mesmo import é pulado.
