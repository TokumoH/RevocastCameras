# VER-042 — E3, Tarefa 8: aba Ao vivo (1) — dispositivos, pareamento com QR e revogação; aviso de revogação de membro

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-042 |
| Título | Aba Ao vivo real (parte 1): lista de dispositivos, pareamento por QR e por link com contagem de 2 min, detecção do pareamento com aviso à sessão antiga, revogação com aviso pelo canal; o painel abre o `estudio` uma vez; a remoção de um membro avisa a sessão dele |
| Gravidade | alta |
| Tipo | funcionalidade · segurança · dependência nova |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --format=%h -- docs/verificacoes/2026-11-27-042-e3-aba-ao-vivo-dispositivos.md` |
| Arquivos | `package.json`, `package-lock.json`, `src/shared/infra/qr.ts`, `src/shared/infra/qr.test.ts`, `src/shared/ui/CodigoQr.tsx`, `src/app/telas/AbaAoVivo.tsx`, `src/app/telas/AbaAoVivo.test.tsx`, `src/app/telas/Painel.tsx`, `src/app/telas/Painel.test.tsx`, `src/app/telas/AbaMembros.tsx`, `src/app/telas/AbaMembros.test.tsx`, `src/shared/styles/base.css`, `src/shared/styles/tokens.css`, `src/shared/infra/README.md`, `src/shared/ui/README.md`, `src/app/telas/README.md`, `src/shared/styles/README.md`, `docs/verificacoes/README.md`, este registro |

## Problema

Depois da Tarefa 7 ([VER-041](2026-11-27-041-e3-controle.md)), a aba "Ao vivo" do painel ainda dizia "Em construção — etapa E3". Sem ela, a equipe não tinha como:

- parear a câmera, o palco e a câmera do OBS (o banco já gerava códigos desde a Tarefa 3 e as rotas de dispositivo já pareavam desde a Tarefa 6, mas ninguém mostrava o código);
- ver quem está conectado;
- revogar um aparelho perdido.

Além disso, a remoção de um e-mail na aba Membros valia só no banco. A pessoa removida continuava no canal até a renovação do token (até 10 min). O aviso de revogação de membro (PLA-002, D4) tinha ficado para a E3. O painel também não abria o `estudio` (o `useEstudio` da Tarefa 7 previa isso para a Tarefa 8), então não havia por onde mandar os avisos.

## Era proposital?

Sim, era o planejado. O PLA-004 deixa a aba Ao vivo para as Tarefas 8 (dispositivos) e 9 (modo teste, iniciar e encerrar, checklist e comandos). A Tarefa 7 deixou o `<p>Em construção — etapa E3</p>` no `Painel.tsx` até esta tarefa (Riscos do VER-041). Ela também deixou o `useAoVivo` pronto para receber o `estudio` de fora, para o painel abrir um só.

Divergências entre o brief e o código commitado (seguido o código, como pede o processo):

1. **O painel ainda não abria o `estudio`.** O pedido da tarefa dizia "O Painel abre o `estudio` uma vez pelo `useEstudio`", mas o `Painel.tsx` do HEAD `d6ac225` não abria. O brief lista essa mudança no `Painel.tsx` desta tarefa, e ela foi feita aqui (teste `painel-reabre-estudio`).
2. **`criarCodigo` exige `rotulo` e `cameraId`** (`RepositorioDoAoVivo`, Tarefa 4). O brief escreve `criarCodigo({ tipo: 'camera', dispositivoId: <id> })`. A chamada leva os quatro campos, e o teste compara o objeto inteiro. Ao reaproveitar um dispositivo, o rótulo é o dele: a função do banco ignora `p_rotulo` com `p_dispositivo` (migração `20261127124303`, L51–L63).
3. **`tokens.css` fora da lista do brief.** O QR precisa ser escuro sobre claro também no modo escuro, e no modo escuro `--ink` e `--card` se invertem. Por isso entraram dois tokens fixos, `--qr-fundo` e `--qr-modulo`; a restrição global diz que todo estilo novo usa só variáveis de `tokens.css`.
4. **A câmera também mostra o link** num campo só leitura, abaixo do QR. O código continua só no fragmento do link e no QR mostrados na tela. O teste `parear-camera-reusa` prova que o QR desenhado codifica exatamente esse link: o `d` do `<path>` é igual ao de `matrizDoQr(link)`.
5. **Rótulos dos dispositivos novos do OBS:** o brief só dá o da câmera ("Celular de gravação"). Os outros ficaram "Palco do OBS" e "Câmera do OBS".
6. **"Conectado"** exige que a presença em `estudio` tenha a sessão **atual** do dispositivo (`usuarioAnonimoId`) e o `dispositivoId`, não só o `dispositivoId`. Uma sessão antiga, ainda no canal até o corte, declara o mesmo dispositivo e não deve aparecer como "conectado".
7. **Membros: o perfil é relido na remoção.** A pessoa pode ter entrado pela primeira vez depois que a lista foi lida, então o perfil vem de `listarPerfis()` logo depois de `remover`. Se a releitura falhar, vale o perfil da tela (teste `membros-remove-avisa-perfil-relido`).
8. **Área de transferência:** o `Painel` passa `navigator.clipboard.writeText` (ou `null`) à aba, sem campo novo em `Dependencias`. A aba recebe `copiar` por propriedade e é testada com um falso.

## Solução

- **Dependência (D11, decisão (c)):** `lean-qr` 2.7.4, instalada só pelo procedimento do npm 11. O app usa só o `generate()`, atrás de `matrizDoQr` (`src/shared/infra/qr.ts`), com correção mínima M. Texto vazio ou com mais de 300 caracteres lança, e a mensagem nunca repete o texto.
- **Desenho do QR:** `CodigoQr` (`src/shared/ui`) desenha a matriz num `<svg role="img" aria-label>` com zona quieta de 4 módulos e um `<path>` só, montado pelo React. Não há `innerHTML` nem os `extras` da biblioteca.
- **Aba Ao vivo** (`AbaAoVivo.tsx`):
  - **Lista:** cada dispositivo com tipo, rótulo (texto React) e situação: "Conectado", "Desconectado", "Revogado" ou "Nunca pareado", por `situacaoDoDispositivo`.
  - **Gerar código:** "Parear câmera" reaproveita a câmera cadastrada; sem câmera, cria "Celular de gravação". "Link do palco (OBS)" faz o mesmo com o palco. "Link da câmera do OBS" fica desabilitado com "Pareie a câmera antes." até existir uma câmera.
  - **Código na tela (D3):** só no estado do componente. A câmera ganha QR e campo; o OBS, campo e "Copiar link". A contagem "Vale por m:ss" leva a "O código expirou." + "Gerar outro".
  - **Pareamento (D5):** enquanto o código vale, a lista é consultada a cada 3 s. Quando a sessão do dispositivo muda da guardada ao gerar, a sessão antiga é avisada **uma vez** em `estudio` (`revogacao`), a tela diz "📷 Câmera conectada" e o código some.
  - **Revogar:** pede confirmação, chama `revogar(id)` e publica `revogacao` (quando havia sessão) e `dispositivo_mudou`. Sem canal: "Revogado no banco. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos." O código do dispositivo revogado sai da tela.
- **Painel:** obtém o ao vivo uma vez e abre o `estudio` uma vez pelo `useEstudio` (presença de membro; `fechado`/`negado` → um `reavaliar()` e reabertura em 5 s). Passa o `estudio` à aba Ao vivo e `avisarRevogacao` à aba Membros. Nenhuma aba abre outro canal.
- **Membros (D5 com I4):** só a remoção de um e-mail ligado a perfil chama `avisarRevogacao(id do perfil)`. Trocar o papel não avisa, porque os três papéis comandam pelo `/controle`. Se o aviso falhar, a remoção fica e a tela diz "Removido da lista. O aviso pelo canal não saiu; o corte do canal vem em até 10 minutos." (`role="alert"`, com o foco nela pelo mesmo `useLayoutEffect` do VER-033).

## Por que esta solução

- **Componentes e Pure Fabrication:** a biblioteca fica atrás de uma função de infraestrutura (`qr.ts`) que devolve dados (`boolean[][]`), e o desenho é um componente visual que não conhece a biblioteca. Trocar de biblioteca muda só `qr.ts`. O domínio não muda: `linkDePareamento`, `situacaoDoDispositivo` e `ROTULO_DO_TIPO` da Tarefa 1 são reaproveitados.
- **Segurança:**
  - o código vive só no estado da aba: some ao desmontar e não vai para `localStorage`, `sessionStorage`, URL nem `console` (o teste confere o armazenamento e a URL);
  - o SVG é montado com números, não com texto;
  - o aviso da sessão antiga cobre a troca de celular (DES-001 §8);
  - a revogação avisa o canal e, sem canal, diz a verdade: vale no banco, e o corte do canal vem com a renovação do token.
- **Um canal por painel:** o `estudio` aberto no `ConteudoDoPainel` sobrevive à troca de aba (a presença do membro continua). Assim não nascem as duas alças e os dois `reavaliar()` que o VER-041 (Riscos, N5) previa se cada aba abrisse o seu. A Tarefa 9 passa esse mesmo `estudio` ao `useAoVivo`.
- **Detecção por consulta:** o pareamento não publica nada no canal (o dispositivo só publica presença, DES-001 §8), e a lista do banco é a fonte que diz qual sessão é a do dispositivo agora. Consultar a cada 3 s, só enquanto o código vale (no máximo 40 consultas por código), é barato e não depende da presença, que uma sessão antiga ainda pode ter.
- **Contagem pelo relógio local, limitada a 2 min:** se o relógio do computador estiver adiantado ou atrasado, o `expiraEm` do servidor daria uma contagem errada. Por isso vale o restante do servidor quando está entre 0 e 2 min; senão, 2 min a partir de agora.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Codificador de QR próprio | ~400 linhas (modo byte, Reed-Solomon, máscaras, versões) sem um decodificador para provar (D11) |
| `lean-qr/extras/svg` ou `extras/react` | Devolvem SVG em texto ou um componente da biblioteca; o plano exige o `<svg>` montado pelo React, sem `innerHTML` |
| `qrcode` ou outra biblioteca | Têm dependências transitivas ou são maiores; `lean-qr` é MIT, sem dependências e com ~6,9 KB de módulo (3,6 KB gzip) |
| Cada aba abrir o seu `estudio` | Duas alças e dois `reavaliar()` por perda (VER-041, N5), e a presença do membro piscaria a cada troca de aba |
| Detectar o pareamento pela presença | A sessão antiga continua na presença até o corte, e a presença não diz qual sessão é a do dispositivo no banco |
| Guardar o código para reabrir ao voltar à aba | Contraria o D3 (o código existe só no estado do componente) e o foco 2 da revisão |
| Avisar `revogacao` também na troca de papel | I4: os três papéis comandam; quem perde o painel perde-o no banco na hora e na tela na reavaliação seguinte |
| Ligar o e-mail ao perfil só pela lista da tela | Quem entra pela primeira vez depois da leitura ficaria sem aviso; a releitura custa uma consulta e cai na lista da tela se falhar |
| `navigator.clipboard` em `Dependencias` | Mudaria a interface, os falsos e o `dependencias.test.ts` por uma API que só a aba usa; a aba recebe `copiar` por propriedade e é testável |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`package.json`](../../package.json#L35) | 35 | `"lean-qr": "2.7.4"` (versão exata) |
| [`package-lock.json`](../../package-lock.json#L1412-L1420) | 12, 1412–1420 | Só a entrada do `lean-qr` (sem dependências; `bin` `cli.mjs`); os 10 campos `libc` continuam |
| [`src/shared/infra/qr.ts`](../../src/shared/infra/qr.ts#L1-L31) | 1–31 | Novo: `TAMANHO_MAXIMO_DO_TEXTO_DO_QR` (L7) e `matrizDoQr` (L16) |
| [`src/shared/infra/qr.test.ts`](../../src/shared/infra/qr.test.ts#L1-L57) | 1–57 | Novo: `qr-matriz`, `qr-erro-sem-o-texto` |
| [`src/shared/ui/CodigoQr.tsx`](../../src/shared/ui/CodigoQr.tsx#L1-L43) | 1–43 | Novo: `MARGEM_DO_QR` (L5), caminho por sequências escuras (L11) e `CodigoQr` (L35) |
| [`src/app/telas/AbaAoVivo.tsx`](../../src/app/telas/AbaAoVivo.tsx#L1-L465) | 1–465 | Novo: `INTERVALO_DA_CONSULTA_MS` (L13), `TEXTO_DA_ABA_AO_VIVO` (L19), `existente` (L99), `AbaAoVivo` (L126). Também: presença (L198); expiração e consulta de 3 s com aviso único (L213–L246); `gerar` (L249, contagem já na primeira pintura, L280); `revogar` (L291); `aoCopiar` (L314) |
| [`src/app/telas/AbaAoVivo.test.tsx`](../../src/app/telas/AbaAoVivo.test.tsx#L1-L513) | 1–513 | Novo: 17 testes (os 12 do brief e mais 3: `primeiro-pareamento-nao-avisa`, `aviso-da-sessao-antiga-sem-canal`, `revogar-apaga-o-codigo-na-tela`; a falha ao carregar e ao gerar está em `falha-ao-carregar-e-acesso-negado`); da rodada 1: `pareado-e-revogado-nao-conta-como-pareamento` (L358, N2) e `solta-a-presenca-ao-desmontar` (L373, N1) |
| [`src/app/telas/Painel.tsx`](../../src/app/telas/Painel.tsx#L24-L121) | 24–121 | Abas sem `etapa` (L24); ao vivo obtido uma vez, `useEstudio` (L66), `avisarRevogacao` lendo a alça atual (L72), `copiar` (L77); `AbaMembros` com `avisarRevogacao` (L96); `AbaAoVivo` no lugar de "Em construção" (L104) |
| [`src/app/telas/Painel.test.tsx`](../../src/app/telas/Painel.test.tsx#L11-L218) | 11–218 | `afterEach` volta o relógio real (L11); `esperar` (L31); `aba-provisoria` vira `ao-vivo-no-painel` (L53); novo `painel-reabre-estudio` (L75); da rodada 1: `painel-avisa-revogacao-de-membro` (L115, I1) e `painel-oferece-copiar-so-com-area-de-transferencia` (L169, N3) |
| [`src/app/telas/AbaMembros.tsx`](../../src/app/telas/AbaMembros.tsx#L25-L216) | 25–216 | `removidoSemAviso` (L25); `Carga` com os perfis (L40); propriedade `avisarRevogacao` (L61–L67); `escrever` aceita o aviso da ação (L141); remoção com releitura do perfil e aviso (L190–L213); a troca de papel não muda |
| [`src/app/telas/AbaMembros.test.tsx`](../../src/app/telas/AbaMembros.test.tsx#L441-L533) | 441–533 | `membros-remove-avisa` (L441), `membros-remove-avisa-perfil-relido` (L502), `membros-remove-sem-canal-no-painel` (L524) |
| [`src/shared/styles/base.css`](../../src/shared/styles/base.css#L427-L444) | 427–444 | `.dispositivos` (e elementos), `.link-de-pareamento`, `.qr` (até 280 px, `max-width: 100%`, quadrado), `.qr__modulos` |
| [`src/shared/styles/tokens.css`](../../src/shared/styles/tokens.css#L17-L18) | 17–18 | `--qr-fundo`, `--qr-modulo` (iguais nos dois modos) |
| [`src/shared/infra/README.md`](../../src/shared/infra/README.md) | Cabeçalho, Propósito, Origem, Organização, Onde, Verificação, Riscos | `qr.ts` e `qr.test.ts` |
| [`src/shared/ui/README.md`](../../src/shared/ui/README.md) | Cabeçalho, Propósito, Origem, Onde, Lógica, Riscos | `CodigoQr.tsx`; a frase "até a Tarefa 8" passa ao passado |
| [`src/app/telas/README.md`](../../src/app/telas/README.md) | Cabeçalho, Propósito, Origem, Organização, Onde, Exemplo, Riscos | `AbaAoVivo`, `estudio` do `Painel`, aviso da `AbaMembros`; sem aba provisória |
| [`src/shared/styles/README.md`](../../src/shared/styles/README.md) | Onde, Verificação | Classes da aba Ao vivo e tokens do QR |
| [`docs/verificacoes/README.md`](README.md) | Cabeçalho, Onde | Este registro (o exemplo continua 045) |

## Lógica

```mermaid
sequenceDiagram
    participant P as Painel (estudio aberto 1 vez)
    participant A as Aba Ao vivo
    participant B as Banco
    participant C as Celular novo
    participant V as Celular antigo
    A->>B: listarDispositivos() (câmera com sessão S1)
    A->>B: criarCodigo({camera, dispositivoId: câmera})
    B-->>A: código (uma vez), expira em 2 min
    Note over A: QR e link só no estado; "Vale por 2:00"
    C->>B: parear_dispositivo(código) com sessão S2
    loop a cada 3 s enquanto vale
        A->>B: listarDispositivos()
    end
    B-->>A: câmera com sessão S2 ≠ S1
    A->>P: estudio.enviar({revogacao, usuario: S1}) (1 vez)
    P-->>V: aviso: sai dos canais e encerra a sessão
    Note over A: "📷 Câmera conectada"; o QR some
