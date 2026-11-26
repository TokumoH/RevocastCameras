# E2 — Preparar um episódio: plano de implementação

> **Para agentes:** execute tarefa por tarefa (superpowers:executing-plans ou superpowers:subagent-driven-development), **sempre sob as regras do `CLAUDE.md`, que prevalecem sobre as dessas skills**, com as decisões vigentes do responsável abaixo: trabalhar direto na `branchTrabalho`, sem worktree e sem criar branch; subagentes implementam e verificam, mas **não** fazem commit, push, merge nem PR e param antes do passo de commit; quem faz o commit local (versão limpa) é o agente principal (`CLAUDE.md`, desde o VER-013), e o push de cada item verificado segue a autorização permanente da decisão (b); `finishing-a-development-branch` não é usada. Os passos usam caixas (`- [ ]`) para acompanhamento.

| Campo | Valor |
|---|---|
| Id | PLA-003 |
| Etapa | E2 do DES-001 |
| Data | 2026-11-26 |
| Usuário responsável | TokumoH |
| Status | em execução, autonomia concedida pelo responsável em 2026-11-26 |

**Objetivo:** a equipe prepara um episódio. No `/painel`, as abas **Biblioteca** (enviar sons e imagens do computador, com prévia, rótulo/emoji/volume dos sons, uso do limite de 1 GB e exclusão segura), **Cenas** (nome de exibição e nome exato no OBS), **Gestos** (mapa global dos 7 gestos, com a sugestão de ligar 👍/👎 aos sons "aplauso"/"buuu") e **Episódios** (criar, editar e excluir rascunhos; avisos com texto, link `https://`, imagem, duração e ordem) deixam de ser provisórias. No banco, uma migração nova cria o bucket privado `midias` (50 MB por arquivo, tipos fechados) e as políticas de `storage.objects`; a simulação do Supabase ganha o schema `storage`, e as checagens de banco passam a aceitar **só** essas políticas, sem afrouxar o resto.

**Arquitetura:** DDD + GRASP Pure Fabrication + Componentes (DES-001, seção 6). Nasce `src/domains/preparacao/` (o contexto **Preparação** do DES-001 §6: `Midia`, `Som`, `Cena`, `Episodio` → `Aviso`, `MapaDeGestos`), com regras puras (tipos aceitos detectados pelos primeiros bytes, limites de 50 MB e de 1 GB, caminho no Storage sem o nome do arquivo, conferência de cena, gesto, episódio e aviso, uso de mídia por gestos e avisos) e as **portas** (um repositório por agregado e a porta `ArmazenamentoDeMidia`). Os adaptadores Supabase ficam em `src/shared/infra/` (`preparacaoSupabase.ts`, `armazenamentoSupabase.ts`, `errosSupabase.ts`), a composição em `src/app/servicos.ts` (o mesmo cliente de membro, criado uma vez por página) e as telas em `src/app/telas/`. Os testes de tela usam falsos das portas; os adaptadores, um cliente Supabase falso e um `XMLHttpRequest` falso; as regras de banco e de Storage, PGlite com a simulação.

**Tecnologias (a E2 não precisa de dependência nova; ver D9):** React 19.3.1, `@supabase/supabase-js` 2.119.0 (`storage-js` 2.119.0), Vitest 5.1.0, jsdom 31.0.1, `@testing-library/react` 16.3.3 (`fireEvent`), `@electric-sql/pglite` 0.5.16, TypeScript 7.0.2. Áudio e imagem com `<audio controls>` e `<img>` nativos; tipo do arquivo pelos primeiros bytes (`Blob.slice(0, 16).arrayBuffer()`); envio com `XMLHttpRequest` nativo (progresso e cancelamento).

**Desenho:** [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md), seções 5–10, 12, 15 e 16. **Planos anteriores:** [PLA-001](2026-11-17-e0-fundacao.md) ("Ao fim da E0": políticas de `storage.objects` na E2) e [PLA-002](2026-11-26-e1-entrada-e-membros.md) ("Ao fim da E1").

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

Revistas uma a uma a partir do PLA-002; as que mudaram dizem desde quando.

- Nenhum serviço com cartão; nenhum custo mensal (DES-001, seção 2). Storage do plano Free: **50 MB por arquivo** e **1 GB no total** (DES-001 §3 e §15).
- Banco normalizado; RLS em todas as tabelas; papéis do app conferidos dentro do banco por `papel_atual()` e `dispositivo_atual()` (DES-001, seção 8). **A interface nunca decide acesso a dado**: ela só escolhe o que mostrar; quem nega é a RLS (no Storage, as políticas de `storage.objects`).
- `papel_atual()` só aceita sessão **não anônima**, provedor `google` e `email_confirmed_at` não nulo; e-mail comparado em minúsculas. `dispositivo_atual()` só vale para sessão **anônima**, dispositivo não revogado e `usuario_anonimo_id = auth.uid()`.
- **Privilégios (desde o VER-010/VER-011):** em `public`, `grant` explícito por tabela só a `authenticated` e só das operações que alguma política permite; nada para `anon` e `service_role`. **A E2 não dá nem tira nenhum `grant`**: os de `midias`, `sons`, `cenas`, `episodios`, `avisos` e `mapa_gestos` já existem (migração de fundação), e os de `storage.objects` são os do Supabase (Tarefa 2), que a migração não altera (o `data-api:check` continua acusando qualquer mudança de privilégio em relação pré-existente).
- **Funções (desde o VER-011):** `SECURITY DEFINER`, `set search_path = ''`, `EXECUTE` só para `authenticated`, corpo que chama `papel_atual()` ou `dispositivo_atual()`; exceções em [`scripts/README.md`](../../scripts/README.md). **A E2 não cria função.**
- `codigos_pareamento`: RLS ativa, **nenhuma** política, `revoke all`.
- **Migrações:** migração já aplicada no Supabase **nunca é editada**, nem de passagem numa sabotagem (sabotagens são em memória, pelo laço de `banco.ts`, como na Tarefa 2 do PLA-002); mudança de banco = migração nova em `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql` (data e hora do commit da tarefa), testada em PGlite, com `rpc:grants-check` e `data-api:check` passando, e acrescentada ao passo do responsável (editor SQL, depois das anteriores). **A E2 tem uma migração nova**, `<AAAAMMDDHHMMSS>_biblioteca_storage.sql` (Tarefa 3, decisões D3–D5).
- **Storage (novo nesta etapa):** um bucket só, `midias`, **privado** (`public = false`: nenhuma URL pública; leitura só por URL assinada ou com a sessão), `file_size_limit = 52428800` e `allowed_mime_types` fechado (D4; **sem `image/svg+xml`**, que carrega script). Caminho do objeto `som/<uuid>.<ext>` ou `imagem/<uuid>.<ext>`, gerado pelo app; **o nome do arquivo do computador nunca entra no caminho** (só na coluna `midias.nome`, mostrada como texto). Sem sobrescrita (D5).
- **Tempo-limite:** o `fetch` com 15 s continua só em `/rest/v1/` e `/auth/v1/` (VER-021); o envio ao Storage tem **acompanhamento próprio** (progresso, cancelamento pela pessoa e corte por **inatividade** de 30 s sem progresso; Tarefa 4, D8). As demais chamadas ao Storage (`createSignedUrl`, `remove`) passam pelo `fetch` do cliente sem limite; uma prévia que não carrega só deixa a prévia vazia (risco aceito, registrado).
- Rotas por **caminho** e cliente de membro como na E1 (`flowType: 'pkce'`, `storageKey` `revocast-auth-membro`, criado só nas rotas de membro, de forma preguiçosa, uma vez por página). Os serviços da Preparação **reaproveitam o mesmo cliente**; as rotas de dispositivo continuam sem criar cliente nenhum (teste `dispositivo-nao-cria-cliente-de-membro` e `caminho-padrao-nao-cria-cliente-em-dispositivo` continuam passando).
- Variáveis públicas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; nenhuma nova.
- **Dependência npm nova (decisão (c)):** só quando a etapa precisar dela de verdade; **a E2 não precisa de nenhuma** (D9). Se uma tarefa precisar, a instalação é feita com o npm 11 via `npx -y npm@11` (versão 11.21.2), nunca com o npm 10.9.9 local: (1) versão exata, com `--save-exact --ignore-scripts --before=<data com pelo menos 2 semanas antes>`; (2) conferir o diff do `package-lock.json` (só o pacote e as dependências dele mudam; os campos `libc` continuam lá); (3) `check-deps-audit` com 0 erros; (4) justificar no registro do item. `npm ci` e `npm install` direto com o npm 10 continuam proibidos. O Playwright do ambiente serve só para a conferência manual (Tarefa 8) e não vira dependência.
- **Testes sem projeto Supabase real:** interface (jsdom) com falsos das portas (sem `vi.mock` do supabase-js nos testes de tela); adaptadores com um cliente Supabase falso e um `XMLHttpRequest` falso injetado; regras de banco e de Storage em PGlite com a simulação (ampliada com `storage` na Tarefa 2). Os falsos imitam o que muda o comportamento da tela (por exemplo, o envio falso emite progresso antes de resolver e respeita o `AbortSignal`).
- Todo arquivo de teste importa `describe`, `test`, `expect` (e o que mais usar) de `vitest`, sem `globals`; testes de tela com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)`.
- **Segurança de interface:** nada de `innerHTML` nem `dangerouslySetInnerHTML`; texto vindo de fora (nome de arquivo, rótulo, título e texto de aviso, nome de cena) é sempre texto React; link de aviso só vira `<a>` depois de validado como `https:` (com `rel="noopener noreferrer"` e `target="_blank"`); nunca mostrar mensagem ou pilha de erro inesperado nem a mensagem do servidor (só mensagens fixas por motivo); nunca registrar token, sessão, e-mail ou URL assinada em `console`.
- O ouvinte de `onAuthStateChange` nunca chama o Supabase dentro do callback (E1). O adaptador de armazenamento lê o token com `auth.getSession()` **na hora de cada envio**, fora de qualquer callback.
- Redirect URLs do Supabase sem curinga de host (E1, restrição mantida).
- Visual: tokens do RevoCast (cores `#1b1b22`, `#fffaf4`, `#d83868`, `#27bfe8`, `#d8b888`; Lilita One, Nunito, Caveat; borda 3 px; sombra dura), claro e escuro; estilos novos em `src/shared/styles/base.css`, só com as variáveis de `tokens.css`; nada estoura o cartão em 320 px (tabelas com invólucro de rolagem horizontal, como na aba Membros).
- `erasableSyntaxOnly` ligado: sem propriedades de parâmetro no construtor, sem `enum`, sem `namespace`; `import type` para tipos (`verbatimModuleSyntax`).
- **Dupla verificação do `CLAUDE.md` em toda tarefa**, antes do commit, com a decisão (a): rodadas de revisão independente sobre a mudança da tarefa (por outra abordagem que não o `npm run check`) até duas seguidas sem erro; sugestões importantes dos revisores entram; o resultado de cada rodada vai para a seção "Verificação" do registro. **Toda sabotagem citada como prova é executada e o teste que ela derruba é anotado no registro**; sabotagem que não derruba nada é achado.
- Processo do repositório: todo diretório novo com `README.md` de 11 seções no mesmo commit; README atualizado no commit que mexe nos arquivos da pasta ("Onde" e campo "Arquivos"); todo commit com registro em `docs/verificacoes/`; `npm run check` com 0 erros sobre exatamente o conteúdo do commit; commit pelo agente principal e push pela decisão (b); branch `branchTrabalho`.
- Nenhum e-mail real ou segredo em arquivo versionado; e-mails de teste no domínio reservado `revocast.test`; nenhum nome de pessoa real nos testes; arquivos de teste gerados em memória (bytes mágicos + enchimento), nenhum arquivo binário versionado.
- **Âncoras de registros antigos:** nenhum arquivo citado por elas pode ficar menor do que a âncora aponta (o `check-docs` confere). Mínimos dos arquivos que a E2 pode tocar: `CLAUDE.md` 133, `docs/verificacoes/README.md` 93, `docs/planos/README.md` 68, `docs/desenho/README.md` 68, o DES-001 394, o PLA-001 315, o PLA-002 713, `scripts/README.md` 97, `scripts/_catalogo.mjs` 663, `scripts/check-data-api.mjs` 181, `scripts/check-rpc-grants.mjs` 82, `scripts/check-docs.mjs` 78, `scripts/check-doc-secrets.mjs` 33, `scripts/tests/README.md` 63, `scripts/tests/catalogo.test.mjs` 170, `package.json` 36, `src/README.md` 14, `src/domains/README.md` 79, `src/domains/arquitetura.test.ts` 63, `src/app/App.tsx` 34, `src/app/App.test.tsx` 90, `src/app/dependencias.ts` 61, `src/app/dependencias.test.ts` 61, `src/app/servicos.ts` 35, `src/app/servicos.test.ts` 80, `src/app/servicosFalsos.ts` 181, `src/app/acesso.test.tsx` 381, `src/app/GuardaDeMembro.tsx` 38, `src/app/telas/Painel.tsx` 75, `src/app/telas/Painel.test.tsx` 126, `src/app/telas/AbaMembros.tsx` 340, `src/app/telas/AbaMembros.test.tsx` 403, `src/shared/README.md` 14, `src/shared/infra/README.md` 95, `src/shared/infra/acessoSupabase.ts` 175, `src/shared/infra/acessoSupabase.test.ts` 351, `src/shared/infra/supabase.ts` 40, `src/shared/infra/supabase.test.ts` 108, `src/shared/infra/tempoLimite.ts` 81, `src/shared/infra/tempoLimite.test.ts` 237, `src/shared/ui/Abas.tsx` 88, `src/shared/ui/Mensagem.tsx` 10, `src/shared/styles/base.css` 173, `src/shared/styles/tokens.css` 40, `supabase/README.md` 134, `supabase/migrations/README.md` 93, `supabase/tests/README.md` 113, `supabase/tests/banco.ts` 86, `supabase/tests/rls.test.ts` 1021, `supabase/tests/matriz.test.ts` 122, `supabase/tests/restricoes.test.ts` 301, `supabase/tests/simulacao-supabase.sql` 28, `supabase/tests/dono-migracao.sql` 41, as duas migrações existentes (409 e 22; nunca editadas); e este plano, a partir do commit que o introduz, o tamanho com que entrar.
- Datas nos nomes dos registros e da migração: a data do commit (se a execução cair em outro dia, o nome acompanha).

## Decisões sobre lacunas e divergências do desenho (propostas pelo agente sob a decisão (b); cada uma é registrada no VER da tarefa dona)

**D1. Um domínio só, `preparacao`.** O DES-001 §6 tem um contexto **Preparação** (mídia, cenas, sons, episódios e avisos, gestos) e a pasta `src/domains/preparacao/` (§6.1). Seguir o desenho, em vez de criar `biblioteca/` e `episodios/` separados: os agregados se referenciam (gesto → cena/som; aviso → mídia; som → mídia) e as regras de "mídia em uso" atravessam todos. Os arquivos ficam separados por agregado dentro da pasta.

**D2. Iniciar e encerrar o ao vivo ficam para a E3.** O DES-001 §9 põe "iniciar/encerrar o ao vivo" na aba Episódios, mas iniciar exige limpar `estudio_estado.episodio_teste_id` (§7) e avisar no canal `estudio` (§6.1, §8), que só existem na E3, junto com o modo teste e o `/obs/palco`. Na E2 a aba **mostra** o estado (rascunho, ao vivo, encerrado) e **nunca escreve** `estado` nem `gestos_ligados`: o adaptador manda só `titulo` e `data` no `update` (teste `episodio-so-titulo-e-data`). Excluir episódio só em `rascunho` (a exclusão apaga em cascata os avisos e o `registro_acoes`, que é histórico; o banco ainda deixa `equipe` apagar qualquer um, limite registrado). O "no máximo um `ao_vivo`" continua garantido pelo índice `episodios_um_ao_vivo` (teste `dois-ao-vivo` da E0) e o adaptador traduz a violação para uma mensagem fixa.

