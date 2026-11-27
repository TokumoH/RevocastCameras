# E4 — Celular como câmera: plano de implementação

> **Para agentes:** execute tarefa por tarefa (superpowers:executing-plans ou superpowers:subagent-driven-development), **sempre sob as regras do `CLAUDE.md`, que prevalecem sobre as dessas skills**, com as decisões vigentes do responsável abaixo: trabalhar direto na `branchTrabalho`, sem worktree e sem criar branch; subagentes implementam e verificam, mas **não** fazem commit, push, merge nem PR e param antes do passo de commit; quem faz o commit local (versão limpa) é o agente principal (`CLAUDE.md`, desde o VER-013), e o push de cada item verificado segue a autorização permanente da decisão (b); `finishing-a-development-branch` não é usada. Os passos usam caixas (`- [ ]`) para acompanhamento.

| Campo | Valor |
|---|---|
| Id | PLA-005 |
| Etapa | E4 do DES-001 |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status | em execução, autonomia concedida pelo responsável em 2026-11-26 |

**Objetivo:** o **celular como câmera**. O `/camera`, pareado pelo QR da E3, vira uma **tela preta** com um ponto discreto: um toque liga a câmera traseira (só vídeo, sem áudio), a tela fica ligada pelo Wake Lock (ou a página ensina a configurar o aparelho), e o vídeo vai por **WebRTC direto** (STUN público, sem servidor de mídia) até o `/obs/camera`, numa Fonte de navegador do OBS, que mostra **só o vídeo**, em tela cheia e com fundo transparente. A sinalização (oferta e resposta com os candidatos ICE) sai por uma **função do banco** que confere a sessão a cada chamada, põe o remetente no servidor e publica com `realtime.send` no tópico **da sessão atual do par** (`video:<uid>`), em que nenhum cliente envia; os tópicos só abrem com episódio ativo. A revogação ou a troca de aparelho corta a sinalização da sessão antiga na hora (no banco) e fecha o `RTCPeerConnection` dos dois lados. Quando a conexão direta falha (NAT simétrico, rede móvel, Wi-Fi com isolamento de clientes), a câmera, o `/obs/camera` (pelo selo) e a aba Ao vivo avisam o que fazer. No banco, uma migração nova cria `enviar_sinal_de_video`, reescreve `pode_usar_canal` (recepção do tópico da própria sessão; envio de ninguém) e aceita no máximo um `obs_camera` não revogado no banco.

**Arquitetura:** DDD + GRASP Pure Fabrication + Componentes (DES-001 §6). Nasce `src/domains/captura/` (contexto **Captura** do DES-001 §6: sinais de vídeo com validação, portas de câmera, conexão, tela ligada e canal de vídeo, e as duas máquinas de estado — o **emissor**, no celular, e o **receptor**, no OBS — que só conhecem portas). As fabricações puras ficam em `src/shared/infra/`: `conexaoWebrtc.ts` (a `ConexaoDeVideo` do DES-001 §6.1 sobre `RTCPeerConnection`), `cameraNavegador.ts` (`getUserMedia` e o `ManterTelaLigada` do DES-001 §6.1 sobre a Wake Lock API) e o `canalSupabase.ts` ganha o tópico de vídeo (só recepção) com o envio pela `rpc('enviar_sinal_de_video')` (a `SinalizacaoWebRTC` do DES-001 §6.1 é o emissor/receptor do domínio sobre esse canal). A guarda de saída do OBS (VER-046) sai do `PalcoNoAr.tsx` para `src/domains/obs/saida.ts` e para a casca `TelaDeDispositivo.tsx`, usada pelo palco e pelo `/obs/camera`. Telas em `src/app/telas/` (`CameraNoAr.tsx`, `ObsCameraNoAr.tsx`). Testes: domínio puro com falsos das portas; adaptadores com `RTCPeerConnection`, `navigator.mediaDevices`, `navigator.wakeLock` e canal falsos; banco em PGlite com a simulação do Realtime; conferência final no Chromium com `RTCPeerConnection` **real** entre duas páginas e câmera falsa.

**Tecnologias:** React 19.3.1, `@supabase/supabase-js` 2.119.0 (`realtime-js` 2.119.0), Vitest 5.1.0, jsdom 31.0.1, `@testing-library/react` 16.3.3, `@electric-sql/pglite` 0.5.16, TypeScript 7.0.2 (`lib: ["ES2023", "DOM"]`: os tipos de `RTCPeerConnection`, `MediaStream` e `WakeLockSentinel` já vêm do `lib.dom`). APIs nativas do navegador: `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`, `navigator.wakeLock`, `navigator.getBattery` (onde existir). **Nenhuma dependência nova** (D11). Conferência com o Playwright 1.63 do ambiente (`/opt/node22/bin/playwright`, navegadores em `/opt/pw-browsers`, Chromium 153), fora do repositório, como na E3.

**Desenho:** [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md), seções 3, 4.1, 4.2, 5–10, 12, 13, 15 e 16. **Planos anteriores:** [PLA-004](2026-11-27-e3-ao-vivo-por-toque.md) ("Ao fim da E3": `/camera` com tela preta e vídeo até `/obs/camera`, o tópico de vídeo, `definir_reconhecimento`; D6, D8, D14–D16). **Registros que mudam este plano em relação ao PLA-004:** [VER-046](../verificacoes/2026-11-27-046-e3-correcoes-revisao-final.md) (a autorização do Realtime não vê o `event` e guarda a permissão de escrita por conexão; guarda de saída do OBS) e [VER-047](../verificacoes/2026-11-27-047-e3-estado-em-topico-proprio.md) (papéis separados por tópico; um palco ativo; mudança da D6).

## Decisões vigentes do responsável

- **(a) 2026-11-22:** "Se a gravidade de erros for aceitável, prossiga sem necessidade de refazer dois testes seguidos." Aplicação: achado de texto, documentação, nit ou teste a mais, **sem** tocar segurança, **sem** mudar comportamento de código e **sem** enfraquecer teste → corrigir + reconferência pontual (testes, typecheck ou checagem do que foi tocado), registrada; qualquer outro achado → corrigir e verificar de novo, até duas rodadas seguidas sem erro.
- **(b) 2026-11-26:** "Seja autonomo, pode seguir e me entregar o projeto completo." Dada pelo responsável **em resposta ao pedido de push** e registrada no VER-014. Aplicação:
  - o agente principal segue sem pedir aprovação a cada tarefa;
  - a frase vale como **autorização explícita e permanente para o push de cada item verificado da entrega E1–E6** (`git push origin branchTrabalho`), no lugar do pedido de autorização a cada push que a seção "Branch e Git" do `CLAUDE.md` exige;
  - cada push continua informando o estado: a lista dos commits enviados, em ordem, com hash e resumo, os refeitos e as correções simples que foram junto;
  - o `CLAUDE.md` **não é editado**; se o responsável revogar a autorização, volta a regra do `CLAUDE.md` (pedido de autorização a cada push);
  - continuam proibidos sem pedido explícito do responsável: criar, renomear ou apagar branch; merge; PR; trazer conteúdo de outra branch ou do remoto; descartar trabalho (commit, stash ou alteração não commitada); reescrever commit enviado; fundir commits de itens diferentes.
- **(c) 2026-11-26 ("Resolve"):** dependência npm nova só pelo procedimento do npm 11 descrito em "Restrições globais" (registrado no PLA-002, restrição "Dependência npm nova").
- **Sem serviço pago e sem cartão** (DES-001 §2, antiobjetivos; reafirmado pelo responsável para a E4): STUN público gratuito; nenhum TURN pago; nenhum servidor de mídia próprio (D9).

**Aguardam o responsável (não bloqueiam a E4):** a **mudança de desenho da sinalização** (D2, revisão 1, C1: função `enviar_sinal_de_video` com `realtime.send` e tópico por sessão, no lugar do Broadcast em `episodio:<id>:video`; uma função nova; SDPs gravados de 72 h a 4 dias em `realtime.messages`), decidida pelo controlador sob a decisão (b) e oferecida no Passo 4 da Tarefa 7; as decisões D1–D16 do PLA-004 e os ajustes do DES-001 que elas sugerem, oferecidos no Passo 3 da Tarefa 10 do PLA-004 (VER-044); a **mudança da D6** registrada no VER-047 (tópico `episodio:<ativo>:estado`, o `obs_palco` sem envio em `:controle`, um `obs_palco` não revogado); as pendências anteriores (D7 do PLA-002 e Passo 3 da Tarefa 8 do PLA-003). Nenhum código da E4 depende de uma resposta diferente da que já está no código. As decisões D1–D14 deste plano entram na mesma lista no fim da etapa (Tarefa 7, Passo 4).

## Restrições globais

Revistas uma a uma a partir do PLA-004; as que mudaram dizem desde quando.

