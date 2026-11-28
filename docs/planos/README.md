# docs/planos

## Cabeçalho

| Campo | Valor |
|---|---|
| Id | DIR-docs-planos |
| Título | `planos` |
| Tipo | documentação · planos de implementação |
| Data | 2026-11-17 |
| Usuário responsável | TokumoH |
| Status | ativo |
| Commits | commit que introduz este arquivo — `git log --format=%h -- docs/planos/README.md` |
| Arquivos | `README.md`, `2026-11-17-e0-fundacao.md`, `2026-11-26-e1-entrada-e-membros.md`, `2026-11-26-e2-preparar-episodio.md`, `2026-11-27-e3-ao-vivo-por-toque.md`, `2026-11-27-e4-celular-como-camera.md`, `2026-11-28-e5-gestos.md` |

## Propósito

Guarda os planos de implementação: para cada etapa de um desenho aprovado (`docs/desenho/`), as tarefas em ordem, os arquivos tocados, as interfaces entre tarefas, os testes que provam cada uma e o que fica para a etapa seguinte.

## Origem

Criado para o plano da etapa E0 do [DES-001](../desenho/2026-11-16-revocast-cameras-desenho.md), aprovado em 2026-11-17.

## Organização

- Um arquivo por etapa: `AAAA-MM-DD-eN-slug.md`, com Id `PLA-NNN` no cabeçalho.
- Cada tarefa termina com um commit e o seu registro em [`../verificacoes/`](../verificacoes/README.md).

## Por que esta organização

- Separar desenho (o que e por quê), plano (como, em passos) e registro (o que mudou e como foi provado) mantém cada documento com um papel só.
- Um plano por etapa mantém o tamanho legível e permite aprovar uma etapa de cada vez.

## Por que não outras organizações

| Opção | Motivo de descarte |
|---|---|
| Plano dentro do desenho | O desenho é aprovado uma vez; os planos mudam por etapa |
| `docs/superpowers/plans/` | Dois diretórios a mais, cada um com README, sem ganho |
| Um plano único para E0–E6 | Grande demais para revisar; as etapas seguintes dependem do que a anterior ensinar |

## Onde

| Arquivo ou subdiretório | O que contém |
|---|---|
| [`README.md`](README.md) | Este arquivo |
| [`2026-11-17-e0-fundacao.md`](2026-11-17-e0-fundacao.md) | PLA-001 — etapa E0: limpeza, esqueleto, cliente Supabase, banco com RLS testada e checagens do banco |
| [`2026-11-26-e1-entrada-e-membros.md`](2026-11-26-e1-entrada-e-membros.md) | PLA-002 — etapa E1: domínio Acesso, login Google com PKCE, guarda por papel, tela de erro de configuração, painel vazio com abas e aba Membros; migração nova só de políticas (nenhum admin altera nem remove a própria linha da lista) |
| [`2026-11-26-e2-preparar-episodio.md`](2026-11-26-e2-preparar-episodio.md) | PLA-003 — etapa E2: domínio Preparação, Biblioteca (envio de sons e imagens ao bucket privado `midias`, com tipo pelos bytes, 50 MB, uso de 1 GB, progresso, cancelamento e corte por inatividade), cenas, mapa de gestos, episódios e avisos; simulação do Storage e checagens aceitando só as políticas de `storage.objects` da Biblioteca; migração nova do bucket e das políticas |
| [`2026-11-27-e3-ao-vivo-por-toque.md`](2026-11-27-e3-ao-vivo-por-toque.md) | PLA-004 — etapa E3: pareamento de dispositivos por QR e link de uso único (login anônimo, código de 244 bits guardado só como hash, limite de tentativas, revogação com aviso pelo canal), `/obs/palco` como executor (cena, som, aviso, clipe e marcador), `/controle` por toque, modo teste, iniciar e encerrar o ao vivo; simulação do Realtime e checagens aceitando só as duas políticas do canal; migração nova de funções e políticas; dependência `lean-qr` |
| [`2026-11-27-e4-celular-como-camera.md`](2026-11-27-e4-celular-como-camera.md) | PLA-005 — etapa E4: `/camera` com tela preta (toque para ligar, Wake Lock ou instruções, câmera traseira só com vídeo, prévia de 15 s) e vídeo por WebRTC direto (STUN público, sem TURN pago nem servidor de mídia) até o `/obs/camera`, que mostra só o vídeo na Fonte do OBS; sinalização por função do banco (`enviar_sinal_de_video` com `realtime.send`, remetente posto pelo servidor) para o tópico da sessão atual do par, em que nenhum cliente envia, só com episódio ativo; revogação e troca de aparelho que cortam a sessão antiga e fecham o vídeo dos dois lados; aviso de falta de conexão direta; migração nova (a função, `pode_usar_canal` com o tópico de vídeo só para receber e um `obs_camera` ativo no banco; limite de sinais por remetente); nenhuma dependência nova |
| [`2026-11-28-e5-gestos.md`](2026-11-28-e5-gestos.md) | PLA-006 — etapa E5: gestos reconhecidos no aparelho (celular, padrão, ou computador do OBS, por câmera) com o MediaPipe num Web Worker, modelo e WASM servidos pela própria origem e conferidos por SHA-256, telemetria bloqueada por guarda de rede; segurar 1 s e intervalo 3 s no aparelho, com 2,5 s (margem de 500 ms) no banco e no palco; envio por função do banco (`enviar_gesto`, remetente e dispositivo postos pelo servidor) para o tópico da sessão do palco, em que nenhum cliente envia; interruptor (`definir_gestos_ligados`, aviso pelo servidor) e confirmação no `/controle` e no painel; onde reconhecer (`definir_reconhecimento`, `situacao_dos_gestos`); núcleo comum de `EstadoDoCanal`; migração nova (quatro funções e `pode_usar_canal` com `gestos:<uid>` só para receber); dependência `@mediapipe/tasks-vision` com o modelo versionado, a licença Apache-2.0 e o aviso; nove tarefas (VER-058 a VER-066) |

## Lógica

```mermaid
flowchart LR
    D[Desenho aprovado] --> P[Plano da etapa]
    P --> T[Tarefas]
    T --> C[Commit local + registro VER-NNN<br/>versão limpa; push com autorização]
```

## Exemplo

Para saber quais testes provam as regras de acesso do banco: abrir o PLA-001, Tarefa 3, tabela de testes do passo 2. Para saber como a E1 trata quem não está na lista de acesso: abrir o PLA-002, "Foco da revisão", item 1, e seguir os nomes dos testes até a tarefa dona.

## Verificação

- Links relativos, "Onde" e campo "Arquivos" conferidos por `npm run check-docs`.

## Riscos

- Versões de bibliotecas fixadas no PLA-001 foram conferidas em 2026-11-17 e podem envelhecer até a execução.
