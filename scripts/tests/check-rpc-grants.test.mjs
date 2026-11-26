import { describe, expect, test, vi } from 'vitest'
import { codigoDoCorpo, regrasDeFuncao, verificarGrants } from '../check-rpc-grants.mjs'

// O SQL de cada teste é aplicado de verdade num PGlite com a simulação do Supabase (scripts/_catalogo.mjs);
// as regras leem o catálogo resultante. Todo caso usa SQL aceito pelo Postgres, salvo os de erro de SQL.

/** papel_atual mínima (isenta da chamada de papel), para os corpos poderem chamá-la. */
const PAPEL = `create function public.papel_atual() returns text language sql stable security definer set search_path = '' as $$ select null::text $$;
revoke execute on function public.papel_atual() from public, anon, service_role;
grant execute on function public.papel_atual() to authenticated;`

const CHAMA = 'select case when public.papel_atual() is null then 0 else 1 end'

/** Função de exemplo correta; cada opção troca uma parte. */
function funcao({ nome = 'f', corpo = CHAMA, props = "security definer set search_path = ''", linguagem = 'sql', revoke = 'public, anon, service_role', grant = 'authenticated', retorno = 'int' } = {}) {
  return `${PAPEL}
create function public.${nome}() returns ${retorno} language ${linguagem} ${props} as $corpo$ ${corpo} $corpo$;
${revoke ? `revoke execute on function public.${nome}() from ${revoke};` : ''}
${grant ? `grant execute on function public.${nome}() to ${grant};` : ''}`
}

// O primeiro teste de cada arquivo inicializa o PGlite (alguns segundos, mais com a máquina ocupada).
vi.setConfig({ testTimeout: 60_000 })

const verificar = (sql) => verificarGrants(sql)

// Formas que só um superusuário consegue (no Supabase, o postgres que aplica as migrações não é superusuário): aplicadas
// como postgres_sim, dão erro de SQL (ver catalogo.test.mjs). Aqui a migração escala (set session authorization postgres)
// e volta ao dono no fim, desvio que a conferência do usuário da sessão não vê: o catálogo continua acusando.
const su = (sql) => `set session authorization postgres; ${sql} set session authorization postgres_sim;`

