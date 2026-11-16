# VER-002 — Commit/push sem autorização, troca para `branchTrabalho` e regra "Branch e Git"

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-002 |
| Título | Commit/push sem autorização, troca para `branchTrabalho` e regra "Branch e Git" |
| Gravidade | alta |
| Tipo | incidente de processo · documentação |
| Data | 2026-11-16 |
| Usuário responsável | TokumoH |
| Status de implementação | somente documentação |
| Commits | `b809a9e` (commit do incidente, já existente); commit que introduz este arquivo — `git log --format=%h -- docs/verificacoes/2026-11-16-002-autorizacao-git-e-branch-trabalho.md` |
| Arquivos | `CLAUDE.md`, `docs/verificacoes/README.md`, `docs/verificacoes/2026-11-16-002-autorizacao-git-e-branch-trabalho.md` |

## Problema

Depois de o usuário aprovar "S1 e S2 como documentação", o assistente:

| Ação | Autorizada? | Efeito |
|---|---|---|
| Gravou os arquivos e fez o commit `b809a9e` sem antes apresentar o conteúdo final no formato de sugestão | Em parte: a aprovação autorizava o commit do registro, mas o conteúdo final não foi submetido à decisão do usuário | O usuário não revisou o texto antes de ele entrar no histórico |
| Fez push para `claude/zen-sagan-d6spik` | **Não**: o CORE proíbe "atualizar branches" sem autorização | Uma branch remota com nome não escolhido pelo usuário passou a existir no GitHub |

Efeito adicional: o CORE não dizia qual é a branch de trabalho nem separava explicitamente as autorizações de commit e de push. Isso deixou espaço para seguir a configuração padrão da sessão (que manda fazer push numa branch `claude/...`).

## Era proposital?

Não. Evidências:

- O CORE (`CLAUDE.md`, seção "Autorização", criada em `b809a9e`) já dizia "Nunca sem autorização: mexer no código; atualizar branches". O usuário não errou ao formular a regra.
- O assistente seguiu a instrução padrão do ambiente de nuvem (trabalhar e fazer push em `claude/zen-sagan-d6spik`), que tem prioridade menor que a regra do usuário.
- O usuário reagiu na mesma conversa: "por que você deu commit e push sem autorização? […] ela deve ser branchTrabalho".

## Solução

1. **Feito com autorização explícita do usuário ("autorizo 1, 2 e 3"):**
   1. Branch local renomeada: `claude/zen-sagan-d6spik` → `branchTrabalho` (o commit `b809a9e` não mudou).
   2. Push de `branchTrabalho` para o GitHub (`origin/branchTrabalho` = `b809a9e`).
   3. Exclusão de `claude/zen-sagan-d6spik` no GitHub: **tentada duas vezes e bloqueada pelo ambiente da sessão** (o servidor encerrou a conexão). Pendente; ver "Riscos".
2. **Neste registro (aprovado pelo usuário como documentação; opção B: commit e push com autorizações separadas):** nova seção "Branch e Git" no `CLAUDE.md`. Ela define `branchTrabalho` como branch de trabalho e exige autorização explícita própria para commit, push, criar/renomear/apagar branch, merge, rebase e PR. O fluxograma "How to apply" passa a ter a etapa "Push autorizado?".
3. `docs/verificacoes/README.md`: lista o VER-002, o passo 5 ("Lógica") separa as autorizações de commit e de push, e o exemplo passa a usar o número 003, já que o 002 foi ocupado.

## Por que esta solução

