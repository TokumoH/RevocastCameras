# src/domains/captura

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-domains-captura |
| Título | `captura` |
| Tipo | código · domínio Captura (sinais do vídeo, portas, emissor e receptor) |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- src/domains/captura/README.md` |
| Arquivos | `README.md`, `sinais.ts`, `sinais.test.ts`, `portas.ts`, `agenda.ts`, `emissor.ts`, `emissor.test.ts`, `receptor.ts`, `receptor.test.ts`, `falsos.ts` |

## Propósito

Domínio **Captura** do [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md) (§6): o celular como câmera. Define os **sinais do vídeo** (oferta, resposta, `pronto`, `encerrar`) e os valida no recebimento, o tópico de vídeo da própria sessão, a situação do vídeo que vai na presença, as esperas da reconexão, as **portas** do canal de vídeo, da conexão WebRTC, da câmera e da tela ligada, e as duas máquinas de estado: o **emissor** (no `/camera`, oferece) e o **receptor** (no `/obs/camera`, responde). Nada aqui conhece o navegador: a faixa e o fluxo de vídeo são tipos opacos, e quem fala com `RTCPeerConnection`, `getUserMedia` e a Wake Lock são os adaptadores de `src/shared/infra/` (Tarefa 3 da E4). Quem decide quem recebe e quem envia os sinais é o banco (função `enviar_sinal_de_video` e `pode_usar_canal`, Tarefa 2), nunca a tela.

## Origem

Criado na Tarefa 1 da etapa E4 ([PLA-005](../../../docs/planos/2026-11-27-e4-celular-como-camera.md)), registro [VER-049](../../../docs/verificacoes/2026-11-27-049-e4-dominio-captura.md). Decisões aplicadas: D1 (onde fica cada coisa; tipos opacos; `captura` importa de `aovivo` só o tipo `EstadoDoCanal`; a lista de revogados chega como função), D2 (tópico da própria sessão; envio só pela função do banco), D3 (a câmera sempre oferece; o `pronto` não fura as esperas), D4 (sinais, tamanhos, a mesma regra do SDP no leitor e na função), D5 (o vídeo segue o episódio ativo), D6 (queda, falha, prazo da conexão, espera crescente, `sem_conexao_direta`, `limite`, `sinal_grande`), D7 (a câmera só liga depois do toque) e D13 (situação do vídeo na presença).

## Organização

- `sinais.ts`: `EVENTO_DO_SINAL`, `topicoDoVideo`, `TAMANHO_MAXIMO_DO_SDP`, `SinalDaCamera`, `SinalDaObs`, `conferirSdp`, os leitores `lerSinalDaCamera` e `lerSinalDaObs` (cada um só com os tipos do lado que envia), `EstadoDoVideo`, `SituacaoDoVideo`, `lerSituacaoDoVideo` e as esperas (`ESPERA_DO_ICE_MS`, `ESPERA_DA_RESPOSTA_MS`, `ESPERA_DA_QUEDA_MS`, `ESPERA_DA_CONEXAO_MS`, `ESPERAS_DE_RECONEXAO_MS`, `esperaDaTentativa`, `FALHAS_PARA_SEM_CONEXAO_DIRETA`, `PRONTO_A_CADA_MS`, `PRESENCA_MINIMA_MS`).
- `portas.ts`: `FaixaDeVideo` e `FluxoDeVideo` (opacos), `RespostaDoSinal`, `CanalDeVideo`, `FabricaDeCanaisDeVideo`, `EstadoDaConexao`, `ConexaoDeVideo`, `FabricaDeConexoes`, `FalhaDaCamera`, `CameraDoAparelho`, `ManterTelaLigada`. Sem teste próprio: só tipos, exercitados pelos falsos e, na Tarefa 3, pelos adaptadores.
- `agenda.ts`: `criarAgenda`, a regra comum do emissor e do receptor para o `agendar` injetado: um único agendamento por motivo e o `depois` (0 ms) para os ouvintes de porta.
- `emissor.ts` (`criarEmissorDeVideo`) e `receptor.ts` (`criarReceptorDeVideo`): as máquinas de estado, que só conhecem portas e o relógio injetado.
- `falsos.ts`: os falsos das portas (canal, conexões, câmera) e o relógio falso, usados só por `emissor.test.ts` e `receptor.test.ts`; nenhum código do app o importa.
- Dependência entre domínios: `captura` importa de `aovivo` **só o tipo** `EstadoDoCanal` e de `preparacao/midia.ts` o `UUID`; `aovivo/mensagens.ts` importa de `captura` o `lerSituacaoDoVideo` (a presença de `camera` e `obs_camera` leva `video`, D13).

## Por que esta organização

Cada perigo do "Foco da revisão" do PLA-005 que é do domínio tem um lugar e um teste de nome conhecido: sinalização forjada ou do lado errado (`sinais-validados`, `sinal-do-lado-errado`), câmera ligada sem o usuário saber (`emissor-so-liga-depois-do-toque`, `emissor-desliga-sem-episodio`), sessão antiga ou revogada (`emissor-primeira-resposta-vale`, `emissor-descarta-revogado`, `emissor-revoga-par`, `receptor-revoga-par`), NAT que impede a conexão (`emissor-sem-conexao-direta`, `emissor-prazo-da-conexao`, `emissor-espera-crescente`), reconexão (`emissor-queda-breve`, `emissor-canal-volta`, `receptor-oferta-nova-fecha-a-antiga`) e consumo (`emissor-pronto-respeita-a-espera`). As máquinas só conhecem portas, então o mesmo código roda com os adaptadores do navegador (Tarefa 3), com os falsos de tela (Tarefas 4 e 5) e com os falsos deste diretório, e o relógio injetado deixa provar cada prazo em milissegundos, sem esperar de verdade.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Máquinas de estado dentro das telas (`CameraNoAr.tsx`, `ObsCameraNoAr.tsx`) | Só testáveis com jsdom e falsos do navegador; a regra das esperas e do consentimento ficaria misturada com a apresentação |
| `RTCPeerConnection` e `MediaStreamTrack` nas portas | O domínio passaria a depender do navegador (o teste `dominio-sem-navegador` recusa); os tipos opacos bastam para o domínio passar a faixa e o fluxo adiante |
| Captura dentro de `aovivo/` | O DES-001 §6 separa Captura (câmera, envio de vídeo, gestos) de Ao vivo (comandos, estado no ar) |
| Depender da classe `Revogados` de `aovivo` | Acoplaria os dois domínios por valor; uma função `revogado(usuario)` injetada basta (D1) |
| Uma negociação dos dois lados ("perfect negotiation") | A câmera sempre oferece e o `obs_camera` só responde (D3): menos estados, e a função do banco recusa o tipo do outro lado |
| Repetir os falsos em cada teste | Os dois lados seriam provados contra falsos que podem divergir; `falsos.ts` é um só |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`sinais.ts`](sinais.ts) | Tópico, evento, sinais e leitores, `conferirSdp`, situação do vídeo e esperas (D2–D4, D6, D13) |
| [`sinais.test.ts`](sinais.test.ts) | 85 testes (protótipo diferente de `Object.prototype` e instância de classe recusados desde a rodada 1 da revisão): constantes; `topico-do-video`; `conferir-sdp`; `sinais-validados` (`test.each` com os dois leitores); `sinal-do-lado-errado`; `situacao-do-video`; `espera-da-tentativa` |
| [`portas.ts`](portas.ts) | `FaixaDeVideo`, `FluxoDeVideo`, `RespostaDoSinal`, `CanalDeVideo`, `FabricaDeCanaisDeVideo`, `EstadoDaConexao`, `ConexaoDeVideo`, `FabricaDeConexoes`, `FalhaDaCamera`, `CameraDoAparelho`, `ManterTelaLigada` |
| [`agenda.ts`](agenda.ts) | `criarAgenda`: um agendamento por motivo, `depois` (0 ms), `parar` |
| [`emissor.ts`](emissor.ts) | `DependenciasDoEmissor`, `criarEmissorDeVideo` (`ligarPeloToque`, `definirEpisodio`, `revogarPar`, `voltarAVer`, `parar`) |
| [`emissor.test.ts`](emissor.test.ts) | 46 testes (desde o VER-051, rodada 1, também `emissor-criar-que-lanca`: a fábrica de conexões que lança conta como falha, sem rejeição solta; desde a rodada 1 da revisão também `ouvinte-adiado`, `emissor-encerrar-so-do-par`, `emissor-sem-faixa-velha`, `emissor-sem-par-zera-falhas` e a faixa que chega atrasada depois do fim do episódio e do `parar`): `emissor-so-liga-depois-do-toque`, `emissor-desliga-sem-episodio`, `emissor-oferece`, `emissor-oferece-ao-pronto`, `emissor-pronto-respeita-a-espera`, `emissor-sdp-grande`, `emissor-sem-par`, `emissor-limite`, `emissor-primeira-resposta-vale`, `emissor-descarta-revogado`, `emissor-ignora-oferta`, `emissor-revoga-par`, `emissor-queda-breve`, `emissor-espera-crescente`, `emissor-sem-resposta`, `emissor-sem-conexao-direta`, `emissor-prazo-da-conexao`, `emissor-canal-volta`, `emissor-falha-da-camera`, `faixa-terminada-religa`, `emissor-voltar-a-ver`, `emissor-parar` |
| [`receptor.ts`](receptor.ts) | `DependenciasDoReceptor`, `criarReceptorDeVideo` (`definirEpisodio`, `revogarPar`, `parar`) |
| [`receptor.test.ts`](receptor.test.ts) | 25 testes (desde o VER-051, rodada 1, também `receptor-criar-que-lanca`; desde a rodada 1 da revisão também `receptor-video-so-conectado` (3, com o fluxo novo trocando o antigo desde a rodada 2), `ouvinte-adiado` e `receptor-falha-so-depois-de-responder`): `receptor-pronto`, `receptor-responde`, `receptor-oferta-nova-fecha-a-antiga`, `receptor-oferta-repetida`, `receptor-ignora-resposta`, `receptor-encerrar`, `receptor-revoga-par`, `receptor-sem-episodio`, `receptor-falhou`, `receptor-sem-conexao-direta`, `receptor-sdp-grande`, `receptor-limite`, `receptor-parar` |
| [`falsos.ts`](falsos.ts) | Só para os testes: `criarRelogioFalso`, `criarCanalFalso` (entrega pelo leitor real), `criarConexoesFalsas` (com o registro `criar#n`/`fechar#n` e respostas que podem ficar seguras), `criarCameraFalsa` (com o registro `ligar#n`/`faixa#n`/`desligar` e o `ligar` que pode demorar), SDPs de teste com IP da RFC 5737 |

