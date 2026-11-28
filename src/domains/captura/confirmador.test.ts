import { describe, test, expect } from 'vitest'
import type { Gesto } from '../preparacao/gestos'
import { criarConfirmador } from './confirmador'
import { INTERVALO_DO_SERVIDOR_MS, INTERVALO_MS, SEGURAR_MS } from './gestos'

/*
 * Leituras nos instantes 0, 100, 200… ms (período 100 ms, salvo onde dito), faixas inclusivas nas duas pontas
 * (revisão 1, N4): `faixa(0, 1000, 'Victory')` são as leituras de 0, 100, …, 1000.
 */

type Leitura = { em: number; gesto: Gesto | null; confianca: number }

function faixa(de: number, ate: number, gesto: Gesto | null, passo = 100, confianca = 0.9): Leitura[] {
  const r: Leitura[] = []
  for (let em = de; em <= ate; em += passo) r.push({ em, gesto, confianca })
  return r
}

/** Passa as leituras pelo confirmador e devolve as confirmações (instante e gesto). */
function rodar(leituras: Leitura[], periodoMs = 100, c = criarConfirmador()): { em: number; gesto: Gesto }[] {
  const confirmadas: { em: number; gesto: Gesto }[] = []
  for (const l of leituras) {
    const g = c.ler({ gesto: l.gesto, confianca: l.confianca }, l.em, periodoMs)
    if (g !== null) confirmadas.push({ em: l.em, gesto: g })
  }
  return confirmadas
}

describe('confirma-depois-de-1s', () => {
  test('Victory nas leituras de 0 a 1000 → confirma na leitura de 1000, não na de 900', () => {
    expect(rodar(faixa(0, 900, 'Victory'))).toEqual([])
    expect(rodar(faixa(0, 1000, 'Victory'))).toEqual([{ em: 1000, gesto: 'Victory' }])
    expect(SEGURAR_MS).toBe(1000)
  })
})

describe('nao-confirma-antes', () => {
  test('Victory de 0 a 900 e depois null → nada', () => {
    expect(rodar([...faixa(0, 900, 'Victory'), ...faixa(1000, 5000, null)])).toEqual([])
  })
})

describe('troca-de-gesto-recomeca', () => {
  test('Victory de 0 a 600, Thumb_Up de 700 em diante → nada até a leitura de 1600, confirma Thumb_Up na de 1700', () => {
    expect(rodar([...faixa(0, 600, 'Victory'), ...faixa(700, 1600, 'Thumb_Up')])).toEqual([])
    expect(rodar([...faixa(0, 600, 'Victory'), ...faixa(700, 1700, 'Thumb_Up')])).toEqual([{ em: 1700, gesto: 'Thumb_Up' }])
  })
})

describe('buraco-dentro-da-tolerancia', () => {
  test('Victory de 0 a 300, null em 400 e 500, Victory de 600 em diante (300 ≤ 300) → confirma na de 1000', () => {
    expect(rodar([...faixa(0, 300, 'Victory'), ...faixa(400, 500, null), ...faixa(600, 1500, 'Victory')])).toEqual([{ em: 1000, gesto: 'Victory' }])
  })
})

describe('buraco-maior-que-a-tolerancia-zera', () => {
  test('Victory de 0 a 300, null de 400 a 700, Victory de 800 em diante (500 > 300) → recomeça em 800, confirma na de 1800', () => {
    expect(rodar([...faixa(0, 300, 'Victory'), ...faixa(400, 700, null), ...faixa(800, 1700, 'Victory')])).toEqual([])
    expect(rodar([...faixa(0, 300, 'Victory'), ...faixa(400, 700, null), ...faixa(800, 1800, 'Victory')])).toEqual([{ em: 1800, gesto: 'Victory' }])
  })

  test('o buraco é medido entre leituras com o gesto: um outro gesto no meio também recomeça', () => {
    expect(rodar([...faixa(0, 300, 'Victory'), { em: 400, gesto: 'Open_Palm', confianca: 0.9 }, ...faixa(500, 1400, 'Victory')])).toEqual([])
    expect(rodar([...faixa(0, 300, 'Victory'), { em: 400, gesto: 'Open_Palm', confianca: 0.9 }, ...faixa(500, 1500, 'Victory')])).toEqual([{ em: 1500, gesto: 'Victory' }])
  })
})

