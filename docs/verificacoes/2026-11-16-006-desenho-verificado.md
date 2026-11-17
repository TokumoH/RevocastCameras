# VER-006 — DES-001 corrigido até duas verificações limpas seguidas

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | VER-006 |
| Título | DES-001 corrigido até duas verificações limpas seguidas |
| Gravidade | média |
| Tipo | documentação · desenho de arquitetura · segurança |
| Data | 2026-11-16 |
| Usuário responsável | TokumoH |
| Status de implementação | somente documentação |
| Commits | commit que introduz este arquivo — `git log --format=%h -- docs/verificacoes/2026-11-16-006-desenho-verificado.md` |
| Arquivos | `docs/desenho/2026-11-16-revocast-cameras-desenho.md`, `docs/verificacoes/README.md`, este registro |

## Problema

O DES-001 entrou em `c2b886f` (VER-005) como "rascunho em verificação": a rodada B do 8º ciclo ainda estava pendente e as duas verificações seguidas sem erro exigidas pelo CORE não tinham sido atingidas. Os ciclos seguintes encontraram erros reais no desenho, a maioria de segurança e de operação.

## Era proposital?

Não. O commit anterior foi feito por ordem expressa antes do fim da verificação, e o VER-005 registrou isso como risco.

## Solução

Seis ciclos adicionais de verificação (8º ao 15º revisor), com correção de todos os achados, até duas rodadas B seguidas sem bloqueador nem erro importante (14º e 15º revisores: só nits). Principais correções:

| Ciclo | Achado | Correção no DES-001 |
|---|---|---|
| 8º | Trocar de celular derrubava o aparelho novo (revogação identificada só por dispositivo) | Aviso de revogação identifica a **sessão**; mensagens levam o `auth.uid()` do remetente |
| 8º | Safari apaga a sessão após ~7 dias sem uso | Novo risco com mitigação (novo QR) |
| 9º | Diagrama do fluxo principal quebrado (`;` no `sequenceDiagram`) | Corrigido; os 14 diagramas do repositório passam no parser do Mermaid 11.4.1 |
| 9º | Aba Membros sem `email` não identificava quem revogar | `equipe`/`admin` leem `id`, `email`, `nome` de `membros` |
| 9º | Conta Google podia virar dispositivo | `parear_dispositivo` e `dispositivo_atual()` só para sessão anônima |
| 10º–11º | iPhones sem Wake Lock (iOS < 16.4) e Android com Wake Lock negado | Reserva por configuração do aparelho (iPhone: sem Modo de Pouca Energia e bloqueio "Nunca"; Android: "Permanecer ativo"), aviso na página `/camera`, checklist |
| 12º | Login Google voltaria para `localhost` e só usuários de teste entrariam | Site URL e Redirect URLs com curinga; tela de consentimento publicada |
| 13º | Sessão poderia assumir o e-mail de um membro ainda sem login | `papel_atual()` só aceita identidade Google com e-mail verificado; "Confirm email" ligado e vinculação manual desligada |
| 14º–15º (nits) | obs-websocket também lê a versão; curinga no domínio de produção; fragmento só nas rotas de dispositivo | Textos ajustados; cliente com `flowType: 'pkce'` |

Status do DES-001: **aprovado** pelo responsável em 2026-11-17, depois das duas verificações limpas.

## Por que esta solução

O CORE exige duas verificações seguidas sem erro e proíbe deixar de fora sugestões importantes dos revisores; cada ciclo com achado importante reiniciou a contagem.

## Por que não outras soluções

| Opção | Motivo de descarte |
|---|---|
| Parar no 8º ciclo, com o documento já commitado | Erros de segurança e de operação ficariam no desenho |
| Ignorar achados "pequenos" para fechar a contagem | Proibido pelo CORE quando o achado é importante |

## Onde

| Arquivo | Linhas | O que mudou |
|---|---|---|
| [`docs/desenho/2026-11-16-revocast-cameras-desenho.md`](../desenho/2026-11-16-revocast-cameras-desenho.md#L1-L394) | várias (seções 3, 5, 6, 6.1, 8, 10.1, 10.4, 11, 12, 13, 15, 16) | Correções da tabela acima; status atualizado |
| [`docs/verificacoes/README.md`](README.md) | "Arquivos", "Onde", exemplo | VER-006 listado; exemplo hipotético passa a `007` |

## Lógica

| Passo | Antes | Depois |
|---|---|---|
| Estado do desenho | Rascunho em verificação | Verificado e aprovado |
| Verificações seguidas sem erro | 0 | 2 (14º e 15º revisores) |

## Exemplo

Trocar o celular da câmera no meio da temporada: antes, o aviso de revogação do aparelho antigo também derrubava o novo (mesmo `dispositivo_id`); depois, o aviso cita só a sessão antiga e o novo segue transmitindo.

## Verificação

| # | Abordagem | Resultado |
|---|---|---|
| Rodada A (cada ciclo) | `check-docs`, `check-doc-secrets`, referências entre seções, colunas das tabelas, **parser oficial do Mermaid 11.4.1** em todos os blocos | Limpa após cada correção |
| Sabotagem do validador Mermaid | Reintroduzir o `;` no diagrama | Detectado (`Parse error on line 9`) |
| Rodada B (8º ao 13º revisor) | Revisor independente novo por ciclo | Achados: 3, 3, 2, 3, 2, 3 — todos corrigidos |
| 1ª verificação limpa | 14º revisor | Nenhum bloqueador nem importante; 2 nits corrigidos + reconferência pontual (Mermaid e `check-docs`) |
| 2ª verificação limpa | 15º revisor | Nenhum bloqueador nem importante; 1 nit corrigido + reconferência pontual |

## Riscos

- Próximo passo: plano de implementação da etapa E0, a ser sugerido e aprovado antes de qualquer código.
- Limites e comportamentos de serviços externos (Supabase, Google, Metered, OBS, navegadores) foram conferidos em 2026-11-16 e podem mudar.
- O validador Mermaid usado fica no diretório temporário da sessão; versioná-lo em `scripts/` é sugestão futura.
