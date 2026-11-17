export interface Configuracao {
  supabaseUrl: string
  supabaseChavePublica: string
  turn?: { url: string; usuario: string; senha: string }
}

export class ErroDeConfiguracao extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeConfiguracao'
  }
}

type Ambiente = Record<string, string | undefined>

function obrigatoria(env: Ambiente, nome: string): string {
  const valor = env[nome]?.trim()
  if (!valor) throw new ErroDeConfiguracao(`Variável de ambiente ausente ou vazia: ${nome}`)
  return valor
}

function opcional(env: Ambiente, nome: string): string | undefined {
  return env[nome]?.trim() || undefined
}

export function lerConfiguracao(env: Ambiente): Configuracao {
  const textoUrl = obrigatoria(env, 'VITE_SUPABASE_URL')
  if (!/^https:\/\//i.test(textoUrl)) {
    throw new ErroDeConfiguracao('VITE_SUPABASE_URL deve começar com https://')
  }
  let url: URL
  try {
    url = new URL(textoUrl)
  } catch {
    throw new ErroDeConfiguracao('VITE_SUPABASE_URL não é uma URL válida (esperado https://projeto.supabase.co)')
  }
  // O texto (sem UMA barra final) tem de ser igual à origem normalizada pelo `URL` (comparação em minúsculas, por defesa):
  // isso recusa caminho (inclusive com espaço), ?, #, credenciais, barra invertida, tab e quebra de linha no meio (o `URL` remove tab e quebra de linha)
  // e a porta padrão :443 (o `origin` a descarta). Espaço no host já é recusado pelo `new URL` acima.
  if (textoUrl.replace(/\/$/, '').toLowerCase() !== url.origin.toLowerCase()) {
    throw new ErroDeConfiguracao(
      'VITE_SUPABASE_URL deve ser só a origem do projeto (ex.: https://abc.supabase.co), sem caminho, ?, #, credenciais ou espaços',
    )
  }
  const supabaseUrl = url.origin
  const supabaseChavePublica = obrigatoria(env, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  // Só reconhece o prefixo novo `sb_secret_`; chaves antigas JWT `service_role` não são detectadas. O valor não entra na mensagem.
  if (/^sb_secret_/i.test(supabaseChavePublica)) {
    throw new ErroDeConfiguracao('VITE_SUPABASE_PUBLISHABLE_KEY recebeu uma chave secreta (sb_secret_...): ela não pode ir para o navegador; use a chave publicável')
  }

  const turnUrl = opcional(env, 'VITE_TURN_URL')
  const usuario = opcional(env, 'VITE_TURN_USUARIO')
  const senha = opcional(env, 'VITE_TURN_SENHA')
  const config: Configuracao = { supabaseUrl, supabaseChavePublica }
  if (turnUrl && usuario && senha) config.turn = { url: turnUrl, usuario, senha }
  return config
}
