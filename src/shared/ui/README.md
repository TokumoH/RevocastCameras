# src/shared/ui

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-shared-ui |
| Título | `ui` |
| Tipo | código · componentes visuais |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/shared/ui/README.md` |
| Arquivos | `README.md`, `Logo.tsx`, `Cartao.tsx`, `Mensagem.tsx`, `Abas.tsx`, `BarraDeProgresso.tsx`, `PainelDeComandos.tsx`, `CodigoQr.tsx`, `logo.png` |

## Propósito

Componentes visuais reutilizáveis e o logo do RevoCast. Desde a Tarefa 7 da E3, também o `PainelDeComandos` (os comandos por toque do `/controle`, reaproveitado pela aba Ao vivo na Tarefa 9) e, desde a Tarefa 8 da E3, o `CodigoQr` (o QR de pareamento desenhado em SVG pelo React).

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). O logo foi copiado de `public/images/brand/logo.png` do repositório público [TokumoH/RevoCast_Site](https://github.com/TokumoH/RevoCast_Site); sha256 `22f36ca8c7d65533feab7798e4efa2c1da5a3df8d3a6e0a0ae683781585be63f`, conferido com um clone anônimo do repositório público. `PainelDeComandos.tsx` veio da Tarefa 7 da E3 ([PLA-004](../../../docs/planos/2026-11-27-e3-ao-vivo-por-toque.md), decisões D9 e D15; registro [VER-041](../../../docs/verificacoes/2026-11-27-041-e3-controle.md)). `CodigoQr.tsx` veio da Tarefa 8 da E3 (decisão D11; registro [VER-042](../../../docs/verificacoes/2026-11-27-042-e3-aba-ao-vivo-dispositivos.md)).

## Organização

- Um componente por arquivo, em PascalCase.
- `logo.png` fica aqui (e não em `public/`) para ser importado pelo código e empacotado pelo Vite com nome de conteúdo.

## Por que esta organização

`Cartao`, `Logo` e `Mensagem` evitam repetir a mesma estrutura nas telas (a `TelaProvisoria`, que fazia o mesmo para as telas provisórias, saiu na Tarefa 7 da E3, quando a última delas virou real; VER-041). O logo fora de `public/` não leva README ao site publicado.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Logo em `public/` | A pasta é copiada inteira para o site, inclusive o README exigido pelo `check-docs` |
| Logo como SVG redesenhado | Mudaria a marca; usa-se o arquivo oficial |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`Cartao.tsx`](Cartao.tsx) | `Cartao({ tom, children })`: cartão-adesivo (tom `rosa`, `ciano` ou `areia`) |
| [`Logo.tsx`](Logo.tsx) | `Logo()`: marcação do logo (120 x 117, alt "RevoCast") |
| [`Mensagem.tsx`](Mensagem.tsx) | `Mensagem({ tom, children })`: aviso com tom `info` (`role="status"`, fundo ciano) ou `erro` (`role="alert"`, fundo rosa); desde a Tarefa 4 da E1 |
| [`Abas.tsx`](Abas.tsx) | `Abas({ abas, ativa, aoEscolher, children })`: abas acessíveis (padrão Tabs do WAI-ARIA, ativação automática): `tablist`, um `tab` por aba com `aria-selected` e `aria-controls`, um `tabpanel` por aba com `aria-labelledby` (só o ativo recebe o conteúdo; os outros ficam vazios e `hidden`); setas, Home e End trocam de aba; desde a Tarefa 5 da E1 |
| [`BarraDeProgresso.tsx`](BarraDeProgresso.tsx) | `BarraDeProgresso({ fracao, rotulo })`: `<progress max={1}>` com `aria-label` e a porcentagem visível ao lado (escondida do leitor de tela); fração presa entre 0 e 1, `NaN` vira 0; desde a Tarefa 5 da E2 |
| [`PainelDeComandos.tsx`](PainelDeComandos.tsx) | `TEXTO_DOS_COMANDOS` (frases fixas, inclusive as respostas do envio), `TEXTO_DO_MOTIVO` (uma frase fixa por motivo de `MOTIVOS_DO_RESULTADO`) e `PainelDeComandos({ episodio, listas, estadoNoAr, pedidoDoUltimo?, habilitado, enviar })` (`listas` no tipo `ListasDoAoVivo` do domínio, `domains/aovivo/comandos.ts`): estado (selo "AO VIVO"/"TESTE", título, cena pelo nome de exibição da lista ou o nome do OBS, aviso no ar pelo título da lista, "Último"), avisos (▶ por aviso, "Próximo aviso", "Ocultar aviso"), sons (emoji e rótulo), cenas e CLIPE/MARCAR, botões `botao-grande` desabilitados sem `habilitado`, resposta do envio numa `Mensagem` (uma região viva só, o `role="alert"` dela); todo texto de fora é texto React; desde a Tarefa 7 da E3 |
| [`CodigoQr.tsx`](CodigoQr.tsx) | `MARGEM_DO_QR` (4 módulos) e `CodigoQr({ matriz, rotulo })`: `<svg role="img" aria-label>` com `viewBox` que inclui a zona quieta e um `<path>` só (um retângulo por sequência escura de cada linha), montado pelo React a partir da matriz de `matrizDoQr` (`shared/infra/qr.ts`); não aceita texto nem SVG pronto; cores fixas `--qr-fundo`/`--qr-modulo` nos dois modos; desde a Tarefa 8 da E3 |
| [`logo.png`](logo.png) | Logo do RevoCast (887 x 864) |

## Lógica

`Logo` importa `logo.png`; `NaoEncontrada` usa `Cartao` e `Logo` direto; as telas de acesso (`app/telas/EstadosDeAcesso.tsx`) usam `Cartao`, `Logo` e `Mensagem`; o painel (`app/telas/Painel.tsx`) usa `Cartao`, `Logo` e `Abas`, e a aba Membros usa `Mensagem`; a aba Biblioteca usa `Mensagem` e `BarraDeProgresso` (uma barra por envio da fila); o `/controle` (`app/telas/Controle.tsx`) usa `Cartao`, `Logo`, `Mensagem` e `PainelDeComandos`, que usa `Mensagem` e só conhece tipos do domínio (`domains/aovivo`, `domains/preparacao`): recebe as listas, o estado no ar e a função `enviar` do `useAoVivo` (`app/`), sem saber de canal nem de Supabase. a aba Ao vivo (`app/telas/AbaAoVivo.tsx`) usa `Mensagem` e `CodigoQr` (a matriz vem de `shared/infra/qr.ts`; o componente não importa a biblioteca de QR). `Abas` não sabe de papel nem de etapa: quem escolhe as abas e o conteúdo é a tela.

## Exemplo

Para um cartão rosa: `<Cartao tom="rosa">…</Cartao>`. Para um aviso de erro: `<Mensagem tom="erro">O Google não concluiu o login. Tente de novo.</Mensagem>`. Para abas: `<Abas abas={[{ id: 'a', rotulo: 'A' }, { id: 'b', rotulo: 'B' }]} ativa={ativa} aoEscolher={setAtiva}>{conteúdo da aba ativa}</Abas>`.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Não há subdiretórios.

## Riscos

- `TelaProvisoria.tsx` foi apagado na Tarefa 7 da E3 (VER-041): ficou sem uso quando o `/controle`, a última tela provisória, virou real. A aba Ao vivo do painel dizia "Em construção — etapa E3" num `<p>` próprio (`Painel.tsx`) até a Tarefa 8, quando virou real (VER-042).
- `PainelDeComandos` não desabilita os botões durante um envio: dois toques rápidos mandam dois comandos com `id` diferentes (o palco segura um clipe pendente por vez, D9). As frases estão em `TEXTO_DOS_COMANDOS` e `TEXTO_DO_MOTIVO` e repetidas em `app/telas/Controle.test.tsx`, no README de `app/telas/` e no VER-041.
- `CodigoQr` testado em jsdom (forma do SVG e do caminho); a leitura por um celular real e o tamanho na tela de 320 px ficam para a conferência da Tarefa 10 (VER-042).
- `logo.png` tem cerca de 470 kB; vale otimizar se pesar no carregamento (não medido).
