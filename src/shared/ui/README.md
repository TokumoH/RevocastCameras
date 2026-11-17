# src/shared/ui

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-shared-ui |
| Título | `ui` |
| Tipo | código · componentes visuais |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/shared/ui/README.md` |
| Arquivos | `README.md`, `Logo.tsx`, `Cartao.tsx`, `TelaProvisoria.tsx`, `logo.png` |

## Propósito

Componentes visuais reutilizáveis e o logo do RevoCast.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). O logo foi copiado de `public/images/brand/logo.png` do repositório público [TokumoH/RevoCast_Site](https://github.com/TokumoH/RevoCast_Site); sha256 `22f36ca8c7d65533feab7798e4efa2c1da5a3df8d3a6e0a0ae683781585be63f`, conferido com um clone anônimo do repositório público.

## Organização

- Um componente por arquivo, em PascalCase.
- `logo.png` fica aqui (e não em `public/`) para ser importado pelo código e empacotado pelo Vite com nome de conteúdo.

## Por que esta organização

`Cartao` e `TelaProvisoria` evitam repetir a mesma estrutura nas seis telas. O logo fora de `public/` não leva README ao site publicado.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Logo em `public/` | A pasta é copiada inteira para o site, inclusive o README exigido pelo `check-docs` |
| Logo como SVG redesenhado | Mudaria a marca; usa-se o arquivo oficial |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`Cartao.tsx`](Cartao.tsx) | `Cartao({ tom, children })`: cartão-adesivo (tom `rosa`, `ciano` ou `areia`) |
| [`Logo.tsx`](Logo.tsx) | `Logo()`: marcação do logo (120 x 117, alt "RevoCast") |
| [`TelaProvisoria.tsx`](TelaProvisoria.tsx) | Logo, título e "Em construção — etapa X" |
| [`logo.png`](logo.png) | Logo do RevoCast (887 x 864) |

## Lógica

`TelaProvisoria` usa `Cartao` e `Logo`; `Logo` importa `logo.png`; as telas usam `TelaProvisoria`; `NaoEncontrada` usa `Cartao` e `Logo` direto.

## Exemplo

Para um cartão rosa: `<Cartao tom="rosa">…</Cartao>`.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- `TelaProvisoria` deve ser removido quando a última tela provisória for substituída (E4).
- `logo.png` tem cerca de 470 kB; vale otimizar se pesar no carregamento (não medido).
