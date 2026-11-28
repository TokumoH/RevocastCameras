# VER-063 — E5, Tarefa 6: guarda de rede do worker, núcleo do reconhecedor, worker de módulo e fonte de quadros

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-063 |
| Título | E5, Tarefa 6: a guarda de rede do worker (só a própria origem; a telemetria do MediaPipe bloqueada), o núcleo do reconhecedor (guarda antes de qualquer busca e do `import()` do MediaPipe; SHA-256 antes de usar; WASM como `blob:` `application/wasm`; GPU e depois CPU), o Web Worker de módulo sem import estático do MediaPipe, o reconhecedor do lado da página (worker só no `iniciar`, `terminate` no `fechar`) e a fonte de quadros sobre um `<video>` fora do DOM com `play()` explícito; `reconhecedores` e `quadros` nos serviços do dispositivo |
| Gravidade | alta |
| Tipo | implementação · segurança · privacidade |
| Data | 2026-11-28 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-28-063-e5-reconhecedor.md` |
| Arquivos | `src/shared/infra/{guardaDeRede.ts,guardaDeRede.test.ts,nucleoDoReconhecedor.ts,nucleoDoReconhecedor.test.ts,reconhecedor.worker.ts,reconhecedorMediapipe.ts,reconhecedorMediapipe.test.ts,quadrosDeVideo.ts,quadrosDeVideo.test.ts}`, `src/app/servicos.ts`, `src/app/servicos.test.ts`, `src/app/servicosFalsos.ts`, `src/app/servicosFalsos.test.ts`, `src/shared/infra/README.md`, `src/app/README.md`, `docs/verificacoes/README.md`, este registro; na rodada 1, também `src/domains/captura/{portas.ts,reconhecimento.ts,reconhecimento.test.ts,falsos.ts,README.md}` (22 arquivos) |

**Revisões:** R1 — revisão independente (sabotagens numa cópia; sonda com o worker real no Chromium 153: pronto sem pedidos para fora, recuo GPU→CPU só com a correção do `ModuleFactory`, telemetria bloqueada aos 60 s, 12 quadros diferentes do `<video>` fora do DOM): spec ✅, reprovada só por 1 teste (I1: erro do worker depois do `pronto`) e 6 nits — corrigidos na rodada 1 (linha C1), com N6 e N3 mudando comportamento; R2 — re-revisão focada (worker real 75 s com 148 leituras sem erro nem pedido para fora; recuo pela CPU com o `blob:` revogado; C1-S1 repetida): **limpa**, com 2 nits de teste incorporados em C2 com reconferência pontual (`npm run check` 0 no conteúdo exato do commit).

## Problema

O [PLA-006](../planos/2026-11-28-e5-gestos.md) (D8 a D11; revisão 1, I5 a I7, N11 e N12) põe o reconhecimento de gestos num Web Worker de módulo da própria origem, com o WASM e o modelo conferidos por SHA-256 ([VER-062](2026-11-28-062-e5-dependencia-e-modelo.md)) e nenhum quadro saindo do aparelho. Antes desta tarefa, o domínio já tinha as portas `FabricaDeReconhecedores` e `FonteDeQuadros` e o laço ([VER-058](2026-11-28-058-e5-dominio-gestos.md)), mas nada as implementava:

- o `@mediapipe/tasks-vision` 1.2.3 traz um registrador que, a cada 60 s, faz `fetch` `POST https://odml.pa.googleapis.com/v1/log` com métricas de uso e um valor lido do WASM (F6); sem uma guarda no worker, essas métricas sairiam para um terceiro sem o consentimento que o README do pacote exige;
- o carregador do MediaPipe (`Mh`) prefere `importScripts`, depois `self.import`, depois o `import()` nativo, que não é interceptável (F4): um import estático do MediaPipe no worker rodaria o pacote antes de qualquer guarda;
- o WASM e o modelo precisavam ser buscados, conferidos e só então entregues ao MediaPipe (o WASM como `blob:`, o modelo como buffer), sem deixar o MediaPipe buscá-los sozinho;
- um `<video>` destacado pode ficar pausado com `videoWidth` > 0 e devolver sempre o mesmo quadro congelado (I7);
- os serviços da rota de dispositivo não tinham `reconhecedores` nem `quadros` (a Tarefa 8 liga o laço às rotas).

## Era proposital?

Sim, a ausência: a Tarefa 5 ([VER-062](2026-11-28-062-e5-dependencia-e-modelo.md)) trouxe a dependência, o modelo, os SHA-256 e o worker em formato ES, e deixou o worker para esta tarefa (Riscos do VER-062: "nesta tarefa nada importa o pacote, e o bloqueio é da guarda de rede do worker (Tarefa 6)"). O domínio (VER-058) definiu as portas com o quadro opaco e registrou que `iniciar` depois de `fechar` não pode criar worker. A conferência no Chromium com o modelo real é da Tarefa 9.

**Divergências do brief (seguido o código commitado e a fonte instalada):**