## Lógica

Do toque ao vídeo no OBS (o banco escolhe o destinatário de cada sinal e põe o remetente, D2):

```mermaid
sequenceDiagram
    participant U as Pessoa no celular
    participant E as emissor (/camera)
    participant N as Navegador (getUserMedia, RTCPeerConnection)
    participant B as Banco (enviar_sinal_de_video)
    participant R as receptor (/obs/camera)
    R->>B: pronto (a cada 10 s sem vídeo)
    U->>E: toque (ligarPeloToque)
    E->>N: camera.ligar() → getUserMedia
    N-->>E: faixa (opaca)
    E->>N: conexao.oferecer(faixa) (espera o ICE, até 3 s)
    N-->>E: SDP da oferta
    E->>E: conferirSdp (fora da regra → sinal_grande, nada enviado)
    E->>B: oferta {sessao nova, sdp}
    B->>R: video:<uid do obs_camera> {oferta, remetente}
    R->>N: conexao.responder(sdp) (recvonly)
    N-->>R: SDP da resposta
    R->>B: resposta {mesma sessao, sdp}
    B->>E: video:<uid da câmera> {resposta, remetente}
    E->>N: aceitarResposta (só a primeira da sessão)
    N-->>R: fluxo (evento track: guardado, ainda não vai à tela)
    N-->>E: conectado
    N-->>R: conectado → aoVideo(fluxo): a tela mostra só o vídeo
    N-->>R: caiu / falhou → aoVideo(null): a Fonte fica vazia
```

