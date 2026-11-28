/**
 * SHA-256 fixos dos arquivos dos gestos e a conferência (PLA-006, D9; registro VER-062). O worker do reconhecedor
 * (Tarefa 6) busca o WASM e o modelo pela própria origem, confere os bytes com `conferirSha256` e só segue se baterem;
 * diferente → situação `falhou` (motivo `integridade`). Trocar a versão do `@mediapipe/tasks-vision` ou o modelo exige
 * trocar a constante no mesmo commit (README de `modelos/`); os testes `integridade-do-wasm` e `integridade-do-modelo`
 * reprovam se um dos dois mudar sozinho.
 */

/** `vision_wasm_module_internal.wasm` do `@mediapipe/tasks-vision` 1.2.3 (F3; 14 665 738 bytes). */
export const SHA256_DO_WASM = 'a269e84b12aefc93c9d6a4d62b01f41e5434a9fa941533bb8e75b1e3d1669e46'

/** `modelos/gesture_recognizer.task` (float16, versão 1; F10; 8 373 440 bytes). */
export const SHA256_DO_MODELO = '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482'

const FORMA_DO_SHA256 = /^[0-9a-f]{64}$/

const digestDoNavegador = (bytes: ArrayBuffer): Promise<ArrayBuffer> => crypto.subtle.digest('SHA-256', bytes)

/**
 * `true` só se o SHA-256 de `bytes` for exatamente `esperado` (64 caracteres hexadecimais minúsculos). Falha fechada:
 * `esperado` fora dessa forma dá `false` (e um digest de tamanho diferente de 32 bytes nunca forma os mesmos 64
 * caracteres). `digest` é injetável para os testes; o padrão é `crypto.subtle.digest('SHA-256', …)`, presente na
 * página e no worker em contexto seguro. Sem `crypto.subtle` (contexto inseguro, como `http` na rede local) ou com um
 * `digest` que falha, a promessa **rejeita** em vez de devolver `false`: quem chama (o worker, Tarefa 6) trata a
 * rejeição como situação `falhou`, motivo `integridade` (VER-062, rodada 1, N7).
 */
export async function conferirSha256(
  bytes: ArrayBuffer,
  esperado: string,
  digest: (b: ArrayBuffer) => Promise<ArrayBuffer> = digestDoNavegador,
): Promise<boolean> {
  if (!FORMA_DO_SHA256.test(esperado)) return false
  const resumo = new Uint8Array(await digest(bytes))
  let hex = ''
  for (const b of resumo) hex += b.toString(16).padStart(2, '0')
  return hex === esperado
}