- Nenhum serviço com cartão; nenhum custo mensal (DES-001 §2). **Realtime do plano Free** (conferido em 2026-11-27 em `supabase.com/docs/guides/realtime/limits`, tabela "Limits by plan"): 200 conexões simultâneas, 100 mensagens por segundo, 100 entradas em canal por segundo, 100 canais por conexão, *payload* de Broadcast até 256 KB, presença: 20 mensagens por segundo e **5 chamadas por cliente a cada 30 s**. A E4 manda poucas mensagens: uma oferta e uma resposta por sessão de vídeo (D4), um `pronto` a cada 10 s só enquanto o vídeo não conecta, tentativas com espera crescente (D6) e a presença com a situação do vídeo no máximo a cada 10 s (D13). Canais por cliente: 2 na câmera e no `obs_camera` (`estudio` e o tópico de vídeo da própria sessão, D2); cada sinal é também uma chamada `rpc` e uma linha em `realtime.messages`.
- Banco normalizado; RLS em todas as tabelas; papéis do app conferidos dentro do banco por `papel_atual()` e `dispositivo_atual()` (DES-001 §8). **A interface nunca decide acesso a dado nem a canal**: quem nega é a RLS (no Realtime, as duas políticas de `realtime.messages`, que só chamam `public.pode_usar_canal`).
- `papel_atual()` só aceita sessão **não anônima**, provedor `google` e `email_confirmed_at` não nulo. `dispositivo_atual()` só vale para sessão **anônima**, dispositivo não revogado e `usuario_anonimo_id = auth.uid()`.
- **Privilégios (desde o VER-010/VER-011, com a D7 do PLA-004):** sem mudança na E4. Nenhum `grant` novo; nenhuma tabela nova.
- **Funções (desde o VER-011):** `SECURITY DEFINER`, `set search_path = ''`, `EXECUTE` só para `authenticated`, corpo que chama `papel_atual()` ou `dispositivo_atual()`; funções do Postgres com `pg_catalog.` quando o nome não é palavra-chave. **A E4 cria uma função** (revisão 1, C1; D2): `public.enviar_sinal_de_video(text, uuid, text)`, que chama `dispositivo_atual()` e publica com `realtime.send` (sem exceção nova nas checagens; se alguma regra acusar a chamada a `realtime.send`, a mudança aceita só essa chamada dessa função, Tarefa 2, Passo 1); e reescreve `public.pode_usar_canal(text, text, boolean)` por `create or replace` (mesmo oid; as políticas e as regras de `data-api:check` e `rpc:grants-check` ficam iguais, como no VER-047). `definir_reconhecimento` fica para a E5 (D12).
- **Migrações:** migração já aplicada **nunca é editada**, nem de passagem numa sabotagem (sabotagens em memória, pelo laço de `banco.ts`, ou numa cópia do repositório, como no VER-047); mudança de banco = migração nova em `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql` (data e hora do commit da tarefa, depois de `20261127220000`), testada em PGlite, com `rpc:grants-check` e `data-api:check` passando, e acrescentada ao passo do responsável. **A E4 tem uma migração nova**, `<AAAAMMDDHHMMSS>_video_da_camera.sql` (Tarefa 2).
- **Realtime (D6 do PLA-004, revista no VER-047, ampliada aqui na D2):** só canais **privados**; **papéis separados por tópico, nunca por evento** (a autorização vê só o tópico e a extensão, e a resposta de escrita fica guardada por conexão até o token novo: VER-046, "Era proposital?"). **Desde a E4 (D2): onde a permissão guardada por conexão daria poder a uma sessão antiga, o envio sai por função do banco** (conferência a cada chamada, remetente posto pelo servidor, `realtime.send`) e o tópico de recebimento é o da sessão atual; nos tópicos de vídeo ninguém envia pelo Broadcast. Toda mensagem recebida é **validada** no domínio antes de qualquer efeito, e o leitor de cada lado aceita só os sinais do outro lado. Todo cliente que recebe a `revogacao` de um par fecha o `RTCPeerConnection` com ele e descarta os sinais dele por 15 min (DES-001 §8; defesa em profundidade). Tópicos parecidos (sufixo, subtópico, maiúsculas, espaço no fim, uuid em maiúsculas) são negados e têm coluna na matriz.
- **Mídia nunca passa pelo Supabase:** o vídeo vai direto entre os dois navegadores (DTLS-SRTP, DES-001 §8 "Vídeo"); pelo Realtime só vão os sinais (SDP com candidatos, uuid de sessão, remetente). Nenhum servidor de mídia nem TURN pago (D9). O SDP leva IPs de rede (os locais escondidos por mDNS quando o navegador esconde, e o público vindo do STUN): não é dado de pessoa; **fica gravado em `realtime.messages` de 72 h a 4 dias** pelo `realtime.send` (revisão 1, C1; F18; custo registrado na D2) e **nunca** vai para `console`, armazenamento, presença ou registro do app (D4).
- **Câmera só com consentimento visível (D7):** a câmera nunca liga sem um toque na própria página; desliga (faixas paradas, luz da câmera apagada) sem episódio ativo, na revogação, ao sair da página e ao parar; a imagem nunca aparece no celular fora da prévia pedida pelo botão, que some sozinha.
- **O que vai ao ar (D10, mesma lição da D16 do PLA-004 e do VER-046, I1):** o `/obs/camera` não mostra **nada** além do vídeo, em nenhum estado pareado; o selo de situação só pela tecla `s`, por 5 s, e nunca com a saída no ar ou com o status desconhecido; as telas de pareamento e de erro só aparecem com a saída parada e o status conhecido, pela mesma guarda do palco (`criarGuardaDaSaida`).
- **Tempo-limite:** o `fetch` com 15 s continua só em `/rest/v1/` e `/auth/v1/` (VER-021); inclusive a `rpc('enviar_sinal_de_video')`; o Realtime e o WebRTC têm os próprios tempos (D6: `ESPERA_DO_ICE_MS`, `ESPERA_DA_RESPOSTA_MS`, `ESPERA_DA_QUEDA_MS`, `ESPERA_DA_CONEXAO_MS`; `ESPERA_DA_CAMERA_MS` para um `getUserMedia` que nunca responde).
- **Rotas e clientes (desde a E3, mantida):** rotas por caminho; o fragmento das rotas de dispositivo é do código de pareamento; cada rota de dispositivo cria só o seu cliente (`revocast-auth-camera`, `revocast-auth-obs_camera`), preguiçoso e uma vez por página.
- **Variáveis públicas (atualizada; desde a E4):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e as opcionais do DES-001 §13, `VITE_TURN_URL`, `VITE_TURN_USUARIO`, `VITE_TURN_SENHA`, que `lerConfiguracao` já lê (`src/shared/infra/configuracao.ts`) e que passam a entrar em `ambienteDoVite` (Tarefa 3). Sem elas, só STUN (D9). Nenhuma credencial real em arquivo versionado (`.env.example` continua vazio).
- **Dependência npm nova (decisão (c)):** só quando a etapa precisar dela de verdade; **a E4 não precisa de nenhuma** (D11). Procedimento, se um dia precisar: npm 11 via `npx -y npm@11` (11.21.2), nunca o npm 10.9.9 local: (1) versão exata, `--save-exact --ignore-scripts --before=<data com pelo menos 2 semanas antes>`; (2) conferir o diff do `package-lock.json` (só o pacote muda; os campos `libc` continuam); (3) `check-deps-audit` com 0 erros; (4) justificar no registro. `npm ci` e `npm install` direto com o npm 10 continuam proibidos. O Playwright do ambiente serve só para a conferência (Tarefa 7) e não vira dependência.
- **Testes sem projeto Supabase real, sem OBS real e sem câmera real:** jsdom não tem `RTCPeerConnection`, `MediaStream`, `getUserMedia` nem Wake Lock, então domínio e telas usam falsos das portas (`servicosFalsos.ts`), e os adaptadores, falsos injetados das APIs do navegador que imitam o que muda o comportamento (`connectionState` em `connecting` → `connected` → `disconnected`/`failed`; `icegatheringstate` que não completa; `getUserMedia` que rejeita com `NotAllowedError`/`NotFoundError`/`OverconstrainedError` ou nunca responde; faixa que termina; `wakeLock` ausente, recusado e liberado ao esconder). Banco em PGlite, com `realtime.send` copiado da fonte na simulação (Tarefa 2; a entrega pelo servidor do Realtime não é simulada: os testes leem a linha gravada em `realtime.messages`, que é o que o servidor replica). O que só o navegador real prova vai à Tarefa 7 (Chromium com `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`); o que só o aparelho real prova fica no passo do responsável (tabela "O que se prova onde", D14).
- Todo arquivo de teste importa `describe`, `test`, `expect` (e o que mais usar) de `vitest`, sem `globals`; testes de tela com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)`.
- **Segurança de interface:** nada de `innerHTML` nem `dangerouslySetInnerHTML`; o vídeo recebe o fluxo por `ref` (`video.srcObject`), nunca por URL; nunca mostrar mensagem de erro do navegador, do servidor ou do WebRTC (só frases fixas por motivo); nunca registrar token, sessão, código de pareamento, SDP, candidato ICE ou credencial TURN em `console`.
- O ouvinte de `onAuthStateChange` e os ouvintes do canal nunca chamam o Supabase dentro do callback (E1, E3); o mesmo vale para os eventos do `RTCPeerConnection`: o adaptador só agenda (`setTimeout(..., 0)`) o que o domínio faz depois.
- Redirect URLs do Supabase sem curinga de host (E1, mantida).
- Visual: tokens do RevoCast, claro e escuro; estilos novos em `src/shared/styles/base.css`, só com as variáveis de `tokens.css` (o preto da tela da câmera e o transparente do `/obs/camera` são exceções declaradas, como o fundo do palco); nada estoura em 320 px; o `/camera` é mobile-first (alvo de toque de pelo menos 44 px, nada que dependa de `hover`).
- `erasableSyntaxOnly` ligado: sem propriedades de parâmetro no construtor, sem `enum`, sem `namespace`; `import type` para tipos (`verbatimModuleSyntax`).
- **Dupla verificação do `CLAUDE.md` em toda tarefa**, antes do commit, com a decisão (a): rodadas de revisão independente sobre a mudança da tarefa (por outra abordagem que não o `npm run check`) até duas seguidas sem erro; sugestões importantes dos revisores entram; o resultado de cada rodada vai para a seção "Verificação" do registro. **Toda sabotagem citada como prova é executada e o teste que ela derruba é anotado no registro**; sabotagem que não derruba nada é achado. Sabotagens numa cópia do repositório com `sha256sum` igual antes e depois (método do VER-047).
- Processo do repositório: todo diretório novo com `README.md` de 11 seções no mesmo commit; README atualizado no commit que mexe nos arquivos da pasta ("Onde" e campo "Arquivos"); todo commit com registro em `docs/verificacoes/`; `npm run check` com 0 erros sobre exatamente o conteúdo do commit; commit pelo agente principal e push pela decisão (b); branch `branchTrabalho`.
- Nenhum e-mail real ou segredo em arquivo versionado; e-mails de teste no domínio reservado `revocast.test`; nenhum nome de pessoa real; credencial TURN nos testes só como texto fixo de teste (`'usuario-de-teste'`, `'senha-de-teste'`); SDP dos testes montado no próprio teste, sem IP real (`192.0.2.x`, faixa de documentação da RFC 5737).
- **Âncoras de registros antigos:** nenhum arquivo citado por elas pode ficar menor do que a âncora aponta (o `check-docs` confere). Mínimos levantados em 2026-11-27 (depois do VER-047) dos arquivos que a E4 pode tocar: `CLAUDE.md` 133, `docs/verificacoes/README.md` 93 (do PLA-004; nenhuma âncora de linha achada nesta leitura), `docs/planos/README.md` 68, `docs/desenho/README.md` 68, o DES-001 394, o PLA-004 880, `index.html` 19, `package.json` 36, `package-lock.json` 1420, `scripts/README.md` 103, `scripts/_catalogo.mjs` 724, `scripts/check-data-api.mjs` 291, `scripts/check-rpc-grants.mjs` 102, `scripts/tests/README.md` 63, `scripts/tests/check-data-api.test.mjs` 1459, `src/README.md` 47, `src/domains/README.md` 79, `src/domains/arquitetura.test.ts` 63, `src/domains/acesso/README.md` 157, `src/domains/acesso/dispositivos.ts` 171, `src/domains/acesso/dispositivos.test.ts` 324, `src/domains/aovivo/README.md` 114, `src/domains/aovivo/mensagens.ts` 307, `src/domains/aovivo/mensagens.test.ts` 323, `src/domains/aovivo/portas.ts` 95, `src/domains/obs/portas.ts` 83, `src/domains/obs/executor.ts` 186, `src/app/App.tsx` 35, `src/app/App.test.tsx` 136, `src/app/dependencias.ts` 87, `src/app/servicos.ts` 149, `src/app/servicos.test.ts` 189, `src/app/servicosFalsos.ts` 773, `src/app/useDispositivo.ts` 217, `src/app/telas/README.md` 62, `src/app/telas/Camera.tsx` 11, `src/app/telas/ObsCamera.tsx` 11, `src/app/telas/TelaDeDispositivo.tsx` 124, `src/app/telas/TelaDeDispositivo.test.tsx` 261, `src/app/telas/PalcoNoAr.tsx` **610**, `src/app/telas/PalcoNoAr.test.tsx` 1065, `src/app/telas/AbaAoVivo.tsx` 952, `src/app/telas/AbaAoVivo.test.tsx` 1136, `src/shared/README.md` 14, `src/shared/infra/README.md` 95, `src/shared/infra/canalSupabase.ts` 363, `src/shared/infra/canalSupabase.test.ts` 659, `src/shared/infra/configuracao.ts` 58, `src/shared/infra/configuracao.test.ts` 104, `src/shared/infra/realtimeContrato.test.ts` 260, `src/shared/infra/realtimeFalso.ts` 224, `src/shared/styles/base.css` 473, `src/shared/styles/tokens.css` 40, `supabase/README.md` 223, `supabase/migrations/README.md` 93, `supabase/tests/README.md` 113, `supabase/tests/banco.ts` 271, `supabase/tests/rls.test.ts` 2210, `supabase/tests/matriz.test.ts` 444, `supabase/tests/restricoes.test.ts` 301, `supabase/tests/simulacao-supabase.sql` 311, `supabase/tests/dono-migracao.sql` 92, as seis migrações existentes (nunca editadas); e este plano, a partir do commit que o introduz, o tamanho com que entrar. **Atenção na Tarefa 5:** a guarda sai do `PalcoNoAr.tsx` (721 linhas hoje; as linhas 70–162 saem, cerca de 93, e sobra perto de 629, acima de 610; revisão 1, N2) e a `CameraPareada` sai do `TelaDeDispositivo.tsx` (133 hoje; o lugar dela é ocupado pela `SoComSaidaParada`, que entra no mesmo arquivo; o resultado fica perto de 145 e não pode ficar abaixo de 124). Antes de encolher qualquer arquivo, conferir com o `check-docs`.
- Datas nos nomes dos registros e da migração: a data do commit (se a execução cair em outro dia, o nome acompanha).

## Fontes das premissas

Cada premissa de biblioteca, de serviço ou de navegador tem fonte; a coluna "Situação" diz o que já foi conferido e o que **só o responsável** pode confirmar (num aparelho, num OBS ou num projeto Supabase reais). Nenhum dado do projeto foi enviado às fontes (leitura de páginas públicas).

| # | Premissa | Fonte | Situação |
|---|---|---|---|
| F1 | Limites do Realtime Free (tabela da restrição acima) | `supabase.com/docs/guides/realtime/limits`, lida em 2026-11-27 | conferida na documentação; o comportamento num projeto real, só o responsável |
| F2 | A autorização do canal privado vê só o tópico e a extensão (sem `event`), e a resposta de escrita fica guardada por conexão até o token novo | `github.com/supabase/realtime` commit 9a2cfba (`authorization.ex:26`, `:504-507`; `broadcast_handler.ex:269-282`, `:310-325`), lida no VER-046 | conferida na fonte; base da D2 |
| F3 | Receber (broadcast e presença) é o que deixa um cliente entrar no canal; a presença ligada no cliente pede leitura de presença | VER-047 (`:estado` com `rb rp`) e `canalSupabase.ts` (presença configurada em todo canal) | conferida pelo VER-047 na simulação; a Tarefa 3 confere de novo no `realtimeContrato.test.ts` |
| F4 | `realtime-js` 2.119.0: um canal por tópico por cliente; `on('presence')` antes do `subscribe()`; `leave` fecha na hora | `node_modules/@supabase/realtime-js` (VER-038, `realtimeContrato.test.ts`) | conferida na fonte instalada |
| F5 | `getUserMedia` só em contexto seguro (`navigator.mediaDevices` indefinido fora dele); erros `NotAllowedError`, `NotFoundError`, `OverconstrainedError`, `SecurityError`; a promessa pode **nunca** resolver; `facingMode: 'environment'` é preferência | MDN, "MediaDevices: getUserMedia()", lida em 2026-11-27 | conferida na documentação; o comportamento no iPhone e no Android, só o responsável |
| F6 | Se o `getUserMedia` exige gesto do usuário no Safari do iPhone | MDN não diz | **só o responsável**; o plano pede o toque de qualquer jeito (D7), então a resposta não muda o código |
| F7 | Wake Lock: só em contexto seguro, liberado sozinho quando a página fica escondida, pedido de novo no `visibilitychange`; Safari do iPhone a partir do iOS 16.4 | MDN, "Screen Wake Lock API", lida em 2026-11-27; DES-001 §3 | contexto seguro e liberação conferidos na documentação; versão do iOS e a necessidade de gesto, **só o responsável** |
| F8 | `RTCRtpSender.replaceTrack` troca a faixa sem renegociar, salvo mudança fora do negociado (`InvalidModificationError`) | MDN, "RTCRtpSender: replaceTrack()", lida em 2026-11-27 | conferida na documentação; a Tarefa 7 confere no Chromium; o iPhone, só o responsável |
| F9 | Níveis do `obs-browser` (0 NONE … 5 ALL); `getStatus` exige READ_OBS; eventos de saída (`obsVirtualcamStarted`/`Stopped` sem `Starting`) | `README` do `obsproject/obs-browser`, lido em 2026-11-27 (e na E3, VER-039) | conferida; o nível **padrão** de uma Fonte nova o README não diz: o guia manda escolher (Tarefa 7, Passo 5) |
| F10 | A Fonte de navegador do OBS 30.2+ tem `RTCPeerConnection` e toca vídeo recebido | DES-001 §15 | sem fonte instalada; **só o responsável** (Windows e, se possível, macOS e Linux) |
| F11 | Metered Open Relay: TURN gratuito, cadastro com conta grátis, 20 GB por mês; a página não fala em cartão | `metered.ca/tools/openrelay`, lida em 2026-11-27 | conferida na página; que o cadastro não peça cartão, **só o responsável**, ao criar a conta (D9) |
| F12 | Com permissão de câmera, o Chromium expõe nos candidatos o IP local real; sem ela, o esconde por mDNS (`.local`) | comportamento conhecido do Chromium (rascunho IETF "mdns-ice-candidates") | a Tarefa 7 confere no Chromium 153 (registrar o tipo dos candidatos vistos); no CEF do OBS e no iPhone, só o responsável |
| F13 | O Chromium 153 bloqueia `ws://127.0.0.1` a partir de `https` pela verificação de acesso à rede local | VER-044 | se a mesma verificação afeta o WebRTC na rede local: a Tarefa 7 registra o que der para medir; no CEF do OBS, só o responsável |
| F14 | Wi-Fi com isolamento de clientes (comum em redes de faculdade) impede a conexão direta entre aparelhos da mesma rede | DES-001 §15 ("Rede da faculdade bloquear WebRTC") | **só o responsável**, na rede real (reserva do DES-001 §15: roteador ou hotspot do computador) |
| F15 | `realtime.send(payload jsonb, event text, topic text, private boolean default true)`: plpgsql **sem** `SECURITY DEFINER` (roda com o papel de quem chama), acrescenta `id` ao payload, faz `SET LOCAL realtime.topic` e grava em `realtime.messages` com `extension = 'broadcast'`; dono `supabase_realtime_admin` | `github.com/supabase/realtime`, commit 9a2cfba: `lib/realtime/tenants/repo/migrations/20261107120000_broadcast_send_non_object_payloads.ex` e `20260707120000_restrict_realtime_schema.ex` (linha 48), lidos em 2026-11-27 (revisão 1) | conferida na fonte; a Tarefa 2 copia o corpo para a simulação |
| F16 | `EXECUTE` em todas as funções de `realtime` para `postgres`, `anon`, `authenticated` e `service_role` (um cliente pode chamar `realtime.send` direto, e aí a política de `insert` de `realtime.messages` vale); `SELECT`, `INSERT` e `UPDATE` em `realtime.messages` para `postgres`, `anon`, `authenticated` e `service_role` (a RLS é a única barreira: `insert` só pela política `canal_envia`, que nega `video:*`; `update` sem política nenhuma, então nenhuma linha passa); `SELECT` e `INSERT` com *grant option* para `postgres` | mesmo commit: `20231204144023_set_required_grants.ex` (linha 16), `20241030150047_messages_partitioning.ex` (linhas 89 a 91), `20260914120000_delegate_messages_grants_to_postgres.ex` (linha 13) | conferida na fonte (e na revisão 2, por WebFetch do mesmo commit); por isso ninguém tem envio nos tópicos de vídeo (D2); teste `e4-realtime-send-direto-negado`, com `insert` e `update` diretos |
| F17 | o `postgres` (dono das migrações e das funções `SECURITY DEFINER`, e o papel do editor SQL do Supabase) tem `BYPASSRLS`, mas **não é dono nem membro do dono** de `realtime.messages` (`REVOKE supabase_realtime_admin FROM postgres`) e **não tem `DELETE`** nela (só `SELECT`, `INSERT` e `UPDATE`; revisão 3, I8): o `realtime.send` chamado de dentro da função grava sem passar pela política de `insert` | `github.com/supabase/postgres`, commit cceedbd (`ALTER ROLE postgres ... BYPASSRLS`, já citado em `supabase/tests/dono-migracao.sql`, linha 5); `github.com/supabase/realtime`, commit 9a2cfba, `20260707120000_restrict_realtime_schema.ex` (bloco do `supautils.policy_grants`, linhas 78 a 87) e as concessões da F16 (nenhum `DELETE` para `postgres`) | conferida na fonte; num projeto real, **só o responsável** (a conferência real da Tarefa 7, Passo 6, item 9, mostra o vídeo conectando); na simulação, o mesmo efeito vem da participação do `postgres_sim` no dono de `realtime.messages` (Tarefa 2, sonda) |
| F18 | mensagens gravadas em `realtime.messages` ficam em partições diárias apagadas depois de 3 dias (uma mensagem fica de 72 h a 4 dias); Broadcast a partir do banco por `realtime.send` com `private => true` entregue a quem entrou no canal privado | `supabase.com/docs/guides/realtime/broadcast`, lida em 2026-11-27 (revisão 1) | conferida na documentação; a limpeza num projeto real, só o responsável |
| F19 | `realtime.send` engole qualquer erro como `WARNING 'WarnSendingBroadcastMessage'`; a partição do dia é criada pelos clientes conectados por WebSocket, não pelo `realtime.send` | F15 (corpo da função) e F18 (documentação) | conferida; a função devolve `enviado` sem saber se chegou, e o emissor percebe pela espera (D6) |
| F20 | `realtime.messages` tem o índice `messages_replay_index` `(topic, inserted_at desc, (coalesce(expires_at, 'infinity'::timestamp))) where extension = 'broadcast' and private = true` (e o índice por `topic` da 20240523004032) | `github.com/supabase/realtime`, commit 9a2cfba: `20261022120000_messages_replay_index.ex` e `20240523004032_redefine_authorization_tables.ex` (linha 17), lidos em 2026-11-27 (revisão 2) | conferida na fonte; a contagem do limite repete o predicado do índice e a Tarefa 2 mostra o plano (`e4-limite-usa-o-indice`); o custo num projeto real, só o responsável |
| F21 | tamanho real do SDP: oferta só de vídeo (`sendonly`, `max-bundle`, 1280×720) com 1 candidato, 4 224 caracteres; resposta, 3 925; só ASCII imprimível, começando com `v=0\r\n` | sonda no Chromium 153 do ambiente (`HeadlessChrome/153.0.8010.12`), câmera falsa, em 2026-11-27 (revisão 2), fora do repositório | medida aqui; Safari, CEF do OBS e mais candidatos: Tarefa 7 e **só o responsável** (iPhone) |
| F22 | o leitor da replicação de `realtime.messages` só tem cláusula para `Insert`; os outros eventos (inclusive `Update`) caem no `handle_message(_, state)` que nada faz: **é isso que garante** que um `update` não reenvia mensagem. A publicação é `WITH (publish = 'insert', publish_via_partition_root = true)` com o filtro `(NOT skip_broadcast)` só quando a flag `broadcast_persistence` está ligada; sem a flag, ela publica todos os eventos, e o leitor continua ignorando o que não é `Insert` (revisão 4, N14) | `github.com/supabase/realtime`, commit 9a2cfba, `lib/realtime/tenants/replication_connection.ex` (linhas 414, 481 e 514), lido em 2026-11-27 (revisão 3) | conferida na fonte; num projeto real, **só o responsável** (o guia pede para conferir que nenhum cliente reage à limpeza) |

## Decisões sobre lacunas e divergências do desenho (propostas pelo agente sob a decisão (b); cada uma é registrada no VER da tarefa dona)

**D1. Onde fica cada coisa.** O DES-001 §6 põe "câmera, reconhecimento de gesto, confirmação, envio de vídeo" no contexto **Captura**: nasce `src/domains/captura/` com `sinais.ts` (tópicos, sinais, leitores, situação do vídeo, esperas), `portas.ts` (`CanalDeVideo`, `FabricaDeCanaisDeVideo`, `ConexaoDeVideo`, `FabricaDeConexoes`, `CameraDoAparelho`, `ManterTelaLigada`), `emissor.ts` (lado da câmera) e `receptor.ts` (lado do `obs_camera`). `captura` importa de `aovivo` **só tipos** (`EstadoDoCanal`, `RespostaDoEnvio`), e a lista de revogados chega como função injetada (`revogado(usuario)`), para não depender da classe `Revogados`. As portas usam tipos opacos (`FaixaDeVideo`, `FluxoDeVideo`) em vez de `MediaStreamTrack`/`MediaStream`: o domínio não conhece o navegador (teste novo em `arquitetura.test.ts`, Tarefa 1). O canal de vídeo é implementado pelo mesmo registro de `canalSupabase.ts` (um canal por tópico por cliente, fechado/negado saem do mapa) só para **receber**; o envio é a `rpc('enviar_sinal_de_video')` (D2); a fábrica passa a ter o tipo `FabricaDeCanais & FabricaDeCanaisDeVideo`.

**D2. Sinalização por função do banco e tópico por sessão destinatária (revista na revisão 1, C1; decisão do controlador, opção 1).** O DES-001 §6.1, §8 e §10.3 falam num tópico só, `episodio:<id>:video`, em que a câmera e o `obs_camera` enviam pelo Broadcast. Isso não serve por dois motivos, ambos da F2: (1) a autorização não vê o `event` (o banco não decide quem manda oferta e quem manda resposta); (2) a permissão de envio **e** a de leitura ficam guardadas por conexão até o token novo (até 10 min), e o remetente é declarado pelo próprio cliente (`canalSupabase.ts`, `{ ...corpo, remetente: usuarioId }`). Com isso, mesmo tópicos separados por lado e por câmera (a primeira versão deste plano) deixavam a sessão antiga de um dispositivo trocado ou revogado, que não coopera, **trocar o vídeo no ar** (a câmera antiga manda uma oferta nova) ou **desviar o vídeo do estúdio** (o `obs_camera` antigo continua recebendo as ofertas e responde primeiro), porque o repareamento mantém o mesmo id de dispositivo (revisão 1, C1). Escolha:

- **Ninguém envia pelo Broadcast nos tópicos de vídeo.** Cada sinal sai por uma chamada `rpc('enviar_sinal_de_video', ...)`: função nova `public.enviar_sinal_de_video(p_tipo text, p_sessao uuid, p_sdp text)`, `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` só para `authenticated`, que **a cada chamada** lê `dispositivo_atual()` (uma vez só, `select ... into`), exige câmera ou `obs_camera`, episódio ativo e o par não revogado, confere o tipo do sinal pelo lado (câmera: `oferta`, `encerrar`; `obs_camera`: `pronto`, `resposta`, `encerrar`), a forma da sessão e do SDP (D4), monta o payload **no servidor** (`jsonb_build_object`, com `remetente` = `auth.uid()`; nada do cliente além de tipo, sessão e SDP) e o publica com `realtime.send(payload, 'sinal', <tópico do destinatário>, true)` (F15–F17).
- **Tópico de recebimento por sessão:** `video:<auth.uid() da sessão destinatária>`. O destinatário é lido na hora pela função: para a câmera, o `usuario_anonimo_id` do `obs_camera` não revogado da câmera; para o `obs_camera`, o `usuario_anonimo_id` da câmera do seu `camera_id`. Sem par pareado → a função devolve `sem_par` e não publica nada.
- **Quem entra em cada tópico** (`pode_usar_canal`): `video:<uid>` só recebe (`broadcast` e `presence`, F3) a própria sessão (`uid = auth.uid()`), e só se ela for câmera ou `obs_camera` não revogado, com episódio ativo e com a câmera (a própria ou a do `camera_id`) existente e não revogada. **Envio (`broadcast` e `presence`) nos tópicos de vídeo: ninguém** (isso nega também um `realtime.send` chamado direto pelo cliente, que roda com o papel `authenticated` e passa pela política de `insert`; F16).

| Tópico | Receber (`broadcast` e `presence`) | Enviar | Quem publica |
|---|---|---|---|
| `video:<uid da sessão da câmera>` | só a sessão da câmera, com episódio ativo e câmera não revogada | ninguém | `enviar_sinal_de_video` chamada pelo `obs_camera` da câmera |
| `video:<uid da sessão do obs_camera>` | só a sessão do `obs_camera`, com episódio ativo, ele e a câmera dele não revogados | ninguém | `enviar_sinal_de_video` chamada pela câmera |
| `episodio:<id>:video` (o do desenho), `video:<id de dispositivo>`, `video:<uid de outra sessão>`, tópico parecido, qualquer outro | ninguém | ninguém | — |

O que isso fecha, sessão por sessão:

| Sessão antiga, que não coopera, depois de repareamento ou revogação | Antes (primeira versão) | Agora |
|---|---|---|
| câmera antiga manda oferta | aceita pelo `obs_camera` (escrita guardada por conexão; remetente declarado) | `enviar_sinal_de_video` → `42501` (`dispositivo_atual()` vazio na hora); Broadcast direto negado (ninguém envia) |
| `obs_camera` antigo recebe ofertas | sim, até o token novo | não: as ofertas vão para `video:<uid do obs_camera novo>`; o tópico antigo, em que ele continua inscrito, não recebe mais nada |
| `obs_camera` antigo responde | primeira resposta vencia | `42501` |
| remetente forjado | declarado pelo cliente | posto pelo servidor (`auth.uid()` da chamada) |

Também fica decidido aqui (revisão 3, N11): **no máximo um `obs_camera` não revogado no banco inteiro** (índice único parcial `dispositivos_um_obs_camera_ativo`, como o `dispositivos_um_palco_ativo` do VER-047). O DES-001 §2 põe "várias câmeras simultâneas" entre os não-objetivos ("o modelo de dados já permite; a interface não"), e um `obs_camera` mostra uma câmera só; com um único `obs_camera` ativo há **um único par que sinaliza** (câmera ↔ `obs_camera`): uma câmera sem `obs_camera` recebe `sem_par` e não grava nada. Assim o teto de disco não cresce com o número de câmeras, e o modelo continua aceitando várias câmeras (uma migração futura tira o índice, se o desenho mudar). A aba Ao vivo já reaproveita o `obs_camera` da câmera (`AbaAoVivo.tsx`, `existente(lista, 'obs_camera', ...)`); se houver um `obs_camera` ativo de **outra** câmera, o `23505` vira a frase fixa "Já existe uma câmera do OBS ativa. Revogue-a antes." (Tarefa 6), **defensiva** (revisão 4, N16): pela aba ela só aparece numa corrida (outra pessoa criou um `obs_camera` entre a leitura da lista e o pedido do código), porque a aba reaproveita o `obs_camera` ativo. O caso real é outro: com mais de uma câmera (só pela API), o `obs_camera` ativo pode estar ligado a uma câmera diferente da que a aba usa (`existente(lista, 'camera')`), e o vídeo nunca conecta. Por isso a Tarefa 6 deixa de reaproveitar um `obs_camera` de outra câmera e avisa (teste `obs-camera-de-outra-camera-avisa`). O tópico não leva o episódio: trocar do modo teste para o ao vivo não troca de tópico nem derruba o vídeo (DES-001 §10.3).

