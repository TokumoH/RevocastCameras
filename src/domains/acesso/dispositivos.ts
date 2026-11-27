import type { ServicoDeDispositivo } from './portasDeDispositivo'

/** Os três tipos de dispositivo pareado (= tipo `public.tipo_dispositivo` do banco). */
export type TipoDeDispositivo = 'camera' | 'obs_palco' | 'obs_camera'

/** Nome de cada tipo na tela. */
export const ROTULO_DO_TIPO: Readonly<Record<TipoDeDispositivo, string>> = Object.freeze({
  camera: 'Câmera',
  obs_palco: 'Palco (OBS)',
  obs_camera: 'Câmera (OBS)',
})

/** Rota de cada tipo (DES-001 §9); o fragmento dela leva o código de pareamento (D3). */
export const CAMINHO_DO_TIPO: Readonly<Record<TipoDeDispositivo, '/camera' | '/obs/palco' | '/obs/camera'>> = Object.freeze({
  camera: '/camera',
  obs_palco: '/obs/palco',
  obs_camera: '/obs/camera',
})

/** Forma do código de pareamento: 43 caracteres base64url sem `=` (244 bits, D2). */
export const FORMA_DO_CODIGO = /^[A-Za-z0-9_-]{43}$/

/**
 * As colunas que `public.meu_dispositivo()` devolve (D4, I2), na ordem da função. O teste de
 * banco `e3-meu-dispositivo-colunas` (Tarefa 3) e o adaptador (Tarefa 4) usam esta lista: um nome
 * trocado de um lado derruba o teste do outro.
 */
export const COLUNAS_DE_MEU_DISPOSITIVO = ['id', 'tipo', 'rotulo', 'camera_id'] as const

const TIPOS: readonly TipoDeDispositivo[] = Object.freeze(['camera', 'obs_palco', 'obs_camera'] as const)

/**
 * Lê o fragmento da rota de dispositivo (`location.hash`) **uma vez** (D3): `''` ou `'#'` → `null`
 * (sem link); `'#'` + código na forma → o código; qualquer outra coisa → `{ invalido: true }`,
 * decidido sem rede. Nada é decodificado (`%2F` é inválido).
 */
export function codigoDoFragmento(fragmento: string): { codigo: string } | { invalido: true } | null {
  if (fragmento === '' || fragmento === '#') return null
  if (!fragmento.startsWith('#')) return { invalido: true }
  const codigo = fragmento.slice(1)
  return FORMA_DO_CODIGO.test(codigo) ? { codigo } : { invalido: true }
}

