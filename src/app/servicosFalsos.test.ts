import { describe, expect, test, vi } from 'vitest'
import { ErroDeDispositivo } from '../domains/acesso/portasDeDispositivo'
import { aoVivoVazio, criarCanalFalso, criarFalsos, criarFalsosDeDispositivo } from './servicosFalsos'

const EU = '5a1c9e2b-7d3f-4b6a-8c1d-2e3f4a5b6c7d'
const OUTRO = '7b2d0f3c-8e4a-4c7b-9d2e-3f4a5b6c7d8e'
const DISP = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const CODIGO = 'Codigo_de_teste-0123456789abcdefghijKLMNOPQ'

/** Deixa os microtasks (conexão sozinha, ouvintes agendados) andarem. */
const tique = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('falsos do ao vivo (E3)', () => {
  test('canal-falso-segue-o-adaptador', async () => {
    const f = criarCanalFalso()
    expect(f.canais(EU)).toBe(f.canais(EU))
    const a = f.canais(EU).estudio()
    const b = f.canais(EU).estudio()
    const estados = vi.fn()
    const mb = vi.fn()
    a.aoMudarEstado(estados)
    b.aoReceber(mb)
    await tique()
    await tique()
    // conectando → conectado sozinho; um canal só para as duas alças
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado'])
    expect(f.realtime.contar('channel', 'estudio')).toBe(1)
    expect(f.abertos()).toEqual(['estudio'])

    // eco local e envio com remetente
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('ok')
    await tique()
    expect(mb.mock.calls).toEqual([[{ evento: 'episodio_ativo_mudou' }, EU]])
    expect(f.enviados('estudio')).toEqual([{ event: 'episodio_ativo_mudou', payload: { remetente: EU } }])

    // entrega de fora: inválida descartada, válida chega
    f.entregar('estudio', 'revogacao', { usuario: 'X', remetente: OUTRO })
    f.entregar('estudio', 'revogacao', { usuario: DISP, remetente: OUTRO })
    await tique()
    expect(mb.mock.calls.at(-1)).toEqual([{ evento: 'revogacao', usuario: DISP }, OUTRO])
    expect(mb).toHaveBeenCalledTimes(2)

    // ack sem resposta e estados
    f.responderEnvio('sem_resposta')
    expect(await a.enviar({ evento: 'episodio_ativo_mudou' })).toBe('sem_resposta')
    f.definirEstado('estudio', 'reconectando')
    f.definirEstado('estudio', 'conectado')
    f.definirEstado('estudio', 'negado')
    await tique()
    expect(estados.mock.calls.map((c) => c[0])).toEqual(['conectando', 'conectado', 'reconectando', 'conectado', 'negado'])

    // presença marcada e sincronizada
    const c = f.canais(EU).estudio()
    await c.marcarPresenca({ tipo: 'membro', papel: 'equipe' })
    await tique()
    await tique()
    expect(f.presencas('estudio')).toEqual([{ tipo: 'membro', papel: 'equipe' }])
  })

  test('ao-vivo-vazio-e-dependencias', async () => {
    const vazio = aoVivoVazio()
    expect(await vazio.repo.episodioAtivo()).toBeNull()
    expect(await vazio.repo.listarDispositivos()).toEqual([])
    await expect(vazio.repo.criarCodigo({ tipo: 'camera', rotulo: 'x', dispositivoId: null, cameraId: null })).rejects.toMatchObject({ motivo: 'outro' })

    const f = criarFalsos()
    const dep = f.dependencias()
    expect(dep.obterAoVivo()).toBe(dep.obterAoVivo())
    expect(dep.obterDispositivo('obs_palco')).toBe(dep.obterDispositivo('obs_palco'))
    expect(dep.obterDispositivo('camera')).not.toBe(dep.obterDispositivo('obs_palco'))
    dep.limparFragmento()
    expect(f.chamadas.obterAoVivo).toBe(2)
    expect(f.chamadas.obterDispositivo).toEqual(['obs_palco', 'obs_palco', 'camera', 'obs_palco'])
    expect(f.chamadas.limparFragmento).toBe(1)
  })

  test('dispositivo-falso', async () => {
    const f = criarFalsosDeDispositivo()
    const s = f.servicos.servico
    expect(await s.sessaoAtual()).toBeNull()
    const { usuarioId } = await s.entrarAnonimo()
    expect(await s.dispositivoAtual()).toBeNull()
    expect(await s.parear(CODIGO, 'obs_palco')).toEqual({ resultado: 'pareado', dispositivo: { id: DISP, rotulo: 'Dispositivo de teste' } })
    expect(await s.sessaoAtual()).toEqual({ usuarioId, anonima: true })
    expect(await s.dispositivoAtual()).toEqual({ id: DISP, tipo: 'obs_palco', rotulo: 'Dispositivo de teste', cameraId: null })
    await s.sair()
    expect(await s.sessaoAtual()).toBeNull()
    const outro = await s.entrarAnonimo()
    expect(outro.usuarioId).not.toBe(usuarioId)
    expect(f.chamadas.ordem).toEqual(['sessaoAtual', 'entrarAnonimo', 'dispositivoAtual', 'parear', 'sessaoAtual', 'dispositivoAtual', 'sair', 'sessaoAtual', 'entrarAnonimo'])

    f.responderPareamento({ resultado: 'tipo_errado', dispositivo: null })
    expect(await s.parear(CODIGO, 'camera')).toEqual({ resultado: 'tipo_errado', dispositivo: null })
    f.falharProxima('sessaoAtual', new ErroDeDispositivo('rede'))
    await expect(s.sessaoAtual()).rejects.toMatchObject({ motivo: 'rede' })
    expect(await s.sessaoAtual()).not.toBeNull()

    // palco: URL assinada falsa, registro anotado, episódio sem carga → invalido
    expect(await f.servicos.palco.urlDoArquivo('som/x.mp3')).toBe('https://armazenamento.revocast.test/assinada/som/x.mp3?token=teste')
    await expect(f.servicos.palco.carregar(DISP)).rejects.toMatchObject({ motivo: 'invalido' })
    expect(f.servicos.canais(EU)).toBe(f.servicos.canais(EU))
  })
})
