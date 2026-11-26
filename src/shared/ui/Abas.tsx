import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface Aba {
  id: string
  rotulo: string
}

/**
 * Abas acessíveis (padrão "Tabs" do WAI-ARIA, com ativação automática): `tablist` com um `tab` por aba,
 * cada um ligado ao seu `tabpanel` por `aria-controls`/`aria-labelledby`. Só o painel da aba ativa recebe
 * o conteúdo (`children`); os outros existem vazios e `hidden`, para que todo `aria-controls` aponte para um
 * elemento real. Setas, Home e End trocam de aba; só a aba ativa entra na ordem do Tab.
 */
export function Abas({
  abas,
  ativa,
  aoEscolher,
  children,
}: {
  abas: readonly Aba[]
  ativa: string
  aoEscolher: (id: string) => void
  children: ReactNode
}): ReactNode {
  const prefixo = useId()
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const idDaAba = (id: string) => `${prefixo}-aba-${id}`
  const idDoPainel = (id: string) => `${prefixo}-painel-${id}`

  function aoTeclar(evento: KeyboardEvent<HTMLButtonElement>, indice: number) {
    const ultimo = abas.length - 1
    const destino: Record<string, number> = {
      ArrowRight: indice === ultimo ? 0 : indice + 1,
      ArrowLeft: indice === 0 ? ultimo : indice - 1,
      Home: 0,
      End: ultimo,
    }
    if (!Object.hasOwn(destino, evento.key)) return // `in` aceitaria chaves herdadas como `toString`
    evento.preventDefault()
    const proxima = abas[destino[evento.key]]
    aoEscolher(proxima.id)
    botoes.current.get(proxima.id)?.focus()
  }

  return (
    <div className="abas">
      <div className="abas__lista" role="tablist">
        {abas.map((aba, indice) => {
          const selecionada = aba.id === ativa
          return (
            <button
              key={aba.id}
              ref={(botao) => {
                if (botao) botoes.current.set(aba.id, botao)
                else botoes.current.delete(aba.id)
              }}
              type="button"
              role="tab"
              id={idDaAba(aba.id)}
              className={selecionada ? 'aba aba--ativa' : 'aba'}
              aria-selected={selecionada}
              aria-controls={idDoPainel(aba.id)}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => aoEscolher(aba.id)}
              onKeyDown={(evento) => aoTeclar(evento, indice)}
            >
              {aba.rotulo}
            </button>
          )
        })}
      </div>
      {abas.map((aba) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={idDoPainel(aba.id)}
          aria-labelledby={idDaAba(aba.id)}
          className="abas__painel"
          hidden={aba.id !== ativa}
          tabIndex={aba.id === ativa ? 0 : undefined}
        >
          {aba.id === ativa && children}
        </div>
      ))}
    </div>
  )
}