Estados do vídeo (`EstadoDoVideo`), em ordem de precedência no emissor (o receptor usa os marcados com R):

| Estado | Quando | Lado |
|---|---|---|
| `sem_permissao`, `sem_camera`, `inseguro` | a câmera recusou; só um novo toque tenta de novo | câmera |
| `aguardando_toque` | antes do toque, ou depois de uma falha `outro` da câmera | câmera |
| `aguardando_episodio` | sem episódio ativo: câmera desligada, conexão fechada | câmera, R |
| `sinal_grande` | o próprio SDP fora da regra: nada enviado, câmera desligada, sem tentativa sozinha | câmera, R |
| `conectado` | a conexão em `conectado` | câmera, R |
| `sem_conexao_direta` | duas falhas seguidas depois de resposta aceita (ou respondida, no receptor); segue tentando a cada 30 s | câmera, R |
| `aguardando_par` | `sem_par`, 15 s sem resposta, ou o par encerrou (câmera); nenhuma oferta (receptor) | câmera, R |
| `conectando` | o resto: oferta montada ou enviada, resposta aceita, queda breve, espera crescente | câmera, R |

Vídeo no receptor (D3, D8): o fluxo do evento `track` fica guardado e só vai à tela (`aoVideo(fluxo)`) com a conexão em `conectado`; ao sair de `conectado` (`caiu`, `conectando`, `falhou`, fechamento) sai `aoVideo(null)`, e o mesmo fluxo volta com o `conectado`.

