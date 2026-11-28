# src/shared/styles

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-shared-styles |
| Título | `styles` |
| Tipo | código · estilos |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/shared/styles/README.md` |
| Arquivos | `README.md`, `tokens.css`, `base.css` |

## Propósito

Identidade visual do RevoCast: tokens (cores, medidas, fontes) e base (fundo de papel pontilhado, cartão e botão), em modo claro e escuro.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). Os tokens do modo claro (cores, borda, sombra, fontes) vêm do `src/shared/styles/tokens.css` do site público [TokumoH/RevoCast_Site](https://github.com/TokumoH/RevoCast_Site); o valor de `--dots` vem do `base.css` do site; `--card`, `--on-accent` e a versão escura são deste projeto (o site não tem modo escuro).

## Organização

- `tokens.css`: variáveis CSS (inclui `--on-accent`, texto sobre rosa e ciano); `@media (prefers-color-scheme: dark)` redefine as que mudam.
- `base.css`: reset, corpo, tipografia e as classes `.cartao`, `.botao` e `.tela`; desde a Tarefa 4 da E1, `.botao--contorno`, `.mensagem`, `.mensagem--erro` e `.cabecalho-membro` (com `__email` e `__papel`); desde a Tarefa 5, `.tela--larga`, `.abas` (com `__lista` e `__painel`), `.aba`, `.aba--ativa`, `.membros` (com `__incluir`; `position: relative` para segurar as regiões de aviso vazias, que usam `.so-leitor`), `.campo`, `.tabela-rolavel`, `.tabela` (com `__email`, `__fraco`, `__acoes` e `__aviso`), `.botao--pequeno`, `.botao:disabled`, `.etiqueta` e `.so-leitor`; desde a Tarefa 5 da E2, `.biblioteca`, `.uso` (com `__alerta`), `.envio` (com `--arrastando`, `__rotulo` e `__dica`), `.fila` (com `__nome`, `__erro` e `__aviso`), `.barra-de-progresso`, `.lista-de-midias` (com `__cabeca`, `__nome`, `__campos`, `__volume` e `__confirmacao`), `.campo--curto` e `.previa`; desde a Tarefa 6 da E2, `.cenas`, `.gestos-aba` (os dois com `position: relative`), `.formulario-em-linha` (com `__dica`), `.tabela__nome`, `.tabela__obs` (com `white-space: pre-wrap`), `.tabela input`, `.confirmacao-na-linha`, `.sugestoes` (com `__titulo`), `.gestos` (com `__cabeca`, `__emoji`, `__nome`, `__campos` e `__dica`); desde a Tarefa 7 da E2, `.episodios` (com `__nota`; `position: relative`), `.episodio` (com `__cabeca`), `.campo--data`, `.avisos`, `.aviso-cartao` (com `--editando`, `__cabeca`, `__ordem`, `__titulo`, `__duracao`, `__texto` com `white-space: pre-line`, `__link`, `__url`, `__fraco`, `__imagem` e `__nome`), `.aviso-formulario` (com `__linha`) e `.campo textarea` (na regra de `.campo input`, com `resize: vertical` à parte). Desde a Tarefa 6 da E3 (registro [VER-040](../../../docs/verificacoes/2026-11-27-040-e3-telas-de-dispositivo.md)): `.tela-de-dispositivo` (rótulo e mensagens que quebram em 320 px), `html.palco, html.palco body` com fundo transparente e `html.palco` com `color-scheme: light` (a classe vem do script clássico do `index.html`, antes da primeira pintura, N2; desde a rodada 1 o mesmo script põe `style.colorScheme = 'light'` no `<html>`, então o esquema claro vale já antes do CSS), `.palco-no-ar` (camada fixa que não captura o ponteiro, menos os filhos), `.aviso-no-ar` (com `__titulo`, `__texto` em `white-space: pre-line`, `__link` e `__imagem`), `.selo-do-palco` e `.config-do-palco` (com `__aviso` e `__dica`). Desde a Tarefa 7 da E3 (registro [VER-041](../../../docs/verificacoes/2026-11-27-041-e3-controle.md)): `.tela.controle` (conteúdo no topo), `.comandos` (com `__estado`, `__cabeca`, `__titulo`, `__grupo`, `__lista` e `__lista--coluna`), `.selo-no-ar` (com `--ao-vivo`) e `.botao-grande` (pelo menos 44 × 44 px, `touch-action: manipulation`; o toque é sinalizado pelo `:active` do `.botao` e o foco pelo `:focus-visible`, nunca só pelo `hover`). Desde a Tarefa 9 da E3 (registro [VER-043](../../../docs/verificacoes/2026-11-27-043-e3-aba-ao-vivo-episodio.md)): `.ao-vivo` (as seções da aba em coluna), `.episodio-ao-vivo` (com `__acoes` e `__confirmacao`), `.episodio-no-ar` (com `__titulo`), `.checklist` (com `__fixo`, `__automatico`, `__item` com `position: relative` e `--pronto`/`--pendente`, `__texto` e `__sinal`) e `.comandos-do-painel`; tudo com `min-width: 0`, quebra de linha e `overflow-wrap: anywhere`, para nada estourar em 320 px. Desde a Tarefa 4 da E4 (registro [VER-052](../../../docs/verificacoes/2026-11-28-052-e4-camera-tela-preta.md)): `.tela-preta` (o `/camera` pareado; fundo `#000`, exceção declarada como o transparente do palco, e texto em `--texto-na-tela-preta`, token igual nos dois modos, 5,7:1 sobre o preto, desde a rodada 1), `.toque-da-camera` (área de toque do tamanho da tela), `.camera-no-ar`, `.ponto-da-camera` (com `--cinza`, `--ciano` e `--rosa`, pelas variáveis dos tokens), `.status-da-camera` (com `--instrucoes`), `.botao-da-camera` (mínimo de 44 px) e `.previa-da-camera` (`object-fit: contain`, `max-width: 100%`); na coluna `.camera-no-ar`, só a prévia encolhe (`flex-shrink: 0` nos outros filhos, `flex: 0 1 auto` e `min-height: 0` na prévia), para o botão ficar na tela com ela baixa ou deitada; desde a rodada 2 (R2-N1), a coluna tem `overflow-y: auto` e recebe o toque (fora dos botões, vale como toque na tela), para o botão ficar alcançável por rolagem quando nem assim cabe (celular deitado com as barras do navegador). `justify-content: safe center`: num Safari sem `safe`, a declaração cai e a coluna fica no topo (seguro). Desde a Tarefa 5 da E4 (VER-053), no fim do arquivo, o `/obs/camera`: `html.obs-camera, html.obs-camera body` transparentes e `html.obs-camera { color-scheme: light }` (a classe vem do mesmo script do `index.html` que põe a `palco`), `.obs-camera-no-ar` (fixa, tela cheia) e `.video-da-obs-camera` (tela cheia, `object-fit: contain`, fundo transparente); o selo reusa o `.selo-do-palco`. No fim do arquivo para não deslocar as âncoras de registros antigos.