| # | Brief | Feito | Motivo |
|---|---|---|---|
| 1 | `iniciar` do núcleo devolve `'ok' \| 'sem_suporte' \| 'integridade' \| 'outro'` | igual no núcleo; a página traduz para a porta `{ ok: true } \| { ok: false; motivo }` de `captura/portas.ts` (com `tempo` medido na página) | a porta commitada (VER-058) tem esse formato |
| 2 | "GPU falhou → 'CPU' uma vez" | antes de cada `createFromOptions`, o núcleo importa o carregador pelo `self.import` guardado e devolve o `ModuleFactory` ao escopo | **achado da fonte** (Passo 1): o `Wh` apaga `self.ModuleFactory` depois de criar o módulo e o módulo ES em cache não roda de novo; sem isso, a tentativa com CPU sempre acharia "ModuleFactory not set." (teste `delegado-gpu-e-depois-cpu`, sabotagem S13) |
| 3 | mensagens `pronto`, `falha`, `leitura` | mais `{ tipo: 'sem_leitura' }` | o `reconhecer` da porta devolve `null` quando o quadro falha (MediaPipe lançou, quadro ou tempo fora da forma); o tratamento das mensagens fica em `atenderMensagens` (no núcleo, testável), e o worker só o liga |
| 4 | `self.import` definido como `import()` | embrulha o `self.import` do escopo, se houver (no teste, o falso); senão o `import()` nativo; a URL vai já resolvida pela origem | o `import()` nativo dentro de `guardaDeRede.ts` resolveria uma relativa pelo endereço deste módulo, não pela origem; e o teste "da origem → o original é chamado" precisa de um original |
| 5 | "a maior pontuação entre os 7" | a maior pontuação entre **todas** as categorias; `None` ou um nome fora dos 7 por cima → gesto `null` | mais conservador contra o gesto acidental (DES-001 §2); com o classificador de softmax, um gesto acima de 0,7 nunca perde para `None` |
| 6 | — | as propriedades trocadas pela guarda ficam travadas (`writable: false`, `configurable: false`) | código no worker (o MediaPipe ou uma versão nova dele) não desfaz a guarda; teste `guarda-nao-pode-ser-desfeita` |
| 7 | — | `agora?` injetável no núcleo (padrão `performance.now()`); `INTERVALO_DO_PLAY_MS` exportado; `readyState` abaixo de 2 → sem quadro | o `ms` do worker testável; a constante de 1 s nomeada; `videoWidth` > 0 só garante os metadados (o desenho sairia vazio) |
| 8 | `reconhecedores` e `quadros` nos serviços | `reconhecedores`: uma fábrica por página, dividida pelos tipos; `quadros: (fluxo) => FonteDeQuadros` | "um por página" do brief; o laço pede a fonte pela rota (`fonte: () => FonteDeQuadros \| null`, VER-058), e a rota tem o fluxo |

## Solução

1. **`guardaDeRede.ts`** — `permitida(url, origem)` e `instalarGuardaDeRede(escopo, origem, aoBloquear?)`: `fetch` (texto, `URL` ou `Request`, inclusive relativa e `//host`), `XMLHttpRequest.prototype.open`, `importScripts` e `self.import` só aceitam a própria origem e `blob:` da própria origem; `WebSocket` e `EventSource` sempre lançam; fora disso, `TypeError` sem chamar o original; `aoBloquear` conta sem receber a URL (N11).
2. **`nucleoDoReconhecedor.ts`** — `criarNucleoDoReconhecedor(d)`: guarda → busca do WASM e do modelo pelo `fetch` guardado → SHA-256 dos dois → só então `carregarTarefas()` e `createFromOptions` com `wasmBinaryPath` `blob:` de tipo `application/wasm` (N12) e `modelAssetBuffer`, `runningMode: 'VIDEO'`, `numHands: 1`, os 7 gestos, GPU e depois CPU. `reconhecer` lê o melhor candidato com `CONFIANCA_MINIMA` e fecha o quadro sempre. `atenderMensagens` atende as mensagens do worker uma por vez.
3. **`reconhecedor.worker.ts`** — fino: URLs por `?url` (D9) e `carregarTarefas: () => import('@mediapipe/tasks-vision')`; nenhum import estático do MediaPipe.
4. **`reconhecedorMediapipe.ts`** — `criarFabricaDeReconhecedores(d?)`: sem `Worker` ou `WebAssembly` → `sem_suporte` sem criar nada; worker de módulo só no `iniciar`, prazo de 60 s (`tempo`), quadro transferido, respostas por `agendar(0)`, `terminate` no `fechar`.
5. **`quadrosDeVideo.ts`** — `criarFonteDeQuadros(fluxo, d?)`: `<video>` `muted`, `playsInline`, `srcObject` = o fluxo, nunca anexado, `play()` explícito; parado → `null` e nova tentativa a cada 1 s; quadro de 256 px de largura por `createImageBitmap`.
6. **Rodada 1 (revisão R1: spec ✅, qualidade reprovada só por um teste, I1; nits N1–N6):** erro do worker depois do `pronto` agora rejeita os pendentes e os `reconhecer` seguintes, e o laço do domínio trata a rejeição do `reconhecer` como reconhecedor morto → `falhou` (I1, N6; mudança mínima no domínio, sem tipo novo na porta); a guarda bloqueia também `Worker`, `SharedWorker`, `WebTransport`, `WebSocketStream` e `Cache.add`/`addAll` fora da origem (N3); a URL `blob:` do WASM é revogada depois das tentativas (N4); o núcleo perdeu o `fechar`, nunca chamado em produção (N2: quem encerra é o `terminate`); testes dos ramos de defesa (N1).
7. **`src/app/servicos.ts`** — `reconhecedores` e `quadros` em `ServicosDoDispositivo`; os falsos (`servicosFalsos.ts`) ganham `criarQuadrosFalsos` e levam a fábrica de reconhecedores falsos.

