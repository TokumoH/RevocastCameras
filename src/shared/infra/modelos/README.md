# src/shared/infra/modelos

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-shared-infra-modelos |
| Título | `modelos` |
| Tipo | dados · modelo de terceiros versionado (com licença e aviso) |
| Data | 2026-11-28 |
| Usuário responsável | TokumoH |
| Status | ativo |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/shared/infra/modelos/README.md` |
| Arquivos | `README.md`, `gesture_recognizer.task`, `LICENSE-APACHE-2.0.txt`, `NOTICE.txt` |

## Propósito

Guardar no repositório o modelo de reconhecimento de gestos da mão do MediaPipe (`gesture_recognizer.task`), servido pelo próprio app (mesma origem, sem CDN externo em produção), junto com o texto da licença Apache-2.0 e o aviso do que é redistribuído. O worker do reconhecedor (Tarefa 6 da E5) importa o modelo por `?url` (nome com hash, em `assets/` do build), confere o SHA-256 com `SHA256_DO_MODELO` de [`../integridadeDosGestos.ts`](../integridadeDosGestos.ts) e o entrega ao MediaPipe como `modelAssetBuffer`. O build da Vercel não baixa nada.

## Origem

Criado na Tarefa 5 da etapa E5 ([PLA-006](../../../../docs/planos/2026-11-28-e5-gestos.md), decisão D9 e revisão 1, N8; registro [VER-062](../../../../docs/verificacoes/2026-11-28-062-e5-dependencia-e-modelo.md)). O DES-001 §11 escolheu "Modelo e WASM servidos pelo próprio app (sem CDN externo em produção)". O modelo foi baixado **uma vez**, em 2026-11-28, da fonte oficial que o plano cita (F10): `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`; 8 373 440 bytes e SHA-256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`, iguais ao tamanho e ao hash publicados (F10). A licença foi baixada de `https://www.apache.org/licenses/LICENSE-2.0.txt` no mesmo dia (11 358 bytes, SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`). O pacote `@mediapipe/tasks-vision` 1.2.3 não traz arquivo `LICENSE` (só `"license": "Apache-2.0"` no `package.json`), e o WASM e o modelo são redistribuídos pelo deploy: a Apache-2.0, §4(a), pede que quem recebe a obra receba também a cópia da licença. Por isso, desde a rodada 1 do VER-062 (I1), o build emite `LICENSE-APACHE-2.0.txt` e `NOTICE.txt` em `dist/licencas/` (plugin `revocast:licencas-no-deploy` do `vite.config.ts`, a partir dos arquivos daqui, sem segunda cópia na fonte), servidos em `/licencas/` pelo deploy. A §4(d) (repassar o NOTICE da obra) não se aplica: o pacote não traz NOTICE; o `NOTICE.txt` daqui é um aviso nosso de atribuição.

## Organização

- `gesture_recognizer.task`: o arquivo baixado, **sem modificação** (binário; float16, versão 1; classes `None`, `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`, `Victory`, `ILoveYou`).
- `LICENSE-APACHE-2.0.txt`: o texto da licença, sem modificação.
- `NOTICE.txt`: o que é redistribuído (o WASM `vision_wasm_module_internal.wasm`, o carregador `vision_wasm_module_internal.js` e o modelo, sem modificação; o `vision_bundle.mjs` do `@mediapipe/tasks-vision` 1.2.3 em forma de objeto, empacotado e minificado pelo Vite junto com o código do app a partir da Tarefa 6), de quem (Google LLC), sob qual licença, de onde veio e os SHA-256.
- **Atualizar o modelo** (ou a versão do pacote) é um item próprio, num commit só: baixar da fonte oficial em pasta própria fora do repositório; conferir tamanho e SHA-256 com o publicado; copiar para cá; trocar `SHA256_DO_MODELO` (ou `SHA256_DO_WASM`) em `../integridadeDosGestos.ts`, o tamanho no teste `integridade-do-modelo`, o `NOTICE.txt` e este README; registrar em `docs/verificacoes/`. Os testes `integridade-do-modelo` e `integridade-do-wasm` reprovam se o arquivo e a constante mudarem separados.

## Por que esta organização

O modelo, a licença e o aviso ficam lado a lado, na pasta das fabricações que os usam (`shared/infra`), para que quem veja um veja os outros; o hash fixo no código e o teste que lê o arquivo amarram os bytes versionados à conferência em tempo de execução.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Baixar o modelo do `storage.googleapis.com` em tempo de execução | contraria o DES-001 §11 e a D9 (tudo da própria origem); depende de um host externo a cada aparelho |
| Baixar o modelo no build da Vercel | o build passaria a depender de rede e de um arquivo que pode mudar; a conferência seria só no build |
| `public/` (sem hash no nome) | o `Cache-Control: immutable` de `/assets/` não valeria; um modelo novo com o mesmo nome ficaria guardado um ano |
| Git LFS | o Vercel por Git e a CI precisariam de LFS; 8,4 MB cabem no repositório |
| Licença só no repositório (ou só no README) | a Apache-2.0, §4(a), pede a cópia da licença para quem recebe a obra, e quem recebe o WASM e o modelo é o navegador de quem abre o app |
| Cópia em `public/licencas/` | duas cópias da mesma licença e do mesmo aviso na fonte, que podem divergir; o plugin emite os arquivos daqui no build |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`gesture_recognizer.task`](gesture_recognizer.task) | Modelo do MediaPipe Gesture Recognizer (float16, versão 1), 8 373 440 bytes, SHA-256 `97952348…2b0482`, sem modificação |
| [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt) | Texto da Apache License, Version 2.0 (11 358 bytes, SHA-256 `cfc7749b…523d30`) |
| [`NOTICE.txt`](NOTICE.txt) | Aviso: o WASM, o carregador e o modelo sem modificação, e o `vision_bundle.mjs` empacotado pelo build, do `@mediapipe/tasks-vision` 1.2.3 e de Google LLC, sob Apache-2.0, com a origem e os SHA-256; servido em `/licencas/NOTICE.txt` |

## Lógica

1. O build (Vite) copia o `.task` para `assets/` com hash no nome quando o worker o importa por `?url` (Tarefa 6).
2. A Vercel serve `assets/` com `Cache-Control: public, max-age=31536000, immutable` e a rewrite de SPA não pega `/assets/` (`vercel.json`; teste `assets-fora-da-rewrite` em [`../../../app/implantacao.test.ts`](../../../app/implantacao.test.ts)).
3. O worker busca os bytes pela própria origem, chama `conferirSha256(bytes, SHA256_DO_MODELO)` ([`../integridadeDosGestos.ts`](../integridadeDosGestos.ts)) e só entrega o `Uint8Array` ao MediaPipe se bater; senão, situação `falhou` (motivo `integridade`).
4. O build emite `LICENSE-APACHE-2.0.txt` e `NOTICE.txt` em `dist/licencas/` (plugin `revocast:licencas-no-deploy` do `vite.config.ts`); a Vercel os serve como arquivo estático, e a rewrite de SPA não pega `/licencas/` (teste `licencas-no-build` e `assets-fora-da-rewrite`). `vite dev` não os serve.
5. Nos testes, [`../integridadeDosGestos.test.ts`](../integridadeDosGestos.test.ts) lê o arquivo daqui (`integridade-do-modelo`, `licenca-junto-dos-arquivos`); o modelo real nunca roda nos testes de unidade.

## Exemplo

Conferir o arquivo versionado à mão: `sha256sum src/shared/infra/modelos/gesture_recognizer.task` → `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`, e `stat -c %s` → `8373440`. Pelo teste: `npx vitest run src/shared/infra/integridadeDosGestos.test.ts`.

## Verificação

- SHA-256 e tamanho do modelo conferidos antes da cópia (pasta própria no scratchpad) e depois, no repositório; o teste `integridade-do-modelo` confere a cada `npm test`. Sabotagens S2 (um byte trocado), S6 (constante trocada) e S16 (último byte removido) do VER-062 derrubam esse teste; S3, S14 e S15 derrubam `licenca-junto-dos-arquivos`; na rodada 1, as sabotagens do plugin (C1-S1 a C1-S4) derrubam `licencas-no-build` ou `assets-fora-da-rewrite`, e um `vite build` real gerou `dist/licencas/` com os mesmos SHA-256 dos arquivos daqui.
- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`; nenhum subdiretório.

## Riscos

- O modelo real (classes, desempenho, delegado GPU no worker) só roda na Tarefa 9 (Chromium) e nos aparelhos do responsável (F12).
- A compressão da Vercel para o `.task` não é garantida: a lista de tipos comprimidos da documentação traz `wasm`, mas não `octet-stream`, e o tipo com que a Vercel serve um `.task` não foi conferido (F17; premissa do responsável, no deploy).
- 8,4 MB a mais no repositório a cada versão do modelo (o histórico do Git guarda todas).
- Os arquivos de `/licencas/` não têm hash no nome e ficam fora do `immutable` (cache padrão da Vercel); `vite dev` não os serve (só o build).