```

| Passo | Antes (VER-041) | Depois |
|---|---|---|
| Aba Ao vivo | "Em construção — etapa E3" | Dispositivos, pareamento e revogação |
| `estudio` no painel | não abria | aberto uma vez, reaberto em 5 s com um `reavaliar()` |
| Trocar o celular da câmera | sem tela | código para o mesmo dispositivo; a sessão antiga é avisada ao parear |
| Revogar | sem tela | `revogar` + `revogacao` + `dispositivo_mudou`; sem canal, a frase dos 10 minutos |
| Remover e-mail com perfil | só no banco | no banco + `revogacao` com o `id` do perfil |
| Trocar papel | só no banco | igual (I4) |
| Sair da aba com código | — | código e QR somem; a consulta de 3 s para |

## Exemplo

- Link de pareamento real com origem de teste: `https://app.revocast.test/camera#` + 43 caracteres = 76 caracteres → QR versão 5 (37 × 37 módulos, 45 com a margem); a 280 px, cada módulo tem ~6,2 px. Um link de 90 caracteres (`…vercel.app/obs/camera#…`) dá a versão 6 (41 módulos); o limite de 300 caracteres dá a versão 13 (69). Sonda com `node` sobre o `generate` instalado.
- `contagem-regressiva`: aba aberta às 12:00:00 (relógio falso), clique às 12:01:00. Desde a primeira pintura aparece só "Vale por 2:00": um `MutationObserver` com `characterDataOldValue` anota cada texto que passou pela tela, e a sabotagem S18, sem a correção, mostra "3:00" por um quadro. Depois vêm "1:59" a +1 s, "1:01" a +59 s, "0:01" de +119 s até +119,999 s e "O código expirou." a +120 s, sem QR e sem o código na página.
- `detecta-pareamento-e-avisa-sessao-antiga`: duas consultas sem troca → nenhum envio; a sessão da câmera passa de `b000…0001` a `b000…0002` → exatamente `[{ evento: 'revogacao', usuario: 'b000…0001', remetente: <id do membro> }]`. Depois de mais 9 s, nenhuma consulta nova e nenhum envio novo.
- `membros-remove-avisa`: três trocas de papel de `ana` (apresentadora, admin, equipe) → 0 avisos; remover `bia` (sem perfil) → 0; remover `cris` (perfil `Cris@Revocast.test`) → `avisarRevogacao('id-cris')`; com `'falhou'`, `ana` sai da lista e a frase dos 10 minutos aparece com o foco nela.