## Por que esta solução

- **Arquitetura:** cada arquivo é uma Pure Fabrication de `shared/infra` atrás de uma porta do domínio Captura (DDD): o domínio continua sem ver `Worker`, `ImageBitmap` ou `OffscreenCanvas` (teste de arquitetura do VER-058). O núcleo concentra a lógica do worker com tudo injetado, e o arquivo do worker fica fino (Componentes: o worker é só a ligação com `self`).
- **Segurança e privacidade (D8, D9):** a guarda é instalada **antes** de qualquer busca e de qualquer código do MediaPipe; o MediaPipe entra só por `import()` dinâmico, depois da guarda e da conferência; o `self.import` que o `Mh` prefere passa pela guarda; a telemetria (F6) cai na primeira tentativa, e o registrador para sozinho ("numa resposta de erro ou falha de rede, ele grava o erro, para o intervalo"). Nenhum `console`, nenhuma URL guardada.
- **Integridade:** o MediaPipe nunca busca o WASM nem o modelo por conta própria: recebe os bytes conferidos (`blob:` e `modelAssetBuffer`).
- **Otimização:** o worker, o MediaPipe (`vision_bundle`), o carregador, o WASM e o modelo só no chunk do worker (o chunk principal cresce 3 106 bytes); nada disso baixa antes de um `iniciar`.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Import estático do MediaPipe no worker | roda o pacote (e o registrador) antes da guarda; o `import()` nativo não é interceptável (I6) |
| Guarda no arquivo do worker, em vez do núcleo | a ordem "guarda antes do import" só é testável com tudo injetado; no worker real não há como espionar a ordem |
| Comparar a URL como texto (prefixo da origem) | `//host`, `Request` e `URL` escapariam (sabotagens S2 e S2b) |
| Bloquear só o `fetch` | o carregador do Emscripten tem `XMLHttpRequest` e o `Mh` usa `importScripts`/`self.import` (F4, F7) |
| `modelAssetPath` com a URL da própria origem | o MediaPipe buscaria o modelo sem a conferência do SHA-256 (F5; sabotagem S6) |
| Blob do WASM sem tipo | `WebAssembly.instantiateStreaming` exige `application/wasm` (N12); cairia no caminho lento de `ArrayBuffer` com um erro no console (sabotagem S7) |
| Tentar CPU sem devolver o `ModuleFactory` | a tentativa sempre falharia ("ModuleFactory not set.", divergência 2; sabotagem S13) |
| `<video>` anexado ao documento (1 px, opacidade 0) | muda a tela preta da E4 (teste `tela-preta-sem-video`); fica como contingência própria se o iPhone não tocar o destacado (D10, F13) |
| Uma fábrica de reconhecedores por tipo de dispositivo | uma rota de dispositivo por página reconhece de cada vez; a fábrica não tem estado (sabotagem S23 confere a mesma) |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/shared/infra/guardaDeRede.ts`](../../src/shared/infra/guardaDeRede.ts#L1-L182) | 1–182 (novo) | `EscopoDoWorker`, `permitida`, `instalarGuardaDeRede` ([L98](../../src/shared/infra/guardaDeRede.ts#L98): travar as propriedades, `self.import` sempre definido, `WebSocket`/`EventSource` e, na rodada 1, `Worker`/`SharedWorker`/`WebTransport`/`WebSocketStream` que lançam e `Cache.add`/`addAll` só da origem, [L153](../../src/shared/infra/guardaDeRede.ts#L153)) |
| [`src/shared/infra/guardaDeRede.test.ts`](../../src/shared/infra/guardaDeRede.test.ts#L1-L325) | 1–325 (novo) | 44 testes com escopo falso (37; na rodada 1, mais 6; na rodada 2, mais 1, R2-1) |
| [`src/shared/infra/nucleoDoReconhecedor.ts`](../../src/shared/infra/nucleoDoReconhecedor.ts#L1-L259) | 1–259 (novo) | `TarefasDoMediapipe`, `criarNucleoDoReconhecedor` ([L97](../../src/shared/infra/nucleoDoReconhecedor.ts#L97)), `devolverFabricaDoModulo` ([L110](../../src/shared/infra/nucleoDoReconhecedor.ts#L110)), `criarComDelegado` ([L163](../../src/shared/infra/nucleoDoReconhecedor.ts#L163); rodada 1: a URL `blob:` revogada depois), `lerResultado`, `atenderMensagens` ([L223](../../src/shared/infra/nucleoDoReconhecedor.ts#L223)) e os tipos das mensagens; sem `fechar` desde a rodada 1 |
| [`src/shared/infra/nucleoDoReconhecedor.test.ts`](../../src/shared/infra/nucleoDoReconhecedor.test.ts#L1-L410) | 1–410 (novo) | 35 testes (28; na rodada 1, menos os 2 do `fechar`, mais 9) com MediaPipe, `fetch`, `digest` e escopo falsos (o falso do MediaPipe imita o `Wh`) |
| [`src/shared/infra/reconhecedor.worker.ts`](../../src/shared/infra/reconhecedor.worker.ts#L1-L33) | 1–33 (novo) | o worker de módulo: URLs por `?url`, MediaPipe por `import()` |
| [`src/shared/infra/reconhecedorMediapipe.ts`](../../src/shared/infra/reconhecedorMediapipe.ts#L1-L213) | 1–213 (novo) | `criarFabricaDeReconhecedores` ([L71](../../src/shared/infra/reconhecedorMediapipe.ts#L71)); na rodada 1, `encerrar(morte)` ([L87](../../src/shared/infra/reconhecedorMediapipe.ts#L87)): erro do worker depois do `pronto` rejeita os pendentes e os `reconhecer` seguintes |
| [`src/shared/infra/reconhecedorMediapipe.test.ts`](../../src/shared/infra/reconhecedorMediapipe.test.ts#L1-L317) | 1–317 (novo) | 17 testes (13 e, na rodada 1, mais 4) com `Worker` falso e `agendar` manual |
| [`src/shared/infra/quadrosDeVideo.ts`](../../src/shared/infra/quadrosDeVideo.ts#L1-L141) | 1–141 (novo) | `LARGURA_DO_QUADRO`, `INTERVALO_DO_PLAY_MS`, `criarFonteDeQuadros` ([L51](../../src/shared/infra/quadrosDeVideo.ts#L51)) |
| [`src/shared/infra/quadrosDeVideo.test.ts`](../../src/shared/infra/quadrosDeVideo.test.ts#L1-L235) | 1–235 (novo) | 10 testes com vídeo, canvas e `createImageBitmap` falsos |
| [`src/app/servicos.ts`](../../src/app/servicos.ts#L6-L16) | 6–16, 28–29, 129–143, 188–193, 213–214 | imports; `reconhecedores` e `quadros` em `ServicosDoDispositivo`; a fábrica da página e a fonte por fluxo; a composição |
| [`src/app/servicos.test.ts`](../../src/app/servicos.test.ts#L174) | 174, 285–319 | as chaves do dispositivo; o teste novo de `reconhecedores` e `quadros` |
| [`src/app/servicosFalsos.ts`](../../src/app/servicosFalsos.ts#L710-L728) | 32, 36, 710–728, 945–946, 1018–1032 | `criarQuadrosFalsos`; os serviços falsos com `reconhecedores` e `quadros` |
| [`src/app/servicosFalsos.test.ts`](../../src/app/servicosFalsos.test.ts#L293-L303) | 293–303 | o `gestos-falsos` confere `reconhecedores` e `quadros` |
| [`src/shared/infra/README.md`](../../src/shared/infra/README.md#L107-L118) | 14, 18, 22, 107–118, 169–177, 222–236, 252, 261, 293–294 | os cinco arquivos novos em todas as seções; a contagem (21 arquivos, 413 testes desde a rodada 2); os riscos |
| [`src/app/README.md`](../../src/app/README.md#L34) | 34, 65, 78–79, 158 | `reconhecedores` e `quadros`; os falsos; a contagem (9 arquivos, 88 testes) |
| [`src/domains/captura/portas.ts`](../../src/domains/captura/portas.ts#L121-L124) | 121–124 (rodada 1) | `reconhecer`: rejeição = o reconhecedor morreu (N6) |
| [`src/domains/captura/reconhecimento.ts`](../../src/domains/captura/reconhecimento.ts#L263-L274) | 80–81, 263–274 (rodada 1) | rejeição (ou exceção) do `reconhecer` → `bloquear('falhou')`, em vez de quadro `null` |
| [`src/domains/captura/reconhecimento.test.ts`](../../src/domains/captura/reconhecimento.test.ts#L372-L407) | 372–407 (rodadas 1 e 2) | `reconhecedor-morto-vai-a-falhou` (rejeição; na rodada 2, R2-2, também a exceção síncrona) |
| [`src/domains/captura/falsos.ts`](../../src/domains/captura/falsos.ts#L306-L309) | 306–309, 337–338 (rodadas 1 e 2) | `config.reconhecerRejeita` e, na rodada 2, `config.reconhecerLanca` |
| [`src/domains/captura/README.md`](../../src/domains/captura/README.md#L35) | 35, 70, 76, 185 (rodadas 1 e 2) | a regra nova do laço; o falso; a contagem (302 testes) |
| [`docs/verificacoes/README.md`](README.md#L116) | 14, 116 | "Arquivos" e a linha deste registro (o exemplo continua 067) |

## Lógica

**Passo 1 — o que a fonte instalada diz** (`node_modules/@mediapipe/tasks-vision` 1.2.3; o `vision_bundle.mjs` é uma linha só, então a posição é a coluna da linha 1, em caracteres):

| Fato | Onde | O que decide |
|---|---|---|
| `Mh(t)`: sem `importScripts` (página) → `<script>`; senão `try { importScripts(t) } catch (e) { if (!(e instanceof TypeError)) throw e; let e = self.import; e ? await e(t) : await import(t) }` | `vision_bundle.mjs` 1:56073 (função), 1:56354 (`importScripts`), 1:56433 (`self.import` antes do `import()`) | num worker de módulo o `importScripts` nativo lança `TypeError`; a guarda devolve `TypeError` também para o bloqueado, e o `Mh` cai no `self.import` guardado; o `import()` nativo nunca é alcançado |
| `Wh`: `await Mh(wasmLoaderPath)`; `if (!self.ModuleFactory) throw Error("ModuleFactory not set.")`; depois de criar o módulo, `self.ModuleFactory = self.Module = void 0` | 1:66833, 1:66912, 1:67225 | divergência 2: a segunda tentativa precisa do `ModuleFactory` devolvido |
| o registrador é criado depois do módulo e o `setOptions` (`await t.A(n)`, onde o delegado é aplicado) vem depois | 1:67499 | a falha da GPU acontece depois de o `ModuleFactory` ser apagado |
| `locateFile: t => t.endsWith(".wasm") ? r.wasmBinaryPath : …` | 1:67316 | o WASM vem do `wasmBinaryPath` (aceita `blob:`) |
| o carregador de módulo põe a fábrica no escopo global ao rodar: `globalThis.ModuleFactory = ModuleFactory; … export default ModuleFactory;` | `wasm/vision_wasm_module_internal.js` 9150 | o núcleo usa o `default` do módulo para devolver o `ModuleFactory` |
| `fetch(binaryFile, { credentials: "same-origin" })` + `WebAssembly.instantiateStreaming(response, imports)`, com o comentário "the most common failure cause to be a bad MIME type" | `vision_wasm_module_internal.js` 337 e 340 | N12: o `Blob` do WASM precisa de `type: 'application/wasm'` |
| `XMLHttpRequest` no carregador (leitura de arquivo do Emscripten) | `vision_wasm_module_internal.js` 107, 121, 3352, 3368 | a guarda cobre `XMLHttpRequest.prototype.open` (F7) |
| telemetria: `setInterval(() => { this.flush() }, 6e4)`; `url: "https://odml.pa.googleapis.com/v1/log"`; envio por `await fetch(t.url, …)` | 1:52148, 1:52454, 1:50711 | F6: bloqueada pelo `fetch` guardado |
| `if (e.modelAssetPath) return fetch(e.modelAssetPath…)`; com `Uint8Array`, grava o buffer no FS | 1:69214; 1:67796 | o modelo vai como `modelAssetBuffer` (F5) |
| o pacote não usa `sendBeacon`, `WebSocket` nem `EventSource` (0 ocorrências no `vision_bundle.mjs`; no carregador, 0 `new WebSocket`/`EventSource`/`sendBeacon`) | contagem em 2026-11-28 | F7 confirmada; mesmo assim, `WebSocket` e `EventSource` lançam sempre |

**Passo a passo, antes × depois:**

| Passo | Antes | Depois |
|---|---|---|
| 1. A rota liga o reconhecimento | `reconhecedores` não existia nos serviços | `servicos.reconhecedores.criar()` (nenhum worker); `iniciar()` cria o worker de módulo (`new Worker(new URL('./reconhecedor.worker.ts', import.meta.url), { type: 'module' })`) |
| 2. O worker inicia | — | o núcleo: guarda → `fetch` do WASM e do modelo (guardado) → SHA-256 → `import('@mediapipe/tasks-vision')` → `createFromOptions` (GPU; CPU uma vez) → `pronto` |
| 3. A telemetria do MediaPipe | sairia para `odml.pa.googleapis.com` a cada 60 s (F6) | `TypeError` na primeira tentativa, sem rede; o registrador para; `bloqueios()` conta 1 |
| 4. Um quadro | — | `quadros(fluxo).quadro()`: `<video>` fora do DOM tocando → canvas 256 × altura → `ImageBitmap` → transferido ao worker → `{ gesto, confianca, ms }` |
| 5. Desligar | — | `fechar()` → `terminate` (memória do WASM e GPU soltas); a fonte → `pause()` e `srcObject = null` |
| 6. O worker morre depois do `pronto` (rodada 1) | na primeira versão: `terminate`, pendentes e `reconhecer` seguintes `null` para sempre; o laço ficava em quadros sem gesto, sem situação `falhou` | `onerror`/`onmessageerror` → `terminate`; pendentes e `reconhecer` seguintes **rejeitam** ("reconhecedor encerrado"; o quadro é fechado); o laço (`reconhecimento.ts`) trata a rejeição como reconhecedor morto → `bloquear('falhou')`; `null` continua sendo falha só do quadro; um evento novo (`tentarDeNovo`) cria outro worker |
| 7. A URL `blob:` do WASM (rodada 1) | nunca revogada (14,7 MB até o `terminate`) | revogada no `finally` das tentativas GPU/CPU (`ok`, `sem_suporte` ou `outro`) |

## Exemplo

- **Telemetria:** com a guarda instalada para `https://revocast.test`, `fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })` rejeita com `TypeError` ("guarda de rede: só a própria origem", sem a URL), o `fetch` original não é chamado e `aoBloquear` é chamado uma vez sem argumentos; `fetch('/assets/vision_wasm_module_internal-BfM4hauK.wasm')` chega ao original com o mesmo texto (testes `guarda-bloqueia-rede-externa` e `guarda-conta-bloqueios`).
- **Leitura:** `Victory` 0,69 → `{ gesto: null, confianca: 0.69 }`; `Victory` 0,9 → `{ gesto: 'Victory', confianca: 0.9 }`; `Thumb_Up` 0,75 e `ILoveYou` 0,88 → `ILoveYou` (teste `leitura-do-resultado`; com o limiar 0,5, a sabotagem S12 aceita o 0,69).
- **Quadro:** vídeo 1280 × 720 → canvas 256 × 144; retrato 720 × 1280 → 256 × 455 (teste `quadro-de-256`).
- **Build** (`npx vite build --outDir <scratchpad>` com variáveis de mentira só na linha de comando; formato ES do worker pela Tarefa 5):