**Custos registrados (revisão 1, C1):**
- **Retenção:** o que `realtime.send` publica fica gravado em `realtime.messages` (partições diárias, apagadas depois de 3 dias; uma mensagem fica de 72 h a 4 dias; F18). O SDP leva endereços IP de rede (os locais escondidos por mDNS quando o navegador esconde, o público vindo do STUN). Mitigação: o payload leva só `tipo`, `sessao`, `sdp`, `remetente` (uuid anônimo) e o `id` que o `realtime.send` acrescenta; nada de rótulo, nome, e-mail ou dado de pessoa; `realtime.messages` não é lida por nenhuma política de `select` fora da conferência do canal (as linhas só servem ao Realtime). Os IPs ficam no banco do projeto por até 4 dias.
- **Falha silenciosa:** `realtime.send` engole qualquer erro como `WARNING` (`WarnSendingBroadcastMessage`) e a partição do dia é criada pelos clientes conectados por WebSocket, não pela função (F19). A função devolve `enviado` quando chamou o `realtime.send`; quem descobre que não chegou é o emissor pelas esperas da D6 (sem resposta → tentativa nova).
- **Limites:** cada sinal é uma chamada `rpc` (`/rest/v1/rpc/`, tempo-limite de 15 s do VER-021), uma mensagem do Realtime (100 por segundo no projeto, F1) e **uma linha em `realtime.messages`** guardada até 4 dias, e o limite de mensagens do Realtime não freia o `insert` (revisão 2, I7). Por isso a função tem um **limite por remetente** (`54000`, mensagem fixa `limite de sinais`, nada publicado): no máximo **10 sinais em 10 s**, **600 por hora** e **1 000 000 caracteres de SDP por hora**, contados em `realtime.messages` no tópico do destinatário (o único de cada remetente) pelo índice `messages_replay_index` que o Realtime já cria (F20), sem tabela nova. Pior caso legítimo (D3, D6): a câmera faz no máximo uma oferta a cada 2 s no começo da espera crescente e um `encerrar` (≤ 6 em 10 s); o `obs_camera`, uma resposta por oferta e um `pronto` a cada 10 s (≤ 7 em 10 s); numa hora inteira de falha, cerca de 125 ofertas (≈ 530 000 caracteres de SDP pela medida da F21) e 360 `pronto` + 125 respostas (≈ 485 linhas): os três tetos ficam acima disso. **Custo que sobra** (uma sessão válida em laço, ou um defeito): por sessão, até cerca de 1,2 MB por hora (1 MB de SDP e 600 linhas pequenas), ou cerca de 115 MB nos até 4 dias de retenção. **Teto real de disco** (revisão 3, N11): só duas sessões podem gravar (a câmera do único `obs_camera` ativo e ele), então cerca de **2,4 MB por hora e 230 MB em 4 dias**, abaixo dos 500 MB do banco Free, qualquer que seja o número de câmeras; visível pela consulta do guia, e o SDP das linhas antigas pode ser apagado pelo `update` do guia (Tarefa 7, Passo 6, item 10; revisão 3, I8). Contar e gravar ficam na mesma transação sob `pg_advisory_xact_lock` por remetente (revisão 3, N10), então chamadas paralelas da mesma sessão não passam do teto. Com SDPs reais de 6 a 8 KB (Safari, mais candidatos), uma hora inteira de falha chega ao teto de 1 000 000 caracteres por hora: só atrasa a próxima tentativa (`54000` → espera crescente), sem perder a conexão que já existe (revisão 3, N13). Por câmera, no uso normal, uma oferta a cada 30 s no pior caso (D6) e um `pronto` a cada 10 s só enquanto o vídeo não conecta (D3).
- **Uma função nova** (contraria a primeira versão, "a E4 não cria função"): entra nas checagens como as outras (chama `dispositivo_atual()`; nenhuma exceção nova em `scripts/README.md`).

| Alternativa | Motivo de descarte |
|---|---|
| `episodio:<id>:video` com os dois lados enviando e o tipo de sinal decidindo | a autorização não vê o `event` e guarda a escrita por conexão (F2) |
| Dois tópicos por câmera (`video:<câmera>:camera` e `:obs`), cada lado enviando pelo Broadcast (primeira versão) | a sessão antiga continua enviando e recebendo até o token novo, com remetente declarado: troca ou desvia o vídeo (revisão 1, C1) |
| Geração do pareamento no tópico, por exemplo `video:<câmera>:<uid da câmera>:camera` (sugestão 2 da revisão) | fecha a oferta falsa, mas não o desvio pelo `obs_camera` antigo, porque a câmera não lê a linha do `obs_camera` |
| Aceitar o resíduo com quarentena no receptor (sugestão 3 da revisão) | depende de clientes que cooperam; o desvio pela sessão antiga continuaria possível por até 10 min |
| Tópico de recebimento por dispositivo (não por sessão) | a sessão antiga, já inscrita, continuaria recebendo até o token novo |
| Vídeo sem exigir episódio ativo | câmera ligada fora do programa e do teste (D7) e contra a espera do DES-001 §8 |
| Um `obs_camera` por câmera (revisão 1) | com várias câmeras pareadas por chamada direta à API, o teto de disco cresceria por par (revisão 3, N11) |
| Uma câmera ativa só (índice em `camera`) | também fecharia o teto, mas contraria o "modelo já permite" do DES-001 §2 e quebraria os testes da E3 que criam câmeras genéricas desde o VER-047; o índice em `obs_camera` limita quem sinaliza com menos efeito |
| Teto global por hora para todos os sinais de vídeo, na função | a contagem por `topic like 'video:%'` não usa o índice `(topic, inserted_at)` com colação que não seja `C`, e não há índice só de `inserted_at` (a 20261022120000 o tirou): varredura da partição a cada chamada |
| Tabela própria de contagem por sessão para o limite | mais uma tabela, política, privilégio e limpeza; o índice `messages_replay_index` do Realtime já responde a contagem pelo tópico e pela hora (F20) |
| Limite só no cliente | não freia uma sessão que não coopera (o motivo do C1) |
| Presença nos tópicos de vídeo para saber se o par está lá | 5 chamadas de presença por cliente a cada 30 s (F1) e uma permissão de escrita; o `sem_par` da função e o `pronto` bastam |

O tópico `episodio:<id>:video` continua **fechado** (a coluna `video` da matriz continua vazia); os gestos da E5 ganham caminho próprio na E5 (D12), com a mesma lição.

**D3. Quem oferece e quem responde.** A câmera é **sempre** quem oferece (DES-001 §10.3: "a câmera publica…; `/obs/camera` responde"), com uma faixa de vídeo `sendonly` (O6: só vídeo); o `obs_camera` **só** responde (`recvonly`), e a função recusa o tipo do outro lado (D2). Não há negociação dos dois lados ("perfect negotiation" dispensada): uma oferta por **sessão de vídeo** (uuid novo a cada tentativa), uma resposta por oferta. Como o Broadcast não entrega o que foi publicado antes da entrada, quem chega depois pede: o `obs_camera` manda `pronto` quando o seu tópico conecta e, enquanto a conexão não está `conectado`, a cada `PRONTO_A_CADA_MS = 10_000`; a câmera também oferece sozinha quando o tópico dela conecta. **O emissor só atende um `pronto` (revisão 1, I4)** quando não há sessão pendente (nenhuma oferta aguardando resposta e nenhuma conexão em `conectando` ou `conectado`) e fora de uma espera crescente (D6): um `pronto` que chega durante a espera fica anotado e é atendido no fim dela, com uma oferta só. Assim o `pronto` periódico nunca contorna as esperas nem derruba uma conexão ainda em `conectando`. "Sem vídeo" é sempre "conexão fora de `conectado`" (não o evento `track`). A primeira resposta de uma sessão vale; respostas repetidas ou de sessão antiga são descartadas. O `obs_camera` que recebe uma oferta nova fecha a conexão anterior (a oferta só pode vir da sessão atual da câmera, D2).

**D4. Sinais e tamanhos.** Evento único `sinal` no tópico de cada sessão:

```ts
type SinalDaCamera = { tipo: 'oferta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string }   // a câmera envia (rpc); o obs_camera recebe em video:<seu uid>
type SinalDaObs = { tipo: 'pronto'; sessao: string } | { tipo: 'resposta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string } // o obs_camera envia (rpc); a câmera recebe em video:<seu uid>
// payload recebido: { tipo, sessao, sdp?, remetente, id } — remetente posto pela função; id acrescentado pelo realtime.send
```

ICE **não incremental**: o lado que monta a descrição espera o fim da coleta dos candidatos (`icegatheringstate` = `complete`) ou `ESPERA_DO_ICE_MS = 3000` e manda o SDP com os candidatos que tiver; nada de um sinal por candidato. Motivos: duas chamadas por sessão em vez de dezenas (F1), menos linhas gravadas em `realtime.messages` (D2), um sinal a menos para validar, e o caminho principal (mesma rede Wi-Fi, DES-001 §10.3) tem candidatos locais na hora. Custo: até 3 s a mais para começar quando o STUN demora (Riscos). Validação **duas vezes**: na função (tipo pelo lado, `p_sessao` uuid, `p_sdp` nulo exatamente quando o tipo não leva SDP, a forma abaixo; fora disso `22023`) e, com a mesma regra, no domínio de quem recebe (`lerSinalDaCamera`, `lerSinalDaObs`: objeto novo campo a campo, `sessao` em uuid minúsculo, `sdp` que começa com `v=0\r\n`, só caracteres imprimíveis ASCII, `\r` e `\n`, no máximo `TAMANHO_MAXIMO_DO_SDP = 12_000` caracteres, chaves aceitas `tipo`, `sessao`, `sdp`, `remetente` e `id`; cada leitor aceita só os tipos do lado que envia ao destinatário). Medido no Chromium 153 com câmera falsa (F21; revisão 2, I7): oferta só de vídeo com 1 candidato, 4 224 caracteres; resposta, 3 925; cada candidato a mais soma cerca de 100 a 130. O teto de 12 000 cabe a oferta medida com folga para algumas dezenas de candidatos e codecs a mais (Safari e o CEF do OBS podem oferecer mais perfis: a Tarefa 7 mede de novo e o passo do responsável confere num iPhone; se algum passar, a correção é migração nova); o limite do Broadcast é 256 KB (F1). A função confere **a mesma regra** do leitor (começa com `v=0\r\n`, só ASCII imprimível, `\r` e `\n`, até 12 000; revisão 2, N8). O SDP **nunca** vai para `console`, armazenamento, presença ou registro do app (teste `sdp-nunca-no-console` nas Tarefas 3, 4 e 5); a gravação em `realtime.messages` é a da D2.

**D5. O tópico ligado à sessão, não ao episódio; o vídeo segue o episódio ativo; os canais de vídeo abrem só com episódio (revisão 1, I1).** A câmera e o `obs_camera` chamam `episodioAtivo()` (`RepositorioDoPalco.episodioAtivo`, já disponível nos serviços do dispositivo; `e3-episodio-ativo` prova que a câmera recebe a linha) ao conectar o `estudio`, a cada volta a `conectado`, a cada `episodio_ativo_mudou` e ao voltar a ver a página (`aoVoltarAVer`). **Com episódio ativo**, a rota abre o canal de vídeo (`video:<seu uid>`), e o emissor liga (se já houve o toque) e oferece. **Sem episódio ativo**, a rota não abre o canal de vídeo (o banco negaria a entrada), e o que estiver aberto é fechado: o emissor manda `encerrar` (se ainda há episódio na hora da chamada; senão a função recusa com `55000` e nada é feito), fecha a conexão e desliga a câmera; o receptor fecha e limpa o vídeo. Um `negado` ou `fechado` **do canal de vídeo** leva a uma nova consulta de `episodioAtivo()`: sem episódio, o canal de vídeo fica fechado (sem `canalPerdido`, sem reavaliar o dispositivo, sem laço de 5 s); com episódio, aí sim vale o tratamento do `estudio` (`acompanharEstudio.canalPerdido()`: reavalia o dispositivo e reabre em 5 s ou mostra revogado). O cliente não precisa saber qual é a câmera do `obs_camera` nem quem é o par: a função lê o `camera_id` e o destinatário no banco a cada chamada (D2), então o `DispositivoPareado` não muda (a primeira versão acrescentava `cameraId`; saiu na revisão 1, por não ter mais uso).

**D6. Reconexão, queda e falha da conexão direta.** O adaptador traduz `connectionState` para `conectando`, `conectado`, `caiu` (`disconnected`) e `falhou` (`failed`, inclusive `closed` sem pedido). Regras do emissor (o receptor só reage):
- `caiu`: espera `ESPERA_DA_QUEDA_MS = 5000` (o ICE costuma se recuperar sozinho numa troca breve de Wi-Fi); se não voltar a `conectado`, oferta nova;
- `falhou`, sem resposta em `ESPERA_DA_RESPOSTA_MS = 15_000`, ou **resposta aceita sem chegar a `conectado` em `ESPERA_DA_CONEXAO_MS = 20_000`** (revisão 1, I2: um ICE sem pares pode ficar em `checking` sem nunca ir a `failed`; o prazo vencido conta como uma `falhou`): oferta nova depois de `ESPERAS_DE_RECONEXAO_MS = [2000, 4000, 8000, 16000, 30000]` (depois, 30 s sempre), zeradas a cada `conectado`;
- **sem conexão direta:** `FALHAS_PARA_SEM_CONEXAO_DIRETA = 2` falhas seguidas (`falhou` ou prazo de conexão vencido) **depois de uma resposta aceita** (o par existe, mas o ICE não fecha) levam a situação a `sem_conexao_direta`; o emissor continua tentando a cada 30 s; a câmera mostra na tela (no status do toque e na prévia) "Sem conexão direta com o computador. Ponha o celular e o computador na mesma rede Wi-Fi (sem isolamento de clientes) ou use o roteador ou o hotspot do computador."; a aba Ao vivo mostra a mesma situação pela presença (D13); o selo do `/obs/camera` (tecla `s`) também;
- **SDP próprio fora da regra** (revisão 3, N13): antes de enviar, o emissor e o receptor passam o próprio SDP por `conferirSdp` (a mesma regra da função e do leitor, D4); `grande` ou `forma` → situação fixa `sinal_grande` ("O vídeo deste aparelho gera um sinal grande demais para o canal. Anote o modelo do aparelho e o navegador."), na tela, no selo e na aba pela presença; nada é enviado, a conexão é fechada e **não há nova tentativa sozinha** (o mesmo aparelho geraria o mesmo SDP); um novo toque, um novo episódio ou recarregar a página tentam de novo uma vez. Assim um SDP real maior que o teto (F21) não vira `falhou` → tentativas eternas com `aguardando_par`;
- `enviar` devolvendo `sem_par` (nenhum `obs_camera` pareado para a câmera) → `aguardando_par`, nova tentativa pela espera crescente;
- canal de vídeo voltando a `conectado` depois de `reconectando`, sem vídeo conectado e sem sessão pendente → oferta nova (receptor: `pronto`);
- canal de vídeo `fechado` ou `negado` → a regra da D5 (sem episódio, fica fechado; com episódio, `canalPerdido`).
Nada é reenviado em laço curto: no pior caso, uma oferta a cada 30 s por câmera (o `pronto` não fura a espera, D3).

**D7. Tela preta e consentimento.** O `/camera` pareado tem fundo preto e um ponto discreto (cinza enquanto espera, ciano quando o vídeo está conectado, rosa com problema), sem nenhuma imagem da câmera. Ordem:
1. **Toque para ligar** (gesto do usuário na própria página: `getUserMedia` exige permissão e, no iPhone, pode exigir gesto, F6; o Wake Lock também é pedido aqui, F7). Antes do toque, a tela diz "Toque para ligar a câmera" e a câmera **não** é pedida; recarregar a página volta a pedir o toque (nada de ligar sozinho ao abrir).
2. Ligada e **sem episódio ativo**: faixas paradas (luz apagada), "Aguardando episódio" no status; com episódio ativo de novo, liga sozinha (o consentimento desta página continua valendo); se o navegador recusar (`NotAllowedError`), volta a pedir o toque.
3. Com vídeo: tela preta; **toque** mostra o status por 3 s (`STATUS_VISIVEL_MS = 3000`: situação do vídeo, tela ligada ou não, bateria onde o navegador permitir, DES-001 §9); botão **"Prévia"** mostra a imagem local por até 15 s (`PREVIA_MS = 15_000`) para enquadrar, com "Esconder"; a prévia usa o mesmo fluxo (sem segundo `getUserMedia`) num `<video muted playsinline>`.
4. A câmera desliga ao sair da página (desmontagem e `pagehide`), na revogação e ao parar; `getUserMedia` que não responde em `ESPERA_DA_CAMERA_MS = 30_000` (F5) vira `sem_permissao` com novo toque.
Restrições de captura: `{ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } }` (traseira, DES-001 §3; 720p30 limita bateria e banda) e, depois de negociar, `maxBitrate` de 2,5 Mbit/s no `RTCRtpSender`. Faixa que termina (`ended`) ou fica muda (`mute`) por mais de 3 s → pede a câmera de novo e troca a faixa sem renegociar (`replaceTrack`, F8); se a troca falhar, oferta nova (DES-001 §15: "detectar `mute`/`ended` e pedir a câmera de novo"). Página escondida (troca de app, tela bloqueada): o navegador corta a câmera (DES-001 §3); ao voltar a ver, pede o Wake Lock de novo e, se a faixa terminou, a câmera.

| Alternativa | Motivo de descarte |
|---|---|
| Ligar a câmera sozinha ao abrir a página | câmera ligada sem o usuário saber; o iPhone pode recusar sem gesto (F6) |
| Mostrar a imagem sempre (como um app de câmera) | contra a tela preta do DES-001 (bateria, e a tela fica de costas para as apresentadoras) |
| Câmera ligada também sem episódio ativo | gasta bateria e mantém a câmera ligada fora do programa; o enquadramento é feito no modo teste (DES-001 §10.3) |
| Botão para trocar traseira/frontal | o DES-001 §3 fixa a traseira; fica para depois, se o uso real pedir |

**D8. O `/obs/camera` não mostra nada além do vídeo.** Pareado: um `<video autoplay muted playsinline>` em tela cheia (`object-fit: contain`, fundo transparente), com o fluxo por `ref`, e **só** enquanto há vídeo; sem vídeo, a Fonte fica vazia (transparente), em qualquer estado (aguardando, conectando, sem conexão direta). O selo ("Câmera do OBS · aguardando a câmera", "· sem conexão direta", "Pareado como <rótulo>") só pela tecla `s` no "Interagir", por 5 s, e nunca com a saída no ar ou com o status desconhecido; as telas de pareamento e de erro (`sem_link`, `link_invalido`, revogado...) só com a saída parada e o status conhecido. As duas regras usam a **mesma guarda** do palco (`criarGuardaDaSaida`, VER-046), que por isso sai do `PalcoNoAr.tsx`: a parte pura (`saidaParada`, `RELEITURAS_PARA_LIBERAR`, `criarGuardaDaSaida`) vai para `src/domains/obs/saida.ts` (só depende da porta `ObsNoNavegador`), e a casca React (`SoComSaidaParada`) para `src/app/telas/TelaDeDispositivo.tsx`, junto do `cobrirTela` que a usa (Tarefa 5). A classe do fundo transparente e o `colorScheme = 'light'` entram antes da primeira pintura pelo mesmo `<script>` clássico do `index.html` (N2 do PLA-004; VER-040), agora também para `/obs/camera` (classe `obs-camera`; revisão 1, I5). Consequência para o guia: a Fonte do `/obs/camera` precisa de pelo menos **"Read access to OBS status information"** (READ_OBS) para a guarda ler o `getStatus` (F9); com menos, ela nunca mostra selo nem tela de erro (seguro, mas sem diagnóstico na Fonte; o diagnóstico continua na aba Ao vivo).

**D9. Sem TURN pago; TURN gratuito só se o responsável quiser.** O DES-001 §3, §10.3 e §13 preveem um TURN **opcional** do Metered Open Relay (gratuito, conta grátis, 20 GB/mês; F11), por variável de ambiente; o responsável reafirmou "sem serviço pago, sem cartão". Escolha: o código monta `iceServers` com o STUN público `stun:stun.l.google.com:19302` (DES-001 §10.3) e, **só se as três variáveis existirem** (`lerConfiguracao` já as lê), o servidor TURN delas (`urls` começando com `turn:` ou `turns:`; outra forma é ignorada). Sem elas (o padrão), quando a conexão direta falha vale a D6 (aviso e tentativas), e a reserva é física: mesma rede Wi-Fi sem isolamento, ou roteador/hotspot do computador (DES-001 §15). Nenhum agente cria conta em serviço. A credencial TURN, se usada, é pública por natureza (vai ao navegador; DES-001 §13): quem tiver a URL do app pode gastar a cota de 20 GB (Riscos). Nenhum servidor de mídia próprio (SFU, gravação) em nenhum caso.

| Alternativa | Motivo de descarte |
|---|---|
| Não ler as variáveis TURN | o DES-001 já decidiu o TURN opcional e `lerConfiguracao` já as lê; tirar seria divergir sem ganho |
| TURN de serviço pago ou com cartão (Cloudflare, Twilio...) | antiobjetivo (DES-001 §2) |
| Credencial temporária pedida a uma API do Metered | exigiria chave no navegador (a mesma exposição) ou uma função no servidor (mais uma peça); fica para depois, se a cota for abusada |
| Servidor de mídia próprio (SFU) | custo e servidor ligado; contra o DES-001 §4.3 |

**D10. A mesma lição da guarda de saída para a câmera.** O celular de gravação **não** vai ao ar (é a lente, não a tela), então o `/camera` pode mostrar textos e telas de erro; o que não pode é **vazar imagem** na própria tela (D7). Quem vai ao ar é o `/obs/camera` (D8).

