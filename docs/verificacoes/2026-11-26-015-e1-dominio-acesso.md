# VER-015 — E1, Tarefa 1: domínio Acesso (regras puras e portas)

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-015 |
| Título | E1, Tarefa 1: domínio Acesso (regras puras e portas) |
| Gravidade | média |
| Tipo | implementação · decisão de arquitetura |
| Data | 2026-11-26 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-26-015-e1-dominio-acesso.md` |
| Arquivos | `src/domains/README.md`, `src/domains/arquitetura.test.ts`, `src/domains/acesso/README.md`, `src/domains/acesso/{papeis,email,listaDeAcesso,sessao,retornoDoLogin,portas,resolverAcesso}.ts`, `src/domains/acesso/{papeis,email,listaDeAcesso,sessao,retornoDoLogin,resolverAcesso}.test.ts` (novos), `src/README.md`, `docs/verificacoes/README.md`, este registro (19 arquivos) |

## Problema

**Pendências da E0 (abertura exigida pelo [PLA-002](../planos/2026-11-26-e1-entrada-e-membros.md), "Estrutura de arquivos"):**

| Pendência | Origem | Situação em 2026-11-26 |
|---|---|---|
| Deploy de prévia da `branchTrabalho` na Vercel; abrir `/painel`, `/obs/palco`, `/xyz` e recarregar `/painel` | PLA-001, Tarefa 1, Passo 14 ([VER-009](2026-11-17-009-e0-supabase-cliente.md), [VER-011](2026-11-22-011-e0-checagens-banco.md)) | sem resultado informado pelo responsável: **continua pendente** |
| Aplicar `supabase/migrations/20261117000000_fundacao.sql` no editor SQL, cadastrar o primeiro `admin` e conferir as 12 tabelas com RLS | PLA-001, Tarefa 4, Passo 10 ([VER-011](2026-11-22-011-e0-checagens-banco.md)) | sem resultado informado pelo responsável: **continua pendente** |

Nenhum código da E1 depende delas; só a conferência real da Tarefa 6 depende.

**O problema da tarefa:** a E1 precisa decidir, em vários pontos (entrada, guarda por papel, aba Membros), quem é membro, com que papel, o que cada papel abre, como tratar sessão anônima, sessão de outro provedor, conta fora da lista, servidor fora do ar, retorno do login Google com erro e mudanças perigosas na lista de acesso (a própria linha, o último `admin`). Sem um lugar único e testável para essas regras, elas iriam para as telas, misturadas com React e com o cliente Supabase, testáveis só com jsdom e fáceis de divergir entre telas. Também não havia **portas** que deixassem a Tarefa 3 (adaptadores Supabase) e a Tarefa 4 (serviços falsos de tela) escreverem contra o mesmo contrato.

## Era proposital?

Não. A pasta `src/domains/<domínio>/` estava prevista desde o [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md) (§6) e o [PLA-001](../planos/2026-11-17-e0-fundacao.md) para "quando as etapas E1+ os exigirem" (`src/README.md`, seção Organização, até este commit). A E0 não tinha regra de acesso no cliente; a E1 é a primeira a precisar.

## Solução

Nasce `src/domains/acesso/`, só com TypeScript puro:

- `papeis.ts`: `PAPEIS`, `Papel`, `Area`, `ROTULO_DO_PAPEL`, `ehPapel` (só os três textos exatos), `podeAbrir` (painel: `admin`, `equipe`; controle: os três), `areaInicial` (apresentadora → `controle`, D2), `podeGerenciarMembros` (só `admin`).
- `email.ts`: `normalizarEmail` (apara, minúsculas, até 254, formato) e `mesmoEmail` (sem diferenciar maiúsculas; `null` nunca é igual).
- `listaDeAcesso.ts`: `montarLista` (liga perfil por e-mail; ordem por papel e e-mail), `conferirInclusao` (`duplicado`) e `conferirMudanca` (`inexistente` → `propria_linha` → `sem_mudanca` → `ultimo_admin`, D1).
- `sessao.ts`: `UsuarioDaSessao`, `AvisoDeEntrada`, `EstadoDeAcesso`, `AVISOS_FIXOS` e `combinarEstados` (estado **fixo** que o `SIGNED_OUT` do próprio `sair` não apaga, D3).
- `retornoDoLogin.ts`: `lerRetornoDoLogin(busca, fragmento)` lê `?code=`, `?error=` e `#error=` sem nunca devolver o `error_description`.
- `portas.ts`: `ErroDeAcesso` (com `motivo`, mensagem sem e-mail), `ServicoDeAutenticacao`, `RepositorioDeAcesso` (D6: repositório do agregado de acesso, sem classe genérica) e `ServicosDeMembro`.
- `resolverAcesso.ts`: serviço de domínio que transforma sessão + papel + retorno do login num `EstadoDeAcesso`, numa ordem fixa, com todo `sair` passando por `sairSemFalhar`.
- `src/domains/arquitetura.test.ts`: nenhum arquivo de domínio importa `react`, `@supabase/*`, `shared/` ou `app/`.