| Arquivo em `assets/` | Bytes | `gzip -9` | Onde é referenciado |
|---|---|---|---|
| `reconhecedor.worker-*.js` | 6 866 (7 262 na rodada 1) | 3 000 (3 119) | chunk principal (`new Worker(new URL(…))`); ES: `import(\`./vision_bundle-*.js\`)`, nenhum `import` estático |
| `vision_bundle-*.js` (MediaPipe) | 154 313 | 44 776 | só o chunk do worker; 1 ocorrência de `odml.pa.googleapis` (a telemetria, bloqueada em tempo de execução) |
| `vision_wasm_module_internal-*.js` (carregador) | 336 662 | 80 948 | só o chunk do worker (`?url`) |
| `vision_wasm_module_internal-*.wasm` | 14 665 738 | 4 147 464 | só o chunk do worker; SHA-256 `a269e84b…1669e46` (igual a `SHA256_DO_WASM`) |
| `gesture_recognizer-*.task` | 8 373 440 | 6 324 520 | só o chunk do worker; SHA-256 `97952348…2b0482` (igual a `SHA256_DO_MODELO`) |
| `index-*.js` (principal) | 648 183 (648 331 na rodada 1; 645 077 no HEAD `d1f77a1`) | 185 137 (185 197; 183 995) | +3 106 bytes (+3 254 na rodada 1; +1 142 e +1 202 com gzip): a página do reconhecedor e a fonte de quadros; nenhuma referência ao MediaPipe, ao WASM ou ao modelo |

