# src/app

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-src-app |
| Título | `app` |
| Tipo | código · rotas e telas |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | em construção |
| Commits | commit que introduz este arquivo — `git log --format=%h -- src/app/README.md` |
| Arquivos | `README.md`, `rotas.ts`, `rotas.test.ts`, `App.tsx`, `App.test.tsx`, `servicos.ts`, `servicos.test.ts`, `telas/` |

## Propósito

Casca do app: `resolverRota()` converte o caminho da URL em rota, `App` escolhe a tela, e `telas/` guarda uma tela por rota. Desde a E1, `servicos.ts` é a composição dos serviços de membro: lê a configuração e liga o cliente Supabase de membro aos adaptadores das portas do domínio Acesso.

## Origem

Criado na Tarefa 1 da etapa E0 ([PLA-001](../../docs/planos/2026-11-17-e0-fundacao.md)), que substitui o protótipo por um app React com a cara do RevoCast. Desenho: [DES-001](../../docs/desenho/2026-11-16-revocast-cameras-desenho.md). `servicos.ts` entrou na Tarefa 3 da E1 ([PLA-002](../../docs/planos/2026-11-26-e1-entrada-e-membros.md)), que põe a composição em `app/` (restrição global: o cliente de membro só é criado nas rotas de membro, de forma preguiçosa e uma vez por página).

## Organização

- `rotas.ts`: tipos `NomeDaRota` e `Rota` e a função `resolverRota`.
- `App.tsx`: escolhe a tela pelo nome da rota.
- `*.test.ts(x)` ao lado do arquivo testado.
- `telas/`: uma tela por rota, mais "Página não encontrada".
- `servicos.ts`: `ambienteDoVite()` (só `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, lidas de `import.meta.env` uma a uma), `criarServicosDeMembro(env)` (lança `ErroDeConfiguracao` antes de criar qualquer cliente; cria um cliente `membro`, com `storageKey: 'revocast-auth-membro'` e `detectSessionInUrl: true`, e devolve `{ auth, repo }`) e `obterServicosDeMembro()` (cria na primeira chamada e guarda em módulo; se a configuração falhar, nada fica guardado). Nenhum módulo chama `obterServicosDeMembro` ao ser importado: quem chama, nas rotas de membro, é a Tarefa 4.

## Por que esta organização

Rotas por **caminho** (`/painel`, `/obs/palco`...) deixam o fragmento `#` livre para o código de pareamento (DES-001). Separar `resolverRota` (função pura) do `App` (React) permite testar as rotas sem DOM.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Roteador pronto (react-router) | Dependência a mais para seis rotas fixas |
| Rotas por fragmento `#` | O `#` é reservado ao código de pareamento |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`rotas.ts`](rotas.ts) | `NomeDaRota`, `Rota` e `resolverRota()` |
| [`rotas.test.ts`](rotas.test.ts) | Onze casos de `resolverRota` (nome e título literais, inclusive barra final e `/painel//`) |
| [`App.tsx`](App.tsx) | Componente `App({ caminho })`: resolve a rota uma vez, define o `document.title` e escolhe a tela, passando o título |
| [`App.test.tsx`](App.test.tsx) | Testes de tela: Controle com logo, "Página não encontrada" no cartão rosa (classe `cartao--rosa`) com o link "Ir para a entrada" para `/entrar` e, para as 7 rotas, o título (heading e `document.title`, a partir de `resolverRota`), a frase própria de cada tela ("Em construção — etapa E1/E3/E4" ou "Esse endereço não existe.") e o logo; telas da mesma etapa (Entrar/Painel, Controle/ObsPalco, Camera/ObsCamera) mostram o mesmo conteúdo e se distinguem só pelo título, que vem de `resolverRota` |
| [`servicos.ts`](servicos.ts) | `ambienteDoVite`, `criarServicosDeMembro` e `obterServicosDeMembro` (composição dos serviços de membro, cliente único por página) |
| [`servicos.test.ts`](servicos.test.ts) | 5 testes com `createClient` simulado (`vi.mock`): configuração ausente lança citando `VITE_SUPABASE_URL` sem criar cliente; com as duas variáveis, 1 `createClient` com as opções de membro e `{ auth, repo }`; `ambienteDoVite` só com as duas chaves; cache de `obterServicosDeMembro` (`vi.resetModules` + `vi.stubEnv`): 2 chamadas → 1 cliente; configuração inválida → lança nas duas e não guarda nada |
| [`telas/`](telas/) | Telas provisórias, uma por rota |

## Lógica

```mermaid
flowchart LR
    C[caminho] --> A[App]
    A --> RR[resolverRota]
    RR --> R[Rota: nome, titulo]
    R --> A
    A --> T[telas/*]
```

`/` leva a `entrar`; barra final é ignorada; caminho desconhecido (incluindo `/obs`) leva a `nao_encontrada`.

Composição dos serviços de membro (`servicos.ts`):

```mermaid
flowchart LR
    O[obterServicosDeMembro] -->|1ª chamada| AV[ambienteDoVite]
    AV --> CS[criarServicosDeMembro]
    CS --> LC[lerConfiguracao]
    LC -->|ErroDeConfiguracao| X[lança; nada guardado]
    LC --> CC["criarClienteSupabase(config, 'membro')"]
    CC --> AD["auth + repo<br/>(shared/infra/acessoSupabase.ts)"]
    AD --> M[guardado no módulo]
```

## Exemplo

Para criar a rota `/exemplo`: acrescentar o nome em `NomeDaRota` e a entrada em `ROTAS` de `rotas.ts`, uma tela em `telas/` e um `case` no `App.tsx` (com `noImplicitReturns` ligado no `tsconfig.json`, o `case` esquecido dá erro TS7030 no `npm run typecheck`).

## Verificação

- `npx vitest run src/app/servicos.test.ts`: 5 testes; sabotagens do cache, de `ambienteDoVite` e do tipo de sessão derrubam cada uma o teste correspondente (registro [VER-017](../../docs/verificacoes/2026-11-26-017-e1-adaptadores-acesso.md)).
- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.
- Subdiretórios com README próprio (conferido pelo mesmo comando).

## Riscos

- Telas ainda provisórias; o conteúdo real chega nas etapas E1 a E4.
- `servicos.ts` ainda não é chamado por nenhuma tela (Tarefa 4 da E1); a garantia de que as rotas de dispositivo nunca criam o cliente de membro só existe quando a Tarefa 4 a provar com `createClient` simulado.
- O cache de `obterServicosDeMembro` vale por página (módulo); não há como trocar a configuração sem recarregar, o que é o esperado num app Vite.