### Dependência nova (D11, decisão (c))

| Item | Valor |
|---|---|
| Pacote | `lean-qr` 2.7.4, licença MIT ("Copyright (c) 2021-2025 David Evans", `LICENSE` instalado) |
| Publicação | 2026-09-07T13:30:08Z (`npx -y npm@11 view lean-qr time --json`); a anterior, 2.7.3, em 2026-08-13 |
| Comando | `npx -y npm@11 install lean-qr@2.7.4 --save-exact --ignore-scripts --before=2026-11-13` (npm 11.21.2; 2026-11-13 é 14 dias antes de 2026-11-27 e depois da publicação) |
| Tamanho | 68 780 bytes desempacotado, 20 arquivos (`dist.unpackedSize`, `dist.fileCount`); `index.mjs` 6 900 bytes, 3 563 bytes gzip |
| Dependências | nenhuma (sem `dependencies` no `npm view`; o lock não ganhou nenhuma entrada além dela) |
| Diff do lock | +10 linhas: `"lean-qr": "2.7.4"` nas dependências da raiz (L12) e a entrada `node_modules/lean-qr` (L1412–L1420: `version`, `resolved` do registro npm, `integrity` sha512, `license: MIT`, `bin: { "lean-qr": "cli.mjs" }`); nenhuma linha removida; `grep -c '"libc"'` = 10 antes e depois |
| Auditoria | `npm run check-deps-audit` → `check-deps-audit: 0 erro(s) — 0 aviso(s)`; o próprio install disse "found 0 vulnerabilities" |
| Uso | só `generate` e `correction` de `lean-qr` em `src/shared/infra/qr.ts`; nenhum `extras`, `webcomponent` ou `nano`; o `cli.mjs` vai para `node_modules/.bin` e não é usado |
| Pacote do app | o `App.tsx` importa todas as telas de forma estática, então o módulo (~3,6 KB gzip, sem efeito ao importar) entra também nas rotas de dispositivo, inclusive o `/obs/palco` dentro do OBS (rodada 1, N4; ver Riscos) |