**D11. Nenhuma dependência nova.** `RTCPeerConnection`, `getUserMedia`, Wake Lock e `getBattery` são nativos; a sinalização usa o `realtime-js` e a `rpc` do `supabase-js` que já estão no projeto. Bibliotecas como `simple-peer` ou `peerjs` (o protótipo descartado usava PeerJS, DES-001 §1) trariam servidor de sinalização próprio ou dependências e esconderiam o que o domínio precisa controlar (quem oferece, sessões, descarte de revogados).

**D12. O que fica para depois.** `definir_reconhecimento(dispositivo_id, local)` e a leitura de `reconhecer_no` ficam para a **E5**, onde o reconhecimento de gestos existe: na E4 não há quem as use, e a D8 do PLA-004 já disse que função sem uso é código morto. Os gestos (DES-001 §5 e §8: o `obs_palco` recebe gestos "em `:video`") ganham na E5 um tópico próprio com autor separado por tópico (os de vídeo desta etapa não abrem ao palco). Várias câmeras na interface continuam fora (DES-001 §2); o banco e os tópicos já as separam.

**D13. Situação do vídeo na presença e na aba Ao vivo.** A presença dos dispositivos em `estudio` (D14 do PLA-004) ganha o campo opcional `video`, só para `camera` e `obs_camera`: `{ estado: EstadoDoVideo; telaLigada: 'travada' | 'sem_trava' | null; bateria: number | null }` (`bateria` de 0 a 1, `null` onde o navegador não informa; nenhum dado de pessoa). `EstadoDoVideo` = `'aguardando_toque' | 'aguardando_episodio' | 'aguardando_par' | 'conectando' | 'conectado' | 'sem_conexao_direta' | 'sem_permissao' | 'sem_camera' | 'inseguro' | 'sinal_grande'`. A presença é remarcada só quando a situação muda, **no máximo a cada `PRESENCA_MINIMA_MS = 10_000`** (a última mudança dentro da janela sai no fim dela; F1: 5 chamadas de presença por cliente a cada 30 s). A aba Ao vivo mostra a situação na lista de dispositivos e no checklist: o item "câmera conectada" (informativo até a E4, D13 do PLA-004) vira "Vídeo da câmera no OBS" (pronto com o `obs_camera` em `conectado`), e "Tela do celular ligada" fica pendente com `sem_trava`, com as instruções do DES-001 §10.4, item 3.

**D14. O que se prova onde.**

| O quê | jsdom (Vitest) | Chromium 153 com câmera falsa (Tarefa 7) | Aparelho e OBS reais (responsável) |
|---|---|---|---|
| Sinais, tópicos, leitores, esperas, emissor e receptor | ✅ domínio com falsos | — | — |
| Matriz do canal, índice de `obs_camera` | ✅ PGlite (`comoCanal`) | ✅ retransmissor que segue a matriz | aplicar a migração e conferir por consulta |
| Oferta/resposta, ICE, vídeo chegando, `replaceTrack` | adaptador com `RTCPeerConnection` falso | ✅ `RTCPeerConnection` real entre duas páginas, `videoWidth > 0` no `/obs/camera` | Android, iPhone, OBS |
| Tela preta, toque, prévia, status por 3 s | ✅ | ✅ captura de tela, 320 px | ✅ |
| Wake Lock, bateria | adaptador falso | só a ausência (o Chromium *headless* pode não ter) | ✅ iPhone 16.4+, iPhone sem Wake Lock, Android |
| Faixa terminando, página escondida | falsos | ✅ `track.stop()` forçado; `visibilitychange` emulado | ✅ bloqueio de tela, troca de app, orientação |
| Falha da conexão direta | emissor com falso | ✅ candidatos tirados dos dois SDPs, sem STUN | ✅ rede móvel × Wi-Fi, isolamento de clientes |
| Revogação no meio do vídeo | ✅ | ✅ vídeo some no `/obs/camera`, faixa `ended` na câmera | ✅ |
| Fonte do OBS (WebRTC, guarda, transparência) | guarda com OBS falso | `window.obsstudio` falso | ✅ OBS 30.2+ |
| Consumo de bateria e calor em 1 h | — | — | ✅ |

## Foco da revisão

Situações perigosas da E4 que nenhum teste "natural" cobriria; cada uma tem teste na tarefa dona:

