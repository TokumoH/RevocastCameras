# E1 — Entrada e membros: plano de implementação

> **Para agentes:** execute tarefa por tarefa (superpowers:executing-plans ou superpowers:subagent-driven-development), **sempre sob as regras do `CLAUDE.md`, que prevalecem sobre as dessas skills**, com as decisões vigentes do responsável abaixo: trabalhar direto na `branchTrabalho`, sem worktree e sem criar branch; subagentes implementam e verificam, mas **não** fazem commit, push, merge nem PR e param antes do passo de commit; quem faz o commit local (versão limpa) é o agente principal (`CLAUDE.md`, desde o VER-013), e o push de cada item verificado segue a autorização permanente da decisão (b); `finishing-a-development-branch` não é usada. Os passos usam caixas (`- [ ]`) para acompanhamento.

| Campo | Valor |
|---|---|
| Id | PLA-002 |
| Etapa | E1 do DES-001 |
| Data | 2026-11-26 |
| Usuário responsável | TokumoH |
| Status | em execução, autonomia concedida pelo responsável em 2026-11-26 |

**Objetivo:** a equipe entra. Login Google com PKCE nas rotas de membro, papel lido do banco (`papel_atual()`), telas de entrada, de "fora da lista", de falha e de erro de configuração, guarda por papel em `/painel` e `/controle`, painel vazio com as abas do DES-001 e a aba **Membros** (só `admin`) para incluir, trocar o papel e remover e-mails da lista de acesso; no banco, nenhum `admin` altera nem remove a própria linha da lista.

**Arquitetura:** DDD + GRASP Pure Fabrication + Componentes (DES-001, seção 6). Nasce `src/domains/acesso/` com as regras puras (papéis, e-mail, lista de acesso, avaliação e combinação de estados da sessão, retorno do login) e as **portas** (`ServicoDeAutenticacao`, `RepositorioDeAcesso`), sem importar Supabase nem React. As fabricações puras que falam com o Supabase ficam em `src/shared/infra/acessoSupabase.ts` e implementam as portas. A composição (quem cria o cliente e quando) fica em `src/app/`, que também guarda o estado de tela (`useAcesso`) e as telas. Os testes de interface usam serviços falsos que implementam as portas (e emitem os mesmos eventos que o supabase-js); os adaptadores são testados com um cliente Supabase falso; as regras de banco que a E1 usa, inclusive a migração nova, são testadas em PGlite.

**Tecnologias (a E1 não precisa de dependência nova; regra para quando uma etapa precisar em "Restrições globais"):** React 19.3.1, `@supabase/supabase-js` 2.119.0 (`auth-js` 2.119.0), Vitest 5.1.0, jsdom 31.0.1, `@testing-library/react` 16.3.3 (eventos com `fireEvent`; `@testing-library/user-event` não está instalado e não é necessário), `@electric-sql/pglite` 0.5.16, TypeScript 7.0.2 (com `strict` ligado por padrão nessa versão; conferido em 2026-11-26 com um arquivo de prova fora do repositório).

**Desenho:** [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md), seções 5–10, 12, 13 e 16. **Plano anterior:** [PLA-001](2026-11-17-e0-fundacao.md) ("Ao fim da E0" e Foco da revisão, item 3).

## Decisões vigentes do responsável

- **(a) 2026-11-22:** "Se a gravidade de erros for aceitável, prossiga sem necessidade de refazer dois testes seguidos." Aplicação: achado de texto, documentação, nit ou teste a mais, **sem** tocar segurança, **sem** mudar comportamento de código e **sem** enfraquecer teste → corrigir + reconferência pontual (testes, typecheck ou checagem do que foi tocado), registrada; qualquer outro achado → corrigir e verificar de novo, até duas rodadas seguidas sem erro.
- **(b) 2026-11-26:** "Seja autonomo, pode seguir e me entregar o projeto completo." Dada pelo responsável **em resposta ao pedido de push** e registrada no VER-014 (o registro do commit deste plano). Aplicação:
  - o agente principal segue sem pedir aprovação a cada tarefa;
  - a frase vale como **autorização explícita e permanente para o push de cada item verificado da entrega E1–E6** (`git push origin branchTrabalho`), no lugar do pedido de autorização a cada push que a seção "Branch e Git" do `CLAUDE.md` exige;
  - cada push continua informando o estado: a lista dos commits enviados, em ordem, com hash e resumo, os refeitos e as correções simples que foram junto;
  - o `CLAUDE.md` **não é editado nesta etapa**; se o responsável revogar a autorização, volta a regra do `CLAUDE.md` (pedido de autorização a cada push);
  - continuam proibidos sem pedido explícito do responsável: criar, renomear ou apagar branch; merge; PR; trazer conteúdo de outra branch ou do remoto; descartar trabalho (commit, stash ou alteração não commitada); reescrever commit enviado; fundir commits de itens diferentes.

## Restrições globais

Revistas uma a uma a partir do PLA-001; as que mudaram dizem desde quando.

- Nenhum serviço com cartão; nenhum custo mensal (DES-001, seção 2).
- Banco normalizado; RLS em todas as tabelas; papéis do app conferidos dentro do banco por `papel_atual()` e `dispositivo_atual()` (DES-001, seção 8). **A interface nunca decide acesso a dado**: ela só escolhe o que mostrar; quem nega é a RLS.
- `papel_atual()` só aceita sessão **não anônima**, provedor `google` e `email_confirmed_at` não nulo; e-mail comparado em minúsculas. `dispositivo_atual()` só vale para sessão **anônima**, dispositivo não revogado e `usuario_anonimo_id = auth.uid()`.
- **Privilégios (atualizada; desde o VER-010/VER-011):** a migração inicial tira tudo de `anon`, `authenticated` e `service_role` e dá `grant` explícito, por tabela, só a `authenticated` e só das operações que alguma política permite; nada para `anon`, nada para `service_role`, nada em `codigos_pareamento`. O `data-api:check` acusa `grant` sem política, política sem `grant`, qualquer privilégio de `anon` ou `service_role` e privilégio padrão que dê algo a esses papéis. O PLA-001 (restrições, Tarefa 3) e o DES-001 (§8 "Banco", §13) ainda descrevem a premissa antiga; ver decisão D7.
- **Funções (atualizada; desde o VER-011):** `SECURITY DEFINER`, `set search_path = ''` (vazio, sem outro `SET`), nenhum `EXECUTE` para `PUBLIC`, `anon` e `service_role`, `EXECUTE` para `authenticated`, corpo que chama `public.papel_atual()` ou `public.dispositivo_atual()`. Exceções que não conferem papel: `papel_atual`, `dispositivo_atual`, `criar_perfil_membro`, `parear_dispositivo` (E3). Função de gatilho ligada a tabela criada pelas migrações é `SECURITY INVOKER` (o `rpc:grants-check` recusa `DEFINER` nesse caso). Regras completas em [`scripts/README.md`](../../scripts/README.md). A E1 não cria função.
- `codigos_pareamento`: RLS ativa, **nenhuma** política, `revoke all` (inclusive de `service_role`).
- **Migrações:** migração já aplicada no Supabase **nunca é editada**, nem de passagem numa sabotagem; mudança de banco = migração nova em `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql` (data e hora do commit da tarefa), testada em PGlite, com `rpc:grants-check` e `data-api:check` passando, e acrescentada ao passo do responsável (editor SQL, depois das anteriores). **A E1 tem uma migração nova**, `<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql` (Tarefa 2, decisão D1): só recria as políticas de `update` e `delete` de `membros_permitidos`, sempre `to authenticated`, sem mexer em `grant`. Os testes do banco passam a aplicar **todas** as migrações em ordem de nome (hoje `supabase/tests/banco.ts` importa só a de fundação, de forma estática; a Tarefa 2 troca isso por `import.meta.glob`).
- Rotas por **caminho**: `/entrar`, `/painel`, `/controle`, `/camera`, `/obs/palco`, `/obs/camera`; fragmento `#` reservado ao código de pareamento das rotas de dispositivo. O retorno do login Google vem em `?code=` (PKCE) **na rota de membro de onde a pessoa saiu**; `?error=...` (ou, quando o GoTrue não identifica o fluxo, `#error=...`) no mesmo lugar quando o Google ou o Supabase recusam. O retorno da URL vale **só na primeira avaliação** da página.
- Cliente Supabase com `flowType: 'pkce'` e `storageKey` distinto por tipo de sessão (`revocast-auth-membro` para pessoas). **O cliente de membro só é criado nas rotas de membro** (`/entrar`, `/painel`, `/controle`), de forma preguiçosa e uma vez por página; as rotas de dispositivo nunca o criam, nem pelo caminho padrão (`dependenciasDoNavegador`), provado por teste com `createClient` simulado (Tarefa 4).
- Variáveis públicas: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; opcionais `VITE_TURN_URL`, `VITE_TURN_USUARIO`, `VITE_TURN_SENHA` (não usadas na E1). A mensagem de erro de configuração cita o **nome** da variável, nunca o valor.
- **Dependência npm nova (atualizada em 2026-11-26, pelo coordenador):** permitida só quando a etapa precisar dela de verdade; a E1 **não precisa de nenhuma** e deve continuar assim. Se uma tarefa precisar, a instalação é feita com o npm 11 via `npx -y npm@11` (versão 11.21.2), nunca com o npm 10.9.9 local (o lockfile foi gerado com o npm 11, VER-008; numa cópia, `npx -y npm@11 install --package-lock-only --ignore-scripts` regenerou o lockfile idêntico, com os campos `libc` preservados). Procedimento: (1) versão exata, com `--save-exact --ignore-scripts --before=<data com pelo menos 2 semanas antes>`; (2) conferir o diff do `package-lock.json`: só o pacote e as dependências dele mudam, e os campos `libc` continuam lá; (3) `check-deps-audit` com 0 erros; (4) justificar no registro do item (por que a dependência é necessária e por que não dá para fazer sem ela). `npm ci` e `npm install` direto com o npm 10 continuam proibidos. O Playwright do ambiente serve só para a conferência manual (Tarefa 6) e não vira dependência.
- **Testes sem projeto Supabase real:** interface (jsdom) com serviços falsos que implementam as portas (sem `vi.mock` do supabase-js nos testes de tela, exceto o teste do caminho padrão, que simula `createClient` para contar chamadas); adaptadores com um cliente Supabase falso; regras de banco em PGlite com a simulação do Supabase. Os falsos imitam o que o supabase-js real faz e que muda o comportamento da tela: `sair()` emite a mudança de sessão (como o `SIGNED_OUT` do `signOut`).
- Todo arquivo de teste importa `describe`, `test`, `expect` (e o que mais usar) de `vitest`, sem `globals`; testes de tela com `// @vitest-environment jsdom` na primeira linha e `afterEach(cleanup)`.
- **Segurança de interface:** nada de `innerHTML` nem `dangerouslySetInnerHTML`; texto vindo de fora (nome do Google, e-mail) é sempre texto React; **nunca** mostrar o `error_description` da URL (só mensagens fixas escolhidas pelo código do erro); nunca mostrar mensagem ou pilha de um erro inesperado; nunca registrar token, sessão ou e-mail em `console`.
- O ouvinte de `onAuthStateChange` **nunca** chama o Supabase dentro do próprio callback (o `auth-js` 2.119.0 avisa que isso pode travar o cliente): ele só agenda a reavaliação com `setTimeout(..., 0)`.
- **Redirect URLs do Supabase sem curinga de host:** só o domínio de produção e o localhost (decisão do controlador, achado I1 da revisão do plano). Um curinga como `https://*-<time>.vercel.app/**` deixaria qualquer pessoa criar na Vercel um projeto `x-<time>`, cujo domínio casa com o padrão, começar ela mesma o fluxo de login com o próprio `code_challenge` e mandar o link a um membro: o código volta para o domínio dela, que tem o verificador, e ela toma a sessão (de um `admin`, inclusive). O PKCE não protege um fluxo começado pelo atacante. Para testar o login numa prévia, o responsável acrescenta a URL exata daquela prévia e a tira depois (Tarefa 6).
- Visual: tokens do site do RevoCast (cores `#1b1b22`, `#fffaf4`, `#d83868`, `#27bfe8`, `#d8b888`; fontes Lilita One, Nunito, Caveat; borda 3 px; sombra dura), claro e escuro; estilos novos em `src/shared/styles/base.css`, só com as variáveis de `tokens.css`.
- `erasableSyntaxOnly` está ligado: sem propriedades de parâmetro no construtor (`constructor(readonly x)`), sem `enum` e sem `namespace`; tipos usados só como tipo entram com `import type` (`verbatimModuleSyntax`).
- **Dupla verificação do `CLAUDE.md` em toda tarefa**, antes do commit, com a decisão (a): rodadas de revisão independente sobre a mudança da tarefa (por outra abordagem que não o `npm run check`) até duas seguidas sem erro; sugestões importantes dos revisores entram; o resultado de cada rodada vai para a seção "Verificação" do registro. **Toda sabotagem citada como prova é executada e o teste que ela derruba é anotado no registro**; sabotagem que não derruba nada é achado.
- Processo do repositório: todo diretório novo com `README.md` de 11 seções no mesmo commit; README atualizado no commit que mexe nos arquivos da pasta ("Onde" e campo "Arquivos"); todo commit com registro em `docs/verificacoes/`; `npm run check` com 0 erros sobre exatamente o conteúdo do commit; commit pelo agente principal e push pela decisão (b); branch `branchTrabalho`.
- Nenhum e-mail real ou segredo em arquivo versionado; e-mails de teste no domínio reservado `revocast.test`; nenhum nome de pessoa real nos testes.
- **Âncoras de registros antigos:** nenhum arquivo citado por elas pode ficar menor do que a âncora aponta (o `check-docs` confere). Mínimos dos arquivos que a E1 pode tocar: `CLAUDE.md` 133, `docs/README.md` 78, `docs/planos/README.md` 68, `docs/verificacoes/README.md` 93, `docs/desenho/README.md` 68, o DES-001 394, o PLA-001 315, `scripts/README.md` 97, `scripts/check-docs.mjs` 78, `scripts/check-doc-secrets.mjs` 33, `package.json` 36, `index.html` 19, `tsconfig.json` 25, `vite.config.ts` 13, `.env.example` 11, `.gitignore` 32, `src/main.tsx` 11, `src/app/App.tsx` 27, `src/app/App.test.tsx` 39, `src/app/rotas.ts` 31, `src/app/rotas.test.ts` 22, `src/shared/README.md` 14, `src/shared/infra/README.md` 95, `src/shared/infra/configuracao.ts` 58, `src/shared/infra/configuracao.test.ts` 104, `src/shared/infra/supabase.ts` 29, `src/shared/infra/supabase.test.ts` 73, `src/shared/styles/base.css` 63, `src/shared/styles/tokens.css` 40, `supabase/README.md` 99, `supabase/migrations/README.md` 93, `supabase/tests/README.md` 113, `supabase/tests/banco.ts` 86, `supabase/tests/rls.test.ts` 799, `supabase/tests/matriz.test.ts` 122, `supabase/tests/restricoes.test.ts` 301, `supabase/tests/simulacao-supabase.sql` 28, `supabase/tests/dono-migracao.sql` 41, `supabase/migrations/20261117000000_fundacao.sql` 409 (nunca editada), `scripts/_catalogo.mjs` 663, `scripts/check-rpc-grants.mjs` 82, `scripts/check-data-api.mjs` 181, `scripts/tests/README.md` 63; e este plano, a partir do commit que o introduz, o tamanho com que entrar.
- Datas nos nomes dos registros e da migração: a data do commit (se a execução cair em outro dia, o nome acompanha).

