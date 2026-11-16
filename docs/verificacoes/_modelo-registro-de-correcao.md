# VER-NNN — <título curto da correção ou decisão>

<!--
Modelo de registro de correção. Como usar:
1. Copie este arquivo para `AAAA-MM-DD-NNN-slug.md` nesta mesma pasta
   (data do commit, número sequencial de 3 dígitos, slug em minúsculas com hífens).
2. Preencha todas as seções; não remova seções. Se uma seção não se aplicar, escreva "Não se aplica" e o motivo.
3. Links para arquivos são relativos a esta pasta (ex.: `../../src/send.ts#L10-L20`).
4. Adicione o novo arquivo à tabela "onde" de `README.md` desta pasta, no mesmo commit.
5. Não escreva segredos, tokens, e-mails ou dados pessoais neste registro.
Apague este comentário no arquivo copiado.
-->

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-NNN |
| Título | <título> |
| Gravidade | <bloqueador · alta · média · baixa · nit> |
| Tipo | <correção · documentação · refatoração · segurança · desempenho · decisão de arquitetura · …> |
| Data | AAAA-MM-DD |
| Usuário responsável | <usuário> |
| Status de implementação | <implementado · somente documentação> |
| Commits | <hash curto(s); se o registro entra no mesmo commit da mudança: "commit que introduz este arquivo — `git log --format=%h -- <caminho deste arquivo>`"> |
| Arquivos | <lista de arquivos tocados> |

## Problema

<Resumo do que estava errado. Qual efeito (para o usuário, para o sistema, para a manutenção).>

## Era proposital?

<Histórico e evidências: commit de origem (`git log -L`/`git blame`), comentários, specs, tasks, tentativas anteriores. Concluir: sim / não / parcialmente, e por quê.>

## Solução

<Resumo da solução.>

## Por que esta solução

<Raciocínio: como atende à arquitetura (DDD, GRASP Pure Fabrication, Componentes), segurança e otimização.>

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| <opção A> | <motivo> |
| <opção B> | <motivo> |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/send.ts`](../../src/send.ts#L1-L10) | 1–10 | <descrição — exemplo de formato; substitua pelo arquivo real> |

## Lógica

<Passo a passo com antes x depois. Use diagrama/tabela quando ajudar.>

| Passo | Antes | Depois |
|---|---|---|
| 1 | <…> | <…> |

## Exemplo

<Caso real com números que comprovem antes x depois (entrada, saída esperada, saída obtida).>

## Verificação

<Testes, simulações, alterações, sabotagens e resultado. Registrar as duas verificações seguidas sem erro, com abordagens/parâmetros diferentes, e as reconferências pontuais de nits.>

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| V1 | <…> | `<comando>` | <sem erro / achado X> |
| V2 | <outra abordagem> | `<comando>` | <sem erro> |
| Sabotagem | <alteração proposital para provar que a verificação detecta a falha> | `<comando>` | <falhou como esperado> |

Nits corrigidos (não zeram a contagem): <lista ou "nenhum">.

## Riscos

<O que não foi verificado, efeitos colaterais possíveis, pendências.>
