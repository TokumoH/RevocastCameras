import { correction, generate } from 'lean-qr'

/**
 * Maior texto aceito: o link de pareamento tem uns 80 caracteres (origem + caminho + `#` + 43 do
 * código); 300 deixa folga para uma origem longa e mantém o QR legível numa tela de celular.
 */
export const TAMANHO_MAXIMO_DO_TEXTO_DO_QR = 300

/**
 * Matriz de módulos do QR de `texto` (D11): `matriz[y][x]` verdadeiro = módulo escuro, sem a margem
 * (quem desenha acrescenta a zona quieta). Correção mínima M (~15%), que aguenta reflexo e tela
 * suja. Usa só o `generate()` do `lean-qr` (sem os `extras`, sem `innerHTML`); o desenho é de
 * `CodigoQr` (`src/shared/ui`). Texto vazio ou com mais de `TAMANHO_MAXIMO_DO_TEXTO_DO_QR`
 * caracteres → lança; a mensagem nunca repete o texto (o link leva o código de pareamento).
 */
export function matrizDoQr(texto: string): boolean[][] {
  if (texto.length === 0 || texto.length > TAMANHO_MAXIMO_DO_TEXTO_DO_QR) throw new Error('Texto do QR vazio ou longo demais')
  let codigo: ReturnType<typeof generate>
  try {
    codigo = generate(texto, { minCorrectionLevel: correction.M })
  } catch {
    throw new Error('Não foi possível gerar o QR')
  }
  const matriz: boolean[][] = []
  for (let y = 0; y < codigo.size; y++) {
    const linha: boolean[] = []
    for (let x = 0; x < codigo.size; x++) linha.push(codigo.get(x, y))
    matriz.push(linha)
  }
  return matriz
}
