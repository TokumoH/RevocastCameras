# VER-005 — Desenho do recomeço (DES-001) e pasta `docs/desenho/`

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-005 |
| Título | Desenho do recomeço (DES-001) e pasta `docs/desenho/` |
| Gravidade | média |
| Tipo | documentação · desenho de arquitetura |
| Data | 2026-11-16 |
| Usuário responsável | TokumoH |
| Status de implementação | somente documentação |
| Commits | commit que introduz este arquivo — `git log --format=%h -- docs/verificacoes/2026-11-16-005-desenho-recomeco.md` |
| Arquivos | `docs/desenho/2026-11-16-revocast-cameras-desenho.md` (novo), `docs/desenho/README.md` (novo), `docs/README.md`, `docs/verificacoes/README.md`, este registro |

## Problema

O protótipo (`send.html`, `receive.html`, `src/`, `public/`) foi feito para testar conceitos e não tinha arquitetura, segurança, dados nem as funções desejadas (gestos, clipe, marcador, cenas, sons, avisos, painel, controle pelo celular). Recomeçar do zero sem um desenho escrito levaria a decisões implícitas e a retrabalho.

## Era proposital?

Sim, o protótipo era descartável por definição ("feito à mão para testar os conceitos"). Não havia desenho porque o projeto ainda não tinha sido especificado.

## Solução

1. Documento de desenho **DES-001** em `docs/desenho/`: intenção, objetivos e antiobjetivos, restrições (grátis, sem cartão), abordagens descartadas, domínios DDD e fabricações puras, modelo de dados normalizado, modelo de autorização (papéis do app conferidos no banco), telas, fluxos, tecnologias, pré-requisitos de configuração, impacto no processo, etapas E0–E6, riscos.
2. Pasta nova `docs/desenho/` com `README.md` no formato do CORE.
3. `docs/README.md` e `docs/verificacoes/README.md` atualizados.

## Por que esta solução

- Desenho separado dos registros: o desenho orienta várias etapas; o registro documenta cada commit.
- As decisões vieram de uma sessão de desenho com pesquisa (hospedagem, tempo real, TURN, controle do OBS, limites de planos grátis) e foram registradas com as alternativas descartadas.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Implementar direto, sem desenho | Decisões de segurança e dados ficariam implícitas |
| `docs/superpowers/specs/` | Dois diretórios a mais, cada um com README, sem ganho |
| Desenho no README da raiz | O README da raiz é só descrição e projeção (VER-004) |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`docs/desenho/2026-11-16-revocast-cameras-desenho.md`](../desenho/2026-11-16-revocast-cameras-desenho.md#L1-L391) | 1–391 | Novo: DES-001 |
| [`docs/desenho/README.md`](../desenho/README.md#L1-L68) | 1–68 | Novo: README da pasta |
| [`docs/README.md`](../README.md#L14) | 14 | Campo "Arquivos" inclui `desenho/` |
| [`docs/README.md`](../README.md#L48) | 48 | Linha de `desenho/` em "Onde" |
| [`docs/verificacoes/README.md`](README.md) | "Arquivos", "Onde", exemplo | VER-005 listado; exemplo hipotético passa a `006` |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| Planejar a implementação | Sem referência | DES-001 com etapas E0–E6 |
| Decisões de arquitetura | Na conversa | Versionadas, com alternativas descartadas |

## Exemplo

Pergunta "por que Supabase e não Cloudflare?": DES-001, seção 4.3, mostra as cinco opções avaliadas e o motivo de cada descarte (Cloudflare TURN exige cartão; Render pago custa ~US$ 7/mês; servidor local exige o PC ligado; P2P sem login real).

## Verificação

| # | Abordagem | Resultado |
|---|---|---|
| Builder check | Revisor independente leu como construtor | 6 perguntas: 2 resolvidas no desenho (dispositivos fixos; lista de acesso como fonte do papel), 4 respondidas pelo responsável (celular qualquer com câmera traseira; interruptor de gestos; Windows/macOS/Linux; contas criadas fora do código) |
| Rodada A (cada ciclo) | Script: `check-docs`, `check-doc-secrets`, referências entre seções, colunas das tabelas, cercas de código, sintaxe do diagrama ER, termos proibidos | Limpa em todos os ciclos após as correções |
| Rodada B (cada ciclo) | Revisor independente novo, procurando contradições, afirmações técnicas falsas e permissões que bloqueiam fluxos ou vazam dados | Achados por ciclo: 10 → 13 → 11 → 8 → 9 → 3 → 6, todos corrigidos (ex.: sessões das Fontes do OBS divididas, episódio ativo não persistido, papéis do app tratados como papéis do Postgres, revogação sem cortar o vídeo, Fontes do OBS duplicadas) |
| Afirmações técnicas | Conferidas pelos revisores e por pesquisa | `window.obsstudio` (BASIC/ADVANCED), `CreateRecordChapter` (OBS 30.2+, Hybrid MP4), gestos do MediaPipe, Wake Lock iOS 16.4+, limites do Supabase Free, Realtime privado/`extension` |

**Estado no momento do commit:** a rodada A do 8º ciclo está limpa; a rodada B do 8º ciclo (revisor independente) ainda estava em andamento. O commit foi feito por ordem expressa do responsável ("commit e push para trabalho"). Por isso o DES-001 entra com status **"rascunho em verificação"**, e as duas rodadas seguidas limpas exigidas pelo CORE **ainda não foram atingidas**.

Nits corrigidos: vários de texto e diagrama ao longo dos ciclos (registrados nas correções acima).

## Riscos

- **Verificação incompleta:** pode haver erros a corrigir apontados pela rodada B pendente; correções entram em commit próprio com registro.
- **Desenho ainda não aprovado formalmente**: a aprovação do DES-001 é o próximo passo antes do plano de implementação.
- Limites de planos grátis (Supabase, Metered) conferidos em 2026-11-16; podem mudar.