## Decisões sobre lacunas e divergências do desenho (propostas pelo agente sob a decisão (b), D1 decidida pelo controlador; cada uma é registrada no VER da tarefa dona)

**D1. Nenhum `admin` altera nem remove a própria linha, garantido no banco por uma migração nova.** O DES-001 não fala de "último admin". A migração `<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql` (Tarefa 2) recria `membros_permitidos_admin_altera` (update) e `membros_permitidos_admin_apaga` (delete) com a condição a mais `email <> (select lower(auth.jwt() ->> 'email'))`, a mesma forma de e-mail que `papel_atual()` usa (por isso uma sessão com o e-mail em maiúsculas também é barrada). Consequências:
- um `admin` remove ou rebaixa **outro** `admin`, mas nunca a si mesmo, nem pela API;
- como só um `admin` mexe na lista e nenhum mexe em si, sempre sobra ao menos um `admin` no uso normal;
- **limite que sobra:** dois admins que se removem um ao outro **no mesmo instante** (transações concorrentes, cada uma vendo a outra linha ainda lá) podem zerar os admins. A recuperação é o comando do primeiro `admin` em [`supabase/README.md`](../../supabase/README.md), rodado pelo dono no editor SQL;
- a interface também esconde os controles da própria linha e recusa o rebaixamento do último `admin` (defesa em profundidade e mensagem clara).

Conferido numa sonda em PGlite, fora do repositório, em 2026-11-26: com a condição, o `admin` (inclusive com o e-mail em maiúsculas na sessão) apaga e altera 0 linhas da própria linha; apaga outro `admin`; um `delete` sem `where` deixa só a própria linha; o `rpc:grants-check` e o `data-api:check` deram 0 erros sobre as duas migrações.

| Opção | Motivo de descarte |
|---|---|
| Proteção só na interface (a primeira versão deste plano) | Um `admin` com acesso à API tira o próprio acesso; nada no banco prova a regra; o risco era aceito só por ser de disponibilidade, e a política resolve com custo pequeno |
| Gatilho em `membros_permitidos` contando os admins | A função de gatilho em tabela das migrações tem de ser `SECURITY INVOKER` (`rpc:grants-check`), e aí a contagem roda sob a RLS de quem chama, que some quando o `admin` se rebaixa (falso "sem admin"); conferir `papel_atual()` dentro do gatilho muda de valor no meio de um `delete` de várias linhas; sem chamar `papel_atual()`, a função entraria em `SEM_CHAMADA_DE_PAPEL`, mudando o `rpc:grants-check` e a lista de exceções do DES-001 (§8, §13) |
| Gatilho com trava (`pg_advisory_xact_lock`) para fechar também a corrida de dois admins | Herda todos os problemas da linha acima para cobrir um caso raro, com recuperação documentada |
| Condição pelo `id` da sessão (`criado_por`, `membros.id`) | `membros_permitidos` não guarda o `id` de quem é liberado (só o e-mail, DES-001 §7); a junção por e-mail é a mesma de `papel_atual()` |

**D2. Apresentadora na E1.** O DES-001 (§9) dá `/painel` só a `equipe`/`admin`, e `/controle` (apresentadora, equipe, admin) é da E3. Na E1, `/controle` passa a ter a **mesma guarda** de membro (três papéis) e continua com o conteúdo provisório "Em construção — etapa E3"; depois do login, `admin`/`equipe` vão para `/painel` e `apresentadora` para `/controle`. Quem abre uma área sem o papel vê "Sem acesso a esta página" com o link da sua área.

**D3. Quem não está na lista.** O DES-001 pede "mensagem clara se o e-mail não estiver liberado" (§9). A tela mostra o e-mail da conta usada, diz que ele não está na lista de acesso e que um `admin` precisa incluí-lo, encerra a sessão local (`signOut({ scope: 'local' })`) e mantém a mensagem até a pessoa agir (o `SIGNED_OUT` que o próprio `signOut` emite não a apaga; ver "estado fixo" na Tarefa 1); o botão "Entrar com outra conta" refaz o login com `prompt=select_account`. O perfil em `membros` continua existindo (gatilho da E0), sem papel, como o DES-001 §7 prevê.

**D4. Aviso de revogação de membro fica para a E3.** O DES-001 (§8, "Membros" e "Revogação") diz que a aba Membros liga cada e-mail ao `id` da sessão para o aviso de revogação no canal `estudio`. Na E1 não há canal de tempo real nem políticas em `realtime.messages`; a aba mostra a ligação (nome do perfil ou "ainda não entrou"), e a revogação vale **na hora no banco** e na tela na próxima reavaliação (evento de sessão, volta à aba do navegador ou escrita negada). O aviso pelo canal entra na E3.

**D5. Login anônimo do Supabase pode esperar a E3.** O DES-001 (§12, item 1) manda ativar o login anônimo antes da E0. Nenhuma tela da E1 usa sessão anônima; deixá-lo **desligado até a E3** reduz a superfície. Se já estiver ligado, nada quebra: a RLS nega tudo a sessões anônimas sem dispositivo, e o cliente de membro recusa sessão anônima (Tarefa 1).

**D6. Escopo da aba Membros e forma dos repositórios.** Incluir (e-mail + papel), trocar o papel e remover; **sem** editar o e-mail de uma linha (remover e incluir de novo). O DES-001 (§6.1) cita `RepositorioSupabase<T>` "um por agregado"; a E1 cria o repositório do agregado de acesso (`RepositorioDeAcesso`, porta no domínio, adaptador em `shared/infra`) **sem** uma classe genérica, que só nasce se a E2 mostrar repetição real.

**D7. Premissas desatualizadas do PLA-001 e do DES-001 (Riscos do VER-010 e do VER-011) não são editadas na E1.** O PLA-001 é um plano executado e o DES-001 só admite ajustes pequenos aprovados pelo responsável (regra de `docs/desenho/README.md`); nenhuma das duas premissas muda o que a E1 faz. Este plano já carrega as regras atuais (restrições "Privilégios" e "Funções"); a correção do DES-001 continua pendência, oferecida ao responsável no fechamento da E1 (Tarefa 6), junto com a regra da D1 (§7, `membros_permitidos`) e a das Redirect URLs (§12, que já não tem curinga e fica coerente com este plano).

**D8. Abas do painel por estado.** As abas do DES-001 §9 (Episódios, Biblioteca, Cenas, Gestos, Membros, Ao vivo) trocam por estado do componente, sem rota nova; recarregar a página volta para "Episódios". As abas sem conteúdo dizem a etapa em que ficam prontas.

## Foco da revisão

Situações perigosas da E1 que nenhum teste "natural" cobriria; cada uma tem teste na tarefa dona:

