import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

// A interface usa numeros, inclusive nos agregados COUNT/SUM do PostgreSQL.
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

const context = new AsyncLocalStorage<PoolClient>();
const globalDb = globalThis as typeof globalThis & { __bde_pool?: Pool };

export function getDb(): Pool {
  if (!globalDb.__bde_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Configure DATABASE_URL com a conexao PostgreSQL do Supabase.");
    const url = new URL(connectionString);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
    if (!local && !url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
    const pool = new Pool({
      connectionString: url.toString(), max: 1, idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000, allowExitOnIdle: true,
    });
    pool.on("error", (error) => console.error("[db] Conexao PostgreSQL interrompida:", error.message));
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalDb.__bde_pool = pool;
  }
  return globalDb.__bde_pool;
}

/** Converte apenas placeholders fora de strings, identificadores e comentarios. */
export function parametrosPostgres(sql: string): string {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (token) => token === "?" ? `$${++index}` : token);
}

async function connection<T>(fn: (client: PoolClient) => Promise<T>, write = false): Promise<T> {
  const current = context.getStore();
  if (current) return fn(current);
  const client = await getDb().connect();
  let discard = false;
  try {
    // SET LOCAL funciona inclusive no pooler em modo Transaction do Supabase.
    await client.query("BEGIN; SET LOCAL search_path = banho_encanto, pg_catalog; SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '15s'");
    if (write) await client.query("SELECT pg_advisory_xact_lock(184206, 1)");
    const result = await context.run(client, () => fn(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
  return connection(async (client) => (await client.query(parametrosPostgres(sql), params)).rows as T[]);
}

export async function one<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
  return (await all<T>(sql, ...params))[0];
}

/** INSERTs que precisam do id devem declarar RETURNING id. */
export async function run(sql: string, ...params: any[]) {
  return connection(async (client) => {
    const result = await client.query(parametrosPostgres(sql), params);
    return { changes: result.rowCount ?? 0, lastInsertRowid: Number(result.rows[0]?.id ?? 0) };
  }, true);
}

export async function exec(sql: string): Promise<void> {
  await connection(async (client) => { await client.query(sql); }, true);
}

/** Uma conexao por transacao e rollback integral. Escritas seguem a ordem do antigo SQLite. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  return connection(() => fn(), true);
}

export async function proximoNumero(nome: string, prefixo: string, largura = 6, tabela?: string): Promise<string> {
  if (tabela && !["vendas", "compras", "devolucoes", "transferencias"].includes(tabela)) throw new Error("Tabela de numeracao invalida.");
  return tx(async () => {
    await run("INSERT INTO sequencias(nome, ultimo) VALUES (?, 0) ON CONFLICT(nome) DO NOTHING", nome);
    if (tabela) {
      const maior = await one<{ m: number | null }>(
        `SELECT MAX(CASE WHEN SUBSTR(numero, ?) ~ '^[0-9]+$' THEN CAST(SUBSTR(numero, ?) AS INTEGER) END) m FROM ${tabela}`,
        prefixo.length + 1, prefixo.length + 1);
      await run("UPDATE sequencias SET ultimo = GREATEST(ultimo, ?) WHERE nome = ?", maior?.m ?? 0, nome);
    }
    const result = await one<{ ultimo: number }>("UPDATE sequencias SET ultimo = ultimo + 1 WHERE nome = ? RETURNING ultimo", nome);
    return prefixo + String(result!.ultimo).padStart(largura, "0");
  });
}

export async function auditar(opts: {
  usuario_id?: number | null; usuario_nome?: string | null; acao: string;
  entidade: string; entidade_id?: number | null; detalhe?: string | null;
}): Promise<void> {
  // Falhas fazem a operacao inteira voltar; nao deixam uma transacao PG abortada silenciosamente.
  await run(`INSERT INTO auditoria(usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe)
    VALUES (?,?,?,?,?,?)`, opts.usuario_id ?? null, opts.usuario_nome ?? null,
    opts.acao, opts.entidade, opts.entidade_id ?? null, opts.detalhe ?? null);
}

export async function config(chave: string, padrao = ""): Promise<string> {
  return (await one<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = ?", chave))?.valor ?? padrao;
}

export async function salvarConfig(chave: string, valor: string, descricao?: string): Promise<void> {
  await run(`INSERT INTO configuracoes(chave, valor, descricao) VALUES (?,?,?)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
      descricao = COALESCE(excluded.descricao, configuracoes.descricao),
      atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')`,
    chave, valor, descricao ?? null);
}
