# E3 — Primeiro ao vivo por toque: plano de implementação

> **Para agentes:** execute tarefa por tarefa (superpowers:executing-plans ou superpowers:subagent-driven-development), **sempre sob as regras do `CLAUDE.md`, que prevalecem sobre as dessas skills**, com as decisões vigentes do responsável abaixo: trabalhar direto na `branchTrabalho`, sem worktree e sem criar branch; subagentes implementam e verificam, mas **não** fazem commit, push, merge nem PR e param antes do passo de commit; quem faz o commit local (versão limpa) é o agente principal (`CLAUDE.md`, desde o VER-013), e o push de cada item verificado segue a autorização permanente da decisão (b); `finishing-a-development-branch` não é usada. Os passos usam caixas (`- [ ]`) para acompanhamento.

| Campo | Valor |
|---|---|
| Id | PLA-004 |
| Etapa | E3 do DES-001 |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status | em execução, autonomia concedida pelo responsável em 2026-11-26 |

**Objetivo:** o primeiro ao vivo por toque. A equipe **pareia** os dispositivos pela aba **Ao vivo** do `/painel` (QR e link com um código de uso único que vale 2 min; o dispositivo entra com **login anônimo** e chama `parear_dispositivo`), **revoga** quando precisar (no banco na hora; aviso pelo canal `estudio`), escolhe o **modo teste**, **inicia e encerra o ao vivo**. O `/obs/palco`, numa Fonte de navegador do OBS, segue o episódio ativo e executa **cena, som, aviso, clipe e marcador** pedidos por **toque** no `/controle` (celular de qualquer membro) ou na aba Ao vivo, publica o estado no ar e grava `registro_acoes`. No banco, uma migração nova cria as funções de pareamento, de episódio ativo e de estado do episódio, e as políticas de `realtime.messages`; a simulação do Supabase ganha o schema `realtime`, e as checagens de banco passam a aceitar **só** as duas políticas do canal, sem afrouxar o resto.

**Arquitetura:** DDD + GRASP Pure Fabrication + Componentes (DES-001 §6). O pareamento entra no contexto **Acesso** (`src/domains/acesso/dispositivos.ts`: `Dispositivo`, `CodigoDePareamento`, como no DES-001 §6); nasce `src/domains/aovivo/` (contexto **Ao vivo**: mensagens dos canais com validação, `Comando`, `EstadoNoAr`, registro e o serviço do palco, que só conhece portas) e `src/domains/obs/` (contexto **Integração OBS**, camada anticorrupção: `ExecutorOBS` sobre as portas `ObsNoNavegador` e `ObsWebsocket`). As fabricações puras ficam em `src/shared/infra/` (`dispositivoSupabase.ts`, `aoVivoSupabase.ts`, `canalSupabase.ts` = o `CanalAoVivo` do DES-001 §6.1, `obsNavegador.ts`, `obsWebsocket.ts`, `qr.ts`), a composição em `src/app/servicos.ts` (cliente de membro único; um cliente por **tipo** de dispositivo, só na rota dele) e as telas em `src/app/telas/`. Testes: domínio puro; adaptadores com cliente Supabase, canal, `window.obsstudio` e `WebSocket` falsos; banco e canais em PGlite com a simulação (ampliada com `realtime`).

**Tecnologias:** React 19.3.1, `@supabase/supabase-js` 2.119.0 (`realtime-js` 2.119.0: canais privados, `broadcast` com `ack`, presença), Vitest 5.1.0, jsdom 31.0.1, `@testing-library/react` 16.3.3, `@electric-sql/pglite` 0.5.16 (Postgres 18.6: `pg_catalog.sha256` e `gen_random_uuid` sem extensão, conferido por sonda em 2026-11-27), TypeScript 7.0.2. **Uma dependência nova**, `lean-qr` (D11), só na Tarefa 8. obs-websocket com `WebSocket` e `crypto.subtle` nativos (D10).

**Desenho:** [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md), seções 4.3, 4.4, 5–10, 12, 13, 15 e 16. **Planos anteriores:** [PLA-001](2026-11-17-e0-fundacao.md) ("Ao fim da E0": políticas de `realtime.messages` e as funções da E3), [PLA-002](2026-11-26-e1-entrada-e-membros.md) (D4: aviso de revogação de membro; D5: login anônimo) e [PLA-003](2026-11-26-e2-preparar-episodio.md) (D2: iniciar e encerrar o ao vivo; D3: o `obs_palco` lê o bucket; "Ao fim da E2": `equipe` muda `estado` pela API).

## Decisões vigentes do responsável

- **(a) 2026-11-22:** "Se a gravidade de erros for aceitável, prossiga sem necessidade de refazer dois testes seguidos." Aplicação: achado de texto, documentação, nit ou teste a mais, **sem** tocar segurança, **sem** mudar comportamento de código e **sem** enfraquecer teste → corrigir + reconferência pontual (testes, typecheck ou checagem do que foi tocado), registrada; qualquer outro achado → corrigir e verificar de novo, até duas rodadas seguidas sem erro.
- **(b) 2026-11-26:** "Seja autonomo, pode seguir e me entregar o projeto completo." Dada pelo responsável **em resposta ao pedido de push** e registrada no VER-014. Aplicação:
  - o agente principal segue sem pedir aprovação a cada tarefa;
  - a frase vale como **autorização explícita e permanente para o push de cada item verificado da entrega E1–E6** (`git push origin branchTrabalho`), no lugar do pedido de autorização a cada push que a seção "Branch e Git" do `CLAUDE.md` exige;
  - cada push continua informando o estado: a lista dos commits enviados, em ordem, com hash e resumo, os refeitos e as correções simples que foram junto;
  - o `CLAUDE.md` **não é editado**; se o responsável revogar a autorização, volta a regra do `CLAUDE.md` (pedido de autorização a cada push);
  - continuam proibidos sem pedido explícito do responsável: criar, renomear ou apagar branch; merge; PR; trazer conteúdo de outra branch ou do remoto; descartar trabalho (commit, stash ou alteração não commitada); reescrever commit enviado; fundir commits de itens diferentes.
- **(c) 2026-11-26 ("Resolve"):** dependência npm nova só pelo procedimento do npm 11 descrito em "Restrições globais" (registrado no PLA-002, restrição "Dependência npm nova").

## Restrições globais

Revistas uma a uma a partir do PLA-003; as que mudaram dizem desde quando.