A licença e o aviso continuam em `licencas/` (VER-062).

## Verificação

TDD: os 5 arquivos de teste falharam antes da implementação (os 4 novos não importavam; `servicos.test.ts` com 2 falhas: as chaves e `reconhecedores` indefinido).

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| V1 | suíte completa e checagens (primeira versão) | `npm run check` | 76 arquivos, 3 041 testes; typecheck, docs, segredos, grants, data-api e audit sem erro |
| V2 | outra abordagem: o produto do build e a fonte do pacote | `vite build` com `--outDir` fora do repositório (tabela do Exemplo), `grep` das referências por chunk, SHA-256 dos arquivos emitidos, contagem dos caminhos de rede do MediaPipe (Passo 1), revisão linha a linha da ordem guarda → busca → SHA-256 → `import()` no chunk do worker minificado | sem erro: o MediaPipe só no chunk do worker; a guarda (`defineProperty`, `import(e)`) e a ordem presentes no chunk |
| Sabotagens | 30, numa cópia (`<scratchpad>/sdd-e5/t6/sab`, `node_modules` por link), `npx vitest run --no-cache --no-fsModuleCache --reporter=json` por arquivo de teste, o arquivo restaurado depois de cada uma | script `sabotar.py` (no scratchpad) | 30 de 30 derrubaram o teste esperado (tabela abaixo); `sha256sum` de 298 arquivos do repositório igual antes e depois |

