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
- `base.css`: reset, corpo, tipografia e as classes `.cartao`, `.botao` e `.tela`; desde a Tarefa 4 da E1, `.botao--contorno`, `.mensagem`, `.mensagem--erro` e `.cabecalho-membro` (com `__email` e `__papel`); desde a Tarefa 5, `.tela--larga`, `.abas` (com `__lista` e `__painel`), `.aba`, `.aba--ativa`, `.membros` (com `__incluir`; `position: relative` para segurar as regiões de aviso vazias, que usam `.so-leitor`), `.campo`, `.tabela-rolavel`, `.tabela` (com `__email`, `__fraco`, `__acoes` e `__aviso`), `.botao--pequeno`, `.botao:disabled`, `.etiqueta` e `.so-leitor`; desde a Tarefa 5 da E2, `.biblioteca`, `.uso` (com `__alerta`), `.envio` (com `--arrastando`, `__rotulo` e `__dica`), `.fila` (com `__nome`, `__erro` e `__aviso`), `.barra-de-progresso`, `.lista-de-midias` (com `__cabeca`, `__nome`, `__campos`, `__volume` e `__confirmacao`), `.campo--curto` e `.previa`.

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
| [`tokens.css`](tokens.css) | Cores `#1b1b22`, `#fffaf4`, `#d83868`, `#27bfe8`, `#d8b888`, borda 3 px, sombra dura, fontes Lilita One, Nunito e Caveat; versão escura |
| [`base.css`](base.css) | Reset, tipografia, fundo pontilhado, `.cartao`, `.botao`, `.tela`, `.botao--contorno`, `.mensagem`, `.mensagem--erro`, `.cabecalho-membro`; abas, formulário e tabela da Tarefa 5 da E1 (`.tela--larga`, `.abas`, `.aba`, `.campo`, `.tabela-rolavel`, `.tabela`, `.botao--pequeno`, `.etiqueta`, `.so-leitor`); aba Biblioteca da Tarefa 5 da E2 (`.biblioteca`, `.uso`, `.envio`, `.fila`, `.barra-de-progresso`, `.lista-de-midias`, `.previa`) |

## Lógica

`main.tsx` importa `tokens.css` e depois `base.css`; todas as cores de `base.css` vêm dos tokens (além das palavras-chave `transparent` e `inherit`); o texto do `.botao` usa `--on-accent`, igual nos dois modos. As fontes são carregadas pelo `index.html` (Google Fonts).

## Exemplo

Para ver o modo escuro: abrir o app com o sistema em tema escuro (ou emular `prefers-color-scheme: dark` nas ferramentas do navegador).

## Verificação

- As classes da Tarefa 4 da E1 usam só variáveis de `tokens.css`; conferidas no Chromium (Playwright) em claro e escuro, a 390 px de largura (registro VER-018).
- As classes da Tarefa 5 da E1 também usam só variáveis de `tokens.css`; conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal (a tabela rola dentro de `.tabela-rolavel`), o cartão não estoura e os painéis `hidden` das abas não ocupam espaço (registro VER-019).
- As classes da Tarefa 5 da E2 usam só variáveis de `tokens.css` (além de `transparent`); conferidas no Chromium em claro e escuro, a 320, 390 e 1280 px: a página não rola na horizontal, nenhum elemento da aba passa da borda do cartão e a miniatura não é ampliada além do tamanho natural (registro [VER-028](../../../docs/verificacoes/2026-11-26-028-e2-aba-biblioteca.md)).
- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- Contraste medido (WCAG 2.x): texto `--on-accent` `#1b1b22` sobre o rosa `#d83868` dá 3,82:1, abaixo do AA de 4,5:1 para texto normal (o `.botao` usa 20 px, peso 400); o site do RevoCast usa `#fff` sobre o mesmo rosa, 4,48:1, também abaixo. Texto escuro sobre o ciano (7,91:1) e sobre o papel (16,5:1) passa. Decisão pendente do responsável: manter, escurecer o rosa ou subir o botão para texto grande (24 px, limite 3:1). Modo escuro conferido a olho.
- O `:focus-visible` (`outline: 3px solid var(--cyan)`, `base.css:17`) dá 2,09:1 sobre o papel `#fffaf4`, 2,16:1 sobre o branco do cartão e 1,65:1 sobre o rosa-claro: abaixo de 3:1 (WCAG 1.4.11) no modo claro. Herdado do site. Decisão pendente do responsável (por exemplo, contorno em `var(--ink)` ou duplo).
- Sem as fontes (offline), cai nas alternativas do `font-family`.
- `.abas__painel` usa `display: grid`, que venceria o `[hidden]` do navegador; a regra `.abas__painel[hidden] { display: none; }` é o que esconde os painéis inativos (visto na conferência da Tarefa 5). Toda classe nova com `display` num elemento que pode ficar `hidden` precisa da mesma regra.
- `.so-leitor` usa `position: absolute`; dentro de um contêiner com rolagem, o contêiner precisa de `position: relative` (como `.tabela-rolavel`), senão o rótulo escondido alarga a página.