/** `http:` só vale para a máquina local (desenvolvimento e conferência); o resto exige `https:`. */
function origemSegura(url: URL): boolean {
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

/**
 * Link de pareamento: origem do app (`new URL(origem).origin`, sem caminho, busca, fragmento nem
 * credenciais) + caminho do tipo + `#código`. Origem que não seja `https:` (ou `http:` local), tipo
 * fora da lista ou código fora da forma → lança. A mensagem do erro nunca leva o código.
 */
export function linkDePareamento(origem: string, tipo: TipoDeDispositivo, codigo: string): string {
  if (!TIPOS.includes(tipo)) throw new Error('Tipo de dispositivo inválido')
  if (!FORMA_DO_CODIGO.test(codigo)) throw new Error('Código de pareamento fora da forma')
  let url: URL
  try {
    url = new URL(origem)
  } catch {
    throw new Error('Origem do link inválida')
  }
  if (!origemSegura(url)) throw new Error('Origem do link precisa ser https')
  return `${url.origin}${CAMINHO_DO_TIPO[tipo]}#${codigo}`
}

const TAMANHO_DO_ROTULO = 60

/**
 * Rótulo do dispositivo: aparado, de 1 a 60 caracteres (pontos de código, como o `char_length` de
 * `criar_codigo_pareamento`). O `trim` do JavaScript tira mais espaços que o `btrim` da função: o
 * domínio é o mais estrito dos dois.
 */
export function conferirRotulo(r: string): 'rotulo_vazio' | 'rotulo_longo' | null {
  const rotulo = r.trim()
  if (rotulo === '') return 'rotulo_vazio'
  if (Array.from(rotulo).length > TAMANHO_DO_ROTULO) return 'rotulo_longo'
  return null
}

/** Linha de `public.dispositivos` como o painel a lê. */
export interface Dispositivo {
  id: string
  tipo: TipoDeDispositivo
  rotulo: string
  cameraId: string | null
  usuarioAnonimoId: string | null
  pareadoEm: string | null
  revogadoEm: string | null
}

/**
 * Situação na lista do painel: revogado vence tudo (inclusive a presença, que pode durar até o
 * corte do canal); sem `pareadoEm`, nunca pareado; senão, conectado se o `id` está na presença de
 * `estudio`.
 */
export function situacaoDoDispositivo(d: Dispositivo, presentes: ReadonlySet<string>): 'nunca_pareado' | 'revogado' | 'conectado' | 'desconectado' {
  if (d.revogadoEm !== null) return 'revogado'
  if (d.pareadoEm === null) return 'nunca_pareado'
  return presentes.has(d.id) ? 'conectado' : 'desconectado'
}

/** Estado da rota de dispositivo. `revogado` só vem do aviso do canal (`marcarRevogado`), nunca de `resolverDispositivo` (N1). */
export type EstadoDoDispositivo =
  | { tipo: 'pareado'; dispositivo: { id: string; tipo: TipoDeDispositivo; rotulo: string; usuarioId: string } }
  | { tipo: 'sem_link' }
  | { tipo: 'link_invalido' }
  | { tipo: 'tipo_errado' }
  | { tipo: 'limite' }
  | { tipo: 'revogado' }
  | { tipo: 'falha' }

const RECUSA_DO_PAREAMENTO = {
  invalido: 'link_invalido',
  tipo_errado: 'tipo_errado',
  limite: 'limite',
} as const satisfies Record<'invalido' | 'tipo_errado' | 'limite', EstadoDoDispositivo['tipo']>

/**
 * Serviço de domínio: sessão do cliente do tipo + fragmento → estado da rota (D4). Ordem fixa,
 * num `try` só (qualquer erro, inclusive de `sair`, → `falha`, sem seguir):
 *
 * 1. sessão não anônima neste cliente → `sair()` e segue como sem sessão;
 * 2. sessão anônima com dispositivo deste tipo (`meu_dispositivo()`) → `pareado` (fragmento ignorado);
 * 3. sessão anônima sem dispositivo (revogado, nunca pareado ou pareamento incompleto) → `sair()`
 *    e segue como sem sessão: a sessão antiga nunca volta a valer, e um código pareia numa
 *    sessão **nova**;
 * 4. sem fragmento → `sem_link` (depois de recarregar não se sabe se houve revogação; nunca
 *    `revogado`); fragmento inválido → `link_invalido`, sem rede além da sessão;
 * 5. código → `entrarAnonimo()` → `parear(codigo, tipo)`; `pareado` → estado com o usuário do
 *    login; qualquer outra resposta termina com `sair()` (nenhuma sessão anônima sem dispositivo
 *    fica guardada, N1).
 */
export async function resolverDispositivo(
  s: ServicoDeDispositivo,
  tipo: TipoDeDispositivo,
  fragmento: ReturnType<typeof codigoDoFragmento>,
): Promise<EstadoDoDispositivo> {
  try {
    let sessao = await s.sessaoAtual()

    if (sessao !== null && !sessao.anonima) {
      await s.sair()
      sessao = null
    }

    if (sessao !== null) {
      const atual = await s.dispositivoAtual()
      if (atual !== null && atual.tipo === tipo) {
        return { tipo: 'pareado', dispositivo: { id: atual.id, tipo, rotulo: atual.rotulo, usuarioId: sessao.usuarioId } }
      }
      await s.sair()
    }

    if (fragmento === null) return { tipo: 'sem_link' }
    if ('invalido' in fragmento) return { tipo: 'link_invalido' }

    const { usuarioId } = await s.entrarAnonimo()
    const resposta = await s.parear(fragmento.codigo, tipo)
    if (resposta.resultado === 'pareado' && resposta.dispositivo !== null) {
      return { tipo: 'pareado', dispositivo: { id: resposta.dispositivo.id, tipo, rotulo: resposta.dispositivo.rotulo, usuarioId } }
    }
    await s.sair()
    // pareado sem dispositivo ou resposta fora da lista (adaptador com defeito) → falha, nunca pareado
    const r = resposta.resultado
    return r !== 'pareado' && Object.hasOwn(RECUSA_DO_PAREAMENTO, r) ? { tipo: RECUSA_DO_PAREAMENTO[r] } : { tipo: 'falha' }
  } catch {
    return { tipo: 'falha' }
  }
}
