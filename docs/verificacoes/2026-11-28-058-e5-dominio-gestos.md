# VER-058 — E5, Tarefa 1: domínio dos gestos (núcleo de canal, gestos, confirmador e laço do reconhecimento)

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-058 |
| Título | E5, Tarefa 1: núcleo `canal/` (fecha o ciclo `aovivo` ↔ `captura`), gestos, confirmador de 1 s e de intervalo, laço do reconhecimento com taxa adaptativa e presença com `gestos` |
| Gravidade | média |
| Tipo | implementação · decisão de arquitetura · segurança |
| Data | 2026-11-28 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-28-058-e5-dominio-gestos.md` |
| Arquivos | `src/domains/canal/README.md`, `src/domains/canal/estados.ts`, `src/domains/captura/{gestos,confirmador,reconhecimento}.ts`, `src/domains/captura/{gestos,confirmador,reconhecimento}.test.ts` (novos); `src/domains/captura/{portas,falsos,emissor,receptor,sinais}.ts`, `src/domains/aovivo/portas.ts`, `src/domains/aovivo/mensagens.ts`, `src/domains/aovivo/mensagens.test.ts`, `src/domains/arquitetura.test.ts`, `src/domains/README.md`, `src/domains/aovivo/README.md`, `src/domains/captura/README.md`, `src/README.md`, `docs/verificacoes/README.md`, este registro (23 arquivos) |

## Problema

**Pendências da E4 (abertura exigida pelo [PLA-006](../planos/2026-11-28-e5-gestos.md#L348-L348), Passo 6 da Tarefa 1):**

| Pendência | Origem | Situação em 2026-11-28 |
|---|---|---|
| Aplicar no editor SQL a migração [`20261127230000_video_da_camera.sql`](../../supabase/migrations/20261127230000_video_da_camera.sql) (e, se ainda não feitas, as seis anteriores e o guia "Ao vivo e pareamento (E3)") antes de publicar o build da E4 | guia "Vídeo da câmera (E4)" de [`supabase/README.md`](../../supabase/README.md#L207-L215), [VER-055](2026-11-28-055-e4-conferencia-e-guia.md) | sem resultado informado pelo responsável nesta sessão: **continua pendente** |
| Conferência real do vídeo (celular como câmera no OBS, tela preta, troca do `obs_camera`, revogações, rede do celular) | mesmo guia | **continua pendente** (depende da anterior) |
| Decisões D1–D14 do PLA-005, a piscada numa queda breve do ICE (VER-049) e as pendências da E0 à E3 | [VER-056](2026-11-28-056-e4-correcoes-revisao-final.md), Riscos; [VER-057](2026-11-28-057-plano-e5.md) | sem resposta informada: **continuam pendentes** |

Nenhum código da E5 depende delas; só a conferência real da Tarefa 9.

**O problema da tarefa:** a E5 põe gestos no app, e o primeiro perigo do "Foco da revisão" do PLA-006 é **gesto falso disparando comando** (item 1): sem uma regra única e testada de "segurar 1 s, confiança mínima, tolerância a quadro perdido, soltar antes de repetir e intervalo de 3 s", cada rota inventaria a sua. Também faltavam: o laço que mede o aparelho e para quando ele não aguenta (item 9, bateria e desempenho), a reação a `negado`/`desligados` do banco sem deixar o worker ligado à espera de um aviso perdido (revisão 2, N14), os leitores do tópico de gestos (itens 2 e 11: gesto forjado, aviso com valor), a situação dos gestos na presença (D12) e as portas para os adaptadores das Tarefas 4 e 6. Antes disso, o ciclo de tipos `aovivo` ↔ `captura` (VER-049, Riscos; VER-056, N6) cresceria com os gestos em `captura/`.

## Era proposital?

Não. O DES-001 §6 põe "reconhecimento de gesto, confirmação" no contexto Captura desde o desenho; o ciclo de tipos foi registrado como pendência para "antes da E5" no [VER-056](2026-11-28-056-e4-correcoes-revisao-final.md) (N6) e nos Riscos do [VER-049](2026-11-27-049-e4-dominio-captura.md); o PLA-006 põe tudo na Tarefa 1 ([D1](../planos/2026-11-28-e5-gestos.md#L95-L101), [D3](../planos/2026-11-28-e5-gestos.md#L136-L140), [D11](../planos/2026-11-28-e5-gestos.md#L186-L193), [D12](../planos/2026-11-28-e5-gestos.md#L195-L195), [Tarefa 1](../planos/2026-11-28-e5-gestos.md#L267-L348)). Nenhum código anterior trata de gesto no aparelho (só o mapa de gestos da E2, `preparacao/gestos.ts`, cujo tipo `Gesto` é reusado).

**Divergências entre o brief e o código commitado, e escolhas desta tarefa (seguido o código; nenhuma muda uma regra do plano):**

| Ponto | Brief / plano | Feito | Motivo |
|---|---|---|---|
| `FabricaDeCanaisDeGestos` | ausente da interface do brief; presente na estrutura de arquivos do plano (Tarefa 1) | acrescentada em `portas.ts` (`gestos(): CanalDeGestos`) | a Tarefa 4 implementa a fábrica; o par porta + fábrica segue `FabricaDeCanaisDeVideo` |
| Auxiliares de validação | "os leitores montam o objeto campo a campo (como `sinais.ts`)" | `objetoComChaves`, `campo`, `ehUuid`, `extrasValidos` e `Objeto` de `sinais.ts` passam a ser exportados e usados por `gestos.ts` (nenhuma regra mudou; `sinais.ts` cresce de 193 para 196 linhas) | reuso (`CLAUDE.md`): a mesma regra de forma fechada nos dois tópicos da Captura |
| Assinatura de `criarReconhecimento` | objeto literal no parâmetro e no retorno | as mesmas formas, com nomes (`DependenciasDoReconhecimento`, `CondicoesDoReconhecimento`) | igual estruturalmente; os nomes servem às rotas da Tarefa 8 |
| Sem episódio | lista de estados sem `sem_episodio` | `episodio: false` → `desligados` | é o que o banco devolve (`ligados` falso sem episódio ativo, D5) |
| Página escondida | "`visivel: false` → `fechar`, sem quadros" | situação `aguardando_video` | sem página visível não há quadros; nenhum estado próprio na lista fechada |
| `lento`, `sem_suporte`, `falhou` | "volta a tentar só num evento novo… nunca sozinho"; "`tentarDeNovo` recomeça uma vez" | bloqueio que sobrevive a `definir` com as mesmas condições; sai com `tentarDeNovo` ou com os gestos desligados (ou `reconhecerAqui` falso) e ligados de novo | `definir` é chamada a cada mudança da rota (vídeo, página); `gestos_mudaram`, `dispositivo_mudou` e episódio novo chegam como `tentarDeNovo` ou como a passagem por desligado |
| `negado` e `desligados` | "situação `desligados` até a próxima `definir`" | bloqueio `negado`, mostrado como `desligados`, limpo por qualquer `definir`; o laço para **antes** de chamar `aoGesto` | a rota pode chamar `definir` de dentro do `aoGesto`; parar depois apagaria a definição nova |
| Prazo do carregamento | `ESPERA_DO_RECONHECEDOR_MS` "→ `falhou`" (D11); `FalhaDoReconhecedor` tem `tempo` | o laço também conta o prazo (motivo `carga` da agenda) | defesa em profundidade: um adaptador que nunca responde não deixa o laço em `carregando` para sempre |
| Tempo por quadro | "`ms` medido no worker, mais o tempo de ida e volta" | `max(ms do worker, ida e volta medida pelo laço)` | a ida e volta já inclui o worker; o `max` protege um relógio que não andou |
| Cadência da situação | — | o estado e a taxa vão na hora; o `msPorQuadro` no primeiro quadro e depois a cada `JANELA_DA_MEDIA` quadros; nada repetido | a rota coalesce a presença em 10 s (D12), e um `setState` a 10 Hz seria desperdício |
| Soltar | "o gesto foi solto depois da última confirmação dele (`SOLTAR_MS`)" | uma leitura sem o gesto pelo menos 500 ms depois da última vez em que foi visto; `zerar` **não** conta como soltar (rodada 1 da revisão, I1: na primeira versão contava, e um punho mantido durante uma piscada do vídeo era confirmado duas vezes) | medido pelas leituras, como o buraco (revisão 1, N4); depois de o laço parar não se sabe se a mão desceu, e o lado seguro é supor que não (D3: "um punho mantido por 10 s gera um marcador"); a primeira leitura sem o gesto depois do reinício já solta |
| Leitura fora dos 7 | o worker devolve `Gesto \| null` | o laço confere com `ehGesto` (o `None` conta como sem gesto) | defesa em profundidade contra um adaptador que não traduziu |
| Quadro `null` com o laço vivo | `null` = sem vídeo agora | situação `aguardando_video` com o worker vivo; nova tentativa no período | o vídeo pausa e volta (D10); recriar o worker custaria o carregamento |
| `captura-nao-importa-aovivo` | "captura sem import de aovivo" | confere também os `.test.ts` de `captura/` | nenhum importa hoje; a regra "nem tipo" vale para a pasta toda |
| Testes a mais | lista do Passo 1 | 18 testes além dos citados (ver Verificação) | cada ramo novo do laço e dos leitores com teste de nome conhecido |
| Contagem do `aovivo/README.md` | — | 154 testes (o README dizia 143 desde o VER-049, sem o teste da rodada 1 do VER-052: eram 144) | nit de documentação corrigido |
| Commit e push (Passo 6 do brief) | "commit; push; relato" | **não feitos** | subagente não faz commit nem push (`CLAUDE.md`, Commit; decisões do PLA-006): ficam com o agente principal |

## Solução

**`canal/estados.ts`** (D1): `EstadoDoCanal`, sem nenhum import; `aovivo/portas.ts` o importa e reexporta (`export type { EstadoDoCanal } from '../canal/estados'`); `captura/{portas,falsos,emissor,receptor}.ts` o importam de `canal` (linha 1 de cada, o tamanho dos arquivos não muda: 429 e 288 linhas no emissor e no receptor).

**`captura/gestos.ts`** (D2–D4, D11, D12): as constantes literais do brief (`SEGURAR_MS = 1000`, `INTERVALO_MS = 3000`, `INTERVALO_DO_SERVIDOR_MS = INTERVALO_MS - 500`, `TOLERANCIA_MS = 300`, `SOLTAR_MS = 500`, `CONFIANCA_MINIMA = 0.7`, `QUADROS_POR_SEGUNDO = 10`, `QUADROS_REDUZIDOS = 5`, `JANELA_DA_MEDIA = 20`, `MS_PARA_REDUZIR = 120`, `MS_PARA_PARAR = 400`, `TEMPO_LENTO_MS = 10_000`, `ESPERA_DO_RECONHECEDOR_MS = 60_000`); `topicoDosGestos` (lança fora de uuid minúsculo); `EVENTOS_DOS_GESTOS` congelado; `lerGestoParaOPalco` (só o evento e o `tipo` `gesto`; chaves `tipo`, `gesto_id`, `gesto`, `dispositivo`, `remetente`, `id`; o `id` do `realtime.send` ignorado; devolve objeto novo `{ id, gesto, dispositivoId }`); `lerAvisoDosGestos` (só `gestos_mudaram`, com `tipo`, `remetente` e `id`; um `ligados` → `null`); `LeituraDoGesto`, `EstadoDosGestos`, `SituacaoDosGestos`, `lerSituacaoDosGestos` (os três campos presentes, estado da lista, números finitos ≥ 0 ou `null`), `RespostaDoGesto`, `ehGesto`.

**`captura/confirmador.ts`** (D3): `criarConfirmador()` com `ler` e `zerar` (`zerar` recomeça a contagem e mantém o intervalo e o "ainda não solto", rodada 1, I1); tolerância usada `max(TOLERANCIA_MS, 2 × periodoMs)` (revisão 1, N5); faixas inclusivas (N4).

**`captura/reconhecimento.ts`** (D5, D8, D11): `criarReconhecimento` sobre `criarAgenda` (motivos `quadro` e `carga`, um agendamento por motivo); regras na Lógica.

**`captura/portas.ts`**: `QuadroDeVideo` (opaco), `FonteDeQuadros`, `FalhaDoReconhecedor`, `ReconhecedorDeGestos`, `FabricaDeReconhecedores`, `CanalDeGestos`, `FabricaDeCanaisDeGestos`, `RepositorioDosGestos`, como no brief.

**`captura/falsos.ts`**: `criarReconhecedoresFalsos`, `criarFonteFalsa`, `criarRepoDosGestosFalso` (só para os testes).

**`aovivo/mensagens.ts`** (D12): a presença de dispositivo ganha `gestos?: SituacaoDosGestos`; `lerPresenca` aceita `gestos` só em `camera` e `obs_camera` (no `obs_palco` ou inválido → `null`), com ou sem `video`.

**`arquitetura.test.ts`**: `captura-nao-importa-aovivo`, `canal-nao-importa-dominio`, o detector das duas setas e o `dominio-sem-navegador` conferindo que os arquivos novos estão no glob.

## Por que esta solução

- **DDD e Pure Fabrication:** a regra do gesto confirmado e o laço ficam no domínio, testáveis com relógio falso e sem jsdom; o worker, o vídeo e o banco entram só pelas portas (Tarefas 4 e 6), com o quadro opaco: o domínio não tem como mandar um quadro para fora (D8).
- **Componentes e reuso:** o confirmador é puro e separado do laço (provado leitura a leitura); o laço reusa `criarAgenda` (a mesma regra de um agendamento por motivo do emissor e do receptor) e os falsos ficam em `falsos.ts`, ao lado dos da E4; os leitores reusam os auxiliares de `sinais.ts`.
- **Segurança:** os leitores recusam qualquer chave fora da forma, `__proto__`, protótipo de classe, uuid em maiúsculas e o `None`; o aviso nunca leva valor (D4); o laço trata `desligados` como `negado` e encerra o worker (revisão 2, N14), e um envio que falha nunca segura o laço.
- **Otimização:** um quadro por vez (sem fila), o degrau de 10 para 5 quadros/s, o corte em `lento`, o worker encerrado em toda condição falsa e nenhum agendamento sobrando depois de `parar`.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Manter `EstadoDoCanal` em `aovivo/portas.ts` | o ciclo de tipos cresceria com os gestos (VER-056, N6) |
| `EstadoDoCanal` em `src/shared/` | o domínio não importa `shared/` (`arquitetura.test.ts`) |
| Confirmador dentro do laço | a regra de 1 s, 3 s, tolerância e soltar só seria testável com o laço e o relógio |
| Contar o "segurar" por número de quadros (10 leituras) | a 5 quadros/s seriam 2 s; o tempo medido vale nas duas taxas (D3) |
| Intervalo de 3 s só para o mesmo gesto | um punho e depois um ✌️ seguidos dispararia dois comandos em menos de 3 s (antiobjetivo "gesto acidental"); a sabotagem S5 prova que o teste pega |
| Repetir o envio quando `enviar` falha | um gesto atrasado pode chegar fora de hora; o laço só avisa a rota (`falhou`) |
| Deixar o worker ligado depois de `desligados` esperando o aviso | o aviso pode ter se perdido (canal caído); o laço para e a rota relê no banco (revisão 2, N14) |
| Recriar o worker a cada quadro `null` | o carregamento custa segundos (WASM e modelo); o vídeo pausado volta sozinho (D10) |
| `msPorQuadro` na situação a cada quadro | `setState` e presença a 10 Hz; a rota coalesce em 10 s (D12) |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/domains/canal/estados.ts`](../../src/domains/canal/estados.ts#L1-L9) | 1–9 | novo: `EstadoDoCanal` |
| [`src/domains/canal/README.md`](../../src/domains/canal/README.md) | — | novo: README de 11 seções |
| [`src/domains/aovivo/portas.ts`](../../src/domains/aovivo/portas.ts#L1-L26) | 2, 22–26 | importa e reexporta `EstadoDoCanal` de `canal` |
| [`src/domains/captura/emissor.ts`](../../src/domains/captura/emissor.ts#L1-L1), [`receptor.ts`](../../src/domains/captura/receptor.ts#L1-L1), [`falsos.ts`](../../src/domains/captura/falsos.ts#L1-L1), [`portas.ts`](../../src/domains/captura/portas.ts#L1-L1) | 1 | `EstadoDoCanal` de `../canal/estados` (emissor e receptor continuam com 429 e 288 linhas) |
| [`src/domains/captura/sinais.ts`](../../src/domains/captura/sinais.ts#L101-L128) | 101–128 | `Objeto`, `objetoComChaves`, `campo`, `ehUuid`, `extrasValidos` exportados |
| [`src/domains/captura/gestos.ts`](../../src/domains/captura/gestos.ts#L1-L150) | 1–150 | novo: constantes, tópico, eventos, leitores, situação, `RespostaDoGesto` |
| [`src/domains/captura/confirmador.ts`](../../src/domains/captura/confirmador.ts#L1-L73) | 1–73 | novo: `criarConfirmador` (rodada 1: `zerar` só zera a contagem, L68–L70; o recomeço ao soltar e o comentário, L41–L45) |
| [`src/domains/captura/reconhecimento.ts`](../../src/domains/captura/reconhecimento.ts#L81-L337) | 1–337 | novo: `criarReconhecimento` (`avaliar` L146, `ligar` L170, `pedirQuadro` L233, `depoisDoQuadro` L274, `enviar` L297); rodada 1 (N1): `sessao !== s` conferido depois de cada situação publicada |
| [`src/domains/captura/portas.ts`](../../src/domains/captura/portas.ts#L97-L153) | 2–3, 97–153 | portas dos gestos |
| [`src/domains/captura/falsos.ts`](../../src/domains/captura/falsos.ts#L281-L420) | 2–20, 281–420 | falsos do reconhecedor (rodada 1: `leituraNula`, `msDoWorker`, `gestoNoQuadro`), da fonte (rodada 1: `segurarQuadro`, `soltarQuadros`) e do repositório |
| [`src/domains/aovivo/mensagens.ts`](../../src/domains/aovivo/mensagens.ts#L310-L346) | 2, 60–66, 310–346 | presença com `gestos` |
| [`src/domains/captura/gestos.test.ts`](../../src/domains/captura/gestos.test.ts), [`confirmador.test.ts`](../../src/domains/captura/confirmador.test.ts), [`reconhecimento.test.ts`](../../src/domains/captura/reconhecimento.test.ts) | — | novos: 62, 26 e 50 testes (rodada 1: +2 no confirmador, +12 no laço; um teste do `zerar` trocado) |
| [`src/domains/aovivo/mensagens.test.ts`](../../src/domains/aovivo/mensagens.test.ts#L276-L312) | 276–312 | `presenca-com-gestos` (10) |
| [`src/domains/arquitetura.test.ts`](../../src/domains/arquitetura.test.ts#L35-L143) | 35–41, 89, 96–143 | as duas setas, o detector delas, os arquivos novos no glob e (rodada 1, N3) `Worker`, `ImageBitmap`, `createImageBitmap`, `OffscreenCanvas`, `crypto` e `performance` no detector de navegador, com teste |
| READMEs de [`src/domains/`](../../src/domains/README.md), [`aovivo/`](../../src/domains/aovivo/README.md), [`captura/`](../../src/domains/captura/README.md) e [`src/`](../../src/README.md), e [`README.md`](README.md) desta pasta | — | a regra de dependência nova, o núcleo `canal/`, os gestos (diagrama de estados e linha do tempo do confirmador em `captura/`), a presença com `gestos`, contagens, a linha deste registro e o exemplo (continua 067) |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| 1. Setas entre domínios | `captura/` → `aovivo/` (tipo) e `aovivo/` → `captura/` (valor): ciclo só de tipo | `captura/` → `canal/`; `aovivo/` → `canal/` e `aovivo/` → `captura/`; `canal/` → nada; duas regras testadas |
| 2. Gesto no aparelho | nada | leitura por quadro → confirmador (1 s, tolerância, 0,7, soltar, 3 s) → `repo.enviar({ id, gesto })` |
| 3. Aparelho lento | — | média dos últimos 20 > 120 ms → 5 quadros/s; > 400 ms por 10 s → `fechar`, `lento`, nada sozinho |
| 4. Banco diz não | — | `negado` ou `desligados` → `fechar`, situação `desligados`, `aoGesto` para a rota reavaliar; a próxima `definir` decide |
| 5. Presença | `video?` | `video?` e `gestos?` (só `camera` e `obs_camera`) |

O laço, para cada `definir(c)` (a ordem decide o estado):

1. `!c.episodio || !c.ligados` → encerra, limpa o bloqueio, `desligados`.
2. `!c.reconhecerAqui` → encerra, limpa o bloqueio, `outro_aparelho`.
3. bloqueio (`lento`, `sem_suporte`, `falhou`; `negado` mostrado como `desligados`) → encerra e mostra.
4. `!c.video || !c.visivel` → encerra, `aguardando_video`.
5. sem worker → `fonte()`; `null` → `aguardando_video`; senão `criar()`, `carregando`, `iniciar()` com prazo de 60 s → `reconhecendo` e o primeiro quadro em 0 ms.

Cada quadro: `fonte.quadro()` → `reconhecer(q, em)` → tempo = `max(ms, ida e volta)`; média móvel → período (100 ou 200 ms) e o corte `lento`; `confirmador.ler(…, em, período)`; o próximo quadro em `max(0, período − decorrido)`. Os retornos atrasados de uma sessão encerrada são ignorados (`sessao !== s`, inclusive o quadro obtido depois de parar), cada situação publicada é seguida da mesma conferência (a rota pode chamar `parar` ou `definir` de dentro do `aoMudarSituacao`; rodada 1, N1), e depois de `parar` nada mais é chamado. Uma leitura `null` do worker não entra na média nem no confirmador, mas o próximo quadro é agendado do mesmo jeito. Ao encerrar, `confirmador.zerar()`: a contagem recomeça, e o gesto confirmado só volta a valer depois de solto.

## Exemplo

Do teste `gesto-confirmado-vai-ao-repo`: respostas de 20 ms, Victory com confiança 0,9 em todo quadro. Quadros começam em 0, 100, …, 900: nada enviado em 990 ms. No quadro de 1000: 1 000 ms segurando, sem confirmação anterior → `repo.enviar({ id: '11111111-…', gesto: 'Victory' })` uma vez e `aoGesto({ gesto: 'Victory', resposta: 'enviado', em: 1000 })`; até 5 990 ms, nenhum outro envio (mantido confirma uma vez).

Do teste `laco-para-quando-lento`: 450 ms por quadro. Em 10 000 ms o laço ainda reconhece (a média passou de 400 ms em 450 ms; 9 900 − 450 = 9 450 < 10 000); no fim do quadro de 10 800 ms (10 350 ≥ 10 000) → `fechar`, `{ estado: 'lento', quadrosPorSegundo: null, msPorQuadro: null }`; 30 s depois, nenhum quadro novo; `definir` igual não recomeça; dois `tentarDeNovo` → um worker novo só (2 `criar`).

Antes × depois na presença: `{ tipo: 'camera', dispositivoId, obs: null, gestos: { estado: 'reconhecendo', quadrosPorSegundo: 10, msPorQuadro: 42 } }` era recusada (chave fora da forma → `null`); agora é aceita, e a mesma com `tipo: 'obs_palco'` continua `null`.

## Verificação

| # | Abordagem | Comando / método | Resultado |
|---|---|---|---|
| TDD | testes antes do código | `npx vitest run src/domains` antes de qualquer arquivo de produção | FAIL como esperado: `Cannot find module './confirmador'`, `'./gestos'` (gestos e reconhecimento), `presenca-com-gestos` (2, `null`), `captura-nao-importa-aovivo` (4 violações), `canal-nao-importa-dominio` e `dominio-sem-navegador` (`./canal/estados.ts` fora do glob); 5 arquivos, 5 testes e 3 suítes falhando, 521 passando |
| T1 | implementação | `npx vitest run src/domains --cache=false` | 26 arquivos, 650/650 (eram 23 e 513: `captura/` +124, `mensagens` +10, `arquitetura` +3); depois da rodada 1, 665/665 (`captura/` +14, `arquitetura` +1) |
| T2 | suíte inteira e tipos | `npx tsc --noEmit`; `npm test` | 0 erros de tipo (nenhum arquivo fora de `domains` mudou); 70 arquivos, 2 784/2 784; depois da rodada 1, 2 799/2 799 |
| S | sabotagens, uma de cada vez (rodadas duas vezes: antes e depois do achado de V1, numa cópia nova) | `t1/sab/sabotar.py` no scratchpad da sessão: numa **cópia** do repositório (`tar` sem `.git`, `node_modules` por link, conferida igual por `diff -rq` antes e depois), confere o `sha256sum` do arquivo na cópia e no repositório, troca o trecho, roda `npx vitest run --cache=false --reporter=json` em `src/domains/captura`, `mensagens.test.ts` e `arquitetura.test.ts`, restaura e confere o `sha256sum` igual | 33/33 derrubam o teste esperado na primeira versão; 46/46 depois da rodada 1 (linha C1; tabela abaixo) |
| V1 | revisão do diff por outra abordagem (leitura linha a linha contra o brief, o plano e as âncoras) | âncoras: `wc -l` de `emissor.ts` (429), `receptor.ts` (288), `sinais.ts` (196 ≥ 193), `portas.ts` de `aovivo` (121 ≥ 117), `mensagens.ts` (375 ≥ 362), `mensagens.test.ts` (396 ≥ 358), `falsos.ts` (408 ≥ 261), `arquitetura.test.ts` (148 ≥ 115), READMEs (`src/` 75, `domains/` 86, `aovivo/` ≥ 124, `captura/` 204); `grep` de `aovivo` nos imports de `captura/` | um achado próprio corrigido antes de fechar: o laço passava ao confirmador qualquer texto vindo do worker (inclusive `None`); agora confere com `ehGesto` (teste novo e sabotagem X19). Nenhuma âncora encolheu |
| V2 | suíte inteira numa cópia nova (igual ao repositório por `diff -rq`), ordem embaralhada | `npx vitest run --cache=false --sequence.shuffle` (semente 1795852147728) | 70 arquivos, 2 784/2 784, sem erro; depois da rodada 1, numa cópia nova, semente 1795853332940: 2 799/2 799 |
| R1 | revisão independente, rodada 1 (sondas P1–P3 e sabotagens Sa–Sm numa cópia; a primeira tentativa foi perdida num reinício do container e refeita do zero) | spec ❌, reprovada: 2 achados importantes (I1 `zerar` contava como soltar — punho mantido na piscada do vídeo confirmava duas vezes, contra a D3; I2 quatro testes de laço faltando) e 5 nits — corrigidos na rodada 1 (linha C1) |
| R2 | re-revisão focada (sondas P1, P1b, P1c, P3 refeitas; Sg, Sf, Sb, Si, Sd, Sh, Sm, Sj repetidas; 2 799 testes e `tsc` numa cópia) | **limpa**; 1 nit (N6: a guarda depois de `situacaoDoLaco` no fim do quadro, `reconhecimento.ts:293`, não tem teste — efeito nulo, porque `pedirQuadro` já confere a sessão; mantida como defesa em profundidade e registrada aqui) |
| C1 | rodada de correção 1 (revisão: I1 `zerar` contava como soltar; I2 testes do laço para Sg, Sf, Sb, Si; N1 guarda depois da situação publicada; N2 linha do recomeço ao soltar sem teste; N3 detector com as APIs da E5; N4 testes de Sh, Sm, Sj; N5 riscos A3 e A4 mantidos). Sabotagens numa cópia nova (cache desligado, `sha256sum` igual antes e depois, `diff -rq` igual antes e depois): as 33 anteriores de novo e as 13 novas | `t1/sab/sabotar.py` na cópia | 46/46 derrubam o teste esperado: R1 (`zerar` contando como soltar) 2 (o punho com piscada no laço e `zerar não conta como soltar`); Sg 1; Sf 1; Sb 2; Si 1; N1 2; Sd 1 (`soltar-recomeca-a-contagem`); N3a (`crypto.randomUUID()` em `gestos.ts`) 1 (`dominio-sem-navegador`); N3b (detector sem `crypto` e `performance`) 1; Sh 1; Sm 1; Sj1 (só a ida e volta) 1; Sj2 (só o `ms` do worker) 1 |
| C | `npm run check` como último ato do implementador, com este registro já escrito (depois da rodada 1) | `npm run check` | 0 erros (`typecheck`, `npm test` 2 799/2 799, `check-docs`, `check-doc-secrets`, `rpc:grants-check`, `data-api:check`, `check-deps-audit`); o do commit é do controlador |

**Sabotagens** (as 14 do brief, S1–S14, 19 a mais, X1–X19, e 13 da rodada 1; contagem = testes que caíram nos três alvos na última corrida, depois da rodada 1):

| Id | Alteração | Teste que caiu |
|---|---|---|
| S1 | `SEGURAR_MS` 900 | `confirma-depois-de-1s` (32 no total, inclusive constantes e o laço) |
| S2 | tolerância = período (sem tolerância) | `buraco-dentro-da-tolerancia`, `tolerancia-a-5-quadros` (5) |
| S3 | tolerância infinita | `buraco-maior-que-a-tolerancia-zera` (3) |
| S4 | sem exigir soltar | `mantido-confirma-uma-vez` (6) |
| S5 | intervalo só para o mesmo gesto | `intervalo-de-3s` (5) |
| S6 | contar `confianca >= 0.6` | `none-e-baixa-confianca-nao-contam` (3) |
| S7 | aceitar `ligados` no aviso | `le-aviso-dos-gestos` (2) |
| S8 | espalhar o payload no leitor do gesto | `le-gesto-para-o-palco` (`__proto__` e chave extra; 4) |
| S9 | pedir quadro sem esperar a resposta | `laco-um-quadro-por-vez` (3) |
| S10 | sem o degrau de 5 | `laco-reduz-para-5` (4) |
| S11 | sem parar quando lento | `laco-para-quando-lento` (2) |
| S12 | criar o worker com `ligados: false` | `laco-parado-com-desligados` (7) |
| S13 | continuar o laço depois de `desligados` | `desligados-reavalia` (1) |
| S14 | `captura/portas.ts` importando `EstadoDoCanal` de `../aovivo/portas` | `captura-nao-importa-aovivo` (1) |
| X1 | prazo do carregamento ×10 | `falha-do-iniciar` (prazo) |
| X2 | `sem_suporte` tratado como `falhou` | `falha-do-iniciar` (`sem_suporte`) |
| X3 | qualquer `definir` limpa o bloqueio | `laco-para-quando-lento`, `falha-do-iniciar` (3) |
| X4 | `visivel` ignorado | `pagina-escondida-para` |
| X5 | `parar` sem encerrar o worker | `laco-parar-nao-deixa-agendamento` (4) |
| X6 | `aoGesto` depois de `parar` | `laco-parar-nao-deixa-agendamento` (resposta atrasada) |
| X7 | `gestos` aceito no `obs_palco` | `presenca-com-gestos`, `presenca-com-video` (2) |
| X8 | número negativo na situação | `situacao-dos-gestos`, `presenca-com-gestos` (3) |
| X9 | `topicoDosGestos` sem conferir | `topico-dos-gestos` (6) |
| X10 | `None` entre os gestos | `le-gesto-para-o-palco` (`None`) e `gesto-confirmado-vai-ao-repo` (`None`, desde o `ehGesto` no laço) (2) |
| X11 | soltar sem `SOLTAR_MS` | `soltar-e-mostrar-de-novo` |
| X12 | `zerar` apagando o intervalo | `zerar` (2) |
| X13 | `canal/estados.ts` importando `../preparacao/gestos` | `canal-nao-importa-dominio` |
| X14 | quadro `null` sem `aguardando_video` | `aguardando-video` (quadro `null`) |
| X15 | fábrica que lança sem proteção | `falha-do-iniciar` (fábrica que lança) |
| X16 | rejeição do `enviar` sem tratamento | `resposta-do-repo-nao-trava` |
| X17 | `gestos` descartado da presença | `presenca-com-gestos` (2) |
| X18 | `INTERVALO_DO_SERVIDOR_MS = INTERVALO_MS - 400` | `margem-do-intervalo`, constantes (2) |
| X19 | leitura do worker sem `ehGesto` | `gesto-confirmado-vai-ao-repo` (`None`) |
| R1 | `zerar` contando como soltar (a primeira versão) | punho mantido com uma piscada do vídeo; `zerar não conta como soltar` (2) |
| Sg | leitura `null` do worker sem agendar o próximo quadro | leitura `null` do worker não para o agendamento |
| Sf | `PERIODO_NORMAL_MS` no confirmador em vez do período atual | o período passado ao confirmador acompanha a taxa |
| Sb | sem a guarda depois do quadro obtido | quadro que chega depois de parar / de desligar (2) |
| Si | sem `confirmador.zerar()` no `encerrar` | reinício do laço zera a contagem |
| N1 | sem `sessao !== s` depois de `situacao('carregando')` | `parar`/`desligar` de dentro do `aoMudarSituacao(carregando)` (2) |
| Sd | sem o recomeço da contagem ao soltar (`confirmador.ts`, L45) | `soltar-recomeca-a-contagem` |
| N3a | `crypto.randomUUID()` em `gestos.ts` | `dominio-sem-navegador` |
| N3b | detector sem `crypto` e `performance` | o detector reconhece as APIs da E5 |
| Sh | vídeo conferido antes do bloqueio | o bloqueio vem antes do vídeo |
| Sm | sem o dedupe da situação | a situação não se repete |
| Sj1 | tempo = só a ida e volta | tempo por quadro (o worker diz 300 ms) |
| Sj2 | tempo = só o `ms` do worker | tempo por quadro (o worker diz 0 ms) |

**Testes além dos citados no brief** (18): `laco-parado-com-desligados` (sem episódio; desligar com o laço rodando), `aguardando-video` (fonte `null`; quadro `null` no meio), `carrega-uma-vez` (desligar durante o carregamento), `laco-reduz-para-5` (volta a 10), `laco-para-quando-lento` (média alta por menos de 10 s), `gesto-confirmado-vai-ao-repo` (confiança baixa; `None`; 4 respostas que não param), `resposta-do-repo-nao-trava` (envio pendurado), `falha-do-iniciar` (`outro`, rejeição, fábrica que lança, prazo de 60 s, desligar e ligar tenta de novo), `laco-parar-nao-deixa-agendamento` (durante o carregamento; resposta depois de parar), e nos leitores e no confirmador os casos de borda das tabelas.

Nits corrigidos (não zeram a contagem): contagem do `aovivo/README.md` (143 → 144 antes desta tarefa). Rodada 1: N1 a N5 entraram (tabela acima); como a rodada mexeu em código de produção (I1, N1), as verificações recomeçam e as rodadas R1 e R2 ficam com o controlador.

## Riscos

- **Só falsos:** o confirmador e o laço foram provados contra falsos das portas e um relógio falso. O reconhecedor real (worker, MediaPipe, integridade, F8) é da Tarefa 6; a composição nas rotas, da Tarefa 8; um gesto de verdade, da Tarefa 9 (Chromium, quadro sintético) e do aparelho real (responsável).
- **Soltar medido por leituras:** a 5 quadros/s, soltar pede três leituras sem o gesto (600 ms). Um gesto mantido nunca conta como solto, por mais espaçadas que sejam as leituras (só uma leitura **sem** ele solta), nem depois de um reinício do laço (`zerar`, rodada 1, I1); quem segurou o gesto durante uma parada precisa baixá-lo antes de repetir.
- **Fonte trocada com o laço vivo:** a fonte só é pedida quando o worker nasce; a rota (Tarefa 8) precisa passar `video: false` quando o fluxo muda.
- **Quadro descartado (A4, mantido na rodada 1, N5):** um quadro que chega depois de o laço parar não vai ao worker (teste da rodada 1, Sb), e o domínio não tem como liberá-lo: `FonteDeQuadros` não tem `liberar`, e o `ImageBitmap` fica com o coletor de lixo. Fica para a Tarefa 6.
- **Reconhecedor que só falha (A3, mantido na rodada 1, N5):** um worker que devolve `null` em todo quadro mantém o laço a 10 quadros/s sem nunca ir a `falhou` nem a `lento` (só leituras válidas entram na média); a metade testável (o laço não congela) tem teste desde a rodada 1 (Sg); a Tarefa 6 decide se o adaptador transforma falhas seguidas em erro.
- **Reentrada e `iniciar` depois de `fechar` (rodada 1, N1):** o laço não chama `iniciar` num reconhecedor fechado de dentro do `aoMudarSituacao`; a Tarefa 6 também deve garantir que um `iniciar` depois de `fechar` não cria worker.
- **Situação com atraso:** o `msPorQuadro` da situação só muda a cada 20 quadros (2 a 4 s); a taxa e o estado mudam na hora.
- **Revisões independentes:** R1 reprovada e corrigida na rodada 1; R2 limpa com 1 nit registrado (N6); `npm run check` 0 no conteúdo exato do commit.
