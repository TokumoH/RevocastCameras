/**
 * Agendamentos do emissor e do receptor (PLA-005, Tarefa 1, Passo 3), sobre o `agendar` injetado (o domínio não conhece o
 * relógio do navegador):
 * - `porMotivo(motivo, f, ms)`: **um único agendamento por motivo** (espera crescente, prazo da resposta, queda,
 *   prazo da conexão, `pronto`…); agendar de novo o mesmo motivo cancela o anterior;
 * - `depois(f)`: o que um ouvinte de porta faz passa por aqui (`agendar` com 0 ms), para nunca chamar uma porta dentro
 *   do ouvinte de outra;
 * - `parar()`: cancela tudo; depois dele nada mais roda (inclusive o que já estava agendado).
 */
export function criarAgenda<Motivo extends string>(agendar: (f: () => void, ms: number) => () => void) {
  const porMotivoAtivo = new Map<Motivo, () => void>()
  const adiados = new Set<() => void>()
  let parada = false

  function cancelar(motivo: Motivo): void {
    const c = porMotivoAtivo.get(motivo)
    if (c === undefined) return
    porMotivoAtivo.delete(motivo)
    c()
  }

  function porMotivo(motivo: Motivo, f: () => void, ms: number): void {
    if (parada) return
    cancelar(motivo)
    const alca: { cancelar: () => void } = { cancelar: () => {} }
    alca.cancelar = agendar(() => {
      if (porMotivoAtivo.get(motivo) !== alca.cancelar) return
      porMotivoAtivo.delete(motivo)
      if (!parada) f()
    }, ms)
    porMotivoAtivo.set(motivo, alca.cancelar)
  }

  function depois(f: () => void): void {
    if (parada) return
    const alca: { cancelar: () => void } = { cancelar: () => {} }
    alca.cancelar = agendar(() => {
      adiados.delete(alca.cancelar)
      if (!parada) f()
    }, 0)
    adiados.add(alca.cancelar)
  }

  function parar(): void {
    parada = true
    for (const c of porMotivoAtivo.values()) c()
    porMotivoAtivo.clear()
    for (const c of adiados) c()
    adiados.clear()
  }

  return { porMotivo, cancelar, ativo: (motivo: Motivo): boolean => porMotivoAtivo.has(motivo), depois, parar }
}
