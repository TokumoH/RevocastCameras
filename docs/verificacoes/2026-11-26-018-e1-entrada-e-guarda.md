# VER-018 — E1, Tarefa 4: entrada, guarda por papel e telas de erro

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-018 |
| Título | E1, Tarefa 4: entrada, guarda por papel e telas de erro |
| Gravidade | alta |
| Tipo | implementação · segurança · decisão de arquitetura |
| Data | 2026-11-26 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado (no repositório; o login real com Google e Supabase é conferido na Tarefa 6 do PLA-002) |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-26-018-e1-entrada-e-guarda.md` |
| Arquivos | `src/app/dependencias.ts` (novo), `src/app/useAcesso.ts` (novo), `src/app/servicosFalsos.ts` (novo), `src/app/GuardaDeMembro.tsx` (novo), `src/app/acesso.test.tsx` (novo), `src/app/dependencias.test.ts` (novo), `src/app/telas/EstadosDeAcesso.tsx` (novo), `src/shared/ui/Mensagem.tsx` (novo), `src/app/App.tsx`, `src/app/App.test.tsx`, `src/app/telas/Entrar.tsx`, `src/app/telas/Painel.tsx`, `src/app/telas/Controle.tsx`, `src/shared/styles/base.css`, `src/app/README.md`, `src/app/telas/README.md`, `src/shared/ui/README.md`, `src/shared/styles/README.md`, `src/README.md`, `src/shared/README.md`, `src/shared/infra/README.md`, `src/domains/acesso/README.md`, `docs/verificacoes/README.md`, este registro (24 arquivos) |

## Problema

1. **Ninguém entrava.** O domínio Acesso ([VER-015](2026-11-26-015-e1-dominio-acesso.md)) e os adaptadores Supabase com a composição ([VER-017](2026-11-26-017-e1-adaptadores-acesso.md)) existiam, mas `/entrar`, `/painel` e `/controle` eram telas provisórias ("Em construção — etapa E1/E3"): nenhuma lia a sessão nem o papel, nenhuma tinha o botão "Entrar com Google", e qualquer pessoa abria `/painel`.
2. **Erros sem tela.** Um `ErroDeConfiguracao` (variável do Supabase ausente) não aparecia em lugar nenhum; um erro inesperado ao criar os serviços derrubaria o React e deixaria a página em branco.
3. **Riscos de interface que nenhum teste "natural" cobre** (Foco da revisão do [PLA-002](../planos/2026-11-26-e1-entrada-e-membros.md#foco-da-revisão), itens 1, 3, 4, 7, 8, 9, 10 e 12): o `SIGNED_OUT` que o próprio `sair()` emite **antes de resolver** apagaria a mensagem de "fora da lista" ou o aviso de sessão anônima; o retorno da URL (`?code=`, `?error=`) relido a cada reavaliação traria de volta avisos velhos; limpar a URL antes de o `auth-js` trocar o `code` quebraria o login; um parâmetro `?volta=` escolhendo o destino do login seria um redirecionamento aberto; e as rotas de dispositivo não podem criar o cliente de membro.
4. **Item 3 do Foco da revisão do PLA-001** (erro de configuração na tela, sem o valor da variável) estava em aberto desde a E0.

## Era proposital?

Sim, a ausência era o plano: o PLA-002 ([Estrutura de arquivos](../planos/2026-11-26-e1-entrada-e-membros.md#estrutura-de-arquivos)) põe as telas na Tarefa 4, depois do domínio (Tarefa 1), do banco (Tarefa 2) e dos adaptadores (Tarefa 3). Os READMEs de `src/app/` e de `src/shared/infra/` diziam que a Tarefa 4 chamaria `obterServicosDeMembro` e mostraria o `ErroDeConfiguracao`. A fila serializada de avaliações (no lugar do descarte da avaliação antiga) vem do achado I-A da segunda revisão do plano: com o descarte, a avaliação do `SIGNED_OUT` terminava primeiro e a que trazia `sem_papel` era descartada; a sonda com o supabase-js 2.119.0 mostrou o `SIGNED_OUT` em 57 ms e o `signOut` resolvendo só em 357 ms, depois do `POST /auth/v1/logout`.

## Solução

- **`dependencias.ts`**: interface `Dependencias` (o que as telas de membro pedem ao mundo de fora), `caminhoDaArea`, `urlDeRetorno(origem, area)` (origem + `/painel`, `/controle` ou `/entrar`, nada mais) e `dependenciasDoNavegador()`, preguiçosa (`obterServicos: obterServicosDeMembro`, sem chamar), com `limparRetornoDaUrl` por `history.replaceState` e `aoVoltarAVer` por `visibilitychange`.
- **`useAcesso.ts`**: estado de tela. Chama `dep.obterServicos()` num `try` (`ErroDeConfiguracao` → `erro_de_configuracao` com a mensagem; outro erro → `erro_inesperado`); lê o retorno da URL uma vez; as avaliações e as ações entram numa fila (`montagem.fila = montagem.fila.then(...)`), cada uma só começa depois de a anterior aplicar o resultado; a `primeira` usa o retorno da URL e, depois de aplicada, limpa a URL se suja; as `automatica` (evento de sessão, volta à aba, `reavaliar`) usam `SEM_RETORNO` e `combinarEstados`; as de `acao` (Tentar de novo) usam `SEM_RETORNO` e aplicam direto; `entrar` e `sair` também entram na fila. Cada montagem tem o seu objeto (`ativo`, serviços, retorno, último estado, fila), posto em `ativo = false` na desmontagem (o StrictMode monta duas vezes em desenvolvimento).
- **`GuardaDeMembro.tsx`**: telas de cada estado; membro sem o papel da área → "Sem acesso a esta página"; membro com o papel → cabeçalho (e-mail, papel, Sair) + o conteúdo (função `children` com `usuario`, `papel`, `servicos`, `reavaliar`).
- **`telas/EstadosDeAcesso.tsx`**: as telas (carregando, configuração incompleta, erro inesperado, entrada com aviso, fora da lista, sem acesso, falha), `TelaDeAcesso` (escolhe pela variante do estado), `CabecalhoDoMembro` e `TEXTO_DO_AVISO` (textos fixos; nenhum vem da URL).
- **`Entrar`** usa `useAcesso` direto (membro → `navegar(caminhoDaArea(areaInicial(papel)))`, D2); **`Painel`** e **`Controle`** envolvem o conteúdo provisório em `GuardaDeMembro`; **`App`** guarda as dependências com `useState(() => dependencias ?? dependenciasDoNavegador())` e só as passa às três telas de membro. `main.tsx` não mudou (continua montando `<App caminho={window.location.pathname} />`).
- **`shared/ui/Mensagem.tsx`** (`erro` → `role="alert"`; `info` → `role="status"`) e as classes `.mensagem`, `.mensagem--erro`, `.cabecalho-membro` e `.botao--contorno` em `base.css`, só com variáveis de `tokens.css`.
- **`servicosFalsos.ts`** (só para testes): falsos das portas e das dependências; `sair()` põe o usuário em `null`, emite a mudança de sessão numa microtarefa e só resolve depois (`setTimeout(0)`, ou `liberarSair()` com `segurarSair()`).

Decisões do PLA-002 aplicadas: **D2** (apresentadora vai para `/controle`; `/controle` com a mesma guarda para os três papéis, conteúdo da E3), **D3** (fora da lista: e-mail na tela, sessão local encerrada, mensagem fica depois do `SIGNED_OUT`, "Entrar com outra conta") e **D5** (nenhuma tela usa sessão anônima; o cliente de membro a recusa e mostra o aviso fixo). Fecha o item 3 do Foco da revisão do [PLA-001](../planos/2026-11-17-e0-fundacao.md).

## Por que esta solução

- **Componentes e Pure Fabrication:** `useAcesso` é a única peça com estado de acesso; `TelaDeAcesso` é usada por `Entrar` e pela guarda (nenhuma tela repetida); `Mensagem` vai para `shared/ui` porque a Tarefa 5 também mostra avisos. As regras continuam no domínio (`resolverAcesso`, `combinarEstados`, `lerRetornoDoLogin`); o hook só ordena e aplica.
- **Fila no lugar do descarte:** é a única forma, entre as testadas no plano, em que a reavaliação do `SIGNED_OUT` emitido antes de o `sair` resolver vem **depois** do estado fixo e passa por `combinarEstados`. O custo é, no pior caso, uma leitura a mais de sessão e papel.
- **Segurança:** a URL de retorno sai só da origem e de três caminhos; o `error_description` nunca é lido pela tela (o domínio já o descarta e os textos são fixos); o erro inesperado não mostra mensagem nem pilha; e-mail sempre como texto React; nada é registrado em `console`.
- **Otimização:** o cliente de membro só nasce nas rotas de membro (`obterServicos` só é chamado pelo `useAcesso`), provado pelo caminho padrão com `createClient` simulado.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Avaliações em paralelo, descartando o resultado de uma avaliação antiga (primeira versão do plano) | O `SIGNED_OUT` do `sair()` chega antes de o `sair` resolver; a reavaliação dele termina primeiro e a avaliação que trazia `sem_papel` é descartada: a mensagem some. Sabotagem S4 derruba 5 testes |
| Descartar só quando uma avaliação mais nova já aplicou | Falha no modo real (mesma sonda do plano) |
| Aplicar as reavaliações sem `combinarEstados`, protegendo só `sem_papel` | O aviso de sessão anônima e o de sessão expirada somem com o `SIGNED_OUT` (sabotagem S3) |
| `ativo` único em `useRef` para todas as montagens | Com o StrictMode, a segunda montagem poria `ativo = true` de novo e a avaliação da primeira montagem aplicaria resultado; um objeto por montagem evita isso |
| `urlDeRetorno` aceitando `?volta=`/`?next=` | Redirecionamento aberto (Foco da revisão, item 12; sabotagem S8) |
| Criar os serviços no corpo do `App` ou em `dependenciasDoNavegador` | Rotas de dispositivo criariam o cliente de membro (sabotagens S6 e S7) |
| Roteador com guarda (react-router) | Dependência nova; a E1 não precisa de nenhuma |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/app/dependencias.ts`](../../src/app/dependencias.ts#L1-L61) | 1–61 | Novo: `Dependencias`, `caminhoDaArea`, `urlDeRetorno`, `dependenciasDoNavegador` |
| [`src/app/useAcesso.ts`](../../src/app/useAcesso.ts#L1-L162) | 1–162 | Novo: `EstadoDaTela` e `useAcesso`; fila em 65–80, avaliação e limpeza da URL em 82–93, efeito de montagem em 95–126, `sair` em 148–159 |
| [`src/app/servicosFalsos.ts`](../../src/app/servicosFalsos.ts#L1-L181) | 1–181 | Novo (só para testes): `usuarioGoogle`, `criarFalsos` (com `ouvintesAtivos`, acrescentado pelo N2) |
| [`src/app/GuardaDeMembro.tsx`](../../src/app/GuardaDeMembro.tsx#L1-L38) | 1–38 | Novo: guarda por área |
| [`src/app/telas/EstadosDeAcesso.tsx`](../../src/app/telas/EstadosDeAcesso.tsx#L1-L139) | 1–139 | Novo: telas dos estados, `TelaDeAcesso`, `CabecalhoDoMembro`, `TEXTO_DO_AVISO` |
| [`src/shared/ui/Mensagem.tsx`](../../src/shared/ui/Mensagem.tsx#L1-L10) | 1–10 | Novo: aviso com tom e papel ARIA |
| [`src/app/App.tsx`](../../src/app/App.tsx#L1-L34) | 1–34 | `App({ caminho, dependencias? })`; dependências guardadas uma vez e passadas só às telas de membro |
| [`src/app/telas/Entrar.tsx`](../../src/app/telas/Entrar.tsx#L1-L31) | 1–31 | `/entrar` real com `useAcesso` |
| [`src/app/telas/Painel.tsx`](../../src/app/telas/Painel.tsx#L1-L12) | 1–12 | Guardado (`area="painel"`); conteúdo provisório até a Tarefa 5 |
| [`src/app/telas/Controle.tsx`](../../src/app/telas/Controle.tsx#L1-L12) | 1–12 | Guardado (`area="controle"`); conteúdo provisório até a E3 |
| [`src/shared/styles/base.css`](../../src/shared/styles/base.css#L65-L99) | 65–99 | `.botao--contorno`, `.mensagem`, `.mensagem--erro`, `.cabecalho-membro` |
| [`src/app/acesso.test.tsx`](../../src/app/acesso.test.tsx#L1-L381) | 1–381 | Novo: 26 testes de entrada e guarda (21 do plano e 5 dos nits N1–N4) |
| [`src/app/dependencias.test.ts`](../../src/app/dependencias.test.ts#L1-L61) | 1–61 | Novo (N4): 5 testes jsdom de `dependencias.ts` |
| [`src/app/App.test.tsx`](../../src/app/App.test.tsx#L1-L90) | 1–90 | Rotas de membro com membro falso; `caminho-padrao-nao-cria-cliente-em-dispositivo` |
| [`src/app/README.md`](../../src/app/README.md), [`src/app/telas/README.md`](../../src/app/telas/README.md), [`src/shared/ui/README.md`](../../src/shared/ui/README.md), [`src/shared/styles/README.md`](../../src/shared/styles/README.md) | — | Arquivos novos em "Onde" e "Arquivos"; telas reais × provisórias; classes novas |
| [`src/README.md`](../../src/README.md), [`src/shared/README.md`](../../src/shared/README.md), [`src/shared/infra/README.md`](../../src/shared/infra/README.md), [`src/domains/acesso/README.md`](../../src/domains/acesso/README.md) | — | Frases que diziam "a Tarefa 4 vai…" passam ao presente (documentação coerente) |
| [`docs/verificacoes/README.md`](README.md) | — | Linha do VER-018 e campo "Arquivos" |

## Lógica

```mermaid
sequenceDiagram
    participant T as Tela (useAcesso)
    participant F as Fila
    participant D as resolverAcesso
    participant A as auth (supabase-js)
    T->>F: primeira (retorno da URL)
    F->>D: avaliar
    D->>A: papel null → sair()
    A-->>T: SIGNED_OUT (antes de resolver)
    T->>F: automática (espera na fila)
    A-->>D: sair resolve (depois do /logout)
    D-->>F: sem_papel → aplicado; URL limpa
    F->>D: automática (SEM_RETORNO)
    D-->>F: sem_sessao sem aviso
    F-->>T: combinarEstados(sem_papel, sem_sessao) = sem_papel (mensagem fica)
```

| Passo | Antes | Depois |
|---|---|---|
| Abrir `/painel` sem sessão | "Em construção — etapa E1" | Tela de entrada, "Entrar com Google" → `entrarComGoogle('<origem>/painel')` |
| Abrir `/entrar` sendo membro | Tela provisória | `navegar('/painel')` (admin, equipe) ou `navegar('/controle')` (apresentadora) |
| Conta fora da lista | — | "Acesso não liberado" com o e-mail; `sair` 1 vez; a mensagem fica depois do `SIGNED_OUT` |
| Variável ausente | Nada (o cliente nem era criado) | "Configuração incompleta" com o nome da variável, nunca o valor |
| Erro inesperado ao criar os serviços | (página em branco, se acontecesse) | "Não foi possível abrir esta página", sem o texto do erro |
| `/camera`, `/obs/*` | Provisórias | Iguais; 0 `obterServicos`, 0 `createClient` |

## Exemplo

`/painel?code=abc` com membro `equipe` (teste `sair-depois-de-codigo`): a primeira avaliação usa o retorno (`temCodigo: true`), dá `membro` e só então `limparRetornoDaUrl` é chamado (1 item). Clique em "Sair": `sair` 1 vez, `SIGNED_OUT` pede a 2ª avaliação, que usa `SEM_RETORNO` e dá `sem_sessao` sem aviso; a tela mostra "Entrar com Google" e **não** "O login não terminou…". Com a sabotagem S5 (retorno passado também às reavaliações), a 2ª avaliação dá `login_incompleto` e o teste cai.

`/painel` com `estranho@revocast.test` e `segurarSair()` (teste `sair-lento-nao-apaga-mensagem`): com `sair` = 1, `usuarioAtual` continua 1 (a reavaliação espera na fila); depois de `liberarSair()`, `usuarioAtual` = 2 e a tela mostra "Acesso não liberado" com o e-mail. No desenho antigo (S4), `usuarioAtual` já era 2 antes de liberar.

## Verificação

**TDD.** Passo 2: `npx vitest run src/app` → FAIL (2 arquivos falham: `./servicosFalsos`, `./dependencias` e as telas novas inexistentes). Passo 4: `npx vitest run src/app` → 4 arquivos, 47 testes (21 em `acesso.test.tsx`, 10 em `App.test.tsx`, 11 em `rotas.test.ts`, 5 em `servicos.test.ts`), todos passam; repetido 5 vezes com `--maxWorkers=2`, 47/47 em todas; `npx tsc --noEmit` limpo; nenhum aviso de `act(...)` na saída. Um ajuste no próprio teste durante o Passo 4: em `troca-de-papel-ao-voltar`, a espera pela 3ª avaliação foi trocada por esperar a tela "Acesso não liberado" (a 4ª, a do `SIGNED_OUT`, já começava antes de a espera conferir o número 3).

**Depois dos nits N1–N4:** `npx vitest run src/app` → 5 arquivos, 57 testes (26 em `acesso.test.tsx`, 10 em `App.test.tsx`, 5 em `dependencias.test.ts`, 11 em `rotas.test.ts`, 5 em `servicos.test.ts`), todos passam.

**Sabotagens** (script em Python fora do repositório: guarda cópia do arquivo, confere que cada trecho aparece exatamente 1 vez, aplica, roda `npx vitest run src/app --maxWorkers=2`, restaura a cópia e confere o `sha256`). S1–S9 são as do Passo 5 do plano; S10–S14 são extras.

| # | Arquivo | Sabotagem | Caiu |
|---|---|---|---|
| S1 | `telas/Entrar.tsx` | mostrar o `error_description` da busca acima da tela | `erro-do-google-sem-texto-da-url` |
| S2 | `useAcesso.ts` | chamar `limparRetornoDaUrl` antes de `resolverAcesso` | `limpa-depois-de-resolver` |
| S3 | `useAcesso.ts` | reavaliações sem `combinarEstados` (só `sem_papel` protegido, como na primeira versão do plano) | `anonima-sai`, `sessao-expirada-fica` e `sair-lento-nao-apaga-mensagem` (caso anônima) |
| S4 | `useAcesso.ts` | desenho antigo: avaliações em paralelo (`void Promise.resolve().then(...)` no lugar da fila) com descarte do resultado antigo por número | `sair-lento-nao-apaga-mensagem` (os três casos), `fora-da-lista-sai-e-mensagem-fica`, `anonima-sai`, `sessao-expirada-fica` e `troca-de-papel-ao-voltar` (os cinco previstos) |
| S5 | `useAcesso.ts` | passar o retorno da URL também às reavaliações | `sair-depois-de-codigo` e `erro-nao-volta-na-troca-de-aba` |
| S6 | `dependencias.ts` | `obterServicosDeMembro()` chamado dentro de `dependenciasDoNavegador` (ansioso) | `caminho-padrao-nao-cria-cliente-em-dispositivo` |
| S7 | `App.tsx` | `dep.obterServicos()` no corpo do `App` para toda rota | `dispositivo-nao-cria-cliente-de-membro` (e mais 11: as 7 rotas do `test.each`, o caminho padrão, configuração, erro inesperado e `sem-sessao-mostra-entrada`, que contam ou lançam no `obterServicos`) |
| S8 | `useAcesso.ts` | aceitar `?volta=` como URL de retorno | `url-de-retorno-fixa` |
| S9 | `useAcesso.ts` | deixar subir o erro não esperado de `obterServicos` | `erro-inesperado-ao-iniciar` |
| S10 | `GuardaDeMembro.tsx` | não conferir `podeAbrir` | `sem-acesso-por-papel` e `troca-de-papel-ao-voltar` |
| S11 | `telas/Entrar.tsx` | membro em `/entrar` sem `navegar` | `entrar-leva-a-area-do-papel` e o caso `/entrar` do `test.each` |
| S12 | `shared/ui/Mensagem.tsx` | `erro` com `role="status"` | `codigo-sem-sessao` |
| S13 | `useAcesso.ts` | não assinar `aoVoltarAVer` | `erro-nao-volta-na-troca-de-aba` e `troca-de-papel-ao-voltar` |
| S14 | `GuardaDeMembro.tsx` | "Entrar" da guarda com `entrar(null)` (volta para `/entrar`) | `sem-sessao-mostra-entrada`, `url-de-retorno-fixa` e `fora-da-lista-sai-e-mensagem-fica` |

| SN (revisor N) | `useAcesso.ts` | `catch` da fila sem aplicar `falha` | `erro-na-fila-mostra-falha` |
| SN1b (N1) | `useAcesso.ts` | `catch` da fila aplicando `falha` sempre (o código antes do N1) | `limpar-que-lanca-nao-troca-membro` |
| SA (revisor A) | `useAcesso.ts` | `aplicar` sem conferir `m.ativo` | `desmontagem-cancela-e-nao-aplica` |
| SH1 (revisor H) | `useAcesso.ts` | não cancelar `aoMudarSessao` na desmontagem | `desmontagem-cancela-e-nao-aplica` |
| SH2 (revisor H) | `useAcesso.ts` | não cancelar `aoVoltarAVer` na desmontagem | `desmontagem-cancela-e-nao-aplica` |
| SE (revisor E) | `useAcesso.ts` | `sair()` do hook sem aplicar `sem_sessao` direto | `sair-aplica-sem-sessao-direto` |
| SF (revisor F) | `useAcesso.ts` | limpar a URL na primeira avaliação mesmo sem retorno sujo | `nao-limpa-sem-retorno` |
| SD1 (N4) | `dependencias.ts` | `url.search = ''` no lugar de apagar só os `PARAMETROS_DE_RETORNO` | `limpar-tira-so-os-parametros-de-retorno` |
| SD2 (N4) | `dependencias.ts` | apagar o fragmento sem conferir `fragmentoSujo` | `limpar-tira-so-os-parametros-de-retorno` |
| SD3 (N4) | `dependencias.ts` | `aoVoltarAVer` sem conferir `visibilityState === 'visible'` | `volta-a-ver-so-quando-visivel-e-cancela` |
| SD4 (N4) | `dependencias.ts` | cancelamento de `aoVoltarAVer` que não remove o ouvinte | `volta-a-ver-so-quando-visivel-e-cancela` |

Cada sabotagem derrubou ao menos o teste previsto; os arquivos voltaram idênticos (`sha256` conferido pelo script). Depois dos nits, S1–S14 rodaram de novo sobre o código novo (S3 e S4 com o trecho adaptado à nova forma de `pedirAvaliacao`): todas derrubaram de novo os testes da tabela, e algumas derrubam também testes novos (S2 e S13: `desmontagem-cancela-e-nao-aplica` e, S2, `limpar-que-lanca-nao-troca-membro`; S6: os 4 testes de `dependencias.test.ts` que chamam `dependenciasDoNavegador` sem variáveis). SN a SD4 são as sabotagens dos nits; cada uma derrubou só o teste indicado.

**Conferência no navegador** (Chromium do Playwright, `vite build` + `vite preview`, 390 × 760 px, claro e escuro):
- build com as variáveis vazias (`npm run build` gerou o `dist/`, o build não exige as variáveis): `/entrar` e `/painel` mostram "Configuração incompleta" com `VITE_SUPABASE_URL`; `/camera#abc` continua "Em construção — etapa E4";
- build com uma URL fictícia (`https://exemplo.supabase.co`) e as requisições ao Supabase interceptadas pelo Playwright (sessão posta no `localStorage` em `revocast-auth-membro`, `rpc/papel_atual` respondendo o papel): membro `equipe` em `/painel` vê o cabeçalho e o conteúdo; "Sair" leva à entrada e apaga a sessão do `localStorage`; `apresentadora` em `/painel` vê "Sem acesso a esta página"; em `/controle` vê o cabeçalho com "Apresentadora"; papel `null` → "Acesso não liberado" com o e-mail, 1 `POST /auth/v1/logout` e a mensagem continua; `/entrar` com membro → `/painel`; `/entrar?error=access_denied&error_description=...` → aviso fixo e a URL limpa para `/entrar`; `/painel?code=abc` sem verificador → "O login não terminou neste navegador…" e a URL limpa; `rpc/papel_atual` abortado → "Não foi possível falar com o servidor". Cores e contraste conferidos a olho nas capturas, nos dois modos; o cabeçalho quebra em duas linhas a 390 px sem estouro.

**Fechamento (implementador):** `npm run check` → 0 erros (resultado no relatório da tarefa). O `npm run check` final, sobre exatamente o conteúdo do commit, é do controlador.

**Revisões independentes (dupla verificação):** revisão 1 (revisor independente): spec ✅, qualidade aprovada, 6 nits, nenhum de segurança. N1: o `catch` da fila (erro → `falha`) não tinha teste, e se `limparRetornoDaUrl` lançasse depois de `membro` a tela trocaria `membro` por `falha`. N2: a guarda `ativo` e o cancelamento das duas assinaturas na desmontagem não tinham teste. N3: nenhum teste distinguia o `sem_sessao` aplicado direto pelo `sair()` do hook da reavaliação do `SIGNED_OUT`. N4: `limparRetornoDaUrl` e `aoVoltarAVer` do navegador e a condição `sujo || fragmentoSujo` não tinham teste jsdom. N5: `src/shared/README.md` dizia que as rotas de dispositivo "não tocam" `infra/` (importam pela composição, só não chamam nem criam o cliente). N6: os Riscos de `src/app/README.md` não citavam a fila pendurada. Os seis foram incorporados com reconferência pontual, sem nova rodada, pela decisão (a) do responsável (2026-11-22): N2–N4 são testes a mais (5 em `acesso.test.tsx`, contando o do N1, e 5 em `dependencias.test.ts`), N5 e N6 são de documentação, e cada teste novo cai com a sabotagem correspondente (SN–SD4). **N1 mudou código** (`useAcesso.ts`): o `catch` da fila só aplica `falha` se a tarefa ainda não aplicou estado (contador `aplicacoes` na montagem), e `aplicar` devolve se aplicou (a avaliação usa isso no lugar de um segundo `if (!m.ativo)`, de modo que, desmontada, também não limpa a URL). Por quê: um `limparRetornoDaUrl` que lança depois de `membro` não muda o acesso decidido (só deixa a URL suja); trocar um membro válido por "Não foi possível falar com o servidor" seria uma falha falsa. O caso sem estado aplicado continua indo para `falha` (teste `erro-na-fila-mostra-falha`). Reconferência: `npx vitest run src --maxWorkers=2`, `npm run typecheck` e `node scripts/check-docs.mjs` (resultados no relatório da tarefa).

Nits corrigidos (não zeram a contagem): nenhum até aqui.

## Riscos

- O login real (Google + Supabase Auth) não foi exercitado: as telas foram testadas com falsos e, no navegador, com as requisições interceptadas. A conferência real é a Tarefa 6 do PLA-002.
- Sem fusão de reavaliações: no carregamento com sessão, o `auth-js` emite um evento depois do `INITIAL_SESSION` (visto na conferência: 2 `rpc/papel_atual` por carga) e o papel é lido duas vezes; aceito no plano ("no pior caso, uma leitura a mais").
- Uma avaliação que nunca termina (rede pendurada sem erro) segura a fila: as reavaliações e as ações seguintes esperam; a tela fica em "Conferindo seu acesso…" ou no último estado. Não há tempo-limite (o `auth-js` e o `fetch` não têm um configurado aqui); pendência a ver na Tarefa 6, na conferência real.
- Erro lançado dentro de uma tarefa da fila (que as portas não lançam) vira `falha` só se a tarefa ainda não aplicou estado (N1, com teste); se `limparRetornoDaUrl` lançar depois de `membro`, a URL fica suja até a próxima carga (o auth-js já trocou o `code`; um `?code=` velho numa recarga dá "o login não terminou" só se a sessão tiver sumido).
- Contraste do texto escuro sobre o botão rosa continua abaixo do AA (risco já registrado em `src/shared/styles/README.md`); `.botao--contorno` usa tinta sobre o fundo do cartão, que passa nos dois modos.
- `servicosFalsos.ts` fica em `src/app/` (não em uma pasta de testes) e é empacotado só se importado; nenhuma tela o importa (a árvore do build não o inclui).
