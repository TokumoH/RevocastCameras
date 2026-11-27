import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Papel } from '../domains/acesso/papeis'
import type { CanalDoEstudio, EstadoDoCanal, FabricaDeCanais } from '../domains/aovivo/portas'
import { REABRIR_CANAIS_MS } from './canais'

/** O que `useCanalReaberto` precisa de uma alça de canal (`CanalDoEstudio` e `CanalDoControle` servem). */
export interface AlcaReabrivel {
  aoMudarEstado(f: (e: EstadoDoCanal) => void): () => void
  fechar(): Promise<void>
}

/** A alça atual e o estado do canal dela; sem canal (`abrir` nulo), `conectando`. */
export interface CanalReaberto<C> {
  canal: C | null
  estado: EstadoDoCanal
}

/**
 * Mantém aberto o canal que `abrir` cria, numa tela de **membro** (PLA-004, I-A, D15, N3):
 * - a alça nasce em `conectando` e o estado segue o que o adaptador entrega;
 * - `fechado` ou `negado` (o registro do adaptador já saiu do mapa, VER-038) → `aoPerder()` **uma vez**
 *   (o `reavaliar()` do acesso) e, se o componente continua montado `REABRIR_CANAIS_MS` depois (a pessoa
 *   continua membro: senão a guarda desmonta a tela e a espera é cancelada), a alça morta é fechada e
 *   outra é aberta (canal novo);
 * - `abrir` diferente (outro tópico, outra fábrica) → fecha a alça e abre outra; `abrir` nulo → fecha;
 *   desmontar → fecha e cancela a espera.
 * `abrir` deve ser estável entre renderizações (`useCallback`); `aoPerder` é lido na hora (referência).
 * Os ouvintes do adaptador já chegam fora do callback do `realtime-js` (são agendados).
 *
 * As rotas de dispositivo usam `acompanharEstudio` (`useDispositivo.ts`), que, em vez do `reavaliar()`,
 * refaz `resolverDispositivo` e decide entre revogado, reabrir ou tentar de novo; o tempo é o mesmo.
 */
export function useCanalReaberto<C extends AlcaReabrivel>(abrir: (() => C) | null, aoPerder: () => void): CanalReaberto<C> {
  const [vista, setVista] = useState<CanalReaberto<C>>({ canal: null, estado: 'conectando' })
  const perder = useRef(aoPerder)
  useEffect(() => {
    perder.current = aoPerder
  })

  useEffect(() => {
    if (abrir === null) {
      setVista((v) => (v.canal === null && v.estado === 'conectando' ? v : { canal: null, estado: 'conectando' }))
      return
    }
    const criar = abrir
    let vivo = true
    let atual: C | null = null
    let soltar: (() => void) | null = null
    let espera: ReturnType<typeof setTimeout> | null = null

    function soltarAtual(): void {
      soltar?.()
      soltar = null
      const c = atual
      atual = null
      void c?.fechar().catch(() => {})
    }

    function abrirCanal(): void {
      const c = criar()
      atual = c
      setVista({ canal: c, estado: 'conectando' })
      soltar = c.aoMudarEstado((e) => {
        if (!vivo || atual !== c) return
        setVista({ canal: c, estado: e })
        if ((e === 'fechado' || e === 'negado') && espera === null) {
          perder.current()
          // Sem `if (!vivo)` aqui: a limpeza do efeito sempre cancela esta espera (desmontar, trocar `abrir`), então ela nunca roda depois.
          espera = setTimeout(() => {
            espera = null
            soltarAtual()
            abrirCanal()
          }, REABRIR_CANAIS_MS)
        }
      })
    }

    abrirCanal()
    return () => {
      vivo = false
      if (espera !== null) clearTimeout(espera)
      soltarAtual()
    }
  }, [abrir])

  return vista
}

/**
 * O canal `estudio` de uma tela de membro (`/controle` e, na Tarefa 8, o painel): `useCanalReaberto`
 * com `reavaliar` e a presença `{ tipo: 'membro', papel }` (D14), marcada em cada alça nova e quando o
 * papel muda (o adaptador a remarca a cada volta a `conectado`). Sem e-mail e sem nome na presença.
 * `canais` nulo → nenhum canal (quem já tem o `estudio` de fora, como o `useAoVivo` dentro do painel).
 */
export function useEstudio(d: { canais: FabricaDeCanais | null; papel: Papel; reavaliar: () => void }): { estudio: CanalDoEstudio | null; estado: EstadoDoCanal } {
  const { canais, papel, reavaliar } = d
  const abrir = useMemo(() => (canais === null ? null : () => canais.estudio()), [canais])
  const { canal, estado } = useCanalReaberto(abrir, reavaliar)

  useEffect(() => {
    if (canal !== null) void canal.marcarPresenca({ tipo: 'membro', papel }).catch(() => {})
  }, [canal, papel])

  return { estudio: canal, estado }
}

/**
 * Um `reavaliar()` por janela de `REABRIR_CANAIS_MS` (5 s) para as perdas de canal (`fechado`/`negado`) de
 * uma tela de membro: numa renovação de token, o `estudio` e o `:controle` caem juntos e o acesso é
 * reavaliado uma vez só (VER-041, Riscos; PLA-004, Tarefa 9). Devolve uma função estável; `reavaliar` é
 * lido na hora. O painel cria uma e a divide entre o próprio `estudio` e o `useAoVivo` da aba Ao vivo.
 */
export function useUmaReavaliacaoPorPerda(reavaliar: () => void): () => void {
  const atual = useRef(reavaliar)
  useEffect(() => {
    atual.current = reavaliar
  })
  const bloqueio = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (bloqueio.current !== null) clearTimeout(bloqueio.current)
      bloqueio.current = null
    },
    [],
  )
  return useCallback(() => {
    if (bloqueio.current !== null) return
    atual.current()
    bloqueio.current = setTimeout(() => {
      bloqueio.current = null
    }, REABRIR_CANAIS_MS)
  }, [])
}