1. **Câmera de outro dispositivo ou de outro episódio** → o destinatário é escolhido no banco (o par atual da câmera), o tópico é o da sessão, exige episódio ativo e câmera não revogada; tópicos parecidos negados (Tarefa 2, `e3-canal-matriz` com as colunas novas, `e4-video-de-outra-camera`, `e4-sinal-so-com-episodio-ativo`); o cliente abre só o tópico da própria sessão (Tarefa 3, `video-topico-da-sessao`; Tarefa 5, `obs-camera-abre-o-topico-da-sua-sessao`).
2. **`obs_camera` falso ou sessão antiga que não coopera** (revisão 1, C1) → um `obs_camera` não revogado no banco (Tarefa 2, `e4-um-obs-camera-ativo`); a sessão antiga não sinaliza (`42501` a cada chamada) nem recebe (as mensagens vão ao tópico da sessão nova) (Tarefa 2, `e4-repareamento-reusa-a-camera`, `e4-repareamento-reusa-o-obs-camera`); nenhum cliente envia pelo Broadcast nos tópicos de vídeo, nem por `realtime.send` direto (Tarefa 2, matriz, `e4-realtime-send-direto-negado`); a câmera descarta respostas repetidas, de sessão antiga e de remetente revogado (Tarefa 1, `emissor-descarta-revogado`, `emissor-primeira-resposta-vale`; defesa em profundidade); a aba avisa a sessão antiga na troca do `obs_camera` (Tarefa 6, `repareamento-da-obs-camera-avisa-sessao-antiga`).
3. **Sinalização forjada** → remetente posto pelo servidor (Tarefa 2, `e4-remetente-posto-pelo-servidor`); tipo pelo lado e forma do SDP conferidos na função (Tarefa 2, `e4-tipo-pelo-lado`) e de novo no leitor (Tarefa 1, `sinais-validados`, `sinal-do-lado-errado`); o adaptador nunca usa `canal.send` (Tarefa 3, `video-envia-pela-rpc`, `video-recebe-valida`); a câmera nunca responde e o `obs_camera` nunca oferece (Tarefa 1, `emissor-ignora-oferta`, `receptor-ignora-resposta`).
4. **Revogação no meio do vídeo** → a função recusa na hora a sessão revogada (e a do par de uma câmera revogada), e a recepção é negada na próxima autorização do canal, sem que nada novo chegue antes, porque a função deixa de publicar para ela (Tarefa 2, `e4-camera-revogada-fecha-o-video`, `e4-obs-camera-revogada`); a câmera revogada para tudo e sai; o lado que não foi revogado fecha o `RTCPeerConnection` e descarta o par (Tarefa 1, `emissor-revoga-par`, `receptor-revoga-par`; Tarefa 4, `revogado-desliga-tudo`; Tarefa 5, `revogacao-da-camera-corta-o-video`; Tarefa 7, conferência).
5. **Vídeo vazando na tela do celular** → nenhum `<video>` fora da prévia, prévia some em 15 s (Tarefa 4, `tela-preta-sem-video`, `previa-por-15s`).
6. **Câmera ligada sem o usuário saber** → só depois do toque; desligada sem episódio, ao sair, na revogação (Tarefa 1, `emissor-so-liga-depois-do-toque`, `emissor-desliga-sem-episodio`; Tarefa 4, `toque-liga-a-camera`, `saida-da-pagina-desliga`).
7. **NAT que impede a conexão** → `sem_conexao_direta` com instrução fixa, também quando o ICE fica parado em `checking` (prazo de 20 s), tentativas espaçadas, presença para a aba (Tarefa 1, `emissor-sem-conexao-direta`, `emissor-prazo-da-conexao`, `emissor-espera-crescente`; Tarefa 4, `sem-conexao-direta-avisa`; Tarefa 6, `checklist-video`; Tarefa 7, candidatos tirados dos dois SDPs).
8. **Reconexão** → queda breve espera 5 s; canal que volta oferece de novo; troca de episódio não troca de tópico (Tarefa 1, `emissor-queda-breve`, `emissor-canal-volta`, `receptor-oferta-nova-fecha-a-antiga`; Tarefa 4, `voltar-a-ver-religa`).
9. **Consumo** → 720p30, `maxBitrate`, sem prévia contínua, câmera desligada sem episódio, presença a cada 10 s no máximo, `pronto` a cada 10 s só sem vídeo e sem furar a espera (Tarefa 1, `emissor-pronto-respeita-a-espera`) (Tarefa 3, `restricoes-de-captura`, `bitrate-maximo`; Tarefa 4, `presenca-com-video`); medição de 1 h no passo do responsável.
10. **iPhone/Safari** → toque antes de pedir a câmera, `playsinline`, Wake Lock pedido de novo ao voltar e instruções sem ele, faixa terminada religada (Tarefa 4, `sem-wake-lock-avisa`, `wake-lock-volta-ao-ver`, `faixa-terminada-religa`); real num iPhone (passo do responsável).
11. **`/obs/camera` aparecendo na transmissão** → nada além do vídeo; selo e telas de erro pela guarda; classe transparente antes da primeira pintura (Tarefa 5, `obs-camera-so-o-video`, `selo-recusado-no-ar`, `telas-de-erro-so-com-saida-parada`, `obs-camera-sem-piscar`); a guarda movida continua provada pelos testes do palco (Tarefa 5, `PalcoNoAr.test.tsx` inteiro passando sem mudar expectativa).
12. **Política ou função afrouxada** → `pode_usar_canal` que devolva `true` ou compare tópico por prefixo, `lower`, `btrim` é pega só pelos testes de banco (limite N5 do PLA-004; Tarefa 2, sabotagens); `enviar_sinal_de_video` sem conferir o par, o tipo ou o episódio é pega pelos testes da Tarefa 2; as políticas continuam as duas do VER-036.
13. **SDP ou credencial em lugar errado** → nunca em `console`, armazenamento ou presença (a gravação em `realtime.messages` é a da D2, com retenção registrada) (Tarefa 3, `sdp-nunca-no-console`, `turn-nunca-no-console`; Tarefa 4 e Tarefa 5, mesma conferência).
14. **Dois usos do mesmo tópico no mesmo cliente** → o canal de vídeo usa o registro com contagem de referências (Tarefa 3, `video-um-canal-por-topico`, `video-fechar`).
15. **Laço de reentrada sem episódio** (revisão 1, I1) → o canal de vídeo só abre com episódio ativo e fecha quando acaba; `negado` sem episódio não reavalia o dispositivo (Tarefa 4, `canal-de-video-so-com-episodio`; Tarefa 5, `sem-episodio-limpa`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/domains/captura/README.md` | Domínio Captura (DES-001 §6) | 1 |
| `src/domains/captura/sinais.ts` (+ teste) | `topicoDoVideo`, `EVENTO_DO_SINAL`, `SinalDaCamera`, `SinalDaObs`, `lerSinalDaCamera`, `lerSinalDaObs`, `TAMANHO_MAXIMO_DO_SDP`, `EstadoDoVideo`, `SituacaoDoVideo`, `lerSituacaoDoVideo`, esperas | 1 |
| `src/domains/captura/portas.ts` | `CanalDeVideo`, `FabricaDeCanaisDeVideo`, `ConexaoDeVideo`, `FabricaDeConexoes`, `CameraDoAparelho`, `ManterTelaLigada`, `FaixaDeVideo`, `FluxoDeVideo` | 1 |
| `src/domains/captura/emissor.ts`, `receptor.ts` (+ testes) | Máquinas de estado do lado da câmera e do `obs_camera` (D3, D5–D7) | 1 |
| `src/domains/aovivo/mensagens.ts` (+ teste) | campo `video` na presença de `camera` e `obs_camera` (D13) | 1 |
| `src/domains/arquitetura.test.ts` | domínio sem APIs do navegador (`RTCPeerConnection`, `navigator`, `window`, `document`, `MediaStream`) | 1 |
| `supabase/tests/simulacao-supabase.sql`, `supabase/tests/banco.ts` | `realtime.send` da fonte; `mensagensPublicadas` | 2 |
| `supabase/migrations/<AAAAMMDDHHMMSS>_video_da_camera.sql` | `enviar_sinal_de_video`; `pode_usar_canal` com o tópico de vídeo da sessão (só recepção); índice de um `obs_camera` ativo no banco | 2 |
| `supabase/tests/rls.test.ts`, `restricoes.test.ts`, `matriz.test.ts` | bloco `E4 — vídeo da câmera`; colunas novas da matriz; índice | 2 |
| `src/shared/infra/canalSupabase.ts` (+ teste), `realtimeContrato.test.ts`, `realtimeFalso.ts` | `videoDaCamera()` e `videoDaObs()`: tópico da própria sessão só para receber; envio pela `rpc('enviar_sinal_de_video')` | 3 |
| `src/shared/infra/conexaoWebrtc.ts` (+ teste) | `servidoresIce`, `criarFabricaDeConexoes` (ICE não incremental, estados, `replaceTrack`, `maxBitrate`) | 3 |
| `src/shared/infra/cameraNavegador.ts` (+ teste) | `criarCameraDoAparelho`, `criarManterTelaLigada`, `lerBateria` | 3 |
| `src/app/servicos.ts`, `src/app/servicosFalsos.ts` (+ testes) | TURN em `ambienteDoVite`; `conexoes` e `aparelho` nos serviços do dispositivo; falsos de vídeo | 3 |
| `src/app/telas/CameraNoAr.tsx` (+ teste), `Camera.tsx` | `/camera` com tela preta e vídeo | 4 |
| `src/app/useDispositivo.ts` | `acompanharEstudio` com a presença de vídeo coalescida (D13) | 4 |
| `src/domains/obs/saida.ts` (+ teste) | guarda de saída movida do palco (D8) | 5 |
| `src/app/telas/TelaDeDispositivo.tsx`, `PalcoNoAr.tsx`, `ObsCamera.tsx`, `ObsCameraNoAr.tsx` (+ testes), `index.html` | `SoComSaidaParada` na casca; `/obs/camera` com só o vídeo | 5 |
| `src/app/telas/AbaAoVivo.tsx` (+ teste) | situação do vídeo na lista e no checklist; troca do `obs_camera` | 6 |
| `src/shared/styles/base.css` | tela preta, ponto, status, prévia; `/obs/camera` transparente; situação na aba | 4, 5, 6 |
| `supabase/README.md` | migração nova em "Onde"; seção "Vídeo da câmera (E4)" | 2, 7 |
| READMEs: `src/`, `src/domains/`, `src/domains/acesso/`, `src/domains/aovivo/`, `src/domains/obs/`, `src/app/`, `src/app/telas/`, `src/shared/infra/`, `src/shared/styles/`, `supabase/migrations/`, `supabase/tests/` | "Onde", "Arquivos" e o que passa a ser falso | na tarefa que mexe na pasta |

Cada tarefa termina com um commit que leva o seu registro `docs/verificacoes/AAAA-MM-DD-NNN-*.md`. O próprio plano entra antes, no commit do **VER-048** (este plano, a linha nova de `docs/planos/README.md`, o registro e a linha dele em `docs/verificacoes/README.md`). As Tarefas 1 a 7 usam **VER-049 a VER-055** (os números são os próximos livres na hora de cada commit; conferir `docs/verificacoes/README.md` antes; se um item de correção entrar no meio, os números andam). Toda tarefa também modifica `docs/verificacoes/README.md` (linha nova em "Onde", campo "Arquivos" e o número do exemplo da seção "Exemplo"). **Cada tarefa passa sozinha no `npm run check`** (inclusive o `typecheck`): uma mudança de interface entra junto com todos os arquivos que precisam dela para compilar. O `npm run check` final de cada tarefa roda **depois** de o registro existir e é o último ato antes do commit; depois do commit vem o push (decisão (b)) e o relato do estado.

O primeiro registro da E4 (VER-049) **abre com a conferência das pendências da E3** (guia "Ao vivo e pareamento (E3)" de `supabase/README.md`: migrações `ao_vivo_e_pareamento`, `episodio_em_teste_nao_se_apaga` e `estado_do_palco_em_topico_proprio` aplicadas e conferência real), anotando o que o responsável já confirmou; nenhum código da E4 depende delas, só a conferência real da Tarefa 7.

Ao fim da etapa, antes do relato final, vem a **revisão final da etapa inteira** (VER-049 a VER-055 juntos, como a que gerou o VER-046): o que só aparece quando se juntam as tarefas (por exemplo, a câmera e o `obs_camera` com o mesmo `estudio` e os tópicos de vídeo; a guarda movida no palco); o que ela achar vira item próprio, com registro.

---

### Tarefa 1: domínio — Captura (sinais, portas, emissor, receptor) e presença com vídeo

**Arquivos:**
- Criar: `src/domains/captura/README.md`, `src/domains/captura/{sinais,portas,emissor,receptor}.ts`, testes `src/domains/captura/{sinais,emissor,receptor}.test.ts`, registro `docs/verificacoes/AAAA-MM-DD-049-e4-dominio-captura.md`
- Modificar: `src/domains/aovivo/mensagens.ts` (+ teste), `src/domains/arquitetura.test.ts`, os arquivos de `src/app/` e de teste que montam uma presença de dispositivo, se o `tsc` pedir, `src/domains/README.md`, `src/domains/aovivo/README.md`, `src/README.md` (se citar a lista de domínios), `docs/verificacoes/README.md`

**Interfaces** (nenhum import de `react`, `@supabase/*`, `src/shared` ou `src/app`; nenhuma referência a API do navegador):

```ts
// captura/sinais.ts
export const EVENTO_DO_SINAL = 'sinal'
export function topicoDoVideo(usuarioId: string): string // `video:${usuarioId}` (auth.uid() da própria sessão, D2); fora de UUID minúsculo → lança
export const TAMANHO_MAXIMO_DO_SDP = 12_000 // ≈ 2,8 × a oferta medida no Chromium 153 (F21); o mesmo valor da função (revisão 2, I7)
export type SinalDaCamera = { tipo: 'oferta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string }
export type SinalDaObs = { tipo: 'pronto'; sessao: string } | { tipo: 'resposta'; sessao: string; sdp: string } | { tipo: 'encerrar'; sessao: string }
export function lerSinalDaCamera(evento: string, payload: unknown): SinalDaCamera | null // só evento 'sinal'; o remetente fica no payload e é lido pelo adaptador (lerRemetente)
export function lerSinalDaObs(evento: string, payload: unknown): SinalDaObs | null
export type EstadoDoVideo = 'aguardando_toque' | 'aguardando_episodio' | 'aguardando_par' | 'conectando' | 'conectado' | 'sem_conexao_direta' | 'sem_permissao' | 'sem_camera' | 'inseguro' | 'sinal_grande'
export function conferirSdp(sdp: string): 'ok' | 'grande' | 'forma' // a mesma regra do leitor e da função (D4); o emissor e o receptor conferem o próprio SDP antes de enviar (revisão 3, N13)
export interface SituacaoDoVideo { estado: EstadoDoVideo; telaLigada: 'travada' | 'sem_trava' | null; bateria: number | null }
export function lerSituacaoDoVideo(x: unknown): SituacaoDoVideo | null // bateria finita em [0, 1] ou null
export const ESPERA_DO_ICE_MS = 3000
export const ESPERA_DA_RESPOSTA_MS = 15_000
export const ESPERA_DA_QUEDA_MS = 5000
export const ESPERA_DA_CONEXAO_MS = 20_000 // resposta aceita sem chegar a conectado: conta como falha (revisão 1, I2)
export const ESPERAS_DE_RECONEXAO_MS = [2000, 4000, 8000, 16000, 30000] as const
export function esperaDaTentativa(n: number): number // n = 0, 1, 2… → 2000, 4000, …, 30000, 30000…
export const FALHAS_PARA_SEM_CONEXAO_DIRETA = 2
export const PRONTO_A_CADA_MS = 10_000
export const PRESENCA_MINIMA_MS = 10_000

// captura/portas.ts
export type FaixaDeVideo = { readonly __faixa: unique symbol } // opaco: o adaptador guarda o MediaStreamTrack
export type FluxoDeVideo = { readonly __fluxo: unique symbol }  // opaco: o adaptador guarda o MediaStream
export interface CanalDeVideo<Envia, Recebe> {
  aoSinal(f: (s: Recebe, remetente: string) => void): () => void // do tópico da própria sessão, validado; remetente posto pelo banco (D2)
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  enviar(s: Envia): Promise<'ok' | 'sem_par' | 'limite' | 'falhou'> // rpc enviar_sinal_de_video; nunca Broadcast direto; 'limite' = 54000 do limite por remetente
  fechar(): Promise<void>
}
export interface FabricaDeCanaisDeVideo {
  videoDaCamera(): CanalDeVideo<SinalDaCamera, SinalDaObs> // o banco decide o destinatário; o cliente não diz qual é o par
  videoDaObs(): CanalDeVideo<SinalDaObs, SinalDaCamera>
}
export type EstadoDaConexao = 'conectando' | 'conectado' | 'caiu' | 'falhou'
export interface ConexaoDeVideo {
  oferecer(faixa: FaixaDeVideo): Promise<string>   // sendonly; espera o ICE (ESPERA_DO_ICE_MS) e devolve o SDP local
  aceitarResposta(sdp: string): Promise<void>
  responder(oferta: string): Promise<string>      // recvonly; espera o ICE e devolve o SDP local
  trocarFaixa(faixa: FaixaDeVideo): Promise<boolean> // replaceTrack; false = precisa de oferta nova
  aoMudar(f: (e: EstadoDaConexao) => void): () => void
  aoVideo(f: (fluxo: FluxoDeVideo) => void): () => void
  fechar(): void
}
export interface FabricaDeConexoes { criar(): ConexaoDeVideo }
export type FalhaDaCamera = 'sem_permissao' | 'sem_camera' | 'inseguro' | 'outro'
export interface CameraDoAparelho {
  ligar(): Promise<{ ok: true; faixa: FaixaDeVideo } | { ok: false; motivo: FalhaDaCamera }>
  aoPerderFaixa(f: () => void): () => void // ended, ou mute por mais de 3 s
  desligar(): void                         // para todas as faixas; idempotente
  fluxoDaPrevia(): FluxoDeVideo | null     // o fluxo já ligado (sem segundo getUserMedia)
}
export interface ManterTelaLigada { travar(): Promise<'travada' | 'sem_trava'>; soltar(): void }

// captura/emissor.ts (lado da câmera)
export function criarEmissorDeVideo(d: {
  canal: CanalDeVideo<SinalDaCamera, SinalDaObs>; conexoes: FabricaDeConexoes; camera: CameraDoAparelho
  revogado(usuario: string): boolean; novaSessao(): string
  agendar(f: () => void, ms: number): () => void; aoMudarSituacao(e: EstadoDoVideo): void
}): { ligarPeloToque(): Promise<void>; definirEpisodio(ativo: boolean): void; revogarPar(usuario: string): void; voltarAVer(): void; parar(): void }

// captura/receptor.ts (lado do obs_camera)
export function criarReceptorDeVideo(d: {
  canal: CanalDeVideo<SinalDaObs, SinalDaCamera>; conexoes: FabricaDeConexoes
  revogado(usuario: string): boolean; novaSessao(): string
  agendar(f: () => void, ms: number): () => void; aoMudarSituacao(e: EstadoDoVideo): void; aoVideo(fluxo: FluxoDeVideo | null): void
}): { definirEpisodio(ativo: boolean): void; revogarPar(usuario: string): void; parar(): void }

// aovivo/mensagens.ts: PresencaNoEstudio de dispositivo ganha `video?: SituacaoDoVideo` (só camera e obs_camera; no obs_palco → presença inválida)
```

- [ ] **Passo 1: testes (falham).**
  - `sinais.test.ts`: `topico-do-video` (`video:<uuid>`; uuid em maiúsculas ou fora da forma → lança); `sinais-validados` (`test.each`: cada leitor aceita a forma certa e devolve `null` para evento diferente de `sinal`, `tipo` desconhecido, `sessao` fora de uuid ou em maiúsculas, `sdp` sem `v=0\r\n`, com `\u0000` ou outro controle, com 12 001 caracteres, não texto, campo extra `__proto__`, objeto devolvido novo só com os campos conhecidos; o `id` que o `realtime.send` acrescenta e o `remetente` são aceitos e não entram no sinal devolvido); `sinal-do-lado-errado` (`lerSinalDaCamera` recusa `resposta` e `pronto`; `lerSinalDaObs` recusa `oferta`); `situacao-do-video` (bateria 1.2, -0.1, `NaN` → `null`; estado fora da lista → `null`); `espera-da-tentativa` (0 → 2000; 4 → 30000; 9 → 30000).
  - `emissor.test.ts` (canal, conexões e câmera falsos; relógio falso): `emissor-so-liga-depois-do-toque` (com episódio ativo e canal conectado, `camera.ligar` não é chamado antes de `ligarPeloToque`; situação `aguardando_toque`); `emissor-desliga-sem-episodio` (ligado, `definirEpisodio(false)` → `encerrar` enviado, `conexao.fechar`, `camera.desligar`, `aguardando_episodio`; `definirEpisodio(true)` → liga sozinho e oferece); `emissor-oferece` (sessão nova por oferta; `oferta` enviada com o SDP da conexão); `emissor-oferece-ao-pronto` (um `pronto` sem sessão pendente → oferta nova; dois `pronto` em seguida → uma oferta só); `emissor-pronto-respeita-a-espera` (revisão 1, I4: `pronto` com a conexão em `conectando`, com oferta aguardando resposta ou com a conexão `conectado` → nenhuma oferta e a conexão não é fechada; `pronto` durante uma espera crescente → nenhuma oferta até o fim da espera, e uma só no fim, mesmo com três `pronto`); `emissor-sdp-grande` (revisão 3, N13: a conexão falsa devolve um SDP de 12 001 caracteres, ou sem `v=0\r\n` → nenhum `enviar`, situação `sinal_grande`, conexão fechada, relógio falso avançado 10 min sem nova oferta; `ligarPeloToque` tenta de novo uma vez); `receptor-sdp-grande` (a resposta montada passa do teto → nenhum `enviar`, `sinal_grande`, sem `pronto` até nova oferta); `conferir-sdp` (em `sinais.test.ts`: 12 000 → `ok`, 12 001 → `grande`, `\n` sem `\r` → `forma`, não ASCII → `forma`); `emissor-sem-par` (`enviar` → `sem_par` → `aguardando_par` e nova tentativa pela espera crescente); `emissor-limite` (revisão 2, I7: `enviar` → `limite` → nenhuma oferta antes da próxima espera crescente, que avança como numa falha, sem contar para `sem_conexao_direta`); `receptor-limite` (`pronto` ou `resposta` → `limite` → o próximo `pronto` só depois da espera crescente); `emissor-primeira-resposta-vale` (duas respostas da mesma sessão → `aceitarResposta` 1 vez; resposta de sessão antiga → ignorada); `emissor-descarta-revogado` (resposta de remetente com `revogado` verdadeiro → ignorada); `emissor-ignora-oferta` (o canal falso entrega uma `oferta` pelo caminho do leitor real: nada acontece); `emissor-revoga-par` (`revogarPar(<remetente da resposta aceita>)` → conexão fechada, oferta nova; de outro usuário → nada); `emissor-queda-breve` (`caiu` e `conectado` em 4 999 ms → nenhuma oferta nova; `caiu` por 5 000 ms → oferta nova); `emissor-espera-crescente` (`falhou` seguidos → ofertas em 2 000, 4 000, 8 000, 16 000, 30 000, 30 000 ms; um `conectado` zera); `emissor-sem-resposta` (15 000 ms sem resposta → `aguardando_par` e nova tentativa pela espera); `emissor-sem-conexao-direta` (duas `falhou` depois de resposta aceita → `sem_conexao_direta`; uma só → não; `conectado` depois → `conectado`); `emissor-prazo-da-conexao` (revisão 1, I2: resposta aceita e conexão parada em `conectando` por 19 999 ms → nada; por 20 000 ms → conta como falha, conexão fechada e nova tentativa pela espera; dois prazos vencidos seguidos → `sem_conexao_direta`); `emissor-canal-volta` (canal `reconectando` → `conectado` sem vídeo → oferta nova; com vídeo conectado → nada); `emissor-falha-da-camera` (`sem_permissao`, `sem_camera`, `inseguro` → situação igual, nenhuma oferta; `ligarPeloToque` de novo tenta de novo); `faixa-terminada-religa` (`aoPerderFaixa` → `camera.ligar` → `trocarFaixa` verdadeiro → nenhuma oferta; falso → oferta nova); `emissor-voltar-a-ver` (`voltarAVer` com a faixa perdida → religa; com tudo bem → nada); `emissor-parar` (`encerrar`, fechar, desligar, nenhum agendamento sobra: o relógio falso avançado 60 s não chama mais nada).
  - `receptor.test.ts`: `receptor-pronto` (episódio ativo e canal conectado → `pronto`; com a conexão fora de `conectado`, a cada 10 000 ms; com `conectado`, não; com uma conexão em `conectando`, o `pronto` sai mas não fecha nada); `receptor-responde` (oferta → `responder(sdp)` → `resposta` com a **mesma** sessão); `receptor-oferta-nova-fecha-a-antiga` (segunda oferta de outra sessão → a conexão anterior fechada antes de criar a nova; `aoVideo(null)` e depois o fluxo novo); `receptor-oferta-repetida` (mesma sessão 2 vezes → 1 resposta); `receptor-ignora-resposta` (uma `resposta` entregue pelo caminho do leitor real → nada); `receptor-encerrar` (`encerrar` da sessão atual → fecha e `aoVideo(null)`; de outra sessão → nada); `receptor-revoga-par` (`revogarPar(<remetente da oferta>)` → fecha, `aoVideo(null)`; ofertas dele com `revogado` verdadeiro → ignoradas); `receptor-sem-episodio` (fecha, `aoVideo(null)`, sem `pronto`); `receptor-falhou` (conexão `falhou` → `aoVideo(null)` e `pronto` de novo).
  - `mensagens.test.ts`: `presenca-com-video` (`camera` e `obs_camera` com `video` válido → aceitos; `obs_palco` com `video` → `null`; `video` inválido → `null`; sem `video` → aceito, como na E3).
  - `arquitetura.test.ts`: `dominio-sem-navegador` (nenhum arquivo de `src/domains/` que não seja teste cita `RTCPeerConnection`, `navigator`, `window`, `document`, `MediaStream`, `getUserMedia` ou `wakeLock` fora de comentário).
- [ ] **Passo 2:** `npx vitest run src/domains`. Esperado: FAIL (módulos inexistentes, campos novos).
- [ ] **Passo 3:** implementar. Leitores montam o objeto campo a campo (como `mensagens.ts`); emissor e receptor guardam um único agendamento por motivo (cancelado ao trocar), nunca chamam a porta dentro do ouvinte de outra porta sem passar pelo `agendar` com 0 ms. Corrigir os construtores de pareado e de presença apontados pelo `tsc`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens**, uma de cada vez, anotando o teste que caiu: aceitar `resposta` em `lerSinalDaCamera` → `sinal-do-lado-errado`; tirar o limite do SDP → `sinais-validados`; espalhar o `payload` → `sinais-validados` (`__proto__`); ligar a câmera sem toque → `emissor-so-liga-depois-do-toque`; não desligar sem episódio → `emissor-desliga-sem-episodio`; aceitar toda resposta → `emissor-primeira-resposta-vale`; não consultar `revogado` → `emissor-descarta-revogado` e `receptor-revoga-par`; oferta nova já no `caiu` → `emissor-queda-breve`; espera fixa de 2 s → `emissor-espera-crescente`; `sem_conexao_direta` na primeira falha → `emissor-sem-conexao-direta`; atender todo `pronto` → `emissor-pronto-respeita-a-espera`; sem o prazo de conexão → `emissor-prazo-da-conexao`; receptor responder com sessão nova → `receptor-responde`; não fechar a conexão antiga → `receptor-oferta-nova-fecha-a-antiga`; `pronto` também com vídeo → `receptor-pronto`; usar `window.setTimeout` em `emissor.ts` → `dominio-sem-navegador`.
- [ ] **Passo 5:** READMEs (`src/domains/captura/` com 11 seções; em "Lógica", o diagrama de sequência toque → `getUserMedia` → oferta → resposta → vídeo, e a tabela de estados do vídeo; `src/domains/aovivo/`: presença com vídeo); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-049 (abre com as pendências da E3; D1–D7, D13; F5–F8; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 2: `realtime.send` na simulação, migração `video_da_camera` e testes de banco da E4

**Arquivos:**
- Criar: `supabase/migrations/<AAAAMMDDHHMMSS>_video_da_camera.sql`, registro `docs/verificacoes/AAAA-MM-DD-050-e4-banco-video.md`
- Modificar: `supabase/tests/simulacao-supabase.sql` (`realtime.send` da fonte, F15–F16), `supabase/tests/banco.ts` (auxiliar `mensagensPublicadas`), `supabase/tests/rls.test.ts` (matriz, contagens de funções e bloco novo no fim), `supabase/tests/restricoes.test.ts` (índice), `supabase/tests/matriz.test.ts` (só se alguma linha extra de `dispositivos` criar um segundo `obs_camera` da mesma câmera; conferir), `scripts/check-data-api.mjs` e `scripts/check-rpc-grants.mjs` com os testes deles **só se** acusarem a chamada a `realtime.send` (Passo 1), `supabase/tests/README.md`, `supabase/migrations/README.md`, `supabase/README.md` ("Onde": as sete migrações; o passo de aplicar fica para a Tarefa 7), `scripts/README.md` e `scripts/tests/README.md` (só se as checagens mudarem), `docs/verificacoes/README.md`

- [ ] **Passo 1: fontes e sondas (antes de escrever SQL)**, citadas no comentário de cada bloco com a data da leitura e no VER-050. (a) `github.com/supabase/realtime`, commit 9a2cfba (o mesmo da simulação; lido na revisão 1 do plano, 2026-11-27): `lib/realtime/tenants/repo/migrations/20261107120000_broadcast_send_non_object_payloads.ex` (corpo atual de `realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void`: plpgsql, **sem** `SECURITY DEFINER`, acrescenta `id` ao payload de objeto, faz `SET LOCAL realtime.topic` e `insert into realtime.messages (id, payload, event, topic, private, extension)` com `extension = 'broadcast'`, e engole qualquer erro como `WARNING 'WarnSendingBroadcastMessage'`), `20260707120000_restrict_realtime_schema.ex` (dono `supabase_realtime_admin`), `20231204144023_set_required_grants.ex` (`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA realtime TO postgres, anon, authenticated, service_role`), `20241030150047_messages_partitioning.ex` e `20260914120000_delegate_messages_grants_to_postgres.ex` (`INSERT` em `realtime.messages` para `postgres`); (b) `github.com/supabase/postgres`, commit cceedbd (já citado em `dono-migracao.sql`): `postgres` com `BYPASSRLS`; (c) `supabase.com/docs/guides/realtime/broadcast` (Broadcast a partir do banco, retenção de 3 dias, partições criadas pelos clientes). **Consequência que a sonda confirma:** dentro de `enviar_sinal_de_video` (dona `postgres`, `SECURITY DEFINER`), o `realtime.send` roda como `postgres`, que tem `INSERT` e `BYPASSRLS`: a política de `insert` de `realtime.messages` não se aplica, e por isso **ninguém** precisa de `eb` nos tópicos de vídeo. Na simulação, o `postgres_sim` não tem `BYPASSRLS` (de propósito, `dono-migracao.sql`), mas é membro de `supabase_realtime_admin`, dono de `realtime.messages`, e a RLS não vale para o dono: o efeito é o mesmo. A sonda (num banco PGlite à parte, fora do repositório) confirma as duas coisas: o `insert` feito pela função passa na simulação, e um `realtime.send` chamado direto como `authenticated` para um tópico de vídeo **não** grava nada (a política nega e o `realtime.send` só avisa). Se a sonda mostrar que a simulação só passa por um motivo diferente do real, ou que o `realtime.send` não existe ou não aceita `private`, **parar** e registrar no VER-050 com a evidência (critério de inviabilidade do controlador). Rodar também `npm run data-api:check` e `npm run rpc:grants-check` sobre uma migração de sonda com a chamada a `realtime.send` dentro de uma função de `public`: se alguma regra acusar a chamada, a mudança da checagem aceita **só** `realtime.send(jsonb, text, text, boolean)` chamada de `public.enviar_sinal_de_video`, com teste que recusa qualquer outra função de `realtime` e qualquer outra chamadora (nenhuma regra fica mais frouxa).
- [ ] **Passo 2: simulação.** Bloco novo no fim do `realtime` de `simulacao-supabase.sql`: `realtime.send` com o corpo da 20261107120000 (copiado sem os comentários), dono `supabase_realtime_admin`, `grant execute` a `anon`, `authenticated`, `service_role` (o `postgres_sim` executa pela participação já existente); e o índice `messages_replay_index` da 20261022120000 (`(topic, inserted_at desc, (coalesce(expires_at, 'infinity'::timestamp))) where extension = 'broadcast' and private = true`; a coluna `expires_at` já existe na simulação), usado pela contagem do limite (F20). Auxiliar `mensagensPublicadas(db, topico)` em `banco.ts`: lê como superusuário `topic`, `event`, `private`, `extension` e `payload` de `realtime.messages` com aquele tópico, dentro do savepoint do teste.
- [ ] **Passo 3: testes de banco (falham).** No `rls.test.ts`, `TOPICOS` passa a receber o `uid` da sessão consultada (para a coluna do tópico próprio) e ganha as colunas abaixo; `NADA` ganha as mesmas chaves vazias; só estas células da `MATRIZ_DO_CANAL` mudam (comentário com a D2):

| Coluna nova | Tópico |
|---|---|
| `video_proprio` | `video:<uid da sessão consultada>` (anon: `video:<uuid fixo>`) |
| `video_da_camera` | `video:<UID_SESSAO_CAMERA>` |
| `video_da_obs` | `video:<UID_SESSAO_OBS_CAMERA>` |
| `video_do_dispositivo` | `video:<ID_CAMERA>` (id do dispositivo, não da sessão) |
| `video_x` | `video:<uid da sessão>x` |
| `video_sub` | `video:<uid da sessão>:x` |
| `video_maiusculo` | `VIDEO:<uid da sessão>` |
| `video_uid_maiusculo` | `video:<uid da sessão em maiúsculas>` |
| `video_espaco` | `video:<uid da sessão> ` (espaço no fim) |

| Sessão | Coluna | Antes | Depois |
|---|---|---|---|
| camera | `video_proprio`, `video_da_camera` | — | `rb rp` |
| obs_camera | `video_proprio`, `video_da_obs` | — | `rb rp` |
| todas as outras (inclusive ana, adm, palco, solta, revogado) em todas as colunas novas; camera e obs_camera nas demais colunas novas | — | — | `` (nada) |
| todas | `video` (`episodio:<ativo>:video`, já existente) | `` | `` (continua fechado) |

  Nenhuma sessão tem `eb`, `ep` ou `es` em coluna de vídeo. Bloco `describe('E4 — vídeo da câmera', ...)` (modo teste com `ID_EPISODIO`, salvo dito; "publica" = uma linha em `mensagensPublicadas` com `event = 'sinal'`, `private = true`, `extension = 'broadcast'`):

| Teste | Ação | Esperado |
|---|---|---|
| `e4-camera-envia-oferta-ao-obs` | camera: `select public.enviar_sinal_de_video('oferta', <sessao>, <sdp de teste>)` | `enviado`; publica em `video:<UID_SESSAO_OBS_CAMERA>` com payload exatamente `{tipo, sessao, sdp, remetente: UID_SESSAO_CAMERA, id}`; nada em outro tópico |
| `e4-obs-envia-resposta-a-camera` | obs_camera: `resposta`, `pronto`, `encerrar` | `enviado` cada; publica em `video:<UID_SESSAO_CAMERA>` com `remetente: UID_SESSAO_OBS_CAMERA` |
| `e4-remetente-posto-pelo-servidor` | camera chama com um SDP que contém o texto `"remetente"` e o cliente não tem como passar outro campo (a assinatura só tem três parâmetros); conferir também por `pg_get_function_arguments` | o `remetente` publicado é sempre o `auth.uid()` da chamada |
| `e4-tipo-pelo-lado` (`test.each`) | camera: `resposta`, `pronto`; obs_camera: `oferta`; tipo desconhecido; SDP com `oferta` nulo; SDP em `pronto`; SDP com 12 001 caracteres; SDP sem `v=0\r\n` (inclusive `v=0` seguido só de `\n`); SDP com `chr(1)` (`chr(0)` não cabe em `text`); SDP com caractere não ASCII (`é`); sessão nula | `22023` cada; nada publicado; um SDP de 12 000 caracteres válido passa (a mesma fronteira do leitor do domínio) |
| `e4-so-dispositivo-de-video` (`test.each` sobre ana, bia, adm, estranho, anônima sem dispositivo, palco, revogado) | chamar a função | `42501`; anon: `permission denied for function`; nada publicado |
| `e4-sinal-so-com-episodio-ativo` | sem episódio ativo; modo teste; ao vivo; encerrado | `55000`, `enviado`, `enviado`, `55000`; receber em `video_proprio`: `false`, `true`, `true`, `false` |
| `e4-sem-par` | superusuário revoga o `obs_camera`; camera manda oferta | `sem_par`; nada publicado |
| `e4-camera-revogada-fecha-o-video` | ana revoga a câmera | camera: `42501` na função, `false` em `video_proprio`; obs_camera: `55000` na função (a câmera dele está revogada), `false` em `video_proprio` |
| `e4-obs-camera-revogada` | ana revoga o `obs_camera` | obs_camera: `42501` e `false`; camera continua recebendo; a oferta dela dá `sem_par` |
| `e4-repareamento-reusa-a-camera` (I6) | `criar_codigo_pareamento('camera', null, ID_CAMERA, null)`; sessão anônima nova pareia | mesmo id de dispositivo; a sessão nova chama a função (`enviado`) e recebe em `video:<uid nova>`; a **sessão antiga**: `42501` na função, `false` em `video:<UID_SESSAO_CAMERA>` (receber e enviar); a resposta do `obs_camera` publica em `video:<uid nova>`, nunca no tópico antigo |
| `e4-repareamento-reusa-o-obs-camera` (I6) | o mesmo para o `obs_camera` (`p_dispositivo = ID_OBS_CAMERA`) | a oferta da câmera publica em `video:<uid nova do obs_camera>`; a sessão antiga: `42501`, `false` em `video:<UID_SESSAO_OBS_CAMERA>`; nada mais publicado no tópico antigo |
| `e4-video-de-outra-camera` | superusuário cria a câmera C2 (sessão anônima própria); `obs_camera` O2 com `camera_id = C2` com o semeado ativo; depois o semeado revogado e O2 criado | C2 sem par: `sem_par`, nada publicado; O2 com o semeado ativo: `23505` (`dispositivos_um_obs_camera_ativo`); com o semeado revogado, a oferta de C2 publica só em `video:<uid de O2>`, a câmera semeada recebe `sem_par`, e O2 não recebe em `video:<UID_SESSAO_OBS_CAMERA>` |
| `e4-realtime-send-direto-negado` | camera, como `authenticated`: `select realtime.send('{"tipo":"oferta"}'::jsonb, 'sinal', 'video:<UID_SESSAO_OBS_CAMERA>', true)`; o mesmo para `video:<UID_SESSAO_CAMERA>`; e, para mostrar o motivo (o `realtime.send` engole o erro; revisão 2, N7), um `insert into realtime.messages (topic, extension, payload, event, private) values ('video:<UID_SESSAO_OBS_CAMERA>', 'broadcast', '{}', 'sinal', true)` e um `update realtime.messages set payload = '{}' where topic like 'video:%'` diretos como `authenticated` (camera), **depois de** o `obs_camera` publicar uma `resposta` pela função em `video:<UID_SESSAO_CAMERA>`, linha que a câmera **consegue ler** (o teste confere antes, como camera, `select count(*) from realtime.messages where topic = 'video:<UID_SESSAO_CAMERA>'` = 1 com `realtime.topic` definido; revisão 3, N12) | nenhuma linha gravada pelo `realtime.send`; o `insert` direto dá `42501` (`new row violates row-level security policy`); o `update` direto não dá erro e altera **0 linhas** (há privilégio de `update`, F16, mas nenhuma política de `update`: a RLS filtra todas as linhas; o PostgreSQL não lança `42501` nesse caso), conferido depois pelo superusuário que o payload não mudou |
| `e4-limite-de-sinais` (revisão 2, I7) | camera manda 10 ofertas válidas seguidas; a 11ª; superusuário recua as 10 linhas 11 s (`inserted_at`); a próxima; depois 600 linhas na última hora (inseridas pelo superusuário com o mesmo remetente e tópico); e, noutro teste, linhas que somam 1 000 000 caracteres de SDP na hora | 10 × `enviado`; a 11ª `54000` (`limite de sinais`) e nada publicado; depois do recuo, `enviado`; com 600 na hora, `54000`; com o teto de SDP, `54000` para uma oferta e `enviado` para um `encerrar` (sem SDP) se as contagens deixarem; linhas de **outro** remetente no mesmo tópico (a sessão antiga, antes do repareamento) não contam para a sessão nova |
| `e4-limite-usa-o-indice` | superusuário: `explain` da consulta da contagem, com o índice da simulação (Passo 2) | o plano usa `messages_replay_index` (ou registra no VER-050 por que o PGlite não o escolhe com poucas linhas, com `set enable_seqscan = off` mostrando que o índice serve) |
| `e4-funcao-publica-pelo-dono` | a sonda do Passo 1 como teste: a mesma publicação feita pela função passa; e, para provar o caminho real (revisão 4, N15), o mesmo `realtime.send` rodado pelo papel de teste que imita o `postgres` real (o do `e4-guia-limpa-sinais-antigos`: `bypassrls`, `usage` em `realtime`, `select, insert, update` em `realtime.messages`, sem participação em `supabase_realtime_admin`), com as claims de uma sessão de câmera em `request.jwt.claims` | 1 linha em cada caminho: na simulação, pela participação do `postgres_sim` no dono; pelo papel que imita o real, pelo `INSERT` + `BYPASSRLS` (F16, F17), sem depender de ser dono |
| `e4-um-obs-camera-ativo` (I6; revisão 3, N11) | `criar_codigo_pareamento('obs_camera', 'PC 2', null, ID_CAMERA)` como adm; o mesmo para C2; com o semeado revogado, de novo para `ID_CAMERA`; e o caminho `parear_dispositivo` de um `obs_camera` **revogado** com outro ativo (como em `e3-um-palco-ativo`) | `23505` (restrição `dispositivos_um_obs_camera_ativo`) nos dois primeiros, contagens de `dispositivos` e `codigos_pareamento` iguais; ok; no repareamento do revogado, `23505` e o código fica com `usado_em` nulo |
| `e4-limite-com-trava` (revisão 3, N10) | camera manda uma oferta e, na mesma transação do teste, o superusuário lê `pg_locks` | 1 trava `advisory` de transação mantida até o fim da transação; depois do `rollback` do savepoint, nenhuma (a concorrência real não dá para provar no PGlite, de conexão única: registrado no VER-050) |
| `e4-guia-limpa-sinais-antigos` (revisão 3, I8) | a consulta de limpeza do guia (Tarefa 7, Passo 6, item 10), **lida do próprio `supabase/README.md`** como no VER-047, rodada como um papel de teste que imita o `postgres` real: criado pelo superusuário dentro da transação com `bypassrls`, `usage` em `realtime`, `select, insert, update` em `realtime.messages` e **sem** participação em `supabase_realtime_admin`; também como `postgres_sim` | com um sinal de 2 h e outro de 1 min em `video:%` e uma linha de outro tópico: o sinal de 2 h fica com o payload `{"tipo":"apagado"}` e sem `sdp`; os outros dois não mudam; a mesma linha continua na mesma partição (`tableoid` igual); e um `delete` com o mesmo filtro, pelo papel que imita o real, dá `42501` (a prova de que o guia não pode usar `delete`) |
| `e4-guia-conta-obs-cameras` | as consultas do guia (Tarefa 7, Passo 2), lidas do próprio `supabase/README.md` como no `e3-guia-revoga-o-palco-que-sobra`, num banco com dois `obs_camera` ativos criados antes da migração | a contagem acusa; as consultas deixam um; depois o índice entra |
| `e4-funcao-que-libera-tudo-e-pega` | a sabotagem N5 (`pode_usar_canal` que devolve `true`) em memória | as linhas da matriz e os testes de recepção acima falham |

  Contagens que mudam (a função nova): `dono-da-migracao-sem-superusuario` (funções de `public` de 12 para 13, com o comentário listando-a), a lista exata de funções com `SECURITY DEFINER`, `search_path` vazio e `EXECUTE` só de `authenticated` (ganha `enviar_sinal_de_video(text,uuid,text)`), e, se houver, a lista de funções da ACL. Tabelas e privilégios de tabela **não mudam**: se mudarem, é achado. **Testes da E3 que o índice novo muda** (revisão 3, N11; conferir com `grep "'obs_camera'" supabase/tests`): `e3-codigo-obs-camera-exige-camera` (`rls.test.ts`, perto da linha 1501, cria um `obs_camera` para `ID_CAMERA` com o semeado ativo) passa a revogar antes, como superusuário, o `obs_camera` semeado, com o comentário do índice; `obs-camera-com-camera-ok` (`restricoes.test.ts`, perto da linha 197) faz o mesmo e continua contando 2 linhas `obs_camera` (uma revogada); nenhum dos dois perde o que provava (a exigência de `camera_id` e o `insert` aceito). `restricoes.test.ts`: `um-obs-camera-ativo` (como `um-palco-ativo`).

  Rodar `npx vitest run supabase/tests`. Esperado: FAIL nas células novas, nas contagens e no bloco novo.
- [ ] **Passo 4: migração.** Cabeçalho no padrão das anteriores (DES-001 §8, §10.3; PLA-005 D2–D5; VER-046 e VER-047; fontes F15–F21; depois de `20261127220000_estado_do_palco_em_topico_proprio.sql`; "nunca editada"; sem e-mail; "cria uma função e um índice; não cria tabela, política nem privilégio de tabela"). Trechos que importam:

```sql
-- No máximo um obs_camera não revogado no banco (D2; revisão 3, N11): um único par sinaliza, e o teto de disco do limite
-- de sinais não cresce com o número de câmeras (DES-001 §2: várias câmeras simultâneas são não-objetivo).
-- Se o banco já tiver dois, o create unique index falha com 23505 e nada é aplicado (consultas no guia "Vídeo da câmera (E4)").
create unique index dispositivos_um_obs_camera_ativo
  on public.dispositivos (tipo) where tipo = 'obs_camera' and revogado_em is null;

create or replace function public.pode_usar_canal(p_topico text, p_extensao text, p_enviar boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_papel public.papel_app := (select public.papel_atual());
  v_disp record; -- (id, tipo, camera_id) de dispositivo_atual(), lido uma vez (revisão 1, N5)
  v_tipo public.tipo_dispositivo;
  v_ativo uuid := (select a.id from public.episodio_ativo() a);
  v_palco boolean;
  v_camera uuid; -- a câmera do vídeo desta sessão: a própria (camera) ou a do camera_id (obs_camera)
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  v_tipo := v_disp.tipo;
  v_palco := coalesce(v_tipo = 'obs_palco', false);
  if p_extensao is null or p_extensao not in ('broadcast', 'presence') then
    return false;
  end if;
  -- estudio, :controle e :estado: exatamente como no VER-047 (copiados, sem mudança de regra)
  ...
  -- Vídeo (D2): só receber, só no tópico da própria sessão, só com episódio ativo e câmera não revogada. Envio: ninguém
  -- (os sinais saem por enviar_sinal_de_video, que publica com realtime.send como postgres, dono da função; F15–F17).
  if not p_enviar and v_ativo is not null and v_tipo in ('camera', 'obs_camera')
     and p_topico = 'video:' || (select auth.uid())::text then
    v_camera := case when v_tipo = 'camera' then v_disp.id else v_disp.camera_id end;
    return exists (select 1 from public.dispositivos c where c.id = v_camera and c.tipo = 'camera' and c.revogado_em is null);
  end if;
  return false;
end;
$$;
revoke execute on function public.pode_usar_canal(text, text, boolean) from public, anon, service_role;
grant execute on function public.pode_usar_canal(text, text, boolean) to authenticated;

-- Sinalização do vídeo (D2–D4): a cada chamada, a sessão é conferida no banco e o remetente é posto aqui.
create function public.enviar_sinal_de_video(p_tipo text, p_sessao uuid, p_sdp text)
returns text -- 'enviado' | 'sem_par'
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_disp record;
  v_camera uuid;
  v_destino uuid; -- auth.uid() da sessão destinatária
  v_ultimos_10s bigint;
  v_ultima_hora bigint;
  v_sdp_ultima_hora bigint;
begin
  select d.id, d.tipo, d.camera_id into v_disp from public.dispositivo_atual() d;
  if v_disp.tipo is null or v_disp.tipo not in ('camera', 'obs_camera') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.episodio_ativo()) then
    raise exception 'sem episódio ativo' using errcode = '55000';
  end if;
  v_camera := case when v_disp.tipo = 'camera' then v_disp.id else v_disp.camera_id end;
  if not exists (select 1 from public.dispositivos c where c.id = v_camera and c.tipo = 'camera' and c.revogado_em is null) then
    raise exception 'câmera revogada' using errcode = '55000';
  end if;
  if p_sessao is null
     or not ((v_disp.tipo = 'camera' and p_tipo in ('oferta', 'encerrar'))
          or (v_disp.tipo = 'obs_camera' and p_tipo in ('pronto', 'resposta', 'encerrar')))
     or ((p_tipo in ('oferta', 'resposta')) <> (p_sdp is not null))
     or (p_sdp is not null and (pg_catalog.length(p_sdp) > 12000
         or pg_catalog.left(p_sdp, 5) <> 'v=0' || pg_catalog.chr(13) || pg_catalog.chr(10)
         or pg_catalog.translate(p_sdp, pg_catalog.chr(13) || pg_catalog.chr(10), '') !~ '^[ -~]*$')) then
    -- a mesma regra do leitor do domínio (D4; revisão 2, N8): começa com v=0\r\n, só ASCII imprimível, \r e \n, até 12 000
    raise exception 'sinal inválido' using errcode = '22023';
  end if;
  if v_disp.tipo = 'camera' then
    select o.usuario_anonimo_id into v_destino from public.dispositivos o
      where o.tipo = 'obs_camera' and o.camera_id = v_camera and o.revogado_em is null; -- um só (índice)
  else
    select c.usuario_anonimo_id into v_destino from public.dispositivos c where c.id = v_camera;
  end if;
  if v_destino is null then
    return 'sem_par';
  end if;
  -- Limite por remetente (revisão 2, I7): cada chamada grava uma linha em realtime.messages, guardada até 4 dias (F18), e o
  -- limite de mensagens do Realtime não freia o insert. Conta, no tópico do destinatário (o único deste remetente), as linhas
  -- deste remetente: no máximo 10 em 10 s, 600 por hora e 1 000 000 caracteres de SDP por hora. A consulta usa o índice
  -- messages_replay_index (topic, inserted_at desc) where extension = 'broadcast' and private (F20): o filtro repete o
  -- predicado do índice. A trava de transação por remetente (revisão 3, N10) deixa contar e gravar atômicos: duas chamadas
  -- paralelas da mesma sessão (pool do PostgREST) esperam uma pela outra; ela sai sozinha no fim da transação.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('enviar_sinal_de_video:' || (select auth.uid())::text));
  -- inserted_at é timestamp sem fuso, em UTC (timezone('utc', clock_timestamp()) na fonte): a comparação
  -- usa timezone('utc', now()), para não depender do TimeZone da sessão. Acima do limite, 54000 com mensagem fixa, nada publicado.
  select pg_catalog.count(*) filter (where m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '10 seconds'),
         pg_catalog.count(*),
         coalesce(pg_catalog.sum(pg_catalog.length(m.payload ->> 'sdp')), 0)
    into v_ultimos_10s, v_ultima_hora, v_sdp_ultima_hora
    from realtime.messages m
    where m.topic = 'video:' || v_destino::text and m.extension = 'broadcast' and m.private
      and m.inserted_at > pg_catalog.timezone('utc', pg_catalog.now()) - interval '1 hour'
      and m.payload ->> 'remetente' = (select auth.uid())::text;
  if v_ultimos_10s >= 10 or v_ultima_hora >= 600 or v_sdp_ultima_hora + coalesce(pg_catalog.length(p_sdp), 0) > 1000000 then
    raise exception 'limite de sinais' using errcode = '54000';
  end if;
  perform realtime.send(
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'tipo', p_tipo, 'sessao', p_sessao, 'sdp', p_sdp, 'remetente', (select auth.uid()))),
    'sinal', 'video:' || v_destino::text, true);
  return 'enviado';
end;
$$;
revoke execute on function public.enviar_sinal_de_video(text, uuid, text) from public, anon, service_role;
grant execute on function public.enviar_sinal_de_video(text, uuid, text) to authenticated;
```

  O trecho de `estudio`, `:controle` e `:estado` é copiado **literalmente** da `20261127220000`, com a única troca de `v_tipo` vindo do `select ... into` (a matriz prova que nada mudou ali). A Tarefa 2 confere na sonda se `chr(0)` pode chegar (não pode em `text`) e se a classe de controle acima é aceita pelo Postgres 18.6 do PGlite com `standard_conforming_strings`. Rodar `npx vitest run supabase/tests`, `npm run rpc:grants-check` e `npm run data-api:check`. Esperado: todos passam; 0 erros nas checagens (7 migrações).
- [ ] **Passo 5: sabotagens** (em memória pelo laço de `banco.ts` ou numa cópia, `sha256sum` antes e depois; a migração do repositório nunca é editada), anotando o teste que caiu: `eb` para a câmera no tópico do `obs_camera` → matriz `camera` e `e4-realtime-send-direto-negado`; receber em `video:<id do dispositivo>` em vez do uid → `video_do_dispositivo`, `e4-repareamento-reusa-a-camera`; função publicando para o id do dispositivo (não para o uid atual) → `e4-repareamento-reusa-o-obs-camera`; `remetente` vindo de um parâmetro do cliente (quarto parâmetro) → `e4-remetente-posto-pelo-servidor`; sem conferir o tipo pelo lado → `e4-tipo-pelo-lado`; sem exigir episódio ativo (na função ou na recepção) → `e4-sinal-so-com-episodio-ativo`; sem conferir `revogado_em` da câmera → `e4-camera-revogada-fecha-o-video`; usar o id do `obs_camera` como câmera → `e4-video-de-outra-camera`; `like 'video:' || uid || '%'` → `video_x`, `video_sub`; `lower(p_topico)` → `video_maiusculo`; comparar o uid sem `::text` canônico (aceitar maiúsculas) → `video_uid_maiusculo`; `btrim(p_topico)` → `video_espaco`; sem o índice → `e4-um-obs-camera-ativo` e `um-obs-camera-ativo`; índice por `camera_id` (o da revisão 1) → `e4-video-de-outra-camera` e `e4-um-obs-camera-ativo`; sem a trava → `e4-limite-com-trava`; consulta do guia com `delete` → `e4-guia-limpa-sinais-antigos`; **sem o limite de sinais** → `e4-limite-de-sinais` (revisão 2, I7); limite contando todos os remetentes do tópico → `e4-limite-de-sinais` (caso da sessão antiga); limite de 10 s com `>` em vez de `>=` → `e4-limite-de-sinais` (11ª passa); aceitar não ASCII na função → `e4-tipo-pelo-lado`; `pode_usar_canal` que devolve `true` → muitas linhas, e as duas checagens continuam com 0 erros (limite N5, registrado de novo); função sem chamada de `dispositivo_atual()` (papel lido de outro jeito) → `rpc:grants-check`.
- [ ] **Passo 6:** READMEs (`supabase/migrations/`: ordem e descrição; `supabase/tests/`: `realtime.send` na simulação, `mensagensPublicadas`, colunas novas e bloco E4; `supabase/README.md`: "Onde"; `scripts/` só se as checagens mudaram); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 7:** registro VER-050 (D2–D5, F2, F3, F15–F19; o resultado da sonda; tabela das células mudadas, como no VER-047; a retenção dos SDPs; sabotagens; limite N5), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 3: adaptadores — canal de vídeo, `RTCPeerConnection`, câmera e tela ligada; composição

**Arquivos:**
- Criar: `src/shared/infra/conexaoWebrtc.ts`, `src/shared/infra/cameraNavegador.ts` (+ testes), registro `docs/verificacoes/AAAA-MM-DD-051-e4-adaptadores-video.md`
- Modificar: `src/shared/infra/canalSupabase.ts` (+ teste: tópico de vídeo só para receber, envio pela `rpc`), `src/shared/infra/realtimeContrato.test.ts`, `src/shared/infra/realtimeFalso.ts` (se o contrato pedir), `src/app/servicos.ts` (+ teste), `src/app/servicosFalsos.ts` (+ `servicosFalsos.test.ts`: `criarVideoFalso`), `src/shared/infra/README.md`, `src/app/README.md`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// src/shared/infra/canalSupabase.ts
export function criarFabricaDeCanais(cliente, usuarioId, agendar?): FabricaDeCanais & FabricaDeCanaisDeVideo
// videoDaCamera(): abre só topicoDoVideo(usuarioId) para receber (lerSinalDaObs); enviar(s) = cliente.rpc('enviar_sinal_de_video', { p_tipo, p_sessao, p_sdp })
// videoDaObs(): o mesmo, com lerSinalDaCamera; sem presença marcada; nunca canal.send nos tópicos de vídeo (D2)
// resposta da rpc: 'enviado' → 'ok'; 'sem_par' → 'sem_par'; 54000 → 'limite' (revisão 2, I7); 42501/55000/22023/rede/tempo-limite → 'falhou' (o emissor segue a D6)

// src/shared/infra/conexaoWebrtc.ts
export const STUN_PUBLICO = 'stun:stun.l.google.com:19302'
export const BITRATE_MAXIMO = 2_500_000
export function servidoresIce(config: Pick<Configuracao, 'turn'>): RTCIceServer[] // STUN sempre; TURN só com url turn:/turns: e as três partes
export function criarFabricaDeConexoes(d: { ice: RTCIceServer[]; criarPc?: (c: RTCConfiguration) => RTCPeerConnection; agendar?: (f: () => void, ms: number) => () => void }): FabricaDeConexoes
// RTCConfiguration: { iceServers, bundlePolicy: 'max-bundle' }; câmera: addTransceiver(faixa, { direction: 'sendonly' }); obs: setRemoteDescription → createAnswer (o transceptor vem recvonly)
// ICE não incremental: espera 'icegatheringstatechange' até 'complete' ou ESPERA_DO_ICE_MS; devolve pc.localDescription.sdp
// estados: connectionState connecting/new → conectando; connected → conectado; disconnected → caiu; failed/closed sem pedido → falhou; cada aviso por agendar(0)
// depois de aceitar a resposta: sender.setParameters com encodings[0].maxBitrate = BITRATE_MAXIMO (falha ignorada)

// src/shared/infra/cameraNavegador.ts
export const RESTRICOES_DE_CAPTURA: MediaStreamConstraints // as da D7
export const MUDO_TOLERADO_MS = 3000
export const ESPERA_DA_CAMERA_MS = 30_000
export function criarCameraDoAparelho(nav?: Pick<Navigator, 'mediaDevices'>, seguro?: () => boolean, agendar?): CameraDoAparelho
// sem mediaDevices ou contexto inseguro → 'inseguro'; NotAllowedError/SecurityError/tempo esgotado → 'sem_permissao'; NotFoundError/OverconstrainedError → 'sem_camera'; outro → 'outro'
export function criarManterTelaLigada(nav?: Navigator, doc?: Document): ManterTelaLigada // sem wakeLock ou recusado → 'sem_trava'; liberado pelo sistema → trava de novo ao voltar a ver
export async function lerBateria(nav?: Navigator): Promise<number | null> // getBattery().level, ou null

// src/app/servicos.ts
// ambienteDoVite passa a ler também VITE_TURN_URL, VITE_TURN_USUARIO, VITE_TURN_SENHA (uma a uma, como as outras)
// ServicosDoDispositivo ganha conexoes: FabricaDeConexoes (com servidoresIce da configuração) e aparelho: { camera(): CameraDoAparelho; tela(): ManterTelaLigada; bateria(): Promise<number | null> }
```

- [ ] **Passo 1: fontes.** Conferir em `node_modules/@supabase/realtime-js` 2.119.0 que nada muda para o tópico de vídeo (mesma configuração `private`, presença com chave; o canal só recebe) e **como chega ao cliente uma mensagem publicada pelo banco** (`realtime.send`): o evento `broadcast` com `event = 'sinal'` e o `payload` com o `id` acrescentado (o leitor da Tarefa 1 aceita o `id`; F15); conferir que `rpc` do `supabase-js` passa pelo `fetch` com tempo-limite de 15 s (VER-021); nos tipos `lib.dom.d.ts` do TypeScript instalado, `RTCPeerConnection`, `RTCRtpSender.setParameters`, `WakeLockSentinel`, `Navigator.wakeLock` (e se `getBattery` existe nos tipos; se não, uma interface local mínima, sem `any`); citar arquivo e linha.
- [ ] **Passo 2: testes (falham).**

| Arquivo | Testes |
|---|---|
| `canalSupabase.test.ts` | `video-topico-da-sessao` (`videoDaCamera()` abre só `video:<usuarioId da fábrica>`, privado; nenhum outro tópico); `video-envia-pela-rpc` (`enviar` chama `rpc('enviar_sinal_de_video', { p_tipo, p_sessao, p_sdp })` com `p_sdp: null` em `pronto`/`encerrar`; **nunca** `canal.send`; `enviado` → `ok`, `sem_par` → `sem_par`, erro `54000` → `limite`, outro erro → `falhou`); `video-recebe-valida` (na câmera, `oferta` e `encerrar` com outro `tipo` do lado errado descartados; `resposta` válida com `remetente` e `id` chega com o remetente; sem remetente → descartada; evento diferente de `sinal` → descartado); `video-um-canal-por-topico` (duas alças no mesmo cliente → 1 `channel`); `video-fechar` (fechar a última alça → `removeChannel` 1 vez); `video-sem-presenca` (nenhum `track`) |
| `realtimeContrato.test.ts` | `video-contrato` (os casos do contrato que valem para `estudio` rodam também com `video:<uuid>` no cliente real e no falso; uma mensagem publicada pelo banco, na forma lida no Passo 1, chega ao ouvinte `broadcast` com o `id` no payload) |
| `conexaoWebrtc.test.ts` (`RTCPeerConnection` falso que registra chamadas e emite eventos) | `servidores-ice` (sem TURN → só o STUN; TURN com `turn:` ou `turns:` → com `username`/`credential`; `https://...` → ignorado); `oferta-sendonly` (`addTransceiver(faixa, { direction: 'sendonly' })`, `createOffer`, `setLocalDescription`); `ice-nao-incremental` (com `complete` em 100 ms → devolve o SDP em 100 ms; sem `complete` → em 3 000 ms; nunca antes); `resposta-recvonly` (`setRemoteDescription` com a oferta, `createAnswer`, nada de `addTrack`); `estados-da-conexao` (cada `connectionState` → estado; `closed` depois de `fechar()` → nenhum aviso); `aviso-adiado` (nenhum ouvinte roda dentro do evento do falso); `video-recebido` (`track` → `aoVideo` com o fluxo); `trocar-faixa` (`replaceTrack` resolvido → `true`; rejeitado → `false`); `bitrate-maximo` (`setParameters` com `maxBitrate` 2 500 000 depois de `aceitarResposta`; rejeitado → sem erro); `sdp-nunca-no-console` (com `console.*` espionados, nenhuma chamada recebe o SDP nem um candidato, inclusive nos erros); `turn-nunca-no-console` |
| `cameraNavegador.test.ts` | `restricoes-de-captura` (`getUserMedia` com exatamente `RESTRICOES_DE_CAPTURA`, `audio: false`); `erros-da-camera` (`test.each`: `NotAllowedError`, `SecurityError` → `sem_permissao`; `NotFoundError`, `OverconstrainedError` → `sem_camera`; `TypeError` → `outro`; sem `mediaDevices` ou `seguro()` falso → `inseguro` sem chamar nada); `camera-que-nao-responde` (promessa pendurada → `sem_permissao` em 30 000 ms; se resolver depois, as faixas são paradas na hora); `faixa-perdida` (`ended` → ouvinte; `mute` por 2 999 ms e `unmute` → nada; `mute` por 3 000 ms → ouvinte); `desligar-para-tudo` (`stop` em toda faixa; segunda chamada sem erro); `previa-sem-segundo-getusermedia` (`fluxoDaPrevia` devolve o fluxo ligado; `getUserMedia` 1 vez); `tela-ligada` (sem `wakeLock` → `sem_trava`; `request` rejeitado → `sem_trava`; aceito → `travada`; `release` pelo sistema e `visibilitychange` para visível → `request` de novo; `soltar` → `release` e nenhum pedido depois); `bateria` (`getBattery` → `level`; ausente ou rejeitado → `null`) |
| `servicos.test.ts` | `ambienteDoVite` lê as cinco variáveis (o teste existente atualizado); `conexoes-com-turn` (configuração com as três variáveis → `servidoresIce` com TURN; sem → só STUN); serviços do dispositivo continuam com 1 cliente por tipo |
| `servicosFalsos.test.ts` | `criarVideoFalso` imita o que as telas precisam (conexão que passa por `conectando` → `conectado`, pode `cair`/`falhar`; câmera que liga, recusa ou perde a faixa; tela com ou sem trava) |

- [ ] **Passo 3:** implementar. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** enviar por `canal.send` em vez da `rpc` → `video-envia-pela-rpc`; abrir o tópico pelo id do dispositivo → `video-topico-da-sessao`; leitor do lado errado → `video-recebe-valida`; tratar `sem_par` como `ok` ou `54000` como `falhou` → `video-envia-pela-rpc`; `direction: 'sendrecv'` → `oferta-sendonly`; devolver o SDP antes de esperar o ICE → `ice-nao-incremental`; aceitar TURN `https:` → `servidores-ice`; `audio: true` → `restricoes-de-captura`; sem tempo-limite no `getUserMedia` → `camera-que-nao-responde`; ouvir `mute` sem tolerância → `faixa-perdida`; não pedir o Wake Lock ao voltar a ver → `tela-ligada`; `console.debug(sdp)` num erro → `sdp-nunca-no-console`; ouvinte chamado dentro do evento → `aviso-adiado`.
- [ ] **Passo 5:** READMEs; `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-051 (D2 e D4 no adaptador, D6, D7 nos adaptadores, D9, D11; F1, F3–F5, F7, F8, F15; fontes do Passo 1; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 4: `/camera` com tela preta e vídeo

**Arquivos:**
- Criar: `src/app/telas/CameraNoAr.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-052-e4-camera-tela-preta.md`
- Modificar: `src/app/telas/Camera.tsx` (usa `CameraNoAr`; a `CameraPareada` continua servindo o `/obs/camera` até a Tarefa 5), `src/app/useDispositivo.ts` (`acompanharEstudio` com a presença coalescida, D13), `src/app/App.test.tsx` (frase de `/camera`), `src/shared/styles/base.css`, READMEs de `src/app/`, `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
export function CameraNoAr(props: { dispositivo: DispositivoPareado; servicos: ServicosDoDispositivo; marcarRevogado(): void; aoVoltarAVer: Dependencias['aoVoltarAVer']; agora?: () => number }): ReactNode
// acompanharEstudio: OpcoesDoEstudio ganha presencaMinimaMs?: number (padrão PRESENCA_MINIMA_MS); atualizarPresenca() coalesce dentro da janela
export const TEXTO_DA_CAMERA = Object.freeze({ /* frases fixas da tabela abaixo */ })
export const STATUS_VISIVEL_MS = 3000
export const PREVIA_MS = 15_000
```

  `CameraNoAr` compõe: `acompanharEstudio` (presença `{ tipo: 'camera', dispositivoId, obs: null, video: situação }`, `episodio_ativo_mudou`, revogação, canal perdido), `criarEmissorDeVideo` sobre `servicos.canais(usuario).videoDaCamera()`, **aberto só com episódio ativo** e fechado quando ele acaba (D5), `servicos.conexoes`, `servicos.aparelho.camera()`, `revogado` alimentado por `aoRevogarOutro` com uma `Revogados` (15 min), e `servicos.palco.episodioAtivo()` (D5). Tela: `<main className="tela-preta">` com o ponto (`aria-label` com a situação) e uma área de toque do tamanho da tela; a primeira vez, "Toque para ligar a câmera"; depois, o toque mostra o status por 3 s; botão "Prévia" (≥ 44 px, discreto). Frases fixas:

| Situação | Frase |
|---|---|
| `aguardando_toque` | "Toque para ligar a câmera." |
| `aguardando_episodio` | "Câmera desligada: nenhum episódio no ar nem em teste." |
| `aguardando_par` | "Procurando o computador do OBS…" |
| `conectando` | "Conectando ao OBS…" |
| `conectado` | "Vídeo chegando ao OBS." |
| `sem_conexao_direta` | a frase da D6 |
| `sem_permissao` | "Permita o uso da câmera para este site e toque de novo." |
| `sem_camera` | "Nenhuma câmera traseira encontrada neste aparelho." |
| `inseguro` | "A câmera só funciona pelo endereço https do app." |
| `sinal_grande` | a frase da D6 (revisão 3, N13) |
| tela `sem_trava` | as instruções do DES-001 §10.4, item 3 (iPhone: Modo de Pouca Energia desligado e bloqueio automático "Nunca"; Android: economia de bateria desligada e "Permanecer ativo" com o carregador) |
| bateria | "Bateria: 87%" (só quando há leitura) |

- [ ] **Passo 1: testes (falham)** (`CameraNoAr.test.tsx`, jsdom, com `criarVideoFalso` e o canal falso; relógio falso):

| Teste | Esperado |
|---|---|
| `tela-preta-sem-video` (`test.each` por situação) | nenhum `<video>` no DOM; `main.tela-preta`; nenhum texto além do ponto e da frase da situação |
| `toque-liga-a-camera` | antes do toque, `camera.ligar` não chamado e "Toque para ligar a câmera."; depois do toque com episódio ativo, `ligar` 1 vez e `travar` 1 vez |
| `sem-episodio-camera-desligada` | `episodioAtivo` → `null`: depois do toque, `ligar` não chamado; a frase de `aguardando_episodio` |
| `episodio-encerrado-desliga` | `episodio_ativo_mudou` e `episodioAtivo` → `null` → `encerrar` enviado pela `rpc` antes de o canal de vídeo fechar (se a `rpc` der `55000`, nada mais é tentado), `desligar` 1 vez, canal de vídeo fechado |
| `status-por-3s` | com vídeo, toque → frase de `conectado` e bateria; 3 000 ms depois → some |
| `previa-por-15s` | "Prévia" → um `<video muted playsinline>` com o `srcObject` do `fluxoDaPrevia`; 15 000 ms depois → sem `<video>`; "Esconder" antes → sem `<video>` |
| `sem-wake-lock-avisa` | `travar` → `sem_trava`: as instruções do DES-001 §10.4 aparecem (iPhone e Android) |
| `wake-lock-volta-ao-ver` | `aoVoltarAVer` → `travar` de novo e `voltarAVer` do emissor (faixa perdida → `ligar` de novo) |
| `faixa-terminada-religa` | `aoPerderFaixa` → `ligar` e `trocarFaixa` |
| `sem-permissao` | `ligar` → `sem_permissao`: a frase; novo toque tenta de novo |
| `sem-conexao-direta-avisa` | duas `falhou` depois de resposta → a frase da D6 no status |
| `revogado-desliga-tudo` | `revogacao` com o próprio usuário → `desligar`, conexão fechada, canais fechados, `sair` 1 vez, tela de revogado |
| `revogacao-do-par` | `revogacao` do remetente da resposta aceita → conexão fechada e oferta nova |
| `presenca-com-video` | a presença leva `video` com a situação; duas mudanças em 1 s → uma marcação a mais, no fim da janela de 10 000 ms; nenhuma marcação com a situação igual |
| `saida-da-pagina-desliga` | desmontar → `encerrar`, `desligar`, `soltar` (tela), canais fechados; `pagehide` → o mesmo |
| `canal-de-video-so-com-episodio` (revisão 1, I1) | sem episódio ativo, nenhum `channel('video:<uid>')` é aberto; com episódio, abre; o episódio acaba → o canal de vídeo é fechado; um `negado` do canal de vídeo com `episodioAtivo` → `null` não chama `canalPerdido` nem `dispositivoAtual` (relógio falso avançado 60 s: nenhuma entrada nova); com episódio ativo, `negado` → `canalPerdido`, reavaliação e reabertura em 5 s |
| `sdp-nunca-no-console` | `console.*` espionados nunca recebem o SDP do falso |
| `voltar-a-ver-religa` | voltar a ver com `episodioAtivo` mudado → segue o episódio novo sem trocar de tópico |

- [ ] **Passo 2:** `npx vitest run src/app`. Esperado: FAIL.
- [ ] **Passo 3:** implementar; `base.css`: `tela-preta` (fundo `#000`, exceção declarada como a do palco; texto em cinza baixo para não iluminar a sala), `ponto-da-camera` (cores por situação com as variáveis de `tokens.css`), `status-da-camera`, `previa-da-camera` (`object-fit: contain`, `max-width: 100%`); nada estoura em 320 px. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** prévia sempre visível → `tela-preta-sem-video`; ligar ao montar sem toque → `toque-liga-a-camera`; não desligar no fim do episódio → `episodio-encerrado-desliga`; prévia sem prazo → `previa-por-15s`; sem as instruções → `sem-wake-lock-avisa`; não pedir o Wake Lock ao voltar → `wake-lock-volta-ao-ver`; presença a cada mudança → `presenca-com-video`; não desligar ao desmontar → `saida-da-pagina-desliga`; esquecer o `desligar` na revogação → `revogado-desliga-tudo`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-052 (D5–D7, D10, D13; F5–F8; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 5: `/obs/camera` com só o vídeo; guarda de saída compartilhada

