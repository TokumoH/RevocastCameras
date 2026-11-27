# VER-030 — E2, Tarefa 7: aba Episódios e avisos

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-030 |
| Título | E2, Tarefa 7: aba Episódios no `/painel` (lista com o estado, criar, editar só título e data, excluir só rascunho; avisos com texto literal, link `https://` validado antes de virar âncora, imagem da Biblioteca, duração e ordem); iniciar e encerrar o ao vivo ficam para a E3 |
| Gravidade | alta |
| Tipo | implementação · interface · segurança |
| Data | 2026-11-27 (data do commit, em UTC) |
| Usuário responsável | TokumoH |
| Status de implementação | implementado (testado com os falsos das portas e conferido no Chromium com o Supabase e o Storage interceptados; a conferência contra o Supabase real é a Tarefa 8 do PLA-003) |
| Commits | commit que introduz este arquivo — `git log --diff-filter=A --format=%h -- docs/verificacoes/2026-11-27-030-e2-episodios-e-avisos.md` |
| Arquivos | `src/app/telas/AbaEpisodios.tsx`, `src/app/telas/AbaEpisodios.test.tsx`, `src/app/telas/AbaBiblioteca.tsx`, `src/app/telas/Painel.tsx`, `src/app/telas/Painel.test.tsx`, `src/app/telas/README.md`, `src/app/App.test.tsx`, `src/app/README.md`, `src/shared/styles/base.css`, `src/shared/styles/README.md`, `docs/verificacoes/README.md`, este registro (12 arquivos) |

## Problema

1. **A aba Episódios era provisória.** O `/painel` abria em "Episódios" com "Em construção — etapa E2". O domínio (`episodios.ts`: `conferirEpisodio`, `podeExcluirEpisodio`, `conferirAviso`, `normalizarLink`, `trocarOrdem`; VER-024) e o adaptador (`preparacaoSupabase.ts`, que só manda `titulo` e `data` no `update`; VER-027) já existiam, mas a equipe não tinha como criar um episódio nem preparar os avisos.
2. **Riscos próprios da tela** (Foco da revisão do [PLA-003](../planos/2026-11-26-e2-preparar-episodio.md), itens 5 e 7, e as notas do controlador):
   - mostrar o título ou o texto de um aviso como HTML (`<b>`, `<script>`);
   - pôr um link `javascript:` ou `http:` no `href`, inclusive um link salvo antes por fora (o `CHECK avisos_link_https` só confere o prefixo `https://`);
   - mandar ao `alterar` o episódio inteiro (com `estado`), ou oferecer um botão que mude o estado: dois episódios `ao_vivo` ao mesmo tempo seriam recusados pelo índice `episodios_um_ao_vivo`, e iniciar/encerrar exige o canal `estudio` da E3 (D2);
   - deixar excluir um episódio ao vivo ou encerrado (a exclusão apaga em cascata os avisos e o `registro_acoes`, que é histórico; D2);
   - oferecer um som no seletor de imagem do aviso (a chave estrangeira composta recusaria; a tela não pode oferecer);
   - quebrar o cartão quando a imagem do aviso saiu da Biblioteca (nota 2 do controlador);
   - subir ou descer com ordens repetidas (`ordem` padrão 0) gravando só "duas escritas" fixas, o que deixaria o empate (nota 1).

## Era proposital?

Sim, como etapa: o PLA-003 põe a aba na Tarefa 7 ("Estrutura de arquivos") e a D2 decide que a E2 só **mostra** o estado. O DES-001 §9 põe "iniciar/encerrar o ao vivo" na aba Episódios; a D2 adia isso para a E3 (iniciar exige limpar `estudio_estado.episodio_teste_id` e avisar no canal `estudio`), e a aba diz isso numa nota fixa. O "checklist do episódio" do DES-001 §9 e §10.4 fica na aba **Ao vivo** (E3), não nesta.