describe('tolerancia-a-5-quadros', () => {
  const sequencia = [...faixa(0, 200, 'Victory', 200), { em: 400, gesto: null, confianca: 0 }, ...faixa(600, 2000, 'Victory', 200)]

  test('período 200 ms: Victory em 0 e 200, null em 400, Victory de 600 em diante (400 ≤ max(300, 400)) → confirma na de 1000', () => {
    expect(rodar(sequencia, 200)).toEqual([{ em: 1000, gesto: 'Victory' }])
  })

  test('período 100 ms, a mesma sequência (400 > 300) → recomeça em 600 e confirma na de 1600', () => {
    expect(rodar(sequencia, 100)).toEqual([{ em: 1600, gesto: 'Victory' }])
  })
})

describe('none-e-baixa-confianca-nao-contam', () => {
  test('null e confiança 0,69 contam como sem gesto', () => {
    expect(rodar(faixa(0, 3000, null))).toEqual([])
    expect(rodar(faixa(0, 3000, 'Victory', 100, 0.69))).toEqual([])
    expect(rodar(faixa(0, 3000, 'Victory', 100, 0.6))).toEqual([])
  })

  test('confiança 0,70 conta', () => {
    expect(rodar(faixa(0, 1000, 'Victory', 100, 0.7))).toEqual([{ em: 1000, gesto: 'Victory' }])
  })

  test('uma leitura de 0,69 no meio é um buraco: dentro da tolerância não zera; fora dela, zera', () => {
    const fraca = (em: number): Leitura => ({ em, gesto: 'Victory', confianca: 0.69 })
    expect(rodar([...faixa(0, 400, 'Victory'), fraca(500), fraca(600), ...faixa(700, 1000, 'Victory')])).toEqual([{ em: 1000, gesto: 'Victory' }])
    expect(rodar([...faixa(0, 400, 'Victory'), fraca(500), fraca(600), fraca(700), ...faixa(800, 1700, 'Victory')])).toEqual([])
  })
})

describe('mantido-confirma-uma-vez', () => {
  test('punho de 0 a 10 000 → uma confirmação só', () => {
    expect(rodar(faixa(0, 10_000, 'Closed_Fist'))).toEqual([{ em: 1000, gesto: 'Closed_Fist' }])
  })

  test('a 5 quadros/s, também uma só', () => {
    expect(rodar(faixa(0, 10_000, 'Closed_Fist', 200), 200)).toEqual([{ em: 1000, gesto: 'Closed_Fist' }])
  })
})

describe('soltar-e-mostrar-de-novo', () => {
  const base = [...faixa(0, 1000, 'Victory'), ...faixa(1100, 1500, null)]

  test('confirma em 1000; solta 1000–1600; mostra 1600–2600 → nada (intervalo até 4000)', () => {
    expect(rodar([...base, ...faixa(1600, 2600, 'Victory'), ...faixa(2700, 6000, null)])).toEqual([{ em: 1000, gesto: 'Victory' }])
  })

  test('mantém até 4000 → confirma em 4000, não antes', () => {
    expect(rodar([...base, ...faixa(1600, 3900, 'Victory')])).toEqual([{ em: 1000, gesto: 'Victory' }])
    expect(rodar([...base, ...faixa(1600, 4000, 'Victory')])).toEqual([
      { em: 1000, gesto: 'Victory' },
      { em: 4000, gesto: 'Victory' },
    ])
  })

  test('solto por menos de 500 ms (de 1100 a 1400, último visto em 1000) não conta como soltar', () => {
    expect(rodar([...faixa(0, 1000, 'Victory'), ...faixa(1100, 1400, null), ...faixa(1500, 8000, 'Victory')])).toEqual([{ em: 1000, gesto: 'Victory' }])
  })
})

describe('intervalo-de-3s', () => {
  const primeiro = faixa(0, 1000, 'Victory')

  test('o segundo gesto, diferente, segurado de 1500 a 2500, não confirma antes de 1000 + INTERVALO_MS', () => {
    const r = rodar([...primeiro, ...faixa(1100, 1400, null), ...faixa(1500, 2500, 'Thumb_Up'), ...faixa(2600, 6000, null)])
    expect(r).toEqual([{ em: 1000, gesto: 'Victory' }])
  })

  test('mantido até 1000 + INTERVALO_MS → confirma exatamente lá, nunca antes', () => {
    const fim = 1000 + INTERVALO_MS
    expect(rodar([...primeiro, ...faixa(1100, 1400, null), ...faixa(1500, fim - 100, 'Thumb_Up')])).toEqual([{ em: 1000, gesto: 'Victory' }])
    expect(rodar([...primeiro, ...faixa(1100, 1400, null), ...faixa(1500, fim, 'Thumb_Up')])).toEqual([
      { em: 1000, gesto: 'Victory' },
      { em: fim, gesto: 'Thumb_Up' },
    ])
  })

  test('troca direta de gesto, sem soltar, também espera o intervalo', () => {
    expect(rodar([...primeiro, ...faixa(1100, 1000 + INTERVALO_MS, 'Open_Palm')])).toEqual([
      { em: 1000, gesto: 'Victory' },
      { em: 1000 + INTERVALO_MS, gesto: 'Open_Palm' },
    ])
  })
})