1. **Conta Google fora da lista** → mensagem com o e-mail, sessão local encerrada, mensagem continua depois do `SIGNED_OUT` que o próprio `sair` emite, inclusive quando ele chega antes de o `sair` resolver (avaliações serializadas; Tarefa 4, `fora-da-lista-sai-e-mensagem-fica`, `sair-lento-nao-apaga-mensagem`); um `sair` que falha por rede não derruba a avaliação (Tarefa 1, `sair-que-falha-nao-derruba`; Tarefa 3, `sair-sem-rede`); quem entra antes de ser liberado ganha acesso assim que um `admin` o inclui (Tarefa 2, `e1-liberado-depois-de-entrar`).
2. **E-mail com maiúsculas** → incluído em minúsculas (Tarefa 1, `normaliza-email`; Tarefa 5, `inclui-normalizado`); a própria linha do `admin` é reconhecida mesmo com a sessão em maiúsculas, na interface (Tarefa 1, `propria-linha-com-maiusculas`) e no banco (Tarefa 2, `e1-admin-nao-altera-a-si-mesmo`).
3. **Sessão anônima ou de outro provedor no cliente de membro** → nunca vira membro; a sessão é encerrada e o aviso **fica** depois do `SIGNED_OUT` (Tarefa 1, `anonima-nunca-membro`, `provedor-nao-google`, `estado-fixo`; Tarefa 4, `anonima-sai`, `sessao-expirada-fica`, `sair-lento-nao-apaga-mensagem`). No banco, `anonimo-com-email-de-membro` (E0).
4. **Erro de configuração** → `/entrar`, `/painel` e `/controle` mostram "Configuração incompleta" com o nome da variável e sem o valor; erro inesperado ao iniciar mostra uma tela de falha genérica, nunca a página em branco nem o texto do erro; `/camera` e `/obs/*` nem criam o cliente, inclusive pelo caminho padrão (Tarefa 4, `erro-de-configuracao-nomeia-variavel`, `erro-inesperado-ao-iniciar`, `dispositivo-nao-cria-cliente-de-membro`; `App.test.tsx`, `caminho-padrao-nao-cria-cliente-em-dispositivo`). Fecha o item 3 do Foco da revisão do PLA-001.
5. **Troca de papel enquanto logado** → no banco vale na hora (Tarefa 2, `e1-admin-troca-papel-vale-na-hora`, `e1-admin-remove-vale-na-hora`); na tela, a reavaliação acontece em todo evento de sessão, ao voltar à aba e quando uma escrita volta negada ou com 0 linhas (Tarefa 4, `troca-de-papel-ao-voltar`; Tarefa 5, `escrita-negada-reavalia`).
6. **Admin removendo a si mesmo / último admin** → o banco recusa a própria linha e deixa remover outro `admin` (Tarefa 2, `e1-admin-nao-altera-a-si-mesmo`, `e1-admin-remove-outro-admin`, `e1-sempre-sobra-um-admin`); a interface esconde os controles (Tarefa 1, `propria-linha`, `ultimo-admin`; Tarefa 5, `propria-linha-sem-acoes`).
7. **Retorno do OAuth com erro** (`?error=access_denied&error_description=...`, ou `#error=...`) → mensagem fixa, nunca o texto da URL, e a URL é limpa (Tarefa 1, `retorno-com-erro`, `retorno-com-erro-no-fragmento`; Tarefa 4, `erro-do-google-sem-texto-da-url`).
8. **Retorno da URL relido depois de consumido** → "Sair" depois de um login por `?code=` volta à entrada sem aviso; trocar de aba depois de `?error=` não traz o aviso de volta (Tarefa 4, `sair-depois-de-codigo`, `erro-nao-volta-na-troca-de-aba`).
9. **`?code=` que sobrou sem sessão** (o verificador PKCE não está neste navegador, ou o código expirou: o `auth-js` deixa o `code` na URL e segue sem sessão) → "o login não terminou neste navegador" e URL limpa (Tarefa 4, `codigo-sem-sessao`).
10. **Supabase pausado ou sem rede** → tela "Não foi possível falar com o servidor" com "Tentar de novo", sem mandar a pessoa para a entrada nem encerrar a sessão, **tanto ao ler a sessão** (`getSession()` devolve `AuthRetryableFetchError` com a sessão ainda guardada) **quanto ao ler o papel** (Tarefa 1, `falha-ao-ler-sessao`, `falha-de-rede`; Tarefa 3, `usuario-da-sessao-com-erro`; Tarefa 4, `falha-ao-ler-sessao-na-tela`, `falha-e-tentar-de-novo`).
11. **Nome do Google com HTML** → mostrado como texto literal (Tarefa 5, `nome-com-html-literal`).
12. **Redirecionamento aberto** → a URL de retorno do login é montada só a partir da origem da página e de três caminhos fixos; nenhum parâmetro da URL escolhe o destino (Tarefa 4, `url-de-retorno-fixa`); e as Redirect URLs do Supabase não têm curinga de host (restrição global; Tarefa 6).
13. **Ouvinte de sessão que chama o Supabase por dentro** → o adaptador só agenda a reavaliação (Tarefa 3, `aoMudarSessao-adia-e-cancela`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/domains/README.md` | Pasta dos domínios (DDD) | 1 |
| `src/domains/arquitetura.test.ts` | Nenhum arquivo de domínio importa Supabase, React, `shared/` ou `app/` | 1 |
| `src/domains/acesso/README.md` | Domínio Acesso (parte de pessoas; pareamento na E3) | 1 |
| `src/domains/acesso/papeis.ts` (+ teste) | `Papel`, `Area`, `ehPapel`, `podeAbrir`, `areaInicial`, `podeGerenciarMembros`, `ROTULO_DO_PAPEL` | 1 |
| `src/domains/acesso/email.ts` (+ teste) | `normalizarEmail`, `mesmoEmail` | 1 |
| `src/domains/acesso/listaDeAcesso.ts` (+ teste) | `MembroPermitido`, `PerfilDeMembro`, `LinhaDaLista`, `montarLista`, `conferirInclusao`, `conferirMudanca` | 1 |
| `src/domains/acesso/sessao.ts` (+ teste) | `UsuarioDaSessao`, `AvisoDeEntrada`, `EstadoDeAcesso`, `AVISOS_FIXOS`, `combinarEstados` | 1 |
| `src/domains/acesso/retornoDoLogin.ts` (+ teste) | `lerRetornoDoLogin`, `PARAMETROS_DE_RETORNO`, `SEM_RETORNO` | 1 |
| `src/domains/acesso/portas.ts` | `ErroDeAcesso`, `ServicoDeAutenticacao`, `RepositorioDeAcesso`, `ServicosDeMembro` | 1 |
| `src/domains/acesso/resolverAcesso.ts` (+ teste) | Serviço de domínio: sessão + papel → `EstadoDeAcesso` | 1 |
| `supabase/migrations/<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql` | Políticas de update e delete de `membros_permitidos` sem a própria linha | 2 |
| `supabase/tests/banco.ts` | Aplica todas as migrações em ordem de nome (`import.meta.glob`) | 2 |
| `supabase/tests/rls.test.ts` | Bloco `E1 — entrada e lista de acesso` (mesmo PGlite do arquivo) | 2 |
| `supabase/tests/matriz.test.ts` | Células `admin × membros_permitidos × update/delete`: alcance "todas menos a própria linha" | 2 |
| `src/shared/infra/acessoSupabase.ts` (+ teste) | Adaptadores `criarAutenticacaoSupabase`, `criarRepositorioDeAcessoSupabase`, `traduzirErro` | 3 |
| `src/app/servicos.ts` (+ teste) | `ambienteDoVite`, `criarServicosDeMembro`, `obterServicosDeMembro` (composição, cliente único) | 3 |
| `src/app/dependencias.ts` | `Dependencias`, `dependenciasDoNavegador`, `urlDeRetorno`, `caminhoDaArea` | 4 |
| `src/app/useAcesso.ts` | Estado de tela do acesso (avaliações serializadas numa fila; primeira avaliação com o retorno da URL, reavaliações sem ele, entrar, sair) | 4 |
| `src/app/servicosFalsos.ts` | Serviços e dependências falsos para os testes de tela (sem `vitest`, sem Supabase) | 4 |
| `src/app/GuardaDeMembro.tsx` | Guarda por área: carregando, configuração, erro inesperado, falha, entrada, fora da lista, sem acesso, membro | 4 |
| `src/app/telas/EstadosDeAcesso.tsx` | Telas de entrada, fora da lista, sem acesso, falha, erro inesperado, carregando, erro de configuração e cabeçalho do membro | 4 |
| `src/app/telas/Entrar.tsx`, `Controle.tsx` | `/entrar` real; `/controle` guardado (conteúdo da E3 ainda provisório) | 4 |
| `src/app/App.tsx`, `src/main.tsx`, `src/app/App.test.tsx`, `src/app/acesso.test.tsx` | `App({ caminho, dependencias? })`; testes de entrada e guarda | 4 |
| `src/shared/ui/Mensagem.tsx` | Aviso com tom (`info`/`erro`) e papel ARIA (`status`/`alert`) | 4 |
| `src/shared/ui/Abas.tsx` | Abas acessíveis (`tablist`/`tab`/`tabpanel`) | 5 |
| `src/app/telas/Painel.tsx` (+ teste) | Painel com as abas do DES-001 §9; Membros só para `admin` | 4 (guarda), 5 (abas) |
| `src/app/telas/AbaMembros.tsx` (+ teste) | Lista de acesso: incluir, trocar papel, remover | 5 |
| `src/shared/styles/base.css` | Estilos de mensagem, abas, formulário e tabela | 4, 5 |
| `supabase/README.md` | Migração nova em "Onde"; seção "Login Google (E1)": configuração do Auth, do Google e da Vercel | 2, 6 |
| `supabase/migrations/README.md` | Migração nova em "Onde"/"Arquivos" e a regra da D1 | 2 |
| READMEs: `src/`, `src/app/`, `src/app/telas/`, `src/shared/ui/`, `src/shared/infra/`, `src/shared/styles/`, `supabase/tests/` | "Onde", "Arquivos" e o que passa a ser falso | na tarefa que mexe na pasta |

Cada tarefa termina com um commit que leva o seu registro `docs/verificacoes/AAAA-MM-DD-NNN-*.md` (o hook `check-registro` exige). O próprio plano entra antes, no commit do **VER-014** (este plano, a linha nova de `docs/planos/README.md`, o registro, que registra também a decisão (b) e as correções da revisão independente do plano, e a linha dele em `docs/verificacoes/README.md`), e as Tarefas 1 a 6 usam **VER-015 a VER-020** (os números são os próximos livres na hora de cada commit; conferir `docs/verificacoes/README.md` antes). Toda tarefa também modifica `docs/verificacoes/README.md` (linha nova em "Onde", campo "Arquivos" e o número do registro de exemplo da seção "Exemplo", que passa ao próximo livre). Links para o registro da própria tarefa só entram no passo do registro; antes disso a citação fica como texto, para que os `npm run check` intermediários deem 0 erros. O `npm run check` final de cada tarefa roda **depois** de o registro existir e é o último ato antes do commit; depois do commit vem o push (decisão (b)) e o relato do estado (commits enviados, em ordem, com hash e resumo).

O primeiro registro da E1 (VER-015) **abre com a conferência das pendências da E0** (PLA-001, Tarefa 1, Passo 14, e Tarefa 4, Passo 10: deploy de prévia na Vercel, migração aplicada e primeiro `admin` cadastrado), anotando o que o responsável já confirmou e o que continua pendente; nenhum código da E1 depende dessas pendências, só a conferência real da Tarefa 6.

---

### Tarefa 1: domínio Acesso (regras puras e portas)

**Arquivos:**
- Criar: `src/domains/README.md`, `src/domains/arquitetura.test.ts`, `src/domains/acesso/README.md`, `src/domains/acesso/{papeis,email,listaDeAcesso,sessao,retornoDoLogin,portas,resolverAcesso}.ts`, testes `src/domains/acesso/{papeis,email,listaDeAcesso,sessao,retornoDoLogin,resolverAcesso}.test.ts`, registro `docs/verificacoes/AAAA-MM-DD-015-e1-dominio-acesso.md`
- Modificar: `src/README.md` (campo "Arquivos", "Onde" e "Organização" com `domains/`; a frase "novos domínios entram em `src/domains/<domínio>/` quando as etapas E1+ os exigirem" passa ao presente), `docs/verificacoes/README.md`

**Interfaces:**
- Produz (todas exportadas; nenhum import de `react`, `@supabase/*`, `src/shared` ou `src/app`):

```ts
// papeis.ts
export const PAPEIS = ['admin', 'equipe', 'apresentadora'] as const
export type Papel = (typeof PAPEIS)[number]
export type Area = 'painel' | 'controle'
export const ROTULO_DO_PAPEL: Record<Papel, string> // 'Admin', 'Equipe', 'Apresentadora'
export function ehPapel(valor: unknown): valor is Papel
export function podeAbrir(area: Area, papel: Papel): boolean // painel: equipe, admin; controle: os três
export function areaInicial(papel: Papel): Area // apresentadora → controle; demais → painel
export function podeGerenciarMembros(papel: Papel): boolean // só admin

// email.ts
export type ResultadoDoEmail = { ok: true; email: string } | { ok: false; motivo: 'vazio' | 'formato' }
export function normalizarEmail(texto: string): ResultadoDoEmail // trim + minúsculas; ≤ 254; /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function mesmoEmail(a: string | null, b: string | null): boolean // compara em minúsculas; null nunca é igual

// listaDeAcesso.ts
export interface MembroPermitido { email: string; papel: Papel; criadoPor: string | null }
export interface PerfilDeMembro { id: string; email: string; nome: string }
export interface LinhaDaLista { email: string; papel: Papel; nome: string | null; jaEntrou: boolean }
export type Mudanca = { tipo: 'papel'; papel: Papel } | { tipo: 'remover' }
export type Recusa = 'duplicado' | 'inexistente' | 'propria_linha' | 'sem_mudanca' | 'ultimo_admin'
export function montarLista(permitidos: readonly MembroPermitido[], perfis: readonly PerfilDeMembro[]): LinhaDaLista[]
export function conferirInclusao(lista: readonly LinhaDaLista[], email: string): Recusa | null
export function conferirMudanca(lista: readonly LinhaDaLista[], email: string, mudanca: Mudanca, emailDaSessao: string | null): Recusa | null

// sessao.ts
export interface UsuarioDaSessao { id: string; email: string | null; anonimo: boolean; provedor: string | null }
export type AvisoDeEntrada = 'login_cancelado' | 'login_falhou' | 'login_incompleto' | 'sessao_anonima' | 'provedor_invalido' | 'sessao_expirada'
export type EstadoDeAcesso =
  | { tipo: 'carregando' }
  | { tipo: 'sem_sessao'; aviso: AvisoDeEntrada | null }
  | { tipo: 'sem_papel'; email: string | null }
  | { tipo: 'falha' }
  | { tipo: 'membro'; usuario: UsuarioDaSessao; papel: Papel }
/** Avisos que nascem de um sair() do próprio app: o SIGNED_OUT que ele emite não pode apagá-los. */
export const AVISOS_FIXOS: readonly AvisoDeEntrada[] // ['sessao_anonima', 'provedor_invalido', 'sessao_expirada']
/** Estado que fica na tela depois de uma reavaliação automática (evento de sessão ou volta à aba). */
export function combinarEstados(atual: EstadoDeAcesso, novo: EstadoDeAcesso): EstadoDeAcesso

// retornoDoLogin.ts
export const PARAMETROS_DE_RETORNO = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'] as const
export interface RetornoDoLogin { erro: 'cancelado' | 'falha' | null; temCodigo: boolean; sujo: boolean; fragmentoSujo: boolean }
export function lerRetornoDoLogin(busca: string, fragmento: string): RetornoDoLogin // fragmento = location.hash (só rotas de membro)
export const SEM_RETORNO: RetornoDoLogin // { erro: null, temCodigo: false, sujo: false, fragmentoSujo: false }

// portas.ts
export type MotivoDoErro = 'duplicado' | 'invalido' | 'negado' | 'nada_alterado' | 'sessao_expirada' | 'rede' | 'outro'
export class ErroDeAcesso extends Error { readonly motivo: MotivoDoErro } // name = 'ErroDeAcesso'; a mensagem não leva e-mail
export interface ServicoDeAutenticacao {
  usuarioAtual(): Promise<UsuarioDaSessao | null> // erro ao ler a sessão → lança ErroDeAcesso('rede')
  aoMudarSessao(ouvinte: () => void): () => void // devolve a função que cancela
  entrarComGoogle(urlDeRetorno: string): Promise<void>
  sair(): Promise<void> // nunca lança; emite a mudança de sessão (SIGNED_OUT), como o supabase-js, antes de resolver
}
export interface RepositorioDeAcesso {
  papelAtual(): Promise<Papel | null>
  listarPermitidos(): Promise<MembroPermitido[]>
  listarPerfis(): Promise<PerfilDeMembro[]>
  incluir(email: string, papel: Papel, criadoPor: string): Promise<void>
  alterarPapel(email: string, papel: Papel): Promise<void> // 0 linhas → ErroDeAcesso('nada_alterado')
  remover(email: string): Promise<void> // 0 linhas → ErroDeAcesso('nada_alterado')
}
export interface ServicosDeMembro { auth: ServicoDeAutenticacao; repo: RepositorioDeAcesso }

// resolverAcesso.ts
export async function resolverAcesso(servicos: ServicosDeMembro, retorno: RetornoDoLogin): Promise<EstadoDeAcesso>
```

- [ ] **Passo 1: testes das regras (falham).** Em `papeis.test.ts`, `email.test.ts`, `listaDeAcesso.test.ts`, `sessao.test.ts` e `retornoDoLogin.test.ts` (nomes dos testes entre crases são os citados no Foco da revisão):

```ts
// papeis.test.ts
test.each([
  ['painel', 'admin', true], ['painel', 'equipe', true], ['painel', 'apresentadora', false],
  ['controle', 'admin', true], ['controle', 'equipe', true], ['controle', 'apresentadora', true],
] as const)('podeAbrir(%s, %s) → %s', (area, papel, esperado) => {
  expect(podeAbrir(area, papel)).toBe(esperado)
})
test('areaInicial e quem gerencia membros', () => {
  expect(areaInicial('apresentadora')).toBe('controle')
  expect(areaInicial('equipe')).toBe('painel')
  expect(areaInicial('admin')).toBe('painel')
  expect(PAPEIS.filter(podeGerenciarMembros)).toEqual(['admin'])
})
test('ehPapel só aceita os três valores exatos', () => {
  for (const v of ['admin', 'equipe', 'apresentadora']) expect(ehPapel(v)).toBe(true)
  for (const v of ['ADMIN', 'Admin', ' admin', 'toString', 'constructor', '', null, undefined, 1, {}]) expect(ehPapel(v)).toBe(false)
})

// email.test.ts
test('normaliza-email', () => {
  expect(normalizarEmail('  Nova@Revocast.TEST ')).toEqual({ ok: true, email: 'nova@revocast.test' })
})
test('recusa vazio e formato inválido', () => {
  expect(normalizarEmail('   ')).toEqual({ ok: false, motivo: 'vazio' })
  for (const t of ['sem-arroba', 'a@b', 'a b@revocast.test', 'a@@revocast.test', '@revocast.test', 'a@revocast.test.', `${'a'.repeat(250)}@revocast.test`]) {
    expect(normalizarEmail(t), t).toEqual({ ok: false, motivo: 'formato' })
  }
})
test('mesmoEmail ignora caixa e recusa null', () => {
  expect(mesmoEmail('Adm@Revocast.TEST', 'adm@revocast.test')).toBe(true)
  expect(mesmoEmail(null, 'adm@revocast.test')).toBe(false)
  expect(mesmoEmail(null, null)).toBe(false)
})
```

  Em `listaDeAcesso.test.ts`, sobre uma lista com `adm@revocast.test` (admin, perfil "Adm"), `ana@revocast.test` (equipe, perfil "Ana") e `bia@revocast.test` (apresentadora, sem perfil):
  - `monta-lista`: `montarLista` liga perfil por e-mail (`nome` e `jaEntrou`), sem perfil → `nome: null`, `jaEntrou: false`; ordem por papel (`admin`, `equipe`, `apresentadora`) e depois por e-mail; perfil sem linha na lista não aparece.
  - `duplicado`: `conferirInclusao(lista, 'ana@revocast.test')` → `'duplicado'`; e-mail novo → `null`.
  - `propria-linha`: `conferirMudanca(lista, 'adm@revocast.test', { tipo: 'remover' }, 'adm@revocast.test')` → `'propria_linha'`; o mesmo para `{ tipo: 'papel', papel: 'equipe' }`.
  - `propria-linha-com-maiusculas`: sessão `'Adm@Revocast.TEST'` → `'propria_linha'`.
  - `ultimo-admin`: com a sessão **fora** da lista (lista antiga na tela), remover ou rebaixar `adm` → `'ultimo_admin'`; com um segundo admin `adm2@revocast.test` na lista, rebaixar `adm2` com a sessão `adm` → `null`.
  - `sem-mudanca` e `inexistente`: trocar `ana` para `equipe` → `'sem_mudanca'`; e-mail fora da lista → `'inexistente'`. Ordem de conferência: `inexistente`, `propria_linha`, `sem_mudanca`, `ultimo_admin`.

  Em `sessao.test.ts`, `estado-fixo` (regra de `combinarEstados`; um estado é **fixo** quando é `sem_papel` ou `sem_sessao` com aviso em `AVISOS_FIXOS`):

| `atual` | `novo` | Resultado |
|---|---|---|
| `sem_papel` | `sem_sessao` sem aviso | `atual` (o `SIGNED_OUT` do `sair` da D3 não apaga a mensagem) |
| `sem_sessao` com `sessao_anonima`, `provedor_invalido` ou `sessao_expirada` | `sem_sessao` sem aviso | `atual` |
| fixo (qualquer um dos acima) | `falha` | `atual` (a pessoa já está fora; a falha da reavaliação automática não troca a mensagem) |
| fixo | `membro` | `novo` (entrou em outra aba) |
| fixo | `sem_papel` ou `sem_sessao` com outro aviso | `novo` |
| `sem_sessao` com `login_cancelado`, `login_falhou` ou `login_incompleto` | `sem_sessao` sem aviso | `novo` (aviso do retorno da URL é de uma vez só) |
| `membro` | qualquer | `novo` |
| `carregando` | qualquer | `novo` |

  As ações da pessoa (Entrar, Sair, Tentar de novo, Entrar com outra conta) não passam por `combinarEstados`: definem o estado direto (Tarefa 4).

  Em `retornoDoLogin.test.ts`:
  - `retorno-com-erro`: `lerRetornoDoLogin('?error=access_denied&error_code=x&error_description=Ligue+para+tal+n%C3%BAmero', '')` → `{ erro: 'cancelado', temCodigo: false, sujo: true, fragmentoSujo: false }`; `?error=server_error` → `erro: 'falha'`; só `?error_description=x` → `erro: 'falha'`.
  - `retorno-com-erro-no-fragmento`: `('', '#error=access_denied&error_description=x')` → `{ erro: 'cancelado', sujo: false, fragmentoSujo: true, temCodigo: false }`; `('', '#error_code=500')` → `erro: 'falha'`, `fragmentoSujo: true`; `('', '#qualquer')` → `SEM_RETORNO`.
  - `retorno-com-codigo`: `('?code=abc', '')` → `{ erro: null, temCodigo: true, sujo: true, fragmentoSujo: false }`; `('', '')` e `('?aba=membros', '')` → `SEM_RETORNO`.
- [ ] **Passo 2:** rodar `npx vitest run src/domains`. Esperado: FAIL (módulos inexistentes).
- [ ] **Passo 3:** implementar `papeis.ts`, `email.ts`, `listaDeAcesso.ts`, `sessao.ts`, `retornoDoLogin.ts` e `portas.ts`. `ehPapel` usa `(PAPEIS as readonly string[]).includes(valor)` depois de `typeof valor === 'string'` (nada de `in`, que aceitaria `toString`). `ErroDeAcesso` declara o campo e o atribui no construtor (sem propriedade de parâmetro, por causa do `erasableSyntaxOnly`):

```ts
export class ErroDeAcesso extends Error {
  readonly motivo: MotivoDoErro
  constructor(motivo: MotivoDoErro) {
    super(`Erro de acesso: ${motivo}`)
    this.name = 'ErroDeAcesso'
    this.motivo = motivo
  }
}
```

- [ ] **Passo 4:** rodar os testes do Passo 1. Esperado: todos passam.
- [ ] **Passo 5: testes do serviço de domínio (falham).** Em `resolverAcesso.test.ts`, com serviços falsos escritos no próprio arquivo (objetos que implementam as portas e contam as chamadas de `sair` e `papelAtual`):

| Teste | Situação | Esperado |
|---|---|---|
| `sem-sessao` | `usuarioAtual()` → `null`, `SEM_RETORNO` | `{ tipo: 'sem_sessao', aviso: null }`; `papelAtual` não é chamado |
| `cancelado-no-google` | sem sessão, `erro: 'cancelado'` / `erro: 'falha'` | aviso `login_cancelado` / `login_falhou` |
| `codigo-sem-sessao` | sem sessão, `temCodigo: true` | aviso `login_incompleto` |
| `falha-ao-ler-sessao` | `usuarioAtual()` lança `ErroDeAcesso('rede')` (e, em outro caso, um `Error` qualquer) | `{ tipo: 'falha' }`; `sair` e `papelAtual` **não** chamados |
| `anonima-nunca-membro` | usuário com `anonimo: true`, e-mail de membro, provedor `google`, e `papelAtual` falso devolvendo `'admin'` | `sem_sessao` com aviso `sessao_anonima`; `sair` chamado 1 vez; `papelAtual` **não** chamado |
| `provedor-nao-google` | `anonimo: false`, provedor `email` | aviso `provedor_invalido`; `sair` 1 vez; `papelAtual` não chamado |
| `fora-da-lista` | Google, `papelAtual` → `null` | `{ tipo: 'sem_papel', email: <e-mail da sessão> }`; `sair` 1 vez |
| `membro` | Google, `papelAtual` → `'equipe'` | `{ tipo: 'membro', papel: 'equipe', usuario }`; `sair` não chamado |
| `falha-de-rede` | `papelAtual` lança `ErroDeAcesso('rede')` (e, em outro caso, um `Error` qualquer) | `{ tipo: 'falha' }`; `sair` **não** chamado |
| `sessao-expirada` | `papelAtual` lança `ErroDeAcesso('sessao_expirada')` | aviso `sessao_expirada`; `sair` 1 vez |
| `sair-que-falha-nao-derruba` | `sair()` falso que **rejeita** (`Error('sem rede')`), nos casos fora da lista, anônima e sessão expirada | os mesmos resultados (`sem_papel` com o e-mail; aviso `sessao_anonima`; aviso `sessao_expirada`); `resolverAcesso` resolve, não rejeita |

  O filtro de papel desconhecido (texto fora de `PAPEIS` vindo do banco) é provado no adaptador (Tarefa 3, `papel-atual`); o domínio só recebe `Papel | null`.
- [ ] **Passo 6:** implementar `resolverAcesso` exatamente nesta ordem: `usuarioAtual()` em `try` (qualquer erro → `falha`) → nulo: aviso pelo retorno (`cancelado` → `login_cancelado`, `falha` → `login_falhou`, senão `temCodigo` → `login_incompleto`, senão `null`) → anônimo (`sair`, `sessao_anonima`) → provedor diferente de `google` (`sair`, `provedor_invalido`) → `papelAtual()` em `try`: `ErroDeAcesso('sessao_expirada')` → `sair` + aviso; qualquer outro erro → `falha` → nulo → `sair` + `sem_papel` → papel → `membro`. Todo `sair` aqui passa por um auxiliar `sairSemFalhar` (`try { await auth.sair() } catch { /* a sessão local já saiu ou sai na próxima leitura; o estado decidido vale */ }`), porque a porta promete não lançar, mas o domínio não depende disso. Rodar os testes. Esperado: todos passam.
- [ ] **Passo 7: teste de arquitetura.** `src/domains/arquitetura.test.ts` lê todos os `.ts` de `src/domains` com `import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true })` (tipado por `vite/client`) e confere que nenhum arquivo que não termina em `.test.ts` tem `from 'react'`, `from '@supabase/`, `/shared/` ou `/app/` num `import`. Sabotagem: acrescentar temporariamente `import type { SupabaseClient } from '@supabase/supabase-js'` em `portas.ts` → o teste falha citando o arquivo; desfazer com o Edit inverso.
- [ ] **Passo 8:** sabotagens nas regras, uma de cada vez, desfazendo depois de cada uma (anotar no registro o teste que caiu): tirar o `toLowerCase` de `normalizarEmail` → `normaliza-email` falha; comparar a própria linha com `===` em vez de `mesmoEmail` → `propria-linha-com-maiusculas` falha; tirar a conferência de anônimo de `resolverAcesso` → `anonima-nunca-membro` falha; tirar o `try` de `usuarioAtual` → `falha-ao-ler-sessao` falha; chamar `auth.sair()` direto em vez de `sairSemFalhar` → `sair-que-falha-nao-derruba` falha; trocar `ehPapel` por `typeof valor === 'string'` → o teste de `ehPapel` falha; fazer `combinarEstados` proteger só `sem_papel` → `estado-fixo` falha.
- [ ] **Passo 9:** READMEs de `src/domains/` e `src/domains/acesso/` (11 seções; em "Lógica", um diagrama das portas: domínio ← adaptadores de `shared/infra` ← composição em `app/`); atualizar `src/README.md`; `npm run check`. Esperado: 0 erros.
- [ ] **Passo 10:** registro VER-015 (abre com as pendências da E0, como dito acima; inclui as decisões D3, D6 e as sabotagens dos Passos 7 e 8), com a linha nova em `docs/verificacoes/README.md`; dupla verificação com a decisão (a); `npm run check` como **último ato**; commit local; push; relato do estado.