O teste `aba-provisoria` de `Painel.test.tsx` conferia "Em construção — etapa E2" na aba inicial, e `membros-some-quando-rebaixado` também; o caso `/painel` de `App.test.tsx` esperava a mesma frase (o `npm run check` acusou, e o caso passou a esperar a nota da E3, sem mudar o tamanho do arquivo, que é âncora de 90 linhas). Desde esta tarefa, só "Ao vivo" é provisória: os três testes passam a conferir a aba real.

O brief pedia a prévia da imagem "aceita só se https, como na aba Biblioteca". A Biblioteca aceita `https:` **ou** `http:` (Supabase local) em `urlDePreviaAceita`. Para não ter duas regras, a função passa a ser exportada de `AbaBiblioteca.tsx` e reaproveitada (ver "Por que não outras soluções").

## Solução

- **`AbaEpisodios.tsx`** (`{ servicos, usuario, reavaliar }`):
  - **Carga:** `episodios.listar()`, `midias.listar()` (as imagens do seletor e da miniatura) e, com um episódio aberto, `listarAvisos(id)`, juntos; só a leitura mais recente aplica. Se o episódio aberto sumiu (excluído por fora), a aba volta à lista e deixa de ler os avisos dele. Falha: "Não foi possível carregar os episódios." e "Tentar de novo"; com `sessao_expirada`, também `reavaliar()`.
  - **Nota fixa:** "Iniciar e encerrar o ao vivo chegam na etapa E3." Nenhum botão "Iniciar"/"Encerrar", nenhum controle de estado.
  - **Lista:** tabela (Título, Data `DD/MM/AAAA`, Estado "Rascunho"/"Ao vivo"/"Encerrado", "Abrir"), mais recente primeiro. **Novo episódio:** título (aparado, sem `maxLength`; acima de 120 caracteres é recusado com mensagem) e data com `<input type="date">`, padrão hoje (data local); `incluir({ titulo, data, criadoPor: usuario.id })`.
  - **Episódio aberto:** título (com foco), etiqueta do estado e "Fechar"; formulário com título e data e "Salvar" (Enter salva), que chama `alterar(id, { titulo, data })` com os dois campos montados um a um. "Excluir episódio" só quando `podeExcluirEpisodio` (rascunho), com confirmação que diz quantos avisos saem; nos outros estados o botão não existe e aparece "Só rascunhos podem ser excluídos." (o handler também recusa).
  - **Avisos** em ordem (`<ol aria-label="Avisos do episódio">`): cartão com a posição, o título, a duração ("10 s"), o texto (React, com `white-space: pre-line`), o link como `<a href target="_blank" rel="noopener noreferrer">` **só** com o valor que `normalizarLink` devolveu (um link fora do formato aparece como texto: "Link fora do formato (não abre): http://x"), a imagem ("Imagem: capa.png" e "Ver imagem"/"Ocultar imagem", com a URL assinada pedida só no clique e usada só se `urlDePreviaAceita`) ou "Sem imagem" (também quando a imagem saiu da Biblioteca), e "Subir"/"Descer", "Editar", "Excluir" (confirmação no cartão).
  - **Formulário de aviso:** título, texto em `<textarea>`, link (`type="url"`, `noValidate`, com a dica "Opcional; só endereços que começam com https://."), imagem num seletor com **só** as imagens da Biblioteca e "Sem imagem", duração em segundos (padrão 10). `conferirAviso` antes de gravar; o link vai normalizado (`https://…` ou nulo) e o texto como digitado. "Editar" carrega o aviso no mesmo formulário ("Salvar aviso", "Cancelar edição", Esc cancela); uma edição por vez ("Editar" desabilitado em todos os cartões, e "Excluir" no editado). Uma imagem que saiu da Biblioteca volta para "Sem imagem" ao editar.
  - **Ordem:** `trocarOrdem` → só os avisos cuja ordem mudou, um por vez com `alterarOrdemDoAviso` (o par sem empate; com empate, os que a renumeração mudou). Falha no meio recarrega.
  - **Mensagens** (`TEXTO_DOS_EPISODIOS`): `titulo_vazio` "Dê um título."; `titulo_longo` "Título com até 120 caracteres."; `data_invalida` "Data inválida."; `link_invalido` "O link precisa começar com https://."; `duracao_invalida` "Duração entre 1 e 600 segundos."; `imagem_inexistente` (local, ou `em_uso` do banco numa escrita de aviso, que é a chave estrangeira da imagem apagada) "Essa imagem não está mais na Biblioteca." + recarga; `duplicado` numa escrita de episódio "Já existe um episódio ao vivo."; `negado`/`nada_alterado` "Os episódios ou o seu papel mudaram; conferindo de novo." + `reavaliar()` + recarga; `sessao_expirada` → só `reavaliar()`; o resto "Não foi possível concluir. Tente de novo.".
  - **Como as outras abas:** regiões `status`/`alert` sempre montadas; foco no mesmo commit do recado (`useLayoutEffect`); guarda síncrona contra clique duplo (`escrevendo` em `useRef`); nenhum dado vira HTML. Foco: criar → campo "Título"; "Abrir" → título do episódio; "Fechar" → "Abrir" do episódio; salvar ou excluir episódio → status; "Excluir episódio"/"Manter" alternam; incluir aviso → "Título do aviso"; "Editar" → "Título do aviso"; salvar ou cancelar a edição → "Editar" do aviso; subir/descer → o mesmo botão ou, na ponta, o outro; excluir aviso → status; erro → alerta.