**Arquivos:**
- Criar: `src/domains/obs/saida.ts` (+ teste), `src/app/telas/ObsCameraNoAr.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-053-e4-obs-camera.md`
- Modificar: `src/app/telas/PalcoNoAr.tsx` (importa a guarda; nenhum comportamento muda), `src/app/telas/TelaDeDispositivo.tsx` (recebe `SoComSaidaParada`; a `CameraPareada` sai; `TelaDoEstado` passa a esconder o `carregando` também para `obs_camera`, revisão 1, N3; o arquivo não fica abaixo de 124 linhas), `src/app/telas/ObsPalco.tsx` (import da `SoComSaidaParada` novo), `src/app/telas/ObsCamera.tsx`, `src/app/telas/TelaDeDispositivo.test.tsx` (testes da `CameraPareada` passam para os de `CameraNoAr`/`ObsCameraNoAr`, sem perder caso: presença e revogação continuam provadas), `index.html` (classe `obs-camera`), `src/shared/styles/base.css`, `src/app/App.test.tsx` (frase de `/obs/camera`), READMEs de `src/domains/obs/`, `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// src/domains/obs/saida.ts (movido de PalcoNoAr.tsx sem mudar uma regra)
export async function saidaParada(obs: ObsNoNavegador): Promise<boolean>
export const RELEITURAS_PARA_LIBERAR = 2
export const SITUACAO_A_CADA_MS = 15_000 // movida de PalcoNoAr.tsx (revisão 1, N1); PalcoNoAr reexporta
export const SELO_VISIVEL_MS = 5000      // movida de PalcoNoAr.tsx (revisão 1, N4); usada pelo palco e pelo /obs/camera, sem cópia
export function criarGuardaDaSaida(obs: ObsNoNavegador): { evento(tipo: 'inicio' | 'fim', saida: string): void; contarReleitura(): void; livre(): Promise<boolean> }
// src/app/telas/TelaDeDispositivo.tsx
export function SoComSaidaParada(props: { obs: ObsNoNavegador; children: ReactNode }): ReactNode // a mesma, com SITUACAO_A_CADA_MS de domains/obs/saida.ts (a casca não depende da tela do palco)
// src/app/telas/ObsCameraNoAr.tsx (SELO_VISIVEL_MS vem de domains/obs/saida.ts)
export function ObsCameraNoAr(props: { dispositivo: DispositivoPareado; servicos: ServicosDoDispositivo; obs: ObsNoNavegador; marcarRevogado(): void }): ReactNode
```

  `ObsCameraNoAr`: `acompanharEstudio` (presença `{ tipo: 'obs_camera', dispositivoId, obs: null, video }`), `criarReceptorDeVideo` sobre `videoDaObs()` (tópico da própria sessão), **aberto só com episódio ativo** e fechado quando ele acaba (D5), `aoRevogarOutro` → `Revogados` e `receptor.revogarPar`, `episodioAtivo()` (D5); `<video autoPlay muted playsInline>` só com fluxo, `srcObject` por `ref`; selo pela tecla `s` com `criarGuardaDaSaida`, 5 s. `ObsCamera.tsx` passa `cobrirTela={(t) => <SoComSaidaParada obs={obs}>{t}</SoComSaidaParada>}` como o `ObsPalco.tsx`, e o `carregando` também não aparece (como no palco; `TelaDoEstado` muda, teste `carregando-invisivel-no-obs-camera`).