| Id | Sabotagem | Teste que caiu |
|---|---|---|
| S1 | guarda aceita qualquer `https:` | `guarda-bloqueia-rede-externa` (15 casos, inclusive a telemetria como texto, `URL` e `Request`) |
| S2 | guarda que só olha o texto (relativa sem esquema sempre passa) | `//host` em `permitida` e em `guarda-bloqueia-rede-externa`; origem opaca; `importScripts` |
| S2b | `Request` lido como texto (sem `request.url`) | `URL e Request resolvidos como o texto`; `Request da telemetria` |
| S3 | `self.import` sem conferir | `guarda-bloqueia-importscripts-e-import` (2); `guarda-conta-bloqueios` |
| S4 | núcleo sem instalar a guarda | `guarda-antes-do-import`; `nucleo-confere-antes-de-usar` |
| S4b | `carregarTarefas` antes da guarda | `guarda-antes-do-import` (a telemetria do falso sai) e mais 6 |
| S5 | import estático do MediaPipe no worker | `worker-sem-import-estatico` |
| S6 | `modelAssetPath` em vez do buffer conferido | `nucleo-confere-antes-de-usar` |
| S7 | `Blob` do WASM sem tipo | `blob-do-wasm-com-tipo` |
| S8 | sem o `close` do quadro | `quadro-fechado-sempre`; `atenderMensagens` |
| S9 | sem `terminate` | `fechar-encerra-o-worker` (2); `iniciar-com-prazo`; falhas |
| S10 | `document.body.appendChild(video)` | `video-fora-do-dom` (e os outros 9, que não têm documento) |
| S11 | sem `play()` ao criar | `video-tocando` (3) e mais 5 |
| S11b | `paused` ignorado | `video-tocando: paused com videoWidth > 0` |
| S12 | limiar 0,5 | `leitura-do-resultado: Victory 0,69` |
| S13 | sem devolver o `ModuleFactory` | `delegado-gpu-e-depois-cpu` |
| S14 | propriedades trocadas por atribuição (sem travar) | `guarda-nao-pode-ser-desfeita` |
| S15 | resposta resolvida dentro do `onmessage` | `resposta-adiada` |
| S16 | prazo de 600 s | `iniciar-com-prazo`; `pronto a tempo cancela o prazo` |
| S17 | quadro sem a lista de transferíveis | `um-quadro-transferido` |
| S18 | original recebe `String(entrada)` de novo (segunda leitura do `toString`) | `o texto é lido uma vez` |
| S19 | `aoBloquear` recebe a URL | `guarda-conta-bloqueios` |
| S20 | `digest` que rejeita → `outro` | `nucleo-recusa-hash-diferente: digest que rejeita` |
| S21 | `iniciar` depois de `fechar` cria worker | `fechar-encerra-o-worker: … iniciar depois de fechar não cria worker (VER-058)` |
| S22 | sem conferir `WebAssembly` | `sem-suporte: sem WebAssembly` |
| S23 | uma fábrica por tipo | `servicos.test.ts`: `um por página e preguiçosos` |
| S24 | `modelAssetBuffer` com os bytes do WASM | `nucleo-confere-antes-de-usar` |
| S25 | bitmap depois do `fechar` sai | `fechar durante o createImageBitmap` |
| S26 | sem a conferência do `readyState` | `sem-video-sem-quadro: só os metadados` |
| S27 | entrada que não vira texto lança fora da promessa | `entrada que nem vira texto → rejeita` |