- **`AbaBiblioteca.tsx`:** `urlDePreviaAceita` passa a ser exportada (sem mudar o corpo).
- **`Painel.tsx`:** a aba "Episódios" mostra `AbaEpisodios` com os mesmos serviços da Preparação (`useState(obterPreparacao)`, uma vez) e o usuário da sessão; as quatro abas da E2 ficam com `etapa: null`; só "Ao vivo" continua provisória (E3).
- **`base.css`:** `.episodios`, `.episodio`, `.campo--data`, `.avisos`, `.aviso-cartao` (com `__texto` em `pre-line` e `overflow-wrap: anywhere`), `.aviso-formulario` e `.campo textarea`, só com variáveis de `tokens.css`.

## Por que esta solução

- **DDD + Pure Fabrication + Componentes:** as regras ficam no domínio (`conferirEpisodio`, `podeExcluirEpisodio`, `conferirAviso`, `normalizarLink`, `trocarOrdem`); a tela escolhe o que mostrar e traduz motivos em textos fixos.
- **Âncora só com o link normalizado:** o banco aceita qualquer texto que comece com `https://` e um link pode ter sido salvo por fora antes do `CHECK`; a tela confere de novo ao mostrar, e o `href` recebe o valor do domínio, não o do banco.
- **Duas camadas para o estado (D2):** a tela não tem controle de estado e manda só `{ titulo, data }`; o adaptador, mesmo recebendo mais, monta só esses dois (teste `episodio-so-titulo-e-data` da Tarefa 4).
- **`em_uso` no aviso = imagem apagada:** no adaptador, `23503` vira `em_uso`; numa escrita de `avisos` a única chave estrangeira que o app preenche além do episódio é a da imagem.
- **Episódio aberto na mesma aba (lista ↔ detalhe):** em 320 px a lista e os avisos juntos ficariam longos demais; "Fechar" volta com o foco no "Abrir" do episódio.
- **Reaproveitar `urlDePreviaAceita`:** a miniatura do aviso e a prévia da Biblioteca vêm do mesmo adaptador; uma regra só evita que as duas divirjam.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Aceitar só `https:` na miniatura (texto literal do brief) | Divergiria da Biblioteca, que aceita também `http:` para o Supabase local; a URL vem do mesmo adaptador. Fica como ponto para o controlador decidir (as duas abas mudam juntas se a regra mudar) |
| Copiar `urlDePreviaAceita` para a aba Episódios | Duas regras para a mesma URL; contraria o reuso pedido pelo `CLAUDE.md` |
| Sempre duas escritas em "Subir"/"Descer" | Com `ordem` padrão 0 deixa o empate (nota 1); a sabotagem S6 derruba `ordem-dos-avisos` e `ordem-dos-avisos-com-empate` |
| Gravar todos os itens devolvidos por `trocarOrdem` | Escritas inúteis; a sabotagem S5 derruba `ordem-dos-avisos-com-empate` |
| Botão "Excluir episódio" desabilitado fora de rascunho | O brief pede que ele não apareça e que o texto explique; um botão desabilitado sem explicação seria pior para leitor de tela |
| `maxLength={120}` no título do episódio | Cortaria em silêncio um título colado; o domínio recusa com mensagem |
| Checklist do DES-001 §10.4 nesta aba | O DES-001 §9 põe o checklist na aba Ao vivo (E3) |
| Esconder avisos com imagem apagada | O aviso continua válido sem imagem (o banco põe nulo, `on delete set null`); "Sem imagem" mostra o que vai ao ar |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`src/app/telas/AbaEpisodios.tsx`](../../src/app/telas/AbaEpisodios.tsx#L13) | 1–832 | Novo: `TEXTO_DOS_EPISODIOS` (L13), `carregar` (L168; desfaz a edição de um aviso que sumiu, revisão N1), foco (L205), `tratarErro` (L243), `escrever` (L264), `aoCriar` (L298), `aoAbrir` (L312), `aoSalvarEpisodio` (L332), `aoConfirmarExclusaoDoEpisodio` (L346), `aoGravarAviso` (L363), `aoEditarAviso` (L395), `aoMover` (L427), `aoAlternarPrevia` (L451), `linkDoAviso` (L475), `imagemDoAviso` (L496), `lista` (L573), `episodioAberto` (L642; exclusão só em rascunho na L677) |
| [`src/app/telas/AbaEpisodios.test.tsx`](../../src/app/telas/AbaEpisodios.test.tsx) | 1–668 | Novo: 32 testes (30 da primeira versão e 2 da revisão) |
| [`src/app/telas/AbaBiblioteca.tsx`](../../src/app/telas/AbaBiblioteca.tsx#L101) | 101–105 | `urlDePreviaAceita` exportada (comentário diz quem a usa) |
| [`src/app/telas/Painel.tsx`](../../src/app/telas/Painel.tsx#L66) | 15, 18–23, 66–67, 85 | Aba Episódios real; `etapa: null` nas quatro abas da E2 |
| [`src/app/telas/Painel.test.tsx`](../../src/app/telas/Painel.test.tsx#L39) | 39–70, 158 | `aba-provisoria` (só Ao vivo provisória); novo `episodios-no-painel`; `membros-some-quando-rebaixado` confere a aba real |
| [`src/app/App.test.tsx`](../../src/app/App.test.tsx#L43) | 43 | O caso `/painel` espera a nota da aba Episódios no lugar de "Em construção — etapa E2" |
| [`src/shared/styles/base.css`](../../src/shared/styles/base.css#L304) | 130, 303–348 | Estilos da aba Episódios; `.campo textarea` somado à regra de `.campo input` (revisão N2) |
| [`src/app/telas/README.md`](../../src/app/telas/README.md), [`src/shared/styles/README.md`](../../src/shared/styles/README.md), [`src/app/README.md`](../../src/app/README.md), [`README.md`](README.md) | — | "Arquivos", "Onde", propósito, origem, organização, exemplo, verificação e riscos |

## Lógica

```mermaid
flowchart TD
    L[Lista de episódios] -- Abrir --> A[Episódio aberto]
    A -- Fechar --> L
    A --> S[Salvar: conferirEpisodio → alterar id, titulo + data]
    A --> X{podeExcluirEpisodio?}
    X -- rascunho --> XC[Excluir episódio → confirmação → remover → lista]
    X -- ao_vivo / encerrado --> XT[texto: Só rascunhos podem ser excluídos.]
    A --> F[Formulário de aviso]
    F --> CA{conferirAviso}
    CA -- recusa --> M[mensagem; nenhuma chamada]
    CA -- ok --> G[incluirAviso / alterarAviso com link normalizado]
    G -- em_uso --> IM[Essa imagem não está mais na Biblioteca. + recarga]
    A --> C[Cartão do aviso]
    C --> LK{normalizarLink aceita?}
    LK -- sim --> AN["&lt;a target=_blank rel=noopener noreferrer&gt;"]
    LK -- não --> TX[link como texto]
```

Subir ou descer avisos (`trocarOrdem`, nota 1):

| Situação | Antes (brief) | Depois |
|---|---|---|
| Ordens 0, 1, 2; subir o do meio | 2 escritas | 2 escritas (o par) |
| Ordens 0, 0, 0; subir o último (C) | 2 escritas, empate fica | C → 1 e B → 2 (A já está em 0 e não é gravado) |
| Uma escrita falha | — | recarrega e avisa |

## Exemplo

No navegador (390 px), com três avisos de ordem 0 (Inscrições, Link antigo, Festa), subir "Festa" gerou dois `PATCH /rest/v1/avisos`: `id=eq.a-3 {"ordem":1}` e `id=eq.a-2 {"ordem":2}`, e a ordem passou a Inscrições, Festa, Link antigo. Salvar o episódio gerou `PATCH /rest/v1/episodios?id=eq.e-1&select=id {"titulo":"Revoada de novembro (editado)","data":"2026-11-20"}`, sem `estado` nem `gestos_ligados`; nenhum dos pedidos da sessão continha `estado`. O aviso com título `<b>Inscrições</b> abertas` e texto `<script>alert(1)</script>` apareceu como texto, sem `script` nem `b` no DOM; o link salvo como `http://x` apareceu como "Link fora do formato (não abre): http://x", sem `<a>`; e o link `https://revocast.test/inscricao/…` virou `<a target="_blank" rel="noopener noreferrer">`.

## Verificação

- **TDD:** com os testes escritos e a aba inexistente, `npx vitest run src/app/telas` falhou: `AbaEpisodios.test.tsx` não resolve o import e 3 testes de `Painel.test.tsx` falham (`aba-provisoria`, `episodios-no-painel`, `membros-some-quando-rebaixado`); 114 passando. Com a implementação, os 6 arquivos passam (147 testes).
- **Testes:** 32 em `AbaEpisodios.test.tsx` desde a revisão (eram 30) e 1 novo em `Painel.test.tsx` (11 no arquivo); `npm test` com todos passando (contagens no relatório da tarefa). `npm run typecheck` sem erros.
- **Sabotagens** (cada uma aplicada ao arquivo por script e desfeita com `cp` da cópia guardada, conferida com `cmp`):

| # | Sabotagem | Testes que caíram |
|---|---|---|
| S1 | Link no `href` sem `normalizarLink` (todo link vira âncora) | `link-aceito-vira-ancora` (o `http://x` salvo por fora) |
| S2 | "Excluir episódio" em qualquer estado | `excluir-so-rascunho` |
| S3 | Episódio inteiro no `alterar` (`{ ...e, titulo, data }`) | `edita-so-titulo-e-data`, `ao-vivo-fica-para-e3` |
| S4 | Todas as mídias no seletor de imagem | `aviso-com-imagem` |
| S5 | Gravar tudo o que `trocarOrdem` devolve (sem filtrar o que não mudou) | `ordem-dos-avisos-com-empate` |
| S6 | Duas escritas fixas (troca o par pela posição, ignora o empate) | `ordem-dos-avisos`, `ordem-dos-avisos-com-empate` |
| S7 | Imagem do aviso suposta existente (acessa `m.nome` sem conferir) | `imagem-apagada-mostra-sem-imagem` |
| S8 | Prévia aceita qualquer URL | `previa-com-url-recusada` |
| S9 | Texto do aviso com `dangerouslySetInnerHTML` | `aviso-com-html-literal` |
| S10 | Foco com `useEffect` | `foco-no-mesmo-commit-do-aviso` |
| S11 | Sem as guardas de clique duplo (`escrever`, `aoCriar`, `aoGravarAviso`) | `clique-duplo-nao-duplica` |
| S12 | Sem `reavaliar()` na escrita negada | `escrita-negada-reavalia` |
| S13 | `em_uso` do aviso vira mensagem genérica, sem recarga | `imagem-inexistente-do-banco` |
| S14 | Botão "Iniciar ao vivo" no episódio aberto | `ao-vivo-fica-para-e3` |
| S15 | `Painel` sem a aba Episódios | `aba-provisoria`, `episodios-no-painel`, `membros-some-quando-rebaixado` |
| S16 | Duração padrão 5 | `duracao-padrao-10`, `link-aceito-vira-ancora` |
| S17 | Sessão expirada também mostra a mensagem genérica | `sessao-expirada-na-escrita` |
| S18 | Episódio que sumiu continua aberto (sem `definirAberto(null)` na carga) | `episodio-que-sumiu-fecha` |

  **Achado durante as sabotagens e corrigido:** na primeira rodada, S18 não derrubava nada, porque a tela já volta à lista quando o episódio aberto não está na lista (o detalhe é calculado por `find`); o efeito que sobrava era a carga continuar lendo os avisos do episódio que sumiu. O teste `episodio-que-sumiu-fecha` passou a conferir que a carga seguinte não chama `listarAvisos`; com isso, S18 derruba o teste.
- **Navegador (Chromium/Playwright):** `vite build` com URL fictícia (saída fora do repositório) e `vite preview`, com o Supabase interceptado por um falso em memória (`episodios`, `avisos`, `midias`, `rpc/papel_atual` e a URL assinada do Storage). Claro e escuro, 320, 390 e 1280 px:
  - **Largura:** `scrollWidth` = largura da janela em todas, e nenhum elemento passa da borda do cartão (título sem espaços na lista, link longo e texto com quebras de linha nos cartões); a tabela de episódios rola dentro de `.tabela-rolavel` em 320 e 390 px. Achado visual corrigido: "Excluir episódio" ocupava a largura da coluna; passou a ter o tamanho do texto (`.episodio > button { justify-self: start }`), e a conferência foi refeita com o mesmo resultado.
  - **Lista:** mais recente primeiro, estados com rótulo, data padrão = hoje, nota da E3, nenhum botão "Iniciar"/"Encerrar".
  - **Ao vivo aberto:** sem "Excluir episódio", com "Só rascunhos podem ser excluídos."; foco no título; "Fechar" → foco em "Abrir".
  - **Criar:** `POST` com `titulo` aparado, `data` e `criado_por`; foco no campo "Título". Título vazio: foco no alerta, nenhum pedido.
  - **Avisos:** HTML literal; `pre-line` aplicado; âncora só no link `https://`; "Sem imagem" para imagem apagada; "Ver imagem" → `<img>` com a URL assinada, foco no próprio botão ("Ocultar imagem"); subir com empate = 2 `PATCH` (o que não muda não é gravado); `javascript:` recusado sem pedido; seletor só com "Sem imagem" e `capa.png`; incluir → `POST` com o link normalizado, `ordem` 3 e foco no "Título do aviso"; editar → foco no "Título do aviso"; Enter salva (`PATCH` com a ordem atual) e o foco vai para "Editar"; excluir → "Manter", confirmar → `DELETE` e foco no status.
  - **Episódio:** salvar → `PATCH` só com `titulo` e `data`, foco no status; excluir → "Excluir o episódio e os seus 3 avisos?", foco em "Manter"; confirmar → `DELETE` e volta à lista com foco no status.
  - **Console:** nenhum erro. O preview foi parado.
- **Revisão 1 (revisor independente):** spec ✅; qualidade aprovada, sem achado crítico nem importante, com 3 nits. Os três entraram com reconferência pontual, sem nova rodada, pela decisão (a): N1 é um ajuste pequeno de comportamento, com teste; N2 é só CSS, sem mudar o visual; N3 só acrescenta testes.

| Achado | Correção | Teste e sabotagem que o derruba |
|---|---|---|
| N1 — aviso em edição excluído por fora deixava o formulário em modo edição de um id que não existe ("Editar" desabilitado em todos os cartões) | Na carga, se o aviso em edição não veio, `editando` e o formulário são limpos (ref `editandoAtual`, como `abertoAtual`) | `aviso-em-edicao-que-sumiu` (a sonda do revisor): depois da recarga, "Incluir aviso", sem "Cancelar edição", título vazio e "Editar" habilitado. Falhou contra o código anterior à revisão; cai com R1 (carga sem limpar a edição) |
| N2 — `.campo textarea` repetia a regra de `.campo input, .campo select` | `.campo textarea` somado àquela lista; fica à parte só `resize: vertical` | — (CSS; `check-docs` e testes sem mudança) |
| N3 — ramo `negado` sem teste de tela; links `data:` e com maiúsculas só cobertos no domínio | `escrita-negada-reavalia` ganha o caso `negado` (na inclusão de aviso: mensagem, 2º `reavaliar()`, recarga, foco no alerta); novo `links-salvos-por-fora` (`data:text/html,…` e `JAVASCRIPT:alert(1)` ficam texto; `HTTPS://Revocast.test/Inscricao` vira `<a href="https://revocast.test/Inscricao">` com `rel` e `target`; 1 âncora só) | R2 (sem `negado` no `if`) derruba `escrita-negada-reavalia`; S1 derruba `links-salvos-por-fora` e `link-aceito-vira-ancora`; R3 (`href` com o valor do banco, sem normalizar) derruba `links-salvos-por-fora` |

  Reconferência pontual: `npx vitest run src/app --maxWorkers=2` três vezes, `npm run typecheck` e `node scripts/check-docs.mjs`.
- **`npm run check`:** último ato, 0 erros (detalhes no relatório da tarefa).

## Riscos

- **Estado pela API (D2):** a tela não muda `estado`, mas a RLS filtra linhas, não colunas: `equipe` ainda consegue, pela API, mudar `estado` e excluir um episódio fora de rascunho. A E3 decide se o estado passa a mudar só por função. O "no máximo um `ao_vivo`" continua garantido pelo índice `episodios_um_ao_vivo`, e o `duplicado` vira mensagem fixa.
- **Troca de ordem sem transação:** uma falha no meio deixa parte das ordens novas; a aba recarrega e mostra o que o banco tem.
- **Prévia `http:` aceita:** a miniatura segue a regra da Biblioteca (`https:` ou `http:` para o Supabase local). Se a regra virar só `https:`, as duas abas mudam juntas, em `urlDePreviaAceita`.
- **Prévia que não carrega:** como na Biblioteca, `createSignedUrl` passa pelo `fetch` sem tempo-limite; a prévia que não chega só fica vazia.
- **Edição de aviso que sumiu:** se o aviso em edição foi excluído por fora, a recarga desfaz a edição (revisão N1) e o que a pessoa digitou se perde; a mensagem fixa explica que a lista mudou.
- **Recado antigo ao editar:** a mensagem de sucesso anterior ("Aviso incluído.") continua visível enquanto um aviso é editado, como nas outras abas.
- **Ordem do episódio por data:** episódios com a mesma data aparecem na ordem em que o banco devolve.
- **Login real não conferido:** a conferência foi com rotas interceptadas; a real é a Tarefa 8.