## Por que esta organização

Paleta num arquivo só: mudar a identidade é mudar `tokens.css`. O modo escuro troca papel e tinta e mantém rosa e ciano.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Tailwind ou biblioteca de componentes | Dependência a mais; o visual é pequeno e já definido pelo site |
| CSS dentro de cada componente | Espalha os tokens |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`tokens.css`](tokens.css) | Cores `#1b1b22`, `#fffaf4`, `#d83868`, `#27bfe8`, `#d8b888`, borda 3 px, sombra dura, fontes Lilita One, Nunito e Caveat; versão escura; desde a Tarefa 8 da E3, `--qr-fundo` (`#ffffff`) e `--qr-modulo` (`#1b1b22`), iguais nos dois modos; desde o VER-052 (rodada 1, N3), `--texto-na-tela-preta` (`#858589`, igual nos dois modos) |
| [`base.css`](base.css) | Reset, tipografia, fundo pontilhado, `.cartao`, `.botao`, `.tela`, `.botao--contorno`, `.mensagem`, `.mensagem--erro`, `.cabecalho-membro`; abas, formulário e tabela da Tarefa 5 da E1 (`.tela--larga`, `.abas`, `.aba`, `.campo`, `.tabela-rolavel`, `.tabela`, `.botao--pequeno`, `.etiqueta`, `.so-leitor`); aba Biblioteca da Tarefa 5 da E2 (`.biblioteca`, `.uso`, `.envio`, `.fila`, `.barra-de-progresso`, `.lista-de-midias`, `.previa`); abas Cenas e Gestos da Tarefa 6 (`.cenas`, `.gestos-aba`, `.formulario-em-linha`, `.confirmacao-na-linha`, `.sugestoes`, `.gestos`); aba Episódios da Tarefa 7 (`.episodios`, `.episodio`, `.avisos`, `.aviso-cartao`, `.aviso-formulario`); rotas de dispositivo e palco da Tarefa 6 da E3 (`.tela-de-dispositivo`, `html.palco`, `.palco-no-ar`, `.aviso-no-ar`, `.selo-do-palco`, `.config-do-palco`); `/controle` da Tarefa 7 da E3 (`.tela.controle`, `.comandos`, `.selo-no-ar`, `.botao-grande`); aba Ao vivo da Tarefa 8 da E3 (`.dispositivos`, `.link-de-pareamento`, `.qr`) e da Tarefa 9 (`.ao-vivo`, `.episodio-ao-vivo`, `.episodio-no-ar`, `.checklist`, `.comandos-do-painel`); `/camera` da Tarefa 4 da E4 (`.tela-preta`, `.toque-da-camera`, `.camera-no-ar`, `.ponto-da-camera`, `.status-da-camera`, `.botao-da-camera`, `.previa-da-camera`); `/obs/camera` da Tarefa 5 da E4 (`html.obs-camera`, `.obs-camera-no-ar`, `.video-da-obs-camera`; VER-053) |

