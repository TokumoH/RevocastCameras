# VER-033 — Aba Membros: foco no mesmo commit do aviso (`useLayoutEffect`)

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-033 |
| Título | Aba Membros: o foco depois de uma ação passa de `useEffect` para `useLayoutEffect`, com teste determinístico (`MutationObserver`) |
| Gravidade | média |
| Tipo | correção · acessibilidade |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-27-033-membros-foco-no-mesmo-commit.md` |
| Arquivos | `src/app/telas/AbaMembros.tsx`, `src/app/telas/AbaMembros.test.tsx`, `src/app/telas/README.md`, este registro (4 arquivos) |

## Problema

1. A aba Membros ([VER-019](2026-11-26-019-e1-painel-e-membros.md), Tarefa 5 da E1) aplicava o foco depois de cada ação (incluir, salvar papel, remover, erro) num `useEffect`. Numa renderização fora de evento (a continuação de uma escrita assíncrona), o `useEffect` roda depois da pintura: o aviso aparece com o foco ainda no `<body>` por um instante, e a ordem depende do navegador. Efeito: intermitência de foco e anúncio de leitor de tela sem o foco no aviso (WCAG 2.4.3).
2. Os testes de foco existentes (`foco-depois-de-salvar`, `-remover`, `-incluir`, `-no-erro`) usam `waitFor`, que espera o foco chegar e por isso não detecta o atraso.

## Era proposital?

Não. O `useEffect` era a escolha comum; o problema só foi descoberto na E2 ([VER-028](2026-11-26-028-e2-aba-biblioteca.md), aba Biblioteca), que trocou para `useLayoutEffect` e criou o teste `foco-no-mesmo-commit-do-aviso`. Esta correção aplica a mesma lição à aba da E1.

## Solução

Trocar o efeito de foco de `AbaMembros.tsx` por `useLayoutEffect` (mesma lógica, mesmas dependências: roda depois de cada render) e acrescentar o teste `foco-no-mesmo-commit-do-aviso`, que lê `document.activeElement` no instante em que o texto entra nas regiões `status` e `alert`.

## Por que esta solução

`useLayoutEffect` roda no mesmo commit, antes da pintura: o aviso e o foco aparecem juntos. Mudança mínima, sem novo componente nem estado; mantém o padrão já adotado na Biblioteca. O teste não depende de tempo (lê o foco dentro do callback do `MutationObserver`, que dispara quando o DOM muda).

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Manter `useEffect` e confiar em `waitFor` nos testes | `waitFor` espera e esconde o atraso; não prova o foco no commit do aviso |
| Focar dentro do handler (`escrever`) com `flushSync` | Acopla o handler ao DOM e força render síncrono; o efeito de layout já resolve |
| `requestAnimationFrame`/`setTimeout` | Continua depois da pintura, e o teste dependeria de tempo |
| Mover o foco para um componente compartilhado agora | Fora do escopo; mudança maior sem pedido |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`AbaMembros.tsx`](../../src/app/telas/AbaMembros.tsx#L1) | 1 | import de `useLayoutEffect` |
| [`AbaMembros.tsx`](../../src/app/telas/AbaMembros.tsx#L103-L117) | 103–117 | o efeito de foco passa a `useLayoutEffect`; comentário explica o motivo |
| [`AbaMembros.test.tsx`](../../src/app/telas/AbaMembros.test.tsx#L394-L430) | 394–430 | teste `foco-no-mesmo-commit-do-aviso` (sucesso → `status`; erro → `alert`) |
| [`README.md`](../../src/app/telas/README.md) | — | contagem de testes (28), descrição do foco e origem |

## Lógica

| Passo | Antes (`useEffect`) | Depois (`useLayoutEffect`) |
|---|---|---|
| 1 | a escrita termina; React comita o aviso e `ocupado = false` | igual |
| 2 | o navegador pode pintar com o foco no `<body>` | o efeito de layout foca o alvo antes da pintura |
| 3 | o efeito roda depois e foca o alvo | — |
| 4 | no instante em que o texto entra, `document.activeElement` é o `<body>` | no instante em que o texto entra, `document.activeElement` é a região do aviso |

## Exemplo

Remover `bia@revocast.test` (sucesso) e depois incluir com falha de rede (erro):

| Momento da leitura do foco | Antes | Depois |
|---|---|---|
| texto "Lista atualizada." entra no `status` | `<body>` (teste falha em `expect(focoNaHora.status).toBe(status)`) | o próprio `status` |
| texto de erro entra no `alert` | não chega a ser lido (já falhou no primeiro) | o próprio `alert` |

## Verificação

revisão do controlador (diff de `AbaMembros.tsx` lido: só a troca de `useEffect` por `useLayoutEffect`, com a mesma lógica e o motivo comentado; o teste `foco-no-mesmo-commit-do-aviso` falha com o código anterior e passa 10 vezes seguidas com o novo; a sabotagem que volta a `useEffect` derruba só ele): **aprovada**, sem achado. Item pequeno, sem efeito de segurança; pela decisão do responsável de 2026-11-22, sem segunda rodada

Execução do implementador (informativa): teste novo falhou com o código atual (27 passaram, 1 falhou); com `useLayoutEffect`, 28 de 28, 10 execuções seguidas sem falha; sabotagem (voltar a `useEffect`) derrubou só o teste novo.

## Riscos

- O teste cobre o jsdom; o Chromium real não foi reconferido nesta tarefa.
- A rodada de erro do teste só é lida se a de sucesso passar (a mesma `it`); com `useEffect` só a primeira asserção é exercitada.
- Os testes `foco-depois-*` continuam com `waitFor` (cobrem o alvo do foco, não o instante).