### Tarefa 2: migração `membros_sem_autoalteracao` e testes de banco da E1

**Arquivos:**
- Criar: `supabase/migrations/<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql`, registro `docs/verificacoes/AAAA-MM-DD-016-e1-banco-membros.md`
- Modificar: `supabase/tests/banco.ts` (todas as migrações, em ordem), `supabase/tests/rls.test.ts` (bloco novo no fim do arquivo, sem mexer nos testes existentes), `supabase/tests/matriz.test.ts` (alcance das duas células da D1), `supabase/tests/README.md`, `supabase/migrations/README.md`, `supabase/README.md` ("Onde": a lista de migrações), `docs/verificacoes/README.md`

**Interfaces:**
- Consome: a migração de fundação (nunca editada) e a simulação do Supabase da E0.
- Produz (banco): as políticas `membros_permitidos_admin_altera` e `membros_permitidos_admin_apaga` com a condição `(select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email'))` (no `using` e, na de update, também no `with check`). Nenhum `grant` muda; nenhuma função nova.
- Produz (testes): `criarBanco()` aplica, como `postgres_sim`, todos os arquivos de `supabase/migrations/*.sql` em ordem de nome.

- [ ] **Passo 1: `banco.ts` aplica todas as migrações.** Trocar o `import migracao from '../migrations/20261117000000_fundacao.sql?raw'` por:

```ts
// Todas as migrações, em ordem de nome (o prefixo AAAAMMDDHHMMSS é a ordem de aplicação, como na Supabase CLI).
const MIGRACOES: { arquivo: string; sql: string }[] = Object.entries(
  import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([caminho, sql]) => ({ arquivo: caminho.slice(caminho.lastIndexOf('/') + 1), sql }))
```

  e, dentro de `criarBanco`, `for (const { sql } of MIGRACOES) await db.exec(sql)` no lugar do `db.exec(migracao)` (o nome do arquivo fica à mão para as sabotagens do Passo 6, que mexem num arquivo só), sem mudar o resto (dono `postgres_sim`, `aplicarMigracao`, `exporTabelasNovas`). Manter as 86 linhas mínimas. Rodar `npm test`. Esperado: tudo passa como antes (só existe a migração de fundação).
- [ ] **Passo 2: testes de banco da E1 (os de proteção falham).** Acrescentar ao fim de `supabase/tests/rls.test.ts` um `describe('E1 — entrada e lista de acesso', ...)` que usa o mesmo banco e as mesmas transações do arquivo (nenhum PGlite a mais na CI). Os comandos são o SQL equivalente ao que o adaptador manda pela Data API:

| Teste | Sessão | Ação | Esperado |
|---|---|---|---|
| `e1-papel-de-cada-sessao` | ana, bia, adm; estranho cadastrado e confirmado no teste | `select public.papel_atual()` | `equipe`, `apresentadora`, `admin`, `null` |
| `e1-admin-troca-papel-vale-na-hora` | adm, depois ana | adm: `update public.membros_permitidos set papel = 'apresentadora' where email = <ana> returning email`; ana: `papel_atual()` e `insert` em `cenas` | 1 linha; ana passa a `apresentadora` e o insert dá `new row violates row-level security policy for table "cenas"` (controle: o mesmo insert antes da troca é aceito) |
| `e1-admin-remove-vale-na-hora` | adm, depois ana | adm: `delete ... where email = <ana> returning email`; ana: `papel_atual()` e `select` em `cenas` | 1 linha; ana `null` e 0 linhas; o perfil dela continua em `membros` (contado como superusuário) |
| `e1-liberado-depois-de-entrar` | estranho (cadastrado: o gatilho cria o perfil), depois adm | estranho: `papel_atual()`; adm: `insert (email, papel, criado_por) values (<estranho>, 'equipe', <uid do adm>)`; estranho: `papel_atual()` | `null`; aceito; `equipe` |
| `e1-equipe-nao-escreve-na-lista` | ana | (1) `update ... set papel = 'admin' where email = <ana> returning email` e `delete ... where email = <bia> returning email`; (2) **sem `where` e sem `returning`**: `update public.membros_permitidos set papel = 'apresentadora'` e `delete from public.membros_permitidos` | (1) 0 linhas, sem erro (o caso `nada_alterado` do adaptador); (2) sem erro; nos dois, o retrato da tabela (e-mail e papel das 3 linhas, como superusuário) é o mesmo de antes. O item (2) é o que pega uma política de escrita afrouxada: com `where` ou `returning`, o comando também passa pela política de **leitura** (só `admin`), que esconderia o afrouxamento (Passo 6) |
| `e1-admin-nao-altera-a-si-mesmo` | adm, com o e-mail da sessão como semeado e, de novo, em maiúsculas (`Adm@Revocast.TEST`) | `update ... set papel = 'equipe' where email = <adm> returning email`; `delete ... where email = <adm> returning email` | 0 linhas nos dois, sem erro; `papel_atual()` continua `admin`; a linha continua igual (superusuário) |
| `e1-admin-remove-outro-admin` | adm; `adm2@revocast.test` inserido como `admin` e cadastrado e confirmado no teste (como superusuário) | adm: `update ... set papel = 'equipe' where email = <adm2> returning email`; depois `delete ... where email = <adm2> returning email` | 1 linha em cada; `papel_atual()` do adm2 passa a `equipe` e depois a `null` |
| `e1-sempre-sobra-um-admin` | adm (único admin semeado) | `delete from public.membros_permitidos` (sem `where`) | sem erro; sobra exatamente a linha do adm (superusuário); `papel_atual()` do adm continua `admin` |

  Os e-mails vêm das constantes de `banco.ts` (o `adm2` é um literal do domínio `revocast.test` no próprio teste, com `uid` fixo novo). Rodar `npx vitest run supabase/tests/rls.test.ts`. Esperado: FAIL em `e1-admin-nao-altera-a-si-mesmo` e `e1-sempre-sobra-um-admin` (sem a migração nova, o `admin` apaga a si mesmo); os outros passam já, porque documentam o comportamento da E0 de que a E1 depende.
- [ ] **Passo 3: migração.** `supabase/migrations/<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql`, com o cabeçalho de comentários no padrão da de fundação (o que faz, DES-001 §8, PLA-002 D1, "nunca editada depois de aplicada"; texto sem e-mail):

```sql
-- Nenhum admin altera nem remove a própria linha da lista de acesso (PLA-002, decisão D1).
-- A comparação de e-mail é a mesma de public.papel_atual() (minúsculas). Um admin continua alterando e
-- removendo outros admins; como nenhum mexe em si, sempre sobra ao menos um (exceto se dois admins se
-- removerem um ao outro no mesmo instante; recuperação: supabase/README.md).
-- Entre o drop e o create a tabela fica sem política de update/delete, o que nega (falha fechada).
drop policy membros_permitidos_admin_altera on public.membros_permitidos;
drop policy membros_permitidos_admin_apaga on public.membros_permitidos;

create policy membros_permitidos_admin_altera on public.membros_permitidos
  for update to authenticated
  using ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')))
  with check ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')));
create policy membros_permitidos_admin_apaga on public.membros_permitidos
  for delete to authenticated
  using ((select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email')));
```

  O `with check` também impede trocar o e-mail de outra linha pelo próprio. Rodar `npx vitest run supabase/tests/rls.test.ts`. Esperado: todos passam.
- [ ] **Passo 4: matriz.** Rodar `npx vitest run supabase/tests/matriz.test.ts`. Esperado antes do ajuste: FAIL só nas células `membros_permitidos × adm × update` e `× delete`, porque o "alcance total" ("no update, nenhuma linha sobra igual; no delete, a tabela esvazia") deixa de valer para a própria linha. Ajuste: um mapa `PROPRIA_LINHA_INTOCADA = { membros_permitidos: { adm: EMAIL_ADM } }` ao lado de `RECORTES`; nessas duas células, o permitido passa a ser "toda linha muda (update) ou some (delete), **exceto** a linha `email = EMAIL_ADM`, que fica idêntica" (conferido pelo `x::text` da tabela temporária `antes_celula`, como hoje). Justificativa, num comentário junto ao mapa e no topo do arquivo: DES-001 §8 ("`admin` lê e escreve `membros_permitidos`") com a regra nova da D1 (PLA-002), decidida pelo controlador; a célula continua pegando uma política que prenda o `admin` às "próprias linhas" (`criado_por`), porque as demais linhas, inclusive a de `criado_por = adm`, têm de mudar. Nenhuma outra célula muda. Rodar a matriz. Esperado: todos passam.
- [ ] **Passo 5:** `npm run rpc:grants-check` e `npm run data-api:check`. Esperado: 0 erros, "2 migração(ões)" (políticas só `to authenticated`; `grant` de `update` e `delete` continua com política correspondente). Já conferido na sonda de 2026-11-26.
- [ ] **Passo 6: sabotagens em memória** (a migração aplicada nunca é editada, nem de passagem; nada de `git checkout`, que descartaria trabalho). Cada sabotagem é uma edição temporária de `supabase/tests/banco.ts`, dentro do laço do Passo 1 e só para o arquivo alvo:

```ts
for (const { arquivo, sql } of MIGRACOES) {
  const alvo = arquivo.endsWith('_membros_sem_autoalteracao.sql') // ou '20261117000000_fundacao.sql'
  const ocorrencias = alvo ? sql.split(TRECHO).length - 1 : 0
  if (alvo && ocorrencias === 0) throw new Error(`sabotagem sem efeito: trecho ausente em ${arquivo}`)
  if (alvo) console.log(`sabotagem: ${ocorrencias} ocorrência(s) trocada(s) em ${arquivo}`)
  await db.exec(alvo ? sql.replaceAll(TRECHO, SABOTADO) : sql)
}
```

  Sempre `replaceAll` (um `replace` trocaria só a primeira ocorrência: nas duas primeiras sabotagens, a política de delete ficaria intacta, e `e1-sempre-sobra-um-admin` e a célula de delete não cairiam, um falso achado); a contagem impressa é conferida contra a esperada abaixo e anotada no registro. **Conferência de que nenhuma migração mudou** (a migração nova ainda não está commitada, e `git diff` não enxerga arquivo não rastreado): antes da primeira sabotagem, guardar `git status --porcelain supabase/migrations` e `sha256sum supabase/migrations/*.sql`; depois de desfazer a última com o Edit inverso, os dois comandos têm de dar exatamente a mesma saída (o mesmo vale para `banco.ts`: o `sha256sum` dele depois de desfeita a última sabotagem é igual ao de antes da primeira). Uma de cada vez, anotando no registro o teste que caiu:
  - na migração nova, `TRECHO` = `(select public.papel_atual()) = 'admin' and email <> (select lower(auth.jwt() ->> 'email'))` → `SABOTADO` = `(select public.papel_atual()) is not null`; **3 ocorrências** (using e with check do update, using do delete) → **`e1-equipe-nao-escreve-na-lista` falha** no item (2): o `update` sem `where` da ana muda o papel das 3 linhas e o `delete` sem `where` esvazia a tabela. Provado na sonda de 2026-11-26: com essa sabotagem, o `update ... where ... returning` da ana devolve `[]` e não muda nada (por isso o item (1) sozinho não prova), mas o `update` sem `where` deixou as 3 linhas como `apresentadora` e o `delete` sem `where` esvaziou a tabela;
  - na migração nova, `TRECHO` = ` and email <> (select lower(auth.jwt() ->> 'email'))` → `SABOTADO` = `''`; **3 ocorrências** → `e1-admin-nao-altera-a-si-mesmo` e `e1-sempre-sobra-um-admin` falham, e as duas células da matriz também;
  - na migração nova, `TRECHO` = `lower(auth.jwt() ->> 'email')` → `SABOTADO` = `auth.jwt() ->> 'email'`; **3 ocorrências** → a variante em maiúsculas de `e1-admin-nao-altera-a-si-mesmo` falha;
  - na migração de fundação, `TRECHO` = `lower(auth.jwt() ->> 'email')` → `SABOTADO` = `auth.jwt() ->> 'email'`; **1 ocorrência** (a junção de `papel_atual()`; conferido com `grep -c` em 2026-11-26) → `email-com-maiusculas` (E0) falha.
- [ ] **Passo 7:** READMEs: `supabase/migrations/README.md` (migração nova em "Onde" e "Arquivos"; a regra da D1 e o limite da corrida em "Riscos"), `supabase/README.md` ("Onde": as duas migrações; aplicar sempre em ordem; a recuperação do último admin aponta para o comando do primeiro `admin`), `supabase/tests/README.md` (`banco.ts` com todas as migrações; bloco E1; o mapa `PROPRIA_LINHA_INTOCADA` da matriz); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 8:** registro VER-016 (inclui a D1 com a tabela de alternativas, a D4, o ajuste da matriz com a justificativa e as sabotagens com o teste que cada uma derrubou), com a linha nova em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato. A migração vai para o passo do responsável (Tarefa 6).

### Tarefa 3: adaptadores Supabase e composição

**Arquivos:**
- Criar: `src/shared/infra/acessoSupabase.ts`, `src/shared/infra/acessoSupabase.test.ts`, `src/app/servicos.ts`, `src/app/servicos.test.ts`, registro `docs/verificacoes/AAAA-MM-DD-017-e1-adaptadores-acesso.md`
- Modificar: `src/shared/infra/README.md`, `src/app/README.md`, `docs/verificacoes/README.md`

**Interfaces:**
- Consome: portas e tipos da Tarefa 1; `lerConfiguracao`, `ErroDeConfiguracao` e `criarClienteSupabase` da E0.
- Produz:

```ts
// src/shared/infra/acessoSupabase.ts
export function traduzirErro(erro: { code?: string; message?: string } | null, status?: number): ErroDeAcesso
export function criarAutenticacaoSupabase(cliente: SupabaseClient): ServicoDeAutenticacao
export function criarRepositorioDeAcessoSupabase(cliente: SupabaseClient): RepositorioDeAcesso

// src/app/servicos.ts
export function ambienteDoVite(): Record<string, string | undefined> // só as duas variáveis do Supabase, lidas de import.meta.env uma a uma
export function criarServicosDeMembro(env: Record<string, string | undefined>): ServicosDeMembro // lança ErroDeConfiguracao
export function obterServicosDeMembro(): ServicosDeMembro // cria uma vez por página (cache em módulo); sem cache se a configuração falhar
```

- [ ] **Passo 1: testes do adaptador (falham).** Em `acessoSupabase.test.ts`, um cliente falso escrito no arquivo (`as unknown as SupabaseClient`), que registra cada chamada da cadeia (`from`, `select`, `insert`, `update`, `delete`, `eq`, `order`, `rpc`) e devolve a resposta configurada (`{ data, error, status }`):

| Teste | O que confere |
|---|---|
| `usuario-da-sessao` | `getSession()` com `user: { id, email, is_anonymous: false, app_metadata: { provider: 'google' } }` → `{ id, email, anonimo: false, provedor: 'google' }`; sem sessão → `null`; `is_anonymous` ausente → `anonimo: false`; `app_metadata` sem `provider` → `provedor: null` |
| `usuario-da-sessao-com-erro` | `getSession()` devolve `{ data: { session: null }, error: <erro com name 'AuthRetryableFetchError'> }` (o que o `auth-js` 2.119.0 faz com a sessão expirada e a rede caída, mantendo a sessão guardada) → lança `ErroDeAcesso('rede')`, **não** devolve `null`; qualquer outro `error` → também `ErroDeAcesso('rede')` |
| `entrar-com-google` | `signInWithOAuth` recebe exatamente `{ provider: 'google', options: { redirectTo: 'https://app.revocast.test/painel', queryParams: { prompt: 'select_account' } } }`; erro devolvido → `ErroDeAcesso('rede')` |
| `sair-local` | `signOut` recebe `{ scope: 'local' }` |
| `sair-sem-rede` | `signOut` devolve `{ error: <erro com name 'AuthRetryableFetchError'> }` e, em outro caso, **lança** → `sair()` resolve nos dois (não lança); `console.warn` (espionado) recebe só o texto fixo "sair: o servidor não confirmou a saída; a sessão local foi apagada", sem e-mail, token nem o objeto de erro. Motivo: no `auth-js` 2.119.0, `signOut({ scope: 'local' })` apaga a sessão local **antes** do `POST /logout` (e também quando o refresh falha por rede, `AuthRetryableFetchError`); o erro que volta é só da revogação no servidor |
| `aoMudarSessao-adia-e-cancela` | com `vi.useFakeTimers()`: o callback registrado em `onAuthStateChange` **não** chama o ouvinte de forma síncrona; depois de `vi.runAllTimers()`, chama 1 vez; o evento `INITIAL_SESSION` não chama (a primeira avaliação é do `useAcesso`); `SIGNED_IN`, `SIGNED_OUT` e `TOKEN_REFRESHED` chamam; a função devolvida chama `subscription.unsubscribe()` |
| `papel-atual` | `rpc('papel_atual')` sem argumentos; `data: 'admin'` → `'admin'`; `data: null` → `null`; `data: 'superadmin'` → `null` (filtro `ehPapel`) |
| `listar` | `from('membros_permitidos').select('email, papel, criado_por').order('email')` → `MembroPermitido[]` com `criadoPor`; `from('membros').select('id, email, nome').order('email')` → `PerfilDeMembro[]`; papel desconhecido numa linha → linha descartada |
| `incluir` | `insert({ email, papel, criado_por })` com os valores recebidos (o adaptador **não** normaliza: quem normaliza é o domínio, e o banco recusa maiúsculas por `CHECK`) |
| `alterar-e-remover-com-retorno` | `update({ papel }).eq('email', e).select('email')` e `delete().eq('email', e).select('email')`; `data: []` → `ErroDeAcesso('nada_alterado')` (a RLS filtrou: papel mudou, linha sumiu ou é a própria linha, D1); `data: [{ email }]` → resolve |
| `traduz-erros` | **a ordem vale:** (1) status 401, ou código `PGRST301`/`PGRST303` → `sessao_expirada`, mesmo quando o código é `42501` (o PostgREST devolve `42501` com 401 quando a requisição sai como `anon`, por exemplo com a sessão apagada em outra aba); (2) `23505` → `duplicado`; (3) `23514` → `invalido`; (4) `42501` com status diferente de 401 → `negado`; (5) erro sem `code` ou com `code: ''` e status 0 (falha do `fetch` no `postgrest-js`) → `rede`; (6) outro → `outro`. A mensagem do `ErroDeAcesso` não contém o e-mail enviado |