**D3. Políticas de `storage.objects` (DES-001 §8):**

| Operação | Quem | Condição |
|---|---|---|
| `select` | `equipe`/`admin` e o dispositivo `obs_palco` | `bucket_id = 'midias'` |
| `insert` | `equipe`/`admin` | `bucket_id = 'midias'` e `name` no formato `^(som/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3\|wav\|ogg\|m4a)\|imagem/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png\|jpg\|webp\|gif))$` (a mesma expressão da migração, Tarefa 3: uuid em minúsculas, forma 8-4-4-4-12) |
| `delete` | `equipe`/`admin` | `bucket_id = 'midias'` |
| `update` | ninguém | sem política (D5) |

Todas `to authenticated`; `anon` não ganha nada. A `apresentadora` lê a tabela `midias` (DES-001 §8 "Membros") mas **não** o bucket (§8: só `equipe`/`admin` leem e escrevem o bucket; o `obs_palco` lê). A forma do nome barra caminho com `..`, subpasta, barra invertida, extensão trocada entre som e imagem e qualquer pasta fora das duas.

**D4. Tipos aceitos, conferidos em três lugares.** Som: MP3 (`audio/mpeg`), WAV (`audio/wav`), OGG (`audio/ogg`), M4A (`audio/mp4`); imagem: PNG, JPEG (`image/jpeg`, extensão `jpg`), WebP, GIF. (1) O domínio detecta o tipo pelos **primeiros bytes** (o nome e o `File.type` do navegador são ignorados para decidir) e recusa o resto; (2) o bucket tem `allowed_mime_types` com esses 8 tipos e `file_size_limit` de 50 MB, que o servidor do Storage aplica ao `Content-Type` e ao tamanho do envio; (3) a política de `insert` confere a pasta e a extensão. SVG, HTML, PDF e vídeo ficam fora. Limite que sobra: o servidor confia no `Content-Type` declarado; um membro da equipe com acesso à API pode guardar bytes de outro tipo sob um tipo aceito. O dano fica contido: bucket privado, o app só usa os arquivos em `<audio>` e `<img>` (nunca como documento), e quem envia já é da equipe (registrado em Riscos).

**D5. Sem sobrescrita.** O DES-001 §8 cita leitura do bucket "para sobrescrever arquivos". Cada envio gera um `uuid` novo, então nada é sobrescrito: trocar um som é enviar outro e excluir o antigo. Assim não há política de `update` (o upsert do Storage exige `select`, `insert` e `update`), e um envio nunca troca o arquivo que outra tela está tocando.

**D6. Ordem do envio e da exclusão (sem transação entre Storage e banco).** Envio: conferir no domínio → enviar o objeto → registrar a linha em `midias` (e, para som, em `sons`); se o registro falhar, o objeto é removido (compensação; se a remoção também falhar, sobra um objeto órfão, registrado em Riscos). Se o envio terminar em `cancelado`, `sem_resposta` ou `rede`, o objeto pode ter sido gravado antes do fim (por exemplo, cancelado enquanto o servidor respondia): `enviarMidia` tenta removê-lo de boa-fé (remover um caminho que não existe não dá erro) e nunca lança por causa dessa remoção; o que ela não alcançar fica órfão, registrado em Riscos. Exclusão: apagar a linha de `midias` **primeiro** (o banco recusa se um som estiver num gesto: `mapa_gestos.som_id` não tem ação de delete, erro `23503` → `em_uso`) e só depois o objeto; se a remoção do objeto falhar, a tela avisa "o arquivo ficou no armazenamento" (órfão, contado em Riscos). A ordem inversa deixaria linha apontando para arquivo apagado.

**D7. Uso do limite pela soma de `midias.tamanho_bytes`.** O uso mostrado na Biblioteca é a soma das linhas de `midias` (que todo membro lê), comparada com `LIMITE_TOTAL_BYTES = 1_000_000_000` (o DES-001 diz "1 GB"; usar 10⁹, o menor dos dois sentidos, deixa folga se o Supabase contar em GiB). Aviso a partir de 80 %; envio que passaria do limite é recusado no domínio. Objetos órfãos (D6) não entram na soma (limite registrado).

**D8. Envio com `XMLHttpRequest`, não com `storage.from().upload()`.** No `storage-js` 2.119.0, `upload()` não aceita `AbortSignal` nem informa progresso (conferido em `node_modules/@supabase/storage-js/dist/index.d.mts`: `FileOptions` sem `signal`; só `download`, `list` e afins recebem `FetchParameters`). Um envio de 50 MB numa rede ruim precisa de barra de progresso, de "Cancelar" e de um corte quando trava (VER-021, Riscos). O adaptador manda o arquivo como **corpo bruto**, a forma que o `uploadOrUpdate` do `storage-js` usa para corpos que não são `Blob` nem `FormData` (`dist/index.mjs`, linhas 626–634; para `Blob` o SDK monta um `FormData`, linha 626, que o servidor também aceita): `POST <origem>/storage/v1/object/midias/<caminho>` com `authorization: Bearer <access_token>`, `apikey`, `x-upsert: false`, `cache-control: max-age=3600` e `content-type: <tipo detectado>`; corpo = o `Blob`. O erro é lido como o SDK lê (`dist/index.mjs`, linhas 326–330): primeiro o `statusCode` do **corpo** JSON (o Storage costuma responder 400 com `statusCode` "403", "409" ou "413" no corpo), depois o status HTTP; a mensagem do servidor nunca é repassada. Corte por **inatividade**: 30 s sem evento de progresso durante o envio dos bytes (não por tempo total, que cortaria um envio grande e saudável); o corte para em `upload.onload` (bytes todos enviados), e daí em diante a espera pela resposta só termina com a resposta, um erro de rede ou o "Cancelar" da pessoa.

| Alternativa | Motivo de descarte |
|---|---|
| `storage.from('midias').upload()` | Sem `AbortSignal` e sem progresso no 2.119.0; um envio travado não pode ser cancelado nem cortado |
| Envio retomável (TUS, `/storage/v1/upload/resumable`), que o Supabase recomenda acima de 6 MB | Exige o cliente `tus-js-client` (dependência nova) ou reimplementar o protocolo; o limite do app é 50 MB por arquivo e um envio que falha é refeito do início, com progresso e cancelamento; pode ser reavaliado se envios grandes falharem com frequência no uso real |
| `fetch` com `AbortSignal` | Cancela, mas não informa progresso do envio (o `fetch` não tem evento de progresso de upload nos navegadores atuais) |

**D9. Nenhuma dependência nova.** Áudio e imagem nativos; detecção de tipo por bytes mágicos (tabela fixa no domínio); envio por `XMLHttpRequest`; uuid por `crypto.randomUUID()` (navegadores atuais e Node 19+); sem biblioteca de arrastar e soltar (o campo `<input type="file">` com uma área que aceita `drop` nativo).

**D10. Repositórios por agregado, sem classe genérica; erros do Supabase num lugar só.** A D6 do PLA-002 deixou `RepositorioSupabase<T>` para quando houvesse repetição real. A E2 tem cinco repositórios com a mesma forma (listar, incluir, alterar com retorno, remover com retorno), mas campos e conversões diferentes por tabela; uma classe genérica esconderia os nomes de coluna e o `select` de cada um. Reuso escolhido: (1) `src/shared/infra/errosSupabase.ts` com `classificarErro(erro, status)` (a mesma ordem do `traduzirErro` da E1, mais `23503` → `em_uso`), usado por `acessoSupabase.ts` **sem mudar o comportamento da E1** (em `traduzirErro`, `em_uso` e o `invalido` vindo de `22P02` viram `outro`, como hoje; teste `e1-traduzir-erro-sem-mudanca`) e pelos adaptadores novos, onde `22P02` (texto inválido para o tipo, por exemplo uuid malformado) vira `invalido`; (2) um auxiliar `exigirLinhas(resposta)` para "0 linhas → `nada_alterado`".

**D11. Mídia em uso.** Antes de excluir, a tela mostra onde a mídia é usada: gestos (pelo som) e número de avisos com a imagem (em qualquer episódio). Som num gesto → exclusão bloqueada no domínio (e no banco, `23503`). Imagem em avisos → pede confirmação dizendo quantos avisos perdem a imagem (o banco põe `imagem_midia_id` em nulo, `on delete set null`). Cena num gesto → mesma regra do som.

**D12. Mapa de gestos.** As 7 linhas existem desde a E0; a aba só faz `update`. A ação `cena` exige uma cena e `som` exige um som (o `CHECK mapa_gestos_equivalencia` também recusa; o domínio recusa antes, com mensagem, e zera o alvo que não corresponde à ação). Sem sons, a opção "Som" aparece desabilitada com o texto "Envie um som na Biblioteca". Sugestão do DES-001 §7: se `Thumb_Up` (ou `Thumb_Down`) está em `nenhuma` e existe um som com rótulo "aplauso" (ou "buuu"), comparado sem caixa e sem acento, a aba mostra o botão "Ligar 👍 ao som aplauso".

**D13. Simulação do Storage e checagens.** A simulação ganha o schema `storage` com `buckets`, `objects` (só as colunas usadas, com `path_tokens` gerada como no Supabase) e `storage.foldername()`, com o dono, a RLS e os privilégios do Supabase, cada um com fonte no comentário (Tarefa 2). No Supabase real, o `postgres` cria política em `storage.objects` sem ser dono, pela extensão `supautils` (`supautils.policy_grants`), e insere em `storage.buckets` por ter `BYPASSRLS`; ele **não** é membro de `supabase_storage_admin` e, desde 2025, recebe `42501` em `alter table storage.objects` (a Tarefa 2 confirma tudo isso com fonte). O PGlite não tem `supautils`, e o `postgres_sim` não ganha `BYPASSRLS` (decisão da E0, que vale para as tabelas de `public`). Por isso a simulação usa o **mínimo que dá o mesmo efeito**: a participação do `postgres_sim` em `supabase_storage_admin`. **Essa simulação dá ao dono das migrações mais poder em `storage` do que o real** (ele consegue desligar a RLS, criar coluna, índice ou gatilho em `storage.objects`, o que no Supabase daria `42501`); para compensar, o `data-api:check` ganha duas regras:

- **Regra de `storage.*`:** em qualquer relação do schema `storage`, toda mudança no catálogo é erro, exceto `create policy`, `alter policy` e `drop policy` em `storage.objects`. Entram: RLS desligada (`relrowsecurity`) ou mudança em `relforcerowsecurity`; coluna nova, removida ou alterada (nome, tipo, nulidade) e padrão novo ou trocado (`pg_attrdef`, inclusive numa coluna que já tinha padrão); índice; gatilho (inclusive `tgenabled`, ligado ou desligado); restrição; `comment` (`pg_description`); `replica identity` (`relreplident`); estatística estendida (`pg_statistic_ext`); tabela que herda de uma relação de `storage` (`pg_inherits`, com a relação de `storage` como pai); chave estrangeira de outra tabela que aponte para uma relação de `storage` (`pg_constraint.confrelid`); `grant`/`revoke` (ACL), dono, opções e nome; e relação nova no schema (esta já é acusada como "fora do schema public"). **Para as relações de `storage`, esta regra substitui o erro genérico "relação pré-existente: alteração"** (uma mudança dá um erro só, e a mensagem nomeia o item: "RLS", "coluna", "padrão", "índice", "gatilho", "restrição", "comentário", "replica identity", "estatística", "herança", "chave estrangeira", "privilégio", "dono", "opções" ou "nome"); os testes conferem a mensagem exata, de modo que tirar um item da impressão derruba o teste dele. O que não couber na impressão por limitação do PGlite fica registrado como limite no VER-025 e no `scripts/README.md`.
- **Regra das políticas de `storage.objects`:** aceita só se (1) for `to authenticated`; (2) o comando for `select`, `insert` ou `delete` (`update` e `all` são erro, coerente com a D5); (3) cada expressão existente (`using` e `with check`) começar, no texto de `pg_get_expr`, por `((bucket_id = '<bucket>'::text) AND `, com `<bucket>` em `BUCKETS_DO_APP` (o bucket como **conjunção de topo**: um `bucket_id = 'midias' or ...` abriria todos os buckets, porque as políticas permissivas se somam por OR); (4) chamar `papel_atual()` ou `dispositivo_atual()` (com o schema `public.`), conferido com o **mesmo método do `rpc:grants-check`**: a expressão regular de `chamaFuncaoDePapel` aplicada a `codigoDoCorpo(<texto do pg_get_expr>)`, que apaga o conteúdo de textos entre aspas e comentários antes de procurar (exportar `codigoDoCorpo` e a expressão de `scripts/check-rpc-grants.mjs` e reaproveitá-los, sem copiar); assim `bucket_id = 'midias' and name <> 'public.papel_atual()'`, que abriria o bucket a qualquer sessão `authenticated`, inclusive anônima, é acusado. Limite que sobra (o mesmo das funções): a checagem vê a **presença** da chamada, não o **uso**; `B and ((select public.papel_atual()) is null or true)` passa no check e só os testes de banco pegam. Política em qualquer outra relação pré-existente (inclusive `storage.buckets` e `auth.users`) continua erro.
- **Regra do bucket (dados, não catálogo):** depois das migrações, toda linha de `storage.buckets` tem de estar em `BUCKETS_DO_APP`, com `public = false`, `file_size_limit` não nulo e no máximo 52428800, e `allowed_mime_types` não nulo e contido em `TIPOS_DO_BUCKET` (os 8 da D4). Sem linha nenhuma (antes da Tarefa 3), a regra não acusa nada.

A lista de buckets do app (`BUCKETS_DO_APP = ['midias']`) e `TIPOS_DO_BUCKET` ficam no script, ao lado de `SOMENTE_FUNCOES`. Limites que sobram: o check não vê os dados de `storage.objects` nem colunas de `storage.buckets` fora das quatro conferidas (o teste `e2-bucket-privado-com-limites` cobre o bucket do app nos testes de banco); e, no Supabase, `anon`, `authenticated`, `service_role` e `postgres` têm **ALL** nas tabelas de `storage` (`alter default privileges in schema storage grant all on tables ...` em `migrations/tenant/0002-storage-schema.sql` do `supabase/storage`, a conferir no Passo 1 da Tarefa 2): **só a RLS protege `storage.objects` e `storage.buckets`**, e a simulação reproduz isso (por isso um `grant` a `authenticated` em `storage` não muda nada e não é o que a regra procura).

## Foco da revisão

Situações perigosas da E2 que nenhum teste "natural" cobriria; cada uma tem teste na tarefa dona:

