# VER-039 — E3, Tarefa 5: Integração OBS (fonte de navegador e obs-websocket) e serviço do palco

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-039 |
| Título | E3, Tarefa 5: domínio Integração OBS (portas, versão mínima, executor), adaptadores de `window.obsstudio` e do obs-websocket v5, e o serviço do palco |
| Gravidade | alta |
| Tipo | implementação · segurança · integração |
| Data | 2026-11-27 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado (testado com OBS, `window.obsstudio`, `WebSocket`, canal, repositório e executor falsos; a rota do palco que liga tudo chega na Tarefa 6 e o OBS real na Tarefa 10 do PLA-004) |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-27-039-e3-integracao-obs-e-palco.md` |
| Arquivos | `src/domains/obs/README.md` (novo), `src/domains/obs/portas.ts` (novo), `src/domains/obs/versao.ts` (novo), `src/domains/obs/versao.test.ts` (novo), `src/domains/obs/executor.ts` (novo), `src/domains/obs/executor.test.ts` (novo), `src/domains/aovivo/palco.ts` (novo), `src/domains/aovivo/palco.test.ts` (novo), `src/shared/infra/obsNavegador.ts` (novo), `src/shared/infra/obsNavegador.test.ts` (novo), `src/shared/infra/obsWebsocket.ts` (novo), `src/shared/infra/obsWebsocket.test.ts` (novo), `src/domains/README.md`, `src/domains/aovivo/README.md`, `src/shared/infra/README.md`, `docs/verificacoes/README.md`, este registro |

## Problema

1. **Ninguém executava os comandos.** O domínio Ao vivo (VER-035) valida comandos, resolve-os em `AcaoNoObs` e declara a porta `ExecutorDeAcoes`, e os adaptadores (VER-038) entregam comandos e publicam estado pelo canal, mas não havia o **serviço do palco** (validar de novo, descartar repetido e revogado, resolver, executar, publicar o estado e gravar `registro_acoes`) nem quem falasse com o OBS.
2. **O OBS tem dois caminhos com regras próprias.** A Fonte de navegador (`window.obsstudio`) responde por callback, exige nível de controle por função (cena ADVANCED, clipe BASIC) e pode nem existir; o marcador só existe no obs-websocket v5 (`CreateRecordChapter`), que tem senha. Sem uma camada anticorrupção, o palco chamaria o OBS direto, sem conferir nível, lista de cenas, Replay Buffer ou gravação, e texto do OBS iria parar no estado no ar.
3. **A senha do obs-websocket é um segredo do computador do estúdio** (D10): não pode ir para quadro enviado em claro, `console`, estado, presença ou armazenamento do app.

## Era proposital?

Sim, como etapa: o PLA-004 põe o executor e o palco na Tarefa 5 (D1: "`src/domains/obs/` implementa esse executor sobre as portas do OBS e importa de `aovivo` só tipos"), e o VER-035 deixou `ExecutorDeAcoes` e `MOTIVOS_DO_RESULTADO` prontos com os motivos do executor (`cena_inexistente_no_obs`, `sem_permissao`, `replay_desligado`, `sem_websocket`, `sem_gravacao`, `obs_ausente`). Os pontos em que o código diverge do brief estão em "Por que não outras soluções" (desvios, com o motivo).

**Fontes (Passo 1).** Lidas em 2026-11-27, por HTTPS sem enviar dado do projeto (cópias em `scratchpad/sdd-e3/t5-fontes/`, com `sha256sum` no relatório da tarefa):

| Fonte | URL | O que foi conferido |
|---|---|---|
| README do obs-browser | `https://raw.githubusercontent.com/obsproject/obs-browser/master/README.md` (377 linhas) | `window.obsstudio.pluginVersion` (sem nível); `getControlLevel(cb)` (NONE; níveis 0 NONE, 1 READ_OBS, 2 READ_USER, 3 BASIC, 4 ADVANCED, 5 ALL); `getStatus(cb)` (READ_OBS; campos `recording`, `recordingPaused`, `streaming`, `replaybuffer`, `virtualcam`); `getCurrentScene(cb)` (READ_USER; `{ name, width, height }`); `getScenes(cb)` (READ_USER; lista de nomes); `saveReplayBuffer()` (BASIC); `setCurrentScene(name)` (ADVANCED). Eventos em `window` que **existem**: `obsStreamingStarting`, `obsStreamingStarted`, `obsStreamingStopping`, `obsStreamingStopped`, `obsRecordingStarting`, `obsRecordingStarted`, `obsRecordingPaused`, `obsRecordingUnpaused`, `obsRecordingStopping`, `obsRecordingStopped`, `obsReplaybufferStarting`, `obsReplaybufferStarted`, `obsReplaybufferSaved`, `obsReplaybufferStopping`, `obsReplaybufferStopped`, `obsVirtualcamStarted`, `obsVirtualcamStopped` (e `obsSceneChanged`, `obsSourceActiveChanged` e outros). **Todos os 11 eventos pedidos pelo brief existem**; não há `obsVirtualcamStarting`. `obsSourceActiveChanged` diz se a **Fonte** está ativa (em alguma cena no programa), e a Fonte do palco fica em todas as cenas, então não serve para saber se a saída está no ar (I5) |
| Protocolo do obs-websocket 5 | `https://raw.githubusercontent.com/obsproject/obs-websocket/master/docs/generated/protocol.md` (5 854 linhas) | Subprotocolo `obswebsocket.json` (JSON em quadros de texto); o servidor manda `Hello` (op 0, com `authentication: { challenge, salt }` só se exige senha); o cliente responde `Identify` (op 1: `rpcVersion`, `authentication` opcional, `eventSubscriptions`, com `EventSubscription::None` = 0); `Identified` (op 2); `Request` (op 6: `requestType`, `requestId`, `requestData`); `RequestResponse` (op 7: `requestStatus.result` verdadeiro só em sucesso); autenticação = base64(SHA-256(base64(SHA-256(senha + salt)) + challenge)); `WebSocketCloseCode::AuthenticationFailed` = **4009**; `GetVersion` → `obsVersion`; `CreateRecordChapter` (`chapterName` opcional; "As of OBS 30.2.0, the only file format supporting this feature is Hybrid MP4"; adicionado no obs-websocket 5.5.0) |