## Verificação

| Etapa | O que | Comando | Resultado |
|---|---|---|---|
| Passo 1 | Dependência | ver "Dependência nova" acima | diff do lock só com o `lean-qr`, `libc` 10 = 10, auditoria 0 erros |
| Passo 2 (TDD) | Testes antes do código | `npx vitest run src/shared/infra/qr.test.ts`, `src/app/telas/AbaAoVivo.test.tsx`, `AbaMembros.test.tsx -t membros-remove-avisa` | **FAIL**: módulos `qr`, `CodigoQr` e `AbaAoVivo` inexistentes; `membros-remove-avisa` falha com "expected vi.fn() to be called 1 times, but got 0 times"; `codigo-some-ao-sair-da-aba` falha até o painel ligar a aba |
| Passo 3 | Implementação | `npx vitest run` dos três arquivos de tela e do `qr.test.ts` | passam. Ajustes nos próprios testes: o payload enviado não leva `evento` (é o nome do evento), a conta da contagem e o rótulo da seção, que repetia o do campo |
| Autoverificação 1 | Leitura do diff | — | 4 achados, todos corrigidos e cobertos: (a) revogar durante uma geração deixava "Gerando o código…" preso (os botões de revogar agora ficam desabilitados enquanto gera; saiu o `ultimaGeracao++` da revogação); (b) a primeira pintura do código podia mostrar mais de 2:00 (o relógio só anda com código; `setAgora` em `gerar`; teste e S18); (c) o perfil do membro vinha só da lista da tela (releitura; teste e S17); (d) escolha do dispositivo reaproveitado reescrita por tipo, sem mudar o comportamento |
| Suíte | Tudo | `npm test` e `npm run check` | 58 arquivos: **2154 testes** antes da autoverificação, **2155** depois dela (mais `membros-remove-avisa-perfil-relido`) e **2159** depois da C1 (mais 4); 0 falhas |
| Sabotagens | Em memória: um plugin do Vite troca o trecho exato só no que o Vitest carrega, com `fsModuleCache: false`, e o trecho é conferido 1 vez. `sha256sum` dos nove arquivos antes e depois: iguais | `rodar.sh` (scratchpad `t8-sab/`) | tabela abaixo; as 18 derrubam (e as R1 a R6 da C1) |
| `npm run check` | Último ato da entrega (repetido depois da C1) | `npm run check` | 0 erros (`typecheck`; 58 arquivos e 2159 testes depois da C1; `check-docs` 73 arquivos .md e 42 registros; `check-doc-secrets` 230 arquivos; `rpc:grants-check` e `data-api:check` 4 migrações; `check-deps-audit` 0 erros e 0 avisos) |
| R1 | Revisão independente 1, sobre a primeira versão | leitura do diff, pacote `lean-qr` conferido, sabotagens R1 a R6 numa cópia (cache desligado) | spec ✅ (8 divergências aceitas); reprovada só por teste: I1 (ligação do aviso de revogação de membro no painel sem teste, efeito em segurança) e 5 nits; código de produção correto. Corrigidos em C1 |
| C1 | Correções da rodada 1 (só testes e documentação; nenhum código de produção mudou): I1 `painel-avisa-revogacao-de-membro`; N1 `solta-a-presenca-ao-desmontar`; N2 `pareado-e-revogado-nao-conta-como-pareamento`; N3 `painel-oferece-copiar-so-com-area-de-transferencia`; N4 e N5 em Riscos (N4 também na tabela da dependência) | sabotagens R1 a R6 da revisão, em memória com `fsModuleCache: false`, `sha256sum` dos nove arquivos igual antes e depois (`rodar.sh`, scratchpad `t8-sab/`); `npm run check` | as seis derrubam (tabela abaixo); `npm run check` 0 erros |
| R2 | Re-revisão focada nas correções C1 | R1 a R6 e R4b repetidas, suíte completa com cache desligado (2 159 testes), `sha256sum` do código de produção igual ao da rodada 1 | **limpa**: nenhum achado |

