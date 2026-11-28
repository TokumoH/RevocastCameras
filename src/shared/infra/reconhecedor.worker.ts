import urlDoCarregador from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import urlDoWasm from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import urlDoModelo from './modelos/gesture_recognizer.task?url'
import type { EscopoDoWorker } from './guardaDeRede'
import { atenderMensagens, criarNucleoDoReconhecedor, type MensagemDoWorker } from './nucleoDoReconhecedor'

/*
 * O Web Worker de módulo do reconhecedor de gestos (PLA-006, D8, D9; registro VER-063). Fino de propósito: nenhum import
 * estático do MediaPipe (o `import()` nativo não passa pela guarda de rede; I6). Daqui só saem as URLs por `?url` (a
 * variante de módulo do carregador e o WASM, F2 e F4, e o modelo versionado; todos da própria origem, com hash no nome)
 * e o pacote, por `import()` dinâmico, que o núcleo só chama depois da guarda e da conferência dos SHA-256. Teste:
 * `worker-sem-import-estatico` (`nucleoDoReconhecedor.test.ts`, este arquivo lido por `?raw`).
 */

const escopo = self as unknown as EscopoDoWorker & {
  postMessage(m: MensagemDoWorker): void
  onmessage: ((e: { data: unknown }) => void) | null
}

const nucleo = criarNucleoDoReconhecedor({
  escopo,
  origem: location.origin,
  urls: { carregador: urlDoCarregador, wasm: urlDoWasm, modelo: urlDoModelo },
  digest: (b) => crypto.subtle.digest('SHA-256', b),
  criarUrlDeBlob: (b) => URL.createObjectURL(b),
  revogarUrlDeBlob: (u) => URL.revokeObjectURL(u),
  carregarTarefas: () => import('@mediapipe/tasks-vision'),
})

const atender = atenderMensagens(nucleo, (m) => escopo.postMessage(m))
escopo.onmessage = (e) => {
  void atender(e.data)
}