- [ ] **Passo 2:** rodar `npx vitest run src/shared/infra/acessoSupabase.test.ts`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Trechos que importam:

```ts
async usuarioAtual() {
  const { data, error } = await cliente.auth.getSession()
  // Com a rede caída o auth-js devolve session: null E error, mas a sessão continua guardada:
  // tratar como "sem sessão" mandaria um membro para a entrada (Foco da revisão, item 10).
  if (error) throw new ErroDeAcesso('rede')
  const u = data.session?.user
  if (!u) return null
  return { id: u.id, email: u.email ?? null, anonimo: u.is_anonymous === true, provedor: u.app_metadata?.provider ?? null }
},
async sair() {
  // scope 'local': o auth-js apaga a sessão deste navegador antes de pedir a revogação ao servidor; um erro
  // aqui (sem rede, por exemplo) é só da revogação. Não lança: quem chama já decidiu o estado da tela.
  try {
    const { error } = await cliente.auth.signOut({ scope: 'local' })
    if (error) console.warn(AVISO_SAIR)
  } catch {
    console.warn(AVISO_SAIR)
  }
},
aoMudarSessao(ouvinte) {
  const { data } = cliente.auth.onAuthStateChange((evento) => {
    if (evento === 'INITIAL_SESSION') return
    // Nunca chamar o Supabase dentro deste callback (o auth-js pode travar): só agenda.
    setTimeout(ouvinte, 0)
  })
  return () => data.subscription.unsubscribe()
},
async alterarPapel(email, papel) {
  const { data, error, status } = await cliente.from('membros_permitidos').update({ papel }).eq('email', email).select('email')
  if (error) throw traduzirErro(error, status)
  if (!data || data.length === 0) throw new ErroDeAcesso('nada_alterado') // RLS filtrou
},
```

  `AVISO_SAIR` é uma constante do módulo com o texto fixo do teste `sair-sem-rede`. O `select('email')` depois de `update`/`delete` vira `RETURNING`; ele exige política de leitura, que o `admin` tem (`membros_permitidos_admin_le`). Rodar os testes. Esperado: todos passam.
- [ ] **Passo 4: testes da composição (falham).** Em `src/app/servicos.test.ts`, com `vi.mock('@supabase/supabase-js', () => ({ createClient }))` como em `supabase.test.ts` da E0: `criarServicosDeMembro({})` lança `ErroDeConfiguracao` citando `VITE_SUPABASE_URL` e **não** chama `createClient`; com as duas variáveis válidas, chama `createClient` 1 vez com `storageKey: 'revocast-auth-membro'` e `detectSessionInUrl: true` e devolve `auth` e `repo`; `ambienteDoVite()` devolve só as chaves `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (nunca `DEV`, `MODE` ou outra). O cache de `obterServicosDeMembro` é conferido com `vi.resetModules()` e `vi.stubEnv` (duas chamadas → 1 `createClient`; configuração inválida → lança nas duas e nenhum `createClient`).
- [ ] **Passo 5:** implementar `servicos.ts` e rodar os testes. Esperado: todos passam.
- [ ] **Passo 6:** sabotagens, uma de cada vez, anotando o teste que caiu: tirar o `.select('email')` do `remover` → `alterar-e-remover-com-retorno` falha; tirar o `setTimeout` do `aoMudarSessao` → `aoMudarSessao-adia-e-cancela` falha; devolver `null` quando `getSession` tem `error` → `usuario-da-sessao-com-erro` falha; conferir `42501` antes do status 401 → `traduz-erros` falha; deixar o `sair` lançar o erro do `signOut` → `sair-sem-rede` falha.
- [ ] **Passo 7:** atualizar `src/shared/infra/README.md` e `src/app/README.md` ("Onde", "Arquivos"); `npm run check`. Esperado: 0 erros.
- [ ] **Passo 8:** registro VER-017, com a linha nova em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 4: entrada, guarda por papel e telas de erro

**Arquivos:**
- Criar: `src/app/dependencias.ts`, `src/app/useAcesso.ts`, `src/app/servicosFalsos.ts`, `src/app/GuardaDeMembro.tsx`, `src/app/acesso.test.tsx`, `src/app/telas/EstadosDeAcesso.tsx`, `src/shared/ui/Mensagem.tsx`, registro `docs/verificacoes/AAAA-MM-DD-018-e1-entrada-e-guarda.md`
- Modificar: `src/app/App.tsx`, `src/main.tsx`, `src/app/App.test.tsx`, `src/app/telas/Entrar.tsx`, `src/app/telas/Controle.tsx`, `src/app/telas/Painel.tsx` (só passa a ser guardado; as abas são da Tarefa 5), `src/shared/styles/base.css`, READMEs de `src/app/`, `src/app/telas/`, `src/shared/ui/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**
- Consome: Tarefas 1 e 3.
- Produz:

```ts
// src/app/dependencias.ts
export interface Dependencias {
  obterServicos: () => ServicosDeMembro // lança ErroDeConfiguracao; só chamado em rota de membro
  navegar: (caminho: string) => void
  origem: string // window.location.origin
  busca: string // window.location.search
  fragmento: string // window.location.hash
  limparRetornoDaUrl: (retorno: RetornoDoLogin) => void // apaga PARAMETROS_DE_RETORNO da busca e, se fragmentoSujo, o fragmento, com history.replaceState
  aoVoltarAVer: (ouvinte: () => void) => () => void // visibilitychange → visible
}
export function caminhoDaArea(area: Area): '/painel' | '/controle'
export function urlDeRetorno(origem: string, area: Area | null): string // origem + '/painel' | '/controle' | '/entrar'
export function dependenciasDoNavegador(): Dependencias // não cria o cliente: obterServicos é preguiçoso

// src/app/useAcesso.ts
export type EstadoDaTela = EstadoDeAcesso | { tipo: 'erro_de_configuracao'; mensagem: string } | { tipo: 'erro_inesperado' }
export function useAcesso(dep: Dependencias): {
  estado: EstadoDaTela
  servicos: ServicosDeMembro | null
  reavaliar: () => void // reavaliação automática: SEM_RETORNO + combinarEstados
  tentarDeNovo: () => void // ação da pessoa: SEM_RETORNO, define o estado direto
  entrar: (area: Area | null) => void
  sair: () => void
}

// src/app/GuardaDeMembro.tsx
export function GuardaDeMembro(props: {
  area: Area
  titulo: string
  dependencias: Dependencias
  children: (membro: { usuario: UsuarioDaSessao; papel: Papel; servicos: ServicosDeMembro; reavaliar: () => void }) => ReactNode
}): ReactNode

// src/app/App.tsx
export function App({ caminho, dependencias }: { caminho: string; dependencias?: Dependencias })

// src/shared/ui/Mensagem.tsx
export function Mensagem({ tom, children }: { tom: 'info' | 'erro'; children: ReactNode }) // erro → role="alert"; info → role="status"

// src/app/servicosFalsos.ts (só para testes; não importa vitest nem Supabase)
export function usuarioGoogle(email: string, id?: string): UsuarioDaSessao
export function criarFalsos(inicial?: {
  usuario?: UsuarioDaSessao | null | ErroDeAcesso
  papel?: Papel | null | ErroDeAcesso
  permitidos?: MembroPermitido[]
  perfis?: PerfilDeMembro[]
}): {
  servicos: ServicosDeMembro
  dependencias: (extra?: Partial<Dependencias>) => Dependencias
  chamadas: { usuarioAtual: number; entrar: string[]; sair: number; obterServicos: number; navegar: string[]; limpar: RetornoDoLogin[]; incluir: unknown[][]; alterar: unknown[][]; remover: string[] }
  definirUsuario(u: UsuarioDaSessao | null | ErroDeAcesso): void
  definirPapel(p: Papel | null | ErroDeAcesso): void
  segurarSair(): void // a partir daqui, sair() emite a mudança de sessão e só resolve quando liberarSair() for chamado
  liberarSair(): void
  falharProxima(metodo: 'incluir' | 'alterarPapel' | 'remover' | 'listarPermitidos', erro: ErroDeAcesso): void
  dispararMudancaDeSessao(): void
  dispararVolta(): void
}
```

  O `sair()` dos falsos imita o supabase-js real, **inclusive na ordem**: na sonda da segunda revisão (2026-11-26), `signOut({ scope: 'local' })` emitiu `SIGNED_OUT` e o `setTimeout(0)` do ouvinte disparou em 57 ms, mas o `signOut` só resolveu em 357 ms, depois do `POST /auth/v1/logout`. Por isso o falso põe o usuário em `null`, soma em `chamadas.sair`, chama `dispararMudancaDeSessao()` numa microtarefa (`queueMicrotask`) e **só resolve depois**, num `setTimeout(0)`; com `segurarSair()`, só resolve quando o teste chamar `liberarSair()` (a espera do `/logout`). `chamadas.usuarioAtual` conta as avaliações, para os testes esperarem a reavaliação terminar (`await waitFor(() => expect(f.chamadas.usuarioAtual).toBe(n))`) antes de conferir a tela.

  Comportamento de `useAcesso`:
  - no primeiro efeito, chama `dep.obterServicos()` dentro de `try`: `ErroDeConfiguracao` → `erro_de_configuracao` com `e.message`; **qualquer outro erro → `erro_inesperado`** (tela de falha genérica, sem mostrar o erro; nada de página em branco);
  - lê `lerRetornoDoLogin(dep.busca, dep.fragmento)` **uma vez**; a **primeira** avaliação é a única que recebe esse retorno; toda reavaliação seguinte (evento de sessão, volta à aba, "Tentar de novo", escrita negada) usa `SEM_RETORNO`. Assim, um `SIGNED_OUT` depois de um login por `?code=` não mostra "o login não terminou", e o aviso de `?error=` não volta a cada troca de aba;
  - **só depois** de resolvida a primeira avaliação chama `dep.limparRetornoDaUrl(retorno)` se `retorno.sujo || retorno.fragmentoSujo` (o `auth-js` lê a URL de forma síncrona ao criar o cliente e, com sucesso, já tira o `code`; limpar antes da troca do código quebraria o login);
  - assina `auth.aoMudarSessao(reavaliar)` e `dep.aoVoltarAVer(reavaliar)` e cancela as duas na desmontagem;
  - **as avaliações são serializadas** (achado I-A da segunda revisão): uma promessa encadeada guardada num `useRef` (`fila.current = fila.current.then(() => avaliar(tipo)).catch(() => undefined)`) faz cada avaliação começar só depois de a anterior terminar e aplicar o seu resultado. Uma reavaliação pedida durante outra (por exemplo, a do `SIGNED_OUT` que o `sair()` de dentro do `resolverAcesso` emite antes de resolver) espera, roda depois e passa por `combinarEstados(atual, novo)` (Tarefa 1); assim `sem_papel` e os avisos fixos ficam. **Não há mais a regra "o resultado de uma avaliação antiga é descartado"**: com ela, a avaliação do `SIGNED_OUT` terminava primeiro, a que trazia `sem_papel` era descartada e a mensagem sumia (simulação do revisor, nos dois modos de emissão). Descartar só quando uma avaliação mais nova já aplicou também não basta (falha no modo real, mesma sonda). Detalhes: `tipo` é `primeira` (com o retorno da URL, aplicada direto), `automatica` (`SEM_RETORNO` + `combinarEstados`) ou `acao` (`SEM_RETORNO`, aplicada direto); um `ativo` em `useRef`, posto em `false` na desmontagem, impede aplicar resultado depois de desmontar; as ações da pessoa também entram na fila, e não há fusão de pedidos repetidos (no pior caso, uma leitura a mais de sessão e papel);
  - `entrar(area)` chama `auth.entrarComGoogle(urlDeRetorno(dep.origem, area))` (erro → `falha`); `sair()` entra na fila: chama `auth.sair()` (que não lança) e define `sem_sessao` sem aviso (o `SIGNED_OUT`, emitido antes de o `sair` resolver, já pediu uma reavaliação, que roda depois e dá o mesmo estado); `tentarDeNovo()` reavalia com `SEM_RETORNO` e define o resultado direto.

  Telas (`EstadosDeAcesso.tsx`), todas dentro de `<main className="tela">` com `Cartao` e `Logo`, título `<h1>`:
  - **Carregando:** "Conferindo seu acesso…" (`role="status"`).
  - **Configuração incompleta** (cartão rosa): `<h1>Configuração incompleta</h1>`, a mensagem do `ErroDeConfiguracao` (que só cita o nome da variável) e a frase "Quem cuida do deploy precisa preencher as variáveis do Supabase (veja `.env.example`)."
  - **Erro inesperado** (cartão rosa): `<h1>Não foi possível abrir esta página</h1>`, "Recarregue a página. Se continuar, avise a equipe." (nenhum texto do erro).
  - **Entrada:** título da rota, `Mensagem` do aviso (quando houver) e o botão "Entrar com Google". Textos fixos dos avisos: `login_cancelado` "O login com o Google foi cancelado."; `login_falhou` "O Google não concluiu o login. Tente de novo."; `login_incompleto` "O login não terminou neste navegador. Tente de novo por aqui."; `sessao_anonima` "Esta sessão não é de membro. Entre com a sua conta Google."; `provedor_invalido` "Entre com a conta Google cadastrada pela equipe."; `sessao_expirada` "Sua sessão expirou. Entre de novo."
  - **Fora da lista** (cartão rosa): `<h1>Acesso não liberado</h1>`, "O e-mail {email} não está na lista de acesso do RevoCast. Peça a um admin para incluí-lo." e o botão "Entrar com outra conta".
  - **Sem acesso:** `<h1>Sem acesso a esta página</h1>`, "Seu papel ({ROTULO_DO_PAPEL}) não abre esta área." e o link para `caminhoDaArea(areaInicial(papel))`.
  - **Falha:** `<h1>Não foi possível falar com o servidor</h1>`, "O projeto pode estar pausado ou a rede caiu." e o botão "Tentar de novo" (chama `tentarDeNovo`).
  - **Cabeçalho do membro** (acima do conteúdo da área): e-mail, rótulo do papel e o botão "Sair".