Regras de tempo do emissor (D6): `caiu` → 5 s de espera e, se não voltar, oferta nova na hora (sem espera crescente); `falhou`, 15 s sem resposta, 20 s sem `conectado` depois da resposta, `sem_par` e `limite` → nova oferta depois de 2, 4, 8, 16, 30, 30… s (zera no `conectado`); só `falhou` e o prazo da conexão depois de resposta aceita contam para `sem_conexao_direta`. O `pronto` só gera oferta sem sessão pendente e fora da espera. Cada ouvinte de porta passa pelo `agendar` com 0 ms (`agenda.depois`) e cada prazo tem um agendamento só por motivo.

## Exemplo

```ts
lerSinalDaObs('sinal', { tipo: 'resposta', sessao: '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f', sdp: 'v=0\r\n…', remetente: 'c0ffee00-…', id: 'aaaaaaaa-…' })
// { tipo: 'resposta', sessao: '0b6e2b8a-…', sdp: 'v=0\r\n…' } — objeto novo, sem remetente nem id
lerSinalDaCamera('sinal', { tipo: 'resposta', sessao: '0b6e2b8a-…', sdp: 'v=0\r\n…' }) // null (a câmera não manda resposta)
conferirSdp('v=0\na=x') // 'forma' (v=0 seguido só de \n)
esperaDaTentativa(9) // 30000
```

Para seguir um caso no emissor: `emissor.test.ts`, `emissor-prazo-da-conexao` (resposta aceita, conexão parada em `conectando` por 20 000 ms → falha, nova oferta em 2 000 ms; o segundo prazo vencido → `sem_conexao_direta`).

## Verificação

