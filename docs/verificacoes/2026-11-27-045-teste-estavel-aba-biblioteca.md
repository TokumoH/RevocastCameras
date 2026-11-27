# VER-045 — Teste estável: `aviso-da-fila-e-saida-da-pagina` espera a limpeza do efeito

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-045 |
| Título | `AbaBiblioteca.test.tsx > aviso-da-fila-e-saida-da-pagina` deixa de oscilar sob carga: espera a limpeza do `useEffect` do `beforeunload`, e não só o texto do aviso |
| Gravidade | média |
| Tipo | correção · teste instável |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-27-045-teste-estavel-aba-biblioteca.md` |
| Arquivos | `src/app/telas/AbaBiblioteca.test.tsx`, `docs/verificacoes/README.md`, este registro (3 arquivos) |

## Problema

1. O teste `aviso-da-fila-e-saida-da-pagina` ([VER-028](2026-11-26-028-e2-aba-biblioteca.md), achado I2 da revisão 1 da E2) falhava de vez em quando no `npm run check` completo. A última falha registrada está na linha C2 do [VER-039](2026-11-27-039-e3-integracao-obs-e-palco.md). Sozinho, ele passava.
2. A falha é sempre a mesma: `AbaBiblioteca.test.tsx:477`, `expected [] to have a length of 1 but got +0`. Ou seja, quando o teste conferia, o `removeEventListener('beforeunload', ouvinte)` ainda não tinha sido chamado, embora o aviso da fila já tivesse sumido da tela.
3. Efeito: um `npm run check` vermelho sem defeito no produto. Isso obriga a repetir a execução e enfraquece a confiança na regra "`npm run check` com 0 erros sobre o conteúdo do commit".

## Era proposital?

Não.

- O teste nasceu na revisão 1 da E2 ([VER-028](2026-11-26-028-e2-aba-biblioteca.md), tabela de achados, linha I2). Ali já foi achada e corrigida uma corrida parecida no mesmo teste: ele esperava a linha da recusa, e não a mensagem dela. A conferência do `removeEventListener` logo depois do `waitFor` do texto não foi questionada.
- O código de produção ([`AbaBiblioteca.tsx`](../../src/app/telas/AbaBiblioteca.tsx#L193-L204)) registra e remove o ouvinte num `useEffect` de propósito: o comentário diz que o ouvinte sai "quando a fila termina e na desmontagem". O código está certo. O que estava errado era a suposição do teste de que a limpeza de um `useEffect` já rodou quando o DOM do mesmo commit aparece.

## Solução

Nos dois pontos em que o teste lê o efeito de uma limpeza de `useEffect` depois de um commit feito **fora de `act`**, a leitura instantânea vira espera pela própria condição, com `waitFor`. O prazo padrão de 1 s não muda.

- Depois do fim do envio: espera `removeEventListener('beforeunload', ouvinte)` ter sido chamado uma vez.
- Depois da recusa do SVG: espera `ativos() === 0`.

O código de produção não muda.

## Por que esta solução

- **Causa.** O fim do envio (`envio.concluir()` resolve uma promessa) e a recusa do SVG são renderizados fora de `act`, pelo Scheduler do React:
  1. o commit tira o aviso do DOM;
  2. o React chama `requestPaint()` no commit (`node_modules/react-dom/cjs/react-dom-client.development.js`, linha 19907), e o Scheduler cede a vez logo depois (`shouldYieldToHost` devolve `true` com `needsPaint`, `node_modules/scheduler/cjs/scheduler.development.js`, linhas 166–171);
  3. por isso os efeitos passivos, entre eles a limpeza que chama `removeEventListener`, ficam para uma **nova macrotarefa** (`setImmediate`, no Node).
  
  Do outro lado, o `waitFor` do texto acorda no microtask do `MutationObserver`, logo depois do commit. Antes de devolver o controle, o `asyncWrapper` do Testing Library espera um `setTimeout(0)` (`node_modules/@testing-library/react/dist/pure.js`, linhas 84–104), que no Node vale 1 ms. Na volta do laço de eventos, a fase de timers vem antes da fase `check`, a do `setImmediate`. Se já passou 1 ms, e sob carga quase sempre passou, o teste volta antes da limpeza e lê 0 chamadas.
- **Correção na causa.** O teste passa a esperar o que quer provar, o ouvinte removido, em vez de usar o texto como substituto do efeito. Não é prazo maior às cegas: o prazo é o mesmo, e a espera termina assim que a condição vale, em geral na macrotarefa seguinte.
- **O teste continua provando o mesmo.** Sem a remoção do ouvinte, a condição nunca vale e o `waitFor` falha em 1 s (sabotagem S1 em [Verificação](#verificação)). Sem o texto, o `getByText` falha como antes (S2).
- **Arquitetura.** Sem mudança de componente, domínio ou adaptador. O teste segue o padrão já usado no arquivo para efeitos assíncronos: `waitFor` sobre a condição.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Aumentar o prazo do `waitFor` do texto ou pôr uma pausa (`setTimeout`) antes de conferir | A limpeza não depende do prazo do texto: o `waitFor` do texto termina antes da limpeza com qualquer prazo. Uma pausa fixa só diminui a chance da corrida e deixa o teste mais lento. |
| Trocar o `useEffect` do `beforeunload` por `useLayoutEffect` em `AbaBiblioteca.tsx` | Mudaria o produto para acomodar o teste. A limpeza passaria a rodar dentro do commit, mas a janela entre o commit e o efeito passivo é de milissegundos e não tem efeito para a pessoa, que não consegue sair da página nesse intervalo. Isso é diferente do foco do VER-033, que era visível. Além disso, a tarefa proíbe mexer no produto sem defeito provado. |
| Envolver `envio.concluir()` e a escolha do SVG num `await act(async () => …)` que espere a promessa do envio | O teste não tem acesso à promessa interna de `processarFila`. Um `act` assíncrono vazio só esvazia o que já está na fila do `act`, e os efeitos agendados no Scheduler real fora dele não entram. A espera continuaria dependendo da ordem. |
| Relógio falso (`vi.useFakeTimers`) | O falso de envio e o Testing Library usam microtarefas e `setTimeout` reais. Misturar relógios é uma das causas clássicas de instabilidade e mudaria o teste inteiro. |
| Pular o teste, ou repetir o teste quando falhar (`retry`) | Esconde a corrida e enfraquece a prova do I2 do VER-028. É proibido pela tarefa. |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/app/telas/AbaBiblioteca.test.tsx`](../../src/app/telas/AbaBiblioteca.test.tsx#L477-L480) | 477–480 (comentário em 477–479, asserção em 480) | `expect(remover…).toHaveLength(1)` imediato passa a `await waitFor(() => expect(remover…).toHaveLength(1))`, com comentário do motivo (commit fora de `act`, limpeza numa tarefa do Scheduler, VER-045) |
| [`src/app/telas/AbaBiblioteca.test.tsx`](../../src/app/telas/AbaBiblioteca.test.tsx#L487-L488) | 487–488 | `expect(ativos()).toBe(0)` imediato passa a `await waitFor(() => expect(ativos()).toBe(0))`: a recusa do SVG também é renderizada fora de `act` |
| [`docs/verificacoes/README.md`](README.md#L98) | 14, 98, 121 | Arquivo novo no cabeçalho, linha nova na tabela "onde" e exemplo hipotético da seção "Exemplo" de 045 para 046 |
| [`docs/verificacoes/2026-11-27-045-teste-estavel-aba-biblioteca.md`](2026-11-27-045-teste-estavel-aba-biblioteca.md) | todo | Este registro |

Sem mudança em: [`AbaBiblioteca.tsx`](../../src/app/telas/AbaBiblioteca.tsx#L193-L204), no efeito do `beforeunload`, e no aviso da [linha 643](../../src/app/telas/AbaBiblioteca.tsx#L643). O [`src/app/telas/README.md`](../../src/app/telas/README.md#L62) também não muda: o arquivo de teste continua com 33 testes e a descrição continua certa.

## Lógica

```mermaid
sequenceDiagram
    participant T as Teste
    participant MO as MutationObserver (microtask)
    participant R as React + Scheduler
    T->>R: act(() => envio.concluir())
    Note over R: a promessa resolve fora do act
    R->>R: tarefa 1 (setImmediate): render + commit, aviso sai do DOM, requestPaint, cede a vez
    R-->>MO: mutação no DOM
    MO->>T: waitFor(texto) satisfeito; asyncWrapper agenda setTimeout(0)
    alt máquina folgada (menos de 1 ms)
        R->>R: tarefa 2 (setImmediate): limpeza do useEffect, removeEventListener
        T->>T: setTimeout dispara; confere remover: 1 chamada (passa)
    else máquina sob carga (1 ms ou mais)
        T->>T: setTimeout dispara antes (fase de timers); confere remover: 0 chamadas (falha na linha 477)
        R->>R: tarefa 2: removeEventListener chega tarde
    end
```

| Passo | Antes | Depois |
|---|---|---|
| 1 | `waitFor` do aviso sumir | igual |
| 2 | `expect(remover…).toHaveLength(1)` lido na hora: depende de a limpeza ter vencido a corrida com o `setTimeout(0)` | `await waitFor(…toHaveLength(1))`: espera a limpeza; falha só se ela não acontecer em 1 s |
| 3 | Recusa do SVG: `findByText(TIPO)` e depois `expect(ativos()).toBe(0)` na hora (mesma corrida, escondida porque o passo 2 falhava antes) | `await waitFor(() => expect(ativos()).toBe(0))` |
| 4 | Desmontagem: `unmount()` roda dentro de `act`, e a limpeza é síncrona | igual: não há corrida |

## Exemplo

Laço de 100 execuções do teste (`npx vitest run src/app/telas/AbaBiblioteca.test.tsx -t aviso-da-fila`), com a suíte inteira (`npx vitest run`) rodando em laço em paralelo como carga, na mesma máquina de 4 núcleos (script `laco.sh` da sessão, fora do repositório):

| Versão do teste | Execuções | Falhas | Taxa | Onde falhou |
|---|---|---|---|---|
| Antes (HEAD `ffa4c05`) | 100 | 9 | 9 % | as 9 em `AbaBiblioteca.test.tsx:477:100` (`expected [] to have a length of 1 but got +0`) |
| Depois (esta correção) | 100 | 0 | 0 % | — |

Sonda determinística: um `setupFile` fora do repositório troca o `setImmediate` (a tarefa seguinte do Scheduler) por `setTimeout(…, 20)`, como numa máquina ocupada em que a próxima tarefa do React chega depois do `setTimeout(0)` do Testing Library. O código testado não muda.

| Versão do teste | Com a sonda | Resultado |
|---|---|---|
| Antes | 5 de 5 execuções | **falhou** nas 5, na linha 477: a mesma assinatura das falhas sob carga |
| Depois | 10 de 10 execuções | passou nas 10 |

## Verificação

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| Diagnóstico 1 | Leitura de código: RTL `asyncWrapper` (`setTimeout(0)` depois do `waitFor`), `requestPaint` no commit e `shouldYieldToHost` com `needsPaint` no Scheduler; efeito do `beforeunload` em `useEffect` | leitura em `node_modules` (`@testing-library/react` 16.3.3, `react-dom` 19.3.1, `scheduler` 0.28.0) | hipótese: a limpeza do efeito roda numa macrotarefa posterior, que corre contra o `setTimeout(0)` |
| Diagnóstico 2 | Reprodução sob carga, versão antiga | laço de 100 com a suíte em paralelo | **9/100** falhas, todas na linha 477 |
| Diagnóstico 3 | Sonda determinística (atrasar o `setImmediate`), versão antiga | `npx vitest run … -t aviso-da-fila --config <sonda>` ×5 | **5/5** falhas na linha 477: confirma a causa |
| Correção | Sonda, versão nova | o mesmo ×10 | 10/10 passam |
| Estabilidade | Laço sob carga, versão nova | laço de 100 com a suíte em paralelo | **0/100** falhas |
| S1 | Sabotagem "sem remover o ouvinte" (I2 do VER-028): a limpeza do efeito em `AbaBiblioteca.tsx` vira `() => {}` | `npx vitest run src/app/telas/AbaBiblioteca.test.tsx` | **derruba** `aviso-da-fila-e-saida-da-pagina` na linha 480 (`expected [] to have a length of 1 but got +0`, depois de 1 s de espera); os outros 32 passam |
| S2 | Sabotagem "sem o texto" (I2 do VER-028): tirar o `<p className="fila__aviso">` | o mesmo | **derruba** `aviso-da-fila-e-saida-da-pagina` na linha 467 (`Unable to find an element with the text: Trocar de aba…`); os outros 32 passam |
| S3 | Sabotagem nova, para a segunda espera: o ouvinte fica enquanto houver qualquer linha na fila (`fila.length > 0` no lugar de `haPendentes` **só no efeito**; trocar o `haPendentes` inteiro derruba antes, na linha 484, pelo texto do aviso), e o texto continua certo | o mesmo | **derruba** `aviso-da-fila-e-saida-da-pagina` na linha 488 (`expected 1 to be +0`): a espera de `ativos() === 0` depois da recusa ainda pega o ouvinte que ficou |
| Arquivo inteiro | Os 33 testes da aba | `npx vitest run src/app/telas/AbaBiblioteca.test.tsx` | 33/33 passam (também dentro do `npm run check`) |
| `npm run check` | Checagem completa | `npm run check` | **0 erros**: `typecheck`; 58 arquivos, **2184 testes**, 0 falhas; `check-docs` 0 (76 `.md`, 45 registros); `check-doc-secrets` 0; `rpc:grants-check` 0; `data-api:check` 0; `check-deps-audit` 0 |
| Revisões | Revisor independente: causa raiz conferida no React 19.3.1 instalado; S1 e S3 repetidas numa cópia (`--no-cache`); laço de 30 execuções sob carga | leitura do diff, sabotagens e laço | **limpa** (0 falhas em 30); 2 nits de texto (variante da S3 só no efeito; linhas de comentário na âncora 477–480) corrigidos pelo controlador, com reconferência pontual (`npm run check` 0 no commit) |

As sabotagens foram aplicadas no arquivo e desfeitas com a cópia guardada. O `sha256sum` de `AbaBiblioteca.tsx` foi conferido igual antes e depois: `6cc30a87…69ba2` nas duas leituras.

Nits corrigidos (não zeram a contagem): nenhum.

## Riscos

- **Mesmo padrão em outros testes.** O laço desta tarefa cobriu só este teste. Sob a sonda, `AbaBiblioteca.test.tsx > arquivo-ficou` também falha: o `findByRole('button', { name: 'Confirmar exclusão' })` pode achar o botão ainda desabilitado enquanto se conta onde a imagem é usada (`contando`). O clique então não faz nada, e o `findByText(ARQUIVO_FICOU)` estoura o prazo. Esse teste não falhou no laço sob carga nem no histórico registrado, e não foi investigado nem mudado aqui, por estar fora do escopo. Fica como pendência para um item próprio, junto com uma busca do mesmo padrão nos outros testes de tela: ler o efeito de um `useEffect`, ou agir num controle, logo depois de um `waitFor`/`findBy` que só esperou o DOM.
- A sonda imita a carga ao atrasar o `setImmediate`. Ela não reproduz cada detalhe de uma máquina ocupada. A prova empírica é o laço de 100 sob carga.
- A taxa depende da máquina e da carga: 9 % aqui, com a suíte em laço em paralelo. Na CI, com outra carga, a taxa antiga podia ser outra. A correção remove a dependência da ordem, e não só a reduz.