- [ ] **Passo 1: testes (falham).**

| Teste | Esperado |
|---|---|
| `saida.test.ts`: os casos da guarda que hoje estão no `PalcoNoAr.test.tsx` por meio da tela, agora direto na função (início sem fim recusa; `*Stopped` libera; duas releituras liberam; início durante a leitura vence; nível abaixo de READ_OBS → `false`) | iguais aos do VER-046 |
| `PalcoNoAr.test.tsx` inteiro | passa **sem mudar nenhuma expectativa** (só imports, se algum teste importava a guarda do arquivo da tela) |
| `obs-camera-so-o-video` (`test.each`: `aguardando_par`, `conectando`, `sem_conexao_direta`, `conectado`) | `container.textContent` vazio em todos; `<video>` só em `conectado` |
| `video-com-srcobject` | o `video` tem `muted`, `autoplay`, `playsinline` e `srcObject` = o fluxo do falso; nenhum atributo `src` |
| `obs-camera-abre-o-topico-da-sua-sessao` | com episódio ativo, o canal falso registra só `video:<usuarioId do pareado>`; nenhum outro tópico de vídeo |
| `carregando-invisivel-no-obs-camera` (revisão 1, N3) | `/obs/camera` em `carregando` → nada na tela (como o palco); `/camera` em `carregando` → "Conferindo o pareamento…" |
| `selo-por-tecla` | OBS falso fora do ar: tecla `s` → selo com a situação ("Câmera do OBS · aguardando a câmera"); 5 000 ms depois → some |
| `selo-recusado-no-ar` (`test.each`: transmitindo, gravando, Replay Buffer, câmera virtual, status `null`, nível 0; e `obsStreamingStarting` com o selo aberto) | nada aparece; o evento de início fecha o selo na hora |
| `telas-de-erro-so-com-saida-parada` | rota sem pareamento (`sem_link`, revogado) com a saída no ar → nada; parada → o cartão; sem `window.obsstudio` → o cartão |
| `obs-camera-sem-piscar` | o `<script>` clássico do `index.html` põe `obs-camera` em `<html>` para `/obs/camera` (e `/obs/camera/`) e não para `/obs/camerax`, e põe `document.documentElement.style.colorScheme = 'light'` nos dois caminhos (revisão 1, I5: com o sistema escuro, `color-scheme: light dark` pintaria fundo opaco na Fonte; o mesmo do palco no VER-040); continua pondo `palco` só para `/obs/palco`; `base.css` tem `html.obs-camera, html.obs-camera body { background: transparent }`; rodando o script num jsdom com `/obs/camera`, `colorScheme` é `light`, e com `/obs/camerax` fica vazio |
| `revogacao-da-camera-corta-o-video` | `revogacao` com o remetente da oferta → `<video>` some, conexão fechada; oferta seguinte desse remetente ignorada |
| `revogado-na-hora` | `revogacao` do próprio usuário → conexão e canais fechados, `sair` 1 vez, `marcarRevogado`; com a saída no ar, nada aparece na Fonte |
| `sem-episodio-limpa` | `episodioAtivo` → `null` → `<video>` some, sem `pronto` |
| `presenca-obs-camera` | presença com `video.estado` |
| `sdp-nunca-no-console` | como na Tarefa 4 |