Na S27, o nome esperado no script estava escrito diferente do título do teste ("não" × "nem"); o teste caiu (resultado bruto no JSON do scratchpad) e só o nome no script foi corrigido.

**Rodada 1 (C1).** Correções da revisão R1 (I1 e os nits N1–N6), refeitas as verificações do zero (mudança de código e de teste):

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| C1-V1 | suíte completa e checagens | `npm run check` | 76 arquivos, 3 059 testes; typecheck, docs, segredos, grants, data-api e audit sem erro |
| C1-V2 | outra abordagem: as 30 sabotagens da primeira versão repetidas sobre o código da rodada (S4, S4b e S24 com o trecho novo) e 15 novas; leitura do diff do domínio contra os 50 testes da Tarefa 1 (que continuam passando) | `sabotar.py` e `sabotar-c1.py` numa cópia, `--no-cache --no-fsModuleCache` | 45 de 45 derrubaram o teste esperado; `sha256sum` de 299 arquivos igual antes e depois |
| Sonda do revisor (R1) | Chromium 153 headless, o worker **real** do build, servidor estático local, rota que aborta e registra pedido fora da origem | relatório da revisão (`rev-t6/sonda/` no scratchpad) | worker real `pronto` em ~0,6 s e 3 leituras; só pedidos da própria origem; recuo GPU→CPU de verdade (GPU forçada a falhar: com a fábrica devolvida → `pronto` pela CPU; com a devolução sabotada → `sem_suporte`); telemetria: 1 tentativa bloqueada aos 60,4 s e nenhuma depois em 70 s, 0 pedidos externos (com a guarda do `fetch` aberta, a rota registra `odml.pa.googleapis.com/v1/log`); `quadrosDeVideo.ts` real com câmera falsa: 12 de 12 quadros 256×192, todos diferentes, 0 `<video>` no documento. A prova oficial com o modelo real continua sendo da Tarefa 9 |

| Id | Sabotagem (rodada 1) | Teste que caiu |
|---|---|---|
| C1-S1 | sem o `encerrar` no erro depois do `pronto` (I1) | `worker-morto-depois-do-pronto` (`onerror` e `onmessageerror`) |
| C1-S2 | pendentes resolvem `null` na morte | `worker-morto-depois-do-pronto` (2) |
| C1-S3 | `reconhecer` depois da morte devolve `null` | `worker-morto-depois-do-pronto` (2) |
| C1-S4 | `postMessage` que lança não fecha o quadro | `postMessage que lança` |
| C1-S5 | `ms` negativo aceito | `leitura com ms negativo ou não finito` |
| C1-S6 | domínio trata a rejeição do `reconhecer` como quadro `null` | `reconhecedor-morto-vai-a-falhou` |
| C1-S7 | `Worker` fora da lista | `guarda-bloqueia-outros-caminhos: Worker` |
| C1-S8 | `Cache.add` sem conferir | `guarda-bloqueia-cache-externo` |
| C1-S9 | `Cache.addAll` sem conferir | `guarda-bloqueia-cache-externo` |
| C1-S10 | `importScripts` recebe as entradas originais | `o texto é lido uma vez (toString traiçoeiro…)` |
| C1-S11 | sem revogar a URL `blob:` | `blob-revogado` (4) e `nucleo-confere-antes-de-usar` |
| C1-S12 | revogar antes das tentativas | `blob-revogado` e `nucleo-confere-antes-de-usar` |
| C1-S13 | pontuação acima de 1 aceita | `leitura-do-resultado: pontuação acima de 1` |
| C1-S14 | `atenderMensagens` sem fila | `fila: um quadro que chega com o iniciar ainda em curso` |
| C1-S15 | fila sem o `catch` | `fila: um postar que lança` |

