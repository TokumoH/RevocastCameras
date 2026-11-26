# VER-022 — Remoção da exceção `GHSA-fc5q-39xc-vjpf` (`picomatch`) do `check-deps-audit`

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-022 |
| Título | Remoção da exceção `GHSA-fc5q-39xc-vjpf` (`picomatch`) do `check-deps-audit` |
| Gravidade | baixa |
| Tipo | DevSecOps · manutenção (limpeza de exceção sem uso) |
| Data | 2026-11-26 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-26-022-remove-excecao-picomatch.md` |
| Arquivos | `scripts/check-deps-audit.mjs`, `scripts/tests/check-deps-audit.test.mjs`, `scripts/README.md`, `scripts/tests/README.md`, `docs/verificacoes/README.md`, este registro (6 arquivos) |

## Problema

O `npm run check` passou a imprimir `AVISO [check-deps-audit] exceção GHSA-fc5q-39xc-vjpf sem uso (o aviso não aparece mais): remova-a de EXCECOES`. A exceção do [VER-012](2026-11-18-012-audit-excecao-com-prazo.md) já não cobre nada: o `npm audit` (completo e de produção) devolve `vulnerabilities: {}`. Efeito: ruído permanente no check e uma exceção com prazo (até 2026-12-17) que, se o aviso voltasse, o silenciaria sem nova decisão.

## Era proposital?

Sim, a exceção era proposital (decisão do responsável em 2026-11-18, VER-012, com prazo e com o aviso de "sem uso" previsto no item 4 da Solução, justamente para este caso). O que mudou foi o registro do npm. Atenção: o `picomatch` 4.0.7 **continua** na árvore (`package-lock.json`, `node_modules/picomatch`, só `dev`, por `vite`, `vitest`, `tinyglobby` e `fdir`); o que deixou de existir é o aviso sobre essa versão no registro (a consulta em lote do registro para `picomatch@4.0.7` devolve `{}`). Esta sessão não consegue ler a página do aviso no GitHub (a API do GitHub fica fora do alcance), então o motivo do sumiço (aviso retirado ou reclassificado) não foi confirmado.

## Solução

1. Remover a entrada de `EXCECOES` em `scripts/check-deps-audit.mjs`; a lista fica vazia, com um comentário que registra a remoção e o formato de cada entrada.
2. `principal` passa a aceitar `excecoes` por parâmetro (padrão `EXCECOES`), como `avaliarAuditoria` já aceitava; os testes de `principal` que dependiam da entrada real passam a usar a lista sintética `EX` e o id sintético `GHSA-aaaa-bbbb-cccc`, com as mesmas asserções.
3. Novo teste da lista vazia (relatório vazio passa sem erro nem aviso; aviso alto reprova).
4. READMEs de `scripts/` e `scripts/tests/` (contagem 53 → 54, lista vazia) e de `docs/verificacoes/` (linha deste registro; exemplo passa a `2026-11-30-024-exemplo.md`, porque o 023 fica para o próximo registro).

## Por que esta solução

- O próprio mecanismo pede a remoção ("remova-a de EXCECOES"); manter a entrada deixaria uma isenção pré-aprovada para um aviso que, se voltasse, entraria silenciado até o prazo (a proteção por pacote, gravidade, produção e correção continuaria valendo).
- Injetar `excecoes` em `principal` mantém os testes da linha de comando sem depender de dados reais (Pure Fabrication: a regra fica em função pura; a borda recebe a lista).
- O comentário com o formato mantém a documentação do campo no lugar onde a próxima exceção será escrita; o arquivo não encolhe (as âncoras `#L1-L195` do VER-012 continuam válidas).

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Deixar a entrada até 2026-12-17 | Ruído no check e isenção sem uso; o aviso foi previsto para ser agido |
| Trocar o `picomatch` por outra versão | Não há necessidade: a versão em uso não tem aviso no registro |
| Teste que lê o `EXCECOES` real e o id real | Quebraria com a lista vazia; os exemplos sintéticos cobrem a mesma regra |
| Remover o teste de `EXCECOES` | Ele continua válido para entradas futuras (formato e prazo de 90 dias) |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`scripts/check-deps-audit.mjs`](../../scripts/check-deps-audit.mjs#L13-L22) | 13–22, 188–190 | `EXCECOES` vazia, com comentário; `principal` recebe `excecoes` |
| [`scripts/tests/check-deps-audit.test.mjs`](../../scripts/tests/check-deps-audit.test.mjs#L264-L335) | 264–335 | Testes de `principal` com `EX` e id sintético; teste da lista vazia (54 testes) |
| [`scripts/README.md`](../../scripts/README.md#L55) | 55, 93 | Lista vazia desde o VER-022 (linhas 52, 90 e 91 intactas) |
| [`scripts/tests/README.md`](../../scripts/tests/README.md#L62) | 62 | 54 testes; lista vazia |
| [`docs/verificacoes/README.md`](README.md) | Arquivos, Onde, Exemplo | VER-022; exemplo `024` |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| `npm audit` | `vulnerabilities: {}` | igual |
| `EXCECOES` | 1 entrada (`picomatch`) | vazia |
| Saída do `check-deps-audit` | `0 erro(s) — 1 aviso(s)` (exceção sem uso) | `0 erro(s) — 0 aviso(s)` |
| Aviso alto novo | reprova | reprova |
| Aviso do `picomatch` se voltar | aviso, aprova (até 2026-12-17) | reprova (sem exceção) |

## Exemplo

Antes: `node scripts/check-deps-audit.mjs` imprimia `AVISO ... exceção GHSA-fc5q-39xc-vjpf sem uso` e `0 erro(s) — 1 aviso(s)`. Depois: `check-deps-audit: 0 erro(s) — 0 aviso(s)`. Sabotagem: numa cópia fora do repositório, com a entrada recolocada, o aviso volta (`1 aviso(s)`).

## Verificação

revisão do controlador (diff lido inteiro; `npm audit --json --include=dev` com `vulnerabilities: {}` e total 0; a remoção falha fechada: se o aviso voltar, o `check-deps-audit` reprova, porque não há mais exceção): **aprovada**, sem achado. Item pequeno e sem mudança de comportamento do app; pela decisão do responsável de 2026-11-22, sem segunda rodada.

## Riscos

- O `picomatch` 4.0.7 segue instalado; se o aviso foi só reclassificado no registro e voltar, o `check-deps-audit` reprova (sem exceção) até nova decisão.
- O motivo do sumiço do aviso no registro não foi confirmado nesta sessão (sem acesso à página do aviso).
- As linhas 52, 90 e 91 de `scripts/README.md` e as âncoras do VER-012 para os dois arquivos (`#L1-L195`, `#L1-L327`) foram mantidas.
