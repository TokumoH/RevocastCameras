import { ErroDePreparacao } from '../../domains/preparacao/portas'

/**
 * Motivos que um erro do PostgREST pode ter, comuns aos adaptadores (D10 do PLA-003): a E1
 * (`traduzirErro`, que junta `em_uso` e o `invalido` de `22P02` em `outro`) e a Preparação.
 */
export type MotivoComum = 'duplicado' | 'em_uso' | 'invalido' | 'negado' | 'sessao_expirada' | 'rede' | 'outro'

/** Códigos do PostgREST para JWT inválido (`PGRST301`) e expirado (`PGRST303`). */
const JWT_RECUSADO = ['PGRST301', 'PGRST303']

/**
 * Classifica um erro do PostgREST (`{ code, message }` + status HTTP). A ordem vale:
 * (1) 401 ou JWT recusado → `sessao_expirada`, antes do `42501`, porque o PostgREST devolve `42501`
 * com 401 quando a requisição sai como `anon` (sessão apagada em outra aba, por exemplo);
 * (2) `23505` → `duplicado` (inclusive o índice `episodios_um_ao_vivo`, D2);
 * (3) `23503` → `em_uso` (som ou cena num gesto: `mapa_gestos` não tem ação de delete, D6 e D11);
 * (4) `23514` (CHECK) ou `22P02` (texto inválido para o tipo, como uuid malformado) → `invalido`;
 * (5) `42501` → `negado`;
 * (6) sem código (ou `''`) e status 0 → `rede` (o `postgrest-js` 2.119.0 devolve assim a falha do
 * `fetch`, inclusive o `TimeoutError` de `tempoLimite.ts`);
 * (7) o resto → `outro`.
 * `message` e `name` são aceitos para receber o objeto de erro como vem, mas não decidem nada: a
 * mensagem do servidor (que pode citar e-mail ou nome de arquivo) nunca sai daqui.
 */
export function classificarErro(erro: { code?: string; message?: string; name?: string } | null, status?: number): MotivoComum {
  const codigo = erro?.code ?? ''
  if (status === 401 || JWT_RECUSADO.includes(codigo)) return 'sessao_expirada'
  if (codigo === '23505') return 'duplicado'
  if (codigo === '23503') return 'em_uso'
  if (codigo === '23514' || codigo === '22P02') return 'invalido'
  if (codigo === '42501') return 'negado'
  if (codigo === '' && status === 0) return 'rede'
  return 'outro'
}

/**
 * Escrita com retorno (`update`/`delete` seguidos de `.select(<chave>)`, que vira `RETURNING`):
 * 0 linhas quer dizer que a RLS filtrou ou que a linha sumiu → `ErroDePreparacao('nada_alterado')`.
 */
export function exigirLinhas(data: unknown[] | null): void {
  if (!data || data.length === 0) throw new ErroDePreparacao('nada_alterado')
}
