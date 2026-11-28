import type { EstadoDoCanal } from '../domains/aovivo/portas'
import type { CanalDeVideo, RespostaDoSinal } from '../domains/captura/portas'

/**
 * Canal de vídeo que a rota liga e desliga por baixo de um emissor (ou receptor) que vive a página inteira (PLA-005, D5;
 * fabricação pura da camada `app`). O emissor recebe o mesmo `canal` para sempre e guarda o consentimento e as esperas; a
 * rota abre o canal real (`video:<seu uid>`) só com episódio ativo e o fecha quando o episódio acaba:
 * - `ligar(real)`: passa a repassar os sinais e os estados do canal real (o estado atual chega pelo próprio adaptador);
 * - `desligar()`: para de repassar, avisa `fechado` aos ouvintes (o emissor deixa de achar que o canal está conectado) e
 *   devolve o canal real **sem fechá-lo**, para a rota mandar o `encerrar` antes de fechar (a alça fechada devolve
 *   `falhou` sem chamar a função, VER-051, N1);
 * - `canal.enviar` sem canal real → `falhou`, sem chamar nada; `canal.fechar()` desliga e fecha o real.
 * Os ouvintes são chamados como o adaptador os chama (já fora do callback do `realtime-js`); o `fechado` do `desligar` é
 * síncrono, e o emissor já adia o que faz (`agendar` com 0 ms).
 * Sem consulta de "ligado" (VER-056, N5): nenhuma rota precisava dela; os testes conferem o estado observável (o
 * `enviar` sem canal real devolve `falhou` sem chamar a função).
 */
export function criarCanalComutavel<Envia, Recebe>(): {
  canal: CanalDeVideo<Envia, Recebe>
  ligar(real: CanalDeVideo<Envia, Recebe>): void
  desligar(): CanalDeVideo<Envia, Recebe> | null
} {
  const ouvintesDoSinal = new Set<(s: Recebe, remetente: string) => void>()
  const ouvintesDoEstado = new Set<(e: EstadoDoCanal) => void>()
  let real: CanalDeVideo<Envia, Recebe> | null = null
  let soltar: (() => void)[] = []

  function desligar(): CanalDeVideo<Envia, Recebe> | null {
    const r = real
    if (r === null) return null
    real = null
    for (const s of soltar) s()
    soltar = []
    for (const f of [...ouvintesDoEstado]) f('fechado')
    return r
  }

  return {
    canal: {
      aoSinal(f) {
        ouvintesDoSinal.add(f)
        return () => {
          ouvintesDoSinal.delete(f)
        }
      },
      aoMudarEstado(f) {
        ouvintesDoEstado.add(f)
        return () => {
          ouvintesDoEstado.delete(f)
        }
      },
      enviar(s: Envia): Promise<RespostaDoSinal> {
        return real === null ? Promise.resolve<RespostaDoSinal>('falhou') : real.enviar(s)
      },
      async fechar() {
        await desligar()?.fechar()
      },
    },
    ligar(r) {
      if (real === r) return
      void desligar()?.fechar().catch(() => {})
      real = r
      soltar = [
        r.aoSinal((s, remetente) => {
          if (real === r) for (const f of [...ouvintesDoSinal]) f(s, remetente)
        }),
        r.aoMudarEstado((e) => {
          if (real === r) for (const f of [...ouvintesDoEstado]) f(e)
        }),
      ]
    },
    desligar,
  }
}
