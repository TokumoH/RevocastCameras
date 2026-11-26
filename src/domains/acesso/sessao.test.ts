import { describe, test, expect } from 'vitest'
import { AVISOS_FIXOS, combinarEstados } from './sessao'
import type { AvisoDeEntrada, EstadoDeAcesso, UsuarioDaSessao } from './sessao'

const usuario: UsuarioDaSessao = { id: 'id-ana', email: 'ana@revocast.test', anonimo: false, provedor: 'google' }
const carregando: EstadoDeAcesso = { tipo: 'carregando' }
const semSessao = (aviso: AvisoDeEntrada | null): EstadoDeAcesso => ({ tipo: 'sem_sessao', aviso })
const semPapel: EstadoDeAcesso = { tipo: 'sem_papel', email: 'fora@revocast.test' }
const falha: EstadoDeAcesso = { tipo: 'falha' }
const membro: EstadoDeAcesso = { tipo: 'membro', usuario, papel: 'equipe' }

const fixos: EstadoDeAcesso[] = [semPapel, semSessao('sessao_anonima'), semSessao('provedor_invalido'), semSessao('sessao_expirada')]
const avisosDoRetorno: AvisoDeEntrada[] = ['login_cancelado', 'login_falhou', 'login_incompleto']
const todos: EstadoDeAcesso[] = [
  carregando,
  semSessao(null),
  ...avisosDoRetorno.map(semSessao),
  ...fixos,
  falha,
  membro,
]

describe('sessao', () => {
  test('AVISOS_FIXOS', () => {
    expect(AVISOS_FIXOS).toEqual(['sessao_anonima', 'provedor_invalido', 'sessao_expirada'])
  })

  test('estado-fixo', () => {
    for (const atual of fixos) {
      // sem_sessao sem aviso (o SIGNED_OUT do próprio sair) não apaga a mensagem
      expect(combinarEstados(atual, semSessao(null)), JSON.stringify(atual)).toBe(atual)
      // falha da reavaliação automática não troca a mensagem
      expect(combinarEstados(atual, falha), JSON.stringify(atual)).toBe(atual)
      // entrou em outra aba
      expect(combinarEstados(atual, membro), JSON.stringify(atual)).toBe(membro)
      // outro estado fixo ou outro aviso
      for (const novo of [semPapel, ...fixos, ...avisosDoRetorno.map(semSessao)]) {
        if (novo === atual) continue
        expect(combinarEstados(atual, novo), `${JSON.stringify(atual)} → ${JSON.stringify(novo)}`).toBe(novo)
      }
      const outroSemPapel: EstadoDeAcesso = { tipo: 'sem_papel', email: 'outro@revocast.test' }
      expect(combinarEstados(atual, outroSemPapel)).toBe(outroSemPapel)
    }
  })

  test('aviso do retorno da URL é de uma vez só', () => {
    for (const aviso of avisosDoRetorno) {
      const atual = semSessao(aviso)
      const novo = semSessao(null)
      expect(combinarEstados(atual, novo), aviso).toBe(novo)
      expect(combinarEstados(atual, falha), aviso).toBe(falha)
    }
  })

  test('membro, carregando, sem sessão sem aviso e falha: sempre o novo', () => {
    for (const atual of [membro, carregando, semSessao(null), falha]) {
      for (const novo of todos) {
        expect(combinarEstados(atual, novo), `${JSON.stringify(atual)} → ${JSON.stringify(novo)}`).toBe(novo)
      }
    }
  })
})