describe('margem-do-intervalo', () => {
  test('INTERVALO_DO_SERVIDOR_MS === INTERVALO_MS - 500 (D3; revisão 1, I1)', () => {
    expect(INTERVALO_DO_SERVIDOR_MS).toBe(INTERVALO_MS - 500)
    expect(INTERVALO_MS - INTERVALO_DO_SERVIDOR_MS).toBe(500)
  })

  test('confirmações seguidas ficam sempre a pelo menos INTERVALO_MS (logo, 500 ms acima do limiar do servidor)', () => {
    const gestos: Gesto[] = ['Victory', 'Thumb_Up', 'Open_Palm', 'Closed_Fist', 'ILoveYou']
    const leituras: Leitura[] = []
    // a cada 1 100 ms um gesto diferente, sem buraco: tenta confirmar o mais rápido possível
    for (let em = 0, i = 0; em <= 60_000; em += 100) {
      if (em % 1100 === 0 && em > 0) i += 1
      leituras.push({ em, gesto: gestos[i % gestos.length], confianca: 0.95 })
    }
    const r = rodar(leituras)
    expect(r.length).toBeGreaterThan(5)
    for (let i = 1; i < r.length; i += 1) {
      expect(r[i].em - r[i - 1].em).toBeGreaterThanOrEqual(INTERVALO_MS)
      expect(r[i].em - r[i - 1].em).toBeGreaterThanOrEqual(INTERVALO_DO_SERVIDOR_MS + 500)
    }
  })
})

describe('zerar', () => {
  test('depois de zerar, a contagem começa do zero', () => {
    const c = criarConfirmador()
    expect(rodar(faixa(0, 900, 'Victory'), 100, c)).toEqual([])
    c.zerar()
    expect(rodar(faixa(1000, 1900, 'Victory'), 100, c)).toEqual([])
    expect(rodar([{ em: 2000, gesto: 'Victory', confianca: 0.9 }], 100, c)).toEqual([{ em: 2000, gesto: 'Victory' }])
  })

  test('o intervalo da última confirmação continua valendo depois de zerar', () => {
    const c = criarConfirmador()
    expect(rodar(faixa(0, 1000, 'Victory'), 100, c)).toEqual([{ em: 1000, gesto: 'Victory' }])
    c.zerar()
    expect(rodar(faixa(1500, 3900, 'Thumb_Up'), 100, c)).toEqual([])
    expect(rodar([{ em: 4000, gesto: 'Thumb_Up', confianca: 0.9 }], 100, c)).toEqual([{ em: 4000, gesto: 'Thumb_Up' }])
  })

  test('zerar não conta como soltar (rodada 1, I1): o mesmo gesto mantido depois de zerar não confirma de novo', () => {
    const c = criarConfirmador()
    expect(rodar(faixa(0, 1000, 'Victory'), 100, c)).toEqual([{ em: 1000, gesto: 'Victory' }])
    c.zerar()
    expect(rodar(faixa(1100, 10_000, 'Victory'), 100, c)).toEqual([])
  })

  test('depois de zerar, a primeira leitura sem o gesto (500 ms depois da última vez visto) solta; mostrado de novo, confirma passado o intervalo', () => {
    const c = criarConfirmador()
    expect(rodar(faixa(0, 1000, 'Victory'), 100, c)).toEqual([{ em: 1000, gesto: 'Victory' }])
    c.zerar()
    expect(rodar([{ em: 2000, gesto: null, confianca: 0 }, ...faixa(2100, 4000, 'Victory')], 100, c)).toEqual([{ em: 4000, gesto: 'Victory' }])
  })
})

describe('soltar-recomeca-a-contagem', () => {
  test('com tolerância acima de SOLTAR_MS (período de 300 ms), o gesto solto e mostrado de novo conta do zero', () => {
    // ✌️ confirmado em 1000 e mantido até 3600; sem ele de 3700 a 4100 (4100 − 3600 = 500: solto); de volta em 4200
    // (buraco de 600 ≤ max(300, 600): sem o recomeço, a contagem viria de 0 e confirmaria já em 4200)
    const leituras = [...faixa(0, 3600, 'Victory'), ...faixa(3700, 4100, null), ...faixa(4200, 5200, 'Victory')]
    expect(rodar(leituras, 300)).toEqual([
      { em: 1000, gesto: 'Victory' },
      { em: 5200, gesto: 'Victory' },
    ])
  })
})
