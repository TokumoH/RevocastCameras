# .github

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-github |
| Título | `.github` |
| Tipo | configuração do GitHub |
| Data | 2026-11-16 |
| Usuário responsável | TokumoH |
| Status | ativo |
| Commits | commit que introduz este arquivo — `git log --format=%h -- .github/README.md` |
| Arquivos | `README.md`, `workflows/` |

## Propósito

Configurações que o GitHub lê do repositório. Hoje contém só os workflows de CI.

> Atenção: enquanto não existir um `README.md` na raiz do repositório, o GitHub mostra **este** arquivo na página inicial do repositório (a ordem de prioridade é `.github/`, raiz, `docs/`).

## Origem

Criado pela sugestão S3 (CI), aprovada como implementação. Registro: [VER-003](../docs/verificacoes/2026-11-16-003-devsecops-checagens-e-ci.md).

## Organização

- Subdiretórios com os nomes que o GitHub reconhece (`workflows/`), cada um com seu README.

## Por que esta organização

O caminho `.github/workflows/` é exigido pelo GitHub Actions.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Workflows em outro caminho | O GitHub Actions só lê `.github/workflows/` |
| Não criar README aqui | Viola a regra do CORE "todo diretório criado tem README" |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`workflows/`](workflows/README.md) | Workflows do GitHub Actions (CI `check.yml`) |

## Lógica

O GitHub lê `.github/workflows/*.yml` e executa os workflows nos eventos configurados. Ver [`workflows/README.md`](workflows/README.md).

## Exemplo

Para ver as execuções da CI: GitHub → repositório → aba Actions → workflow `check`.

## Verificação

- Links relativos e "Onde" conferidos pelo `scripts/check-docs.mjs`.

## Riscos

- Este arquivo aparece como página inicial do repositório até existir um `README.md` na raiz. Sugere-se criar um README do projeto em uma sugestão futura.