## Lógica

`main.tsx` importa `tokens.css` e depois `base.css`; todas as cores de `base.css` vêm dos tokens (além das palavras-chave `transparent` e `inherit` e do `#000` da tela preta do `/camera`, exceção declarada no VER-052; o `/obs/camera` usa só `transparent`, como o palco); o texto do `.botao` usa `--on-accent`, igual nos dois modos. As fontes são carregadas pelo `index.html` (Google Fonts).

## Exemplo

Para ver o modo escuro: abrir o app com o sistema em tema escuro (ou emular `prefers-color-scheme: dark` nas ferramentas do navegador).

## Verificação

- As classes da Tarefa 4 da E1 usam só variáveis de `tokens.css`; conferidas no Chromium (Playwright) em claro e escuro, a 390 px de largura (registro VER-018).
- As classes da Tarefa 5 da E1 também usam só variáveis de `tokens.css`; conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal (a tabela rola dentro de `.tabela-rolavel`), o cartão não estoura e os painéis `hidden` das abas não ocupam espaço (registro VER-019).
- As classes da Tarefa 5 da E2 usam só variáveis de `tokens.css` (além de `transparent`); conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal, nenhum elemento da aba passa da borda do cartão e a miniatura não é ampliada além do tamanho natural (registro [VER-028](../../../docs/verificacoes/2026-11-26-028-e2-aba-biblioteca.md)).
- As classes da Tarefa 6 da E2 usam só variáveis de `tokens.css`; conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal, nada passa da borda do cartão e a tabela de cenas rola dentro de `.tabela-rolavel` em 320 e 390 px (registro [VER-029](../../../docs/verificacoes/2026-11-27-029-e2-cenas-e-gestos.md)).
- As classes da Tarefa 7 da E2 usam só variáveis de `tokens.css`; conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal, nada passa da borda do cartão (título sem espaços, link longo e texto com quebras de linha nos cartões) e a tabela de episódios rola dentro de `.tabela-rolavel` em 320 e 390 px (registro [VER-030](../../../docs/verificacoes/2026-11-27-030-e2-episodios-e-avisos.md)).
- As classes da Tarefa 6 da E3 usam só variáveis de `tokens.css` (além de `transparent`); o teste `palco-sem-piscar` (`src/app/telas/PalcoNoAr.test.tsx`) confere a regra `html.palco, html.palco body { background: transparent }`. A largura de 320 px foi conferida só pelas regras (`max-width` com `calc(100% - …)`, `overflow-wrap: anywhere`), sem navegador; a conferência visual fica para a Tarefa 10 (registro [VER-040](../../../docs/verificacoes/2026-11-27-040-e3-telas-de-dispositivo.md)).
- As classes da Tarefa 7 da E3 usam só variáveis de `tokens.css`; o mínimo de 44 px vem de `min-height`/`min-width` no `.botao-grande` (o `.botao` de 20 px com 10 px de preenchimento e borda de 3 px já dá 50 px de altura); 320 px conferido só pelas regras (`flex-wrap`, `minmax(0, 1fr)`, `overflow-wrap: anywhere`, `max-width: 100%`), sem navegador; a conferência visual fica para a Tarefa 10 (registro [VER-041](../../../docs/verificacoes/2026-11-27-041-e3-controle.md)).
- As classes da Tarefa 8 da E3 usam só variáveis de `tokens.css`; o QR tem cores próprias e fixas (`--qr-fundo`, `--qr-modulo`), porque os leitores de QR esperam módulos escuros sobre fundo claro também no modo escuro. 320 px conferido só pelas regras (`grid-template-columns: minmax(0, 1fr)`, `flex-wrap`, `.qr` com `width: 280px; max-width: 100%`, rótulo com `overflow-wrap: anywhere`, link num campo que rola por dentro), sem navegador; a conferência visual fica para a Tarefa 10 (registro [VER-042](../../../docs/verificacoes/2026-11-27-042-e3-aba-ao-vivo-dispositivos.md)).
- As classes da Tarefa 4 da E4 usam só variáveis de `tokens.css` (além de `transparent` e do `#000` da tela preta; o teste `css-da-camera` confere as cores, a regra de encolher e o contraste do token, de pelo menos 4,5:1). Medidas no Chromium do ambiente (Playwright, fora do repositório), claro e escuro, em 320×480, 320×568, 360×640, 568×320, 640×360, 844×390 e, desde a rodada 2, 568×260 e 568×230 (deitado com as barras do Safari), com a frase da D6, a bateria e a prévia em pé, com a frase comum e a prévia deitada, e com as instruções sem Wake Lock: `scrollWidth` igual à largura, status a partir do topo e o botão de 44 px inteiro dentro de `innerHeight` e no topo do empilhamento em todas, direto ou, em 568×260 e 568×230 com as instruções sem Wake Lock, depois de rolar a coluna; fundo sempre `#000` (registro VER-052, rodadas 1 e 2; a primeira medição só conferiu a largura).
- As classes da Tarefa 5 da E4 usam só `transparent` (nenhuma cor); o teste `obs-camera-sem-piscar` (`src/app/telas/ObsCameraNoAr.test.tsx`) confere `html.obs-camera, html.obs-camera body { background: transparent }`, o `color-scheme: light` e o `object-fit: contain` sem fundo do vídeo (registro VER-053). A transparência real na Fonte é do passo do responsável (Tarefa 7).
- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Contraste medido (WCAG 2.x): texto `--on-accent` `#1b1b22` sobre o rosa `#d83868` dá 3,82:1, abaixo do AA de 4,5:1 para texto normal (o `.botao` usa 20 px, peso 400); o site do RevoCast usa `#fff` sobre o mesmo rosa, 4,48:1, também abaixo. Texto escuro sobre o ciano (7,91:1) e sobre o papel (16,5:1) passa. Decisão pendente do responsável: manter, escurecer o rosa ou subir o botão para texto grande (24 px, limite 3:1). Modo escuro conferido a olho.
- O `:focus-visible` (`outline: 3px solid var(--cyan)`, `base.css:17`) dá 2,09:1 sobre o papel `#fffaf4`, 2,16:1 sobre o branco do cartão e 1,65:1 sobre o rosa-claro: abaixo de 3:1 (WCAG 1.4.11) no modo claro. Herdado do site. Decisão pendente do responsável (por exemplo, contorno em `var(--ink)` ou duplo).
- Palco transparente (VER-040): a transparência real depende da Fonte de navegador do OBS (CEF) pintar o fundo da página como transparente; o `color-scheme: light` em `html.palco` evita o fundo escuro padrão do Chromium com o sistema em tema escuro, mas o efeito do `<meta name="color-scheme" content="light dark">` dentro do OBS só é conferido num OBS real (Tarefa 10).
- `/obs/camera` transparente (VER-053): o mesmo risco do palco (o CEF do OBS pintar o fundo da página como transparente, conferido só num OBS real); `object-fit: contain` deixa faixas transparentes quando a proporção do vídeo difere da Fonte (o recorte e a posição são do OBS, na transformação da Fonte).
- Sem as fontes (offline), cai nas alternativas do `font-family`.
- `.abas__painel` usa `display: grid`, que venceria o `[hidden]` do navegador; a regra `.abas__painel[hidden] { display: none; }` é o que esconde os painéis inativos (visto na conferência da Tarefa 5). Toda classe nova com `display` num elemento que pode ficar `hidden` precisa da mesma regra.
- `.so-leitor` usa `position: absolute`; dentro de um contêiner com rolagem, o contêiner precisa de `position: relative` (como `.tabela-rolavel`), senão o rótulo escondido alarga a página.