## Solução

- [`obs/portas.ts`](../../src/domains/obs/portas.ts#L1-L68) — `NIVEL_DE_CONTROLE`, `StatusDaSaida` (`gravando`, `replayBuffer`, `transmitindo`, `cameraVirtual`), `ObsNoNavegador` e `ObsWebsocket`, com a chamada e o nível do obs-browser em cada método; desde a rodada 1, `ObsWebsocket.conectado()` e `aoFechar(f)` (I1).
- [`obs/versao.ts`](../../src/domains/obs/versao.ts#L1-L33) — `VERSAO_MINIMA_DO_OBS = '30.2.0'` e `versaoAtende` (`maior.menor[.correção]`, pré-lançamento opcional, até 40 caracteres; fora da forma → `null`).
- [`obs/executor.ts`](../../src/domains/obs/executor.ts#L1-L171) — `ESPERA_DO_CLIPE_MS = 5000` e `criarExecutorObs`: cena só com nível ≥ ADVANCED e o nome exato na lista do OBS; clipe só com nível ≥ BASIC e Replay Buffer ativo, um pendente por vez (o repetido responde `pendente` e é ignorado), `saveReplayBuffer` depois de 5 s; marcador só com o websocket e, com o status legível, a gravação em andamento; sem `window.obsstudio`, cena, clipe e marcador → `obs_ausente`, e som e aviso continuam (são da página); `situacao()` e `atualizarSituacao()` para o estado no ar e a presença (D13). Rodada 1: websocket caído (`conectado()` falso) → marcador `sem_websocket` e situação `sem_conexao`, sem perder a guarda do clipe (I1); `parar()` cancela o clipe que espera e barra ações novas (N5).
- [`aovivo/palco.ts`](../../src/domains/aovivo/palco.ts#L1-L190) — `ESTADO_A_CADA_MS = 30_000`, `COMANDOS_LEMBRADOS = 200` e `criarPalco`: confere de novo a forma do comando e o remetente, ignora o próprio eco, revogados e repetidos, resolve contra as listas, publica a recusa sem executar nem registrar, publica `pendente` antes do clipe, executa, aplica o efeito (cena do OBS, aviso no ar com prazo, ocultar), publica, e com `ok` grava o registro sem esperar e sem deixar a falha parar nada; estado publicado ao começar, a cada 30 s e quando alguém entra; `parar()` solta tudo. Rodada 1: o estado que vai ao canal passa por `lerEstadoNoAr` (cena do OBS acima do limite do leitor vai como `null`; estado ainda recusado não é publicado; N7).
- [`shared/infra/obsNavegador.ts`](../../src/shared/infra/obsNavegador.ts#L1-L119) — `criarObsNoNavegador`: callbacks → promessas com 3 s de tempo-limite, respostas conferidas, ações que nunca lançam, `EVENTOS_DE_SAIDA` (os 11).
- [`shared/infra/obsWebsocket.ts`](../../src/shared/infra/obsWebsocket.ts#L1-L199) — `criarObsWebsocket`: `ws://127.0.0.1:<porta>` com `obswebsocket.json`, `Hello` → `Identify` (hash por `crypto.subtle`, `eventSubscriptions: 0`) → `Identified`; 4009 → `senha_errada`; 5 s sem `Identified`, erro ou fechamento → `sem_conexao`; pedidos com `requestId` único e 5 s de tempo-limite; a senha só vive em `conectar` até o `Hello`; rodada 1: `conectado()` e `aoFechar(f)`, avisado quando uma conexão identificada cai, depois de resolver os pedidos pendentes (I1).

## Por que esta solução

- **DDD, GRASP Pure Fabrication e Componentes (D1):** `obs/` é a camada anticorrupção e implementa `ExecutorDeAcoes`; `aovivo/palco.ts` só conhece portas (canal, repositório, executor, `Revogados`), sem saber de OBS, canal concreto ou banco; os dois adaptadores são fabricações puras em `src/shared/infra/`. O teste de arquitetura cobre `obs/` sem configuração (sabotagem A29).
- **Segurança:** cada efeito depende de validação no palco (defesa em profundidade sobre a do adaptador), de nível conferido antes da chamada e de motivo da lista fixa; a senha nunca sai em claro (sabotagens B7, A25, A28b); a resposta do OBS só vale com `result === true` (A27).
- **D9:** um clipe pendente por vez, 5 s de espera, `pendente` e depois `ok` no estado; recusa nunca registrada; falha do registro não desfaz a ação.
- **D10:** `WebSocket` e `crypto.subtle` nativos, sem dependência nova; saída no ar por `getStatus` e pelos eventos de início (inclusive `Starting`) e fim, nunca `obsSourceActiveChanged`.
- **D13:** `versaoAtende` e a `SituacaoDoObs` do executor alimentam o checklist da Tarefa 9.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| `executar(salvar_clipe)` devolver `pendente` na hora e avisar o `ok` por outro caminho (o brief diz "resultado `pendente` e depois `ok`" no `clipe-espera-5s`) | **Desvio.** A porta `ExecutorDeAcoes` do domínio (VER-035) devolve **uma** promessa por ação e não tem canal de aviso; mudar a porta mexeria num arquivo fora da lista da tarefa. Seguindo o domínio: a promessa do clipe resolve `ok` quando o `saveReplayBuffer` sai (aos 5 000 ms, não aos 4 999), um pedido durante a espera responde `pendente` (ignorado), e é o **palco** que publica `pendente` antes de esperar (`ACOES_DEMORADAS`, teste novo `clipe-pendente-depois-ok`, sabotagem A08) |
| Só `criarExecutorObs(d): ExecutorDeAcoes`, como no brief | **Acréscimo.** `ExecutorDeAcoes.situacao()` precisa da situação do OBS (nível, Replay Buffer, gravação, versão), que só se lê por promessa: o executor guarda a última leitura (de cada execução) e devolve `ExecutorObs` com `atualizarSituacao()` para a rota do palco chamar (Tarefa 6); o campo opcional `estadoDoWebsocket` diz por que não há websocket (`senha_errada`, `sem_conexao`), já previsto em `SituacaoDoObs` |
| Prazo do aviso por um `agendar` de uma vez e `Date.now` direto no palco | **Acréscimo pequeno.** O brief dá ao palco só `agendarRepeticao`; o prazo do aviso usa a mesma função e cancela no primeiro disparo (sem dependência nova), e `agora?` (padrão `Date.now`) entra opcional para `avisoAte` com relógio falso no teste |
| Registrar `ok` e `pendente` (diagrama do README de `aovivo/`) | Com o `pendente` publicado antes da espera, registrar o `pendente` gravaria o clipe duas vezes (ou o repetido ignorado); o palco registra só `ok`: o clipe uma vez, quando sai. O diagrama foi corrigido |
| Registrar também `falhou` | O registro é das ações feitas (`registro_acoes`); a falha fica no estado no ar (sabotagem A01) |
| Ouvir também `obsStreamingStopping`, `obsRecordingPaused`/`Unpaused`, `obsReplaybufferSaved` | Existem, mas o `Stopped` vem logo depois e pausa ou clipe salvo não mudam se a saída está no ar; o brief lista os 11, e todos existem |
| `node:crypto` importado direto no teste | O `tsconfig` não carrega `@types/node` (`types: ["vite/client"]`); o teste importa por especificador em variável, tipado à mão, e calcula o vetor com o `node:crypto` como o brief pede. O teste também fixa o valor para a senha de exemplo do protocolo (`supersecretpassword`), calculado à parte |
| Guarda "o prazo antigo não oculta o aviso novo" além do cancelamento | Retirada: a sabotagem A04 (só a guarda) não derrubava nada, porque o cancelamento do prazo anterior já impede o disparo; a guarda era redundante e sem teste possível. Sem ela, tirar o cancelamento derruba `aviso-expira` (A04e) |
| `eventSubscriptions` padrão (todos) | O palco não usa eventos do websocket; 0 (`EventSubscription::None`) evita tráfego e trabalho no OBS |
| `requestId` por `crypto.randomUUID` | Exige contexto seguro e não acrescenta nada; um contador por conexão já é único |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/domains/obs/portas.ts`](../../src/domains/obs/portas.ts#L1-L68) | 1–68 | Novo: `NIVEL_DE_CONTROLE` (12), `StatusDaSaida` (15), `ObsNoNavegador` (26), `ObsWebsocket` (54; `conectado` e `aoFechar` desde a rodada 1) |
| [`src/domains/obs/versao.ts`](../../src/domains/obs/versao.ts#L1-L33) | 1–33 | Novo: `VERSAO_MINIMA_DO_OBS` (5), `versaoAtende` (25) |
| [`src/domains/obs/versao.test.ts`](../../src/domains/obs/versao.test.ts#L1-L27) | 1–27 | Novo: `versao-minima` (com `30.2.0-rc1` e `30.1.9-rc1` desde a rodada 1) |
| [`src/domains/obs/executor.ts`](../../src/domains/obs/executor.ts#L1-L171) | 1–171 | Novo: `ESPERA_DO_CLIPE_MS` (7), `ExecutorObs` (12, com `parar`), `DependenciasDoExecutor` (22), `criarExecutorObs` (51; cena 76, clipe 85, marcador 102, `wsConectado` 115, `estadoDoWebsocket` 119, situação 124, `executar` 138, `atualizarSituacao` 158, `parar` 167) |
| [`src/domains/obs/executor.test.ts`](../../src/domains/obs/executor.test.ts#L1-L315) | 1–315 | Novo: 16 testes (13 + `websocket-cai-depois`, `websocket-cai-durante-o-pedido`, `parar-cancela-o-clipe-pendente` na rodada 1) |
| [`src/domains/aovivo/palco.ts`](../../src/domains/aovivo/palco.ts#L1-L190) | 1–190 | Novo: `ESTADO_A_CADA_MS` (6), `COMANDOS_LEMBRADOS` (9), `DependenciasDoPalco` (11), `criarPalco` (47; `paraOCanal` 70, `publicar` 76, `marcarAvisoNoAr` 97, `aplicar` 114, `tratar` 129, `parar` 182) |
| [`src/domains/aovivo/palco.test.ts`](../../src/domains/aovivo/palco.test.ts#L1-L539) | 1–539 | Novo: 21 testes (16 + `estado-so-muda-com-ok`, `parar-com-acao-pendente`, `executor-que-lanca`, `publicacao-rejeitada-tratada`, `estado-publicado-passa-no-leitor` na rodada 1) |
| [`src/shared/infra/obsNavegador.ts`](../../src/shared/infra/obsNavegador.ts#L1-L119) | 1–119 | Novo: `TEMPO_DO_OBS_MS` (10), `EVENTOS_DE_SAIDA` (18), `JanelaDoObs` (35), `criarObsNoNavegador` (45) |
| [`src/shared/infra/obsNavegador.test.ts`](../../src/shared/infra/obsNavegador.test.ts#L1-L152) | 1–152 | Novo: 5 testes (jsdom; `resposta-solta-o-tempo-limite` na rodada 1) |
| [`src/shared/infra/obsWebsocket.ts`](../../src/shared/infra/obsWebsocket.ts#L1-L199) | 1–199 | Novo: `ESPERA_DO_OBS_MS` (15), `SocketDoObs` (18), `sha256Base64` (30), `criarObsWebsocket` (52; `pedir` 77, `fechar` 97, `conectar` 109, queda 135, `Identify` 163, `conectado` 190, `aoFechar` 191) |
| [`src/shared/infra/obsWebsocket.test.ts`](../../src/shared/infra/obsWebsocket.test.ts#L1-L336) | 1–336 | Novo: 12 testes com `WebSocket` falso (`queda-depois-de-conectado`, `fechar-resolve-pendentes`, `nenhum-pedido-antes-do-identified` na rodada 1; `ouvinte-de-queda-que-lanca` no nit N9 da re-revisão) |
| [`src/domains/obs/README.md`](../../src/domains/obs/README.md) | — | Novo: 11 seções; em "Lógica", a tabela ação → chamada do OBS → nível exigido |
| [`src/domains/README.md`](../../src/domains/README.md), [`src/domains/aovivo/README.md`](../../src/domains/aovivo/README.md), [`src/shared/infra/README.md`](../../src/shared/infra/README.md), [`README.md`](README.md) | — | "Arquivos", "Onde", origem, organização, lógica, verificação e riscos; linha deste registro |

## Lógica

```mermaid
sequenceDiagram
    participant C as /controle
    participant K as canal :controle
    participant P as palco.ts
    participant E as obs/executor.ts
    participant O as OBS (obsNavegador / obsWebsocket)
    C->>K: comando { id, acao: 'clipe' } + remetente
    K->>P: aoComando (já validado pelo adaptador)
    P->>P: lerComando de novo · próprio eco? revogado? id repetido?
    P->>P: resolverComando (recusa → estado publicado, nada executado)
    P->>K: estado { ultimo: clipe pendente }
    P->>E: executar(salvar_clipe)
    E->>O: getControlLevel ≥ BASIC? getStatus.replaybuffer?
    E->>E: espera 5 000 ms (outro clipe → 'pendente', ignorado)
    E->>O: saveReplayBuffer()
    E-->>P: { ok }
    P->>K: estado { ultimo: clipe ok }
    P->>P: registrar (sem esperar; falha não para nada)
```

| Passo | Antes | Depois |
|---|---|---|
| Comando chega ao palco | nada o executava | `criarPalco` trata, com validação de novo, eco, revogados e repetidos |
| Cena com nome diferente do OBS (`"Conversa "`) | — | `recusado`/`cena_inexistente_no_obs`, `setCurrentScene` nunca chamado |
| Fonte com nível BASIC pede cena | — | `recusado`/`sem_permissao` |
| Dois clipes em 2 s | — | um `saveReplayBuffer` aos 5 s; o segundo `pendente` |
| Marcador sem senha configurada | — | `falhou`/`sem_websocket` |
| obs-websocket cai depois de conectado (rodada 1) | situação `conectado` para sempre e marcador `sem_gravacao` com a gravação rodando | `conectado()` falso: marcador `sem_websocket`, situação `sem_conexao`, `aoFechar` avisa a rota; o clipe pendente segue com a guarda |
| Cena recusada ou que falhou (rodada 1) | (sem teste) | `cenaObs` não muda; só `ok` muda o estado |
| Cena do OBS com 201 caracteres (rodada 1) | todo estado seguinte seria descartado pelo `/controle` | publicada como `null`; dentro do palco, a real |
| Senha do obs-websocket | — | só o hash vai no `Identify`; nada em `console` nem no objeto |

## Exemplo

- **Clipe:** pedido no instante 0 → estado `pendente`; aos 4 999 ms, nenhum `saveReplayBuffer`; aos 5 000 ms, um `saveReplayBuffer` e o estado `ok`; um segundo pedido aos 2 000 ms responde `pendente` e não gera outro clipe (`clipe-espera-5s`, `clipe-repetido-ignorado`, `clipe-pendente-depois-ok`).
- **Aviso:** "A2" com 20 s, mostrado no relógio 1 000 000 → `avisoAte` = 1 020 000; aos 9 999 ms do "A1" (10 s) o aviso continua, aos 10 000 ms volta a nulo, o executor recebe `ocultar_aviso` e o estado é publicado (`aviso-expira`).
- **Autenticação:** com a senha de exemplo do protocolo (`supersecretpassword`) e o `salt`/`challenge` de exemplo, o `Identify` leva `1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=` (calculado à parte com o `node:crypto`); com `'senha-de-teste'`, o vetor calculado no teste bate, e nenhum quadro contém a senha nem o primeiro hash (`autenticacao`, `senha-nunca-sai`).
- **Repetidos:** o mesmo `id` duas vezes → 1 execução e 1 registro; depois de 200 outros comandos, o primeiro `id` volta a valer (`comando-duplicado`).

## Verificação

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| Linha de base | Antes da tarefa (HEAD 6d1c0a3) | `npm run check` do VER-038 | 1987 testes |
| Fontes (Passo 1) | README do obs-browser e `protocol.md` do obs-websocket, por HTTPS (`curl` ao `raw.githubusercontent.com`, HTTP 200), lidos por inteiro nas partes citadas | `sed -n`/`grep -n` nas cópias | Tabela em "Era proposital?"; os 11 eventos do brief existem |
| TDD | Testes antes do código | `npx vitest run src/domains/obs src/domains/aovivo/palco.test.ts src/shared/infra/obs*.test.ts` | 5 arquivos falham (módulos ausentes) |
| Implementação | Suíte inteira e tipos | `npx tsc --noEmit` · `npx vitest run --maxWorkers=2` | 0 erros · 53 arquivos, **2029 testes** (1987 + 42); um erro de teste corrigido no caminho (o falso de `obsNavegador.test.ts` trocava nível `null` por 4 com `??`) |
| Sabotagens | 36 em memória (rodada 1), mais 5 (rodada 2), 2 (rodada 3) e a do teste de arquitetura | `t5-sab/sab.config.mjs` (plugin que troca o trecho só no módulo carregado, com contagem e falha se 0 ocorrências; `fsModuleCache: false`); para o `?raw` do teste de arquitetura, `sab-raw.config.mjs` | `sha256sum` dos arquivos de `src/domains/obs`, `src/domains/aovivo` e `src/shared/infra/obs*` igual antes e depois de cada rodada; resultados abaixo |
| R1 | Revisão independente 1, sobre a primeira versão | leitura do diff, fontes relidas (mesmo sha256), 15 sabotagens e sondas numa cópia (cache desligado) | spec ✅ (desvios aceitos); qualidade reprovada: 2 achados importantes (I1 queda do websocket não percebida, comportamento; I2 três guardas do palco sem teste) e 8 nits; sem achado de segurança. Corrigidos em C1 |
| C1 | Correções da revisão 1: I1 (queda do websocket), I2 (três guardas do palco sem teste), N1 a N8 | `npx tsc --noEmit` · suíte inteira · 21 sabotagens em memória (`t5-sab/lista-c1.mjs`, cache desligado, `sha256sum` igual antes e depois) | 0 erros · 53 arquivos, **2041 testes** (+12); 20 das 21 sabotagens derrubam o teste delas (tabela "Sabotagens da rodada 1"); a C09 é equivalente (sem efeito observável) |
| R2 | Re-revisão focada nas correções C1 | sonda do `onclose(1006)` refeita; S1, S2, S14, S3, S5, S6, S15 repetidas e 13 sabotagens novas (R1 a R13), cache desligado | **limpa**; nit N9 (teste do `try/catch` dos ouvintes de `aoFechar`) incorporado em C2 como teste a mais, com reconferência pontual (`npm run check` 0) |
| C2 | Nit N9 da re-revisão: teste do `try/catch` em volta de cada ouvinte de `aoFechar` (sem mudança de código de produção) | teste novo `ouvinte-de-queda-que-lanca` · sabotagem R13 em memória (`t5-sab/lista-c2.mjs`, cache desligado, `sha256sum` igual antes e depois) · `npm run check` | 53 arquivos, **2042 testes** (+1); R13 (tirar o `try/catch`) derruba `ouvinte-de-queda-que-lanca`; reconferência pontual pelo `npm run check` (0 erros). Na primeira execução, `aviso-da-fila-e-saida-da-pagina` (`src/app/telas/AbaBiblioteca.test.tsx`, da E2, fora desta tarefa) falhou uma vez sob carga; passou sozinho 3 vezes e na execução seguinte do `npm run check` (oscilação de tempo, registrada aqui para acompanhamento) |
| Final | Conjunto | `npm run check` | 0 erros (último ato do implementador; ver o relatório da tarefa) |

**Sabotagens do brief (Passo 4)** — todas derrubam o teste pedido:

| # | Sabotagem | Caiu |
|---|---|---|
| B1 | espera do clipe de 4 999 ms | `clipe-espera-5s` (e a constante) |
| B2 | sem a guarda do clipe pendente | `clipe-repetido-ignorado`, `clipe-espera-5s` |
| B3 | trocar cena sem conferir a lista | `cena-inexistente-no-obs` |
| B4 | sem deduplicação | `comando-duplicado` |
| B5 | executar antes de resolver (som inexistente tocado) | `som-inexistente` |
| B6 | registrar recusas | `registro-com-teste` |
| B7 | a senha no `Identify` em vez do hash | `senha-nunca-sai`, `autenticacao` |
| B8 | não republicar na entrada | `estado-ao-entrar-alguem` |

**Sabotagens acrescentadas:**

| # | Sabotagem | Caiu |
|---|---|---|
| A01 | registrar também `falhou` | `estado-apos-comando` |
| A02 | sem conferir `Revogados` | `remetente-revogado` |
| A03 | sem ignorar o próprio eco | `ignora-o-proprio-comando` |
| A04 | (1ª forma) só a guarda do prazo antigo | **nada** → achado: guarda redundante, retirada do código (desvio acima) |
| A04b | sem cancelar o prazo antigo e sem a guarda | `aviso-expira` |
| A04c | sem cancelar o prazo antigo, com a guarda | nada (confirma a redundância; a guarda saiu depois) |
| A04d | ocultar à mão sem cancelar o prazo | `aviso-expira` |
| A04e | (depois de retirar a guarda) sem cancelar o prazo antigo | `aviso-expira` |
| A04f | prazo que não cancela a própria repetição | `aviso-expira` |
| A05 | palco sem revalidar o comando | `comando-invalido-descartado` |
| A06 | estado a cada 60 s | `estado-a-cada-30s` (e a constante) |
| A07 | lembrar 2 000 `id` | `comando-duplicado` |
| A08 | clipe sem `pendente` antes de esperar | `clipe-pendente-depois-ok` |
| A09 | `parar` sem soltar os ouvintes | `parar-solta-tudo` |
| A10 | cena com nível BASIC | `sem-permissao` |
| A11 | clipe sem conferir o Replay Buffer | `clipe-sem-replay-buffer` |
| A12 | marcador sem conferir a gravação | `marcador-sem-gravacao` |
| A13 | marcador sem conferir o OBS | `obs-ausente` |
| A14 | `atualizarSituacao` devolve o objeto interno | `situacao` |
| A15 | versão: empate no patch → falso | `versao-minima` |
| A16 | versão sem limite de tamanho | `versao-minima` |
| A17 | tempo-limite do navegador de 30 s | `callbacks-viram-promessas` |
| A18 | sem os eventos `Starting` | `status-da-saida` |
| A19 | nível sem conferir a faixa | `nivel` |
| A20 | a função de `aoMudarSaida` não solta | `status-da-saida` |
| A21 | 4009 não vira `senha_errada` | `senha-errada` |
| A22 | subprotocolo `obswebsocket.msgpack` | `subprotocolo-padrao` |
| A23 | `requestId` fixo | `create-record-chapter` |
| A24 | sem `eventSubscriptions: 0` | `autenticacao`, `identify-sem-senha` |
| A25 | senha em `console.debug` | `senha-nunca-sai` |
| A26 | espera de 50 s | `sem-conexao`, `create-record-chapter` |
| A27 | `result` que não é `false` conta como sucesso | (1ª rodada: **nada** → achado: `create-record-chapter` passou a mandar resposta sem `result`, com `"true"` texto e sem `requestStatus`) · repetida: `create-record-chapter` |
| A28 | senha guardada no objeto (valor copiado na criação) | nada — sabotagem nula (o valor era `''` na hora da cópia); refeita como A28b |
| A28b | senha guardada no objeto (por `get`) | `senha-nunca-sai` |
| A29 | `obs/portas.ts` importa o supabase-js | `arquitetura.test.ts` ("nenhum arquivo de domínio importa…") |

**Sabotagens da rodada 1** (C1; cada uma sozinha, em memória):

| # | Sabotagem | Caiu |
|---|---|---|
| S14 | `aplicar` mesmo sem `ok` | `estado-so-muda-com-ok` |
| S1 | sem a guarda de `parado` depois do `await` | `parar-com-acao-pendente` |
| S2 | sem `try/catch` no `executar` | `executor-que-lanca` (e rejeição não tratada) |
| S3 | `publicarEstado` sem `.catch` | `publicacao-rejeitada-tratada` (e rejeição não tratada) |
| S5 | `fechar` sem resolver os pedidos pendentes | `fechar-resolve-pendentes` |
| S6 | `perguntar` sem `clearTimeout` | `resposta-solta-o-tempo-limite` |
| S15 | pedido antes do `Identified` | `nenhum-pedido-antes-do-identified` |
| C01 | executor: marcador ignora a queda | `websocket-cai-depois` |
| C02 | executor: situação ignora a queda | `websocket-cai-depois`, `websocket-cai-durante-o-pedido` |
| C03 | executor: queda durante o pedido vira `sem_gravacao` | `websocket-cai-durante-o-pedido` |
| C04 | executor: versão do OBS mantida com o websocket caído | `websocket-cai-depois` |
| C05 | adaptador: `conectado()` sem olhar o `Identified` | `nenhum-pedido-antes-do-identified` |
| C06 | adaptador: queda sem aviso | `queda-depois-de-conectado` |
| C07 | adaptador: aviso também antes do `Identified` | `queda-depois-de-conectado` |
| C08 | adaptador: soltar o ouvinte não remove | `queda-depois-de-conectado` |
| C09 | adaptador: a queda não zera `identificado` | nada — equivalente: `socket` vira nulo na mesma hora, e todo leitor (`conectado`, `pedir`) confere `socket` antes; o `conectar` seguinte zera `identificado` |
| C10 | executor: `parar` não cancela o clipe | `parar-cancela-o-clipe-pendente` |
| C11 | executor: `parar` não barra ações novas | `parar-cancela-o-clipe-pendente` |
| C12 | palco: cena longa publicada sem trocar por `null` | `estado-publicado-passa-no-leitor` |
| C13 | palco: publica sem passar pelo leitor | `estado-publicado-passa-no-leitor` |
| C14 | palco: estado recusado descartado inteiro em vez de só a cena | `estado-publicado-passa-no-leitor` |

Achados corrigidos pelo implementador: A04 (código redundante retirado; mudança de produção, reconferida pela suíte inteira e pelas sabotagens A04e/A04f) e A27 (teste reforçado). A28 foi uma sabotagem mal construída, refeita.

## Riscos

- **Sem OBS real:** tudo foi testado com falsos escritos a partir das duas fontes; nomes, níveis, campos de `getStatus`, o comportamento de `getStatus` sem permissão (aqui: sem callback → `null` em 3 s) e o `ws://127.0.0.1` a partir da página `https` da Fonte só são confirmados num OBS real (Tarefa 10, passo do responsável).
- **`sem_gravacao` cobre várias causas** (gravação parada, formato que não é Hybrid MP4, OBS anterior a 30.2, pedido sem resposta em 5 s com a conexão de pé); a lista fixa não separa. A queda da conexão, desde a rodada 1, vira `sem_websocket`.
- **Situação do OBS lida por último:** o executor só lê nível, saídas e versão ao executar ou em `atualizarSituacao()`; a rota do palco (Tarefa 6) precisa chamá-la periodicamente e nos eventos de saída, senão o estado a cada 30 s leva a última leitura.
- **Websocket que cai (I1, rodada 1):** o executor consulta `ws.conectado()` a cada marcador e a cada leitura da situação; com o websocket caído, o marcador responde `sem_websocket`, a situação diz `sem_conexao` e a guarda do clipe continua (o executor não precisa ser recriado). Reconectar é da rota (Tarefa 6), que ouve `aoFechar` e chama `conectar` no mesmo objeto; até lá, o marcador fica em `sem_websocket`.
- **Clipe depois de `parar()` (N5):** `executor.parar()` cancela o clipe que espera os 5 s e barra ações novas, mas `palco.parar()` não conhece o executor concreto: a rota (Tarefa 6) chama os dois juntos (ao trocar de episódio ou sair). Sem isso, um clipe pedido antes da troca ainda seria salvo 5 s depois (o pedido era válido).
- **Dois toques rápidos em "próxima" (N6):** `proxima_cena` e `proximo_aviso` resolvem contra o estado **antes** da execução terminar; dois toques antes de a primeira troca voltar vão para a mesma cena (ou o mesmo aviso). Aceito: o efeito é "um passo em vez de dois", nunca uma ação errada; serializar os comandos faria um clipe pendente (5 s) atrasar todas as trocas de cena, e o `/controle` mostra a cena no ar para o próximo toque.
- **`nome_obs` sem limite no banco (N7):** a coluna aceita qualquer tamanho; o leitor do estado (`TAMANHO_DA_CENA_OBS` = 200) recusaria o estado inteiro. O palco publica `null` no campo nesse caso (o `/controle` mostra a cena como desconhecida) e nunca publica um estado que o leitor recusaria. **Pendência:** um `CHECK` de tamanho em `cenas.nome_obs` exige migração nova (a da E3 já está aplicada e nunca é editada) e fica para quando houver outra mudança de banco.
- **Cena atual:** o palco começa com `cenaObs` nulo e só conhece as cenas que ele mesmo trocou; uma troca à mão no OBS não aparece (a primeira `proxima_cena` vai à primeira cena).
- **Comandos em paralelo:** um clipe pendente não segura os outros; o `ultimo` do estado é o do último resultado que chegou (o `ok` do clipe aparece depois de uma cena trocada no meio).
- **Remetente declarado e revogados:** como no VER-035, o descarte só vale para clientes que cooperam; o palco só lê `Revogados`, que a rota (Tarefa 6) alimenta com os avisos de `estudio`.
- **Espera do clipe fixa** em 5 s (o DES-001 §16 fala em "configurável").