- [ ] **Passo 2:** `npx vitest run src/domains/obs src/app`. Esperado: FAIL.
- [ ] **Passo 3:** mover a guarda (o corpo das funções igual, letra por letra; conferir com `git diff --word-diff` que só mudaram imports e o lugar), implementar o `ObsCameraNoAr`, o `index.html` e o `base.css`. O `PalcoNoAr.tsx` reexporta `SITUACAO_A_CADA_MS` e `SELO_VISIVEL_MS` de `saida.ts` (o `PalcoNoAr.test.tsx` importa as duas do arquivo da tela e não muda). Conferir os mínimos de linhas (`PalcoNoAr.tsx` ≥ 610, perto de 629 depois; `TelaDeDispositivo.tsx` ≥ 124, perto de 145) com o `check-docs`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** mostrar a frase da situação na tela pareada → `obs-camera-so-o-video`; `src` em vez de `srcObject` → `video-com-srcobject`; selo sem a guarda → `selo-recusado-no-ar`; `ObsCamera` sem `cobrirTela` → `telas-de-erro-so-com-saida-parada`; classe pelo React depois da montagem → `obs-camera-sem-piscar`; abrir o tópico pelo id do dispositivo → `obs-camera-abre-o-topico-da-sua-sessao`; `TelaDoEstado` sem o caso do `obs_camera` → `carregando-invisivel-no-obs-camera`; script sem o `colorScheme` do `obs-camera` → `obs-camera-sem-piscar`; mudar `RELEITURAS_PARA_LIBERAR` para 1 em `saida.ts` → `saida.test.ts` e os testes do palco que o VER-046 citou.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-053 (D8, D10; F9, F10; âncoras do VER-046 que passam a apontar linhas deslocadas do `PalcoNoAr.tsx`, como no VER-047; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 6: aba Ao vivo — situação do vídeo, checklist e troca do `obs_camera`

**Arquivos:**
- Criar: registro `docs/verificacoes/AAAA-MM-DD-054-e4-aba-ao-vivo-video.md`
- Modificar: `src/app/telas/AbaAoVivo.tsx` (+ teste), `src/shared/styles/base.css`, READMEs de `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

  Na lista de dispositivos, a câmera e o `obs_camera` conectados mostram a situação do vídeo da presença (frases curtas: "vídeo chegando", "sem conexão direta", "aguardando toque", "tela pode apagar"...; rótulos e situações como texto React). No checklist (D13 do PLA-004), "Câmera conectada" deixa de ser informativo: **"Vídeo da câmera no OBS"** (pronto com o `obs_camera` em `conectado`; pendente com a frase da situação; sem `obs_camera` pareado: "Gere o link da câmera do OBS") e **"Tela do celular ligada"** (pendente com `sem_trava`, com as instruções do DES-001 §10.4, item 3). O aviso de troca de sessão já existe para todos os tipos (`antigo` em `AbaAoVivo.tsx`); a tarefa só o prova para o `obs_camera`. **`obs_camera` de outra câmera** (revisão 4, N16): o "Link da câmera do OBS" reaproveita só o `obs_camera` ativo cujo `cameraId` é a câmera da aba (`existente(lista, 'camera')`); se o `obs_camera` ativo for de outra câmera, a aba não gera link e mostra "A câmera do OBS está ligada a outra câmera. Revogue a câmera do OBS e gere um link novo.", e o checklist "Vídeo da câmera no OBS" fica pendente com a mesma frase; o `23505` de uma corrida mostra a frase defensiva da D2.

- [ ] **Passo 1: testes (falham).** `situacao-do-video-na-lista` (presença de câmera com `video.estado` `conectado` e de `obs_camera` com `sem_conexao_direta` → as frases; presença inválida descartada); `checklist-video` (`obs_camera` `conectado` → pronto; `sem_conexao_direta` → pendente com a frase; sem `obs_camera` → pendente com "Gere o link da câmera do OBS"); `checklist-tela-ligada` (`sem_trava` → pendente com as instruções; `travada` → pronto; câmera ausente → pendente); `obs-camera-de-outra-camera-avisa` (lista com duas câmeras, a da aba e outra, e o `obs_camera` ativo ligado à outra → nenhum `criarCodigo`, a frase de outra câmera no lugar do link e no checklist; com o `obs_camera` da própria câmera → reaproveitado como antes; `criarCodigo` rejeitado com `duplicado` → a frase defensiva); `repareamento-da-obs-camera-avisa-sessao-antiga` (gerar o link de um `obs_camera` já pareado; quando a lista mostra a sessão nova → `revogacao` com a antiga, 1 vez); `revogar-camera-avisa` (o existente continua: `revogacao` e `dispositivo_mudou`).
- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar; estilos `situacao-do-video`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** reaproveitar o `obs_camera` ativo de qualquer câmera (o `existente` atual) → `obs-camera-de-outra-camera-avisa`; checklist pronto com qualquer `obs_camera` presente → `checklist-video`; ignorar `telaLigada` → `checklist-tela-ligada`; não avisar a sessão antiga do `obs_camera` → `repareamento-da-obs-camera-avisa-sessao-antiga`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-054 (D13; D2 na aba; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 7: conferência no navegador (WebRTC real) e guia do vídeo para o responsável

**Arquivos:**
- Modificar: `supabase/README.md` (seção nova "Vídeo da câmera (E4)", sem reduzir o tamanho mínimo), `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-055-e4-conferencia-e-guia.md`

- [ ] **Passo 1: conferência no navegador sem Supabase nem OBS reais.** `npm run build` com variáveis de mentira só na linha de comando e `--outDir` fora do repositório; `vite preview`; Chromium 153 do Playwright 1.63 do ambiente, fora do repositório, lançado com `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (câmera falsa com o padrão de teste do Chromium), `exemplo.revocast.test` interceptado como na E3 (Auth com login anônimo falso, PostgREST e `rpc` em memória com a semântica das migrações) e o WebSocket do Realtime simulado por `page.routeWebSocket`: o retransmissor Phoenix da E3 ampliado com a matriz da D2 (responde `phx_join` com `ok` ou não autorizado; recusa todo `broadcast` de cliente em `video:*`) e a `rpc('enviar_sinal_de_video')` interceptada com a regra da função (sessão atual, par atual, tipo pelo lado, remetente posto pelo falso) e entregue como mensagem do banco, com `id`, ao tópico da sessão do par. Páginas: painel (`equipe`), `/camera` em 320 px (claro e escuro) e `/obs/camera` com um `window.obsstudio` falso por `addInitScript`. **`RTCPeerConnection` real entre as duas páginas** (o vídeo não passa pelo retransmissor, só os sinais). Conferir, com asserções OK/ERR (como no VER-044):
  1. pareamento da câmera e do `obs_camera` pelos links da aba; o fragmento some;
  2. sem episódio ativo, o toque não liga a câmera (nenhuma faixa `live`); modo teste → a câmera liga, oferta e resposta trafegam, e no `/obs/camera` o `<video>` chega a `videoWidth > 0` e avança `currentTime` (ou `requestVideoFrameCallback` dispara);
  3. no `/camera`, nenhum `<video>` fora da prévia; a prévia some em 15 s; captura de tela preta;
  4. tamanho do SDP da oferta e da resposta (registrar; abaixo de `TAMANHO_MAXIMO_DO_SDP`) e o tipo dos candidatos vistos (`host` com IP ou `.local`, `srflx`; F12);
  5. iniciar o ao vivo a partir do teste → o vídeo **não** cai (mesma sessão de `RTCPeerConnection`);
  6. `track.stop()` forçado na câmera → religa e troca a faixa (`replaceTrack`), o vídeo continua no `/obs/camera`;
  7. `visibilitychange` emulado (escondida e visível) → Wake Lock pedido de novo (ou `sem_trava` registrado, se o *headless* não tiver a API);
  8. derrubar o WebSocket por 5 s → a sinalização volta e, se o vídeo caiu, uma oferta nova o restabelece;
  9. **falha da conexão direta simulada** (revisão 1, I3): o retransmissor (o falso do `realtime.send`) tira as linhas `a=candidate` **dos dois SDPs** (oferta e resposta) e as páginas rodam sem STUN, para nenhum lado aprender um candidato *peer-reflexive*; registrar que o `connectionState` de fato não chegou a `connected` (ficou em `checking` até o prazo de 20 s ou foi a `failed`); a câmera chega a `sem_conexao_direta` com a frase da D6, e a aba Ao vivo mostra a situação; se mesmo assim conectar, a simulação não serviu: bloquear de outro jeito (por exemplo, `iceTransportPolicy: 'relay'` sem TURN, numa cópia do build) e registrar;
  10. parear de novo o `obs_camera` (outra página com sessão nova) com o vídeo no ar → a página antiga não recebe mais nenhum sinal e a `rpc` dela dá `42501`; a câmera passa a falar com a nova; revogar a câmera pela aba → o `/obs/camera` fica vazio e o `RTCPeerConnection` dele vai a `closed`; a câmera mostra "revogado" e as faixas vão a `ended`; revogar o `obs_camera` → a câmera fecha a conexão e espera outro par;
  11. encerrar o ao vivo → a câmera desliga (faixas `ended`), o `/obs/camera` fica vazio;
  12. `/obs/camera` com o OBS falso "transmitindo": nenhum selo pela tecla `s`, nenhuma tela de erro; com a saída parada, selo por 5 s;
  13. `console` das duas páginas sem SDP, candidato, token ou código;
  14. em 320 px, nada estoura.
  Rodar também com 4 sabotagens do script (por exemplo, `rpc` falsa que publica para a sessão antiga depois do repareamento; retransmissor que aceita `broadcast` de cliente em `video:*`; câmera com a prévia sempre visível numa cópia do build) para provar que as asserções pegam falhas. Registrar o que o ambiente não deixa medir (Wake Lock e bateria no *headless*, F13). Scripts e capturas fora do repositório; resultado no registro.
- [ ] **Passo 2:** em `supabase/README.md`, seção "Vídeo da câmera (E4)" com o passo do responsável abaixo (sem e-mail e sem domínio real), a explicação da D2, D6, D7 e D9, e as consultas de conferência (inclusive a contagem de `obs_camera` ativos antes de aplicar a migração e as consultas do dono para revogar o que sobra, lidas pelo teste `e4-guia-conta-obs-cameras` da Tarefa 2).
- [ ] **Passo 3: revisão final da etapa inteira** (VER-049 a VER-055 juntos), antes do relato final; o que ela achar vira item próprio.
- [ ] **Passo 4:** oferecer ao responsável, no relato da tarefa, as decisões D1–D14 e os ajustes do DES-001 que elas sugerem (§6.1, §8 e §10.3, **mudança de desenho da revisão 1, C1**: os sinais de vídeo saem pela função `enviar_sinal_de_video` com `realtime.send`, conferindo a sessão a cada chamada e pondo o remetente no servidor, para o tópico `video:<uid da sessão do par>`, em que nenhum cliente envia, no lugar do Broadcast em `episodio:<id>:video`; abertos só com episódio ativo; custo: os SDPs, com IPs, ficam em `realtime.messages` de 72 h a 4 dias; §8, Segurança, "Toda função": a E4 cria uma função; §2 e §8: um `obs_camera` não revogado no banco, porque várias câmeras simultâneas são não-objetivo (revisão 3, N11); §9: o toque para ligar a câmera antes de o toque mostrar o status; §8: `definir_reconhecimento` e o tópico dos gestos na E5; §10.4: a Fonte do `/obs/camera` com acesso de leitura ao status do OBS; §3 e §10.3: o TURN do Metered continua opcional e desligado por padrão; **teto de disco por desenho** (revisão 4, N17): só o par câmera ↔ `obs_camera` ativo sinaliza, cerca de 2,4 MB por hora e cerca de 230 MB nos até 4 dias de retenção, com a limpeza por `update` do guia), junto das pendências que já aguardam (D1–D16 do PLA-004, a mudança da D6 do VER-047, D7 do PLA-002, Passo 3 da Tarefa 8 do PLA-003); o que ele decidir vira item próprio.
- [ ] **Passo 5:** `npm run check`; registro VER-055 (resultado do Passo 1; o que ficou só para o responsável; estado do passo do responsável); dupla verificação; `npm run check` como último ato; commit; push; relato.
- [ ] **Passo 6: passo do responsável** (fora do código; nenhum agente consegue fazer). Em ordem:
  1. **Pendências anteriores:** se ainda não feitas, as migrações anteriores e o guia "Ao vivo e pareamento (E3)" (inclusive "Allow anonymous sign-ins", "Allow public access" desligado e o JWT de 10 min).
  2. **Banco, no editor SQL, antes de publicar o build da E4 na Vercel** (revisão 1, I1: o app da E4 abre o tópico de vídeo e chama `enviar_sinal_de_video`; sem a migração, a entrada é negada e a `rpc` não existe): rodar a contagem de `obs_camera` ativos do guia; com mais de um, as consultas do guia (revogar pela aba os que sobram); depois aplicar `supabase/migrations/<AAAAMMDDHHMMSS>_video_da_camera.sql` inteiro. Se o editor recusar, **não** contornar: anotar a mensagem para o registro seguinte.
  3. **Conferência por consulta:** `select indexname from pg_indexes where indexname = 'dispositivos_um_obs_camera_ativo';` → 1 linha; `select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';` → as mesmas duas (`canal_recebe`, `canal_envia`); `select count(*) from pg_proc where proname in ('pode_usar_canal', 'enviar_sinal_de_video');` → 2; `select has_function_privilege('anon', 'public.enviar_sinal_de_video(text, uuid, text)', 'execute');` → `false`. Depois, publicar o build da E4.
  4. **Nada de cartão:** sem TURN (padrão). Se a rede real impedir a conexão direta e o responsável quiser o TURN gratuito do Metered (F11): criar a conta grátis **só se o cadastro não pedir cartão**, pôr `VITE_TURN_URL`, `VITE_TURN_USUARIO` e `VITE_TURN_SENHA` nas variáveis da Vercel (nunca no repositório) e lembrar que a credencial fica pública no navegador (cota de 20 GB/mês).
  5. **OBS (Windows, e se possível macOS e Linux; F10):** versão 30.2 ou mais nova; na aba Ao vivo, "Link da câmera do OBS" → Fonte de navegador `/obs/camera` com a URL colada, **"Page permissions": pelo menos "Read access to OBS status information"** (a guarda de saída precisa ler o status; D8), "Shutdown source when not visible" desmarcado, criada uma vez e posta nas cenas **por referência** (DES-001 §10.4); com tudo parado, conferir pela tecla `s` no "Interagir" que o selo aparece e some em 5 s.
  6. **Celular de gravação (Android e iPhone):** abrir o QR da aba ("Parear câmera") pelo navegador padrão (Chrome no Android, Safari no iPhone), pelo endereço `https`; tocar para ligar e permitir a câmera; conferir a câmera **traseira**, a tela preta (nenhuma imagem fora da prévia) e o aviso de tela ligada; sem Wake Lock (iOS < 16.4 ou recusado), aplicar as instruções que a página mostra (DES-001 §10.4, item 3); celular no carregador e no tripé.
  7. **Rede:** celular e computador na mesma rede Wi-Fi; se a rede da faculdade isolar os aparelhos (F14), usar um roteador próprio ou o hotspot do computador (DES-001 §15); anotar se a conexão direta funcionou com dados móveis no celular e Wi-Fi no computador (sem TURN, espera-se `sem_conexao_direta`).
  8. **Nada de dado pessoal:** rótulos de dispositivo genéricos; nenhuma gravação de teste com pessoas que não consentiram.
  9. **Conferência real** (anotar o resultado): modo teste → vídeo no OBS; iniciar o ao vivo → o vídeo não cai; bloquear e desbloquear a tela, trocar de app e voltar, girar o celular (anotar a orientação no OBS); revogar a câmera com a saída **parada** e conferir que o vídeo some no OBS e a câmera desliga; parear de novo; encerrar o ao vivo → câmera desligada; **1 hora** de vídeo contínuo com o celular no carregador: anotar bateria, aquecimento e travadas; repetir com um iPhone.
  10. **Limpeza opcional:** a consulta de sessões anônimas sem dispositivo do guia da E3; e, para não guardar os IPs dos SDPs por até 4 dias (D2, F18; revisão 2, N9; corrigida na revisão 3, I8), no editor SQL, que roda como `postgres`: o `postgres` **não** é dono de `realtime.messages` nem tem `DELETE` nela (F17), então um `delete` dá `42501`; ele tem `UPDATE` e `BYPASSRLS`, e a consulta apaga só o conteúdo: `update realtime.messages set payload = jsonb_build_object('tipo', 'apagado') where topic like 'video:%' and inserted_at < timezone('utc', now()) - interval '1 hour';` (`inserted_at` é UTC sem fuso e não muda, então a linha fica na mesma partição e sai com ela na limpeza do Realtime; a publicação do Realtime só replica `insert` (F22), então o `update` não reenvia nada; um cliente que lesse a linha descartaria o payload, porque o leitor do domínio exige `sessao`; teste `e4-guia-limpa-sinais-antigos`). As linhas em si continuam até a limpeza das partições (até 4 dias), sem os IPs. Para conferir o espaço: `select count(*), pg_size_pretty(sum(pg_column_size(payload))) from realtime.messages where topic like 'video:%';`. Teto por desenho: cerca de 2,4 MB por hora e 230 MB em 4 dias no total (D2, limite por remetente e um `obs_camera` ativo); se a conta passar disso, revogar o dispositivo pela aba Ao vivo e anotar para o registro seguinte.

---

## Ao fim da E4

- O celular vira câmera: `/camera` com tela preta, toque para ligar, Wake Lock (ou instruções), câmera traseira só com vídeo, prévia de 15 s; vídeo por WebRTC direto até o `/obs/camera`, que mostra só o vídeo na Fonte do OBS; sinalização por função do banco (`enviar_sinal_de_video` com `realtime.send`, remetente posto pelo servidor) para o tópico da sessão atual do par, em que nenhum cliente envia, só com episódio ativo; revogação que corta a sinalização e fecha o vídeo dos dois lados; aviso de falta de conexão direta na câmera, no selo e na aba Ao vivo; checklist com o vídeo e a tela do celular.
- `src/domains/captura/` existe (sinais, portas, emissor, receptor); a guarda de saída do OBS mora em `src/domains/obs/saida.ts` e serve o palco e o `/obs/camera`; os adaptadores `conexaoWebrtc.ts` e `cameraNavegador.ts` isolam o navegador.
- **Uma migração nova** (`video_da_camera`: função `enviar_sinal_de_video`; `pode_usar_canal` com o tópico `video:<uid>` só para receber; índice `dispositivos_um_obs_camera_ativo`), **nenhuma dependência nova**, nenhuma tabela, política ou privilégio de tabela novo; `realtime.send` na simulação; o `episodio:<id>:video` do desenho continua fechado.
- Fica para a E5: gestos (MediaPipe), `definir_reconhecimento` e a leitura de `reconhecer_no`, o tópico dos gestos (com autor por tópico), o interruptor de gestos e `definir_gestos_ligados`. Para a E6: registro de ações no painel, checklist completo, ajustes de uso real (inclusive o que a hora de bateria e a rede real ensinarem).
- Pendências conhecidas: o teto de disco por desenho dos sinais em `realtime.messages`, cerca de 2,4 MB por hora e cerca de 230 MB nos até 4 dias (só o par câmera ↔ `obs_camera` ativo sinaliza; revisão 4, N17), apagável só no conteúdo pelo `update` do guia; com mais de uma câmera criada pela API, o `obs_camera` ativo pode estar ligado a outra câmera (a aba avisa e não reaproveita, N16; pela API direta, o vídeo não conecta sem outro aviso que o `sem_par`/`aguardando_par`); sem TURN, redes com NAT simétrico, dados móveis ou Wi-Fi com isolamento de clientes não conectam (aviso e reserva física, D6, D9); o TURN gratuito, se ligado, tem credencial pública e cota de 20 GB/mês; o remetente dos sinais de vídeo é posto pelo servidor e a sessão antiga não sinaliza nem recebe sinais novos (D2), mas o `RTCPeerConnection` já aberto com ela só fecha pelo lado que coopera (DES-001 §8); os SDPs, com IPs de rede, ficam em `realtime.messages` de 72 h a 4 dias (F18); `realtime.send` engole erros e depende da partição do dia criada pelos clientes conectados (F19), e quem percebe a perda é a espera da D6; a simulação dá ao `postgres_sim` o efeito do `BYPASSRLS` do `postgres` real por outro caminho (participação no dono, F17); o ICE não incremental pode atrasar o começo em até 3 s; a câmera não liga sozinha depois de recarregar (exige o toque, de propósito); WebRTC na Fonte do OBS, Wake Lock e gesto no iPhone, orientação e consumo dependem da conferência real (F6, F7, F10); a limitação N5 continua (uma `pode_usar_canal` que devolva `true` passaria nas duas checagens; só os testes de banco pegam); a migração nova e a conferência real dependem do responsável; os ajustes do DES-001 oferecidos no Passo 4 da Tarefa 7.