- Nenhum serviço com cartão; nenhum custo mensal (DES-001 §2). Storage: 50 MB por arquivo e 1 GB no total (PLA-003, D7). Realtime do plano Free: canais e mensagens com limites de uso; a E3 manda poucas mensagens (comandos por toque, estado a cada 30 s, presença).
- Banco normalizado; RLS em todas as tabelas; papéis do app conferidos dentro do banco por `papel_atual()` e `dispositivo_atual()` (DES-001 §8). **A interface nunca decide acesso a dado nem a canal**: ela só escolhe o que mostrar; quem nega é a RLS (no Storage, as políticas de `storage.objects`; no Realtime, as de `realtime.messages`).
- `papel_atual()` só aceita sessão **não anônima**, provedor `google` e `email_confirmed_at` não nulo; e-mail comparado em minúsculas. `dispositivo_atual()` só vale para sessão **anônima**, dispositivo não revogado e `usuario_anonimo_id = auth.uid()`.
- **Privilégios (desde o VER-010/VER-011):** em `public`, `grant` explícito por tabela (ou por coluna) só a `authenticated` e só das operações que alguma política permite; nada para `anon` e `service_role`. **Muda na E3 (D7):** `episodios` passa a ter `insert` só nas colunas `titulo`, `data`, `criado_por` e `update` só em `titulo`, `data`; `estudio_estado` perde o `update` (fica só leitura; a escrita é por função). Os de `storage.*` e `realtime.*` são os do Supabase, que a migração não altera.
- **Funções (desde o VER-011):** `SECURITY DEFINER`, `set search_path = ''`, `EXECUTE` só para `authenticated`, corpo que chama `papel_atual()` ou `dispositivo_atual()`; exceções em [`scripts/README.md`](../../scripts/README.md) (`parear_dispositivo` já está lá). **A E3 cria nove funções** (D2, D4, D6, D7): `criar_codigo_pareamento`, `parear_dispositivo`, `meu_dispositivo`, `revogar_dispositivo`, `episodio_ativo`, `iniciar_ao_vivo`, `encerrar_ao_vivo`, `definir_modo_teste` e `pode_usar_canal`. Funções do Postgres dentro delas sempre com `pg_catalog.` (o `search_path` é vazio).
- `codigos_pareamento` e a tabela nova `tentativas_pareamento`: RLS ativa, **nenhuma** política, `revoke all`; ambas em `SOMENTE_FUNCOES` (Tarefa 3).
- **Migrações:** migração já aplicada **nunca é editada**, nem de passagem numa sabotagem (sabotagens em memória, pelo laço de `banco.ts`); mudança de banco = migração nova em `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql` (data e hora do commit da tarefa), testada em PGlite, com `rpc:grants-check` e `data-api:check` passando, e acrescentada ao passo do responsável. **A E3 tem uma migração nova**, `<AAAAMMDDHHMMSS>_ao_vivo_e_pareamento.sql` (Tarefa 3).
- **Realtime (novo nesta etapa, D6):** só canais **privados** (`private: true`); acesso público ao Realtime desligado no projeto (passo do responsável). Na E3 existem dois tópicos: `estudio` e `episodio:<id do episódio ativo>:controle`; `episodio:<id>:video` fica **fechado** até a E4. Quem recebe e quem envia em cada um é decidido **só** por `public.pode_usar_canal(topico, extensao, enviar)`, chamada pelas duas políticas de `realtime.messages`; toda mensagem recebida é **validada** no domínio antes de qualquer efeito (forma, tamanhos, uuid em minúsculas) e leva o `remetente` declarado (DES-001 §8: o Broadcast não autentica o remetente; o corte garantido é a revalidação na renovação do token de 10 min).
- **Pareamento (novo nesta etapa, D2–D4):** código aleatório de 244 bits, de uso único, válido por 2 min, guardado **só** como hash SHA-256; `parear_dispositivo` só para sessão anônima, com limite de tentativas falhas por sessão; o código chega pelo **fragmento** (`#`), sai da URL antes de qualquer chamada de rede, vive só na memória e nunca vai para `localStorage`, `sessionStorage`, `console`, URL de servidor ou registro; o banco só recebe o código no corpo da chamada `rpc`.
- **Tempo-limite:** o `fetch` com 15 s continua só em `/rest/v1/` (inclusive `/rest/v1/rpc/`) e `/auth/v1/` (VER-021); o Realtime usa WebSocket (reconexão do `realtime-js`), e o envio com `ack` tem o tempo do próprio `realtime-js` (D15). Storage segue fora (VER-027).
- **Rotas e clientes (atualizada; desde a E3):** rotas por caminho; o fragmento das rotas de dispositivo é do código de pareamento. O cliente de membro (`storageKey` `revocast-auth-membro`) continua só nas rotas de membro, criado uma vez por página e reaproveitado por acesso, preparação e ao vivo. **Cada rota de dispositivo cria só o seu cliente** (`revocast-auth-camera`, `revocast-auth-obs_palco`, `revocast-auth-obs_camera`, `detectSessionInUrl: false`), preguiçoso e uma vez por página; nenhuma rota cria cliente de outro tipo (testes `caminho-padrao-nao-cria-cliente-em-dispositivo` reescrito e `dispositivo-cria-so-o-proprio-cliente`, Tarefa 4).
- Variáveis públicas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; nenhuma nova (TURN é da E4).
- **Dependência npm nova (decisão (c)):** só quando a etapa precisar dela de verdade; **a E3 precisa de uma**, `lean-qr` (D11, Tarefa 8). Procedimento, com o npm 11 via `npx -y npm@11` (versão 11.21.2), nunca com o npm 10.9.9 local: (1) versão exata, com `--save-exact --ignore-scripts --before=<data com pelo menos 2 semanas antes>`; (2) conferir o diff do `package-lock.json` (só o pacote muda; os campos `libc` continuam lá); (3) `check-deps-audit` com 0 erros; (4) justificar no registro do item. `npm ci` e `npm install` direto com o npm 10 continuam proibidos. O Playwright do ambiente serve só para a conferência manual (Tarefa 10) e não vira dependência. **Sem `obs-websocket-js`** (D10).
- **Testes sem projeto Supabase real e sem OBS real:** interface (jsdom) com falsos das portas (sem `vi.mock` do supabase-js nos testes de tela, exceto os de caminho padrão, que simulam `createClient` para contar clientes); adaptadores com cliente Supabase, canal Realtime, `window.obsstudio` e `WebSocket` falsos injetados; banco e canais em PGlite com a simulação (ampliada com `realtime` na Tarefa 2). Os falsos imitam o que muda o comportamento da tela (o canal falso passa por `conectando` → `conectado`, pode cair para `reconectando`, e o `ack` pode responder `sem_resposta`; o OBS falso tem nível de controle, cenas, Replay Buffer ligado ou não).
- Todo arquivo de teste importa `describe`, `test`, `expect` (e o que mais usar) de `vitest`, sem `globals`; testes de tela com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)`.
- **Segurança de interface:** nada de `innerHTML` nem `dangerouslySetInnerHTML` (inclusive no QR e no palco); texto vindo de fora (título e texto de aviso, rótulo de dispositivo, nome de cena do OBS, rótulo de som) é sempre texto React; no palco o link do aviso é **texto** (ninguém clica na transmissão); nunca mostrar mensagem ou pilha de erro inesperado nem a mensagem do servidor (só mensagens fixas por motivo); nunca registrar token, sessão, e-mail, código de pareamento, URL assinada ou senha do OBS em `console`.
- O ouvinte de `onAuthStateChange` nunca chama o Supabase dentro do callback (E1); o mesmo vale para os ouvintes do canal: eles só agendam (`setTimeout(..., 0)`) o que chama o Supabase.
- Redirect URLs do Supabase sem curinga de host (E1, mantida).
- Visual: tokens do RevoCast, claro e escuro; estilos novos em `src/shared/styles/base.css`, só com as variáveis de `tokens.css`; nada estoura em 320 px; `/controle` é mobile-first (botões de pelo menos 44 px, nada que dependa de `hover`). **O palco tem fundo transparente** e não mostra nada além do aviso no ar durante o `ao_vivo` (D16).
- `erasableSyntaxOnly` ligado: sem propriedades de parâmetro no construtor, sem `enum`, sem `namespace`; `import type` para tipos (`verbatimModuleSyntax`).
- **Dupla verificação do `CLAUDE.md` em toda tarefa**, antes do commit, com a decisão (a): rodadas de revisão independente sobre a mudança da tarefa (por outra abordagem que não o `npm run check`) até duas seguidas sem erro; sugestões importantes dos revisores entram; o resultado de cada rodada vai para a seção "Verificação" do registro. **Toda sabotagem citada como prova é executada e o teste que ela derruba é anotado no registro**; sabotagem que não derruba nada é achado.
- Processo do repositório: todo diretório novo com `README.md` de 11 seções no mesmo commit; README atualizado no commit que mexe nos arquivos da pasta ("Onde" e campo "Arquivos"); todo commit com registro em `docs/verificacoes/`; `npm run check` com 0 erros sobre exatamente o conteúdo do commit; commit pelo agente principal e push pela decisão (b); branch `branchTrabalho`.
- Nenhum e-mail real ou segredo em arquivo versionado; e-mails de teste no domínio reservado `revocast.test`; nenhum nome de pessoa real nos testes; senha do OBS nos testes só como texto fixo de teste (`'senha-de-teste'`), nunca uma senha real.
- **Âncoras de registros antigos:** nenhum arquivo citado por elas pode ficar menor do que a âncora aponta (o `check-docs` confere). Mínimos levantados em 2026-11-27 dos arquivos que a E3 pode tocar: `CLAUDE.md` 133, `docs/verificacoes/README.md` 93, `docs/planos/README.md` 68, `docs/desenho/README.md` 68, o DES-001 394, o PLA-001 315, o PLA-002 713, o PLA-003 700, `scripts/README.md` 103, `scripts/_catalogo.mjs` 724, `scripts/check-data-api.mjs` 291, `scripts/check-rpc-grants.mjs` 102, `scripts/check-docs.mjs` 78, `scripts/check-doc-secrets.mjs` 33, `scripts/tests/README.md` 63, `scripts/tests/catalogo.test.mjs` 385, `scripts/tests/check-data-api.test.mjs` 1248, `scripts/tests/executaveis.test.mjs` 246, `package.json` 36, `src/README.md` 47, `src/domains/README.md` 79, `src/domains/arquitetura.test.ts` 63, `src/domains/acesso/README.md` 118, `src/domains/acesso/portas.ts` 44, `src/domains/preparacao/README.md` 140, `src/app/App.tsx` 34, `src/app/App.test.tsx` 90, `src/app/rotas.ts` 31, `src/app/dependencias.ts` 61, `src/app/dependencias.test.ts` 61, `src/app/servicos.ts` 75, `src/app/servicos.test.ts` 117, `src/app/servicosFalsos.ts` 232, `src/app/acesso.test.tsx` 381, `src/app/GuardaDeMembro.tsx` 38, `src/app/telas/Controle.tsx` 12, `src/app/telas/Painel.tsx` 75, `src/app/telas/Painel.test.tsx` 126, `src/app/telas/AbaMembros.tsx` 340, `src/app/telas/AbaMembros.test.tsx` 430, `src/app/telas/AbaEpisodios.tsx` 13, `src/shared/README.md` 14, `src/shared/infra/README.md` 95, `src/shared/infra/acessoSupabase.ts` 175, `src/shared/infra/errosSupabase.ts` 43, `src/shared/infra/supabase.ts` 40, `src/shared/infra/supabase.test.ts` 121, `src/shared/infra/tempoLimite.ts` 81, `src/shared/ui/Abas.tsx` 88, `src/shared/ui/Mensagem.tsx` 10, `src/shared/styles/base.css` 304, `src/shared/styles/tokens.css` 40, `supabase/README.md` 172, `supabase/migrations/README.md` 93, `supabase/tests/README.md` 113, `supabase/tests/banco.ts` 219, `supabase/tests/rls.test.ts` 1248, `supabase/tests/matriz.test.ts` 122, `supabase/tests/restricoes.test.ts` 301, `supabase/tests/simulacao-supabase.sql` 161, `supabase/tests/dono-migracao.sql` 67, as três migrações existentes (409, 22 e 34; nunca editadas); e este plano, a partir do commit que o introduz, o tamanho com que entrar. Conferidos de novo depois do VER-033; antes de encolher qualquer arquivo, conferir com o `check-docs`.
- Datas nos nomes dos registros e da migração: a data do commit (se a execução cair em outro dia, o nome acompanha).

## Decisões sobre lacunas e divergências do desenho (propostas pelo agente sob a decisão (b); cada uma é registrada no VER da tarefa dona)

**D1. Onde fica cada coisa.** Pareamento e dispositivos no domínio `acesso` (DES-001 §6 lista `Dispositivo` e `CodigoDePareamento` em Acesso), num arquivo próprio (`dispositivos.ts`) e numa porta própria (`portasDeDispositivo.ts`), sem mexer no que a E1 provou. `src/domains/aovivo/` guarda mensagens, comandos, estado no ar, registro e o **serviço do palco** (o palco é o único executor, DES-001 §10.1), que depende só de portas, inclusive `ExecutorDeAcoes`; `src/domains/obs/` implementa esse executor sobre as portas do OBS e importa de `aovivo` só tipos (`AcaoNoObs`). Assim `aovivo` não conhece OBS, e `obs` não conhece canal nem banco.

**D2. Código de pareamento.** O DES-001 §8 pede "código aleatório de 128 bits"; o pedido da etapa fala em "código curto". O código **não é digitado** (vai no QR ou no link colado na Fonte do OBS), então a força vem da entropia, não do tamanho:
- gerado no banco por `criar_codigo_pareamento` com `pg_catalog.gen_random_uuid()` (gerador forte do Postgres, `pg_strong_random`) duas vezes: 244 bits aleatórios, em base64url sem `=`, **43 caracteres** `[A-Za-z0-9_-]`; sem `pgcrypto` (`sha256` e `gen_random_uuid` são do núcleo do Postgres desde a 11 e a 13; conferido no PGlite 18.6 em 2026-11-27);
- guardado só como `encode(sha256(convert_to(codigo, 'UTF8')), 'hex')` em `codigo_hash` (único); a função devolve o código **uma vez** e ele nunca é gravado em claro;
- vale 2 min (`expira_em`, padrão da tabela); uso único (`usado_em`, com `for update` contra corrida); um código novo do mesmo dispositivo apaga o pendente anterior; revogar apaga os pendentes (DES-001 §8);
- **força bruta:** 244 bits tornam o palpite inviável; mesmo assim, `parear_dispositivo` registra cada tentativa falha em `tentativas_pareamento` e, com **5 falhas em 10 min** na mesma sessão anônima, responde `limite` sem nem procurar o código; trocar de sessão esbarra no limite de logins anônimos por IP do Supabase Auth (passo do responsável); limpeza das tentativas e dos códigos com mais de 1 dia dentro das próprias funções;
- `parear_dispositivo(p_codigo, p_tipo)` recebe o **tipo da rota**: código válido de outro tipo responde `tipo_errado` **sem consumir** o código (o link do palco aberto em `/camera` não estraga o pareamento); o resultado é uma linha `(resultado, dispositivo, nome)` com `resultado` em `pareado`, `invalido`, `tipo_errado`, `limite` (sem exceção, para que a tentativa falha fique gravada); sessão não anônima recebe `42501`.

| Alternativa | Motivo de descarte |
|---|---|
| Código curto digitável (6 a 8 caracteres) | Exigiria limite de tentativas global (que vira negação de serviço) e mais tempo de vida; o código nunca é digitado |
| `pgcrypto` (`gen_random_bytes`, `digest`) | No Supabase fica no schema `extensions`, que o `search_path = ''` obriga a qualificar e a simulação não tem; o núcleo do Postgres já dá o necessário |
| Gerar o código no navegador e mandar o hash | O banco deixaria de garantir a aleatoriedade; um cliente com defeito geraria códigos fracos |

**D3. O fragmento.** A rota de dispositivo lê `location.hash` **uma vez**, confere a forma (`^[A-Za-z0-9_-]{43}$`; fora dela → `link_invalido` sem rede) e apaga o fragmento com `history.replaceState` **antes** de qualquer chamada (teste `fragmento-limpo-antes-da-rede`). O código fica numa variável da avaliação e some com ela. Se a página já tem um dispositivo válido daquele tipo, o fragmento é ignorado (recarregar o OBS não tenta parear de novo). Na Fonte do OBS a URL configurada continua com o código já usado: inútil (uso único) e registrado em Riscos. No painel, o link e o QR existem só no estado do componente, somem ao expirar, ao parear ou ao sair da aba.

**D4. Sessão dos dispositivos.** Um cliente Supabase por tipo (`storageKey` por tipo, DES-001 §8). A avaliação (`resolverDispositivo`, Tarefa 1) segue esta ordem: sessão não anônima nesse cliente → `sair()` local; sessão anônima com dispositivo do mesmo tipo (lido por `meu_dispositivo()`, abaixo) → `pareado` (fragmento ignorado); sessão anônima sem dispositivo (revogado, nunca pareado ou pareamento incompleto) → `sair()` local e, havendo código, um **login anônimo novo** e o pareamento (assim a sessão revogada nunca volta a valer, e o aviso de revogação que citou o `uid` antigo não atinge o aparelho pareado de novo), e, sem código, `sem_link` (depois de recarregar, a tela não sabe se houve revogação e não diz "revogado"; "revogado" só aparece ao vivo, pelo aviso do canal); sem sessão e sem código → `sem_link`. Toda resposta do pareamento que não seja `pareado` (`invalido`, `limite`, `tipo_errado`) termina com `sair()`: nenhuma sessão anônima sem dispositivo fica guardada (revisão do plano, N1).

  **Rótulo do dispositivo pareado (revisão do plano, I2).** `dispositivo_atual()` devolve só `(id, tipo, camera_id)`, o `obs_palco` não lê `dispositivos` (a política `dispositivos_proprio_le` vale só para `camera` e `obs_camera`), e mudar o tipo de retorno da função de fundação exigiria `drop` (derruba as políticas que dependem dela; a migração aplicada nunca é editada). Escolha: função nova `public.meu_dispositivo()` `SECURITY DEFINER`, `stable`, que devolve **só a linha da própria sessão**, `(id, tipo, rotulo, camera_id)`, por junção com `dispositivo_atual()`; nada para membros, sessão anônima sem dispositivo ou dispositivo revogado.

  | Alternativa | Motivo de descarte |
  |---|---|
  | Política "dispositivo lê a própria linha" em `dispositivos` para todos os tipos | Abriria ao palco todas as colunas da própria linha (`usuario_anonimo_id`, `criado_por`, datas) e mexeria numa política que a matriz da E0 prova; a função devolve só as quatro colunas usadas |
  | Tirar o rótulo do caminho "já pareado" | O palco e a câmera mostram o rótulo depois de recarregar (o caminho normal do OBS) |
  | Ler o rótulo pela tabela só para a câmera | Dois caminhos para a mesma informação, e o palco continuaria sem rótulo |

  O login anônimo do Supabase passa a ser usado (PLA-002, D5): é ligado no passo do responsável, com o limite por IP; uma sessão anônima sem dispositivo não lê nada (RLS) e não entra em canal nenhum (`pode_usar_canal`).

**D5. Revogação.** `revogar_dispositivo(id)` (só `equipe`/`admin`) marca `revogado_em`, apaga os códigos pendentes e **devolve o `usuario_anonimo_id`** revogado (mantido na linha, para o aviso e a auditoria). O painel publica em `estudio` `{ evento: 'revogacao', usuario }`. O aparelho daquela sessão sai dos canais, faz `sair()` local e mostra "Este dispositivo foi revogado"; os demais descartam mensagens desse remetente por **15 min** (mais que a validade de 10 min do JWT, depois da qual vale a revalidação do Realtime; sem bloquear para sempre quem for liberado de novo). **Parear de novo** um dispositivo existente (trocar o celular): o painel guarda o `usuario_anonimo_id` antigo ao gerar o código e, quando a lista de dispositivos mostra a troca, publica a `revogacao` da sessão antiga (DES-001 §8). **Membros (PLA-002, D4):** só a **remoção** de um e-mail da lista revoga: se o e-mail está ligado a um perfil, o painel publica `revogacao` com o `id` do perfil; o `/controle` e o painel da pessoa reavaliam o acesso (`reavaliar()`), e o palco passa a descartar os comandos dela pelos mesmos 15 min. **Trocar o papel não revoga** (revisão do plano, I4): pelo DES-001 §9 (`/controle`: apresentadora, equipe, admin) e §8 ("`admin`/`equipe`/`apresentadora` enviam e recebem em `:controle`"), os três papéis comandam, e a lista só tem esses três (`papel_app`), então nenhuma troca tira o comando; quem perde o painel (de `equipe`/`admin` para `apresentadora`) perde-o na hora no banco e na tela na próxima reavaliação (E1), sem aviso pelo canal e sem descarte no palco. Sem canal conectado, a tela diz que a revogação valeu no banco e que o corte garantido do canal vem em até 10 min.

**D6. Políticas de `realtime.messages` por uma função só.** O servidor do Realtime confere a autorização de um canal privado ao entrar (e de novo ao reconectar e na renovação do token; a Tarefa 2 confirma com a fonte) pela função do banco `realtime.authorize(role_name, topic_name, claims, sub, headers, read_extensions, write_extensions)`, numa ida só, que avalia as políticas de `select` (receber) e `insert` (enviar) de `realtime.messages` para cada extensão, com `realtime.topic()` e a coluna `extension`; a inserção e o `select` numa transação são só o caminho de reserva do servidor (`authorization.ex`, revisão do plano, I6). As extensões de escrita são `broadcast`, `presence` e `persistence`; a E3 só usa as duas primeiras, e `persistence` (e qualquer outra) é sempre `false`. Em vez de várias políticas com o tópico em texto (frágeis de conferir e somadas por OR), **duas políticas fixas** chamam `public.pode_usar_canal(realtime.topic(), extension, false|true)`, uma função `SECURITY DEFINER` com a matriz inteira, testada caso a caso em PGlite:

| Tópico | Receber (`select`) | Enviar `presence` | Enviar `broadcast` |
|---|---|---|---|
| `estudio` | todo membro com papel e todo dispositivo não revogado | os mesmos | só `equipe`/`admin` (`episodio_ativo_mudou`, `dispositivo_mudou`, `revogacao`) |
| `episodio:<ativo>:controle` | todo membro e o `obs_palco` | só membros | todo membro (`comando`) e o `obs_palco` (`estado`) |
| `episodio:<id>:video`, outro episódio, qualquer outro tópico | ninguém | ninguém | ninguém |
| qualquer tópico, extensão `persistence` ou outra | ninguém | ninguém | ninguém |

O `<ativo>` é o `id` de `episodio_ativo()` na hora da conferência: quando o episódio ativo muda, o tópico antigo deixa de autorizar **só** em quem entra, reconecta ou renova o token (até 10 min); quem já estava no canal antigo continua nele até então (revisão do plano, N6; Riscos). Por isso todo cliente, ao receber `episodio_ativo_mudou`, sai do tópico antigo por conta própria, e o palco só executa comandos do tópico do episódio que ele mesmo consultou. O `data-api:check` aceita em `realtime.messages` **só** essas duas políticas, com o texto exato que o PGlite imprime, e confere que a função chamada é exatamente `public.pode_usar_canal(text, text, boolean)` (Tarefa 2, revisão do plano, N5); o `rpc:grants-check` trata essa função como as outras (`SECURITY DEFINER`, `search_path` vazio, chamada de papel por análise). Limite que sobra (Riscos): um `create or replace` dessa função que devolva `true` com uma chamada de papel decorativa passaria nas duas checagens; só os testes de banco (`e3-canal-matriz`) o pegam. O `:video` abre na E4 com `create or replace function` numa migração nova.

**D7. Estado do episódio só por função.** Fecha o limite dos Riscos do VER-030 ("equipe muda `estado` pela API"): `iniciar_ao_vivo(id)` (rascunho → ao vivo; limpa `episodio_teste_id`; dois ao vivo → `23505` do índice `episodios_um_ao_vivo`), `encerrar_ao_vivo(id)` (ao vivo → encerrado, `gestos_ligados = false`, limpa o teste) e `definir_modo_teste(id ou nulo)` (só rascunho; recusado com `55000` enquanto há ao vivo); todas só para `equipe`/`admin`. Privilégios por coluna: `episodios` com `insert (titulo, data, criado_por)` e `update (titulo, data)` (o adaptador da E2 já manda só isso); `estudio_estado` sem `update` (política de update apagada); política de `delete` de `episodios` recriada com `estado = 'rascunho'`. Códigos de erro das funções: `42501` negado, `22023` parâmetro inválido, `55000` estado não permite, `23505` dois ao vivo.

**D8. O que fica para depois.** `definir_gestos_ligados` (interruptor de gestos) e `definir_reconhecimento` (onde reconhecer) entram na E5/E4, onde são usadas (função sem uso seria código morto); o tópico `:video` e a sinalização entram na E4; o registro de ações em tempo real e o checklist completo, na E6 (a E3 tem o checklist mínimo da D13).

**D9. Comandos, estado no ar e registro.** `Comando` = `{ id: uuid, acao }` com `acao` em `cena` (`cenaId`), `proxima_cena`, `som` (`somId`), `aviso` (`avisoId`), `proximo_aviso`, `ocultar_aviso`, `clipe`, `marcador`. O palco valida (`lerComando`), descarta repetido (últimos 200 `id`) e de remetente revogado, resolve contra as listas carregadas (`resolverComando`: cena, som ou aviso que não existe → recusa com motivo, nada é executado), executa, atualiza o `EstadoNoAr` (`{ episodioId, modo, cenaObs, avisoId, avisoAte, ultimo: { comandoId, acao, resultado: 'ok' | 'pendente' | 'recusado' | 'falhou', motivo }, obs }`, só ids e o nome da cena do OBS; o `/controle` mostra títulos pelas listas que ele mesmo lê) e o publica depois de cada mudança, a cada 30 s e quando alguém entra no `:controle` (DES-001 §8). Clipe: um pendente por vez, espera de 5 s (`ESPERA_DO_CLIPE_MS`, DES-001 §10.1 e §16). `proxima_cena` segue a `ordem` das cenas a partir da cena atual do OBS (volta ao início no fim); `proximo_aviso` segue a `ordem` a partir do aviso atual e para no último (`fim_dos_avisos`). Registro: `registro_acoes` com `origem = 'toque'`, `membro_id` = remetente declarado (DES-001 §8), `teste` = modo teste; **o enum `acao_gesto` não tem "mostrar o aviso X"**, então esse toque é gravado como `proximo_aviso` com `aviso_id` do aviso mostrado (significado: "aviso no ar"; a E6 mostra assim); falha ao gravar o registro não desfaz nem bloqueia a ação.

**D10. obs-websocket sem biblioteca.** O marcador (`CreateRecordChapter`) e a versão do OBS (`GetVersion`) usam o protocolo v5 do obs-websocket com `WebSocket` nativo (subprotocolo `obswebsocket.json`): `Hello` (op 0) → `Identify` (op 1, `rpcVersion: 1`, `authentication` = base64(SHA-256(base64(SHA-256(senha + salt)) + challenge)) por `crypto.subtle`) → `Identified` (op 2) → `Request` (op 6) / `RequestResponse` (op 7); fechamento `4009` = senha errada. `ws://127.0.0.1:<porta>` (padrão 4455). A senha fica no `localStorage` da Fonte de navegador (DES-001 §8), nunca sai do computador (vai só o hash de autenticação ao OBS local) e nunca aparece no estado, na presença nem no `console`. O painel de configuração do palco fica **escondido**: abre com a tecla `c` no "Interagir" da Fonte, diz no topo "Este painel aparece na transmissão: configure antes de ir ao ar.", usa campo mascarado (`type="password"`, a senha salva nunca volta ao campo) e fecha sozinho em 2 min. Ele **não abre** (e fecha na hora, se aberto) quando o OBS diz que a saída está no ar ou sendo guardada: `getStatus()` com `streaming`, `recording`, `virtualcam` ou `replaybuffer` verdadeiro (o Replay Buffer também conta: um clipe salvo com o painel aberto o levaria para as redes), ou status desconhecido (nível abaixo de `READ_OBS`); e os eventos de início do `obs-browser` (`obsStreamingStarting`, `obsStreamingStarted`, `obsRecordingStarting`, `obsRecordingStarted`, `obsReplaybufferStarting`, `obsReplaybufferStarted`, `obsVirtualcamStarted`) fecham o que estiver aberto, já no `Starting`, para nenhum quadro com o painel sair (a Tarefa 5 confirma os nomes no `README` do `obs-browser` e usa só os que existirem; re-revisão, N-d). Consequência para o guia: a senha é configurada com o OBS parado, antes de iniciar a gravação e o Replay Buffer (Tarefa 10, Passo 5, item 6; re-revisão, N-a). Não dá para usar `obsSourceActiveChanged`: a Fonte está em todas as cenas, então está sempre ativa (revisão do plano, I5).

| Alternativa | Motivo de descarte |
|---|---|
| `obs-websocket-js` 5.0.8 | 7 dependências (`ws`, `crypto-js`, `debug`, `@msgpack/msgpack`...), para usar 2 requisições |
| Atalho de teclado do OBS para o marcador | Fica como reserva do DES-001 §15 (passo do responsável), não como caminho principal |

**D11. QR com `lean-qr`.** Gerar QR sem dependência exige um codificador próprio (modo byte, Reed-Solomon, máscaras, versões): umas 400 linhas sem um decodificador para provar. Escolha: `lean-qr` **2.7.4** (MIT, **sem dependências**, ~69 KB desempacotado, lançamentos de 2023 a 2026-09), instalado com `--before` de pelo menos 2 semanas antes do dia (em 2026-11-27, `--before=2026-11-13` resolve 2.7.4, publicada em 2026-09-07; conferir na hora). O app usa só `generate()` atrás de `src/shared/infra/qr.ts`, que devolve a matriz de módulos; o desenho é um `<svg>` montado pelo React em `src/shared/ui/CodigoQr.tsx` (sem `innerHTML`, sem os `extras` da biblioteca).

| Alternativa | Motivo de descarte |
|---|---|
| Codificador próprio | Grande, difícil de provar sem decodificador, e o QR é o caminho do celular de gravação |
| `qrcode` 1.5.4 | 3 dependências (`pngjs`, `yargs`, `dijkstrajs`) |
| `qrcode-generator` 2.0.4 | ~555 KB desempacotado |
| `uqr` 0.1.3 | Um lançamento em 2026 depois de dois anos parado |

**D12. Iniciar e encerrar na aba Ao vivo.** O DES-001 §9 põe "iniciar/encerrar o ao vivo" na aba Episódios; a E3 os põe na aba **Ao vivo**, junto do modo teste, do checklist e dos dispositivos conectados (a ordem do DES-001 §10.4: conferir, testar, iniciar). A nota da aba Episódios passa a dizer "Iniciar e encerrar o ao vivo ficam na aba Ao vivo." (Tarefa 9).

**D13. Checklist mínimo.** A aba Ao vivo mostra os itens do DES-001 §10.4 como lista fixa e, com sinal de pronto/pendente, os automáticos: palco conectado (presença em `estudio`), OBS detectado (`window.obsstudio`), nível de controle "Avançado" ou mais, obs-websocket conectado, versão do OBS ≥ 30.2 (só com o websocket; sem ele, "versão desconhecida" e a versão do plugin como indicação, DES-001 §3), Replay Buffer ativo e gravação em andamento (`getStatus`), câmera conectada (informativo até a E4). A E6 completa.

**D14. Presença.** Em `estudio`, cada cliente marca presença com a chave = o próprio `auth.uid()` e o corpo `{ tipo: 'membro', papel }` ou `{ tipo: <tipo do dispositivo>, dispositivoId, obs? }` (o palco põe a situação do OBS, D13); sem e-mail e sem nome. Em `:controle`, só membros marcam presença; a entrada de alguém faz o palco republicar o estado.

**D15. Rede caindo.** O `realtime-js` reconecta sozinho; o adaptador traduz os estados do canal (`conectando`, `conectado`, `reconectando`, `fechado`, `negado`). Enquanto não está `conectado`, o `/controle` desabilita os botões e mostra "Reconectando…"; ao voltar a `conectado` (e ao voltar a aba, `visibilitychange`, importante no Safari do iPhone, que suspende o WebSocket em segundo plano), todo cliente chama `episodio_ativo()` de novo e, se mudou, troca de tópico; o palco republica o estado. Os comandos usam `broadcast` com `ack: true`: `ok`, `sem_resposta` ("O comando não chegou. Tente de novo.") ou `falhou`; nada é reenviado sozinho (um clipe repetido seria pior que um clipe perdido). **`fechado` e `negado` (revisão do plano, N3):** o canal fechado pelo servidor (por exemplo, na renovação do token depois de uma revogação) é tratado como `negado`: o `/controle` mostra "Sem acesso ao canal; conferindo o seu acesso." e chama `reavaliar()` (se a pessoa continua membro, o `useAoVivo` reabre os canais); o palco refaz `resolverDispositivo` (sem dispositivo → tela de revogado e `sair()`; com dispositivo → reabre os canais depois de 5 s). Um `broadcast` sem permissão de escrita costuma voltar como `timed out`, igual a uma rede ruim, e não dá para separar os dois pelo `realtime-js`: a frase de `sem_resposta` fica "O comando não chegou (rede ou acesso). Tente de novo.", e duas respostas `sem_resposta` seguidas com o canal `conectado` disparam `reavaliar()`.

