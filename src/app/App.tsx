import { useEffect } from 'react'
import { resolverRota } from './rotas'
import { Camera } from './telas/Camera'
import { Controle } from './telas/Controle'
import { Entrar } from './telas/Entrar'
import { NaoEncontrada } from './telas/NaoEncontrada'
import { ObsCamera } from './telas/ObsCamera'
import { ObsPalco } from './telas/ObsPalco'
import { Painel } from './telas/Painel'

export function App({ caminho }: { caminho: string }) {
  const rota = resolverRota(caminho)

  useEffect(() => {
    document.title = `${rota.titulo} · RevoCast Câmeras`
  }, [rota.titulo])

  switch (rota.nome) {
    case 'entrar': return <Entrar titulo={rota.titulo} />
    case 'painel': return <Painel titulo={rota.titulo} />
    case 'controle': return <Controle titulo={rota.titulo} />
    case 'camera': return <Camera titulo={rota.titulo} />
    case 'obs_palco': return <ObsPalco titulo={rota.titulo} />
    case 'obs_camera': return <ObsCamera titulo={rota.titulo} />
    case 'nao_encontrada': return <NaoEncontrada titulo={rota.titulo} />
  }
}
