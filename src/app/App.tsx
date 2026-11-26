import { useEffect, useState } from 'react'
import { dependenciasDoNavegador } from './dependencias'
import type { Dependencias } from './dependencias'
import { resolverRota } from './rotas'
import { Camera } from './telas/Camera'
import { Controle } from './telas/Controle'
import { Entrar } from './telas/Entrar'
import { NaoEncontrada } from './telas/NaoEncontrada'
import { ObsCamera } from './telas/ObsCamera'
import { ObsPalco } from './telas/ObsPalco'
import { Painel } from './telas/Painel'

/**
 * Escolhe a tela pela rota. As dependências (testes passam falsos) são guardadas uma vez e só chegam às
 * três telas de membro: as rotas de dispositivo nunca chamam `obterServicos` (nem criam o cliente de membro).
 */
export function App({ caminho, dependencias }: { caminho: string; dependencias?: Dependencias }) {
  const rota = resolverRota(caminho)
  const [dep] = useState(() => dependencias ?? dependenciasDoNavegador())

  useEffect(() => {
    document.title = `${rota.titulo} · RevoCast Câmeras`
  }, [rota.titulo])

  switch (rota.nome) {
    case 'entrar': return <Entrar titulo={rota.titulo} dependencias={dep} />
    case 'painel': return <Painel titulo={rota.titulo} dependencias={dep} />
    case 'controle': return <Controle titulo={rota.titulo} dependencias={dep} />
    case 'camera': return <Camera titulo={rota.titulo} />
    case 'obs_palco': return <ObsPalco titulo={rota.titulo} />
    case 'obs_camera': return <ObsCamera titulo={rota.titulo} />
    case 'nao_encontrada': return <NaoEncontrada titulo={rota.titulo} />
  }
}