| # | Sabotagem | Teste(s) que derrubou |
|---|---|---|
| S1 | Criar câmera nova mesmo com uma cadastrada | `parear-camera-reusa`, `detecta-pareamento-e-avisa-sessao-antiga`, `aviso-da-sessao-antiga-sem-canal`, `revogar-apaga-o-codigo-na-tela` |
| S2 | Guardar o código num módulo e mostrá-lo de novo ao montar | `codigo-some-ao-sair-da-aba` |
| S3 | Não avisar a sessão antiga no pareamento | `detecta-pareamento-e-avisa-sessao-antiga`, `aviso-da-sessao-antiga-sem-canal` |
| S4 | Não avisar `revogacao` na revogação | `revogar-avisa` |
| S5 | Avisar mesmo sem perfil | `membros-remove-avisa` |
| S6 | Avisar na troca de papel | `membros-remove-avisa` |
| S7 | Falha do aviso desfaz a remoção (lança) | `membros-remove-avisa` |
| S8 | Painel sem `estudio` | `painel-reabre-estudio` |
| S9 | Painel abre o `estudio` sem `reavaliar` | `painel-reabre-estudio` |
| S10 | QR sem margem | `codigo-qr-svg` |
| S11 | QR sem o limite de 300 caracteres | `qr-matriz`, `qr-erro-sem-o-texto` |
| S12 | A consulta de 3 s não para (sem `clearInterval`) | `contagem-regressiva`, `detecta-pareamento-e-avisa-sessao-antiga`, `codigo-some-ao-sair-da-aba` |
| S13 | Revogar sempre diz "revogado" (sem conferir o envio) | `revogar-sem-canal-avisa` |
| S14 | Presença sem conferir a sessão do dispositivo | `lista-dispositivos` |
| S15 | Não parar depois de detectar o pareamento | `detecta-pareamento-e-avisa-sessao-antiga`, `primeiro-pareamento-nao-avisa`, `aviso-da-sessao-antiga-sem-canal` |
| S16 | Revogar não tira o código da tela | `revogar-apaga-o-codigo-na-tela` |
| S17 | Perfil só da lista da tela (sem releitura) | `membros-remove-avisa-perfil-relido` |
| R1 (C1) | Painel não passa `avisarRevogacao` à aba Membros | `painel-avisa-revogacao-de-membro` |
| R2 (C1) | Painel publica `revogacao` com o id do próprio admin | `painel-avisa-revogacao-de-membro` |
| R3 (C1) | A aba não solta o ouvinte de presença (`return` → `void`) | `solta-a-presenca-ao-desmontar` |
| R4 (C1) | `avisarRevogacao` fica com a primeira alça não nula (nunca a troca) | `painel-avisa-revogacao-de-membro` (cai na segunda remoção, depois da reabertura: só o `revogacao` de antes do `fechado` sai) |
| R5 (C1) | Detecção do pareamento sem `revogadoEm === null` | `pareado-e-revogado-nao-conta-como-pareamento` |
| R6 (C1) | Painel nunca oferece copiar (`return null` fixo) | `painel-oferece-copiar-so-com-area-de-transferencia` |
| S18 | Contagem com o relógio parado desde a montagem | `contagem-regressiva` (na primeira versão do teste a S18 não derrubava nada; o achado levou ao observador com `characterDataOldValue`) |