**D16. O que aparece na transmissão.** Em **nenhum** estado o palco mostra algo além do aviso no ar (cartão com título, texto em `white-space: pre-line`, link como texto, imagem da Biblioteca por URL assinada) sobre fundo transparente: a Fonte está em todas as cenas e a transmissão pode começar antes de "Iniciar o ao vivo" ou continuar depois de "Encerrar" (revisão do plano, I5). O selo de estado ("Palco · aguardando episódio", "Modo teste: <título>", "Pareado como <rótulo>") só aparece pela tecla `s` no "Interagir", por 5 s (`SELO_VISIVEL_MS`), e nunca com a saída no ar (mesma regra do painel de configuração, D10). As telas de pareamento e de erro da rota (`sem_link`, `link_invalido`, revogado...) aparecem enquanto o palco não está pareado, o que só acontece na configuração (Riscos). Erros (OBS sem permissão, websocket) vão para o painel pela presença. Sons tocam por `<audio>` com a URL assinada (`VALIDADE_NO_PALCO_S = 3600`, renovada a cada 45 min e a cada troca de episódio, `preload="auto"`), com o volume do som; o áudio da Fonte é controlado pelo OBS (passo do responsável).

## Foco da revisão

Situações perigosas da E3 que nenhum teste "natural" cobriria; cada uma tem teste na tarefa dona:

