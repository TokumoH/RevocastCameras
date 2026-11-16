# .github/workflows

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-github-workflows |
| Título | `workflows` |
| Tipo | CI (GitHub Actions) |
| Data | 2026-11-16 |
| Usuário responsável | TokumoH |
| Status | ativo |
| Commits | commit que introduz este arquivo — `git log --format=%h -- .github/workflows/README.md` |
| Arquivos | `README.md`, `check.yml` |

## Propósito

Workflows do GitHub Actions. Hoje há um só, `check.yml`, que roda no PR as mesmas checagens do hook pre-push. Assim fica fechada a brecha do `git push --no-verify`, e nada entra na `master` sem passar pelas regras do [CORE](../../CLAUDE.md).

## Origem

Sugestão S3, aprovada pelo usuário como implementação com CI: "atenção para não esgotar os créditos do github". Registro: [VER-003](../../docs/verificacoes/2026-11-16-003-devsecops-checagens-e-ci.md).

## Organização

- Um arquivo `.yml` por workflow. O GitHub só executa `.yml`/`.yaml`, então este README não vira workflow.
- As actions são fixadas por SHA de commit, com a versão em comentário.

## Por que esta organização

Economia de minutos (prioridade do usuário):

| Medida | Efeito |
|---|---|
| Gatilho só em `pull_request` para `master` e `workflow_dispatch` | Push em branch não consome minutos; a barreira local é o hook |
| `concurrency` com `cancel-in-progress` | Commits seguidos no mesmo PR cancelam a execução anterior |
| `timeout-minutes: 5` | Uma execução travada não consome os 360 min padrão |
| 1 job em `ubuntu-latest` | Multiplicador 1x (Windows é 2x, macOS 10x) |
| `cache: npm` + `npm ci --ignore-scripts` | Instalação rápida, sem rodar scripts de dependências (segurança) |

Segurança: `permissions: contents: read`, `persist-credentials: false`, actions fixadas por SHA e `github.base_ref` passado por variável de ambiente (sem interpolação direta no shell).

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Rodar também em todo `push` | Dobra o consumo, e o hook já cobre o push |
| Matriz de sistemas operacionais e versões do Node | Multiplica os minutos sem ganho para um projeto front-end simples |
| Actions por tag (`@v7`) | A tag pode ser movida; o SHA é imutável |
| Um workflow por checagem | Vários jobs, cada um pagando setup e arredondamento de minuto |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`check.yml`](check.yml) | Job `check`: checkout, Node 22, `npm ci --ignore-scripts`, `npm run check`, `check-registro --range origin/<base>..HEAD` |

## Lógica

1. Um PR para `master` é aberto ou atualizado, ou alguém dispara manualmente em Actions → check → Run workflow.
2. O job instala as dependências e roda `npm run check` (typecheck, docs, segredos, audit).
3. Em PR, roda o `check-registro` sobre os commits do PR (merges ignorados).
4. Qualquer falha deixa o PR com check vermelho.

## Exemplo

Estimativa de consumo: cerca de 1 minuto faturado por execução (o GitHub arredonda cada job para cima, em minutos). Com 20 atualizações de PR por mês, são uns 20 min/mês, 1% da franquia gratuita de 2.000 min/mês para repositórios privados. Repositórios públicos não consomem franquia.

## Verificação

- YAML validado por parser e SHAs das actions conferidos com `git ls-remote` nos repositórios oficiais. Detalhes no VER-003.
- A primeira execução real só acontece no primeiro PR para `master` (não testada neste commit).

## Riscos

- A execução real no GitHub não foi testada. Depende do primeiro PR.
- Para tornar o check obrigatório no merge é preciso configurar uma regra de proteção da `master` no GitHub (Settings → Branches), fora do código.
- As actions fixadas por SHA não se atualizam sozinhas. Revisar as versões periodicamente (objetivo 14 da VARREDURA).