**Decisões do PLA-002 aplicadas aqui:** D3 (conta fora da lista: `resolverAcesso` devolve `sem_papel` com o e-mail e encerra a sessão; `combinarEstados` mantém a mensagem depois do `SIGNED_OUT`) e D6 (porta `RepositorioDeAcesso` do agregado, sem `RepositorioSupabase<T>`); também D1 na interface (`propria_linha`, `ultimo_admin`) e D2 (`areaInicial`).

## Por que esta solução

- **DDD:** regras e portas no domínio, sem dependência de biblioteca; a seta de dependência aponta para dentro (os adaptadores de `shared/infra` implementam as portas; `app/` compõe).
- **GRASP Pure Fabrication:** `resolverAcesso` e as portas são fabricações que juntam o que nenhuma entidade do desenho faria sozinha (sessão do Auth + papel do banco + URL de retorno).
- **Componentes:** cada conceito num arquivo, com teste ao lado; o teste de arquitetura garante a fronteira.
- **Segurança:** sessão anônima e de outro provedor nunca chegam a perguntar o papel; falha ao ler a sessão ou o papel não encerra a sessão nem manda a pessoa para a entrada (servidor fora não é logout); o texto do `error_description` não sai de `lerRetornoDoLogin`; `ehPapel` não aceita chaves herdadas (`toString`); a mensagem de `ErroDeAcesso` não leva e-mail.
- **Otimização:** funções puras e síncronas (menos `resolverAcesso`), sem estado global; testes rodam em menos de 1 s, sem jsdom.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Regras dentro das telas e do hook de tela | Só testáveis com jsdom; repetidas entre `/painel`, `/controle` e a aba Membros |
| Portas em `shared/infra` junto dos adaptadores | O domínio importaria a infraestrutura, invertendo o DDD |
| `ehPapel` com `valor in ROTULO_DO_PAPEL` | Aceitaria `toString`, `constructor` e outras chaves herdadas (testado) |
| A regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` do brief, sozinha | Aceita `a@revocast.test.` (ponto final), `a@.revocast.test` e `a@revocast..test`, e o teste do próprio brief exige recusar `a@revocast.test.`; trocada por `/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/` (domínio sem rótulo vazio), que dá o mesmo resultado nos demais casos |
| `resolverAcesso` chamando `auth.sair()` direto | A porta promete não lançar, mas um adaptador com defeito derrubaria a avaliação e a pessoa veria falha em vez da mensagem certa (sabotagem S5) |
| `combinarEstados` protegendo só `sem_papel` | O aviso de sessão anônima, provedor inválido ou sessão expirada sumiria com o `SIGNED_OUT` do próprio `sair` (sabotagem S7) |
| Teste de arquitetura com `fs` e `node:path` | O `tsconfig` tipa `vite/client`, não Node; `import.meta.glob` com `?raw` já lê os arquivos no Vitest sem dependência nova |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/domains/README.md`](../../src/domains/README.md#L1-L79) | 1–79 | Novo: README de 11 seções da pasta dos domínios, com o diagrama das portas |
| [`src/domains/arquitetura.test.ts`](../../src/domains/arquitetura.test.ts#L1-L63) | 1–63 | Novo: 3 testes da fronteira dos domínios |
| [`src/domains/acesso/README.md`](../../src/domains/acesso/README.md#L1-L118) | 1–118 | Novo: README de 11 seções do domínio Acesso, com o diagrama domínio ← adaptadores ← composição e a ordem de `resolverAcesso` |
| [`src/domains/acesso/papeis.ts`](../../src/domains/acesso/papeis.ts#L1-L36) | 1–36 | Novo; `ehPapel` em [21](../../src/domains/acesso/papeis.ts#L21) |
| [`src/domains/acesso/email.ts`](../../src/domains/acesso/email.ts#L1-L25) | 1–25 | Novo; formato em [11](../../src/domains/acesso/email.ts#L11) |
| [`src/domains/acesso/listaDeAcesso.ts`](../../src/domains/acesso/listaDeAcesso.ts#L1-L70) | 1–70 | Novo; própria linha e último `admin` em [65–68](../../src/domains/acesso/listaDeAcesso.ts#L65-L68) |
| [`src/domains/acesso/sessao.ts`](../../src/domains/acesso/sessao.ts#L1-L49) | 1–49 | Novo; estado fixo e `combinarEstados` em [30–49](../../src/domains/acesso/sessao.ts#L30-L49) |
| [`src/domains/acesso/retornoDoLogin.ts`](../../src/domains/acesso/retornoDoLogin.ts#L1-L46) | 1–46 | Novo; `lerRetornoDoLogin` em [34](../../src/domains/acesso/retornoDoLogin.ts#L34) |
| [`src/domains/acesso/portas.ts`](../../src/domains/acesso/portas.ts#L1-L44) | 1–44 | Novo; `ErroDeAcesso` em [9](../../src/domains/acesso/portas.ts#L9) |
| [`src/domains/acesso/resolverAcesso.ts`](../../src/domains/acesso/resolverAcesso.ts#L1-L67) | 1–67 | Novo; `sairSemFalhar` em [7](../../src/domains/acesso/resolverAcesso.ts#L7), `resolverAcesso` em [28](../../src/domains/acesso/resolverAcesso.ts#L28) |
| [`src/domains/acesso/papeis.test.ts`](../../src/domains/acesso/papeis.test.ts#L1-L33) | 1–33 | Novo: 9 testes |
| [`src/domains/acesso/email.test.ts`](../../src/domains/acesso/email.test.ts#L1-L40) | 1–40 | Novo: 4 testes |
| [`src/domains/acesso/listaDeAcesso.test.ts`](../../src/domains/acesso/listaDeAcesso.test.ts#L1-L106) | 1–106 | Novo: 8 testes |
| [`src/domains/acesso/sessao.test.ts`](../../src/domains/acesso/sessao.test.ts#L1-L62) | 1–62 | Novo: 4 testes |
| [`src/domains/acesso/retornoDoLogin.test.ts`](../../src/domains/acesso/retornoDoLogin.test.ts#L1-L63) | 1–63 | Novo: 6 testes |
| [`src/domains/acesso/resolverAcesso.test.ts`](../../src/domains/acesso/resolverAcesso.test.ts#L1-L178) | 1–178 | Novo: 12 testes, com serviços falsos no próprio arquivo |
| [`src/README.md`](../../src/README.md#L14) | 14, 18, 26–27, 47–48, 58, 75 | `domains/` no campo "Arquivos", no propósito, na organização (a frase sobre "quando as etapas E1+ os exigirem" passa ao presente), em "Onde" e na lógica; o risco falso "`shared/infra/` ainda não existe" troca por "`domains/acesso/` ainda sem adaptador e sem tela" |
| [`docs/verificacoes/README.md`](README.md#L14) | 14, 68 | Campo "Arquivos" e linha do VER-015 em "Onde" (o exemplo continua em 021, porque o PLA-002 reserva 015 a 020) |
| este registro | — | Novo |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| 1 | Nenhuma regra de acesso no cliente | Regras puras em `src/domains/acesso/`, testadas sem jsdom |
| 2 | Sem contrato entre domínio e Supabase | Portas `ServicoDeAutenticacao` e `RepositorioDeAcesso`; a Tarefa 3 implementa, a Tarefa 4 usa e falsifica |
| 3 | Fronteira do domínio só por convenção | `arquitetura.test.ts` falha se um domínio importar React, Supabase, `shared/` ou `app/` |

Ordem de `resolverAcesso`: ler a sessão (erro → `falha`, sem `sair`) → sem sessão (aviso pelo retorno: `cancelado` → `login_cancelado`, `falha` → `login_falhou`, senão `temCodigo` → `login_incompleto`, senão nenhum) → anônima (`sair`, `sessao_anonima`) → provedor não `google` (`sair`, `provedor_invalido`) → `papelAtual()`: `ErroDeAcesso('sessao_expirada')` → `sair` + aviso; outro erro → `falha` → papel nulo → `sair` + `sem_papel` com o e-mail → papel → `membro`. Tabela completa no [README do domínio](../../src/domains/acesso/README.md#lógica).

`lerRetornoDoLogin`: `sujo`/`fragmentoSujo` = a busca/o fragmento tem algum de `PARAMETROS_DE_RETORNO`; `erro` = `access_denied` → `cancelado`, qualquer outro de `error`, `error_code`, `error_description` → `falha` (a busca tem prioridade sobre o fragmento); `temCodigo` só pela busca (o PKCE devolve o `code` na busca; o fragmento das rotas de dispositivo é do pareamento). Sem nenhum parâmetro de retorno nos dois → `SEM_RETORNO` (o mesmo objeto).

## Exemplo

| Entrada | Saída |
|---|---|
| `normalizarEmail('  Nova@Revocast.TEST ')` | `{ ok: true, email: 'nova@revocast.test' }` |
| `normalizarEmail('a@revocast.test.')` | `{ ok: false, motivo: 'formato' }` (a regex do brief sozinha aceitaria) |
| `conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, 'Adm@Revocast.TEST')` | `'propria_linha'` (com `===` daria `'ultimo_admin'`, sabotagem S2) |
| `lerRetornoDoLogin('?error=access_denied&error_description=Ligue+para+tal+n%C3%BAmero', '')` | `{ erro: 'cancelado', temCodigo: false, sujo: true, fragmentoSujo: false }` |
| `resolverAcesso` com usuário anônimo e `papelAtual` que devolveria `'admin'` | `{ tipo: 'sem_sessao', aviso: 'sessao_anonima' }`; `sair` 1 vez, `papelAtual` 0 vezes |
| `combinarEstados({ tipo: 'sem_papel', email }, { tipo: 'sem_sessao', aviso: null })` | o próprio `sem_papel` (a mensagem fica) |

## Verificação

**Testes:** `npx vitest run src/domains`: 7 arquivos, 46 testes (43 do domínio Acesso + 3 de arquitetura). TDD: os 5 arquivos de regras rodaram primeiro sem implementação (5 arquivos falharam, módulos inexistentes) e passaram depois (30 testes); `resolverAcesso.test.ts` falhou sem o módulo e passou depois (11 testes).

**Sabotagens** (uma de cada vez, desfeita por cópia do arquivo original guardado fora do repositório, conferida com `cmp`):

| # | Sabotagem | Teste que caiu |
|---|---|---|
| S0 (Passo 7) | `import type { SupabaseClient } from '@supabase/supabase-js'` na linha 1 de `portas.ts` | `nenhum arquivo de domínio importa React, Supabase, shared/ ou app/`, citando `./acesso/portas.ts: importa '@supabase/supabase-js' (@supabase/)` |
| S1 | `normalizarEmail` sem `toLowerCase` | `normaliza-email` |
| S2 | própria linha com `linha.email === emailDaSessao` em vez de `mesmoEmail` | `propria-linha-com-maiusculas` |
| S3 | sem a conferência de anônimo em `resolverAcesso` | `anonima-nunca-membro` (e `sair-que-falha-nao-derruba`, que tem um caso anônimo) |
| S4 | `usuarioAtual()` sem `try` | `falha-ao-ler-sessao` |
| S5 | `await auth.sair()` direto no lugar de `await sairSemFalhar(auth)` (as 4 chamadas) | `sair-que-falha-nao-derruba` |
| S6 | `ehPapel` reduzido a `typeof valor === 'string'` | `ehPapel só aceita os três valores exatos` |
| S7 | `combinarEstados` protegendo só `sem_papel` | `estado-fixo` |
| S8 (N1) | `sairSemFalhar` sem `await` (`void auth.sair().catch(() => {})`) | `so-termina-depois-do-sair` |
| S9 (N2) | `zsab.tsx`, `zsab.mts` e `zsab.js` com `import { useState } from 'react'` em `acesso/`, um de cada vez (um `zsab.test.tsx` com o mesmo import é pulado: 3/3 passam) | `nenhum arquivo de domínio importa React, Supabase, shared/ ou app/`, citando o arquivo |
| S10 (N3, R5 do revisor) | `temCodigo` também pelo fragmento | `busca tem prioridade e temCodigo só olha a busca` |
| S11 (N3, R6 do revisor) | erro do fragmento com prioridade sobre o da busca | `busca tem prioridade e temCodigo só olha a busca` |

**Checagens:** `npm run typecheck` 0 erros; `npm run check` com 0 erros como último ato da implementação.

**Dupla verificação (revisões independentes):** (a registrar pelo controlador)

**Revisão 1 (revisor independente):** spec ✅, qualidade aprovada, 5 nits (relatório do revisor, sabotagens próprias R1–R6). Incorporados pela decisão (a), com reconferência pontual e sem nova rodada (são teste a mais e documentação; nenhum muda o código de produção):

| Nit | Achado | Incorporação | Reconferência |
|---|---|---|---|
| N1 | Nenhum teste provava que `resolverAcesso` só termina depois do `sair` (R4: sem `await` passava 44/44) | Teste `so-termina-depois-do-sair` com `sair` segurado, nos casos fora da lista, anônima e sessão expirada | S8 derruba o teste |
| N2 | O teste de arquitetura só lia `.ts` | Glob `./**/*.{ts,tsx,mts,cts,js,jsx}`, pulando `/\.test\.[^./]+$/` | S9 derruba o teste; `.test.tsx` pulado |
| N3 | Prioridade da busca e `temCodigo` só pela busca sem teste (R5 e R6 passavam) | Dois asserts em `retornoDoLogin.test.ts` | S10 e S11 derrubam o teste |
| N4 | `normalizarEmail` aceita caracteres invisíveis ou de controle | Sem mudança de código; citado nos Riscos deste registro e do README do domínio | `node scripts/check-docs.mjs` |
| N5 | Risco das âncoras deslocadas impreciso (`#L64` não desloca) | Texto corrigido nos Riscos | `node scripts/check-docs.mjs` |

Reconferência pontual depois dos nits: `npx vitest run src --maxWorkers=2`, `npm run typecheck` e `node scripts/check-docs.mjs` (resultados no relatório da tarefa).

## Riscos

- **Portas sem adaptador real ainda:** o contrato de `sair()` ("nunca lança; emite SIGNED_OUT antes de resolver") e o de `usuarioAtual()` ("erro → `ErroDeAcesso('rede')`") são provados só nas Tarefas 3 e 4. O domínio já se protege de um `sair` que lança (S5).
- **`ultimo_admin` na interface usa a lista da tela:** com lista antiga, a recusa pode estar errada; a garantia é do banco (D1, Tarefa 2). Continua o limite da D1 (dois admins que se removem no mesmo instante).
- **Formato do e-mail:** a regex confere só a forma; diverge do texto literal do brief para cumprir o teste do próprio brief (ver "Por que não outras soluções"). Caracteres invisíveis ou de controle (U+200B, que `trim` e `\s` não removem; `\u0000`) são aceitos por `normalizarEmail`: um e-mail colado com eles entra na lista, nunca casa com o e-mail da sessão Google e não dá acesso (falha fechada; N4 da revisão 1).
- **Teste de arquitetura por texto:** um import com caminho montado em variável escaparia; o detector tem teste próprio para as formas comuns (estático, `export from`, import de efeito, `import()` dinâmico).
- **Âncoras de registros antigos:** a linha nova do VER-015 em "Onde" de `docs/verificacoes/README.md` empurra uma linha o conteúdo seguinte: a linha nova entrou na 68, então a âncora `README.md#L64` do VER-013 não se desloca; deslocam-se `README.md#L68`, `#L72` e `#L76` do VER-013, `README.md#L85-L88` do VER-010 (seção "Exemplo") e as linhas 87 e 90 citadas em texto no VER-014, que passam a apontar uma linha antes do conteúdo original, como já tinha acontecido nos VER-010, VER-011 e VER-014. Os arquivos não encolheram (`docs/verificacoes/README.md` passa de 104 para 105 linhas; mínimo 93).
- **Pendências da E0:** as duas da tabela de "Problema" continuam com o responsável.