- [ ] **Passo 1: testes de entrada e guarda (falham).** Em `src/app/acesso.test.tsx` (`// @vitest-environment jsdom`, `afterEach(cleanup)`), todos com `criarFalsos()` e `render(<App caminho=... dependencias={f.dependencias({ origem: 'https://app.revocast.test', busca: ..., fragmento: ... })} />)`; esperas com `await screen.findBy...` e, depois de eventos, `waitFor` sobre `chamadas.usuarioAtual`:

| Teste | Situação | Esperado |
|---|---|---|
| `erro-de-configuracao-nomeia-variavel` | `obterServicos` lança `new ErroDeConfiguracao('Variável de ambiente ausente ou vazia: VITE_SUPABASE_URL')`, nas rotas `/entrar`, `/painel` e `/controle` | heading "Configuração incompleta" e o texto com `VITE_SUPABASE_URL`; nenhum botão "Entrar com Google" |
| `erro-inesperado-ao-iniciar` | `obterServicos` lança `new Error('detalhe interno')` | heading "Não foi possível abrir esta página"; `queryByText(/detalhe interno/)` é `null`; a página não fica vazia |
| `dispositivo-nao-cria-cliente-de-membro` | `/camera`, `/obs/palco`, `/obs/camera`, `/xyz` | `chamadas.obterServicos === 0`; as telas provisórias continuam |
| `sem-sessao-mostra-entrada` | `/painel` sem usuário | botão "Entrar com Google"; clicar → `chamadas.entrar` = `['https://app.revocast.test/painel']` |
| `url-de-retorno-fixa` | `/entrar?volta=https://outro.revocast.test/x` e `/controle?next=//outro.revocast.test` | `entrar` recebe só `https://app.revocast.test/entrar` e `https://app.revocast.test/controle` |
| `entrar-leva-a-area-do-papel` | `/entrar` com `admin`, `equipe`, `apresentadora` | `navegar` com `/painel`, `/painel`, `/controle` |
| `fora-da-lista-sai-e-mensagem-fica` | `/painel`, usuário `estranho@revocast.test`, papel `null` | heading "Acesso não liberado" com o e-mail; `chamadas.sair === 1`; depois da reavaliação disparada pelo próprio `sair` (`usuarioAtual === 2`), a mensagem continua; "Entrar com outra conta" → `entrar` com a URL de `/painel` |
| `anonima-sai` | usuário `{ anonimo: true, email: 'ana@revocast.test', provedor: 'google' }` e papel falso `admin` | aviso "Esta sessão não é de membro…"; `sair === 1`; depois da reavaliação do `SIGNED_OUT` (`usuarioAtual === 2`) o aviso **continua**; nenhuma aba do painel. Com o código antigo (só `sem_papel` protegido), este teste falha (sabotagem do Passo 5) |
| `sessao-expirada-fica` | papel lança `ErroDeAcesso('sessao_expirada')` | "Sua sessão expirou. Entre de novo."; `sair === 1`; continua depois da reavaliação (`usuarioAtual === 2`) |
| `sair-lento-nao-apaga-mensagem` | `segurarSair()`; três casos: `/painel` com `estranho@revocast.test` e papel `null`; usuário anônimo; papel lançando `ErroDeAcesso('sessao_expirada')` | esperar `chamadas.sair === 1` (o `SIGNED_OUT` já foi emitido e a reavaliação dele já foi pedida, mas o `sair` ainda não resolveu); conferir que `chamadas.usuarioAtual` continua 1 (a reavaliação espera na fila); `liberarSair()`; esperar `usuarioAtual === 2`; a tela mostra "Acesso não liberado" com o e-mail / "Esta sessão não é de membro…" / "Sua sessão expirou…". Com o desenho antigo (avaliações em paralelo e descarte da antiga), a reavaliação do `SIGNED_OUT` termina antes, a primeira é descartada e a tela cai na entrada sem aviso: o teste falha (sabotagem do Passo 5) |
| `erro-do-google-sem-texto-da-url` | `/entrar?error=access_denied&error_description=Ligue%20para%20o%20suporte`; e, em outro caso, `fragmento: '#error=access_denied&error_description=Ligue%20para%20o%20suporte'` | "O login com o Google foi cancelado."; `queryByText(/Ligue para o suporte/)` é `null`; `chamadas.limpar` tem 1 item (com `sujo` ou `fragmentoSujo`, conforme o caso) |
| `erro-nao-volta-na-troca-de-aba` | `/entrar?error=access_denied`; depois `dispararVolta()` | primeiro "O login com o Google foi cancelado."; depois da reavaliação (`usuarioAtual === 2`), o aviso some e o botão "Entrar com Google" continua |
| `codigo-sem-sessao` | `/painel?code=abc` sem usuário | "O login não terminou neste navegador…"; `limpar` com 1 item |
| `sair-depois-de-codigo` | `/painel?code=abc` com membro `equipe`; clique em "Sair" | `sair === 1`; depois da reavaliação do `SIGNED_OUT` (`usuarioAtual === 2`), tela de entrada **sem** aviso (`queryByText(/não terminou/)` é `null`) |
| `limpa-depois-de-resolver` | `/painel?code=abc` com membro, e `papelAtual` falso que só resolve quando o teste mandar | `limpar` vazio enquanto pendente; 1 item depois |
| `sem-acesso-por-papel` | `/painel` com `apresentadora` | heading "Sem acesso a esta página"; link para `/controle` |
| `troca-de-papel-ao-voltar` | `/painel` com `equipe`; `definirPapel('apresentadora')` e `dispararVolta()`; depois `definirPapel(null)` e `dispararVolta()` | primeiro "Sem acesso a esta página"; depois "Acesso não liberado" e `sair === 1` |
| `falha-ao-ler-sessao-na-tela` | `usuario` = `new ErroDeAcesso('rede')` | "Não foi possível falar com o servidor"; nenhum botão "Entrar com Google"; `sair === 0` |
| `falha-e-tentar-de-novo` | papel lança `ErroDeAcesso('rede')`; depois `definirPapel('equipe')` e clique em "Tentar de novo" | "Não foi possível falar com o servidor"; `sair === 0`; depois o painel do membro |
| `controle-guardado` | `/controle` com `apresentadora` | cabeçalho com o e-mail e "Apresentadora"; "Em construção — etapa E3" |
| `sair` | membro em `/painel`, clique em "Sair" | `sair === 1`; botão "Entrar com Google" |

  `fora-da-lista-sai-e-mensagem-fica`, `anonima-sai`, `sessao-expirada-fica` e `troca-de-papel-ao-voltar` rodam com o `sair()` padrão do falso, que emite a mudança de sessão antes de resolver, como o supabase-js real; a segunda revisão mostrou que os quatro falhariam com o desenho antigo, e a sabotagem do Passo 5 confere isso de novo.

  Em `src/app/App.test.tsx` (mantendo no mínimo 39 linhas):
  - o teste da tela de controle e o `test.each` das 7 rotas passam a usar `criarFalsos({ usuario: usuarioGoogle('ana@revocast.test'), papel: 'equipe' })` nas rotas de membro e conferem o heading (o título de `resolverRota`), o `document.title` e o logo; nas rotas de dispositivo e em `/xyz`, a frase provisória continua igual; `/entrar` com membro chama `navegar` (o heading continua "Entrar" enquanto a navegação não acontece no jsdom);
  - `caminho-padrao-nao-cria-cliente-em-dispositivo` (achado I6): com `vi.mock('@supabase/supabase-js', () => ({ createClient }))`, em que o `createClient` simulado devolve um cliente mínimo (`auth.getSession` → sem sessão, `auth.onAuthStateChange` → `{ data: { subscription: { unsubscribe() {} } } }`), e `vi.stubEnv` com as duas variáveis válidas; para cada rota, `vi.resetModules()`, `import('./App')` de novo e `render(<App caminho=... />)` **sem** `dependencias` (o caminho padrão, `dependenciasDoNavegador`): `/camera`, `/obs/palco`, `/obs/camera` e `/xyz` → `createClient` chamado **0** vezes; controle positivo: `/painel` → 1 vez, com `storageKey: 'revocast-auth-membro'`.
- [ ] **Passo 2:** rodar `npx vitest run src/app`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `dependencias.ts`, `servicosFalsos.ts`, `useAcesso.ts`, `Mensagem.tsx`, `EstadosDeAcesso.tsx`, `GuardaDeMembro.tsx`; `Entrar` usa `useAcesso` direto (membro → `navegar(caminhoDaArea(areaInicial(papel)))` num `useEffect`; senão as telas acima, com `entrar(null)`); `Painel` e `Controle` envolvem o conteúdo em `<GuardaDeMembro area=...>`; `App` guarda as dependências com `useState(() => dependencias ?? dependenciasDoNavegador())` e só as passa às três telas de membro; `main.tsx` continua montando `<App caminho={window.location.pathname} />` (mínimo de 11 linhas). `limparRetornoDaUrl` no navegador:

```ts
limparRetornoDaUrl: (retorno) => {
  const url = new URL(window.location.href)
  for (const p of PARAMETROS_DE_RETORNO) url.searchParams.delete(p)
  if (retorno.fragmentoSujo) url.hash = '' // só rotas de membro chegam aqui; o fragmento das rotas de dispositivo é do pareamento
  window.history.replaceState(window.history.state, '', url.toString())
},
```

- [ ] **Passo 4:** estilos em `base.css` (classes `mensagem`, `mensagem--erro`, `cabecalho-membro`, `botao--contorno`), só com variáveis de `tokens.css`, conferidos em claro e escuro; rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 5:** sabotagens, uma de cada vez, anotando o teste que caiu: mostrar `error_description` no aviso → `erro-do-google-sem-texto-da-url` falha; chamar `limparRetornoDaUrl` antes de `resolverAcesso` → `limpa-depois-de-resolver` falha; aplicar o resultado das reavaliações sem `combinarEstados` (só `sem_papel` protegido, como na primeira versão deste plano) → `anonima-sai` e `sessao-expirada-fica` falham; voltar ao desenho antigo (avaliações em paralelo, com descarte do resultado antigo por número) → `sair-lento-nao-apaga-mensagem` (os três casos), `fora-da-lista-sai-e-mensagem-fica`, `anonima-sai`, `sessao-expirada-fica` e `troca-de-papel-ao-voltar` falham (conferir e anotar os cinco no registro); passar o retorno da URL também às reavaliações → `sair-depois-de-codigo` e `erro-nao-volta-na-troca-de-aba` falham; tornar `obterServicosDeMembro` ansioso (chamado em `dependenciasDoNavegador`) → `caminho-padrao-nao-cria-cliente-em-dispositivo` falha; chamar `obterServicos` no corpo do `App` para toda rota → `dispositivo-nao-cria-cliente-de-membro` falha; aceitar `?volta=` em `urlDeRetorno` → `url-de-retorno-fixa` falha; deixar o erro não esperado de `obterServicos` subir → `erro-inesperado-ao-iniciar` falha.
- [ ] **Passo 6:** `npm run build` com as variáveis vazias (o build não lê variáveis de forma obrigatória; o erro de configuração aparece só na tela) e `npm run check`. Esperado: build gerado; 0 erros.
- [ ] **Passo 7:** READMEs (`src/app/`: `dependencias.ts`, `useAcesso.ts`, `servicosFalsos.ts` "só para testes", `GuardaDeMembro.tsx`, `acesso.test.tsx`; `src/app/telas/`: telas reais × provisórias; `src/shared/ui/`: `Mensagem.tsx`; `src/shared/styles/`: classes novas); registro VER-018 (inclui D2, D3, D5 e as sabotagens; fecha o item 3 do Foco da revisão do PLA-001), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 5: painel vazio com abas e aba Membros

**Arquivos:**
- Criar: `src/shared/ui/Abas.tsx`, `src/app/telas/AbaMembros.tsx`, `src/app/telas/AbaMembros.test.tsx`, `src/app/telas/Painel.test.tsx`, registro `docs/verificacoes/AAAA-MM-DD-019-e1-painel-e-membros.md`
- Modificar: `src/app/telas/Painel.tsx`, `src/shared/styles/base.css`, READMEs de `src/app/telas/`, `src/shared/ui/`, `src/shared/styles/`, `docs/verificacoes/README.md`

**Interfaces:**
- Consome: Tarefas 1 a 4 (`GuardaDeMembro` entrega `usuario`, `papel`, `servicos` e `reavaliar`).
- Produz:

```ts
// src/shared/ui/Abas.tsx
export interface Aba { id: string; rotulo: string }
export function Abas(props: { abas: readonly Aba[]; ativa: string; aoEscolher: (id: string) => void; children: ReactNode }): ReactNode
// role="tablist"; cada aba é <button role="tab" aria-selected aria-controls>; o conteúdo é role="tabpanel" aria-labelledby

// src/app/telas/AbaMembros.tsx
export function AbaMembros(props: { repo: RepositorioDeAcesso; usuario: UsuarioDaSessao; reavaliar: () => void }): ReactNode
```

  Abas do painel (decisão D8), nesta ordem: Episódios (E2), Biblioteca (E2), Cenas (E2), Gestos (E2), Membros (só quando `podeGerenciarMembros(papel)`), Ao vivo (E3). As provisórias mostram "Em construção — etapa E2" ou "etapa E3".

  `AbaMembros`: carrega `listarPermitidos()` e `listarPerfis()` juntos e mostra `montarLista(...)` numa tabela (E-mail, Nome ou "ainda não entrou", Papel, Ações), com legenda acessível; formulário "Incluir" (campo e-mail com `<label>`, seletor de papel com os três rótulos, botão "Incluir"); por linha, seletor de papel + "Salvar papel" e "Remover", que pede confirmação na própria linha ("Confirmar remoção" / "Cancelar"; sem `window.confirm`). A linha da sessão (`mesmoEmail`) mostra "Você" e o texto "Você não pode alterar o próprio acesso; peça a outro admin.", sem controles (o banco também recusa, D1). Antes de cada escrita, `normalizarEmail`/`conferirInclusao`/`conferirMudanca`; recusa local → mensagem e **nenhuma** chamada ao repositório. Mensagens fixas: `vazio`/`formato` "Digite um e-mail válido."; `duplicado` "Esse e-mail já está na lista."; `propria_linha` (texto acima); `ultimo_admin` "A lista precisa de ao menos um admin."; `sem_mudanca` "O papel já é esse."; erro `negado` ou `nada_alterado` → "A lista ou o seu papel mudou; conferindo de novo." + `reavaliar()` + recarga da lista; `sessao_expirada` → `reavaliar()`; `rede`/`outro` → "Não foi possível salvar. Tente de novo." Depois de cada escrita bem-sucedida, recarrega a lista e mostra "Lista atualizada." (`role="status"`).

- [ ] **Passo 1: testes (falham).** Em `Painel.test.tsx` (pelo `App` com falsos): `equipe-ve-abas-sem-membros` (5 abas, sem "Membros"); `admin-ve-membros` (6 abas, "Membros" entre "Gestos" e "Ao vivo"); `aba-provisoria` (clicar em "Ao vivo" → `aria-selected="true"` e "Em construção — etapa E3"; "Biblioteca" → "etapa E2"); `abas-acessiveis` (um `tablist`, cada `tab` controla um `tabpanel` existente). Em `AbaMembros.test.tsx` (renderizada direto, com `criarFalsos` e a sessão `adm@revocast.test`; lista `adm` admin, `ana` equipe com perfil "Ana", `bia` apresentadora sem perfil):

| Teste | Ação | Esperado |
|---|---|---|
| `lista-com-perfis` | abrir | 3 linhas; "Ana" na linha da ana; "ainda não entrou" na da bia; ordem admin, equipe, apresentadora |
| `inclui-normalizado` | digitar `  Nova@Revocast.TEST `, papel "Equipe", "Incluir" | `chamadas.incluir` = `[['nova@revocast.test', 'equipe', <id da sessão>]]`; lista recarregada; "Lista atualizada." |
| `inclusao-recusada-localmente` | `nao-e-email`; depois `Ana@Revocast.TEST` | "Digite um e-mail válido."; "Esse e-mail já está na lista."; `incluir` nunca chamado |
| `duplicado-do-banco` | `falharProxima('incluir', new ErroDeAcesso('duplicado'))` e incluir e-mail novo | "Esse e-mail já está na lista." |
| `troca-papel` | linha da ana → "Apresentadora" → "Salvar papel" | `chamadas.alterar` = `[['ana@revocast.test', 'apresentadora']]` |
| `remove-com-confirmacao` | "Remover" na bia, depois "Cancelar"; de novo "Remover" e "Confirmar remoção" | nada no cancelamento; depois `chamadas.remover` = `['bia@revocast.test']` |
| `propria-linha-sem-acoes` | sessão `Adm@Revocast.TEST` (maiúsculas) | a linha do adm tem "Você" e o aviso; nenhum botão "Remover" nem seletor nela |
| `escrita-negada-reavalia` | `falharProxima('alterarPapel', new ErroDeAcesso('nada_alterado'))`, depois o mesmo com `negado` | "A lista ou o seu papel mudou…"; `reavaliar` chamado 1 vez em cada; lista recarregada |
| `falha-de-rede-ao-salvar` | `falharProxima('remover', new ErroDeAcesso('rede'))` | "Não foi possível salvar. Tente de novo."; `reavaliar` não chamado |
| `nome-com-html-literal` | perfil com nome `<img src=x onerror=alert(1)>` | o texto aparece literal (`getByText`) e `container.querySelector('img[src="x"]')` é `null` |

- [ ] **Passo 2:** rodar `npx vitest run src/app/telas`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `Abas.tsx`, `AbaMembros.tsx` e as abas em `Painel.tsx` (estado `useState('episodios')`); estilos `abas`, `aba`, `aba--ativa`, `tabela`, `campo` em `base.css`, com rolagem horizontal da tabela em tela estreita (`overflow-x: auto` num invólucro) e sem estourar o cartão em 320 px. Rodar `npm test`. Esperado: todos passam.
- [ ] **Passo 4:** sabotagens, uma de cada vez, anotando o teste que caiu: tirar `normalizarEmail` do incluir → `inclui-normalizado` falha; tirar a conferência da própria linha → `propria-linha-sem-acoes` falha; não chamar `reavaliar` em `nada_alterado` → `escrita-negada-reavalia` falha; mostrar a aba Membros para `equipe` → `equipe-ve-abas-sem-membros` falha.
- [ ] **Passo 5:** READMEs e `npm run check`. Esperado: 0 erros.
- [ ] **Passo 6:** registro VER-019 (inclui D6, D8 e as sabotagens), linha em `docs/verificacoes/README.md`; dupla verificação; `npm run check` como último ato; commit; push; relato.

### Tarefa 6: conferência no navegador e guia do login para o responsável

**Arquivos:**
- Modificar: `supabase/README.md` (seção nova "Login Google (E1)", sem reduzir as 99 linhas), `docs/verificacoes/README.md`
- Criar: registro `docs/verificacoes/AAAA-MM-DD-020-e1-conferencia-e-guia.md`

- [ ] **Passo 1: conferência no navegador sem Supabase.** `npm run build` e `npm run preview`; com o Chromium do Playwright do ambiente (fora do repositório, sem virar dependência), abrir:
  - sem variáveis no build: `/painel`, `/entrar` e `/controle` → "Configuração incompleta" citando `VITE_SUPABASE_URL`; `/camera` → tela provisória da E4 (o cliente de membro não é criado);
  - com um build feito com variáveis de mentira (`VITE_SUPABASE_URL=https://exemplo.revocast.test`, `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_teste`, só na linha de comando, nunca em arquivo): `/painel` → botão "Entrar com Google" (ou a tela de falha, se a sessão não puder ser lida); `/painel?error=access_denied&error_description=Texto%20injetado` → "O login com o Google foi cancelado.", sem "Texto injetado", e a URL fica `/painel`;
  - em 320 px de largura e no tema escuro (`prefers-color-scheme: dark` emulado), as mesmas telas sem rolagem horizontal da página.
  Capturas ficam fora do repositório; o resultado vai para o registro.
- [ ] **Passo 2:** em `supabase/README.md`, seção "Login Google (E1)" com a lista do passo do responsável abaixo (sem e-mail, sem domínio real: `<ref>`, `<domínio da Vercel>`), incluindo o porquê de não haver curinga nas Redirect URLs.
- [ ] **Passo 3:** oferecer ao responsável, no relato da tarefa, o ajuste do DES-001 pendente desde o VER-010/VER-011 e as regras novas desta etapa (decisão D7), e as decisões D1–D8; o que ele decidir vira item próprio (fora desta tarefa).
- [ ] **Passo 4:** `npm run check`; registro VER-020 (resultado do Passo 1; estado do passo do responsável: feito, pendente ou com problema); dupla verificação; `npm run check` como último ato; commit; push; relato.
- [ ] **Passo 5: passo do responsável** (fora do código; nenhum agente consegue fazer). Em ordem:
  1. **Banco, no editor SQL do Supabase, nesta ordem:** se a E0 ainda estiver pendente, aplicar `supabase/migrations/20261117000000_fundacao.sql` e rodar o comando do primeiro `admin` de `supabase/README.md` com o próprio e-mail; depois aplicar **a migração nova da E1**, `supabase/migrations/<AAAAMMDDHHMMSS>_membros_sem_autoalteracao.sql` (colar o arquivo inteiro e rodar). Conferir em Authentication → Policies (ou no Table Editor) que `membros_permitidos` tem as quatro políticas e que as de update e delete trazem a condição do e-mail.
  2. **Google Cloud Console** (sem faturamento): APIs e serviços → Tela de consentimento OAuth: tipo "Externo"; escopos `openid`, `email`, `profile`; em **"Domínios autorizados"**, `<ref>.supabase.co` e o domínio do app (`<domínio da Vercel>`); **publicar em produção** (em "Teste" só entram usuários de teste cadastrados). Credenciais → Criar ID do cliente OAuth → "Aplicativo da Web": em "Origens JavaScript autorizadas", `https://<domínio da Vercel>` e `http://localhost:5173`; em "URIs de redirecionamento autorizados", **só** `https://<ref>.supabase.co/auth/v1/callback`. Guardar o ID e a chave secreta do cliente só para o passo seguinte (a chave secreta nunca vai para o repositório nem para a Vercel).
  3. **Supabase → Authentication → Sign In / Providers:** Google ligado, com o ID e a chave secreta do cliente; **Email desligado**; "Confirm email" ligado; vinculação manual de identidades desligada; login anônimo **pode ficar desligado até a E3** (decisão D5).
  4. **Supabase → Authentication → URL Configuration:** Site URL `https://<domínio da Vercel>`; Redirect URLs **só** `https://<domínio da Vercel>/**`, `http://localhost:5173/**` e `http://localhost:4173/**` (prévia local), como no DES-001 §12. **Nenhum curinga de host** (por exemplo, `https://*-<time>.vercel.app/**`): qualquer pessoa cria na Vercel um projeto `x-<time>`, cujo domínio casa com o padrão, começa o login com o próprio `code_challenge` e manda o link a um membro; o código volta para o domínio dela, que tem o verificador, e ela toma a conta. Para testar o login num deploy de prévia, acrescentar a URL **exata** daquela prévia (`https://<url exata da prévia>/**`), testar e **tirá-la depois**. Um endereço fora da lista faz o retorno cair na Site URL.
  5. **Supabase → validade do JWT:** 10 min (DES-001 §8, Revogação). **Realtime:** acesso público desligado (pode esperar a E3, quando os canais entram).
  6. **Vercel → Settings → Environment Variables:** `VITE_SUPABASE_URL` (só a origem, `https://<ref>.supabase.co`) e `VITE_SUPABASE_PUBLISHABLE_KEY` (a chave publicável, nunca a `sb_secret_`) em Production e Preview; fazer um novo deploy (as variáveis entram no build).
  7. **Conferência real** (anotar o resultado para o registro seguinte): entrar com a conta do primeiro `admin` em `/entrar` → vai para `/painel` com a aba Membros, e a própria linha aparece como "Você", sem controles; incluir uma segunda conta Google sua como `equipe`; entrar com ela em outro navegador → `/painel` sem a aba Membros; trocar o papel dela para `apresentadora` e voltar à aba do outro navegador → "Sem acesso a esta página" com o link para `/controle`; remover a conta e voltar à aba → "Acesso não liberado"; entrar com uma conta fora da lista → "Acesso não liberado" com o e-mail dela; cancelar a tela do Google → "O login com o Google foi cancelado."

---

## Ao fim da E1

- A equipe entra pelo Google; quem está na lista vê a sua área (`/painel` para `admin`/`equipe`, `/controle` provisório para `apresentadora`); quem não está vê "Acesso não liberado" e sai; erro de configuração, erro inesperado e falha de rede aparecem na tela, cada um com a sua mensagem.
- O `admin` mantém a lista de acesso pela aba Membros; mudanças valem na hora no banco e na tela na próxima reavaliação; nenhum `admin` altera nem remove a si mesmo, nem pela API (migração `membros_sem_autoalteracao`).
- `src/domains/acesso/` existe com as portas que a E2 reaproveita (`ServicosDeMembro`, padrão de repositório por agregado).
- `npm run check` continua com os mesmos passos; **uma migração nova** (só políticas), nenhuma dependência nova; `banco.ts` aplica todas as migrações em ordem; um bloco de testes de banco a mais, no mesmo PGlite de `rls.test.ts`.
- Fica para a E2: Biblioteca, cenas, episódios, avisos e mapa de gestos (as abas já existem); políticas de `storage.objects`.
- Fica para a E3: `/controle` de verdade, pareamento, `/obs/palco`, modo teste, canais de tempo real com as políticas de `realtime.messages` e o **aviso de revogação de membro** (decisão D4); ligar o login anônimo (decisão D5).
- Pendências conhecidas: a corrida de dois admins que se removem no mesmo instante (decisão D1, com recuperação pelo editor SQL); o ajuste do DES-001 sobre privilégios, a regra da D1 e as Redirect URLs (decisão D7); a migração nova e a conferência real do Passo 5 da Tarefa 6, que dependem do responsável.