- `npx vitest run src/domains/captura`: 3 arquivos, 156 testes desde o VER-051, rodada 1 (`emissor.ts` e `receptor.ts` protegem `conexoes.criar()`; `portas.ts` documenta `criar`, `enviar` com a alça fechada e o `ligar` que para o fluxo atual); 154 testes (139 antes da rodada 1 da revisão, 153 antes da rodada 2; mais 5 de `../arquitetura.test.ts`, que cobre esta pasta sem configuração, inclusive `dominio-sem-navegador`).
- TDD: os testes foram escritos antes do código (o primeiro `npx vitest run src/domains` falhou com os módulos inexistentes, o campo `video` recusado e `./captura/emissor.ts` fora do glob).
- 52 sabotagens, uma de cada vez, numa cópia do repositório, com o cache do Vitest desligado e `sha256sum` igual antes e depois: as 16 do brief (17 corridas, com a S7 em duas), 22 a mais na primeira versão, 12 da rodada 1 da revisão e 1 da rodada 2 (X4); todas derrubam o teste citado (tabela no [VER-049](../../../docs/verificacoes/2026-11-27-049-e4-dominio-captura.md)).
- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`. Não há subdiretórios.

## Riscos

- **Só falsos:** o domínio foi provado contra falsos das portas; o comportamento real do `RTCPeerConnection`, do `getUserMedia` e da Wake Lock vem nas Tarefas 3 (adaptadores) e 7 (Chromium real), e no aparelho real só o responsável (D14).
- **Ciclo de tipos entre domínios:** `captura/portas.ts` importa o tipo `EstadoDoCanal` de `aovivo`, e `aovivo/mensagens.ts` importa `lerSituacaoDoVideo` de `captura` (valor). Não há ciclo em tempo de execução (`sinais.ts` não importa `aovivo`), mas mover o leitor da presença para `captura` sem cuidado criaria um. Se a dependência crescer (a E5, com os gestos), mover `EstadoDoCanal` para um núcleo compartilhado de tipos de canal tira o ciclo (sugestão da rodada 1 da revisão).
- **`outro` da câmera:** sem um estado próprio na lista fechada, uma falha `outro` no primeiro toque volta a `aguardando_toque`; ao religar uma faixa perdida (página escondida), o emissor guarda a faixa como perdida, fica sem estado novo e tenta de novo em `voltarAVer`. A tela (Tarefa 4) decide o texto.
- **Piscada no ar numa queda breve do ICE** (re-revisão da rodada 2, N6): `conectado` → `caiu` → `conectado` em menos de 1 s tira o vídeo da Fonte (`aoVideo(null)`) e o põe de volta, uma piscada na transmissão. Segue a D3 ("sem vídeo" é conexão fora de `conectado`) e a D8, e no `disconnected` a mídia em geral já parou (o quadro mostrado seria um congelado). A Tarefa 7 confere o caso no Chromium; manter o último quadro durante uma queda curta exigiria mudar a D3: **pendência para o responsável decidir**.
- **`pronto` com `limite` no receptor:** o próximo `pronto` sai depois de `max(10 s, espera crescente)`, nunca antes do ciclo normal de 10 s (decisão desta tarefa; o brief só exige "depois da espera crescente").
- **`sem_conexao_direta` no receptor:** contado pelas falhas que o `obs_camera` vê (`falhou` depois de responder, ou oferta nova sem a anterior ter conectado); a câmera pode chegar ao estado antes ou depois dele. A resposta conta como dada antes de o `enviar` terminar, então uma resposta que se perdeu no caminho (a câmera nunca a recebeu e oferece de novo) também conta como falha e pode adiantar o selo.
- Não verificado: a composição nas rotas (Tarefas 4 e 5), a presença coalescida a cada 10 s (`PRESENCA_MINIMA_MS` só é declarada aqui; quem a usa é `useDispositivo`, Tarefa 4).
