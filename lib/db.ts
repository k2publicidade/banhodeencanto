import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Conexao unica com o banco (SQLite nativo do Node).
 * O arquivo fica em <projeto>/data/banho.db.
 */

const DATA_DIR = join(process.cwd(), "data");
export const DB_PATH = process.env.BDE_DB_PATH || join(DATA_DIR, "banho.db");

type GlobalWithDb = typeof globalThis & { __bde_db?: DatabaseSync };
const g = globalThis as GlobalWithDb;

function createDb(): DatabaseSync {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 8000;");

  // Garante o schema (idempotente) na primeira conexao
  const hasProdutos = db
    .prepare("select count(*) n from sqlite_master where type='table' and name='produtos'")
    .get() as { n: number };
  if (!hasProdutos || hasProdutos.n === 0) {
    const schemaPath = join(process.cwd(), "lib", "schema.sql");
    if (existsSync(schemaPath)) db.exec(readFileSync(schemaPath, "utf8"));
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!g.__bde_db) g.__bde_db = createDb();
  return g.__bde_db;
}

/* ------------------------------------------------------------------ */
/* Helpers de consulta                                                 */
/*                                                                     */
/* node:sqlite devolve linhas com PROTOTIPO NULO. O React recusa      */
/* passar esses objetos a Client Components ("Only plain objects...   */
/* can be passed"), por isso todo resultado e convertido em objeto    */
/* comum antes de sair da camada de dados.                            */
/* ------------------------------------------------------------------ */

const plain = <T>(r: any): T => (r === null || r === undefined ? r : ({ ...r } as T));

/** Reexecuta com o SQL no erro: sem isso, um erro de SQL fica impossivel de rastrear. */
function comContexto<T>(sql: string, params: any[], fn: () => T): T {
  try {
    return fn();
  } catch (e: any) {
    const compacto = sql.replace(/\s+/g, " ").trim().slice(0, 400);
    const err = new Error(`[db] ${e?.message || e} | SQL: ${compacto} | params: ${JSON.stringify(params)}`);
    (err as any).cause = e;
    throw err;
  }
}

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return comContexto(sql, params, () => {
    const linhas = getDb().prepare(sql).all(...params) as any[];
    return linhas.map((r) => plain<T>(r));
  });
}

export function one<T = any>(sql: string, ...params: any[]): T | undefined {
  return comContexto(sql, params, () => plain<T | undefined>(getDb().prepare(sql).get(...params)));
}

export function run(sql: string, ...params: any[]) {
  return getDb().prepare(sql).run(...params);
}

export function exec(sql: string) {
  return getDb().exec(sql);
}

/** Executa varias operacoes numa transacao: rollback automatico se falhar. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignora */
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Sequenciais (numeracao de venda / compra / devolucao / cliente)      */
/* ------------------------------------------------------------------ */

/**
 * Sequenciais (numeracao de venda / compra / devolucao / cliente).
 *
 * A tabela `sequencias` guarda o ultimo numero emitido, mas ela pode ficar
 * fora de sincronia (por exemplo num banco semeado: as vendas existem e a
 * sequencia nao). Por isso, quando o nome da tabela e informado, o numero
 * gerado e conferido contra ela: se ja existir, a sequencia avanca ate achar
 * um numero livre. Assim a numeracao nunca quebra por UNIQUE constraint.
 */
export function proximoNumero(nome: string, prefixo: string, largura = 6, tabela?: string): string {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO sequencias(nome, ultimo) VALUES (?, 0)").run(nome);

  const montar = (n: number) => prefixo + String(n).padStart(largura, "0");
  const existe = (numero: string) =>
    tabela ? Number((db.prepare(`SELECT COUNT(*) n FROM ${tabela} WHERE numero = ?`).get(numero) as { n: number }).n) > 0 : false;

  if (tabela) {
    // Alinha a sequencia com o maior numero ja gravado, se preciso.
    const maior = db
      .prepare(`SELECT MAX(CAST(SUBSTR(numero, ?) AS INTEGER)) m FROM ${tabela}`)
      .get(prefixo.length + 1) as { m: number | null };
    const ultimo = (db.prepare("SELECT ultimo FROM sequencias WHERE nome = ?").get(nome) as { ultimo: number }).ultimo;
    if (maior.m !== null && maior.m > ultimo) {
      db.prepare("UPDATE sequencias SET ultimo = ? WHERE nome = ?").run(maior.m, nome);
    }
  }

  for (let tentativa = 0; tentativa < 1000; tentativa++) {
    db.prepare("UPDATE sequencias SET ultimo = ultimo + 1 WHERE nome = ?").run(nome);
    const numero = montar((db.prepare("SELECT ultimo FROM sequencias WHERE nome = ?").get(nome) as { ultimo: number }).ultimo);
    if (!existe(numero)) return numero;
  }
  throw new Error(`Nao foi possivel gerar um numero livre para ${nome} (sequencia muito defasada).`);
}

/* ------------------------------------------------------------------ */
/* Auditoria                                                           */
/* ------------------------------------------------------------------ */

export function auditar(opts: {
  usuario_id?: number | null;
  usuario_nome?: string | null;
  acao: string;
  entidade: string;
  entidade_id?: number | null;
  detalhe?: string | null;
}) {
  try {
    run(
      `INSERT INTO auditoria(usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe)
       VALUES (?,?,?,?,?,?)`,
      opts.usuario_id ?? null,
      opts.usuario_nome ?? null,
      opts.acao,
      opts.entidade,
      opts.entidade_id ?? null,
      opts.detalhe ?? null
    );
  } catch {
    /* auditoria nunca derruba a operacao principal */
  }
}

/** Configuracoes chave/valor */
export function config(chave: string, padrao = ""): string {
  const r = one<{ valor: string }>("SELECT valor FROM configuracoes WHERE chave = ?", chave);
  return r?.valor ?? padrao;
}

export function salvarConfig(chave: string, valor: string, descricao?: string) {
  run(
    `INSERT INTO configuracoes(chave, valor, descricao, atualizado_em)
     VALUES (?,?,?, datetime('now','localtime'))
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
       descricao = COALESCE(excluded.descricao, configuracoes.descricao),
       atualizado_em = datetime('now','localtime')`,
    chave,
    valor,
    descricao ?? null
  );
}