1. **Arquivo grande ou com tipo falso** → recusa no domínio por tamanho (`> 52428800`) e pelos primeiros bytes (um `.mp3` que é PNG vira imagem; um HTML com nome `.png` é recusado; SVG recusado) (Tarefa 1, `limite-50mb`, `tipo-pelos-bytes`, `svg-e-html-recusados`, `mp3-que-e-png`); o bucket tem o limite e os tipos fechados (Tarefa 3, `e2-bucket-privado-com-limites`); a tela não chama o envio (Tarefa 5, `envio-recusado-localmente`).
2. **Nome de arquivo com caminho** (`../../x.mp3`, `C:\pasta\x.png`, nome com `/`) → o caminho no Storage é sempre `som|imagem/<uuid>.<ext>`; o nome vira só texto de exibição, sem pastas (Tarefa 1, `caminho-sem-nome-do-arquivo`, `nome-de-exibicao`); a política recusa qualquer outro nome (Tarefa 3, `e2-nome-fora-do-formato`).
3. **Envio por quem não pode** → `apresentadora`, conta fora da lista, sessão anônima, dispositivos e `anon` não inserem em `storage.objects` (Tarefa 3, `e2-storage-quem-envia`); a aba Biblioteca não aparece para quem não abre o painel (E1).
4. **Leitura por anônimo** → `anon`, sessão anônima sem dispositivo, `camera`, `obs_camera`, `apresentadora` e conta fora da lista leem 0 objetos; `equipe`, `admin` e `obs_palco` leem (Tarefa 3, `e2-storage-quem-le`); bucket com `public = false` (Tarefa 3, `e2-bucket-privado-com-limites`).
5. **Dois episódios `ao_vivo`** → a E2 nunca escreve `estado` (Tarefa 4, `episodio-so-titulo-e-data`); a violação do índice vira mensagem fixa (Tarefa 4, `traduz-erros-da-preparacao`); o índice já é provado na E0 (`dois-ao-vivo`).
6. **Gesto de som sem som** → o domínio recusa e zera o alvo que não corresponde (Tarefa 1, `gesto-som-sem-som`, `gesto-zera-alvo`); a tela não grava (Tarefa 6, `gesto-som-sem-som-na-tela`); o banco recusa (E0, `gesto-som-sem-som`).
7. **Aviso com HTML** → título e texto mostrados literalmente; link `javascript:` ou `http:` recusado no domínio e nunca vira `<a>` (Tarefa 1, `link-so-https`; Tarefa 7, `aviso-com-html-literal`).
8. **Exclusão de mídia ou cena em uso** → bloqueio no domínio, confirmação para imagem em avisos, `em_uso` do banco traduzido (Tarefa 1, `usos-da-midia`; Tarefa 3, `e2-som-em-gesto-nao-sai`; Tarefa 5, `excluir-som-em-gesto`, `excluir-imagem-em-aviso`; Tarefa 6, `excluir-cena-em-gesto`).
9. **Uso do limite de 1 GB** → soma correta, aviso a 80 %, recusa do envio que passaria do limite (Tarefa 1, `uso-da-biblioteca`, `sem-espaco`; Tarefa 5, `uso-no-painel`).
10. **Envio longo ou travado** → progresso, cancelamento (inclusive durante a leitura da sessão) e corte por 30 s de inatividade, que para quando os bytes terminam de subir; nenhum objeto registrado depois de cancelar, e o objeto que possa ter ficado é removido de boa-fé; o `fetch` de 15 s não alcança o Storage (Tarefa 1, `envio-interrompido-remove`; Tarefa 4, `envio-com-progresso`, `envio-cancelado`, `cancelar-durante-sessao`, `envio-sem-progresso-corta`, `corte-para-no-fim-do-envio`, `storage-fora-do-tempo-limite`; Tarefa 5, `cancelar-envio`).
11. **Registro falhou depois do envio** → o objeto é removido (compensação) e a falha da remoção não esconde o erro original (Tarefa 1, `envio-compensa`).
12. **Token no lugar errado** → o adaptador lê o `access_token` na hora do envio, nunca o registra em `console`, e sem sessão não envia (Tarefa 4, `envio-sem-sessao`).
13. **Política ou simulação afrouxada na checagem** → o `data-api:check` acusa política em `storage.objects` sem o bucket como conjunção de topo (inclusive `bucket_id = 'midias' or (select public.papel_atual()) is null`), sem a função de papel, para `anon`, `for update` ou `for all`; política em `storage.buckets` ou `auth.users`; e qualquer outra mudança em `storage.*`, como desligar a RLS de `storage.objects` numa migração (Tarefa 2, casos novos em `check-data-api.test.mjs`); bucket público ou sem limites (Tarefa 2, `bucket-publico`; Tarefa 3, `e2-bucket-privado-com-limites`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/domains/preparacao/README.md` | Domínio Preparação (DES-001 §6) | 1 |
| `src/domains/preparacao/midia.ts` (+ teste) | `TIPOS_ACEITOS`, `detectarTipo`, `LIMITE_POR_ARQUIVO_BYTES`, `LIMITE_TOTAL_BYTES`, `conferirArquivo`, `caminhoDaMidia`, `nomeDeExibicao`, `usoDaBiblioteca` | 1 |
| `src/domains/preparacao/cenas.ts` (+ teste) | `Cena`, `conferirCena` | 1 |
| `src/domains/preparacao/gestos.ts` (+ teste) | `GESTOS`, `ACOES`, `LinhaDoMapa`, `conferirGesto`, `normalizarGesto`, `sugestoesDeSom` | 1 |
| `src/domains/preparacao/episodios.ts` (+ teste) | `Episodio`, `Aviso`, `conferirEpisodio`, `podeExcluirEpisodio`, `conferirAviso`, `normalizarLink`, `trocarOrdem` | 1 |
| `src/domains/preparacao/usos.ts` (+ teste) | `usosDaMidia`, `usosDaCena` | 1 |
| `src/domains/preparacao/portas.ts` | `ErroDePreparacao`, repositórios por agregado, `ArmazenamentoDeMidia`, `ServicosDePreparacao` | 1 |
| `src/domains/preparacao/biblioteca.ts` (+ teste) | Serviço de domínio: `enviarMidia`, `excluirMidia` | 1 |
| `supabase/tests/simulacao-supabase.sql` | Schema `storage` (buckets, objects, `foldername`), com fontes | 2 |
| `supabase/tests/dono-migracao.sql` | O que o dono das migrações pode em `storage` (com fonte) | 2 |
| `scripts/_catalogo.mjs`, `scripts/check-data-api.mjs` (+ testes em `scripts/tests/`) | Regras da D13: nenhuma mudança em `storage.*` além das políticas de `storage.objects`; políticas só no formato da D13; bucket privado e com limites | 2 |
| `supabase/migrations/<AAAAMMDDHHMMSS>_biblioteca_storage.sql` | Bucket `midias` e políticas de `storage.objects` | 3 |
| `supabase/tests/rls.test.ts` | Bloco `E2 — Biblioteca e preparação` | 3 |
| `src/shared/infra/errosSupabase.ts` (+ teste) | `classificarErro`, `exigirLinhas` | 4 |
| `src/shared/infra/acessoSupabase.ts` | `traduzirErro` passa a usar `classificarErro` (sem mudar comportamento) | 4 |
| `src/shared/infra/preparacaoSupabase.ts` (+ teste) | Repositórios de mídias, sons, cenas, episódios/avisos e gestos | 4 |
| `src/shared/infra/armazenamentoSupabase.ts` (+ teste) | `ArmazenamentoDeMidia` por `XMLHttpRequest`; prévia por URL assinada; remoção | 4 |
| `src/app/servicos.ts` (+ teste) | Cliente único por página para acesso e preparação; `obterServicosDePreparacao` | 4 |
| `src/app/dependencias.ts` | `obterPreparacao` (preguiçoso) | 4 |
| `src/app/servicosFalsos.ts` | `preparacaoVazia` e `obterPreparacao` nas dependências falsas (4); `criarFalsosDePreparacao` e `arquivoDeTeste` (5); só para testes | 4, 5 |
| `src/app/telas/AbaBiblioteca.tsx` (+ teste) | Envio, progresso, cancelamento, prévia, sons, uso, exclusão | 5 |
| `src/app/telas/AbaCenas.tsx` (+ teste), `src/app/telas/AbaGestos.tsx` (+ teste) | Cenas; mapa de gestos | 6 |
| `src/app/telas/AbaEpisodios.tsx` (+ teste) | Episódios e avisos | 7 |
| `src/app/telas/Painel.tsx` (+ teste) | As quatro abas da E2 deixam de ser provisórias | 5, 6, 7 |
| `src/shared/ui/BarraDeProgresso.tsx` | `<progress>` com rótulo acessível | 5 |
| `src/shared/styles/base.css` | Estilos de envio, prévia, lista de sons, formulários de cena, gesto e aviso | 5, 6, 7 |
| `supabase/README.md` | Migração nova em "Onde"; seção "Biblioteca no Storage (E2)" para o responsável | 3, 8 |
| READMEs: `src/`, `src/domains/`, `src/app/`, `src/app/telas/`, `src/shared/infra/`, `src/shared/ui/`, `src/shared/styles/`, `supabase/migrations/`, `supabase/tests/`, `scripts/`, `scripts/tests/` | "Onde", "Arquivos" e o que passa a ser falso | na tarefa que mexe na pasta |

Cada tarefa termina com um commit que leva o seu registro `docs/verificacoes/AAAA-MM-DD-NNN-*.md`. O próprio plano entra antes, no commit do **VER-023** (este plano, a linha nova de `docs/planos/README.md`, o registro e a linha dele em `docs/verificacoes/README.md`). As Tarefas 1 a 8 usam **VER-024 a VER-031** (os números são os próximos livres na hora de cada commit; conferir `docs/verificacoes/README.md` antes). Toda tarefa também modifica `docs/verificacoes/README.md` (linha nova em "Onde", campo "Arquivos" e o número do exemplo da seção "Exemplo", que passa ao próximo livre). Links para o registro da própria tarefa só entram no passo do registro. **Cada tarefa passa sozinha no `npm run check`** (inclusive o `typecheck`): uma mudança de interface entra junto com todos os arquivos que precisam dela para compilar (por exemplo, `servicosFalsos.ts` na Tarefa 4; achado I6 da revisão do plano). O `npm run check` final de cada tarefa roda **depois** de o registro existir e é o último ato antes do commit; depois do commit vem o push (decisão (b)) e o relato do estado.

O primeiro registro da E2 (VER-024) **abre com a conferência das pendências da E1** (PLA-002, Tarefa 6, Passo 5: migração `membros_sem_autoalteracao` aplicada, login Google configurado e conferência real), anotando o que o responsável já confirmou e o que continua pendente; nenhum código da E2 depende delas, só a conferência real da Tarefa 8.

---

### Tarefa 1: domínio Preparação (regras puras, portas e serviço da Biblioteca)

**Arquivos:**
- Criar: `src/domains/preparacao/README.md`, `src/domains/preparacao/{midia,cenas,gestos,episodios,usos,portas,biblioteca}.ts`, testes `src/domains/preparacao/{midia,cenas,gestos,episodios,usos,biblioteca}.test.ts`, registro `docs/verificacoes/AAAA-MM-DD-024-e2-dominio-preparacao.md`
- Modificar: `src/domains/README.md` ("Onde", "Arquivos", "Organização" com `preparacao/`), `src/README.md` (se citar a lista de domínios), `docs/verificacoes/README.md`

**Interfaces** (nenhum import de `react`, `@supabase/*`, `src/shared` ou `src/app`; o teste `src/domains/arquitetura.test.ts` já cobre a pasta nova, porque lê `./**/*.ts`):

```ts
// midia.ts
export type TipoDeMidia = 'som' | 'imagem'
export interface TipoAceito { tipo: TipoDeMidia; mime: string; extensao: string }
export const TIPOS_ACEITOS: readonly TipoAceito[] // 8 tipos da D4, nesta ordem: mp3, wav, ogg, m4a, png, jpg, webp, gif
export const LIMITE_POR_ARQUIVO_BYTES = 52_428_800 // = CHECK midias_tamanho_ate_50mb
export const LIMITE_TOTAL_BYTES = 1_000_000_000 // D7
export const BYTES_PARA_DETECTAR = 16
export function detectarTipo(inicio: Uint8Array): TipoAceito | null
export type RecusaDoArquivo = 'vazio' | 'grande_demais' | 'tipo_recusado' | 'sem_espaco'
export type ConferenciaDoArquivo = { ok: true; tipo: TipoAceito } | { ok: false; motivo: RecusaDoArquivo }
export function conferirArquivo(a: { tamanho: number; inicio: Uint8Array }, usoAtualBytes: number): ConferenciaDoArquivo
export function caminhoDaMidia(tipo: TipoAceito, id: string): string // `${tipo.tipo}/${id}.${tipo.extensao}`; id fora de /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ → lança Error
export function nomeDeExibicao(nomeDoArquivo: string): string // último trecho depois de '/' ou '\', sem controles, trim, ≤ 120; vazio → 'sem nome'
export interface Midia { id: string; tipo: TipoDeMidia; nome: string; caminho: string; mime: string; tamanhoBytes: number; enviadoPor: string | null }
export function usoDaBiblioteca(midias: readonly Midia[]): { bytes: number; fracao: number; alerta: boolean } // alerta: fração ≥ 0,8

// cenas.ts
export interface Cena { id: string; nomeExibicao: string; nomeObs: string; ordem: number }
export type RecusaDaCena = 'nome_vazio' | 'nome_obs_vazio' | 'nome_obs_duplicado'
export function conferirCena(c: { nomeExibicao: string; nomeObs: string }, cenas: readonly Cena[], idEditado: string | null): RecusaDaCena | null
// nomeExibicao: trim; nomeObs: comparado EXATO (o OBS diferencia caixa e espaços; o banco tem unique exato), só vazio/só espaços é recusado

// gestos.ts
export const GESTOS: readonly { gesto: Gesto; emoji: string; rotulo: string }[] // os 7, na ordem da tabela do DES-001 §7
export type Gesto = 'Closed_Fist' | 'Open_Palm' | 'Pointing_Up' | 'Thumb_Down' | 'Thumb_Up' | 'Victory' | 'ILoveYou'
export type AcaoDoGesto = 'clipe' | 'marcador' | 'cena' | 'som' | 'proximo_aviso' | 'ocultar_aviso' | 'proxima_cena' | 'nenhuma'
export const ACOES: readonly { acao: AcaoDoGesto; rotulo: string }[]
export interface LinhaDoMapa { gesto: Gesto; acao: AcaoDoGesto; cenaId: string | null; somId: string | null }
export function normalizarGesto(l: LinhaDoMapa): LinhaDoMapa // acao ≠ cena → cenaId null; acao ≠ som → somId null
export function conferirGesto(l: LinhaDoMapa, cenas: readonly { id: string }[], sons: readonly { id: string }[]): 'falta_cena' | 'falta_som' | 'alvo_inexistente' | null
export function sugestoesDeSom(mapa: readonly LinhaDoMapa[], sons: readonly Som[]): { gesto: Gesto; som: Som }[] // D12

// episodios.ts
export type EstadoDoEpisodio = 'rascunho' | 'ao_vivo' | 'encerrado'
export interface Episodio { id: string; titulo: string; data: string; estado: EstadoDoEpisodio }
export interface Aviso { id: string; episodioId: string; titulo: string; texto: string; link: string | null; imagemMidiaId: string | null; duracaoS: number; ordem: number }
export function conferirEpisodio(e: { titulo: string; data: string }): 'titulo_vazio' | 'titulo_longo' | 'data_invalida' | null // título ≤ 120; data AAAA-MM-DD real
export function podeExcluirEpisodio(e: Episodio): boolean // só rascunho (D2)
export function normalizarLink(texto: string): { ok: true; link: string | null } | { ok: false } // vazio → null; new URL; protocolo 'https:'; sem usuário/senha; devolve url.href
export function conferirAviso(a: { titulo: string; link: string; duracaoS: number; imagemMidiaId: string | null }, imagens: readonly Midia[]): 'titulo_vazio' | 'link_invalido' | 'duracao_invalida' | 'imagem_inexistente' | null // duração inteira 1..600
export function trocarOrdem<T extends { id: string; ordem: number }>(lista: readonly T[], id: string, direcao: 'subir' | 'descer'): { id: string; ordem: number }[] // [] nas pontas; com ordens repetidas, renumera 0..n-1 antes

// sons (em midia.ts): export interface Som { id: string; midiaId: string; rotulo: string; emoji: string | null; volume: number; ordem: number }
// export function conferirSom(s: { rotulo: string; volume: number }): 'rotulo_vazio' | 'volume_invalido' | null // volume 0..1

// usos.ts
export function usosDaMidia(m: Midia, ctx: { sons: readonly Som[]; mapa: readonly LinhaDoMapa[]; avisosComImagem: number }): { gestos: Gesto[]; avisos: number; bloqueia: boolean } // bloqueia = gestos.length > 0
export function usosDaCena(cenaId: string, mapa: readonly LinhaDoMapa[]): Gesto[]

// portas.ts
export type MotivoDaPreparacao = 'duplicado' | 'em_uso' | 'invalido' | 'negado' | 'nada_alterado' | 'sessao_expirada' | 'rede' | 'cancelado' | 'sem_resposta' | 'outro'
export class ErroDePreparacao extends Error { readonly motivo: MotivoDaPreparacao } // name 'ErroDePreparacao'; mensagem só com o motivo
export interface NovaMidia { id: string; tipo: TipoDeMidia; nome: string; caminho: string; mime: string; tamanhoBytes: number; enviadoPor: string }
export interface RepositorioDeMidias { listar(): Promise<Midia[]>; registrar(m: NovaMidia): Promise<void>; remover(id: string): Promise<void>; contarAvisosComImagem(id: string): Promise<number> }
export interface RepositorioDeSons { listar(): Promise<Som[]>; incluir(midiaId: string, s: { rotulo: string; emoji: string | null; volume: number; ordem: number }): Promise<void>; alterar(id: string, s: { rotulo: string; emoji: string | null; volume: number; ordem: number }): Promise<void> }
export interface RepositorioDeCenas { listar(): Promise<Cena[]>; incluir(c: Omit<Cena, 'id'>): Promise<void>; alterar(id: string, c: Omit<Cena, 'id'>): Promise<void>; remover(id: string): Promise<void> }
export interface RepositorioDeEpisodios {
  listar(): Promise<Episodio[]>; incluir(e: { titulo: string; data: string; criadoPor: string }): Promise<void>
  alterar(id: string, e: { titulo: string; data: string }): Promise<void>; remover(id: string): Promise<void>
  listarAvisos(episodioId: string): Promise<Aviso[]>; incluirAviso(a: Omit<Aviso, 'id'>): Promise<void>
  alterarAviso(id: string, a: Omit<Aviso, 'id' | 'episodioId'>): Promise<void>; alterarOrdemDoAviso(id: string, ordem: number): Promise<void>; removerAviso(id: string): Promise<void>
}
export interface RepositorioDeGestos { listar(): Promise<LinhaDoMapa[]>; alterar(l: LinhaDoMapa): Promise<void> }
export interface OpcoesDoEnvio { aoProgredir: (fracao: number) => void; sinal: AbortSignal }
export interface ArmazenamentoDeMidia {
  enviar(caminho: string, corpo: Blob, mime: string, opcoes: OpcoesDoEnvio): Promise<void> // cancelado → ErroDePreparacao('cancelado'); 30 s sem progresso → 'sem_resposta'
  remover(caminho: string): Promise<void>
  urlDePrevia(caminho: string): Promise<string>
}
export interface ServicosDePreparacao { midias: RepositorioDeMidias; sons: RepositorioDeSons; cenas: RepositorioDeCenas; episodios: RepositorioDeEpisodios; gestos: RepositorioDeGestos; armazenamento: ArmazenamentoDeMidia }

// biblioteca.ts
export interface ArquivoEscolhido { nome: string; tamanho: number; inicio: Uint8Array; corpo: Blob }
export type ResultadoDoEnvio = { ok: true; midia: NovaMidia } | { ok: false; motivo: RecusaDoArquivo }
export async function enviarMidia(s: ServicosDePreparacao, a: ArquivoEscolhido, ctx: { usoAtualBytes: number; membroId: string; gerarId: () => string; ordemDoSom: number }, opcoes: OpcoesDoEnvio): Promise<ResultadoDoEnvio>
export async function excluirMidia(s: ServicosDePreparacao, m: Midia): Promise<{ arquivoFicou: boolean }>
```

- [ ] **Passo 1: testes das regras (falham).** Arquivos de teste com bytes montados no próprio teste (`bytes(...)` = `Uint8Array.from`):
  - `midia.test.ts`:
    - `tipo-pelos-bytes` (`test.each`): `49 44 33` (ID3) e `FF FB` → mp3; `RIFF....WAVE` → wav; `OggS` → ogg; `....ftypM4A ` → m4a; `89 50 4E 47 0D 0A 1A 0A` → png; `FF D8 FF` → jpg; `GIF89a` e `GIF87a` → gif; `RIFF....WEBP` → webp. `RIFF....AVI ` → `null`; `....ftypisom` (vídeo MP4) → `null`; `FF D8` sem o terceiro byte → `null`; 3 bytes de PNG → `null`.
    - `mp3-que-e-png`: `conferirArquivo` de um arquivo cujo nome termina em `.mp3` e cujos bytes começam com a assinatura PNG → `{ ok: true, tipo: <png> }` (o nome nunca decide).
    - `svg-e-html-recusados`: `<svg ...`, `<?xml`, `<!DOCTYPE html`, `%PDF` → `null`; `conferirArquivo` com esses inícios → `tipo_recusado`.
    - `limite-50mb`: tamanho 52 428 800 com início PNG → `ok`; 52 428 801 → `grande_demais`; 0 → `vazio` (a ordem é `vazio`, `grande_demais`, `tipo_recusado`, `sem_espaco`).
    - `sem-espaco`: uso 999 999 000 + arquivo de 1 001 bytes → `sem_espaco`; de 1 000 → `ok`.
    - `caminho-sem-nome-do-arquivo`: `caminhoDaMidia(png, '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f')` → `imagem/0b6e…6f.png`; `id` com maiúsculas, com `/`, com `..` ou vazio → lança.
    - `nome-de-exibicao`: `'../../etc/aplauso.mp3'` → `'aplauso.mp3'`; `'C:\\Pasta\\foto.png'` → `'foto.png'`; `'  \u0000x\u0007.mp3 '` → `'x.mp3'`; 300 letras → 120; `'/'` e `''` → `'sem nome'`.
    - `uso-da-biblioteca`: duas mídias de 400 000 000 e 400 000 001 → `bytes` 800 000 001, `alerta: true`; uma de 1 → `alerta: false`; lista vazia → 0.
    - `conferir-som`: rótulo só com espaços → `rotulo_vazio`; volume −0,01 e 1,01 e `NaN` → `volume_invalido`; 0 e 1 → `null`.
  - `cenas.test.ts`: `nome-obs-exato` (`'Geral'` e `'geral'` convivem; `'Geral'` repetido → `nome_obs_duplicado`; editar a própria cena sem mudar o nome → `null`); `nomes-vazios`.
  - `gestos.test.ts`: `gesto-som-sem-som` (`{ acao: 'som', somId: null }` → `falta_som`; `cena` sem cena → `falta_cena`; `somId` que não está na lista → `alvo_inexistente`); `gesto-zera-alvo` (`normalizarGesto({ acao: 'clipe', cenaId: 'c', somId: 's' })` → os dois `null`; `{ acao: 'cena', somId: 's' }` → `somId: null`); `sete-gestos` (`GESTOS` tem os 7 valores do tipo `gesto` da migração, sem repetir); `sugestao-de-som` (som "Aplauso" e "BUUU" com `Thumb_Up`/`Thumb_Down` em `nenhuma` → duas sugestões; com `Thumb_Up` já em `som` → só a de `Thumb_Down`; rótulo "aplausos" → nenhuma; "Áplauso" → sugere, comparando sem acento).
  - `episodios.test.ts`: `link-so-https` (`'https://revocast.test/x'` → ok com o `href`; `'HTTPS://revocast.test'` → ok, `https://revocast.test/`; `''` → `link: null`; `'http://revocast.test'`, `'javascript:alert(1)'`, `'data:text/html,x'`, `'//revocast.test'`, `'https://u:s@revocast.test'`, `'revocast.test'` → `{ ok: false }`); `conferir-aviso` (título vazio, duração 0, 601 e 1,5 → recusa; imagem que não é da lista de imagens → `imagem_inexistente`); `conferir-episodio` (`'2026-02-30'` → `data_invalida`; 121 letras → `titulo_longo`); `excluir-so-rascunho`; `trocar-ordem` (subir o segundo de `[0,1,2]` → `[{a:1},{b:0}]`; subir o primeiro → `[]`; ordens `[0,0,0]` → renumera e troca).
  - `usos.test.ts`: `usos-da-midia` (som ligado a `Thumb_Up` → `gestos: ['Thumb_Up']`, `bloqueia: true`; imagem com `avisosComImagem: 3` → `avisos: 3`, `bloqueia: false`; som sem gesto → `bloqueia: false`); `usos-da-cena`.
- [ ] **Passo 2:** `npx vitest run src/domains/preparacao`. Esperado: FAIL (módulos inexistentes).
- [ ] **Passo 3:** implementar `midia.ts`, `cenas.ts`, `gestos.ts`, `episodios.ts`, `usos.ts` e `portas.ts`. `ErroDePreparacao` declara o campo e o atribui no construtor (sem propriedade de parâmetro). `detectarTipo` é uma tabela de assinaturas `{ deslocamento, bytes }[]` por tipo (nada de `includes` em texto), com o MP3 por `ID3` ou pela sincronia de quadro (`b[0] === 0xff && (b[1] & 0xe0) === 0xe0`, que não colide com o JPEG `FF D8`). Rodar os testes. Esperado: todos passam.
- [ ] **Passo 4: testes do serviço da Biblioteca (falham).** Em `biblioteca.test.ts`, com portas falsas escritas no arquivo (contam chamadas e podem falhar):

| Teste | Situação | Esperado |
|---|---|---|
| `envio-ok-imagem` | PNG de 10 bytes, `gerarId` fixo | `armazenamento.enviar('imagem/<id>.png', corpo, 'image/png', opcoes)`; depois `midias.registrar` com `nome` de exibição, `mime` detectado (não o `File.type`), `tamanhoBytes` e `enviadoPor`; `sons.incluir` não chamado |
| `envio-ok-som` | MP3 `aplauso.mp3` | `registrar` e depois `sons.incluir(id, { rotulo: 'aplauso', emoji: null, volume: 1, ordem: ctx.ordemDoSom })` (rótulo = nome sem a extensão) |
| `mp3-que-e-png` | arquivo `foto.mp3` com bytes de PNG | `enviar('imagem/<id>.png', corpo, 'image/png', …)`; `registrar` com `tipo: 'imagem'`, `mime: 'image/png'` e `nome: 'foto.mp3'`; `sons.incluir` **não** chamado |
| `envio-recusado` | HTML com nome `.png`; 50 MB + 1 | `{ ok: false, motivo }`; nenhuma chamada a `enviar`, `registrar` |
| `envio-compensa` | `registrar` lança `ErroDePreparacao('negado')`; em outro caso `sons.incluir` lança | `armazenamento.remover` com o mesmo caminho (no caso do som, também `midias.remover(id)` antes); o erro original (`negado`) é relançado; com `remover` também falhando, o erro relançado continua `negado` |
| `envio-interrompido-remove` (`test.each` com `cancelado`, `sem_resposta` e `rede`) | `enviar` lança `ErroDePreparacao(<motivo>)` | relança o mesmo motivo; `registrar` não chamado; `armazenamento.remover` chamado 1 vez com o caminho (o objeto pode ter sido gravado antes do corte; remover um caminho que não existe não dá erro); com `remover` também falhando, `enviarMidia` relança o motivo original, sem lançar o erro da remoção |
| `envio-negado-nao-remove` | `enviar` lança `ErroDePreparacao('negado')` | relança; `remover` não chamado (nada foi gravado) |
| `excluir-ordem` | mídia qualquer | `midias.remover(id)` antes de `armazenamento.remover(caminho)`; `{ arquivoFicou: false }` |
| `excluir-em-uso` | `midias.remover` lança `ErroDePreparacao('em_uso')` | relança; `armazenamento.remover` **não** chamado |
| `excluir-arquivo-ficou` | `armazenamento.remover` lança | resolve com `{ arquivoFicou: true }` (a linha já saiu) |

- [ ] **Passo 5:** implementar `biblioteca.ts` (compensação com `try { … } catch { /* o erro original é o que importa */ }`; nos motivos `cancelado`, `sem_resposta` e `rede` do envio, a remoção de boa-fé, registrada no VER-024 e em Riscos: um objeto gravado que a remoção não alcance fica órfão, fora do uso da D7). Rodar. Esperado: todos passam.
- [ ] **Passo 6: sabotagens**, uma de cada vez, desfazendo com o Edit inverso e anotando no registro o teste que caiu: usar o nome do arquivo no caminho → `caminho-sem-nome-do-arquivo` e `envio-ok-imagem` falham; decidir o tipo pelo `File.type`/extensão do nome → `tipo-pelos-bytes` e `envio-recusado` falham; aceitar `http:` em `normalizarLink` → `link-so-https` falha; tirar `normalizarGesto` da conferência → `gesto-zera-alvo` falha; remover o objeto antes da linha em `excluirMidia` → `excluir-ordem` e `excluir-em-uso` falham; tirar a compensação → `envio-compensa` falha; não remover depois de `cancelado`/`sem_resposta`/`rede` → `envio-interrompido-remove` falha; trocar `>` por `>=` no limite de 50 MB → `limite-50mb` falha; acrescentar `{ tipo: 'imagem', mime: 'image/svg+xml', … }` aos aceitos com assinatura `<svg` → `svg-e-html-recusados` falha; importar `@supabase/supabase-js` em `portas.ts` → `arquitetura.test.ts` falha.
- [ ] **Passo 7:** README de `src/domains/preparacao/` (11 seções; em "Lógica", diagrama das portas e da ordem do envio/exclusão da D6); atualizar `src/domains/README.md`; `npm run check`. Esperado: 0 erros.
- [ ] **Passo 8:** registro VER-024 (abre com as pendências da E1; inclui D1, D4, D6, D7, D9, D11, D12 e as sabotagens), linha nova em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como **último ato**; commit; push; relato.

### Tarefa 2: simulação do Storage e checagens de banco para `storage.*`

**Arquivos:**
- Modificar: `supabase/tests/simulacao-supabase.sql`, `supabase/tests/dono-migracao.sql`, `scripts/_catalogo.mjs`, `scripts/check-data-api.mjs`, `scripts/tests/check-data-api.test.mjs`, `scripts/tests/catalogo.test.mjs` (impressão nova das relações de `storage` e forma nova das políticas em pré-existentes), `scripts/README.md`, `scripts/tests/README.md`, `supabase/tests/README.md`, `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-025-e2-simulacao-storage-e-checagens.md`

**Interfaces:**
- Simulação (só para testes; nunca aplicada no Supabase): papel `supabase_storage_admin` (`nologin`), dono do schema `storage` e das tabelas `storage.buckets (id text primary key, name text not null, owner uuid, owner_id text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at, updated_at)` e `storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, created_at, updated_at)`, com RLS ativa nas duas; `storage.foldername(name text) returns text[]`; `usage` no schema e os privilégios de tabela que o Supabase dá a `anon`, `authenticated` e `service_role`; os gatilhos de `storage.objects` que as migrações atuais do Storage tiverem e que um `insert` como `authenticated` dispare (Passo 1(a)); em `dono-migracao.sql`, `grant supabase_storage_admin to postgres_sim` (D13), com o comentário que diz por que e o que ela dá a mais que o real. No Supabase real, `supabase_storage_admin` é `LOGIN NOINHERIT CREATEROLE`; na simulação ele pode ficar `nologin` (o PGlite tem uma sessão só e nenhum teste entra como ele), e o comentário diz que a herança de privilégios do `postgres_sim` vem da opção da participação (`inherit_option = true`, padrão do `grant`), não do atributo do papel.
- `_catalogo.mjs`: impressão ampliada **só para as relações do schema `storage`** (colunas de `pg_attribute`, padrões de `pg_attrdef`, índices de `pg_index`, gatilhos não internos de `pg_trigger` com `tgenabled`, restrições de `pg_constraint` e as chaves estrangeiras que apontam para elas, `pg_description`, `relreplident`, `pg_statistic_ext`, filhas em `pg_inherits`, `relrowsecurity` e `relforcerowsecurity`), com a regra da D13 substituindo, para essas relações, o erro genérico de alteração, a lista `mudancasEmStorage` e as políticas em pré-existentes com `{ rotulo, relacao, papeis, comando, usando, comCheck, mudanca }`; ao fim da análise, a leitura `bucketsFinais` (`select id, public, file_size_limit, allowed_mime_types from storage.buckets`, como superusuário, na mesma instância).
- `check-data-api.mjs`: `export const BUCKETS_DO_APP = ['midias']`, `export const TIPOS_DO_BUCKET` (os 8 da D4) e as três regras da D13.

- [ ] **Passo 1: fontes (antes de escrever SQL).** Ler e citar no comentário de cada bloco, com a data da leitura, como a E0 fez:
  - (a) as migrações do servidor de Storage (`github.com/supabase/storage`, `migrations/tenant/`): criação de `buckets` e `objects`, colunas `file_size_limit`/`allowed_mime_types`, `path_tokens`, `foldername`, `enable row level security`, os `grant` a `anon`, `authenticated` e `service_role`, e **os gatilhos atuais de `storage.objects`** (por exemplo, os de prefixos ou de `updated_at`): para cada um, anotar se dispara num `insert` ou `delete` feito como `authenticated` e se escreve em outra tabela de `storage` sob a RLS; os que mudam o resultado de uma política (por exemplo, um gatilho que grava em `storage.prefixes` e falharia sob a RLS no real) entram na simulação; os que não mudam ficam fora, com a justificativa no comentário;
  - (b) como o `postgres` real cria política em `storage.objects` e insere em `storage.buckets`: `supautils.policy_grants` (repositório `github.com/supabase/supautils` e a configuração do `supabase/postgres`) e o `BYPASSRLS` do `postgres` (`10000000000000_demote-postgres.sql`, já citado em `dono-migracao.sql`); e que ele **não** é membro de `supabase_storage_admin` (documentação "Permissions" e o artigo da base de conhecimento sobre participações dadas pelo `supabase_admin`) e recebe `42501` em `alter table storage.objects`;
  - (c) a documentação "Storage Access Control" (`supabase.com/docs/guides/storage/security/access-control`): políticas criadas com `create policy ... on storage.objects` no editor SQL, `storage.foldername(name)`, e upload = `INSERT` (upsert = `INSERT`, `SELECT` e `UPDATE`).
  Sondas já feitas (PGlite, fora do repositório, 2026-11-26, na redação e na revisão deste plano): sem a participação, a migração da Tarefa 3 falha (`must be owner of table objects` no `create policy`; `new row violates row-level security policy for table "buckets"` no `insert`); com ela, passa, **e o `postgres_sim` consegue `alter table storage.objects disable row level security`**, o que o real não consegue. **Regra:** usar a participação (D13), nunca `BYPASSRLS` nem superusuário, e compensar o poder a mais pela regra de `storage.*` do Passo 4. Se as fontes contradisserem a D13 (por exemplo, `policy_grants` sem `storage.objects`), parar e registrar no VER-025: a Tarefa 3 passa a separar o bucket (migração) das políticas (criadas pelo painel com o mesmo texto e conferidas por consulta a `pg_policies` no passo do responsável).
- [ ] **Passo 2: testes das checagens (falham).** Em `scripts/tests/check-data-api.test.mjs`, com a base mínima já usada no arquivo (`PADRAO`, `tabela`, `soFuncoes`, com uma `papel_atual` e uma `dispositivo_atual` mínimas, como os testes do `rpc:grants-check` já fazem). `B` abrevia `bucket_id = 'midias'` e `P` abrevia `(select public.papel_atual()) in ('equipe','admin')`:

| Caso | SQL acrescentado | Esperado |
|---|---|---|
| `storage-politica-aceita` | `create policy m_le on storage.objects for select to authenticated using (B and P);` | `[]` |
| `storage-insert-aceito` | `for insert to authenticated with check (B and P and name ~ '^som/')` | `[]` |
| `storage-delete-aceito` | `for delete to authenticated using (B and P)` | `[]` |
| `storage-politica-com-dispositivo` | `using (B and (select tipo from public.dispositivo_atual()) = 'obs_palco')` | `[]` |
| `storage-sem-bucket` | `using (P)` | 1 erro citando `storage.objects`, a política e o bucket |
| `storage-bucket-em-or` | `using (bucket_id = 'midias' or (select public.papel_atual()) is null)` (exemplo da revisão: abriria todos os buckets a quem não tem papel) | 1 erro (bucket não é conjunção de topo) |
| `storage-bucket-negado` | `using (not (B) and P)` | 1 erro |
| `storage-bucket-depois` | `using (P and B)` | 1 erro (o texto não começa pelo bucket; a regra é estrita de propósito: a migração escreve o bucket primeiro) |
| `storage-outro-bucket` | `using (bucket_id = 'outro' and P)` | 1 erro (bucket fora de `BUCKETS_DO_APP`) |
| `storage-sem-papel` | `using (bucket_id = 'midias' and name like 'som/%')` | 1 erro (sem `papel_atual()`/`dispositivo_atual()`) |
| `storage-papel-em-texto` | `using (bucket_id = 'midias' and name <> 'public.papel_atual()')` | 1 erro (a função só aparece dentro de um texto; `codigoDoCorpo` o apaga) |
| `storage-check-sem-bucket` | `for insert to authenticated with check (P)` | 1 erro (o `with check` também é conferido) |
| `storage-update` | `for update to authenticated using (B and P) with check (B and P)` | 1 erro (comando não permitido, D5) |
| `storage-all` | `for all to authenticated using (B and P)` | 1 erro (comando não permitido) |
| `storage-para-anon` | `for select to anon using (B and P)` | 1 erro "só to authenticated" |
| `storage-buckets-politica` | política em `storage.buckets` | "política em relação pré-existente: forma não suportada" (como hoje) |
| `auth-users-politica` | política em `auth.users` | idem |
| `storage-rls-desligada` | `alter table storage.objects disable row level security;` (sonda da revisão) | exatamente 1 erro, a mensagem da regra de `storage.*` com "RLS" (o genérico "relação pré-existente: alteração" não sai para `storage`) |
| `storage-rls-forcada` | `alter table storage.objects force row level security;` | exatamente 1 erro, com "RLS" |
| `storage-coluna` | `alter table storage.objects add column extra text;` | exatamente 1 erro, com "coluna" |
| `storage-padrao-trocado` | `alter table storage.objects alter column id set default '00000000-0000-4000-8000-000000000000';` (a coluna `id` já tem o padrão `gen_random_uuid()`) | exatamente 1 erro, com "padrão" |
| `storage-comentario` | `comment on table storage.objects is 'x';` | 1 erro, com "comentário" |
| `storage-replica-identity` | `alter table storage.objects replica identity full;` | 1 erro, com "replica identity" |
| `storage-estatistica` | `create statistics public.st on bucket_id, name from storage.objects;` | 1 erro, com "estatística" (o objeto de estatística em `public` pode dar outro erro pela regra de objetos; o teste confere a menção) |
| `storage-heranca` | `create table public.filha () inherits (storage.objects);` (com RLS, política e grant em `public.filha` para isolar o caso) | o erro com "herança" está entre os erros |
| `storage-chave-estrangeira` | `public.cenas` ganha `objeto_id uuid references storage.objects (id)` numa tabela de teste | o erro com "chave estrangeira" está entre os erros |
| `storage-gatilho-desligado` | gatilho que a simulação traga em `storage.objects` (Passo 1(a)) desligado com `alter table storage.objects disable trigger <nome>`; sem gatilho na simulação, o caso cria um antes, na simulação de teste do caso | 1 erro, com "gatilho" |
| `storage-indice` | `create index on storage.objects (name);` | exatamente 1 erro, com "índice" |
| `storage-gatilho` | função `security invoker` em `public` + `create trigger g before insert on storage.objects for each row execute function public.f();` | o erro com "gatilho" está entre os erros (o `rpc:grants-check` julga a função à parte) |
| `storage-grant-alterado` (`test.each`) | `grant select on storage.objects to supabase_auth_admin;`; `grant select on storage.objects to authenticated with grant option;`; `revoke truncate on storage.objects from authenticated;` (mudanças que alteram de fato a ACL: na simulação fiel, `authenticated` já tem ALL, e um `grant truncate ... to authenticated` não muda nada) | exatamente 1 erro em cada, com "privilégio" |
| `storage-tabela-nova` | `create table storage.extra (id int);` | erro ("fora do schema public", como hoje) |
| `storage-politica-alterada-ou-removida` (`test.each`, numa segunda migração sobre `m_le` válida) | `alter policy m_le on storage.objects using (P)`; `alter policy m_le on storage.objects to authenticated, anon`; `alter policy m_le on storage.objects rename to m_le2`; `drop policy m_le on storage.objects` | o `alter` que tira o bucket e o que acrescenta `anon` são erro (1 cada); renomear é aceito (a política resultante segue a regra); o `drop` é aceito (remover política só nega mais). O comando de uma política não muda depois de criada (`alter policy ... for update` é erro de sintaxe), então não há caso para isso |
| `bucket-publico` | `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('midias', 'midias', true, 52428800, array['image/png'])` | 1 erro da regra do bucket (público); variantes: sem `file_size_limit`, `allowed_mime_types` nulo ou com `image/svg+xml`, bucket `outro` → 1 erro cada; a linha certa → `[]` |

  Rodar os testes de `scripts/tests` pelo comando que o `scripts/tests/README.md` indica. Esperado: FAIL nos casos aceitos (hoje toda política em pré-existente é erro) e nos que pedem regra ou mensagem nova (com a simulação de hoje, sem `storage`, todos falham por erro de SQL).
- [ ] **Passo 3: simulação.** Acrescentar o bloco `storage` ao fim de `simulacao-supabase.sql` (nunca menos de 28 linhas; comentários com as fontes do Passo 1) e, em `dono-migracao.sql`, a participação com o comentário da D13 (o que o real usa, por que o PGlite não reproduz e o que a participação dá a mais, compensado pela regra de `storage.*`). Rodar `npm test` (todos os testes de banco aplicam a simulação nova) e os testes de `scripts/tests`. Esperado: tudo que passava continua passando (a simulação nova não muda `public`).
- [ ] **Passo 4: catálogo e regras.** Em `_catalogo.mjs`, a impressão ampliada das relações de `storage`, `mudancasEmStorage`, a forma nova de `politicasEmPreexistentes` e `bucketsFinais`; em `check-data-api.mjs`, as três regras da D13 (as políticas de `storage.objects` saem do erro genérico de "política em relação pré-existente" só quando passam na regra; a conferência do bucket é `expr.startsWith(\`((bucket_id = '${b}'::text) AND \`)` para algum `b` de `BUCKETS_DO_APP`, em `usando` e em `comCheck` quando não nulos). Rodar os testes do Passo 2. Esperado: todos passam; `npm run data-api:check` e `npm run rpc:grants-check` sobre as migrações atuais: 0 erros.
- [ ] **Passo 5: sabotagens**, anotando o teste que caiu: aceitar qualquer política em pré-existente → `storage-buckets-politica` e `auth-users-politica` falham; conferir o bucket por `includes` em vez de `startsWith` → `storage-bucket-em-or`, `storage-bucket-negado` e `storage-bucket-depois` falham; tirar a exigência da função → `storage-sem-papel` falha; conferir só o `using` → `storage-check-sem-bucket` falha; aceitar qualquer comando → `storage-update` e `storage-all` falham; tirar `relrowsecurity` da impressão de `storage` → `storage-rls-desligada` falha (a mensagem com "RLS" some); tirar `pg_attrdef` → `storage-padrao-trocado` falha; tirar `tgenabled` → `storage-gatilho-desligado` falha; conferir a função de papel no texto cru, sem `codigoDoCorpo` → `storage-papel-em-texto` falha; deixar sair também o erro genérico para `storage` → os casos com "exatamente 1 erro" falham; tirar os gatilhos da impressão → `storage-gatilho` falha; tirar a regra do bucket → `bucket-publico` falha; devolver só o rótulo em `politicasEmPreexistentes` (a forma antiga) → `storage-politica-aceita` falha. A sabotagem da RLS da própria simulação fica para a Tarefa 3, onde existem os testes que a pegam.
- [ ] **Passo 6:** READMEs: `scripts/README.md` (as três regras da D13, a frase "Não há `storage`..." trocada pelo que a simulação passa a ter, a participação e o poder a mais que ela dá, compensado pela regra de `storage.*`; em Riscos: o check não vê os dados de `storage.objects` nem colunas de `storage.buckets` além das quatro conferidas; vê a presença da função de papel na política, não o uso (por exemplo, `is null or true`); no Supabase, `anon` e `authenticated` têm ALL em `storage.*` e só a RLS protege; o que da impressão de `storage` não couber no PGlite; política em outro schema continua recusada), `scripts/tests/README.md` (casos novos), `supabase/tests/README.md` (simulação com `storage`, as fontes e a aproximação da D13); `npm run check`. Esperado: 0 erros (sem migração nova ainda, `data-api:check` passa sobre as duas migrações existentes).
- [ ] **Passo 7:** registro VER-025 (inclui D13, as fontes e as sondas do Passo 1, a aproximação da simulação dita com honestidade e as sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 3: migração `biblioteca_storage` e testes de banco da E2

**Arquivos:**
- Criar: `supabase/migrations/<AAAAMMDDHHMMSS>_biblioteca_storage.sql`, registro `docs/verificacoes/AAAA-MM-DD-026-e2-banco-biblioteca.md`
- Modificar: `supabase/tests/rls.test.ts` (bloco novo no fim, sem mexer nos existentes), `supabase/tests/README.md`, `supabase/migrations/README.md`, `supabase/README.md` ("Onde": as três migrações, em ordem), `docs/verificacoes/README.md`

**Interfaces:**
- Produz (banco): linha `midias` em `storage.buckets` (`public = false`, `file_size_limit = 52428800`, `allowed_mime_types` = os 8 tipos da D4) e as políticas `midias_storage_le`, `midias_storage_insere`, `midias_storage_apaga` em `storage.objects` (D3). Nenhum `grant`, nenhuma função, nenhuma tabela.

- [ ] **Passo 1: testes de banco da E2 (falham).** Acrescentar ao fim de `rls.test.ts` um `describe('E2 — Biblioteca e preparação', ...)` no mesmo banco e nas mesmas transações (nenhum PGlite a mais na CI). Um envio é simulado como o servidor do Storage faz: o comando roda **como a sessão** (`comoSessao`, papel `authenticated` com as claims), `insert into storage.objects (bucket_id, name, owner_id) values ('midias', $1, auth.uid()::text)`. Constantes: `UUID_A = '0b6e2b8a-3c1d-4f2a-9e5b-1a2b3c4d5e6f'`. Sessões: as 9 da matriz (anon sem claims, ana `equipe`, bia `apresentadora`, adm `admin`, estranho fora da lista, câmera, palco, obs_camera e uma sessão anônima sem dispositivo).

| Teste | Ação | Esperado |
|---|---|---|
| `e2-bucket-privado-com-limites` | superusuário: `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'midias'` | 1 linha; `false`; `52428800`; exatamente os 8 tipos da D4 (sem `image/svg+xml`) |
| `e2-storage-quem-envia` | cada sessão insere `som/<UUID_A>.mp3` | aceito só para ana e adm; as outras 7: `new row violates row-level security policy for table "objects"` (anon: `permission denied` ou a mesma violação, conforme os privilégios da fonte; o esperado é anotado no teste com a fonte) |
| `e2-storage-quem-le` | superusuário semeia 2 objetos (um `som`, uma `imagem`) no `midias` e 1 num bucket `outro` criado no teste; cada sessão: `select name from storage.objects` | ana, adm: os 2 do `midias` (nunca o do `outro`); palco: os 2; as outras 6: 0 linhas |
| `e2-storage-quem-apaga` | cada sessão: `delete from storage.objects` (sem `where`) | ana e adm: o `midias` esvazia e o `outro` fica; palco e os demais: nada muda (retrato como superusuário) |
| `e2-sem-update` | ana: `update storage.objects set name = 'som/<outro uuid>.mp3'` | 0 linhas, sem erro; retrato igual |
| `e2-nome-fora-do-formato` (`test.each`, como ana) | `som/../x.mp3`, `som/a/<UUID_A>.mp3`, `som\\<UUID_A>.mp3`, `som/<UUID_A>.png`, `imagem/<UUID_A>.mp3`, `outro/<UUID_A>.mp3`, `som/<UUID_A em maiúsculas>.mp3`, `som/<UUID_A>.mp3.html`, `som/<UUID_A>`, `som/x.mp3`, `imagem/<UUID_A>.svg` | todos recusados pela RLS; controle: `imagem/<UUID_A>.png` e `som/<UUID_A>.m4a` aceitos |
| `e2-outro-bucket-nao-recebe` | ana insere `som/<UUID_A>.mp3` no bucket `outro` | recusado |
| `e2-som-em-gesto-nao-sai` | ana: cria mídia de som e o som; liga `Thumb_Up` ao som; `delete from public.midias where id = $1` | erro `23503` (violação de chave estrangeira de `mapa_gestos`); a mídia continua; depois de voltar o gesto a `nenhuma`, o delete apaga a mídia e o som (cascata) |
| `e2-imagem-em-aviso-vira-nulo` | ana: mídia de imagem num aviso; apaga a mídia | aviso continua, com `imagem_midia_id` nulo |
| `e2-cena-em-gesto-nao-sai` | ana: liga `Victory` a uma cena (`acao = 'cena'`); apaga a cena | `23503`; a cena continua |
| `e2-episodio-sem-estado` | ana: `update public.episodios set titulo = 'Novo', data = '2026-12-01' where id = <ID_EPISODIO> returning estado, gestos_ligados` | 1 linha; `rascunho`, `false` (documenta que a E2 não mexe nesses campos) |

  Rodar `npx vitest run supabase/tests/rls.test.ts`. Esperado: FAIL nos testes de Storage (sem bucket nem políticas); os de `public` (`e2-som-em-gesto-nao-sai`, `e2-imagem-em-aviso-vira-nulo`, `e2-cena-em-gesto-nao-sai`, `e2-episodio-sem-estado`) passam já, porque documentam o comportamento da E0 de que a E2 depende.
- [ ] **Passo 2: migração**, com o cabeçalho no padrão das anteriores (o que faz; DES-001 §7, §8, §15; PLA-003 D3–D5; aplicada depois das duas anteriores; "nunca editada"; sem e-mail):

```sql
-- Bucket privado da Biblioteca (PLA-003, D3 a D5). public = false: nenhuma URL pública. Limite de 50 MB por arquivo
-- (DES-001 §3) e só os tipos da D4 (sem SVG). O on conflict cobre um bucket criado antes à mão pelo painel:
-- os limites e o "privado" valem do mesmo jeito.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', false, 52428800,
  array['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura: equipe/admin (prévia na Biblioteca) e o obs_palco (toca os sons e mostra as imagens). DES-001 §8.
create policy midias_storage_le on storage.objects
  for select to authenticated
  using (bucket_id = 'midias' and (
    (select public.papel_atual()) in ('equipe', 'admin')
    or (select tipo from public.dispositivo_atual()) = 'obs_palco'));

-- Envio: só equipe/admin, só com o caminho que o app gera (pasta do tipo, uuid em minúsculas, extensão do tipo).
create policy midias_storage_insere on storage.objects
  for insert to authenticated
  with check (bucket_id = 'midias' and (select public.papel_atual()) in ('equipe', 'admin')
    and name ~ '^(som/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|ogg|m4a)|imagem/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif))$');

-- Exclusão: só equipe/admin. Sem política de update: nada é sobrescrito (D5).
create policy midias_storage_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'midias' and (select public.papel_atual()) in ('equipe', 'admin'));
```

  Rodar `npx vitest run supabase/tests`. Esperado: todos passam (inclusive a matriz, que não muda: nenhuma tabela de `public` foi tocada).
- [ ] **Passo 3:** `npm run rpc:grants-check` e `npm run data-api:check`. Esperado: 0 erros, "3 migração(ões)".
- [ ] **Passo 4: sabotagens em memória** (a migração aplicada nunca é editada; o laço de `banco.ts` troca o trecho só no arquivo alvo, com `replaceAll`, contagem impressa e falha se 0 ocorrências, como no Passo 6 da Tarefa 2 do PLA-002; antes da primeira e depois da última, `git status --porcelain supabase/migrations` e `sha256sum supabase/migrations/*.sql` e `supabase/tests/banco.ts` idênticos). Uma de cada vez, anotando o teste que caiu:
  - `false, 52428800` → `true, 52428800` (1 ocorrência) → `e2-bucket-privado-com-limites`; passada também pelo `data-api:check` em memória → 1 erro da regra do bucket (D13);
  - `'image/gif']` → `'image/gif', 'image/svg+xml']` (1) → `e2-bucket-privado-com-limites`;
  - `in ('equipe', 'admin')\n    or` → `is not null\n    or` (1, leitura) → `e2-storage-quem-le` falha na bia (a conta fora da lista continua com papel nulo e lendo 0);
  - na política de envio, `(select public.papel_atual()) in ('equipe', 'admin')\n    and name` → `(select public.papel_atual()) is not null\n    and name` (1) → `e2-storage-quem-envia` (bia);
  - `and name ~ '^(som/` → `and name ~ '^(.*|som/` (1 ocorrência; a expressão regular continua válida e passa a aceitar qualquer nome, então o SQL aplica e quem recusa é só a RLS) → `e2-nome-fora-do-formato` falha nos nomes recusados só pelo formato (todos os do `test.each`, que são de ana no bucket `midias`);
  - `{12}\.(mp3|wav|ogg|m4a)` → `{12}\.(mp3|wav|ogg|m4a|png)` (1) → o caso `som/<UUID_A>.png`;
  - `bucket_id = 'midias' and (select public.papel_atual()) in ('equipe', 'admin'));` (exclusão) → `(select public.papel_atual()) in ('equipe', 'admin'));` (1) → `e2-storage-quem-apaga` (o objeto do bucket `outro` some).
  - na simulação (arquivo de teste, edição temporária desfeita com o Edit inverso e conferida por `sha256sum`), tirar `alter table storage.objects enable row level security` → `e2-storage-quem-le` falha (com os privilégios do Supabase e sem RLS, todas as sessões leem tudo): prova que a simulação reproduz a RLS da qual as políticas dependem.

  A sabotagem da política de exclusão sem `bucket_id` também é passada pelo `data-api:check` (chamando `verificarDataApi` com a lista de migrações em memória, a terceira com o trecho trocado): esperado 1 erro de bucket ausente (regra da D13). As de papel trocado por `is not null` continuam com a chamada a `papel_atual()` e passam no check: quem as pega são os testes de banco (limite registrado: a checagem confere a presença da função de papel, não o uso que a política faz dela, como já acontece com as funções no `rpc:grants-check`).
- [ ] **Passo 5:** READMEs (`supabase/migrations/README.md`: migração nova em "Onde" e "Arquivos", a D3–D5 e os limites em "Riscos": `Content-Type` declarado, órfãos; `supabase/README.md`: as três migrações em ordem; `supabase/tests/README.md`: bloco E2 e o modo de simular um envio); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-026 (D3–D5, sabotagens com o teste que cada uma derrubou), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato. A migração vai para o passo do responsável (Tarefa 8).

### Tarefa 4: adaptadores Supabase da Preparação e composição

**Arquivos:**
- Criar: `src/shared/infra/errosSupabase.ts` (+ teste), `src/shared/infra/preparacaoSupabase.ts` (+ teste), `src/shared/infra/armazenamentoSupabase.ts` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-027-e2-adaptadores-preparacao.md`
- Modificar: `src/shared/infra/acessoSupabase.ts` (só `traduzirErro` passa a usar `classificarErro`, sem mudar o comportamento da E1) e `src/shared/infra/acessoSupabase.test.ts` (teste `e1-traduzir-erro-sem-mudanca`), `src/shared/infra/supabase.test.ts` (teste `storage-fora-do-tempo-limite`), `src/app/servicos.ts` (+ teste), `src/app/dependencias.ts` (+ teste), `src/app/servicosFalsos.ts` (`preparacaoVazia()` e `obterPreparacao` em `dependencias()`, para o `typecheck` da tarefa passar: achado I6), `src/app/App.test.tsx` (se precisar do campo novo), `src/shared/infra/README.md`, `src/app/README.md`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// src/shared/infra/errosSupabase.ts
export type MotivoComum = 'duplicado' | 'em_uso' | 'invalido' | 'negado' | 'sessao_expirada' | 'rede' | 'outro'
export function classificarErro(erro: { code?: string; message?: string; name?: string } | null, status?: number): MotivoComum
// ordem: (1) 401, PGRST301, PGRST303 → sessao_expirada (mesmo com 42501); (2) 23505 → duplicado; (3) 23503 → em_uso;
// (4) 23514 ou 22P02 → invalido; (5) 42501 → negado; (6) sem code (ou '') e status 0 → rede (a mesma condição da E1); (7) outro
// traduzirErro (E1) = classificarErro, com em_uso → 'outro' e code 22P02 → 'outro' (o comportamento de hoje)
export function exigirLinhas(data: unknown[] | null): void // vazio → lança ErroDePreparacao('nada_alterado')

// src/shared/infra/preparacaoSupabase.ts
export function criarRepositoriosDePreparacao(cliente: SupabaseClient): Omit<ServicosDePreparacao, 'armazenamento'>

// src/shared/infra/armazenamentoSupabase.ts
export const BUCKET_DE_MIDIAS = 'midias'
export const INATIVIDADE_DO_ENVIO_MS = 30_000
export const VALIDADE_DA_PREVIA_S = 600
export function criarArmazenamentoSupabase(cliente: SupabaseClient, supabaseUrl: string, chavePublica: string, criarXhr: () => XMLHttpRequest = () => new XMLHttpRequest()): ArmazenamentoDeMidia
export function motivoDaResposta(status: number, corpo: string): MotivoDaPreparacao // statusCode do corpo JSON primeiro (como o storage-js, index.mjs:326), depois o status HTTP

// src/app/servicosFalsos.ts (desde esta tarefa; a Tarefa 5 acrescenta criarFalsosDePreparacao)
export function preparacaoVazia(): ServicosDePreparacao // listas vazias; escritas e envio resolvem sem efeito

// src/app/servicos.ts (o cliente de membro passa a ser guardado e reaproveitado)
export function obterServicosDePreparacao(): ServicosDePreparacao // mesmo cliente de obterServicosDeMembro; lança ErroDeConfiguracao como ele
// src/app/dependencias.ts
export interface Dependencias { /* … os da E1 … */ obterPreparacao: () => ServicosDePreparacao } // preguiçoso; só chamado dentro da guarda
```

- [ ] **Passo 1: testes (falham).**
  - `errosSupabase.test.ts`, `traduz-erros-da-preparacao`: a ordem acima, um caso por linha, inclusive `23505` com a constraint `episodios_um_ao_vivo` → `duplicado` e `23503` → `em_uso`; `acessoSupabase.test.ts` (`traduz-erros`) continua passando sem mudança, e o teste novo `e1-traduzir-erro-sem-mudanca` prova que `traduzirErro` dá `outro` para `22P02` e para `23503`, enquanto `classificarErro` dá `invalido` e `em_uso`.
  - `preparacaoSupabase.test.ts`, com o cliente falso no padrão de `acessoSupabase.test.ts` (registra a cadeia `from/select/insert/update/delete/eq/order` e devolve `{ data, error, status }`):

| Teste | O que confere |
|---|---|
| `listar-converte` | `midias`: `select('id, tipo, nome, caminho, mime, tamanho_bytes, enviado_por').order('nome')` → `Midia` em camelCase; `sons` por `ordem`; `cenas` por `ordem`; `episodios` por `data` desc; avisos `eq('episodio_id', id).order('ordem')`; `mapa_gestos` → 7 `LinhaDoMapa`; linha com `tipo` ou `acao` fora do domínio é descartada |
| `episodio-so-titulo-e-data` | `alterar(id, { titulo, data })` chama `update({ titulo, data })` — o objeto tem **exatamente** essas duas chaves (nunca `estado`, `gestos_ligados`, `criado_por`) — `.eq('id', id).select('id')` |
| `gesto-manda-alvos-normalizados` | `alterar({ gesto, acao: 'clipe', cenaId: 'x', somId: null })` → `update({ acao: 'clipe', cena_id: null, som_id: null }).eq('gesto', gesto).select('gesto')` |
| `escrita-com-retorno` | todo `update`/`delete` termina em `.select(<chave>)`; `data: []` → `ErroDePreparacao('nada_alterado')` |
| `registrar-midia` | `insert({ id, tipo, nome, caminho, mime, tamanho_bytes, enviado_por })` com os valores recebidos (sem reconverter) |
| `contar-avisos-com-imagem` | `from('avisos').select('id', { count: 'exact', head: true }).eq('imagem_midia_id', id)` → `count` |
| `erros-traduzidos` | erro `23503` no `remover` de cena → `ErroDePreparacao('em_uso')`; status 401 → `sessao_expirada` |

  - `armazenamentoSupabase.test.ts`, com um `XMLHttpRequest` falso injetado (registra `open`, cabeçalhos, `send`; o teste dispara `upload.onprogress`, `onload` com `status`, `onerror`, `onabort`) e `vi.useFakeTimers()`:

| Teste | O que confere |
|---|---|
| `envio-cabecalhos` | com `supabaseUrl` `https://exemplo.revocast.test/` (barra no fim): `open('POST', 'https://exemplo.revocast.test/storage/v1/object/midias/imagem/<uuid>.png')` (nunca `//storage`); cabeçalhos `authorization: Bearer tok`, `apikey`, `x-upsert: false`, `cache-control: max-age=3600`, `content-type: image/png`; `send(corpo)` com o mesmo `Blob`; caminho com caractere fora de `[a-z0-9/.-]` → lança antes de abrir |
| `envio-token-na-hora` | dois envios seguidos com o mesmo adaptador; `getSession` falso devolve `tok1` no primeiro e `tok2` no segundo | `authorization: Bearer tok1` no primeiro XHR e `Bearer tok2` no segundo; `getSession` chamado 2 vezes |
| `envio-com-progresso` | `onprogress` `{ loaded: 5, total: 10, lengthComputable: true }` → `aoProgredir(0.5)`; `onload` 200 → resolve; `lengthComputable: false` não chama `aoProgredir` |
| `envio-cancelado` | `controller.abort()` → `xhr.abort()` e rejeita `ErroDePreparacao('cancelado')`; sinal já abortado antes → rejeita sem abrir |
| `cancelar-durante-sessao` | `getSession` falso que só resolve quando o teste mandar; `controller.abort()` enquanto ele está pendente; depois resolve a sessão | rejeita `cancelado`; o XHR **nunca** é aberto (`open` não chamado) |
| `envio-solta-ouvinte` | sinal com `addEventListener`/`removeEventListener` espionados (um `AbortController` real com os dois métodos do `signal` envolvidos por `vi.spyOn`), nos quatro fins: sucesso, erro HTTP, `onerror` e corte | `removeEventListener('abort', f)` com a **mesma** função passada a `addEventListener`, 1 vez em cada fim |
| `envio-sem-progresso-corta` | 29 999 ms sem evento → nada; um `onprogress` zera a contagem; 30 000 ms sem evento → `xhr.abort()` e `sem_resposta`; depois de resolver, nenhum timer fica (`vi.getTimerCount() === 0`); um `onload` que chegue depois do corte não muda o resultado (guarda de fim único) |
| `corte-para-no-fim-do-envio` | `upload.onload` disparado; depois 60 000 ms sem nada; depois `onload` 200 | não aborta (nenhum `sem_resposta`); resolve com o `onload`; `vi.getTimerCount() === 0` logo depois do `upload.onload` |
| `envio-respostas` (`test.each` sobre `motivoDaResposta` e pelo XHR) | **o `statusCode` do corpo vem primeiro**: HTTP 400 com corpo `{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}` → `negado`; 400 com `"409"` ("already exists") → `duplicado`; 400 com `"413"` → `invalido`; 400 com `"401"` → `sessao_expirada`; 400 com `"415"` ou `"422"` → `invalido`. **Sem `statusCode` no corpo** (corpo vazio, não JSON ou sem o campo), pelo status HTTP: 401 → `sessao_expirada`; 403 → `negado`; 409 → `duplicado`; 413, 415 e 400 → `invalido`; 500 → `outro`. `onerror` (status 0) → `rede`. Nenhum texto do corpo vai para a mensagem do erro |
| `envio-sem-sessao` | `getSession` sem sessão ou com erro → `ErroDePreparacao('sessao_expirada')` / `rede`, sem abrir o XHR; `console.log`/`warn`/`error` (espionados) nunca recebem o token |
| `remover-e-previa` | `storage.from('midias').remove([caminho])`; erro → `ErroDePreparacao`; `createSignedUrl(caminho, 600)` → a URL; erro → `ErroDePreparacao` |
| `storage-fora-do-tempo-limite` (em `src/shared/infra/supabase.test.ts`) | `limitarRestEAuth(url)('<url>/storage/v1/object/midias/x')` e `('<url>/storage/v1/object/sign/midias/x')` → `false`; controle: `'<url>/rest/v1/midias'` → `true` |

  - `servicos.test.ts`: `obterServicosDeMembro()` e `obterServicosDePreparacao()` na mesma página → **1** `createClient`; configuração inválida → as duas lançam `ErroDeConfiguracao` e nenhum `createClient`.
  - `App.test.tsx`: `caminho-padrao-nao-cria-cliente-em-dispositivo` continua passando com a dependência nova (`obterPreparacao` também é preguiçoso); os testes de tela da E1 continuam passando com `dependencias()` dos falsos devolvendo `obterPreparacao: () => preparacaoVazia()`.
- [ ] **Passo 2:** `npx vitest run src/shared/infra src/app/servicos.test.ts`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Trecho que importa do envio (dentro de `criarArmazenamentoSupabase`, cujos parâmetros são `cliente`, `supabaseUrl`, `chavePublica` e `criarXhr`, este com o padrão `() => new XMLHttpRequest()`):

```ts
const origem = new URL(supabaseUrl).origin // sem barra no fim: nunca `//storage`

async function enviar(caminho: string, corpo: Blob, mime: string, { aoProgredir, sinal }: OpcoesDoEnvio): Promise<void> {
  if (!/^[a-z0-9/.-]+$/.test(caminho)) throw new Error('caminho inválido') // o domínio já gera assim; defesa em profundidade
  if (sinal.aborted) throw new ErroDePreparacao('cancelado')
  const { data, error } = await cliente.auth.getSession() // lido na hora de cada envio
  if (error) throw new ErroDePreparacao('rede')
  const token = data.session?.access_token
  if (!token) throw new ErroDePreparacao('sessao_expirada')
  // A pessoa pode ter cancelado durante o await: o evento 'abort' já passou e o ouvinte abaixo nunca o veria.
  if (sinal.aborted) throw new ErroDePreparacao('cancelado')
  await new Promise<void>((resolver, rejeitar) => {
    const xhr = criarXhr()
    let terminou = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const pararCorte = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const acabar = (erro?: ErroDePreparacao) => {
      if (terminou) return // guarda de fim único: um onload depois do corte ou do cancelamento não muda nada
      terminou = true
      pararCorte()
      sinal.removeEventListener('abort', cancelar)
      if (erro) rejeitar(erro)
      else resolver()
    }
    const cortar = () => {
      xhr.abort()
      acabar(new ErroDePreparacao('sem_resposta'))
    }
    const armarCorte = () => {
      pararCorte()
      timer = setTimeout(cortar, INATIVIDADE_DO_ENVIO_MS)
    }
    function cancelar() {
      xhr.abort()
      acabar(new ErroDePreparacao('cancelado'))
    }
    sinal.addEventListener('abort', cancelar, { once: true })
    xhr.upload.onprogress = (e) => {
      armarCorte()
      if (e.lengthComputable) aoProgredir(e.loaded / e.total)
    }
    xhr.upload.onload = pararCorte // bytes todos enviados: daí em diante, só a resposta, a rede ou o "Cancelar"
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? acabar() : acabar(new ErroDePreparacao(motivoDaResposta(xhr.status, xhr.responseText))))
    xhr.onerror = () => acabar(new ErroDePreparacao('rede'))
    xhr.open('POST', `${origem}/storage/v1/object/${BUCKET_DE_MIDIAS}/${caminho}`)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', chavePublica)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.setRequestHeader('content-type', mime)
    armarCorte()
    xhr.send(corpo)
  })
}

/** statusCode do corpo primeiro (o Storage costuma responder 400 com ele), depois o HTTP; o texto nunca sai daqui. */
export function motivoDaResposta(status: number, corpo: string): MotivoDaPreparacao {
  let codigo = String(status)
  try {
    const json: unknown = JSON.parse(corpo)
    if (json && typeof json === 'object' && 'statusCode' in json && typeof json.statusCode === 'string') codigo = json.statusCode
  } catch {
    /* corpo vazio ou não JSON: fica o status HTTP */
  }
  if (codigo === '401') return 'sessao_expirada'
  if (codigo === '403') return 'negado'
  if (codigo === '409') return 'duplicado'
  if (['400', '413', '415', '422'].includes(codigo)) return 'invalido'
  return 'outro'
}
```

  `servicos.ts` passa a guardar o **cliente** (`obterCliente()` preguiçoso) e monta os dois conjuntos de serviços sobre ele. Rodar os testes. Esperado: todos passam.
- [ ] **Passo 4: sabotagens**, anotando o teste que caiu: mandar o objeto inteiro no `update` de episódio (`update(e)` com `estado`) → `episodio-so-titulo-e-data` falha; tirar o `.select` do `remover` de cena → `escrita-com-retorno` falha; corte por tempo total (sem zerar no progresso) → `envio-sem-progresso-corta` falha; não remover o ouvinte do sinal → `envio-solta-ouvinte` falha; ler o token uma vez na criação do adaptador (ou guardar o do primeiro envio) → `envio-token-na-hora` falha; tirar a segunda conferência do sinal depois do `getSession` → `cancelar-durante-sessao` falha; não parar o corte em `upload.onload` → `corte-para-no-fim-do-envio` falha; ler só o status HTTP → `envio-respostas` (os casos de 400 com `statusCode` no corpo) falha; tirar a guarda de fim único → `envio-sem-progresso-corta` (o `onload` depois do corte) falha; mapear `22P02` para `invalido` também em `traduzirErro` → `e1-traduzir-erro-sem-mudanca` falha; `x-upsert: true` → `envio-cabecalhos` falha; conferir `42501` antes de 401 em `classificarErro` → `traduz-erros-da-preparacao` falha; criar um segundo cliente para a preparação → o teste de 1 `createClient` falha.
- [ ] **Passo 5:** READMEs (`src/shared/infra/`: os três arquivos novos, a D8 e a D10; `src/app/`: composição com o cliente único); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-027 (D8, D10, sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 5: aba Biblioteca

**Arquivos:**
- Criar: `src/app/telas/AbaBiblioteca.tsx`, `src/app/telas/AbaBiblioteca.test.tsx`, `src/shared/ui/BarraDeProgresso.tsx`, registro `docs/verificacoes/AAAA-MM-DD-028-e2-aba-biblioteca.md`
- Modificar: `src/app/servicosFalsos.ts` (`criarFalsosDePreparacao` e `arquivoDeTeste`; `preparacaoVazia` já entrou na Tarefa 4), `src/app/telas/Painel.tsx` (+ teste), `src/shared/styles/base.css`, READMEs de `src/app/`, `src/app/telas/`, `src/shared/ui/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
// src/app/servicosFalsos.ts (só para testes; sem vitest nem Supabase)
export function criarFalsosDePreparacao(inicial?: { midias?: Midia[]; sons?: Som[]; cenas?: Cena[]; episodios?: Episodio[]; avisos?: Aviso[]; mapa?: LinhaDoMapa[]; avisosComImagem?: Record<string, number> }): {
  servicos: ServicosDePreparacao
  chamadas: { enviar: { caminho: string; mime: string }[]; registrar: NovaMidia[]; removerMidia: string[]; removerArquivo: string[]; incluirSom: unknown[][]; alterarSom: unknown[][]; cenas: unknown[][]; episodios: unknown[][]; avisos: unknown[][]; gestos: LinhaDoMapa[] }
  falharProxima(metodo: string, erro: ErroDePreparacao): void
  segurarEnvio(): { progredir(fracao: number): void; concluir(): void } // o envio falso só resolve quando o teste mandar; respeita o AbortSignal (rejeita 'cancelado')
}
export function arquivoDeTeste(tipo: 'png' | 'mp3' | 'html' | 'svg', nome: string, tamanho?: number): File // bytes mágicos + enchimento, em memória
// src/app/telas/AbaBiblioteca.tsx
export function AbaBiblioteca(props: { servicos: ServicosDePreparacao; usuario: UsuarioDaSessao; reavaliar: () => void }): ReactNode
// src/shared/ui/BarraDeProgresso.tsx
export function BarraDeProgresso(props: { fracao: number; rotulo: string }): ReactNode // <progress max={1} value aria-label>
```

  `AbaBiblioteca`: carrega `midias.listar()`, `sons.listar()` e `gestos.listar()` juntos; mostra o **uso** ("123,4 MB de 1 GB", com aviso a partir de 80 %); área de envio com `<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,image/png,image/jpeg,image/webp,image/gif" multiple>` com `<label>` e aceitação de `drop`; cada arquivo vira uma linha da fila (nome de exibição, barra de progresso, "Cancelar"), enviada **uma de cada vez** (o uso é reconferido entre um e outro); lista de **Sons** (rótulo, emoji, volume 0–100 % num `<input type="range">`, "Salvar", prévia `<audio controls preload="none">` com a URL assinada pedida só ao clicar em "Ouvir") e de **Imagens** (miniatura `<img alt={nome}>` pedida ao clicar em "Ver"); "Excluir" com confirmação na linha que diz os usos (D11). Mensagens fixas: `vazio` "Arquivo vazio."; `grande_demais` "Arquivo acima de 50 MB."; `tipo_recusado` "Tipo não aceito. Use MP3, WAV, OGG, M4A, PNG, JPEG, WebP ou GIF."; `sem_espaco` "Sem espaço: o limite grátis é 1 GB."; `cancelado` "Envio cancelado."; `sem_resposta` "O envio parou de avançar e foi interrompido. Tente de novo."; `em_uso` "Este som está ligado a um gesto. Troque o gesto antes de excluir."; `negado`/`nada_alterado` "A biblioteca ou o seu papel mudou; conferindo de novo." + `reavaliar()` + recarga; `sessao_expirada` → `reavaliar()`; `rede`/`outro` "Não foi possível concluir. Tente de novo."; `arquivoFicou` "Excluído da biblioteca; o arquivo ficou no armazenamento." (D6).

- [ ] **Passo 1: testes (falham).** Em `AbaBiblioteca.test.tsx` (renderizada direto, com `criarFalsosDePreparacao` e a sessão de `equipe`), e em `Painel.test.tsx` (`biblioteca-no-painel`: a aba "Biblioteca" mostra a área de envio, sem "Em construção"):

| Teste | Ação | Esperado |
|---|---|---|
| `lista-e-uso` | mídias de 300 e 500 MB (bytes) | "800,0 MB de 1 GB" e o aviso de 80 %; sons e imagens em listas separadas |
| `uso-no-painel` | sem mídias | "0,0 MB de 1 GB", sem aviso |
| `envia-imagem` | `arquivoDeTeste('png', '../../x/foto.png')` no input | `chamadas.enviar[0].caminho` casa com `^imagem/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$` e não contém `foto` nem `..`; `registrar` com `nome: 'foto.png'`; lista recarregada; "Arquivo enviado." |
| `envio-recusado-localmente` | `html` com nome `.png`; `svg`; png de 52 428 801 bytes | as mensagens fixas; `enviar` nunca chamado |
| `progresso-do-envio` | `segurarEnvio()`; `progredir(0.4)` | `<progress>` com `value` 0.4 e rótulo com o nome; `concluir()` → some |
| `cancelar-envio` | `segurarEnvio()`; clicar "Cancelar" | "Envio cancelado."; `registrar` nunca chamado |
| `fila-um-de-cada-vez` | dois arquivos com `segurarEnvio()` | só 1 em `chamadas.enviar` até o primeiro concluir |
| `excluir-som-em-gesto` | som ligado a `Thumb_Up` | a confirmação diz "Usado no gesto 👍" e o botão "Confirmar exclusão" fica desabilitado; nenhuma chamada a `remover` |
| `excluir-imagem-em-aviso` | imagem com `avisosComImagem: 2` | "2 avisos perdem a imagem"; confirmar → `removerMidia` e depois `removerArquivo` |
| `excluir-em-uso-do-banco` | `falharProxima('midias.remover', em_uso)` | a mensagem de `em_uso`; `removerArquivo` vazio |
| `arquivo-ficou` | `falharProxima('armazenamento.remover', rede)` | a mensagem de `arquivoFicou`; a linha some da lista |
| `nome-com-html-literal` | mídia com nome `<img src=x onerror=alert(1)>.png` | texto literal; `container.querySelector('img[src="x"]')` é `null` |
| `previa-so-ao-pedir` | abrir a aba | `urlDePrevia` não chamado; clicar "Ouvir" → 1 chamada e um `<audio>` com a URL |
| `escrita-negada-reavalia` | `falharProxima('sons.alterar', nada_alterado)` | mensagem fixa; `reavaliar` 1 vez; lista recarregada |

- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `BarraDeProgresso.tsx`, `criarFalsosDePreparacao`, `AbaBiblioteca.tsx` (o arquivo é lido com `arquivo.slice(0, BYTES_PARA_DETECTAR).arrayBuffer()`; o `gerarId` é `() => crypto.randomUUID()`; o `AbortController` de cada envio fica num `useRef` e é abortado na desmontagem); `Painel.tsx` passa `dependencias.obterPreparacao()` à aba (obtido uma vez, dentro do conteúdo guardado); estilos `envio`, `envio--arrastando`, `fila`, `lista-de-midias`, `previa` em `base.css`, sem estourar 320 px. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens**, anotando o teste que caiu: chamar `enviar` antes de `conferirArquivo` → `envio-recusado-localmente` falha; enviar em paralelo → `fila-um-de-cada-vez` falha; não abortar ao cancelar (só esconder a linha) → `cancelar-envio` falha (o falso registraria); pedir a URL assinada ao montar → `previa-so-ao-pedir` falha; permitir excluir som em gesto → `excluir-som-em-gesto` falha; não chamar `reavaliar` em `nada_alterado` → `escrita-negada-reavalia` falha.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-028 (D6, D7, D11 na tela; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 6: abas Cenas e Gestos

**Arquivos:**
- Criar: `src/app/telas/AbaCenas.tsx` (+ teste), `src/app/telas/AbaGestos.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-029-e2-cenas-e-gestos.md`
- Modificar: `src/app/telas/Painel.tsx` (+ teste), `src/shared/styles/base.css`, READMEs de `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
export function AbaCenas(props: { servicos: ServicosDePreparacao; reavaliar: () => void }): ReactNode
export function AbaGestos(props: { servicos: ServicosDePreparacao; reavaliar: () => void }): ReactNode
```

  `AbaCenas`: tabela (Ordem, Nome na tela, Nome no OBS, Ações) com "Subir"/"Descer" (`trocarOrdem`, duas escritas; se a segunda falhar, recarrega e avisa), "Editar" na linha e "Excluir" com confirmação que cita os gestos que usam a cena (bloqueia como o som, D11); formulário "Incluir cena" com os dois campos e a dica "Escreva o nome exatamente como está no OBS (maiúsculas e espaços contam)". Mensagens: `nome_vazio` "Dê um nome à cena."; `nome_obs_vazio` "Informe o nome da cena no OBS."; `nome_obs_duplicado` (local ou `duplicado` do banco) "Já existe uma cena com esse nome no OBS."; `em_uso` "Esta cena está ligada a um gesto. Troque o gesto antes de excluir."; demais como na Biblioteca.

  `AbaGestos`: uma linha por gesto (emoji, nome, seletor de ação com os rótulos de `ACOES`, seletor de cena quando a ação é `cena`, seletor de som quando é `som`, "Salvar"); "Som" desabilitado sem sons e "Cena" sem cenas, com o texto da D12; o bloco de sugestões da D12 com o botão "Ligar 👍 ao som aplauso" (grava `{ acao: 'som', somId }`). Mensagens: `falta_som` "Escolha o som."; `falta_cena` "Escolha a cena."; `alvo_inexistente` "Esse alvo não existe mais; a lista foi recarregada." (+ recarga).

- [ ] **Passo 1: testes (falham).** `Painel.test.tsx`: `cenas-e-gestos-no-painel`. `AbaCenas.test.tsx`: `inclui-cena` (nome no OBS com espaço no fim é gravado como digitado; nome na tela com `trim`); `nome-obs-duplicado-local` (nenhuma chamada); `duplicado-do-banco`; `subir-cena` (duas chamadas com as ordens trocadas); `excluir-cena-em-gesto` (confirmação desabilitada e o gesto citado; nenhuma chamada); `em-uso-do-banco`; `cena-com-html-literal`. `AbaGestos.test.tsx`: `sete-linhas` (na ordem de `GESTOS`); `gesto-som-sem-som-na-tela` (ação "Som" sem escolher o som → "Escolha o som."; nenhuma chamada); `som-desabilitado-sem-sons`; `troca-para-cena` (grava `{ acao: 'cena', cenaId, somId: null }`); `troca-para-clipe-zera-alvos` (linha que estava em `som` → grava `somId: null`); `sugestao-liga-aplauso` (som "Aplauso" e `Thumb_Up` em `nenhuma` → botão; clicar grava; o botão some depois da recarga); `alvo-que-sumiu` (`falharProxima('gestos.alterar', invalido)` → recarga e mensagem).
- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar as duas abas e ligá-las no `Painel`; estilos `formulario-em-linha`, `gestos` em `base.css`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** gravar sem `conferirGesto` → `gesto-som-sem-som-na-tela` falha; gravar sem `normalizarGesto` → `troca-para-clipe-zera-alvos` falha; `trim` no nome do OBS → `inclui-cena` falha; permitir excluir cena em gesto → `excluir-cena-em-gesto` falha.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-029 (D11, D12; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 7: aba Episódios e avisos

**Arquivos:**
- Criar: `src/app/telas/AbaEpisodios.tsx` (+ teste), registro `docs/verificacoes/AAAA-MM-DD-030-e2-episodios-e-avisos.md`
- Modificar: `src/app/telas/Painel.tsx` (+ teste), `src/shared/styles/base.css`, READMEs de `src/app/telas/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**

```ts
export function AbaEpisodios(props: { servicos: ServicosDePreparacao; usuario: UsuarioDaSessao; reavaliar: () => void }): ReactNode
```

  Lista de episódios (título, data, estado com rótulo "Rascunho"/"Ao vivo"/"Encerrado"), formulário "Novo episódio" (título, data com `<input type="date">`, padrão hoje), "Abrir" mostra o episódio: título e data editáveis ("Salvar"), "Excluir episódio" só em rascunho (D2; nos outros estados o botão não aparece e o texto diz "Só rascunhos podem ser excluídos"), e os **avisos** em ordem: cartão com título, texto (com quebras de linha por CSS `white-space: pre-line`, nunca HTML), link como `<a href={link} target="_blank" rel="noopener noreferrer">` só se `normalizarLink` aceitar, miniatura da imagem (pedida ao clicar), duração; "Subir"/"Descer", "Editar", "Excluir" com confirmação; formulário de aviso (título, texto em `<textarea>`, link, imagem num seletor com as imagens da Biblioteca ou "Sem imagem", duração em segundos, padrão 10). Nota fixa na aba: "Iniciar e encerrar o ao vivo chegam na etapa E3." Mensagens: `titulo_vazio` "Dê um título."; `titulo_longo` "Título com até 120 caracteres."; `data_invalida` "Data inválida."; `link_invalido` "O link precisa começar com https://."; `duracao_invalida` "Duração entre 1 e 600 segundos."; `imagem_inexistente` "Essa imagem não está mais na Biblioteca." (+ recarga); `duplicado` ao salvar episódio "Já existe um episódio ao vivo." (só se acontecer por fora; a aba não muda estado); demais como nas outras abas.

- [ ] **Passo 1: testes (falham).** `Painel.test.tsx`: `episodios-no-painel` (a aba inicial "Episódios" mostra a lista, sem "Em construção"). `AbaEpisodios.test.tsx`: `cria-episodio` (`incluir({ titulo, data, criadoPor: <id da sessão> })`); `edita-so-titulo-e-data` (`alterar(id, { titulo, data })`, nada mais); `excluir-so-rascunho` (sem botão em `ao_vivo` e `encerrado`; com botão e confirmação em rascunho); `aviso-com-html-literal` (título `<b>x</b>` e texto `<script>alert(1)</script>` aparecem como texto; `container.querySelector('script, b')` é `null`); `link-recusado` (`javascript:alert(1)` e `http://…` → mensagem; nenhuma chamada); `link-aceito-vira-ancora` (`https://revocast.test/inscricao` → `<a>` com `rel="noopener noreferrer"` e `target="_blank"`; link salvo antes por fora como `http://x` → mostrado como texto, sem `<a>`); `aviso-com-imagem` (só imagens no seletor, nenhum som); `ordem-dos-avisos` (subir o segundo → duas chamadas `alterarOrdemDoAviso`); `duracao-padrao-10`; `ao-vivo-fica-para-e3` (nenhum botão "Iniciar"/"Encerrar"; a nota aparece).
- [ ] **Passo 2:** `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar e ligar no `Painel` (com as quatro abas da E2 prontas, só "Ao vivo" continua provisória, "etapa E3"); estilos `avisos`, `aviso-cartao` em `base.css`. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4: sabotagens:** pôr o link no `href` sem `normalizarLink` → `link-aceito-vira-ancora` (caso `http://x` salvo por fora) falha; mostrar exclusão em qualquer estado → `excluir-so-rascunho` falha; mandar o episódio inteiro ao `alterar` → `edita-so-titulo-e-data` falha; listar todas as mídias no seletor de imagem → `aviso-com-imagem` falha.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-030 (D2; sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 8: conferência no navegador e guia do Storage para o responsável

**Arquivos:**
- Modificar: `supabase/README.md` (seção nova "Biblioteca no Storage (E2)", sem reduzir as 134 linhas), `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-031-e2-conferencia-e-guia.md`

- [ ] **Passo 1: conferência no navegador sem Supabase real.** `npm run build` com variáveis de mentira só na linha de comando (`VITE_SUPABASE_URL=https://exemplo.revocast.test`, `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_teste`) e `npm run preview`; com o Chromium do Playwright do ambiente (fora do repositório), interceptando `exemplo.revocast.test` (como na Tarefa 6 do PLA-002): sessão de `equipe` falsa, respostas do PostgREST em memória e o `POST /storage/v1/object/midias/...` respondido devagar (para ver o progresso) e, num segundo caso, nunca respondido (para ver o corte de 30 s). Conferir: enviar um PNG e um MP3 gerados na hora; recusar um `.png` que é HTML; cancelar um envio; o caminho do `POST` nunca leva o nome do arquivo; criar cena, ligar 👍 a um som, criar episódio e aviso com link `https://`; em 320 px e no tema escuro, as quatro abas sem rolagem horizontal da página. Capturas fora do repositório; resultado no registro.
- [ ] **Passo 2:** em `supabase/README.md`, seção "Biblioteca no Storage (E2)" com o passo do responsável abaixo (sem e-mail e sem domínio real), a explicação da D3–D5 e a consulta de conferência.
- [ ] **Passo 3:** oferecer ao responsável, no relato da tarefa, as decisões D1–D13 e os ajustes do DES-001 que elas sugerem (§9: iniciar/encerrar o ao vivo na E3; §8: "sobrescrever arquivos" sem uso; §3/§15: 1 GB = 10⁹), junto com a pendência da D7 do PLA-002; o que ele decidir vira item próprio.
- [ ] **Passo 4:** `npm run check`; registro VER-031 (resultado do Passo 1; estado do passo do responsável); dupla verificação; `npm run check` como último ato; commit; push; relato.
- [ ] **Passo 5: passo do responsável** (fora do código; nenhum agente consegue fazer). Em ordem:
  1. **Pendências anteriores:** se ainda não feitas, a migração de fundação, o primeiro `admin`, a migração `membros_sem_autoalteracao` e a configuração do login (guia "Login Google (E1)" em `supabase/README.md`).
  2. **Banco, no editor SQL do Supabase:** aplicar `supabase/migrations/<AAAAMMDDHHMMSS>_biblioteca_storage.sql` (colar o arquivo inteiro e rodar). Se o editor recusar com `must be owner of table objects`, **não** contornar: anotar a mensagem para o registro seguinte (a Tarefa 2 previu esse caminho; as políticas passam a ser criadas em Storage → Policies com o mesmo texto, decidido num item próprio).
  3. **Conferência por consulta** (no editor SQL): `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'midias';` → `false`, `52428800`, os 8 tipos; `select policyname, cmd, roles from pg_policies where schemaname = 'storage' and tablename = 'objects';` → as três políticas `midias_storage_*`, todas para `{authenticated}`, nenhuma de `update`. Em Storage, o bucket `midias` aparece como **privado**; não criar outras políticas pelo painel.
  4. **Nada de dado pessoal:** não enviar à Biblioteca fotos de pessoas sem autorização; os arquivos de teste podem ser sons e imagens genéricos.
  5. **Conferência real** (anotar o resultado): com uma conta `equipe`, enviar um som e uma imagem; ouvir e ver a prévia; ligar 👍 ao som "aplauso"; tentar excluir esse som (bloqueado); criar uma cena com o nome exato de uma cena do OBS; criar um episódio com dois avisos (um com link `https://` e imagem); conferir o uso em MB; com a conta `apresentadora`, abrir `/painel` → "Sem acesso a esta página" (a aba Biblioteca não existe para ela).

---

## Ao fim da E2

- A equipe prepara um episódio no `/painel`: Biblioteca com envio seguro de sons e imagens (tipos pelos bytes, 50 MB, uso de 1 GB, progresso, cancelamento e corte por inatividade), cenas, mapa de gestos com sugestão de som, episódios e avisos (texto literal, link só `https://`, imagem da Biblioteca, duração e ordem).
- `src/domains/preparacao/` existe com as regras e as portas que a E3 reaproveita (`/controle` e `/obs/palco` leem cenas, sons, avisos e o mapa; o palco lê o bucket pela política `midias_storage_le`).
- **Uma migração nova** (`biblioteca_storage`: bucket e três políticas em `storage.objects`), nenhuma dependência nova; a simulação do Supabase tem `storage`; o `data-api:check` aceita só as políticas de `storage.objects` no formato da D13; um bloco de testes de banco a mais, no mesmo PGlite de `rls.test.ts`.
- Fica para a E3: iniciar/encerrar o ao vivo (com `estudio_estado` e o canal `estudio`), modo teste, `/controle`, `/obs/palco` tocando os sons e mostrando os avisos, pareamento, políticas de `realtime.messages`, aviso de revogação de membro (D4 do PLA-002) e o login anônimo (D5 do PLA-002).
- Pendências conhecidas: objetos órfãos quando a compensação ou a remoção de boa-fé (depois de cancelamento, corte ou erro de rede) falham (D6) e o uso que não os conta (D7); depois de todos os bytes enviados, a espera pela resposta do Storage não tem corte automático (só o "Cancelar" da pessoa); a simulação dá ao dono das migrações mais poder em `storage` do que o real, compensado pela regra de `storage.*` do `data-api:check` (D13); o check não vê os dados de `storage.objects` nem colunas de `storage.buckets` além das quatro conferidas pela regra do bucket, e vê a presença da função de papel nas políticas de `storage.objects`, não o uso (D13); no Supabase, `anon` e `authenticated` têm ALL em `storage.*` e só a RLS protege; o `Content-Type` declarado no Storage (D4); `equipe` ainda consegue, pela API, excluir episódio fora de rascunho e mudar `estado` direto (RLS filtra linhas, não colunas; a E3 decide se o estado passa a mudar só por função); a migração nova e a conferência real do Passo 5 da Tarefa 8, que dependem do responsável; os ajustes do DES-001 (D7 do PLA-002 e Passo 3 da Tarefa 8).
