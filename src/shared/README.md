# src/shared

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-shared |
| Título | `shared` |
| Tipo | código · compartilhado |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/shared/README.md` |
| Arquivos | `README.md`, `infra/`, `styles/`, `ui/` |

## Propósito

Código compartilhado: estilos (`styles/`) e componentes visuais (`ui/`), já usados pelo app, e configuração, cliente Supabase e adaptadores das portas do domínio Acesso (`infra/`), que as telas passam a usar na E1.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../docs/desenho/2026-11-16-revocast-cameras-desenho.md).

## Organização

- `infra/`: configuração (variáveis de ambiente), cliente Supabase e, desde a Tarefa 3 da E1, os adaptadores das portas do domínio Acesso (`acessoSupabase.ts`).
- `styles/`: tokens e base visual do RevoCast.
- `ui/`: componentes visuais e o logo.

## Por que esta organização

Nada em `shared/` conhece telas; as telas é que dependem dele (referências independentes).

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Estilos e componentes dentro de cada tela | Duplica o visual e quebra a identidade |
| Pacote npm separado | Excesso para um app só |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`infra/`](infra/) | `lerConfiguracao`, o cliente Supabase por tipo de sessão e os adaptadores `criarAutenticacaoSupabase`/`criarRepositorioDeAcessoSupabase` |
| [`styles/`](styles/) | Tokens (claro e escuro) e base visual |
| [`ui/`](ui/) | `Cartao`, `Logo`, `TelaProvisoria` e `logo.png` |

## Lógica

```mermaid
flowchart LR
    T[app/telas] --> U[shared/ui]
    U --> L[logo.png]
    M[main.tsx] --> S[shared/styles]
    I[shared/infra] --> E[supabase-js]
    I -. implementa as portas de .-> D[domains/acesso]
```

## Exemplo

Para mudar a cor de destaque: editar `--pink` em `styles/tokens.css`.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Subdiretórios com README próprio (conferido pelo mesmo comando).

## Riscos

- `infra/` é usado pelas telas de membro desde a Tarefa 4 da E1, só por meio da composição (`src/app/servicos.ts`) e de `Dependencias.obterServicos`; as rotas de dispositivo importam `infra/` (e o supabase-js) de forma transitiva, por `App → dependencias → servicos`, mas não chamam `obterServicosDeMembro` nem criam o cliente (provado em `src/app/App.test.tsx`, `caminho-padrao-nao-cria-cliente-em-dispositivo`).