1. **Código adivinhado ou reutilizado** → 244 bits, uso único, 2 min, hash só no banco, limite de 5 falhas em 10 min por sessão, código novo apaga o pendente, revogar apaga os pendentes (Tarefa 3, `e3-codigo-so-hash`, `e3-codigo-aleatorio`, `e3-codigo-uso-unico`, `e3-codigo-expirado`, `e3-limite-de-tentativas`, `e3-codigo-novo-invalida-pendente`, `e3-revogado-nao-repareia-com-codigo-antigo`); a forma do fragmento é conferida antes da rede (Tarefa 1, `codigo-do-fragmento`).
2. **Código no lugar errado** → fragmento apagado antes da rede, nunca em armazenamento ou `console` (Tarefa 1, `resolver-ordem`; Tarefa 4, `parear-sem-console`; Tarefa 6, `fragmento-limpo-antes-da-rede`, `codigo-nunca-em-armazenamento`); o painel esquece o código ao sair da aba (Tarefa 8, `codigo-some-ao-sair-da-aba`).
3. **Dispositivo de um tipo agindo como outro** → cliente e `storageKey` por tipo (Tarefa 4, `dispositivo-cria-so-o-proprio-cliente`); código de outro tipo não é consumido (Tarefa 3, `e3-parear-tipo-errado`; Tarefa 6, `tipo-errado`); câmera e `obs_camera` não entram no `:controle` nem leem o bucket (Tarefa 3, `e3-canal-matriz`; E2, `e2-storage-quem-le`).
4. **Dispositivo revogado continuando a agir** → no banco na hora (Tarefa 3, `e3-revogar`, `e3-revogado-sem-canal`); pelo canal, o aparelho sai e encerra a sessão, e o palco descarta o remetente (Tarefa 5, `remetente-revogado`; Tarefa 6, `revogado-na-hora`); parear de novo avisa a sessão antiga (Tarefa 8, `detecta-pareamento-e-avisa-sessao-antiga`); canal fechado pelo servidor é tratado como negado (Tarefa 6, `palco-canal-fechado`; Tarefa 7, `canal-fechado-reavalia`); trocar o papel de um membro não revoga (Tarefa 8, `membros-remove-avisa`).
5. **Membro anônimo** → sessão anônima sem dispositivo não lê nada, não entra em canal, não cria código; sessão de membro não pareia (Tarefa 3, `e3-parear-so-anonima`, `e3-codigo-so-equipe`, `e3-canal-matriz`); cliente de dispositivo com sessão não anônima sai (Tarefa 1, `sessao-nao-anonima-sai`).
6. **Mensagem forjada no canal** → só `equipe`/`admin` publicam em `estudio`; dispositivos não publicam comando (Tarefa 3, `e3-canal-matriz`); toda mensagem é validada e a inválida é descartada sem efeito (Tarefa 1, `mensagens-validadas`; Tarefa 4, `recebe-valida`; Tarefa 7, `estado-forjado-invalido-ignorado`). Limite que sobra: um membro pode se passar por outro membro ou pelo palco no conteúdo (DES-001 §8), registrado em Riscos.
7. **Dois ao vivo** → índice único e funções (Tarefa 3, `e3-iniciar-e-encerrar`); `estado` e `gestos_ligados` não mudam por `update` direto (Tarefa 3, `e3-estado-so-por-funcao`); a tela traduz `duplicado` (Tarefa 9, `iniciar-com-outro-ao-vivo`).
8. **Som, cena ou aviso que não existe** → recusa com motivo e nada executado (Tarefa 1, `comando-alvo-inexistente`; Tarefa 5, `som-inexistente`, `cena-inexistente-no-obs`).
9. **Aviso com HTML no palco e no controle** → texto literal (Tarefa 6, `palco-mostra-aviso-literal`; Tarefa 7, `titulo-com-html-literal`).
10. **OBS ausente, sem permissão ou antigo** → o executor recusa com motivo, o palco publica a situação e o painel avisa (Tarefa 5, `obs-ausente`, `sem-permissao`, `versao-minima`; Tarefa 9, `checklist-itens`).
11. **Rede caindo no meio do ao vivo** → botões desabilitados, `ack` sem resposta avisado, nova consulta do episódio ativo na volta, estado republicado (Tarefa 4, `estados-do-canal`, `ack`; Tarefa 6, `palco-reconecta`; Tarefa 7, `botoes-desligados-sem-conexao`, `ack-sem-resposta-avisa`, `voltar-a-ver-reconecta`).
12. **iPhone/Safari** → volta da aba reconecta (Tarefa 7, `voltar-a-ver-reconecta`); botões grandes sem `hover`; conferência em 320 px (Tarefa 10) e real num iPhone (passo do responsável).
13. **Política ou simulação afrouxada na checagem** → o `data-api:check` acusa qualquer política de `realtime.messages` diferente das duas (inclusive `using (true)`), `update`/`delete`/`all`, `to anon`, política que chame outra função que não `public.pode_usar_canal(text, text, boolean)`, e qualquer mudança em `realtime.*` (RLS, coluna, índice, gatilho, privilégio, `realtime.topic`, `realtime.authorize`) (Tarefa 2); a simulação reproduz a RLS da qual as políticas dependem (Tarefa 2, `simulacao-realtime-respeita-rls`).
14. **Senha do OBS saindo do computador** → só o hash de autenticação vai ao OBS local; nunca em estado, presença, DOM depois de salva ou `console` (Tarefa 5, `senha-nunca-sai`; Tarefa 6, `palco-config-escondida`).
15. **Palco aparecendo na transmissão** → nada além do aviso em nenhum estado; selo só pela tecla, por 5 s; painel de configuração com o aviso, campo mascarado, fechado sozinho em 2 min e recusado com a saída no ar; classe do fundo transparente antes da primeira pintura (Tarefa 5, `status-da-saida`; Tarefa 6, `palco-sem-nada-sem-tecla`, `selo-por-tecla`, `selo-e-config-recusados-no-ar`, `palco-config-escondida`, `palco-sem-piscar`).
16. **Dois usos do mesmo tópico no mesmo cliente** → um canal por tópico com contagem de referências (Tarefa 4, `um-canal-por-topico`, `fechar-um-nao-derruba-o-outro`, `presence-antes-do-subscribe`, `canal-fechado-sai-do-registro`, `reabrir-depois-de-fechado`, `abrir-durante-remocao`, `eco-local`; Tarefa 7, `canal-fechado-reavalia`; Tarefa 8, `painel-reabre-estudio`; Tarefa 9, `painel-e-ao-vivo-no-mesmo-cliente`, `comando-vai-ao-episodio-novo`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/domains/acesso/dispositivos.ts` (+ teste) | `TipoDeDispositivo`, `ROTULO_DO_TIPO`, `CAMINHO_DO_TIPO`, `codigoDoFragmento`, `linkDePareamento`, `conferirRotulo`, `Dispositivo`, `situacaoDoDispositivo`, `EstadoDoDispositivo`, `resolverDispositivo` | 1 |
| `src/domains/acesso/portasDeDispositivo.ts` | `ErroDeDispositivo`, `ServicoDeDispositivo` | 1 |
| `src/domains/aovivo/README.md` | Domínio Ao vivo (DES-001 §6) | 1 |
| `src/domains/aovivo/mensagens.ts` (+ teste) | Mensagens de `estudio` e `:controle`, presença, `lerMensagemDoEstudio`, `lerComando`, `lerEstadoNoAr`, `lerPresenca`, `Revogados` | 1 |
| `src/domains/aovivo/comandos.ts` (+ teste) | `AcaoNoObs`, `resolverComando`, `linhaDoRegistro` | 1 |
| `src/domains/aovivo/portas.ts` | `ErroDoAoVivo`, `CanalDoEstudio`, `CanalDoControle`, `FabricaDeCanais`, `RepositorioDoAoVivo`, `RepositorioDoPalco`, `ExecutorDeAcoes` | 1 |
| `supabase/tests/simulacao-supabase.sql`, `supabase/tests/dono-migracao.sql` | Schema `realtime` (fontes) e o que o dono das migrações pode nele | 2 |
| `scripts/_catalogo.mjs`, `scripts/check-data-api.mjs` (+ testes) | Regra de schemas protegidos (`storage`, `realtime`) e regra das políticas do canal | 2 |
| `supabase/tests/banco.ts`, `supabase/tests/rls.test.ts` | `comoCanal` (autorização de canal pelo `realtime.authorize`, como o servidor do Realtime faz); bloco `Simulação do Realtime` | 2 |
| `supabase/migrations/<AAAAMMDDHHMMSS>_ao_vivo_e_pareamento.sql` | Tabela `tentativas_pareamento`, nove funções, privilégios por coluna, políticas de `realtime.messages` | 3 |
| `supabase/tests/rls.test.ts`, `supabase/tests/matriz.test.ts`, `supabase/tests/restricoes.test.ts` | Bloco `E3 — pareamento, ao vivo e canais`; matriz com `episodios` por coluna e `estudio_estado` só leitura; os 6 testes da E0 que a migração muda (I1) e `temPrivilegio` por coluna | 3 |
| `scripts/check-data-api.mjs` | `tentativas_pareamento` em `SOMENTE_FUNCOES` | 3 |
| `src/shared/infra/dispositivoSupabase.ts` (+ teste) | `ServicoDeDispositivo` (login anônimo, `parear_dispositivo`, `meu_dispositivo`, saída local) | 4 |
| `src/shared/infra/aoVivoSupabase.ts` (+ teste) | `RepositorioDoAoVivo` (funções e dispositivos) e `RepositorioDoPalco` (listas, URL assinada, registro) | 4 |
| `src/shared/infra/canalSupabase.ts` (+ teste) | `FabricaDeCanais` sobre o `realtime-js` (privado, `ack`, presença, estados; registro com um canal por tópico e contagem de referências) | 4 |
| `src/app/servicos.ts`, `src/app/dependencias.ts`, `src/app/servicosFalsos.ts` (+ testes) | `obterAoVivo` (cliente de membro) e `obterDispositivo(tipo)` (cliente do tipo); falsos de canal e de ao vivo | 4 |
| `src/domains/obs/README.md`, `src/domains/obs/{portas,versao,executor}.ts` (+ testes) | Integração OBS: portas, versão mínima, executor | 5 |
| `src/domains/aovivo/palco.ts` (+ teste) | Serviço do palco (validar, deduplicar, resolver, executar, publicar, registrar) | 5 |
| `src/shared/infra/obsNavegador.ts`, `src/shared/infra/obsWebsocket.ts` (+ testes) | `window.obsstudio` e obs-websocket v5 nativo | 5 |
| `src/app/useDispositivo.ts`, `src/app/telas/TelaDeDispositivo.tsx` (+ teste) | Pareamento e estados das três rotas de dispositivo | 6 |
| `src/app/telas/ObsPalco.tsx`, `src/app/telas/PalcoNoAr.tsx` (+ teste), `Camera.tsx`, `ObsCamera.tsx`, `index.html` | Palco no ar; câmera e `obs_camera` pareadas (vídeo na E4); classe do palco antes da primeira pintura | 6 |
| `src/app/useAoVivo.ts`, `src/shared/ui/PainelDeComandos.tsx`, `src/app/telas/Controle.tsx` (+ teste) | `/controle` por toque | 7 |
| `src/shared/infra/qr.ts` (+ teste), `src/shared/ui/CodigoQr.tsx`, `package.json`, `package-lock.json` | QR (D11) | 8 |
| `src/app/telas/AbaAoVivo.tsx` (+ teste), `src/app/telas/AbaMembros.tsx` (+ teste), `src/app/telas/Painel.tsx` (+ teste) | Dispositivos, pareamento, revogação; aviso de revogação de membro | 8 |
| `src/app/telas/AbaAoVivo.tsx`, `src/app/telas/AbaEpisodios.tsx` (+ testes), `src/app/App.test.tsx` | Modo teste, iniciar/encerrar, checklist, comandos; nota da aba Episódios | 9 |
| `src/shared/styles/base.css` | Palco transparente, cartão do aviso, selo, controle mobile-first, QR, dispositivos | 6, 7, 8, 9 |
| `supabase/README.md` | Migração nova em "Onde"; seção "Ao vivo e pareamento (E3)" | 3, 10 |
| READMEs: `src/`, `src/domains/`, `src/domains/acesso/`, `src/app/`, `src/app/telas/`, `src/shared/infra/`, `src/shared/ui/`, `src/shared/styles/`, `supabase/migrations/`, `supabase/tests/`, `scripts/`, `scripts/tests/` | "Onde", "Arquivos" e o que passa a ser falso | na tarefa que mexe na pasta |

Cada tarefa termina com um commit que leva o seu registro `docs/verificacoes/AAAA-MM-DD-NNN-*.md`. O próprio plano entra antes, no commit do **VER-034** (este plano, a linha nova de `docs/planos/README.md`, o registro e a linha dele em `docs/verificacoes/README.md`). As Tarefas 1 a 10 usam **VER-035 a VER-044** (os números são os próximos livres na hora de cada commit; 032 e 033 ficaram com as correções feitas antes deste plano; conferir `docs/verificacoes/README.md` antes). Toda tarefa também modifica `docs/verificacoes/README.md` (linha nova em "Onde", campo "Arquivos" e o número do exemplo da seção "Exemplo"). **Cada tarefa passa sozinha no `npm run check`** (inclusive o `typecheck`): uma mudança de interface entra junto com todos os arquivos que precisam dela para compilar (por exemplo, `servicosFalsos.ts` na Tarefa 4). O `npm run check` final de cada tarefa roda **depois** de o registro existir e é o último ato antes do commit; depois do commit vem o push (decisão (b)) e o relato do estado.

O primeiro registro da E3 (VER-035) **abre com a conferência das pendências da E2** (PLA-003, Tarefa 8, Passo 5: migração `biblioteca_storage` aplicada e conferência real), anotando o que o responsável já confirmou; nenhum código da E3 depende delas, só a conferência real da Tarefa 10.

---

### Tarefa 1: domínio — dispositivos (Acesso) e Ao vivo (mensagens, comandos, portas)

**Arquivos:**
- Criar: `src/domains/acesso/dispositivos.ts` (+ teste), `src/domains/acesso/portasDeDispositivo.ts`, `src/domains/aovivo/README.md`, `src/domains/aovivo/{mensagens,comandos,portas}.ts`, testes `src/domains/aovivo/{mensagens,comandos}.test.ts`, registro `docs/verificacoes/AAAA-MM-DD-035-e3-dominio-ao-vivo.md`
- Modificar: `src/domains/acesso/README.md` (pareamento), `src/domains/README.md`, `src/README.md` (se citar a lista de domínios), `docs/verificacoes/README.md`

**Interfaces** (nenhum import de `react`, `@supabase/*`, `src/shared` ou `src/app`; `src/domains/arquitetura.test.ts` já cobre as pastas novas):

```ts
// acesso/dispositivos.ts
export type TipoDeDispositivo = 'camera' | 'obs_palco' | 'obs_camera'
export const ROTULO_DO_TIPO: Readonly<Record<TipoDeDispositivo, string>> // 'Câmera', 'Palco (OBS)', 'Câmera (OBS)'
export const CAMINHO_DO_TIPO: Readonly<Record<TipoDeDispositivo, '/camera' | '/obs/palco' | '/obs/camera'>>
export const FORMA_DO_CODIGO = /^[A-Za-z0-9_-]{43}$/
export const COLUNAS_DE_MEU_DISPOSITIVO = ['id', 'tipo', 'rotulo', 'camera_id'] as const // as colunas que public.meu_dispositivo() devolve (I2); o teste de banco e o adaptador usam esta lista
export function codigoDoFragmento(fragmento: string): { codigo: string } | { invalido: true } | null // '' ou '#' → null; '#<43>' → código; outro → invalido
export function linkDePareamento(origem: string, tipo: TipoDeDispositivo, codigo: string): string // new URL(origem).origin; só https: ou http://localhost|127.0.0.1; código fora da forma → lança
export function conferirRotulo(r: string): 'rotulo_vazio' | 'rotulo_longo' | null // trim; 1..60 (o mesmo da função)
export interface Dispositivo { id: string; tipo: TipoDeDispositivo; rotulo: string; cameraId: string | null; usuarioAnonimoId: string | null; pareadoEm: string | null; revogadoEm: string | null }
export function situacaoDoDispositivo(d: Dispositivo, presentes: ReadonlySet<string>): 'nunca_pareado' | 'revogado' | 'conectado' | 'desconectado' // presentes = dispositivoId na presença
export type EstadoDoDispositivo =
  | { tipo: 'pareado'; dispositivo: { id: string; tipo: TipoDeDispositivo; rotulo: string; usuarioId: string } }
  | { tipo: 'sem_link' } | { tipo: 'link_invalido' } | { tipo: 'tipo_errado' } | { tipo: 'limite' } | { tipo: 'revogado' } | { tipo: 'falha' } // 'revogado' só vem do aviso do canal (marcarRevogado), nunca de resolverDispositivo (N1)
export async function resolverDispositivo(s: ServicoDeDispositivo, tipo: TipoDeDispositivo, fragmento: ReturnType<typeof codigoDoFragmento>): Promise<EstadoDoDispositivo>

// acesso/portasDeDispositivo.ts
export type MotivoDoDispositivo = 'rede' | 'negado' | 'outro'
export class ErroDeDispositivo extends Error { readonly motivo: MotivoDoDispositivo } // mensagem só com o motivo
export interface ServicoDeDispositivo {
  sessaoAtual(): Promise<{ usuarioId: string; anonima: boolean } | null> // erro → ErroDeDispositivo('rede')
  entrarAnonimo(): Promise<{ usuarioId: string }>
  parear(codigo: string, tipo: TipoDeDispositivo): Promise<{ resultado: 'pareado' | 'invalido' | 'tipo_errado' | 'limite'; dispositivo: { id: string; rotulo: string } | null }>
  dispositivoAtual(): Promise<{ id: string; tipo: TipoDeDispositivo; rotulo: string; cameraId: string | null } | null> // rpc('meu_dispositivo') (D4, I2)
  sair(): Promise<void> // local; nunca lança
}

// aovivo/mensagens.ts
export type MensagemDoEstudio = { evento: 'episodio_ativo_mudou' } | { evento: 'dispositivo_mudou'; dispositivoId: string } | { evento: 'revogacao'; usuario: string }
export type PresencaNoEstudio = { tipo: 'membro'; papel: 'admin' | 'equipe' | 'apresentadora' } | { tipo: TipoDeDispositivo; dispositivoId: string; obs: SituacaoDoObs | null }
export interface SituacaoDoObs { navegador: boolean; versaoDoPlugin: string | null; nivel: number | null; websocket: 'desligado' | 'conectado' | 'senha_errada' | 'sem_conexao'; versaoObs: string | null; replayBuffer: boolean | null; gravando: boolean | null }
export type Comando = { id: string } & ({ acao: 'cena'; cenaId: string } | { acao: 'som'; somId: string } | { acao: 'aviso'; avisoId: string } | { acao: 'proxima_cena' | 'proximo_aviso' | 'ocultar_aviso' | 'clipe' | 'marcador' })
export type ResultadoDoComando = 'ok' | 'pendente' | 'recusado' | 'falhou'
export interface EstadoNoAr { episodioId: string; modo: 'ao_vivo' | 'teste'; cenaObs: string | null; avisoId: string | null; avisoAte: number | null; ultimo: { comandoId: string; acao: Comando['acao']; resultado: ResultadoDoComando; motivo: string | null } | null; obs: SituacaoDoObs }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function lerMensagemDoEstudio(evento: string, payload: unknown): MensagemDoEstudio | null
export function lerComando(payload: unknown): Comando | null
export function lerEstadoNoAr(payload: unknown): EstadoNoAr | null // cenaObs ≤ 200; motivo ∈ lista fixa; números finitos
export function lerPresenca(payload: unknown): PresencaNoEstudio | null
export function lerRemetente(payload: unknown): string | null // payload.remetente em UUID
export class Revogados { constructor(agora: () => number); revogar(usuario: string): void; contem(usuario: string): boolean } // vale 15 min (REVOGACAO_LEMBRADA_MS = 900_000)

// aovivo/comandos.ts
export type AcaoNoObs =
  | { tipo: 'trocar_cena'; nomeObs: string; cenaId: string } | { tipo: 'tocar_som'; somId: string; volume: number }
  | { tipo: 'mostrar_aviso'; avisoId: string; duracaoS: number } | { tipo: 'ocultar_aviso' } | { tipo: 'salvar_clipe' } | { tipo: 'marcar'; nome: string }
export type MotivoDaRecusa = 'cena_inexistente' | 'som_inexistente' | 'aviso_inexistente' | 'sem_cenas' | 'fim_dos_avisos' | 'sem_aviso_no_ar'
export function resolverComando(c: Comando, ctx: { cenas: readonly Cena[]; sons: readonly Som[]; avisos: readonly Aviso[]; estado: Pick<EstadoNoAr, 'cenaObs' | 'avisoId'>; episodioTitulo: string }): { ok: true; acao: AcaoNoObs } | { ok: false; motivo: MotivoDaRecusa }
export function linhaDoRegistro(c: Comando, a: AcaoNoObs, ctx: { episodioId: string; modo: 'ao_vivo' | 'teste'; remetente: string }): LinhaDoRegistro // D9
export interface LinhaDoRegistro { episodioId: string; origem: 'toque'; acao: AcaoDoGesto; cenaId: string | null; somId: string | null; avisoId: string | null; membroId: string; teste: boolean }

// aovivo/portas.ts
export type MotivoDoAoVivo = 'negado' | 'invalido' | 'estado_invalido' | 'duplicado' | 'nada_alterado' | 'sessao_expirada' | 'rede' | 'outro'
export class ErroDoAoVivo extends Error { readonly motivo: MotivoDoAoVivo }
export type EstadoDoCanal = 'conectando' | 'conectado' | 'reconectando' | 'fechado' | 'negado'
export type RespostaDoEnvio = 'ok' | 'sem_resposta' | 'falhou'
export interface CanalDoEstudio {
  aoReceber(f: (m: MensagemDoEstudio, remetente: string) => void): () => void
  aoMudarPresenca(f: (presentes: { usuario: string; presenca: PresencaNoEstudio }[]) => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  enviar(m: MensagemDoEstudio): Promise<RespostaDoEnvio>
  marcarPresenca(p: PresencaNoEstudio): Promise<void>
  fechar(): Promise<void>
}
export interface CanalDoControle {
  aoComando(f: (c: Comando, remetente: string) => void): () => void
  aoEstado(f: (e: EstadoNoAr, remetente: string) => void): () => void
  aoEntrarAlguem(f: () => void): () => void
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  enviarComando(c: Comando): Promise<RespostaDoEnvio>
  publicarEstado(e: EstadoNoAr): Promise<RespostaDoEnvio>
  marcarPresenca(): Promise<void>
  fechar(): Promise<void>
}
export interface FabricaDeCanais { estudio(): CanalDoEstudio; controle(episodioId: string): CanalDoControle } // cada chamada devolve uma alça; o mesmo tópico no mesmo cliente divide um canal só (I3)
export interface RepositorioDoAoVivo {
  episodioAtivo(): Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null>
  iniciar(id: string): Promise<void>; encerrar(id: string): Promise<void>; definirModoTeste(id: string | null): Promise<void>
  listarDispositivos(): Promise<Dispositivo[]>
  criarCodigo(p: { tipo: TipoDeDispositivo; rotulo: string; dispositivoId: string | null; cameraId: string | null }): Promise<{ dispositivoId: string; codigo: string; expiraEm: string }>
  revogar(id: string): Promise<{ usuario: string | null }>
}
export interface RepositorioDoPalco {
  episodioAtivo(): Promise<{ id: string; modo: 'ao_vivo' | 'teste' } | null>
  carregar(episodioId: string): Promise<{ episodio: Episodio; cenas: Cena[]; sons: (Som & { caminho: string })[]; avisos: (Aviso & { caminhoDaImagem: string | null })[] }>
  urlDoArquivo(caminho: string): Promise<string> // URL assinada, VALIDADE_NO_PALCO_S
  registrar(l: LinhaDoRegistro): Promise<void>
}
export interface ExecutorDeAcoes { executar(a: AcaoNoObs): Promise<{ resultado: ResultadoDoComando; motivo: string | null }>; situacao(): SituacaoDoObs }
```

- [ ] **Passo 1: testes (falham).**
  - `dispositivos.test.ts`: `codigo-do-fragmento` (`''`, `'#'` → `null`; `'#'+43 válidos` → código; 42 ou 44 caracteres, `+`, `/`, `=`, `%2F`, espaço → `invalido`); `link-de-pareamento` (`https://app.revocast.test/x?y` + `obs_palco` → `https://app.revocast.test/obs/palco#<c>`; `http://localhost:5173` aceito; `http://revocast.test` e `javascript:` lançam; código inválido lança); `rotulo` (vazio, só espaços, 61 → recusa; 60 → `null`); `situacao` (revogado vence presença; `pareadoEm` nulo → `nunca_pareado`).
  - `resolver-ordem` (`test.each`, com um `ServicoDeDispositivo` falso que anota a ordem das chamadas):

| Situação | Esperado |
|---|---|
| sem sessão, sem fragmento | `sem_link`; nenhuma outra chamada |
| sem sessão, fragmento `invalido` | `link_invalido`; nenhuma chamada além de `sessaoAtual` |
| sem sessão, código, `parear` → `pareado` | `entrarAnonimo` → `parear(codigo, tipo)` → `pareado` com o `usuarioId` do login |
| idem, `invalido` / `limite` / `tipo_errado` | `link_invalido` / `limite` / `tipo_errado`, sempre com `sair()` (a sessão nova não tem dispositivo e não pode ficar guardada; o código de outro tipo continua sem uso no banco; teste `sem-sessao-orfa`, N1) |
| sessão anônima com dispositivo do mesmo tipo, com código | `pareado`; `parear` **não** chamado (fragmento ignorado) |
| sessão anônima sem dispositivo, sem código | `sair()` → `sem_link` (depois de recarregar não se sabe se houve revogação; teste `recarga-nao-diz-revogado`, N1) |
| sessão anônima sem dispositivo, com código | `sair()` → `entrarAnonimo` → `parear` (sessão nova; teste `nova-sessao-ao-reparear`) |
| `sessao-nao-anonima-sai`: sessão não anônima | `sair()` e segue como sem sessão |
| qualquer chamada lança `ErroDeDispositivo('rede')` | `falha` |

  - `mensagens.test.ts`, `mensagens-validadas`: cada leitor aceita a forma certa e devolve `null` para: tipo errado, uuid em maiúsculas ou fora da forma, campo faltando, ação desconhecida, `cenaObs` com 201 caracteres, número não finito, `motivo` fora da lista, `__proto__` como chave (o objeto devolvido é novo, só com os campos conhecidos); `revogados-expiram` (relógio falso: 899 999 ms → contém; 900 000 → não).
  - `comandos.test.ts`: `comando-alvo-inexistente` (cena, som e aviso fora das listas → motivo); `proxima-cena` (ordem `[A,B,C]`, atual `B` → `C`; atual `C` → `A`; atual desconhecida → `A`; sem cenas → `sem_cenas`); `proximo-aviso` (sem aviso no ar → primeiro; no último → `fim_dos_avisos`); `ocultar-sem-aviso` → `sem_aviso_no_ar`; `marcador-com-nome` (nome = título do episódio + hora `HH:MM:SS`, até 100 caracteres); `registro` (`aviso` → `acao: 'proximo_aviso'` com `avisoId`; `cena` → `cenaId`; modo `teste` → `teste: true`; `membroId` = remetente).
- [ ] **Passo 2:** `npx vitest run src/domains`. Esperado: FAIL (módulos inexistentes).
- [ ] **Passo 3:** implementar. `resolverDispositivo` segue a tabela acima, nesta ordem, num `try` único (qualquer erro → `falha`); os leitores montam o objeto novo campo a campo (nada de espalhar o `payload`). Rodar. Esperado: todos passam.
- [ ] **Passo 4: sabotagens**, uma de cada vez, anotando o teste que caiu: aceitar `=` na forma do código → `codigo-do-fragmento`; chamar `parear` mesmo já pareado → `resolver-ordem`; reaproveitar a sessão anônima sem dispositivo para parear (sem `sair`) → `nova-sessao-ao-reparear`; não chamar `sair()` depois de `tipo_errado` → `sem-sessao-orfa`; devolver `revogado` para sessão sem dispositivo → `recarga-nao-diz-revogado`; espalhar o `payload` em `lerComando` → `mensagens-validadas` (caso `__proto__`/campo extra); `proximo_aviso` voltando ao início → `proximo-aviso`; gravar `aviso` como `nenhuma` → `registro`; importar `@supabase/supabase-js` em `aovivo/portas.ts` → `arquitetura.test.ts`.
- [ ] **Passo 5:** READMEs (`src/domains/aovivo/` com 11 seções e, em "Lógica", o diagrama comando → palco → OBS → estado; `src/domains/acesso/`: pareamento e a ordem da D4); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-035 (abre com as pendências da E2; D1–D4, D9; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 2: simulação do Realtime e checagens de banco para `realtime.*`

**Arquivos:**
- Modificar: `supabase/tests/simulacao-supabase.sql`, `supabase/tests/dono-migracao.sql`, `supabase/tests/banco.ts` (`comoCanal`), `supabase/tests/rls.test.ts` (bloco `Simulação do Realtime`, N6), `scripts/_catalogo.mjs`, `scripts/check-data-api.mjs`, `scripts/tests/check-data-api.test.mjs`, `scripts/tests/catalogo.test.mjs`, `scripts/README.md`, `scripts/tests/README.md`, `supabase/tests/README.md`, `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-036-e3-simulacao-realtime-e-checagens.md`

**Interfaces:**
- Simulação (só testes): papel `supabase_realtime_admin` (`nologin`), schema `realtime` com `realtime.messages` (as colunas da fonte: `topic`, `extension`, `payload`, `event`, `private`, `updated_at`, `inserted_at`, `id`; particionada como na fonte, com uma partição que cubra os testes, se a fonte a particionar), RLS ativa, `realtime.topic()` (lê `realtime.topic` de `current_setting`), **`realtime.authorize(...)` com a assinatura, o dono, o modo (`SECURITY DEFINER` ou não) e o corpo da fonte, no que muda o resultado** (como ela troca de papel, define as claims e o tópico, e como confere cada extensão de leitura e de escrita), os privilégios que o Supabase dá a `anon`, `authenticated` e `service_role`; em `dono-migracao.sql`, a participação do `postgres_sim` em `supabase_realtime_admin` com o comentário do que ela dá a mais que o real (como a de `storage`, PLA-003 D13).
- `banco.ts`: `comoCanal(db, claims, topico, extensao, 'receber' | 'enviar'): Promise<boolean>`, que segue o **caminho principal do servidor** lido na fonte (Passo 1): chama `realtime.authorize(...)` com o papel, o tópico, as claims e o `sub` da sessão e a extensão pedida (de leitura ou de escrita), e lê a resposta dela; sempre dentro de um savepoint desfeito. O caminho de reserva do servidor (`insert` e `select` em `realtime.messages` numa transação) só entra se a fonte mostrar que a versão atual ainda o usa como principal, registrado no VER-036 (revisão do plano, I6).
- `_catalogo.mjs` e `check-data-api.mjs`: a impressão ampliada e a regra "nenhuma mudança" de `storage` passam a valer para uma lista `SCHEMAS_PROTEGIDOS = ['storage', 'realtime']` (as mensagens de `storage` ficam **idênticas**: os testes da E2 não mudam); a função `realtime.authorize` entra na impressão de objetos de `realtime` (trocá-la é erro); política criada ou alterada em `realtime.messages` só é aceita se for igual, comando e papéis inclusive, a uma de `POLITICAS_DO_CANAL` (exportada; o texto exato vem do `pg_get_expr` do PGlite no Passo 3); removida é aceita (só nega mais); política em qualquer outra relação de `realtime` é erro.

- [ ] **Passo 1: fontes (antes de escrever SQL)**, citadas no comentário de cada bloco com a data da leitura: (a) as migrações do `github.com/supabase/realtime` (`lib/realtime/tenants/repo/migrations/`): criação de `realtime.messages`, partição, `realtime.topic()`, RLS, privilégios e gatilhos que um `insert`/`select` de `authenticated` dispararia; (b) como o Realtime confere a autorização de canal privado (`lib/realtime/tenants/authorization.ex`): confirmar o caminho principal por `realtime.authorize(role_name, topic_name, claims, sub, headers, read_extensions, write_extensions)` (`@authorize_query`), ler a definição dessa função na migração que a cria (dono, `SECURITY DEFINER`, como define papel, claims e `realtime.topic`, o que devolve), as extensões de leitura e de escrita (`broadcast`, `presence`, `persistence`), quando o servidor cai na reserva (`fallback?/1`), e se a conferência se repete na renovação do token e ao reconectar; (c) se o `postgres` real cria política em `realtime.messages` (`supautils.policy_grants` no `supabase/postgres`) e se é membro de `supabase_realtime_admin` (migração `20250421084701_revoke_admin_roles_from_postgres.sql`); (d) a documentação "Realtime Authorization" (`supabase.com/docs/guides/realtime/authorization`) e a opção "Allow public access". **Regra:** se (c) mostrar que o `postgres` não cria política em `realtime.messages`, parar e registrar no VER-036: a Tarefa 3 separa as políticas do canal num bloco que o responsável cria pelo painel com o mesmo texto, conferido por `pg_policies`.
- [ ] **Passo 2: testes das checagens (falham).** Em `scripts/tests/check-data-api.test.mjs`, com a base mínima do arquivo e uma `public.pode_usar_canal(text, text, boolean)` mínima (corpo que chama `public.papel_atual()`), `R` = `public.pode_usar_canal(realtime.topic(), extension, false)` e `E` = o mesmo com `true`:

| Caso | SQL acrescentado | Esperado |
|---|---|---|
| `realtime-politicas-aceitas` | `create policy canal_recebe on realtime.messages for select to authenticated using (R); create policy canal_envia ... for insert to authenticated with check (E);` | `[]` |
| `realtime-outra-forma` (`test.each`) | `using (true)`; `using (public.papel_atual() is not null)`; `using (R or true)`; `using (realtime.topic() = 'estudio' and R)`; select com `E` (troca dos lados) | 1 erro cada, citando `realtime.messages` e a política |
| `realtime-comando` (`test.each`) | `for update`, `for delete`, `for all` com `R` | 1 erro cada |
| `realtime-para-anon` | `for select to anon using (R)` | 1 erro |
| `realtime-politica-alterada-ou-removida` (`test.each`, numa segunda migração) | `alter policy canal_recebe on realtime.messages using (true)`; `... to authenticated, anon`; `drop policy canal_recebe on realtime.messages` | os dois `alter` → 1 erro cada; o `drop` → `[]` |
| `realtime-rls-desligada` | `alter table realtime.messages disable row level security;` | exatamente 1 erro, com "relação do schema realtime" e "RLS" |
| `realtime-mudancas` (`test.each`) | coluna nova; índice novo; gatilho novo; `grant select on realtime.messages to supabase_auth_admin`; `comment on table` | exatamente 1 erro cada, com o item ("coluna", "índice", "gatilho", "privilégio", "comentário") |
| `realtime-topic-trocada` | `create or replace function realtime.topic() returns text language sql as $$ select 'estudio' $$;` | erro de objeto no schema `realtime` |
| `realtime-tabela-nova` | `create table realtime.extra (id int);` | erro ("fora do schema public") |
| `realtime-funcao-do-canal` (`test.each`) | as duas políticas canônicas com `public.pode_usar_canal` ausente; com `outro.pode_usar_canal(text, text, boolean)` num schema de teste e a política apontando para ele; com `public.pode_usar_canal(text, text, text)` | 1 erro cada (a função chamada tem de ser exatamente `public.pode_usar_canal(text, text, boolean)`, conferida pelo `oid` no catálogo, não só pelo texto; N5) |
| `realtime-authorize-trocada` | `create or replace function realtime.authorize(...)` com o mesmo cabeçalho e corpo que devolve tudo liberado | erro de objeto no schema `realtime` |
| `storage-sem-mudanca` | os casos da E2 | continuam passando sem mudar uma letra |

  Em `rls.test.ts`, bloco `Simulação do Realtime (E3, Tarefa 2)`, no mesmo banco: `simulacao-realtime-respeita-rls`: sem política nenhuma em `realtime.messages`, `comoCanal` dá `false` para ana em `x`, receber e enviar; com uma política de teste criada pelo superusuário dentro da transação (`for select to authenticated using (realtime.topic() = 'x')`), `true` para receber em `x` e `false` em `y` e para enviar; a extensão `persistence` segue a mesma conferência. É o teste que a sabotagem da RLS da simulação derruba nesta tarefa (N6).

  Rodar os testes de `scripts/tests` pelo comando do `scripts/tests/README.md` e `npx vitest run supabase/tests/rls.test.ts`. Esperado: FAIL (sem `realtime` na simulação, erro de SQL).
- [ ] **Passo 3: simulação e `comoCanal`.** Bloco `realtime` no fim de `simulacao-supabase.sql` (comentários com as fontes) e a participação em `dono-migracao.sql`. Imprimir, numa sonda fora do repositório, o `pg_get_expr` das duas políticas canônicas e fixá-lo em `POLITICAS_DO_CANAL`. Rodar `npm test` e os testes de `scripts/tests`. Esperado: tudo que passava continua passando.
- [ ] **Passo 4: catálogo e regras** (`SCHEMAS_PROTEGIDOS`, `POLITICAS_DO_CANAL`, mensagem `relação do schema ${schema}`). Rodar os testes do Passo 2. Esperado: todos passam; `npm run data-api:check` e `npm run rpc:grants-check` sobre as três migrações: 0 erros.
- [ ] **Passo 5: sabotagens**, anotando o teste que caiu: aceitar qualquer política em `realtime.messages` → `realtime-outra-forma`; comparar só o texto e não o comando → `realtime-comando`; não comparar papéis → `realtime-para-anon`; tirar `realtime` de `SCHEMAS_PROTEGIDOS` → `realtime-rls-desligada` e `realtime-mudancas`; deixar sair também o erro genérico para `realtime` → os casos com "exatamente 1 erro"; trocar a mensagem para o nome fixo "storage" → `realtime-rls-desligada`; conferir a função da política só pelo texto → `realtime-funcao-do-canal`; tirar `realtime.authorize` da impressão → `realtime-authorize-trocada`; tirar a RLS de `realtime.messages` na simulação (edição temporária desfeita e conferida por `sha256sum`) → `simulacao-realtime-respeita-rls` (nesta tarefa; na Tarefa 3, também `e3-canal-matriz`); `comoCanal` ignorando a resposta de `realtime.authorize` (sempre `true`) → `simulacao-realtime-respeita-rls`.
- [ ] **Passo 6:** READMEs (`scripts/README.md`: regra dos schemas protegidos, as duas políticas aceitas, a participação nova e o poder a mais compensado; `scripts/tests/README.md`; `supabase/tests/README.md`: bloco `realtime`, `comoCanal` e a fonte da autorização); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 7:** registro VER-036 (D6, fontes, sondas, a aproximação da simulação, o limite da N5, sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 3: migração `ao_vivo_e_pareamento` e testes de banco da E3

**Arquivos:**
- Criar: `supabase/migrations/<AAAAMMDDHHMMSS>_ao_vivo_e_pareamento.sql`, registro `docs/verificacoes/AAAA-MM-DD-037-e3-banco-ao-vivo.md`
- Modificar: `supabase/tests/rls.test.ts` (bloco novo no fim; os 5 testes da E0 e o auxiliar `temPrivilegio` do Passo 1), `supabase/tests/matriz.test.ts` (D7), `supabase/tests/restricoes.test.ts` (`chaves-estrangeiras`), `scripts/check-data-api.mjs` (`SOMENTE_FUNCOES`) e o teste que confere a lista, `supabase/tests/README.md`, `supabase/migrations/README.md`, `supabase/README.md` ("Onde": as quatro migrações), `scripts/README.md`, `docs/verificacoes/README.md`

- [ ] **Passo 1: testes de banco (falham).** `describe('E3 — pareamento, ao vivo e canais', ...)` no mesmo banco e nas mesmas transações de `rls.test.ts`. Sessões: as 9 da E2, mais uma sessão anônima nova por teste de pareamento (`cadastrarUsuario` anônimo). `CODIGO` = forma de 43 caracteres.

| Teste | Ação | Esperado |
|---|---|---|
| `e3-codigo-so-equipe` | cada sessão: `select * from public.criar_codigo_pareamento('obs_palco', 'PC', null, null)` | ana e adm: 1 linha, `codigo` casa com `FORMA_DO_CODIGO`; as outras 7: `42501` (anon: `permission denied`) |
| `e3-codigo-so-hash` | ana cria; superusuário lê `codigos_pareamento` | 0 linhas com `codigo_hash = <código>`; 1 com `encode(sha256(...), 'hex')`; nenhuma coluna guarda o código |
| `e3-codigo-aleatorio` | 50 códigos | 50 distintos, todos com 43 caracteres |
| `e3-codigo-obs-camera-exige-camera` | `obs_camera` sem `camera_id`, com o id do palco, com o da câmera | `22023`, `22023`, ok (`camera_id` gravado) |
| `e3-codigo-novo-invalida-pendente` | dois códigos para o mesmo dispositivo; parear com o primeiro | `invalido`; com o segundo, `pareado` |
| `e3-parear-so-anonima` | ana chama `parear_dispositivo` | `42501` |
| `e3-parear-ok` | sessão anônima nova pareia um `obs_palco` novo | `pareado`; `dispositivo_atual()` da sessão devolve o dispositivo; `usado_em` preenchido; lê `midias` |
| `e3-codigo-uso-unico` | outra sessão anônima usa o mesmo código | `invalido` |
| `e3-codigo-expirado` | superusuário põe `expira_em` no passado | `invalido` |
| `e3-parear-tipo-errado` | código de `obs_palco` com `p_tipo = 'camera'`; depois com `obs_palco` | `tipo_errado` (`usado_em` nulo, nenhuma tentativa gravada); depois `pareado` |
| `e3-limite-de-tentativas` | 5 códigos errados na mesma sessão; depois um válido | 6º → `limite` (o válido continua sem uso); outra sessão pareia com ele; com as tentativas recuadas 11 min (superusuário), a primeira sessão volta a tentar |
| `e3-parear-de-novo-troca-sessao` | código novo para `ID_PALCO` (já pareado com `UID_SESSAO_PALCO`); sessão nova pareia | `UID_SESSAO_PALCO` perde o dispositivo (`dispositivo_atual()` vazio, `midias` 0 linhas); `revogado_em` nulo |
| `e3-sessao-em-um-dispositivo-so` | a mesma sessão anônima pareia dois dispositivos | o primeiro fica com `usuario_anonimo_id` nulo |
| `e3-sem-acesso-direto` | cada sessão: `select`/`insert` em `codigos_pareamento` e `tentativas_pareamento` | `permission denied` em todos |
| `e3-revogar` | apresentadora e palco revogam o palco; ana revoga | `42501`, `42501`; ana recebe `UID_SESSAO_PALCO`; o palco: `dispositivo_atual()` vazio, `midias` 0, `insert` em `registro_acoes` recusado; códigos pendentes do palco apagados; revogar de novo → `55000` |
| `e3-revogado-nao-repareia-com-codigo-antigo` | código criado antes da revogação | `invalido` |
| `e3-episodio-ativo` (`test.each`) | sem nada; modo teste com rascunho; ao vivo + teste em outro; teste num encerrado; como estranho, anônima sem dispositivo, palco revogado, câmera | 0 linhas; `(id, 'teste')`; `(id do ao vivo, 'ao_vivo')`; 0; 0, 0, 0; 1 linha |
| `e3-iniciar-e-encerrar` | ana inicia o rascunho; inicia outro; encerra; inicia o encerrado; apresentadora inicia | `ao_vivo` e `episodio_teste_id` nulo; `23505`; `encerrado`, `gestos_ligados` falso; `55000`; `42501` |
| `e3-modo-teste` | só rascunho; com ao vivo; nulo; apresentadora | ok; `55000`; limpa; `42501` |
| `e3-estado-so-por-funcao` | ana: `update ... set estado`; `set gestos_ligados`; `set titulo, data`; `insert (titulo, estado) values ('x','ao_vivo')`; `insert (titulo, data, criado_por)` | `permission denied`, `permission denied`, ok, `permission denied`, ok |
| `e3-exclui-so-rascunho` | ana apaga um encerrado e um rascunho | 0 linhas; 1 linha |
| `e3-estudio-estado-so-leitura` | ana: `update public.estudio_estado set episodio_teste_id = null` | `permission denied` |
| `e3-meu-dispositivo` | cada sessão: `select * from public.meu_dispositivo()` | palco, câmera e `obs_camera`: exatamente 1 linha, a própria, com o `rotulo` semeado; ana, bia, adm, estranho, anônima sem dispositivo, anon: 0 linhas (anon: `permission denied`); palco revogado: 0 linhas; o palco continua lendo 0 linhas de `select * from public.dispositivos` (a função não abre a tabela; I2) |
| `e3-meu-dispositivo-colunas` | superusuário: `pg_get_function_result('public.meu_dispositivo()'::regprocedure)` | `TABLE(id uuid, tipo tipo_dispositivo, rotulo text, camera_id uuid)`, comparado com `COLUNAS_DE_MEU_DISPOSITIVO` exportada por `src/domains/acesso/dispositivos.ts` (Tarefa 1), a mesma constante que o adaptador da Tarefa 4 usa para ler a linha: um nome trocado de um lado derruba este teste ou o do adaptador |
| `e3-canal-matriz` (`test.each` sobre as 10 sessões × tópicos `estudio`, `episodio:<ativo>:controle`, `episodio:<outro>:controle`, `episodio:<ativo>:video`, `x` × `broadcast`/`presence`/`persistence` × `receber`/`enviar`, com `comoCanal`) | modo teste com `ID_EPISODIO` | exatamente a tabela da D6, `persistence` sempre `false` (a tabela de esperados fica no teste, uma linha por sessão) |
| `e3-canal-segue-o-episodio-ativo` | ana entra no `:controle` do teste; ana encerra o teste (sem episódio ativo) | `true`; depois `false` |
| `e3-revogado-sem-canal` | palco revogado em `estudio` e `:controle` | `false` em todos |
| `e3-politicas-do-canal` | superusuário: `pg_policies` de `realtime.messages` | 2 linhas, `{authenticated}`, `SELECT` e `INSERT` |

  `matriz.test.ts`: `episodios` passa a `update` por coluna (o `update` da matriz mexe só em `titulo`, continua aceito) e `delete` só em rascunho (o caso de linha fixa em `ao_vivo`/`encerrado` vira 0 linhas para `equipe`), `estudio_estado` sem `update` para ninguém; cada mudança com o comentário da D7.

  **Testes da E0 que a migração muda (revisão do plano, I1).** Conferido pelo revisor numa cópia com a migração aplicada: além das 10 falhas previstas na matriz, caem 6 testes. Cada um é ajustado assim, sem enfraquecer a prova:

| Teste (arquivo) | Por que cai | O que muda | Por que não enfraquece |
|---|---|---|---|
| `admin-escreve-preparacao` (`rls.test.ts`) | faz `update public.estudio_estado` como `adm`, que perde o privilégio (D7) | a linha do `update` vira `select public.definir_modo_teste($1)` como `adm` seguido da leitura de `episodio_teste_id` (= `ID_EPISODIO`), e o `update` direto passa a esperar `permission denied for table estudio_estado` | continua provando que o `admin` liga o modo teste (pelo único caminho que sobrou) e passa a provar também que o caminho direto foi fechado |
| `apresentadora-nao-apaga-nem-altera-estudio` (`rls.test.ts`) | o controle da equipe faz o mesmo `update` em `estudio_estado` | `alteraEstudio` de bia passa a esperar `permission denied` (antes: 0 linhas pela RLS) e `definir_modo_teste` de bia, `42501`; o controle de ana vira `definir_modo_teste` com a leitura do resultado; os `delete` não mudam (`ID_EPISODIO` é rascunho, ana ainda o apaga) | a recusa fica mais forte (falta de privilégio antes da RLS, e a função também recusa); o controle positivo continua mostrando que o 0/recusa não vem de tabela vazia |
| `acl-de-tabelas-e-sequencias` (`rls.test.ts`) | `PRIVILEGIOS_AUTHENTICATED` lista `episodios` com `INSERT`/`UPDATE` e `estudio_estado` com `UPDATE` de tabela, e o teste exige "nenhum privilégio de coluna" | `PRIVILEGIOS_AUTHENTICATED`: `episodios: ['DELETE', 'SELECT']`, `estudio_estado: ['SELECT']`, `tentativas_pareamento: []`; constante nova `PRIVILEGIOS_POR_COLUNA = { episodios: { INSERT: ['criado_por', 'data', 'titulo'], UPDATE: ['data', 'titulo'] } }`; "nenhum privilégio de coluna" vira "exatamente estes" (consulta de `aclexplode(attacl)` agrupada por tabela, papel, privilégio e coluna, comparada com a constante, inclusive sem `anon`, `service_role` e sem *grant option*); o controle de tabelas com ACL passa de 12 para 13 | a lista continua exata nos dois sentidos (um privilégio a mais ou a menos, de tabela ou de coluna, derruba o teste); antes, um grant por coluna derrubava por existir, agora derruba se não for exatamente o da D7 |
| `dono-da-migracao-sem-superusuario` (`rls.test.ts`) | o controle conta `12 + 3` (tabelas e funções de `public`) | passa a `13 + 12` (13 tabelas com `tentativas_pareamento`; 3 funções da E0 + 9 da E3), com o comentário listando as nove (o revisor contou 20 numa cópia que só tinha 4 das funções da E3) | a conferência principal (todos os objetos de `public` são do dono das migrações) não muda; o controle continua exato e acusa objeto a mais ou a menos |
| `dispositivos-nao-escrevem-preparacao` (`rls.test.ts`) | `semEfeito` decide pelo `temPrivilegio` de tabela, e `update public.episodios set titulo = 'x', gestos_ligados = true` agora dá `permission denied` para `authenticated` por causa da coluna `gestos_ligados`; `estudio_estado` sem `update` | `temPrivilegio(sessao, tabela, operacao, colunas?)` passa a entender coluna: verdadeiro se a operação está em `PRIVILEGIOS_AUTHENTICATED[tabela]` **ou** se todas as colunas citadas estão em `PRIVILEGIOS_POR_COLUNA[tabela][operacao]`; `semEfeito` e `insercaoRecusada` extraem as colunas do `set` e da lista do `insert`; `semPrivilegioERls`, ao dar e tirar o privilégio de tabela temporário, **reaplica `PRIVILEGIOS_POR_COLUNA`** depois do `revoke` (no Postgres, revogar o privilégio de tabela também revoga o das colunas) | o teste continua conferindo as duas camadas: primeiro o `permission denied` exato e depois, com o privilégio dado à força, a RLS negando sozinha (0 linhas; retrato igual); o auxiliar ganha um caso a mais (coluna), não perde nenhum |
| `chaves-estrangeiras` (`restricoes.test.ts`) | lista exata das chaves estrangeiras de `public` | acrescenta `'tentativas_pareamento (usuario_id) -> auth.users (id) on delete cascade'` na posição da ordem alfabética (depois de `sons (...)`) | a lista continua exata; a chave nova (apagar o usuário anônimo apaga as tentativas) passa a ser provada |

  Teste novo do auxiliar, no mesmo arquivo: `tem-privilegio-por-coluna` (`episodios`, `update`, `['titulo']` → verdadeiro; `['titulo', 'gestos_ligados']` → falso; `insert`, `['titulo', 'estado']` → falso; `estudio_estado`, `update` → falso).

  Rodar `npx vitest run supabase/tests`. Esperado: FAIL no bloco novo, nos casos mudados da matriz e nos 6 testes acima (com as expectativas novas, antes da migração).
- [ ] **Passo 2: migração.** Cabeçalho no padrão das anteriores (DES-001 §7, §8, §10.2; PLA-004 D2, D5–D7; depois das três anteriores; "nunca editada"; sem e-mail). Trechos que importam:

```sql
-- Tentativas falhas de pareamento por sessão anônima (D2). Só funções: RLS, nenhuma política, revoke all.
create table public.tentativas_pareamento (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index tentativas_pareamento_usuario_em on public.tentativas_pareamento (usuario_id, criado_em);
alter table public.tentativas_pareamento enable row level security;
revoke all on table public.tentativas_pareamento from anon, authenticated, service_role;

-- Código de 244 bits em base64url (43 caracteres), devolvido uma vez e guardado só como hash (D2).
create function public.criar_codigo_pareamento(p_tipo public.tipo_dispositivo, p_rotulo text, p_dispositivo uuid, p_camera uuid)
returns table (dispositivo uuid, codigo text, expira timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_disp uuid := p_dispositivo;
  v_rotulo text := pg_catalog.btrim(coalesce(p_rotulo, ''));
  v_codigo text;
begin
  if coalesce((select public.papel_atual()) in ('equipe', 'admin'), false) = false then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_disp is null then
    if pg_catalog.char_length(v_rotulo) not between 1 and 60 then raise exception 'rótulo' using errcode = '22023'; end if;
    if p_tipo = 'obs_camera' and not exists (select 1 from public.dispositivos c where c.id = p_camera and c.tipo = 'camera') then
      raise exception 'câmera' using errcode = '22023';
    end if;
    insert into public.dispositivos (tipo, rotulo, camera_id, criado_por)
      values (p_tipo, v_rotulo, case when p_tipo = 'obs_camera' then p_camera end, auth.uid())
      returning id into v_disp;
  elsif not exists (select 1 from public.dispositivos d where d.id = v_disp and d.tipo = p_tipo) then
    raise exception 'dispositivo' using errcode = '22023';
  end if;
  delete from public.codigos_pareamento c where c.dispositivo_id = v_disp and c.usado_em is null;
  delete from public.codigos_pareamento c where c.expira_em < now() - interval '1 day';
  v_codigo := pg_catalog.translate(pg_catalog.rtrim(pg_catalog.encode(
    pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()), 'base64'), '='), '+/', '-_');
  return query
    insert into public.codigos_pareamento as c (dispositivo_id, codigo_hash)
    values (v_disp, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_codigo, 'UTF8')), 'hex'))
    returning c.dispositivo_id, v_codigo, c.expira_em;
end;
$$;

-- Exceção da chamada de papel (DES-001 §8): quem chama ainda não é dispositivo. Só sessão anônima; limite de 5 falhas
-- em 10 min por sessão; código de outro tipo não é consumido (D2).
create function public.parear_dispositivo(p_codigo text, p_tipo public.tipo_dispositivo)
returns table (resultado text, dispositivo uuid, nome text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cod record;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'só sessão anônima' using errcode = '42501';
  end if;
  delete from public.tentativas_pareamento t where t.criado_em < now() - interval '1 day';
  if (select count(*) from public.tentativas_pareamento t where t.usuario_id = v_uid and t.criado_em > now() - interval '10 minutes') >= 5 then
    return query select 'limite'::text, null::uuid, null::text;
    return;
  end if;
  select c.id, c.dispositivo_id, d.tipo into v_cod
    from public.codigos_pareamento c join public.dispositivos d on d.id = c.dispositivo_id
    where pg_catalog.char_length(coalesce(p_codigo, '')) = 43
      and c.codigo_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_codigo, 'UTF8')), 'hex')
      and c.usado_em is null and c.expira_em > now()
    for update of c;
  if not found then
    insert into public.tentativas_pareamento (usuario_id) values (v_uid);
    return query select 'invalido'::text, null::uuid, null::text;
    return;
  end if;
  if v_cod.tipo <> p_tipo then
    return query select 'tipo_errado'::text, null::uuid, null::text;
    return;
  end if;
  update public.codigos_pareamento c set usado_em = now() where c.id = v_cod.id;
  update public.dispositivos d set usuario_anonimo_id = null where d.usuario_anonimo_id = v_uid and d.id <> v_cod.dispositivo_id;
  return query
    update public.dispositivos d set usuario_anonimo_id = v_uid, pareado_em = now(), revogado_em = null
    where d.id = v_cod.dispositivo_id
    returning 'pareado'::text, d.id, d.rotulo;
end;
$$;

-- Matriz do canal (D6). Toda decisão de quem recebe e quem envia fica aqui.
create function public.pode_usar_canal(p_topico text, p_extensao text, p_enviar boolean) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_papel public.papel_app := (select public.papel_atual());
  v_tipo public.tipo_dispositivo := (select d.tipo from public.dispositivo_atual() d);
  v_ativo uuid := (select a.id from public.episodio_ativo() a);
begin
  if p_extensao is null or p_extensao not in ('broadcast', 'presence') then return false; end if;
  if p_topico = 'estudio' then
    if p_enviar and p_extensao = 'broadcast' then return coalesce(v_papel in ('equipe', 'admin'), false); end if;
    return v_papel is not null or v_tipo is not null;
  end if;
  if v_ativo is not null and p_topico = 'episodio:' || v_ativo::text || ':controle' then
    if p_enviar and p_extensao = 'presence' then return v_papel is not null; end if;
    return v_papel is not null or coalesce(v_tipo = 'obs_palco', false);
  end if;
  return false; -- :video (E4), outro episódio e qualquer outro tópico
end;
$$;

create policy canal_recebe on realtime.messages for select to authenticated
  using (public.pode_usar_canal(realtime.topic(), extension, false));
create policy canal_envia on realtime.messages for insert to authenticated
  with check (public.pode_usar_canal(realtime.topic(), extension, true));

-- D7: estado do episódio só por função.
revoke insert, update on table public.episodios from authenticated;
grant insert (titulo, data, criado_por), update (titulo, data) on table public.episodios to authenticated;
drop policy episodios_equipe_apaga on public.episodios;
create policy episodios_equipe_apaga on public.episodios for delete to authenticated
  using ((select public.papel_atual()) in ('equipe', 'admin') and estado = 'rascunho');
drop policy estudio_estado_equipe_altera on public.estudio_estado;
revoke update on table public.estudio_estado from authenticated;
```

  As demais funções seguem o mesmo molde (conferência de papel no começo com `coalesce(... , false)`, `pg_catalog.` nas funções do Postgres, `revoke execute ... from public, anon, service_role` e `grant execute ... to authenticated` em todas as nove): `meu_dispositivo()` (D4/I2: `select d.id, d.tipo, d.rotulo, d.camera_id from public.dispositivos d join public.dispositivo_atual() a on a.id = d.id`; `language sql stable`; chama `dispositivo_atual()`, então passa no `rpc:grants-check` sem exceção), `episodio_ativo()` (o `ao_vivo`; sem ele, o `episodio_teste_id` em `rascunho`; só para membro com papel ou dispositivo não revogado), `iniciar_ao_vivo`, `encerrar_ao_vivo`, `definir_modo_teste` (D7; `atualizado_por = auth.uid()`, `atualizado_em = now()`), `revogar_dispositivo` (D5). Rodar `npx vitest run supabase/tests`. Esperado: todos passam.
- [ ] **Passo 3:** `tentativas_pareamento` em `SOMENTE_FUNCOES`; `npm run rpc:grants-check` e `npm run data-api:check`. Esperado: 0 erros, "4 migração(ões)".
- [ ] **Passo 4: sabotagens em memória** (a migração nunca é editada; o laço de `banco.ts` troca o trecho só no arquivo alvo, com contagem impressa e falha se 0 ocorrências; `git status --porcelain supabase/migrations` e `sha256sum` idênticos antes e depois), uma de cada vez, anotando o teste que caiu: guardar o código em claro (`codigo_hash` = `v_codigo`) → `e3-codigo-so-hash`; tirar `and c.usado_em is null` → `e3-codigo-uso-unico`; tirar `and c.expira_em > now()` → `e3-codigo-expirado`; `>= 5` → `>= 500` → `e3-limite-de-tentativas`; consumir antes de conferir o tipo → `e3-parear-tipo-errado`; tirar a conferência de sessão anônima → `e3-parear-so-anonima`; não apagar os pendentes ao revogar → `e3-revogado-nao-repareia-com-codigo-antigo`; `return v_papel is not null or v_tipo is not null` também no `broadcast` de `estudio` → `e3-canal-matriz` (dispositivos e apresentadora publicando); tirar o `episodio:<ativo>` e aceitar `like 'episodio:%:controle'` → `e3-canal-matriz` (outro episódio) e `e3-canal-segue-o-episodio-ativo`; tirar o `revoke ... update` de `episodios` → `e3-estado-so-por-funcao`; tirar `and estado = 'rascunho'` → `e3-exclui-so-rascunho`; `meu_dispositivo` sem a junção com `dispositivo_atual()` (todas as linhas) → `e3-meu-dispositivo`; trocar `d.rotulo` por `d.rotulo as nome` → `e3-meu-dispositivo-colunas`; `temPrivilegio` ignorando as colunas → `tem-privilegio-por-coluna` e `dispositivos-nao-escrevem-preparacao`; não reaplicar `PRIVILEGIOS_POR_COLUNA` depois do `revoke` temporário → `dispositivos-nao-escrevem-preparacao` (da segunda sessão em diante, o `insert (titulo)` de `episodios` passa a dar `permission denied` em vez da violação de RLS esperada; cada teste roda na própria transação, então o vazamento não chega a outro teste); e, passando pelo `data-api:check` em memória, `using (true)` em `canal_recebe` → 1 erro da regra do canal (Tarefa 2). Na simulação (edição temporária conferida por `sha256sum`), tirar a RLS de `realtime.messages` → `e3-canal-matriz`.
- [ ] **Passo 5:** READMEs (`supabase/migrations/README.md`: migração nova, D2, D5–D7 e Riscos; `supabase/README.md`: as quatro migrações; `supabase/tests/README.md`: bloco E3 e `comoCanal`; `scripts/README.md`: `SOMENTE_FUNCOES`); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-037 (D2, D5–D7; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato. A migração vai para o passo do responsável (Tarefa 10).

### Tarefa 4: adaptadores Supabase do pareamento, do ao vivo e do canal; composição por tipo de cliente

**Arquivos:**
- Criar: `src/shared/infra/dispositivoSupabase.ts`, `aoVivoSupabase.ts`, `canalSupabase.ts` (+ testes), registro `docs/verificacoes/AAAA-MM-DD-038-e3-adaptadores-ao-vivo.md`
- Modificar: `src/app/servicos.ts` (+ teste), `src/app/dependencias.ts` (+ teste), `src/app/servicosFalsos.ts` (`aoVivoVazio`, `criarCanalFalso`, `criarFalsosDeDispositivo`), `src/app/App.test.tsx`, `src/shared/infra/README.md`, `src/app/README.md`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// src/shared/infra/dispositivoSupabase.ts
export function criarServicoDeDispositivoSupabase(cliente: SupabaseClient): ServicoDeDispositivo
// sessaoAtual: auth.getSession() → { usuarioId: user.id, anonima: user.is_anonymous === true }; entrarAnonimo: auth.signInAnonymously();
// parear: rpc('parear_dispositivo', { p_codigo, p_tipo }) → primeira linha; resultado fora da lista → 'invalido'; sair: signOut({ scope: 'local' })
// dispositivoAtual: rpc('meu_dispositivo') → primeira linha, lida pelos nomes de COLUNAS_DE_MEU_DISPOSITIVO (domínio, Tarefa 1); nunca rpc('dispositivo_atual'), que não tem rotulo (I2)
// src/shared/infra/aoVivoSupabase.ts
export const VALIDADE_NO_PALCO_S = 3600
export function criarRepositorioDoAoVivo(cliente: SupabaseClient): RepositorioDoAoVivo
export function criarRepositorioDoPalco(cliente: SupabaseClient): RepositorioDoPalco
export function traduzirErroDoAoVivo(erro: { code?: string; message?: string; name?: string } | null, status?: number): MotivoDoAoVivo // 55000 → estado_invalido; 22023 → invalido; o resto por classificarErro (sem mudar errosSupabase.ts)
// src/shared/infra/canalSupabase.ts
export function criarFabricaDeCanais(cliente: SupabaseClient, usuarioId: string, agendar?: (f: () => void) => void): FabricaDeCanais
// src/app/servicos.ts
export function obterServicosDeAoVivo(): { repo: RepositorioDoAoVivo; canais: (usuarioId: string) => FabricaDeCanais } // mesmo cliente de membro
export function obterServicosDeDispositivo(tipo: TipoDeDispositivo): { servico: ServicoDeDispositivo; palco: RepositorioDoPalco; canais: (usuarioId: string) => FabricaDeCanais } // um cliente por tipo, preguiçoso
// src/app/dependencias.ts: Dependencias ganha obterAoVivo (rotas de membro) e obterDispositivo(tipo) (rotas de dispositivo), limparFragmento()
```

  **Registro de canais (revisão do plano, I3).** No `realtime-js` 2.119.0, `RealtimeClient.channel(topico)` devolve o canal que já existe para o mesmo tópico (`dist/main/RealtimeClient.js:338-349`) e `on('presence', ...)` depois de `subscribe()` lança (`RealtimeChannel.js:416-421`). O painel (Tarefa 8) e o `useAoVivo` (Tarefas 7 e 9) abrem `estudio` pelo mesmo cliente de membro; por isso a fábrica guarda **um canal por tópico por cliente**, com vários ouvintes e contagem de referências: o primeiro `abrir(topico)` cria o canal, registra `broadcast`, `presence` (`sync`, `join`, `leave`) e o estado **antes** do `subscribe()`, e cada chamada devolve uma alça própria (ouvintes só dela); `fechar()` de uma alça solta os ouvintes dela e só faz `untrack()` e `removeChannel` quando a contagem chega a 0.

  **Canal fechado e reabertura (re-revisão, I-A).** No 2.119.0 e no `@supabase/phoenix`, o canal só sai de `client.channels` no `close` (`RealtimeChannel.js:106-108`, `RealtimeClient.js:446`), `leave()` só fecha quando o servidor responde ou o tempo esgota (`phoenix.cjs.js:458-473`), um canal fechado não entra de novo (`phoenix.cjs.js:321-323`) e `subscribe()` num canal `leaving` não faz nada (`RealtimeChannel.js:140`). Por isso: (1) quando o canal vai a `fechado` (pelo servidor, por exemplo na renovação do token depois de uma revogação) ou a `negado`, o registro **sai do mapa** na hora, se ainda for o atual; as alças que o seguravam recebem o estado e decidem se reabrem (fechando a própria alça e abrindo outra, que cria um canal novo); (2) um `abrir()` do mesmo tópico durante um `removeChannel` pendente devolve a alça em `conectando` e só cria o canal novo depois que a remoção termina. **Quem reabre:** o hook `useEstudio(canais, reavaliar)` (Tarefa 7), usado pelo `/controle`, pelo `useAoVivo` e pelo `Painel` (Tarefa 8): com `fechado` ou `negado`, chama `reavaliar()` e, se o componente continua montado 5 s depois (a pessoa continua membro), fecha a alça morta e abre outra; o `:controle` do `useAoVivo` segue a mesma regra. Assim o painel e a aba Ao vivo se comportam igual.

  **Eco local (re-revisão, I-B).** Com `self: false` e o canal dividido, a mensagem que uma alça envia (por exemplo, `episodio_ativo_mudou` depois de Iniciar) não chega às outras alças do mesmo cliente. O `enviar` do registro a entrega localmente às **outras** alças do mesmo registro, pelo mesmo leitor do domínio, e nunca a quem enviou; a entrega local acontece qualquer que seja a resposta do `ack` (a mensagem só diz "consulte de novo", e a mudança no banco já aconteceu). Escolhido no lugar de um `recarregar()` explícito depois de Iniciar, Encerrar e Modo teste porque cobre de uma vez toda mensagem que o próprio cliente publica (`episodio_ativo_mudou`, `dispositivo_mudou`, `revogacao`), sem uma API a mais no `useAoVivo` que cada ação nova teria de lembrar de chamar.

  Trecho que importa (`criarFabricaDeCanais`):

```ts
const registro = new Map<string, Registro>() // o canal atual de cada tópico, neste cliente
const removendo = new Map<string, Promise<void>>() // removeChannel ainda pendente, por tópico

function abrir(topico: string): Alca {
  let r = registro.get(topico)
  if (!r) {
    r = { topico, canal: null, refs: 0, estado: 'conectando', ouvintes: new Set() }
    registro.set(topico, r)
    const novo = r
    // I-A: um canal que ainda está saindo (leaving) não entra de novo; espera a remoção terminar
    void (removendo.get(topico) ?? Promise.resolve()).then(() => criarCanal(novo))
  }
  r.refs += 1
  return criarAlca(r) // a alça nasce em 'conectando'; ouvintes da alça entram em r.ouvintes; distribuir() passa por
  // lerRemetente e pelo leitor do domínio e chama cada ouvinte com agendar(); inválido ou sem remetente → descartado
}

function criarCanal(r: Registro): void {
  if (registro.get(r.topico) !== r || r.refs === 0) return // fechado antes de nascer
  const canal = cliente.channel(r.topico, {
    config: { private: true, broadcast: { ack: true, self: false }, presence: { key: usuarioId } },
  })
  r.canal = canal
  // tudo registrado antes do subscribe (o realtime-js recusa presence depois)
  canal.on('broadcast', { event: '*' }, ({ event, payload }) => distribuir(r, null, event, payload))
  canal.on('presence', { event: 'sync' }, () => distribuirPresenca(r, canal.presenceState()))
  canal.on('presence', { event: 'join' }, () => distribuirEntrada(r))
  canal.subscribe((status, erro) => {
    if (status === 'SUBSCRIBED') mudar(r, 'conectado')
    else if (status === 'CHANNEL_ERROR' && /unauthorized/i.test(erro?.message ?? '')) encerrar(r, 'negado') // só classifica
    else if (status === 'CLOSED') encerrar(r, 'fechado')
    else mudar(r, 'reconectando') // TIMED_OUT e CHANNEL_ERROR: o realtime-js tenta de novo sozinho
  })
}

/** I-A: canal fechado pelo servidor (ou negado) sai do registro; as alças que o seguravam recebem o estado e decidem. */
function encerrar(r: Registro, estado: 'fechado' | 'negado'): void {
  if (registro.get(r.topico) === r) registro.delete(r.topico) // o próximo abrir() cria um canal novo
  mudar(r, estado)
}

async function enviar(r: Registro, de: Alca, evento: string, corpo: Record<string, unknown>): Promise<RespostaDoEnvio> {
  if (r.estado !== 'conectado' || r.canal === null) return 'falhou'
  const payload = { ...corpo, remetente: usuarioId }
  const resp = await r.canal.send({ type: 'broadcast', event: evento, payload })
  // I-B: com self: false o servidor não devolve ao próprio socket; as outras alças deste cliente recebem pelo eco local,
  // pelo mesmo leitor do domínio; quem enviou não recebe a própria mensagem
  distribuir(r, de, evento, payload)
  return resp === 'ok' ? 'ok' : resp === 'timed out' ? 'sem_resposta' : 'falhou'
}

async function fechar(r: Registro, alca: Alca): Promise<void> {
  soltarOuvintes(r, alca)
  r.refs -= 1
  if (r.refs > 0) return // outra alça (por exemplo, o painel) continua usando o canal
  if (registro.get(r.topico) === r) registro.delete(r.topico)
  const canal = r.canal
  if (canal === null) return // nunca chegou a nascer (criarCanal confere refs)
  const remocao = (async () => {
    await canal.untrack()
    await cliente.removeChannel(canal) // assíncrono: o canal fica leaving até o servidor responder ou o tempo esgotar
  })().finally(() => { if (removendo.get(r.topico) === remocao) removendo.delete(r.topico) })
  removendo.set(r.topico, remocao)
  await remocao
}
```

- [ ] **Passo 1: fontes.** Conferir em `node_modules/@supabase/realtime-js` 2.119.0 (`RealtimeChannel`: assinatura de `send` com `ack`, estados de `subscribe`, `track`, `presenceState`, eventos `presence` `sync`/`join`) e em `node_modules/@supabase/supabase-js` (como o token da sessão chega ao Realtime na renovação: `setAuth`/`accessToken`); citar arquivo e linha no VER-038.
- [ ] **Passo 2: testes (falham).**

| Arquivo | Testes |
|---|---|
| `dispositivoSupabase.test.ts` | `sessao-atual` (anônima pelo `is_anonymous`; erro do `getSession` → `ErroDeDispositivo('rede')`); `entrar-anonimo` (`signInAnonymously`; erro com status 422 ou "anonymous sign-ins are disabled" → `negado`; sem resposta → `rede`); `parear-chama-rpc` (`rpc('parear_dispositivo', { p_codigo, p_tipo })`; cada resultado; desconhecido → `invalido`; erro 42501 → `negado`); `parear-sem-console` (`console.*` espionados nunca recebem o código, nem em erro); `dispositivo-atual` (`rpc('meu_dispositivo')` e nunca `rpc('dispositivo_atual')`; o falso devolve a linha só com as colunas de `COLUNAS_DE_MEU_DISPOSITIVO` e valores diferentes em cada uma, `{ id, tipo: 'obs_palco', rotulo: 'PC do estúdio', camera_id: null }`, e o teste confere que `rotulo` vem da coluna `rotulo`; sem linha → `null`; tipo fora da lista → `null`; com o `e3-meu-dispositivo-colunas` da Tarefa 3, prova que o adaptador lê as colunas que a função devolve); `sair-local` (`signOut({ scope: 'local' })`; erro não lança) |
| `aoVivoSupabase.test.ts` | `rpcs-e-parametros` (`episodio_ativo`, `iniciar_ao_vivo { p_episodio }`, `encerrar_ao_vivo`, `definir_modo_teste { p_episodio: null }`, `criar_codigo_pareamento { p_tipo, p_rotulo, p_dispositivo, p_camera }` → `{ dispositivoId, codigo, expiraEm }`, `revogar_dispositivo { p_dispositivo }` → `{ usuario }`); `listar-dispositivos` (`select('id, tipo, rotulo, camera_id, usuario_anonimo_id, pareado_em, revogado_em').order('tipo')`, linha fora do domínio descartada); `erros-do-ao-vivo` (55000, 22023, 23505, 42501, 401, status 0); `palco-carrega` (episódio por id; cenas por ordem; sons com o `caminho` da mídia; avisos do episódio por ordem com o `caminho` da imagem); `palco-url-de-arquivo` (`createSignedUrl(caminho, 3600)`); `palco-registra` (`insert` em `registro_acoes` com exatamente as colunas da D9, sem `select` depois) |
| `canalSupabase.test.ts` (realtime falso que registra `channel`, `subscribe`, `send`, `track`, `on`, `removeChannel`) | `canal-privado` (configuração acima; tópicos `estudio` e `episodio:<id>:controle`); `envia-com-remetente`; `recebe-valida` (inválido, sem remetente e de remetente com uuid em maiúsculas: descartados; o válido chega com o remetente); `estados-do-canal` (cada status → estado; `negado` só com o texto de não autorizado); `ack` (`'ok'`, `'timed out'`, `'error'`; não conectado → `falhou` sem chamar `send`); `presenca` (`track` com o corpo; `sync` → lista validada, inválida descartada); `entrar-alguem` (`presence` `join` no `:controle` → `aoEntrarAlguem`); `ouvinte-adiado` (nenhum ouvinte roda dentro do callback do `realtime-js`); `fechar-remove-canal` (`removeChannel` 1 vez; ouvintes soltos); `um-canal-por-topico` (duas alças de `estudio` no mesmo cliente → 1 `channel` e 1 `subscribe`; uma mensagem chega aos ouvintes das duas; alças de tópicos diferentes → canais diferentes); `fechar-um-nao-derruba-o-outro` (fechar a primeira alça: `removeChannel` não chamado, a segunda continua recebendo e enviando; fechar a segunda: `untrack` e `removeChannel` 1 vez); `presence-antes-do-subscribe` (toda chamada `on('presence', ...)` acontece antes do `subscribe()`; abrir a segunda alça depois do `subscribe` não chama `on` de novo); `canal-fechado-sai-do-registro` (o servidor fecha o canal com duas alças abertas: as duas recebem `fechado`; um `abrir()` seguinte cria outro `channel` e outro `subscribe`, mesmo com as alças antigas ainda não fechadas); `reabrir-depois-de-fechado` (a alça que recebeu `fechado` se fecha e abre de novo → canal novo `conectado`; fechar a alça antiga depois não remove o canal novo); `abrir-durante-remocao` (fechar a última alça e abrir o mesmo tópico antes de o `removeChannel` falso resolver: a alça nova fica em `conectando` e nenhum `channel` novo é criado até a remoção terminar; depois, 1 `channel` novo e `conectado`); `eco-local` (alça A envia `episodio_ativo_mudou`: a alça B do mesmo tópico recebe 1 vez, com o `remetente` do cliente; A não recebe; com `ack` `timed out`, B recebe do mesmo jeito). O realtime falso imita também o `leaving` e o `join` único: `removeChannel` é assíncrono (resolve quando o teste mandar), `channel(topico)` devolve o canal em `leaving` enquanto ele não saiu, `subscribe()` nesse canal não faz nada, e um canal fechado lança "tried to join multiple times" se receber `subscribe()` de novo. O realtime falso imita o 2.119.0: `channel(topico)` devolve o canal existente para o mesmo tópico, e `on('presence', ...)` depois de `subscribe()` lança o mesmo erro; os falsos das telas (`criarCanalFalso` em `servicosFalsos.ts`) também reaproveitam o canal por tópico |
| `servicos.test.ts` | `obterServicosDeAoVivo` usa o mesmo cliente de membro (1 `createClient` com `obterServicosDeMembro`); `obterServicosDeDispositivo('obs_palco')` cria 1 cliente com `storageKey` `revocast-auth-obs_palco` e `detectSessionInUrl: false`; duas chamadas → 1; configuração inválida → `ErroDeConfiguracao` sem cliente |
| `App.test.tsx` | `caminho-padrao-nao-cria-cliente-em-dispositivo` reescrito: em `/camera`, `/obs/palco` e `/obs/camera`, nenhum `createClient` com `revocast-auth-membro`; `dispositivo-cria-so-o-proprio-cliente`: em cada rota de dispositivo, exatamente 1 `createClient`, com a `storageKey` do tipo; em `/painel`, só o de membro |

- [ ] **Passo 3:** implementar; `servicos.ts` guarda um cliente por tipo (`Map<TipoDeSessao, ...>`), sempre preguiçoso. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** `private: false` → `canal-privado`; `ack: false` → `canal-privado` e `ack`; repassar o `payload` sem leitor → `recebe-valida`; chamar o ouvinte direto no callback → `ouvinte-adiado`; criar um canal novo a cada `abrir` → `um-canal-por-topico` (no falso, o segundo `on('presence')` lança); `removeChannel` em todo `fechar` → `fechar-um-nao-derruba-o-outro`; registrar `presence` depois do `subscribe` → `presence-antes-do-subscribe`; manter no mapa o registro fechado pelo servidor → `canal-fechado-sai-do-registro` e `reabrir-depois-de-fechado`; criar o canal sem esperar a remoção pendente → `abrir-durante-remocao`; tirar o eco local → `eco-local`; ecoar também para quem enviou → `eco-local`; ler `rpc('dispositivo_atual')` → `dispositivo-atual`; `signOut()` global → `sair-local`; registrar o código num `console.warn` de erro → `parear-sem-console`; criar o cliente de membro no caminho padrão de `/obs/palco` → `caminho-padrao-nao-cria-cliente-em-dispositivo`; usar a `storageKey` de `camera` no palco → `dispositivo-cria-so-o-proprio-cliente`; mapear `55000` para `outro` → `erros-do-ao-vivo`.
- [ ] **Passo 5:** READMEs; `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-038 (D4, I2 no adaptador, I3, I-A, I-B, D6 no cliente, D14, D15; fontes do Passo 1; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 5: Integração OBS e serviço do palco

**Arquivos:**
- Criar: `src/domains/obs/README.md`, `src/domains/obs/{portas,versao,executor}.ts` (+ testes de `versao` e `executor`), `src/domains/aovivo/palco.ts` (+ teste), `src/shared/infra/obsNavegador.ts`, `src/shared/infra/obsWebsocket.ts` (+ testes), registro `docs/verificacoes/AAAA-MM-DD-039-e3-integracao-obs-e-palco.md`
- Modificar: `src/domains/README.md`, `src/domains/aovivo/README.md`, `src/shared/infra/README.md`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// obs/portas.ts (níveis do obs-browser: 0 NONE, 1 READ_OBS, 2 READ_USER, 3 BASIC, 4 ADVANCED, 5 ALL)
export interface ObsNoNavegador {
  disponivel(): boolean; versaoDoPlugin(): string | null; nivel(): Promise<number | null>
  cenas(): Promise<string[] | null>; cenaAtual(): Promise<string | null>; status(): Promise<{ gravando: boolean; replayBuffer: boolean; transmitindo: boolean; cameraVirtual: boolean } | null> // a saída conta como no ar com qualquer um verdadeiro (D10)
  aoMudarSaida(f: () => void): () => void // obsStreamingStarting/Started/Stopped, obsRecordingStarting/Started/Stopped, obsReplaybufferStarting/Started/Stopped, obsVirtualcamStarted/Stopped (só os que existirem no Passo 1)
  trocarCena(nome: string): void; salvarClipe(): void
}
export interface ObsWebsocket { conectar(c: { porta: number; senha: string }): Promise<'conectado' | 'senha_errada' | 'sem_conexao'>; versao(): Promise<string | null>; marcar(nome: string): Promise<boolean>; fechar(): void }
// obs/versao.ts
export const VERSAO_MINIMA_DO_OBS = '30.2.0'
export function versaoAtende(v: string | null): boolean | null // '30.2.0', '30.2', '31.0.1' → true; '30.1.2' → false; null ou 'x' → null
// obs/executor.ts
export const ESPERA_DO_CLIPE_MS = 5000
export function criarExecutorObs(d: { obs: ObsNoNavegador; ws: ObsWebsocket | null; tocarSom(somId: string, volume: number): Promise<boolean>; mostrarAviso(id: string, duracaoS: number): void; ocultarAviso(): void; agendar(f: () => void, ms: number): void }): ExecutorDeAcoes
// aovivo/palco.ts
export const ESTADO_A_CADA_MS = 30_000
export function criarPalco(d: { canal: CanalDoControle; repo: RepositorioDoPalco; executor: ExecutorDeAcoes; revogados: Revogados; episodio: { id: string; modo: 'ao_vivo' | 'teste' }; dados: Awaited<ReturnType<RepositorioDoPalco['carregar']>>; meuUsuario: string; agendarRepeticao(f: () => void, ms: number): () => void }): { estado(): EstadoNoAr; aoMudar(f: (e: EstadoNoAr) => void): () => void; parar(): void }
```

  `obsWebsocket.ts`: `criarObsWebsocket(criarSocket = (url: string) => new WebSocket(url, 'obswebsocket.json'))`; a autenticação:

```ts
async function sha256Base64(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
  return btoa(String.fromCharCode(...bytes))
}
// Hello { authentication: { challenge, salt } } → Identify { rpcVersion: 1, authentication: await sha256Base64((await sha256Base64(senha + salt)) + challenge), eventSubscriptions: 0 }
```

- [ ] **Passo 1: fontes.** Ler e citar no VER-039: o `README` do `obs-browser` (API de `window.obsstudio` no OBS 30: `pluginVersion`, `getControlLevel`, `getStatus`, `getScenes`, `getCurrentScene`, `setCurrentScene`, `saveReplayBuffer` e o nível de cada uma; os campos de `getStatus` (`streaming`, `recording`, `virtualcam`, `replaybuffer`) e os eventos de saída `obsStreamingStarting`/`Started`/`Stopped`, `obsRecordingStarting`/`Started`/`Stopped`, `obsReplaybufferStarting`/`Started`/`Stopped`, `obsVirtualcamStarted`/`Stopped` (anotar quais existem); e que `obsSourceActiveChanged` não serve para saber se a saída está no ar, porque a Fonte fica em todas as cenas, I5) e o protocolo do `obs-websocket` 5 (`docs/generated/protocol.md`: `Hello`, `Identify`, códigos de fechamento, `GetVersion`, `CreateRecordChapter`, que exige OBS 30.2 e gravação em Hybrid MP4).
- [ ] **Passo 2: testes (falham).**

| Arquivo | Testes |
|---|---|
| `versao.test.ts` | `versao-minima` (os casos da interface) |
| `executor.test.ts` (OBS falso, relógio falso) | `trocar-cena-existente`; `cena-inexistente-no-obs` (`recusado`, `cena_inexistente_no_obs`, `trocarCena` não chamado); `sem-permissao` (nível 3 → cena `recusado`/`sem_permissao`; nível 2 → clipe também); `clipe-espera-5s` (`salvarClipe` em 5 000 ms, não em 4 999; resultado `pendente` e depois `ok`); `clipe-repetido-ignorado`; `clipe-sem-replay-buffer` (`falhou`, `replay_desligado`); `marcador-sem-websocket` (`falhou`, `sem_websocket`); `marcador-sem-gravacao` (`falhou`, `sem_gravacao`); `marcador-ok`; `obs-ausente` (cena, clipe e marcador → `falhou`/`obs_ausente`; som e aviso funcionam, são da própria página) |
| `palco.test.ts` (canal, repo e executor falsos) | `comando-valido-executa`; `comando-invalido-descartado` (nenhum efeito, nenhum estado publicado); `comando-duplicado` (mesmo `id` 2 vezes → 1 execução); `remetente-revogado`; `som-inexistente` (`recusado` publicado, executor não chamado); `estado-apos-comando`; `estado-a-cada-30s`; `estado-ao-entrar-alguem`; `registro-com-teste` (modo teste → `teste: true`; `recusado` não registra); `registro-falha-nao-para` (o estado continua `ok`); `aviso-expira` (relógio falso: `avisoId` volta a nulo em `duracaoS`); `ignora-o-proprio-comando` |
| `obsNavegador.test.ts` | `sem-obsstudio` (`disponivel()` falso; leituras → `null`); `callbacks-viram-promessas` (com tempo-limite de 3 s → `null`); `nivel`; `status-da-saida` (`getStatus` com `streaming`, `recording` e `virtualcam` → `transmitindo`, `gravando`, `cameraVirtual`; cada evento de início (inclusive os `Starting`) e de fim de saída disparado em `window` chama o ouvinte de `aoMudarSaida`, e a função devolvida o solta) |
| `obsWebsocket.test.ts` (`WebSocket` falso) | `autenticacao` (vetor calculado no teste com `node:crypto`); `identify-sem-senha` (`Hello` sem `authentication`); `senha-errada` (fechamento 4009); `sem-conexao` (erro ou 5 s sem `Hello`); `get-version`; `create-record-chapter` (`requestType`, `requestId` único, `chapterName`; `requestStatus.result` falso → `false`); `senha-nunca-sai` (nenhum quadro enviado contém a senha; `console.*` nunca a recebe) |

- [ ] **Passo 3:** implementar. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** espera do clipe de 4 999 ms → `clipe-espera-5s`; sem a guarda do clipe pendente → `clipe-repetido-ignorado`; trocar cena sem conferir a lista → `cena-inexistente-no-obs`; sem deduplicação → `comando-duplicado`; executar antes de resolver → `som-inexistente`; registrar recusas → `registro-com-teste`; mandar a senha no `Identify` em vez do hash → `senha-nunca-sai` e `autenticacao`; não republicar na entrada → `estado-ao-entrar-alguem`.
- [ ] **Passo 5:** READMEs (`src/domains/obs/` com 11 seções; em "Lógica", a tabela ação → chamada do OBS → nível exigido); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-039 (D9, D10, D13; fontes; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 6: rotas de dispositivo — pareamento e `/obs/palco` no ar

**Arquivos:**
- Criar: `src/app/useDispositivo.ts`, `src/app/telas/TelaDeDispositivo.tsx` (+ teste), `src/app/telas/PalcoNoAr.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-040-e3-telas-de-dispositivo.md`
- Modificar: `index.html` (script da classe do palco, N2; mínimo 19 linhas), `src/app/App.tsx` (as três rotas recebem `dependencias`), `src/app/telas/ObsPalco.tsx`, `Camera.tsx`, `ObsCamera.tsx`, `src/app/App.test.tsx` (frases), `src/shared/styles/base.css`, READMEs de `src/app/`, `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
export function useDispositivo(tipo: TipoDeDispositivo, dependencias: Dependencias): { estado: EstadoDoDispositivo | { tipo: 'carregando' } | { tipo: 'configuracao'; variavel: string }; tentarDeNovo(): void; marcarRevogado(): void }
export function TelaDeDispositivo(props: { tipo: TipoDeDispositivo; titulo: string; dependencias: Dependencias; children: (pareado: { dispositivo: …; servicos: …; marcarRevogado(): void }) => ReactNode }): ReactNode
export function PalcoNoAr(props: { dispositivo: …; servicos: …; obs: ObsNoNavegador; criarWs: () => ObsWebsocket; armazenamentoLocal: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; marcarRevogado(): void }): ReactNode
```

  `useDispositivo`: lê o fragmento **uma vez** (`codigoDoFragmento(dependencias.fragmento)`), chama `dependencias.limparFragmento()` **antes** de `obterDispositivo(tipo)` e de qualquer rede, e chama `resolverDispositivo`. Mensagens fixas: `sem_link` "Este aparelho não está pareado (ou foi revogado). Abra o link ou o QR gerado na aba Ao vivo do painel."; `link_invalido` "Link inválido ou expirado. Gere outro no painel."; `tipo_errado` "Este link é de outro tipo de dispositivo."; `limite` "Muitas tentativas. Espere 10 minutos ou gere outro link."; `revogado` (só pelo aviso do canal, ao vivo) "Este dispositivo foi revogado. Gere um novo link no painel."; `falha` "Não foi possível falar com o servidor." + "Tentar de novo". `/camera` e `/obs/camera` pareados: "Pareado como <rótulo>. O vídeo chega na etapa E4.", presença em `estudio` e revogação. `PalcoNoAr`: canal `estudio` (presença com a `SituacaoDoObs`, `episodio_ativo_mudou`, `revogacao`); `episodioAtivo()` ao entrar, ao reconectar e no aviso; com episódio: `carregar`, URLs assinadas dos sons (`<audio preload="auto">`) e das imagens dos avisos (renovadas a cada 45 min), canal `:controle`, `criarPalco`; aviso no ar como cartão (D16) e **nada mais** na tela pareada; selo só pela tecla `s`, por 5 s, e painel de configuração do websocket (D10) só pela tecla `c`, com o aviso "Este painel aparece na transmissão: configure antes de ir ao ar.", `<input type="password">` (a senha salva nunca volta ao campo), porta e "Salvar", gravados em `revocast-obs-websocket` do armazenamento local, fechado sozinho em 2 min; os dois são recusados (e fechados na hora, por `aoMudarSaida`) com a saída no ar ou com o status desconhecido (D10, D16); canal `fechado` ou `negado` → refaz `resolverDispositivo` (sem dispositivo → tela de revogado e `sair()`; com dispositivo → reabre os canais depois de 5 s; D15, N3); `revogacao` do próprio `usuarioId` → fecha canais, `sair()`, `marcarRevogado()`.

- [ ] **Passo 1: testes (falham).**

| Teste | Esperado |
|---|---|
| `fragmento-limpo-antes-da-rede` | `limparFragmento` registrado antes de `sessaoAtual` e `entrarAnonimo` |
| `pareia-e-mostra` (`/camera` com código) | "Pareado como Celular de gravação. O vídeo chega na etapa E4." |
| `link-invalido`, `tipo-errado`, `limite`, `sem-link`, `falha-e-tentar-de-novo` | as mensagens fixas; "Tentar de novo" refaz a avaliação |
| `codigo-nunca-em-armazenamento` | `localStorage`/`sessionStorage` (espionados) e `console.*` nunca recebem o código |
| `configuracao` | sem variáveis: "Configuração incompleta" com o nome da variável |
| `revogado-na-hora` | `revogacao` com o próprio usuário → canais fechados, `sair` 1 vez, "Este dispositivo foi revogado…"; de outro usuário → nada |
| `palco-sem-nada-sem-tecla` (`test.each`: sem episódio, modo teste, `ao_vivo`) | nenhum cartão, nenhum selo, nenhum texto na tela pareada (`container.textContent` vazio) |
| `selo-por-tecla` | OBS falso fora do ar: tecla `s` → selo "Palco · aguardando episódio" (ou "Modo teste: <título>"); 5 s depois (relógio falso) → some |
| `selo-e-config-recusados-no-ar` (`test.each`: transmitindo, gravando, Replay Buffer ativo, câmera virtual, status `null`; e com o painel aberto, `obsStreamingStarting` e `obsRecordingStarting` o fecham) | teclas `s` e `c` → nada aparece; com o painel aberto fora do ar, o evento de início da transmissão o fecha na hora |
| `palco-mostra-aviso-literal` | comando `aviso` com título `<b>x</b>`, texto `<script>alert(1)</script>` e link → texto literal; `querySelector('script, b, a')` é `null` |
| `palco-toca-som` | `Audio` falso: `currentTime = 0`, `volume` do som, `play` 1 vez |
| `palco-presenca-com-obs` | presença com `navegador: false` sem `window.obsstudio`; com o falso, nível e status |
| `palco-config-escondida` | sem tecla, nenhum campo; `c` abre (fora do ar) com o aviso "Este painel aparece na transmissão…" e campo `type="password"`; "Salvar" grava no armazenamento falso; reaberto, o campo vem vazio; a senha não fica no DOM depois de salvar nem na presença; fecha sozinho em 2 min (relógio falso) |
| `palco-reconecta` | canal `reconectando` → `conectado` → `episodioAtivo` chamado de novo; estado republicado |
| `palco-troca-de-episodio` | `episodio_ativo_mudou` → `:controle` antigo fechado e o novo aberto |
| `palco-canal-fechado` | canal `fechado` com `dispositivoAtual` → `null`: tela de revogado e `sair` 1 vez; com dispositivo: canais reabertos depois de 5 s (relógio falso) |
| `palco-sem-piscar` | `index.html` tem, no `<head>`, um `<script>` clássico (sem `type="module"`) que só põe a classe `palco` em `<html>` quando `location.pathname` sem a barra final é `/obs/palco`; `base.css` tem `html.palco, html.palco body { background: transparent }`; rodando o script num documento jsdom com `/obs/palco` e com `/obs/palcox` → classe só no primeiro (N2) |
| `tipo-errado-nao-guarda-sessao` | `tipo_errado` → `sair` 1 vez; ao recarregar (nova renderização com a mesma sessão falsa já sem usuário) → `sem_link`, nunca "revogado" (N1) |

- [ ] **Passo 2:** `npx vitest run src/app`. Esperado: FAIL.
- [ ] **Passo 3:** implementar; `index.html`: o `<script>` clássico do `<head>` (antes da folha de estilos e do módulo, para a primeira pintura já sair transparente na Fonte do OBS; N2); `base.css`: `html.palco, html.palco body` com fundo transparente, `aviso-no-ar`, `selo-do-palco`, `tela-de-dispositivo`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** limpar o fragmento depois de `entrarAnonimo` → `fragmento-limpo-antes-da-rede`; guardar o código no `sessionStorage` → `codigo-nunca-em-armazenamento`; mostrar o link como `<a>` no palco → `palco-mostra-aviso-literal`; selo sempre visível fora do ao vivo → `palco-sem-nada-sem-tecla`; abrir a configuração com a saída no ar → `selo-e-config-recusados-no-ar`; pôr a classe pelo React depois da montagem (sem o script do `index.html`) → `palco-sem-piscar`; tratar `fechado` como `reconectando` → `palco-canal-fechado`; painel de configuração sempre aberto → `palco-config-escondida`; não consultar o episódio ativo ao reconectar → `palco-reconecta`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-040 (D3, D4 com N1, D5 no aparelho, D10 e D16 com I5, D15 com N3, N2; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 7: `/controle` por toque

**Arquivos:**
- Criar: `src/app/useEstudio.ts` (I-A: abre `estudio`, trata `fechado`/`negado` com `reavaliar()` e reabertura em 5 s; usado também pelo `Painel` na Tarefa 8), `src/app/useAoVivo.ts`, `src/shared/ui/PainelDeComandos.tsx`, `src/app/telas/Controle.test.tsx`, registro `docs/verificacoes/AAAA-MM-DD-041-e3-controle.md`
- Modificar: `src/app/telas/Controle.tsx`, `src/app/App.test.tsx` (frase), `src/shared/styles/base.css`, READMEs de `src/app/`, `src/app/telas/`, `src/shared/ui/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
export function useAoVivo(d: { repo: RepositorioDoAoVivo; preparacao: ServicosDePreparacao; canais: FabricaDeCanais; usuario: UsuarioDaSessao; papel: Papel; reavaliar: () => void; aoVoltarAVer: Dependencias['aoVoltarAVer'] }): {
  episodio: { id: string; modo: 'ao_vivo' | 'teste'; titulo: string } | null; estadoNoAr: EstadoNoAr | null; canal: EstadoDoCanal
  palcoPresente: boolean; listas: { cenas: Cena[]; sons: Som[]; avisos: Aviso[] }; estudio: CanalDoEstudio | null
  enviar(c: Omit<Comando, 'id'>): Promise<RespostaDoEnvio>
}
export function PainelDeComandos(props: { listas: …; estadoNoAr: EstadoNoAr | null; habilitado: boolean; enviar: (c: Omit<Comando, 'id'>) => Promise<RespostaDoEnvio> }): ReactNode
```

  Layout do esboço do DES-001 §9: estado (selo "AO VIVO" ou "TESTE", cena no OBS, aviso no ar pelo título da lista), avisos (botão ▶ por aviso, "Próximo aviso", "Ocultar aviso"), sons (emoji + rótulo), cenas (nome de exibição) e **CLIPE**/**MARCAR**; último resultado ("🎵 aplauso ✓", "Cena não existe no OBS"). Mensagens: sem episódio "Nenhum episódio no ar nem em teste."; palco ausente "O palco não está conectado."; `reconectando` "Reconectando…"; `negado` e `fechado` "Sem acesso ao canal; conferindo o seu acesso." + `reavaliar()` (se a pessoa continua membro, os canais são reabertos; D15, N3); `sem_resposta` "O comando não chegou (rede ou acesso). Tente de novo.", e duas seguidas com o canal `conectado` → `reavaliar()` (um envio sem permissão volta como `timed out`, sem como separá-lo de rede ruim; N3); motivos de recusa e falha com frases fixas (tabela no README de `src/app/telas/`). Interruptor de gestos fica para a E5 (D8). `id` do comando por `crypto.randomUUID()`.

- [ ] **Passo 1: testes (falham).** `controle-sem-episodio`; `controle-mostra-estado` (cena e título do aviso no ar pela lista); `toque-envia-comando` (som, cena, aviso, próximo, ocultar, clipe, marcar → `enviarComando` com a forma de `Comando`, `id` uuid); `botoes-desligados-sem-conexao` (`reconectando` → todos desabilitados e "Reconectando…"); `ack-sem-resposta-avisa`; `estado-forjado-invalido-ignorado` (o canal falso entrega um estado inválido pelo caminho do adaptador real: nada muda); `troca-de-episodio` (`episodio_ativo_mudou` → novo `:controle`, listas recarregadas); `membro-revogado-reavalia` (`revogacao` do próprio `id` → `reavaliar` 1 vez; de outro → nada); `apresentadora-usa` (papel `apresentadora` vê e envia); `titulo-com-html-literal` (aviso e som com HTML → texto); `voltar-a-ver-reconecta` (`aoVoltarAVer` → `episodioAtivo` de novo); `palco-ausente-avisa`; `canal-fechado-reavalia` (`fechado` → a frase e `reavaliar` 1 vez; continuando montado, 5 s depois (relógio falso) a alça morta é fechada e um canal novo é aberto e chega a `conectado`); `dois-sem-resposta-reavalia` (uma resposta `sem_resposta` → só a frase; duas seguidas → `reavaliar` 1 vez; um `ok` no meio zera a contagem).
- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar; estilos `controle`, `comandos`, `botao-grande` (≥ 44 px, sem `hover` como único sinal). Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** botões habilitados em `reconectando` → `botoes-desligados-sem-conexao`; ignorar o resultado do `ack` → `ack-sem-resposta-avisa`; não reconsultar ao voltar à aba → `voltar-a-ver-reconecta`; não reavaliar na revogação → `membro-revogado-reavalia`; tratar `fechado` como `reconectando` → `canal-fechado-reavalia`; reavaliar já no primeiro `sem_resposta` → `dois-sem-resposta-reavalia`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-041 (D5 nos membros, D9, D15; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 8: aba Ao vivo (1) — dispositivos, pareamento com QR e revogação; aviso de revogação de membro

**Arquivos:**
- Criar: `src/shared/infra/qr.ts` (+ teste), `src/shared/ui/CodigoQr.tsx`, `src/app/telas/AbaAoVivo.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-042-e3-aba-ao-vivo-dispositivos.md`
- Modificar: `package.json`, `package-lock.json` (`lean-qr`, D11), `src/app/telas/Painel.tsx` (+ teste: aba Ao vivo real; canal `estudio` aberto uma vez no painel pelo `useEstudio` da Tarefa 7 e passado às abas; com `fechado`, `reavaliar()` e reabertura em 5 s, como o `useAoVivo`, teste `painel-reabre-estudio`), `src/app/telas/AbaMembros.tsx` (+ teste: `avisarRevogacao`), `src/shared/styles/base.css`, READMEs de `src/shared/infra/`, `src/shared/ui/`, `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`. A aba Membros parte do estado do VER-033 (foco no mesmo commit do aviso).

**Interfaces:**

```ts
// src/shared/infra/qr.ts
export function matrizDoQr(texto: string): boolean[][] // lean-qr generate(texto, { minCorrectionLevel: correction.M }); texto > 300 caracteres → lança
// src/shared/ui/CodigoQr.tsx
export function CodigoQr(props: { matriz: boolean[][]; rotulo: string }): ReactNode // <svg role="img" aria-label viewBox com margem de 4 módulos> com um <path> montado pelo React
// src/app/telas/AbaMembros.tsx
// props ganham avisarRevogacao?: (usuario: string) => Promise<RespostaDoEnvio>
```

- [ ] **Passo 1: dependência**, pelo procedimento da decisão (c): `npx -y npm@11 install lean-qr@2.7.4 --save-exact --ignore-scripts --before=<data de 2+ semanas antes>`; conferir o diff do `package-lock.json` (só `lean-qr`, sem dependências; os campos `libc` continuam) e `npm run check-deps-audit` (0 erros); anotar no VER-042 o tamanho, a licença e a data de publicação.
- [ ] **Passo 2: testes (falham).**

| Teste | Esperado |
|---|---|
| `qr-matriz` (`qr.test.ts`) | link de 80 caracteres → matriz quadrada de 25 a 177 módulos, com os três padrões de posição (7×7) nos cantos; texto de 301 → lança |
| `codigo-qr-svg` | `<svg role="img" aria-label="QR para parear a câmera">`; nenhum `innerHTML` (o componente não aceita string) |
| `lista-dispositivos` | tipo, rótulo e situação (presença `conectado`; `revogado`; `nunca_pareado`), rótulo com HTML literal |
| `parear-camera-reusa` | com câmera cadastrada → `criarCodigo({ tipo: 'camera', dispositivoId: <id> })`; QR com `https://<origem>/camera#<código>` |
| `parear-camera-nova` | sem câmera → `criarCodigo({ tipo: 'camera', rotulo: 'Celular de gravação', dispositivoId: null })` |
| `link-do-palco` | `criarCodigo({ tipo: 'obs_palco', ... })`; campo só leitura com `https://<origem>/obs/palco#<código>`; "Copiar link" chama `clipboard.writeText` (falso); sem `clipboard`, o campo fica selecionável |
| `obs-camera-exige-camera` | sem câmera, o botão do link da câmera do OBS fica desabilitado com o texto "Pareie a câmera antes." |
| `contagem-regressiva` | relógio falso: "Vale por 2:00"; em `expiraEm` → "O código expirou." + "Gerar outro"; o QR some |
| `detecta-pareamento-e-avisa-sessao-antiga` | consulta a lista a cada 3 s enquanto o código vale; quando `usuarioAnonimoId` muda do antigo → `estudio.enviar({ evento: 'revogacao', usuario: <antigo> })` 1 vez, "📷 Câmera conectada" e o QR some |
| `revogar-avisa` | confirmação → `revogar(id)` → `enviar({ evento: 'revogacao', usuario })` e `enviar({ evento: 'dispositivo_mudou', dispositivoId })` |
| `revogar-sem-canal-avisa` | canal fora → "Revogado no banco. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos." |
| `codigo-some-ao-sair-da-aba` | trocar de aba e voltar → nenhum código nem QR na tela |
| `membros-remove-avisa` (`AbaMembros.test.tsx`) | remover e-mail ligado a perfil → `avisarRevogacao(<id do perfil>)`; trocar o papel (inclusive de `equipe` para `apresentadora`) → **não** chama (os três papéis comandam pelo `/controle`, D5/I4); e-mail sem perfil → não chama; falha do aviso não desfaz a remoção e mostra a frase de "corte em até 10 minutos" |
| `ao-vivo-no-painel` (`Painel.test.tsx`) | a aba "Ao vivo" mostra "Dispositivos", sem "Em construção" |

- [ ] **Passo 3:** implementar; estilos `dispositivos`, `qr`, `link-de-pareamento`, sem estourar 320 px (o QR com `max-width: 100%`). Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** criar câmera nova mesmo com uma cadastrada → `parear-camera-reusa`; manter o código no estado depois de desmontar (guardar num módulo) → `codigo-some-ao-sair-da-aba`; não avisar a sessão antiga → `detecta-pareamento-e-avisa-sessao-antiga`; não avisar na revogação → `revogar-avisa`; avisar mesmo sem perfil ou na troca de papel → `membros-remove-avisa`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-042 (D3 no painel, D5 com I4, D11 com a justificativa da dependência; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 9: aba Ao vivo (2) — modo teste, iniciar e encerrar, checklist e comandos

**Arquivos:**
- Criar: registro `docs/verificacoes/AAAA-MM-DD-043-e3-aba-ao-vivo-episodio.md`
- Modificar: `src/app/telas/AbaAoVivo.tsx` (+ teste), `src/app/telas/AbaEpisodios.tsx` (+ teste: nota da D12, sem tirar linhas além da frase), `src/app/App.test.tsx` (frase de `/painel`), `src/shared/styles/base.css`, READMEs de `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

  Seções novas da aba, nesta ordem: **Episódio** (estado atual; seletor do modo teste só com rascunhos, "Sair do modo teste"; "Iniciar o ao vivo" com confirmação que cita o título; "Encerrar o ao vivo" com confirmação; depois de cada ação, `estudio.enviar({ evento: 'episodio_ativo_mudou' })`), **Checklist** (D13), **Comandos** (`PainelDeComandos` com o `useAoVivo` da Tarefa 7, só com episódio ativo). Mensagens: `duplicado` "Já existe um episódio ao vivo."; `estado_invalido` "O episódio mudou de estado; a lista foi recarregada." (+ recarga); `negado` → `reavaliar()`; demais como nas outras abas.

- [ ] **Passo 1: testes (falham).** `modo-teste-so-rascunho`; `define-modo-teste-e-avisa` (`definirModoTeste(id)` e depois o aviso); `sair-do-modo-teste` (`definirModoTeste(null)`); `iniciar-confirma` (sem confirmar, nada; confirmado → `iniciar(id)` e o aviso); `iniciar-com-outro-ao-vivo`; `encerrar-confirma`; `estado-invalido-recarrega`; `checklist-itens` (palco ausente → "Palco não conectado"; OBS sem navegador → "OBS não detectado"; nível 3 → "Dê acesso Avançado à Fonte do palco"; websocket `senha_errada`; versão 30.1 → "OBS abaixo de 30.2"; Replay Buffer parado; tudo certo → todos marcados); `comandos-no-painel` (com episódio ativo, o `PainelDeComandos` aparece; sem, não); `comando-vai-ao-episodio-novo` (com o `criarFabricaDeCanais` real sobre o realtime falso: modo teste no episódio A, aba Ao vivo aberta; "Iniciar o ao vivo" de B → o `useAoVivo` da mesma aba recebe `episodio_ativo_mudou` pelo eco local, consulta de novo e um toque em CLIPE vai para `episodio:<B>:controle`, nunca para `episodio:<A>:controle`; sabotagem: sem o eco local, o comando vai para A); `painel-e-ao-vivo-no-mesmo-cliente` (o `Painel` com o `criarFabricaDeCanais` **real** sobre o realtime falso que imita o 2.119.0, I3: o canal `estudio` do painel e o do `useAoVivo` da aba são o mesmo — 1 `channel('estudio')`, nenhuma exceção de `presence`; sair da aba Ao vivo desmonta o `useAoVivo` e o `estudio` do painel continua `conectado`, recebendo e enviando, sem `removeChannel`; sair do painel fecha tudo, 1 `removeChannel` por tópico); `episodios-nota-aponta-ao-vivo` (`AbaEpisodios`: "Iniciar e encerrar o ao vivo ficam na aba Ao vivo.", sem botão "Iniciar").
- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar; estilos `checklist`, `episodio-no-ar`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** listar todos os episódios no modo teste → `modo-teste-so-rascunho`; iniciar sem confirmação → `iniciar-confirma`; não avisar no `estudio` → `define-modo-teste-e-avisa`; tirar o eco local do registro → `comando-vai-ao-episodio-novo`; marcar o nível 3 como suficiente → `checklist-itens`.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-043 (D7 na tela, D12, D13; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 10: conferência no navegador e guia do ao vivo para o responsável

**Arquivos:**
- Modificar: `supabase/README.md` (seção nova "Ao vivo e pareamento (E3)", sem reduzir o tamanho mínimo), `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-044-e3-conferencia-e-guia.md`

- [ ] **Passo 1: conferência no navegador sem Supabase nem OBS reais.** `npm run build` com variáveis de mentira só na linha de comando e `--outDir` fora do repositório; `vite preview`; Chromium do Playwright do ambiente (1.63, fora do repositório) com `exemplo.revocast.test` interceptado como na E2 (PostgREST e `rpc` em memória, Auth com login anônimo falso) e o WebSocket do Realtime simulado por `page.routeWebSocket`: um retransmissor Phoenix mínimo no script (responde `phx_join` com `ok` ou com erro de não autorizado conforme a tabela da D6, retransmite `broadcast` entre as páginas, responde `ack` e `presence`). Páginas: painel (`equipe`), `/controle` em 320 px (claro e escuro), `/obs/palco` com um `window.obsstudio` falso injetado por `addInitScript` e `/camera`. Conferir, com asserções OK/ERR (como no VER-031): gerar o link do palco e abri-lo (pareia; o fragmento some da barra; nada no `localStorage` além da sessão); abrir o mesmo link de novo (inválido); abrir em `/camera` um link de palco (tipo errado); modo teste → o palco segue; tocar cena, som, aviso (com HTML literal), próximo aviso, ocultar, clipe (5 s) e marcador (sem websocket → motivo); iniciar e encerrar; derrubar o WebSocket (botões desabilitados, "Reconectando…", volta e republica); revogar o palco (o palco mostra "revogado"); QR visível e legível na captura; em 320 px, nada estoura. Rodar também com 4 sabotagens do script (por exemplo, retransmissor que aceita `broadcast` de dispositivo em `estudio`) para provar que as asserções pegam falhas. Scripts e capturas fora do repositório; resultado no registro.
- [ ] **Passo 2:** em `supabase/README.md`, seção "Ao vivo e pareamento (E3)" com o passo do responsável abaixo (sem e-mail e sem domínio real), a explicação da D2, D6 e D7 e as consultas de conferência.
- [ ] **Passo 3:** oferecer ao responsável, no relato da tarefa, as decisões D1–D16 e os ajustes do DES-001 que elas sugerem (§8: código de 244 bits e limite de tentativas; §8 e §7: `estado` e modo teste só por função, `estudio_estado` só leitura; §9: iniciar/encerrar na aba Ao vivo; §7: o toque "mostrar aviso" gravado como `proximo_aviso`; §8: `definir_gestos_ligados` e `definir_reconhecimento` na E5/E4; §8: a assinatura `parear_dispositivo(p_codigo, p_tipo)`, com o tipo da rota, no lugar de `parear_dispositivo(código)`, e o resultado em linha em vez de exceção; §8: a função nova `meu_dispositivo()`; §8: só a remoção da lista revoga membro; §9 e §10.4: o palco não mostra selo nem configuração com a saída no ar), com as pendências anteriores (D7 do PLA-002 e Passo 3 da Tarefa 8 do PLA-003); o que ele decidir vira item próprio.
- [ ] **Passo 4:** `npm run check`; registro VER-044 (resultado do Passo 1; estado do passo do responsável); dupla verificação; `npm run check` como último ato; commit; push; relato.
- [ ] **Passo 5: passo do responsável** (fora do código; nenhum agente consegue fazer). Em ordem:
  1. **Pendências anteriores:** se ainda não feitas, as migrações anteriores, o primeiro `admin`, o login Google (guia "Login Google (E1)") e a Biblioteca (guia "Biblioteca no Storage (E2)").
  2. **Banco, no editor SQL:** aplicar `supabase/migrations/<AAAAMMDDHHMMSS>_ao_vivo_e_pareamento.sql` inteiro. Se o editor recusar as políticas de `realtime.messages` com `42501` ou `must be owner`, **não** contornar: anotar a mensagem para o registro seguinte (a Tarefa 2 previu esse caminho).
  3. **Conferência por consulta:** `select policyname, cmd, roles from pg_policies where schemaname = 'realtime' and tablename = 'messages';` → `canal_recebe` (`SELECT`) e `canal_envia` (`INSERT`), ambas `{authenticated}`, e nenhuma outra; `select has_table_privilege('authenticated', 'public.codigos_pareamento', 'select');` → `false`; `select proname from pg_proc where proname in ('criar_codigo_pareamento', 'parear_dispositivo', 'revogar_dispositivo', 'episodio_ativo', 'iniciar_ao_vivo', 'encerrar_ao_vivo', 'definir_modo_teste', 'pode_usar_canal', 'meu_dispositivo');` → 9 linhas.
  4. **Supabase → Authentication:** ligar **"Allow anonymous sign-ins"**; em Rate Limits, manter (ou reduzir) o limite de logins anônimos por hora por IP; continuar com Email desligado, "Confirm email" ligado e vinculação manual de identidades desligada; validade do JWT em 10 min (DES-001 §8).
  5. **Supabase → Realtime → Settings:** desligar **"Allow public access"** (só canais privados).
  6. **OBS (Windows, e se possível macOS e Linux, DES-001 §15):** versão 30.2 ou mais nova; **com transmissão, gravação, Replay Buffer e câmera virtual parados**: Replay Buffer configurado (60 s, sem iniciar), gravação em **Hybrid MP4** (sem iniciar), servidor WebSocket ligado (porta 4455, com senha); na aba Ao vivo, "Link do palco" → Fonte de navegador com a URL colada, **"Page permissions": Advanced access to OBS**, "Control audio via OBS" marcado, "Shutdown source when not visible" desmarcado, a mesma Fonte em todas as cenas **por referência**; **primeiro** no "Interagir" da Fonte: tecla `c`, senha do WebSocket, "Salvar" (o painel recusa abrir com qualquer saída ligada, inclusive o Replay Buffer, D10; o selo da tecla `s` também); **depois** iniciar o Replay Buffer e a gravação (o clipe exige o Replay Buffer ativo e o marcador, a gravação em andamento). Reserva do marcador: atalho de teclado do OBS (DES-001 §15).
  7. **Nada de dado pessoal:** rótulos de dispositivo genéricos ("PC do estúdio"); avisos de teste sem dados de pessoas.
  8. **Conferência real** (anotar o resultado): parear o palco; aba Ao vivo com o checklist todo marcado; modo teste com um rascunho; num celular Android e num **iPhone (Safari)**, abrir `/controle` com contas `apresentadora` e `equipe`; tocar cena, som, aviso, clipe (o arquivo aparece na pasta do Replay Buffer depois de ~5 s) e marcador (capítulo no MP4); bloquear e desbloquear o iPhone e tocar de novo; iniciar e encerrar o ao vivo; revogar o palco e conferir que ele para; parear de novo; remover da lista um membro com o `/controle` aberto e conferir que ele perde o acesso.
  9. **Limpeza opcional** (sessões anônimas sem dispositivo acumulam em `auth.users`): a consulta da seção do guia, rodada à mão de tempos em tempos.

---

## Ao fim da E3

- O primeiro ao vivo por toque funciona: pareamento por QR e link de uso único, `/obs/palco` executando cena, som, aviso, clipe e marcador pedidos no `/controle` ou na aba Ao vivo, modo teste, iniciar e encerrar, revogação de dispositivo e de membro com aviso pelo canal, checklist mínimo.
- `src/domains/aovivo/` e `src/domains/obs/` existem, e o pareamento está em `src/domains/acesso/`; a E4 reaproveita o pareamento da câmera, a presença em `estudio` e o `dispositivo_mudou`, e acrescenta o `:video` (migração nova que reescreve `pode_usar_canal`).
- **Uma migração nova** (`ao_vivo_e_pareamento`: `tentativas_pareamento`, nove funções, privilégios por coluna em `episodios`, `estudio_estado` só leitura, `delete` só de rascunho, duas políticas de `realtime.messages`), **uma dependência nova** (`lean-qr`, D11); a simulação do Supabase tem `realtime`; o `data-api:check` aceita só as duas políticas do canal e nenhuma outra mudança em `realtime.*`.
- Fica para a E4: `/camera` com tela preta e vídeo até `/obs/camera`, o tópico `:video`, `definir_reconhecimento`. Para a E5: gestos, `definir_gestos_ligados` e o interruptor. Para a E6: registro de ações no painel e o checklist completo.
- Pendências conhecidas: o remetente das mensagens é declarado pelo cliente (um membro pode se passar por outro membro ou pelo palco no conteúdo; o descarte de revogados só vale para clientes que cooperam; o corte garantido é a revalidação do Realtime com o JWT de 10 min, DES-001 §8); a URL da Fonte do OBS guarda um código já usado (inútil); sessões anônimas sem dispositivo acumulam em `auth.users` (limpeza manual); a simulação dá ao dono das migrações mais poder em `realtime` do que o real, compensado pela regra dos schemas protegidos; o obs-websocket a partir do navegador embutido pode esbarrar na política de rede local (reserva: atalho do OBS); a versão do OBS só é lida com o websocket; o toque "mostrar aviso" fica gravado como `proximo_aviso` (D9); a função `pode_usar_canal` trocada por `create or replace` que devolva `true` com uma chamada de papel decorativa passaria no `data-api:check` e no `rpc:grants-check` (só `e3-canal-matriz` pega; N5); quando o episódio ativo muda, quem já estava no tópico antigo continua autorizado nele até reconectar ou renovar o token (até 10 min); por isso o cliente sai sozinho e o palco só executa o tópico do episódio que consultou (N6); um `broadcast` sem permissão volta como `sem_resposta`, igual a rede ruim (N3); o palco mostra as telas de pareamento e de erro enquanto não está pareado (só na configuração), e com o nível de controle abaixo de `READ_OBS` não sabe se a saída está no ar (então recusa selo e configuração); uma transmissão por outro caminho que o OBS não reporte em `getStatus` (por exemplo, captura da tela do computador) não fecha o painel de configuração aberto, que se fecha sozinho em 2 min (I5); a migração nova, as configurações do Supabase e do OBS e a conferência real dependem do responsável; os ajustes do DES-001 oferecidos no Passo 3 da Tarefa 10.
