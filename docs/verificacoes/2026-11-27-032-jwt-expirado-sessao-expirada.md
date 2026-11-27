# VER-032 — JWT expirado recusado pelo Storage vira `sessao_expirada`

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-032 |
| Título | JWT expirado recusado pelo Storage vira `sessao_expirada` |
| Gravidade | média |
| Tipo | correção |
| Data | 2026-11-27 |
| Usuário responsável | TokumoH |
| Status de implementação | implementado |
| Commits | commit que introduz este arquivo — `git log --format=%h -- docs/verificacoes/2026-11-27-032-jwt-expirado-sessao-expirada.md` |
| Arquivos | `src/shared/infra/armazenamentoSupabase.ts`, `src/shared/infra/armazenamentoSupabase.test.ts`, `src/shared/infra/README.md`, este registro |

## Problema

Quando o Storage recusa um envio com JWT expirado, a resposta vem como `{ statusCode: "400" | "403", error: "InvalidJWT", message }`. `motivoDaResposta` lia só o `statusCode` e devolvia `invalido` ou `negado`. A tela mostrava "Não foi possível concluir." ou "A biblioteca ou o seu papel mudou" no lugar de "A sessão expirou.", e a reavaliação de acesso não acontecia como deveria. Confirmado por simulação no [VER-031](2026-11-27-031-e2-conferencia-e-guia.md) e previsto como risco N2 no [VER-027](2026-11-26-027-e2-adaptadores-preparacao.md).

## Era proposital?

Parcialmente. O VER-027 (N3) decidiu não usar o `code` do corpo, porque o `code` do SDK (`statusCode || code || status`) esconderia o status HTTP. O próprio VER-027 registrou o `InvalidJWT` como risco a mapear depois da conferência real, e o VER-031 adiou a mudança. Este item é essa decisão pendente, tomada pelo usuário.

## Solução

Em `armazenamentoSupabase.ts`, uma função `ehJwtInvalido` (texto igual a `InvalidJWT`, sem diferenciar maiúsculas):

- `motivoDaResposta` (envio por XHR): `error` ou `code` do corpo `InvalidJWT` → `sessao_expirada`, antes de olhar o `statusCode`;
- `motivoDoStorage` (`remover` e `urlDePrevia`): `code`, `error` ou `statusCode` `InvalidJWT` → `sessao_expirada`. O `storage-js` 2.119.0 (`fetch.ts`, `handleError`) copia o `code` do corpo para o erro e usa `statusCode || code || status`; o campo `error` do corpo é descartado pelo SDK, então por esse caminho só `code` e `statusCode` são vistos.

A `message` (texto livre) nunca decide. Nenhum outro mapeamento mudou.

## Por que esta solução

Decide por um identificador estável do erro, não por texto livre nem pelo status HTTP (que varia entre 400 e 403). Fica no adaptador (Pure Fabrication): o domínio já entende `sessao_expirada` e a tela já a trata. Mudança mínima, sem expor o texto do servidor.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Decidir pela `message` ("exp claim timestamp check failed") | Texto livre, pode mudar entre versões e idiomas |
| Mapear todo `403` para `sessao_expirada` | Esconderia a recusa legítima por RLS (`negado`) |
| Seguir o SDK por inteiro (`statusCode \|\| code \|\| status`) | O `code` esconderia o status HTTP em outros erros (decisão N3 do VER-027) |
| Só confiar no `getSession()` antes do envio | Não cobre o token que vence durante um envio longo |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`armazenamentoSupabase.ts`](../../src/shared/infra/armazenamentoSupabase.ts#L38-L80) | 38–80 | `ehJwtInvalido`; regra nova em `motivoDaResposta` e `motivoDoStorage`; comentários |
| [`armazenamentoSupabase.test.ts`](../../src/shared/infra/armazenamentoSupabase.test.ts#L393-L430) | 393–430 | 5 casos novos de `InvalidJWT`, controle `403` sem `InvalidJWT`, `code` de outro valor; 3 casos novos em `remover` e 1 em `urlDePrevia` |
| [`README.md`](../../src/shared/infra/README.md) | 56, 89, 148 | regra, contagem de testes e risco resolvido |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| Corpo `{"statusCode":"400","error":"InvalidJWT"}` | `invalido` | `sessao_expirada` |
| Corpo `{"statusCode":"403","error":"InvalidJWT"}` | `negado` | `sessao_expirada` |
| Corpo `{"statusCode":"403","error":"Unauthorized"}` | `negado` | `negado` (controle) |
| Erro do SDK `code: "InvalidJWT"` em `remover` | `invalido` | `sessao_expirada` |

## Exemplo

`motivoDaResposta(400, '{"statusCode":"400","error":"InvalidJWT","message":"exp claim timestamp check failed"}')` devolvia `invalido`; agora devolve `sessao_expirada`. `motivoDaResposta(400, '{"statusCode":"403","error":"Unauthorized","message":"InvalidJWT"}')` continua `negado` (a `message` não decide).

## Verificação

revisão do controlador (diff de `armazenamentoSupabase.ts` lido inteiro: a regra decide só pelo nome do erro `InvalidJWT` em `error`/`code` — ou no `statusCode` quando o SDK o põe lá —, nunca pela `message`, com prioridade sobre o resto; nenhum outro mapeamento mudou; os controles mostram que 403 sem `InvalidJWT` continua `negado`): **aprovada**, sem achado. Item pequeno, de um adaptador, sem efeito de segurança (só troca a mensagem e passa a reavaliar o acesso); pela decisão do responsável de 2026-11-22, sem segunda rodada

Feito pelo implementador, sem valer como verificação do registro: testes escritos antes e falhando (11 de 62); com a regra, `npx vitest run src/shared/infra` 123 de 123; sabotagem (`ehJwtInvalido` devolvendo `false`) derrubou 11 testes, arquivo restaurado e conferido por `sha256sum`.

## Riscos

- O formato real da resposta do Storage ainda deve ser confirmado na conferência real do guia (VER-031, passo 7); os testes usam o formato descrito no VER-027/VER-031, não uma resposta observada.
- Por `remover` e `urlDePrevia`, o SDK descarta o campo `error`: se o servidor mandar `InvalidJWT` só nele (sem `code`), esse caminho continua como antes.
- Resolve o risco "JWT expirado recusado pelo Storage" do VER-027 e do VER-031; o `getSession()` antes de cada envio continua como primeira defesa.