Foco previsível da aba Membros (VER-033): `foco-no-mesmo-commit-do-aviso` e os quatro `foco-*` continuam passando sem mudança; a frase nova usa a mesma região `role="alert"` e o mesmo `useLayoutEffect`.

Nits corrigidos (não zeram a contagem): nenhum até aqui.

## Riscos

- **Sem navegador nem celular real.** A largura de 320 px, o modo escuro e o tamanho do QR foram conferidos só pelas regras de CSS (`minmax(0, 1fr)`, `flex-wrap`, `max-width: 100%`, `overflow-wrap: anywhere`), e a leitura do QR por uma câmera de verdade não foi testada (`qr-matriz` confere forma e padrões de posição, não a decodificação). As duas coisas ficam para a Tarefa 10.
- **Código fora da tela que continua valendo no banco (rodada 1, N5).** A detecção do pareamento (consulta de 3 s) só existe enquanto o código está na tela. Em quatro casos o código sai da tela e continua valendo no banco por até 2 min: a pessoa sai da aba, gera um código de outro tipo, a contagem local termina antes do servidor, ou o aparelho pareia no último segundo, antes da consulta seguinte. O código não aparece em lugar nenhum (D3), mas não é apagado; apagar exigiria uma função nova no banco. Se um aparelho parear com esse código, o painel não vê a troca: a lista se acerta na próxima leitura, e a sessão antiga **não** é avisada pelo canal. O corte garantido continua sendo a renovação do token, em até 10 min.
- **`lean-qr` também nas rotas de dispositivo (rodada 1, N4).** O `App.tsx` importa todas as telas de forma estática, então o `lean-qr` (~3,6 KB gzip) entra também no pacote das rotas de dispositivo, inclusive o `/obs/palco` dentro do OBS. O módulo não tem efeito ao importar: o único `document.` está em `toDataURL`, que o app não usa. Separar o código por rota fica para quando houver motivo de tamanho.
- **Mais de uma câmera** (o modelo permite; a interface não, DES-001 §1): o painel reaproveita a primeira não revogada, e a câmera do OBS reaproveita a que já exibe essa câmera; uma câmera do OBS ligada a outra câmera continua ligada a ela (a função do banco ignora `p_camera` ao parear de novo).
- **"Conectado" depende da presença declarada** pelo dispositivo (o Broadcast e a presença não autenticam o conteúdo, DES-001 §8); a regra de exigir a sessão atual reduz, mas não elimina, uma presença forjada por outro cliente com a mesma sessão.
- **Dois painéis abertos:** a aba não recarrega a lista no `dispositivo_mudou` vindo de outro painel (a lista se acerta ao reabrir a aba ou durante um código valendo). Sugestão para a Tarefa 9, que já ouve o `estudio`.
- **Duas reavaliações numa renovação de token** continuam possíveis na Tarefa 9 (o `estudio` do painel e o `:controle` do `useAoVivo`), como o VER-041 registrou; nesta tarefa há um só canal.
- **Área de transferência:** só existe em contexto seguro (HTTPS ou `localhost`); fora dele não há botão, e o campo fica selecionável.
- **Teste instável conhecido**, fora desta tarefa: `AbaBiblioteca.test.tsx > aviso-da-fila-e-saida-da-pagina` (não falhou nas execuções desta tarefa).
- **Desvios do brief:** as divergências 1 a 8 de "Era proposital?".