**Rodada 2 (C2).** A re-revisão R2 saiu limpa, com dois nits só de teste (o código de produção não mudou): R2-1, `Cache.add`/`addAll` repassam o texto lido uma vez, nunca a entrada original; R2-2, `reconhecer` que lança de forma síncrona → `falhou`. Reconferência pontual: os dois testes novos, as 3 sabotagens abaixo numa cópia (`--no-cache --no-fsModuleCache`, `sha256sum` de 295 arquivos de `src`, `supabase`, `scripts` e `docs` igual antes e depois) e `npm run check` (76 arquivos, 3 061 testes, 0 erros). Na primeira execução da rodada, o `autenticacao` de `obsWebsocket.test.ts` (E3, arquivo não tocado) falhou uma vez sob carga (o `crypto.subtle` assíncrono contra o `esperar()` do teste); passou 3 de 3 sozinho e na execução seguinte do `npm run check` completo: instabilidade desse teste sob carga, fora desta tarefa, registrada aqui.

| Id | Sabotagem (rodada 2) | Teste que caiu |
|---|---|---|
| C2-S1 | `Cache.add` repassa a entrada original | `guarda-bloqueia-cache-externo: o texto é lido uma vez…` (R2-1) |
| C2-S2 | `Cache.addAll` repassa a lista original | o mesmo e `guarda-bloqueia-cache-externo: Cache.add e addAll…` |
| C2-S3 | sem o `try`/`catch` da exceção síncrona do `reconhecer` | `reconhecedor-morto-vai-a-falhou: reconhecer que lança de forma síncrona` (R2-2) |

Nits corrigidos (não zeram a contagem): R2-1 e R2-2 (testes, rodada 2).

## Riscos

- **Nada real rodou nos testes de unidade:** o modelo, o WASM, o worker de módulo, o `self.import` guardado no lugar do `importScripts` e a telemetria bloqueada são provados nos testes só com falsos e pela fonte; a sonda do revisor no Chromium 153 (Verificação, rodada 1) rodou o worker real e confirmou o recuo GPU→CPU, o bloqueio da telemetria e os quadros do `<video>` fora do DOM, mas não substitui a conferência oficial; a conferência no Chromium com o modelo real (nenhuma requisição para fora, contador de `bloqueios()`, tempo de carga) é da Tarefa 9 (PLA-006, passo 5 da conferência).
- **Dependência do comportamento do `Wh` 1.2.3:** a tentativa com CPU depende de devolver o `ModuleFactory` ao escopo; uma versão nova do pacote pode mudar o carregador (a troca de versão já exige trocar os SHA-256 e conferir de novo, VER-062).
- **Memória:** o módulo WASM criado na tentativa com GPU que falhou não tem como ser fechado (a referência fica com o MediaPipe) e só sai no `terminate`; a URL `blob:` do WASM é revogada depois das tentativas desde a rodada 1 (N4).
- **Limite da guarda (rodada 1, N3):** cobre `fetch`, `XMLHttpRequest`, `importScripts`, `self.import`, `WebSocket`, `EventSource`, `Worker`, `SharedWorker`, `WebTransport`, `WebSocketStream` e `Cache.add`/`addAll`. Ficam de fora: o redirecionamento de uma URL da própria origem para fora (o `fetch` guardado segue `redirect: 'follow'`; só o servidor do app poderia causá-lo) e caminhos que a fonte 1.2.3 não usa e o worker não tem como API de rede conferida (o revisor varreu o bundle, o carregador e as strings do `.wasm`). Uma versão nova do pacote exige repetir a varredura.
- **Morte do worker (rodada 1, N6):** depois de um erro do worker já pronto, o laço vai a `falhou` e só tenta de novo num evento novo; um erro capturado dentro do worker (o MediaPipe lança num quadro) continua sendo `sem_leitura` → `null`, falha só daquele quadro.
- **Guarda só no worker:** a página não tem guarda (não carrega o MediaPipe); o `import()` nativo continua não interceptável (por isso o teste `worker-sem-import-estatico`). Uma CSP futura precisa de `'wasm-unsafe-eval'` e `worker-src 'self' blob:` (PLA-006, D9).
- **`<video>` fora do DOM** tocando no iPhone (F13) e o delegado GPU no worker (WebGL2 em `OffscreenCanvas`, F11): **só o responsável**; contingência na D10.
- **Leitura conservadora:** se o classificador devolver `None` e um gesto com pontuações próximas, prevalece a maior; se for `None`, nenhum gesto (divergência 5).
- A decisão de aceitar ou não as métricas do MediaPipe (com o consentimento do README do pacote) continua com o responsável (Tarefa 9, Passo 4); o padrão é bloquear.