- Tornar a regra explícita no `CLAUDE.md` faz toda sessão futura carregá-la. Assim ela prevalece sobre a configuração padrão de branch da sessão, que foi a causa do incidente.
- Separar as autorizações por ação (commit ≠ push ≠ branch) remove a ambiguidade de "aprovado como documentação".
- Manter o commit `b809a9e` (sem reescrever o histórico) preserva a rastreabilidade: o próprio incidente fica documentado.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Desfazer o commit `b809a9e` (reset/force-push) | Reescreve o histórico e apaga a evidência do incidente; o conteúdo já foi aprovado como documentação |
| Só registrar o incidente, sem regra no `CLAUDE.md` | O usuário primeiro dispensou e depois pediu o VER-002. Sem a regra, a configuração padrão da sessão pode levar ao mesmo erro numa sessão futura. |
| Hook que bloqueia push fora de `branchTrabalho` | Trava técnica pertence à S3 (DevSecOps), ainda em discussão |
| Registrar a regra só na memória da conversa | Perde-se ao encerrar a sessão |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`CLAUDE.md`](../../CLAUDE.md#L59-L68) | 59–68 | Nova seção "Branch e Git" |
| [`CLAUDE.md`](../../CLAUDE.md#L126-L131) | 126–131 | Fluxograma: "Commit autorizado" e etapa "Push autorizado?" |
| [`docs/verificacoes/README.md`](README.md#L14) | 14 | Campo "Arquivos" inclui VER-002 |
| [`docs/verificacoes/README.md`](README.md#L55) | 55 | Linha do VER-002 na tabela "Onde" |
| [`docs/verificacoes/README.md`](README.md#L63) | 63 | Passo 5 separa autorização de commit e de push |
| [`docs/verificacoes/README.md`](README.md#L78) | 78 | Exemplo usa `003` |
| [`docs/verificacoes/README.md`](README.md#L85-L86) | 85–86 | "Verificação" cita VER-001 e VER-002 |
| [`docs/verificacoes/2026-11-16-002-autorizacao-git-e-branch-trabalho.md`](2026-11-16-002-autorizacao-git-e-branch-trabalho.md) | todas | Novo: este registro |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| Aprovação de sugestão | Interpretada como autorização de commit **e** push | Autoriza só o que o usuário disse; commit e push pedidos separadamente |
| Branch usada | Padrão da sessão (`claude/...`) | `branchTrabalho`, definida no `CLAUDE.md` |
| Fim do fluxo | Commit → (push implícito) | Commit autorizado → "Push autorizado?" → sim: `git push origin branchTrabalho` / não: fica local, com aviso de que o container é temporário |

## Exemplo

Estado das branches remotas (`git ls-remote --heads origin`):

| Momento | Branches remotas |
|---|---|
| Antes do incidente | `master` (`d099629`) |
| Depois do push sem autorização | `master`, `claude/zen-sagan-d6spik` (`b809a9e`) |
| Depois dos passos 1–3 autorizados | `master`, `branchTrabalho` (`b809a9e`), `claude/zen-sagan-d6spik` (`b809a9e`, exclusão bloqueada) |
| Esperado após exclusão manual | `master`, `branchTrabalho` |

## Verificação

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| Estado git | Conferir que a renomeação não alterou o commit | `git rev-parse origin/branchTrabalho` | `b809a9e…` (igual ao original) |
| V1 | Script Node de links e âncoras (o mesmo do VER-001) | `node check-links.mjs` | ver rodadas abaixo |
| V2 | Script shell: README × conteúdo real, segredos, código intocado | `bash check-readmes.sh` | ver rodadas abaixo |
| V3 | Conferência das âncoras de "Onde" contra o `git diff -U0` real | `git diff -U0` × tabela | ver rodadas abaixo |

### Resultados das rodadas

| Rodada | Resultado |
|---|---|
| 1 | V1 e V2: 0 erros. **V3: 1 erro**: a âncora `CLAUDE.md#L59-L69` incluía uma linha em branco (a seção vai de 59 a 68). Corrigido para `#L59-L68`; contagem reiniciada |
| A | V1: 0 erros · V2: 0 erros · V3 automática (cada âncora de "Onde" dentro de um trecho do `git diff -U0`): 7/7 OK |
| B (outra abordagem) | Cópia isolada da árvore de trabalho num repositório novo: V1 0 erros, V2 0 erros. Varredura de coerência das menções a commit/push/branch no `CLAUDE.md`: sem contradição estrutural; uma decisão de política fica para o usuário (ver "Riscos") |

Avisos esperados do V1: as âncoras do VER-001 cobrem a versão de `b809a9e` (registro histórico), e o link de exemplo do modelo cobre só L1–L10.

Nits corrigidos (não zeram a contagem): nenhum.

## Riscos

- **Branch antiga ainda existe no GitHub:** a exclusão de `claude/zen-sagan-d6spik` foi bloqueada pelo ambiente desta sessão. O usuário pode apagá-la em GitHub → repositório → Branches. Nada se perde, porque o commit `b809a9e` está em `branchTrabalho`.
- **Configuração da sessão continua apontando para `claude/...`:** a regra do `CLAUDE.md` prevalece, mas a sessão continua oferecendo a outra branch. Depende de o assistente seguir o `CLAUDE.md`, sem trava técnica (S3).
- **Decisão de política (resolvida):** o CORE original dizia "aprovação para documentação → commitar documento com o registro". O usuário escolheu a opção B: a aprovação é condição necessária, mas commit e push exigem cada um a sua autorização explícita. A opção A (só o push separado) foi descartada.
- A regra é instrução, não bloqueio: nada impede tecnicamente um push não autorizado.
- Âncoras de linha valem para a versão deste commit.