describe('regras do DES-001 (seções 8 e 13)', () => {
  test('função correta: nenhum erro', async () => {
    expect(await verificar(funcao())).toEqual([])
  })

  test('sem SECURITY DEFINER', async () => {
    expect(await verificar(funcao({ props: "set search_path = ''" }))).toEqual(['public.f: sem SECURITY DEFINER'])
  })

  test('SECURITY DEFINER sem search_path', async () => {
    expect(await verificar(funcao({ props: 'security definer' }))).toEqual(['public.f: SECURITY DEFINER sem set search_path'])
  })

  test('sem SECURITY DEFINER e sem search_path', async () => {
    expect(await verificar(funcao({ props: '' }))).toEqual(['public.f: sem SECURITY DEFINER', 'public.f: sem set search_path'])
  })

  test.each([["set search_path = public"], ["set search_path = '', public"], ['set search_path = pg_catalog'], ['set search_path from current']])('search_path não vazio (%s)', async (sp) => {
    expect(await verificar(funcao({ props: `security definer ${sp}` }))).toEqual(["public.f: set search_path deve ser vazio ('')"])
  })

  test("set search_path from current com o caminho da sessão vazio vale como ''", async () => {
    expect(await verificar(`set search_path = ''; ${funcao({ props: 'security definer set search_path from current' })}`)).toEqual([])
  })

  test('sem REVOKE: PUBLIC (ACL padrão) e anon (privilégio padrão do Supabase) executam', async () => {
    expect(await verificar(funcao({ revoke: null }))).toEqual([
      'public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
      'public.f: EXECUTE concedido a service_role (só authenticated é permitido)',
    ])
  })

  test('REVOKE só de anon (e service_role): os dois ainda executam por PUBLIC', async () => {
    expect(await verificar(funcao({ revoke: 'anon, service_role' }))).toEqual([
      'public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
    ])
  })

  test('REVOKE só de public: anon mantém o privilégio padrão', async () => {
    expect(await verificar(funcao({ revoke: 'public, service_role' }))).toEqual([
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
    ])
  })

  test('sem GRANT explícito: authenticated já executa pelo privilégio padrão do Supabase', async () => {
    expect(await verificar(funcao({ grant: null }))).toEqual([])
  })

  test('authenticated sem EXECUTE', async () => {
    expect(await verificar(funcao({ revoke: 'public, anon, service_role, authenticated', grant: null }))).toEqual([
      'public.f: authenticated sem EXECUTE (falta grant execute ... to authenticated)',
    ])
  })

  test('GRANT a anon', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to anon;`)).toEqual([
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
    ])
  })

  test('GRANT a public', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to public;`)).toEqual([
      'public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
    ])
  })

  // Correção 17b: a simulação cria service_role (BYPASSRLS) com o padrão do Supabase; o EXECUTE dele é acusado como o de anon.
  test('GRANT a service_role', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to service_role;`)).toEqual([
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f: EXECUTE concedido a service_role (só authenticated é permitido)',
    ])
  })

  test('sem o revoke de service_role: ele executa pelo privilégio padrão do Supabase', async () => {
    expect(await verificar(funcao({ revoke: 'public, anon' }))).toEqual([
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f: EXECUTE concedido a service_role (só authenticated é permitido)',
    ])
  })

  test('service_role herdando EXECUTE de outro papel (participação)', async () => {
    const sql = `${funcao()} create role r; grant execute on function public.f() to r; ${su('grant r to service_role;')}`
    expect(await verificar(sql)).toEqual([
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f: EXECUTE concedido a r (só authenticated é permitido)',
    ])
  })

  test('GRANT com grant option', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to authenticated with grant option;`)).toEqual([
      'public.f: authenticated com grant option (pode repassar o EXECUTE)',
    ])
  })

  // Correção 16 (revisão 14, N3, equivalente da data-api): a exceção do dono vale também com grant option explícito.
  test('dono com grant option explícito: aceito', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to postgres_sim with grant option;`)).toEqual([])
  })

  test('corpo sem chamada de papel', async () => {
    expect(await verificar(funcao({ corpo: 'select 1' }))).toEqual(['public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  test('chamada de dispositivo_atual também vale', async () => {
    const sql = `create function public.dispositivo_atual() returns table (id uuid) language sql stable security definer set search_path = '' as $$ select null::uuid $$;
revoke execute on function public.dispositivo_atual() from public, anon, service_role; grant execute on function public.dispositivo_atual() to authenticated;
${funcao({ corpo: 'select count(*)::int from public.dispositivo_atual()' })}`
    expect(await verificar(sql)).toEqual([])
  })

  test.each(['papel_atual', 'dispositivo_atual', 'criar_perfil_membro', 'parear_dispositivo'])('exceção %s: não precisa chamar papel', async (nome) => {
    const sql = `create function public.${nome}() returns int language sql security definer set search_path = '' as $$ select 1 $$;
revoke execute on function public.${nome}() from public, anon, service_role; grant execute on function public.${nome}() to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('exceção só vale em public', async () => {
    const sql = `${PAPEL} create schema privado authorization postgres_sim; create function privado.papel_atual() returns int language sql security definer set search_path = '' as $$ select 1 $$;
revoke execute on function privado.papel_atual() from public, anon, service_role; grant execute on function privado.papel_atual() to authenticated;`
    expect(await verificar(sql)).toEqual([
      'privado.papel_atual: fora do schema public (o DES-001 põe tudo em public)',
      'privado.papel_atual: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('sobrecarga de função isenta é recusada (a exceção é pelo nome)', async () => {
    const sql = `${PAPEL} create function public.papel_atual(x int) returns int language sql security definer set search_path = '' as $$ select 1 $$;
revoke execute on function public.papel_atual(int) from public, anon, service_role; grant execute on function public.papel_atual(int) to authenticated;`
    expect(await verificar(sql)).toEqual([
      'public.papel_atual(): sobrecarga de função isenta da chamada de papel: forma não suportada',
      'public.papel_atual(x integer): sobrecarga de função isenta da chamada de papel: forma não suportada',
    ])
  })

  test('sobrecarga comum: cada assinatura é conferida por inteiro', async () => {
    const sql = `${funcao()} create function public.f(x int) returns int language sql security definer set search_path = '' as $$ select x $$;`
    expect(await verificar(sql)).toEqual([
      'public.f(x integer): PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.f(x integer): anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f(x integer): service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f(x integer): EXECUTE concedido a anon (só authenticated é permitido)',
      'public.f(x integer): EXECUTE concedido a service_role (só authenticated é permitido)',
      'public.f(x integer): corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('SQL vazio: nada conferido', async () => {
    expect(await verificar('')).toEqual(['nenhuma função criada pelas migrações: a checagem não conferiu nada'])
  })

  test('só tabela, sem função: nada conferido', async () => {
    expect(await verificar('create table public.t (id int);')).toEqual(['nenhuma função criada pelas migrações: a checagem não conferiu nada'])
  })

  test('erro de SQL: a mensagem do Postgres, com a linha', async () => {
    expect(await verificar(`${PAPEL}\ncreate functio public.x();`)).toEqual(['sql: erro de SQL: syntax error at or near "functio" (linha 4)'])
  })
})

describe('regras além do DES-001', () => {
  test('função fora de public', async () => {
    const sql = `${PAPEL} create schema privado authorization postgres_sim; create function privado.g() returns int language sql security definer set search_path = '' as $$ ${CHAMA} $$;
revoke execute on function privado.g() from public, anon, service_role; grant execute on function privado.g() to authenticated;`
    expect(await verificar(sql)).toEqual(['privado.g: fora do schema public (o DES-001 põe tudo em public)'])
  })

  test('dono diferente do papel das migrações (owner to authenticated)', async () => {
    expect(await verificar(`${funcao()} ${su('alter function public.f() owner to authenticated;')}`)).toEqual([
      'public.f: dono é authenticated (só postgres_sim, o papel que aplica as migrações)',
    ])
  })

  test.each([['set standard_conforming_strings = off', 'standard_conforming_strings'], ['set row_security = off', 'row_security']])('SET além do search_path (%s)', async (set, nome) => {
    expect(await verificar(funcao({ props: `security definer set search_path = '' ${set}` }))).toEqual([`public.f: set ${nome} além do search_path: forma não suportada`])
  })

  // Parâmetro sem definição (placeholder): só um superusuário pode gravá-lo numa função (como no Supabase).
  test('SET de parâmetro sem definição (set app.x = 1): erro de SQL do Postgres', async () => {
    expect(await verificar(funcao({ props: "security definer set search_path = '' set app.x = 1" }))).toEqual(['sql: erro de SQL: permission denied to set parameter "app.x" (linha 4)'])
  })

  test('procedure segue as mesmas regras', async () => {
    const sql = `${PAPEL} create procedure public.p() language sql as $$ select 1 $$;`
    expect(await verificar(sql)).toEqual([
      'public.p: sem SECURITY DEFINER',
      'public.p: sem set search_path',
      'public.p: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.p: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.p: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.p: EXECUTE concedido a anon (só authenticated é permitido)',
      'public.p: EXECUTE concedido a service_role (só authenticated é permitido)',
      'public.p: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('agregado criado pelas migrações: forma não suportada', async () => {
    const sql = `${funcao()} create aggregate public.soma(int) (sfunc = int4pl, stype = int);`
    expect(await verificar(sql)).toEqual(['public.soma: agregado criado pelas migrações: forma não suportada'])
  })

  test('linguagem que não é sql nem plpgsql: o corpo não conta como chamada', async () => {
    const sql = `${PAPEL} ${su("create function public.g(text) returns text language internal security definer set search_path = '' as 'textin'; alter function public.g(text) owner to postgres_sim;")}
revoke execute on function public.g(text) from public, anon, service_role; grant execute on function public.g(text) to authenticated;`
    expect(await verificar(sql)).toEqual(['public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  test('privilégio padrão: EXECUTE a anon nas funções criadas depois', async () => {
    expect(await verificar(`${funcao()} alter default privileges grant execute on functions to anon;`)).toEqual([
      'alter default privileges (papel postgres_sim, todos os schemas, funções): EXECUTE para anon nas funções criadas depois (só authenticated é permitido)',
    ])
  })

  test('privilégio padrão: EXECUTE a public no schema public', async () => {
    const sql = `${funcao()} alter default privileges in schema public grant execute on functions to public;`
    expect(await verificar(sql)).toEqual([
      'alter default privileges (papel postgres_sim, schema public, funções): EXECUTE para PUBLIC nas funções criadas depois (só authenticated é permitido)',
    ])
  })

  // Correção 17b: em public, o EXECUTE padrão de service_role já é o da base (como o de anon); a linha global é ganho.
  test('privilégio padrão: EXECUTE a service_role em todos os schemas', async () => {
    expect(await verificar(`${funcao()} alter default privileges grant execute on functions to service_role;`)).toEqual([
      'alter default privileges (papel postgres_sim, todos os schemas, funções): EXECUTE para service_role nas funções criadas depois (só authenticated é permitido)',
    ])
  })

  test('privilégio padrão que já era o da base (anon e service_role em public, PUBLIC global) não muda nada', async () => {
    const sql = `${funcao()} alter default privileges in schema public grant execute on functions to anon, service_role; alter default privileges grant execute on functions to public;`
    expect(await verificar(sql)).toEqual([])
  })

  test('privilégio padrão: EXECUTE a authenticated nas funções criadas depois é aceito', async () => {
    expect(await verificar(`${funcao()} alter default privileges grant execute on functions to authenticated;`)).toEqual([])
  })

  test('privilégio padrão: revoke de anon e public é aceito', async () => {
    expect(await verificar(`${funcao()} alter default privileges in schema public revoke execute on functions from anon;`)).toEqual([])
  })

  test('função pré-existente do Postgres com grant a anon (pg_read_file)', async () => {
    expect(await verificar(`${funcao()} ${su('grant execute on function pg_catalog.pg_read_file(text) to anon;')}`)).toEqual([
      'pg_catalog.pg_read_file(text): função pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada',
    ])
  })

  test.each([
    ['nome (rename)', su('alter function auth.uid() rename to uid2;'), 'auth.uid2()'],
    ['schema (set schema)', su('create schema s; alter function auth.uid() set schema s;'), 's.uid()'],
    ['dono (owner to)', su('alter function auth.uid() owner to anon;'), 'auth.uid()'],
    ['SET (proconfig)', su('alter function auth.jwt() set search_path = public;'), 'auth.jwt()'],
    ['corpo (create or replace)', su("create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;"), 'auth.uid()'],
    ['linguagem e corpo', su('create or replace function auth.uid() returns uuid language plpgsql stable as $$ begin return null; end $$;'), 'auth.uid()'],
    ['corpo begin atomic', su('create or replace function auth.uid() returns uuid language sql stable begin atomic select null::uuid; end;'), 'auth.uid()'],
  ])('função pré-existente alterada: %s', async (_caso, sql, rotulo) => {
    expect(await verificar(`${funcao()} ${sql}`)).toEqual([
      `${rotulo}: função pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada`,
    ])
  })

  // UPDATE direto no catálogo (só um superusuário consegue; no Supabase as migrações não rodam como superusuário):
  // cada campo da impressão digital de função, sozinho, também é acusado.
  test.each([
    ['prokind', su("update pg_catalog.pg_proc set prokind = 'p' where oid = 'auth.uid'::regproc;"), 'auth.uid()'],
    ['prolang', su("update pg_catalog.pg_proc set prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql') where oid = 'auth.uid'::regproc;"), 'auth.uid()'],
    ['probin', su("update pg_catalog.pg_proc set probin = 'x' where oid = 'auth.uid'::regproc;"), 'auth.uid()'],
    ['prorettype', su("update pg_catalog.pg_proc set prorettype = 'pg_catalog.text'::pg_catalog.regtype where oid = 'auth.uid'::regproc;"), 'auth.uid()'],
    ['proargtypes', su("update pg_catalog.pg_proc set proargtypes = '25', pronargs = 1 where oid = 'auth.uid'::regproc;"), 'auth.uid(text)'],
    ['prosqlbody', su("update pg_catalog.pg_proc set prosqlbody = (select prosqlbody from pg_catalog.pg_proc where oid = 'pg_catalog.rpad(text,integer)'::regprocedure) where oid = 'pg_catalog.lpad(text,integer)'::regprocedure;"), 'pg_catalog.lpad(text, integer)'],
  ])('função pré-existente alterada por UPDATE no catálogo: %s', async (_caso, sql, rotulo) => {
    expect(await verificar(`${funcao()} ${sql}`)).toEqual([
      `${rotulo}: função pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada`,
    ])
  })

  // Revisão 13, I1: objeto temporário sobrando no fim da migração é recusado; apagado na própria migração, fica de fora.
  test('função temporária (pg_temp) sobrando no fim da migração: forma não suportada', async () => {
    expect(await verificar(`${funcao()} create function pg_temp.aux() returns int language sql as $$ select 1 $$;`)).toEqual([
      'sql: objeto temporário sobrando no fim da migração (function pg_temp.aux()): forma não suportada; apague-o na própria migração (drop)',
    ])
  })

  test('função temporária (pg_temp) apagada na própria migração: fica de fora', async () => {
    expect(await verificar(`${funcao()} create function pg_temp.aux() returns int language sql as $$ select 1 $$; drop function pg_temp.aux();`)).toEqual([])
  })

  test('função da simulação alterada ou removida', async () => {
    expect(await verificar(`${funcao()} ${su('alter function auth.jwt() security definer; drop function auth.uid();')}`)).toEqual([
      'auth.jwt(): função pré-existente (Postgres ou simulação do Supabase): alteração pelas migrações: forma não suportada',
      'auth.uid(): função pré-existente (Postgres ou simulação do Supabase): remoção pelas migrações: forma não suportada',
    ])
  })
})

describe('estado final (ordem dos comandos e das migrações)', () => {
  test('alter function ... security invoker depois do create', async () => {
    expect(await verificar(`${funcao()} alter function public.f() security invoker;`)).toEqual(['public.f: sem SECURITY DEFINER'])
  })

  test('alter function ... reset search_path depois do create', async () => {
    expect(await verificar(`${funcao()} alter function public.f() reset search_path;`)).toEqual(['public.f: SECURITY DEFINER sem set search_path'])
  })

  test("alter function ... set search_path = '' e security definer depois do create corrigem", async () => {
    expect(await verificar(`${funcao({ props: '' })} alter function public.f() security definer set search_path = '';`)).toEqual([])
  })

  test('revoke depois de um grant posterior: vale o último', async () => {
    expect(await verificar(`${funcao({ revoke: null })} revoke execute on function public.f() from public, anon, service_role;`)).toEqual([])
  })

  test('grant a anon depois do revoke volta a abrir', async () => {
    expect(await verificar(`${funcao()} grant execute on function public.f() to anon;`)).toContain('public.f: anon com EXECUTE (falta revoke execute ... from anon)')
  })

  test('drop e recriação sem revoke: vale a nova', async () => {
    const sql = `${funcao()} drop function public.f(); create function public.f() returns int language sql security definer set search_path = '' as $$ ${CHAMA} $$;`
    expect(await verificar(sql)).toEqual([
      'public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
      'public.f: EXECUTE concedido a service_role (só authenticated é permitido)',
    ])
  })

  test('create or replace mantém os grants (como no Postgres)', async () => {
    expect(await verificar(`${funcao()} create or replace function public.f() returns int language sql security definer set search_path = '' as $$ ${CHAMA} $$;`)).toEqual([])
  })

  test('alter ruim seguido de drop e recriação correta', async () => {
    const sql = `${funcao()} alter function public.f() security invoker; drop function public.f(); ${funcao().replace(PAPEL, '')}`
    expect(await verificar(sql)).toEqual([])
  })

  test('drop duplo com if exists (mutantes 347/755 da revisão 11)', async () => {
    const sql = `${funcao({ nome: 'h' })} create function public.f() returns int language sql as $$ select 1 $$; drop function public.f(); drop function if exists public.f();`
    expect(await verificar(sql)).toEqual([])
  })

  test.each(['allx.y', 'search_pathx.y'])('alter function ... reset %s não mexe no search_path (mutante 306)', async (g) => {
    expect(await verificar(`${funcao()} ${su(`alter function public.f() reset ${g};`)}`)).toEqual([])
  })
})

describe('corpo real da função (prosrc ou corpo begin atomic desparseado)', () => {
  test('o corpo é o do as, não um texto num set anterior (revisão 11, I3)', async () => {
    const sql = `${PAPEL} create function public.g() returns int language sql security definer set search_path = '' set application_name = $$public.papel_atual()$$ as $$ select 1 $$;
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(sql)).toEqual([
      'public.g: set application_name além do search_path: forma não suportada',
      'public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test.each([
    ['comentário de linha', 'select 1 -- public.papel_atual()'],
    ['comentário de bloco aninhado', 'select 1 /* a /* b */ public.papel_atual() */'],
    ['texto', "select length(' public.papel_atual() ')"],
    ['texto E com aspa escapada', "select length(E'\\' public.papel_atual() ')"],
    ['texto com aspa dobrada', "select length('it''s public.papel_atual()')"],
    ['dollar-quote com tag não-ASCII', 'select length($é$ public.papel_atual() $é$)'],
    ['texto U&', "select length(U&' public.papel_atual() ')"],
    ['identificador entre aspas', 'select 1 as "public.papel_atual()"'],
    ['nome com prefixo', 'select 1 from (select 1) as xpublic(papel_atual)'],
    ['nome parecido', "select 1 where 'x' = 'public.papel_atual_x()'"],
  ])('chamada que não é chamada: %s', async (_caso, corpo) => {
    const sql = `${PAPEL} create function public.papel_atual_x() returns text language sql as $$ select 'x' $$; ${funcao({ corpo }).replace(PAPEL, '')}`
    const erros = await verificar(sql)
    expect(erros).toContain('public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()')
  })

  test('texto de corpo as \'...\' com aspas dobradas: a chamada só aparece dentro de um texto (mutantes 591/597)', async () => {
    const sql = `${PAPEL} create function public.g() returns text language sql security definer set search_path = '' as 'select '' public.papel_atual()''';
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(sql)).toEqual(['public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  test.each([
    ['chamada qualificada', CHAMA],
    ['entre aspas simples', 'select case when "public"."papel_atual"() is null then 0 else 1 end'],
    ['com espaços e comentário no meio', 'select case when public . /* x */ papel_atual ( ) is null then 0 else 1 end'],
    ['depois de \\r que termina o comentário', 'select 1 -- x\r + case when public.papel_atual() is null then 0 else 1 end'],
    ['em maiúsculas', 'SELECT CASE WHEN PUBLIC.PAPEL_ATUAL() IS NULL THEN 0 ELSE 1 END'],
  ])('chamada reconhecida: %s', async (_caso, corpo) => {
    expect(await verificar(funcao({ corpo }))).toEqual([])
  })

  test('tabela chamada public.papel_atual (sem parênteses) não é chamada', async () => {
    const sql = `create table public.papel_atual (id int); ${funcao({ corpo: 'select count(*)::int from public.papel_atual' })}`
    expect(await verificar(sql)).toEqual([
      'public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
      'public.papel_atual: tipo ou relação com o nome de uma função de papel (no corpo, pareceria a chamada): forma não suportada',
    ])
  })

  // Revisão 12: no texto, `insert into public.papel_atual (id)` e o cast `public.papel_atual('x')` parecem a chamada.
  test.each([
    ['tabela e insert com lista de colunas', 'create table public.papel_atual (id int);', 'begin insert into public.papel_atual (id) values (1); return 1; end;', 'public.papel_atual'],
    ['domínio e cast em forma de função', 'create domain public.papel_atual as text;', "begin perform public.papel_atual('admin'); return 1; end;", 'public.papel_atual'],
    ['tipo composto com o nome de dispositivo_atual', 'create type public.dispositivo_atual as (id int);', 'begin perform public.dispositivo_atual(1); return 1; end;', 'public.dispositivo_atual'],
  ])('tipo ou relação com o nome de uma função de papel: %s', async (_caso, tipo, corpo, rotulo) => {
    expect(await verificar(`${tipo} ${funcao({ linguagem: 'plpgsql', corpo })}`)).toEqual([
      `${rotulo}: tipo ou relação com o nome de uma função de papel (no corpo, pareceria a chamada): forma não suportada`,
    ])
  })

  test('tipo de mesmo nome fora de public não é acusado por esta regra', async () => {
    const erros = await verificar(`${su('create schema s authorization postgres_sim;')} create type s.papel_atual as (id int); ${funcao()}`)
    expect(erros.filter((e) => e.includes('nome de uma função de papel'))).toEqual([])
  })

  test("palavra terminada em e antes de aspa (else'a\\') é texto comum, sem escape: a chamada depois dele conta", async () => {
    const corpo = "select case when false then 'x' else'a\\' end || coalesce(public.papel_atual(), '')"
    expect(await verificar(funcao({ corpo, retorno: 'text' }))).toEqual([])
  })

  test.each(['uq', 'xu'])('%s&"public" não é identificador U&: a chamada conta (plpgsql)', async (palavra) => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: `begin perform ${palavra}&"public".papel_atual(); return 1; end;` }))).toEqual([])
  })

  test('parâmetro $1 antes da chamada não abre dollar-quote', async () => {
    const sql = `${PAPEL} create function public.g(text) returns text language sql security definer set search_path = '' as $c$ select case when $1 = public.papel_atual() then $q$x$q$ end $c$;
revoke execute on function public.g(text) from public, anon, service_role; grant execute on function public.g(text) to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('plpgsql com chamada', async () => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: 'begin perform public.papel_atual(); return 1; end;' }))).toEqual([])
  })

  test('plpgsql com chamada sem schema (com search_path vazio, falharia ao executar): acusado', async () => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: 'begin perform papel_atual(); return 1; end;' }))).toEqual([
      'public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('sql com chamada sem schema: o próprio Postgres recusa ao criar', async () => {
    expect(await verificar(funcao({ corpo: 'select case when papel_atual() is null then 0 else 1 end' }))).toEqual([
      expect.stringMatching(/^sql: erro de SQL: function papel_atual\(\) does not exist/),
    ])
  })

  test('plpgsql com a chamada só num execute dinâmico (texto): acusado', async () => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: "begin execute 'select public.papel_atual()'; return 1; end;" }))).toEqual([
      'public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('begin atomic: a dependência de outra função não conta para esta', async () => {
    const sql = `${PAPEL} create function public.g() returns int language sql security definer set search_path = '' begin atomic select 1; end;
create function public.h() returns int language sql security definer set search_path = '' begin atomic ${CHAMA}; end;
revoke execute on function public.g(), public.h() from public, anon, service_role; grant execute on function public.g(), public.h() to authenticated;`
    expect(await verificar(sql)).toEqual(['public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  // Revisão 12, I2 (mutante 503): `""` dentro do identificador é aspa, não o fim dele; o schema chamado é `"public`.
  test('schema """public" (aspa dentro do nome) não é public', async () => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: 'begin perform """public".papel_atual(); return 1; end;' }))).toEqual([
      'public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('identificador com aspas dobradas antes da chamada ("x""y")', async () => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo: 'begin perform "x""y", public.papel_atual(), "z"; return 1; end;' }))).toEqual([])
  })

  test('begin atomic chamando dispositivo_atual', async () => {
    const sql = `create function public.dispositivo_atual() returns table (id uuid) language sql stable security definer set search_path = '' as $$ select null::uuid $$;
revoke execute on function public.dispositivo_atual() from public, anon, service_role; grant execute on function public.dispositivo_atual() to authenticated;
create function public.g() returns int language sql security definer set search_path = '' begin atomic select count(*)::int from public.dispositivo_atual(); end;
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test.each([
    ["E'...' com duas barras escapadas antes da chamada", "select length(E'\\\\\\\\') + case when public.papel_atual() is null then 0 else 1 end"],
    ['subtração antes da chamada', "select 0 - length(coalesce(public.papel_atual(), ''))"],
    ['divisão antes da chamada', "select 0 / 1 + length(coalesce(public.papel_atual(), ''))"],
    ['comentário de bloco com barra dentro', "select /* a/b */ length(coalesce(public.papel_atual(), ''))"],
  ])('chamada reconhecida depois de: %s', async (_caso, corpo) => {
    expect(await verificar(funcao({ corpo }))).toEqual([])
  })

  test.each([
    ['comentário de bloco com asterisco dentro', 'begin perform 1; /* a*b public.papel_atual() */ return 1; end;'],
    ['identificador com aspas dobradas ("pub""lic")', 'begin perform "pub""lic".papel_atual(); return 1; end;'],
    // Revisão 13, N1: o "." do lookbehind de chamaPapel; nome em três partes é de outro banco, não a função de public.
    ['nome em três partes (outrobd.public.papel_atual)', 'begin perform outrobd.public.papel_atual(); return 1; end;'],
  ])('não é chamada (plpgsql): %s', async (_caso, corpo) => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo }))).toEqual(['public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  test.each([
    ["u'' antes da chamada (u seguido de texto vazio)", "begin perform u'' || public.papel_atual() || ''; return 1; end;"],
    ['u& sem aspas depois', 'begin perform u&public.papel_atual(); return 1; end;'],
  ])('chamada reconhecida (plpgsql): %s', async (_caso, corpo) => {
    expect(await verificar(funcao({ linguagem: 'plpgsql', corpo }))).toEqual([])
  })

  // Revisão 12, I1: o valor padrão de um parâmetro e uma constante regproc não são chamadas no corpo (o pg_depend os
  // registra como dependência da função; o corpo desparseado pelo Postgres não os tem).
  test.each([
    ['begin atomic, valor padrão de parâmetro', "create function public.g(p_papel text default public.papel_atual()) returns int language sql security definer set search_path = '' begin atomic select case when p_papel = 'admin' then 1 else 0 end; end;"],
    ['begin atomic, constante regproc', "create function public.g(p_papel text default null) returns int language sql security definer set search_path = '' begin atomic select (('public.papel_atual'::regproc)::oid)::int; end;"],
    ['begin atomic, constante regprocedure', "create function public.g(p_papel text default null) returns int language sql security definer set search_path = '' begin atomic select length(('public.papel_atual()'::regprocedure)::text); end;"],
    ['sql em texto, valor padrão de parâmetro', "create function public.g(p_papel text default public.papel_atual()) returns int language sql security definer set search_path = '' as $$ select case when p_papel = 'admin' then 1 else 0 end $$;"],
    ['plpgsql, valor padrão de parâmetro', "create function public.g(p_papel text default public.papel_atual()) returns int language plpgsql security definer set search_path = '' as $$ begin return case when p_papel = 'admin' then 1 else 0 end; end $$;"],
  ])('não é chamada no corpo: %s', async (_caso, criar) => {
    const sql = `${PAPEL} ${criar}
revoke execute on function public.g(text) from public, anon, service_role; grant execute on function public.g(text) to authenticated;`
    expect(await verificar(sql)).toEqual(['public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
  })

  test('begin atomic: chamada sem schema, resolvida ao criar pelo search_path da sessão, é a de public', async () => {
    const sql = `${PAPEL} create function public.g() returns int language sql security definer set search_path = '' begin atomic select length(papel_atual()); end;
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('begin atomic: valor padrão com a chamada e o corpo também chamando: aceito', async () => {
    const sql = `${PAPEL} create function public.g(p text default public.papel_atual()) returns int language sql security definer set search_path = '' begin atomic select length(public.papel_atual()); end;
revoke execute on function public.g(text) from public, anon, service_role; grant execute on function public.g(text) to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('begin atomic: lido no corpo desparseado pelo Postgres', async () => {
    const corpo = (c) => `${PAPEL} create function public.g() returns int language sql security definer set search_path = '' begin atomic ${c}; end;
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(corpo('select 1'))).toEqual(['public.g: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()'])
    expect(await verificar(corpo(CHAMA))).toEqual([])
  })

  test('papel_atual de outro schema não vale', async () => {
    const sql = `${PAPEL} ${su('create schema evil authorization postgres_sim;')} create function evil.papel_atual() returns int language sql as $$ select 1 $$;
${funcao({ corpo: 'select evil.papel_atual()' }).replace(PAPEL, '')}`
    const erros = await verificar(sql)
    expect(erros).toContain('public.f: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()')
    expect(erros).toContain('evil.papel_atual: fora do schema public (o DES-001 põe tudo em public)')
  })
})

describe('formas que a leitura por texto não via (revisões 10 e 11)', () => {
  test('nome U&"x" (revisão 11, I2 e mutante 318)', async () => {
    expect(await verificar(`${PAPEL} create function public.U&"x"() returns int language sql security definer as $$ select 1 $$;`)).toEqual([
      'public.x: SECURITY DEFINER sem set search_path',
      'public.x: PUBLIC com EXECUTE (falta revoke execute ... from public)',
      'public.x: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.x: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.x: EXECUTE concedido a anon (só authenticated é permitido)',
      'public.x: EXECUTE concedido a service_role (só authenticated é permitido)',
      'public.x: corpo sem chamada de public.papel_atual() ou public.dispositivo_atual()',
    ])
  })

  test('nome entre aspas com maiúsculas: conferido como qualquer outro', async () => {
    const sql = `${PAPEL} create function public."Equipe"() returns int language sql security definer set search_path = '' as $$ ${CHAMA} $$;
revoke execute on function public."Equipe"() from public, anon, service_role; grant execute on function public."Equipe"() to authenticated;`
    expect(await verificar(sql)).toEqual([])
  })

  test('comentário terminado por \\r esconderia o grant para a leitura por texto', async () => {
    expect(await verificar(`${funcao()} -- nota\rgrant execute on function public.f() to anon;`)).toContain('public.f: anon com EXECUTE (falta revoke execute ... from anon)')
  })

  test('tag $é$ esconderia o grant para a leitura por texto', async () => {
    expect(await verificar(`${funcao()} select $é$'$é$; grant execute on function public.f() to anon; select $é$'$é$;`)).toContain(
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
    )
  })

  test('do $$ execute $$ com grant dinâmico', async () => {
    expect(await verificar(`${funcao()} do $$ begin execute 'grant execute on function public.f() to anon'; end $$;`)).toContain(
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
    )
  })

  test('grant execute on all functions in schema public to anon', async () => {
    expect(await verificar(`${funcao()} grant execute on all functions in schema public to anon;`)).toEqual([
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.f: EXECUTE concedido a anon (só authenticated é permitido)',
      'public.papel_atual: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.papel_atual: EXECUTE concedido a anon (só authenticated é permitido)',
    ])
  })

  test('grant authenticated to anon: anon executa por herança', async () => {
    expect(await verificar(`${funcao()} ${su('grant authenticated to anon;')}`)).toEqual([
      'public.f: anon com EXECUTE (falta revoke execute ... from anon)',
      'public.papel_atual: anon com EXECUTE (falta revoke execute ... from anon)',
    ])
  })

  test('alter extension ... add não esconde a função', async () => {
    expect(await verificar(`${funcao({ revoke: null })} ${su('alter extension plpgsql add function public.f();')}`)).toContain('public.f: PUBLIC com EXECUTE (falta revoke execute ... from public)')
  })

  test('create schema com grant embutido', async () => {
    expect(await verificar(`${funcao()} ${su('create schema extra grant execute on function public.f() to anon;')}`)).toContain('public.f: anon com EXECUTE (falta revoke execute ... from anon)')
  })

  test('alter function public.f()security invoker, sem espaço (mutante 256)', async () => {
    expect(await verificar(`${funcao()} alter function public.f()security invoker;`)).toEqual(['public.f: sem SECURITY DEFINER'])
  })

  test('returns table(security definer_t) não é SECURITY DEFINER (mutante 283)', async () => {
    const sql = `${PAPEL} create type public.definer_t as (x int); create function public.g() returns table(security public.definer_t) language sql set search_path = '' as $$ select null::public.definer_t where public.papel_atual() is null $$;
revoke execute on function public.g() from public, anon, service_role; grant execute on function public.g() to authenticated;`
    expect(await verificar(sql)).toEqual(['public.g: sem SECURITY DEFINER'])
  })

  test('papéis chamados "cascade" e "restrict" (mutante 77)', async () => {
    const sql = `create role "cascade"; create role "restrict"; ${funcao()} grant execute on function public.f() to authenticated, "restrict", "cascade";`
    expect(await verificar(sql)).toEqual([
      'public.f: EXECUTE concedido a restrict (só authenticated é permitido)',
      'public.f: EXECUTE concedido a cascade (só authenticated é permitido)',
    ])
  })

  test('funções chamadas cascade e restrict não somem com o drop de outra (mutantes 251/252)', async () => {
    const sql = `${PAPEL} create function public.cascade() returns int language sql as $$ select 1 $$; create function public.g() returns int language sql as $$ select 1 $$; drop function public.g() cascade;`
    expect((await verificar(sql)).filter((e) => e.startsWith('public.cascade:'))).toHaveLength(8)
  })
})

describe('regrasDeFuncao (sobre um catálogo montado à mão)', () => {
  test('sem nenhuma função', () => {
    const c = { funcoes: [], relacoes: [], funcoesPreexistentes: [], tiposNovos: [], aclPadrao: [], papeisDoSupabase: { anon: '1', authenticated: '2' }, donoDasMigracoes: 'postgres', nomeDoPapel: String }
    expect(regrasDeFuncao(c)).toEqual(['nenhuma função criada pelas migrações: a checagem não conferiu nada'])
  })
})

// Correção 17b (revisão 15, I1; decisão do controlador, opção b): função de gatilho SECURITY DEFINER ligada a gatilho
// em relação criada pelas migrações é forma não suportada (grava como o dono, por fora da RLS, e a política da relação
// não contém o gatilho). A ligada só a relação pré-existente (auth.users, onde só o Auth insere) continua aceita.
describe('funções de gatilho (correção 17b)', () => {
  const TABELA = 'create table public.t (id int); alter table public.t enable row level security;'
  const gatilho = ({ props = "security definer set search_path = ''", nome = 'g' } = {}) => `${PAPEL}
create function public.${nome}() returns trigger language plpgsql ${props} as $$ begin perform public.papel_atual(); return new; end $$;
revoke execute on function public.${nome}() from public, anon, service_role; grant execute on function public.${nome}() to authenticated;`
  const erro = (rels, nome = 'g') => `public.${nome}: função de gatilho SECURITY DEFINER em ${rels}: forma não suportada (grava como o dono, por fora da RLS; use SECURITY INVOKER)`

  test.each([
    ['before insert, por linha', 'before insert on public.t for each row'],
    ['after update, por linha', 'after update on public.t for each row'],
    ['de comando (for each statement)', 'before delete on public.t for each statement'],
    ['after insert de comando', 'after insert on public.t for each statement'],
  ])('SECURITY DEFINER em relação das migrações: %s', async (_caso, evento) => {
    expect(await verificar(`${TABELA} ${gatilho()} create trigger x ${evento} execute function public.g();`)).toEqual([erro('public.t')])
  })

  test('relação pré-existente (auth.users, como a migração real): aceita', async () => {
    expect(await verificar(`${gatilho()} create trigger x after insert on auth.users for each row execute function public.g();`)).toEqual([])
  })

  test('função compartilhada entre auth.users e uma relação das migrações: acusada só pela das migrações', async () => {
    const sql = `${TABELA} ${gatilho()} create trigger x after insert on auth.users for each row execute function public.g();
create trigger y before insert on public.t for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([erro('public.t')])
  })

  test('dois gatilhos em duas relações das migrações (e dois na mesma): cada relação uma vez, em ordem', async () => {
    const sql = `${TABELA} create table public.a (id int); ${gatilho()}
create trigger x before insert on public.t for each row execute function public.g();
create trigger z before update on public.t for each row execute function public.g();
create trigger y after insert on public.a for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([erro('public.a, public.t')])
  })

  test('INSTEAD OF em view das migrações', async () => {
    const sql = `${TABELA} create view public.v with (security_invoker) as select id from public.t; ${gatilho()}
create trigger x instead of insert on public.v for each row execute function public.g();`
    expect(await verificar(sql)).toEqual([erro('public.v')])
  })

  test('SECURITY INVOKER em relação das migrações: aceita (não exige SECURITY DEFINER)', async () => {
    expect(await verificar(`${TABELA} ${gatilho({ props: "set search_path = ''" })} create trigger x before insert on public.t for each row execute function public.g();`)).toEqual([])
  })

  test('SECURITY INVOKER sem gatilho em relação das migrações: continua "sem SECURITY DEFINER"', async () => {
    expect(await verificar(`${gatilho({ props: "set search_path = ''" })} create trigger x after insert on auth.users for each row execute function public.g();`)).toEqual(['public.g: sem SECURITY DEFINER'])
    expect(await verificar(gatilho({ props: "set search_path = ''" }))).toEqual(['public.g: sem SECURITY DEFINER'])
  })

  test('SECURITY INVOKER em relação das migrações: as outras regras continuam (search_path)', async () => {
    expect(await verificar(`${TABELA} ${gatilho({ props: '' })} create trigger x before insert on public.t for each row execute function public.g();`)).toEqual(['public.g: sem set search_path'])
  })

  test('gatilho apagado no fim: SECURITY DEFINER volta a ser exigido e aceito', async () => {
    expect(await verificar(`${TABELA} ${gatilho()} create trigger x before insert on public.t for each row execute function public.g(); drop trigger x on public.t;`)).toEqual([])
  })

  // SQL da sonda insere.mjs da revisão 15: BEFORE INSERT que devolve NULL e grava em outra tabela, com a política
  // "with check (false)"; authenticated gravava em log_x. O revoke da sonda não cita service_role (o padrão dá EXECUTE).
  test('sonda insere.mjs da revisão 15: acusada', async () => {
    const sonda = `create table public.pedidos (id uuid primary key default gen_random_uuid(), texto text not null); alter table public.pedidos enable row level security; create table public.log_x (id bigint generated always as identity primary key, texto text); alter table public.log_x enable row level security; create policy log_x_le on public.log_x for select to authenticated using ((select public.papel_atual()) = 'admin'); grant select on public.log_x to authenticated; create policy pedidos_ins on public.pedidos for insert to authenticated with check (false); create policy pedidos_le on public.pedidos for select to authenticated using (true); grant select, insert on public.pedidos to authenticated; create function public.pedidos_trg() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.log_x (texto) values (new.texto || coalesce(public.papel_atual()::text,'')); return null; end; $$; revoke execute on function public.pedidos_trg() from public, anon; grant execute on function public.pedidos_trg() to authenticated; create trigger pedidos_trg before insert on public.pedidos for each row execute function public.pedidos_trg();`
    expect(await verificar(`${PAPEL} ${sonda}`)).toEqual([
      'public.pedidos_trg: função de gatilho SECURITY DEFINER em public.pedidos: forma não suportada (grava como o dono, por fora da RLS; use SECURITY INVOKER)',
      'public.pedidos_trg: service_role com EXECUTE (falta revoke execute ... from service_role)',
      'public.pedidos_trg: EXECUTE concedido a service_role (só authenticated é permitido)',
    ])
  })
})

describe('codigoDoCorpo', () => {
  test.each([
    ['select 1 -- c\nx', 'select 1  \nx'],
    ['select 1 -- c\rx', 'select 1  \rx'],
    ["a 'b''c' d", 'a   d'],
    ["a E'b\\'c' d", 'a   d'],
    ["a e'b\\\\' d", 'a   d'],
    ["abe'x' d", 'abe  d'],
    ['a $x$ b $x$ c', 'a   c'],
    ['a $é$ b $é$ c', 'a   c'],
    ['a $$ b $$ c', 'a   c'],
    ['a$b$ c', 'a$b$ c'],
    ['$1 + $2', '$1 + $2'],
    ['a /* b /* c */ d */ e', 'a   e'],
    ['"""public".x', ' "?" .x'],
    ['a "sem fim', 'a  "?" '],
    ['"Public"."X" "public"', ' "?" . "?"  public'],
    ['U&"x" U&\'y\' b\'1\' x\'f\' n\'z\'', ' "?"    b  x  n '],
    ['SELECT X', 'select x'],
    ["a 'sem fim", 'a  '],
  ])('%j', (entrada, saida) => {
    expect(codigoDoCorpo(entrada)).toBe(saida)
  })
})
