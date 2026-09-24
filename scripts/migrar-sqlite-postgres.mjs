// Migra os dados locais sem copiar colunas geradas nem expor valores nos logs.
// Exige DATABASE_URL e --confirmar. Nunca substitui dados de destino.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Pool } from "pg";

if (!process.argv.includes("--confirmar")) {
  console.error("Uso: DATABASE_URL=<url> npm run db:migrar -- --confirmar [--origem=caminho/banho.db]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurada.");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = resolve(process.argv.find((arg) => arg.startsWith("--origem="))?.slice(9)
  ?? process.env.BDE_DB_PATH ?? join(root, "data", "banho.db"));
if (!existsSync(origem)) throw new Error(`Banco de origem nao encontrado: ${origem}`);

const source = new DatabaseSync(origem, { readOnly: true });
const connection = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname) &&
    !connection.searchParams.has("sslmode")) connection.searchParams.set("sslmode", "require");
if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname) &&
    !connection.searchParams.has("uselibpqcompat")) connection.searchParams.set("uselibpqcompat", "true");
const pool = new Pool({ connectionString: connection.toString(), max: 1 });
const client = await pool.connect();
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const hashSenha = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const senhaPadrao = (hash) => {
  if (!hash?.includes(":")) return false;
  const [salt, expected] = hash.split(":");
  const digest = scryptSync("encanto123", salt, 64);
  const target = Buffer.from(expected, "hex");
  return digest.length === target.length && timingSafeEqual(digest, target);
};
try {
  const schema = readFileSync(join(root, "lib", "schema-postgres.sql"), "utf8");
  const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/g)].map((m) => m[1]);
  if (tables.length < 20) throw new Error("Schema PostgreSQL incompleto.");
  // O schema e idempotente; os dados sao gravados somente depois da checagem.
  await client.query(schema);
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path = banho_encanto, pg_catalog");
  const current = await client.query("SELECT COUNT(*)::int n FROM usuarios");
  const currentProducts = await client.query("SELECT COUNT(*)::int n FROM produtos");
  if (current.rows[0].n || currentProducts.rows[0].n) {
    throw new Error("O destino ja contem usuarios ou produtos. Migracao interrompida para preservar dados.");
  }
  let total = 0;
  let acessoInicial = null;
  for (const table of tables) {
    const sourceExists = source.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n;
    // O banco de origem pode ser mais antigo que o schema atual (uma tabela nova,
    // como `transferencias`, nao existe nele). Nesse caso nao ha o que copiar.
    if (!sourceExists) {
      console.log(`${table}: tabela ausente na origem (nada a copiar)`);
      continue;
    }
    const columns = source.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all()
      .filter((column) => column.hidden === 0).map((column) => column.name);
    const rows = source.prepare(`SELECT ${columns.map(identifier).join(",")} FROM ${identifier(table)}`).all();
    for (let start = 0; start < rows.length; start += 50) {
      const batch = rows.slice(start, start + 50);
      const params = batch.flatMap((row) => columns.map((column) => row[column]));
      const tuples = batch.map((_, rowIndex) => `(${columns.map((__, columnIndex) =>
        `$${rowIndex * columns.length + columnIndex + 1}`).join(",")})`).join(",");
      await client.query(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")}) VALUES ${tuples}`, params);
    }
    if (columns.includes("id") && rows.length) {
      await client.query("SELECT setval(pg_get_serial_sequence($1, 'id'), $2)",
        [`banho_encanto.${table}`, Math.max(...rows.map((row) => Number(row.id)))]);
    }
    total += rows.length;
    console.log(`${table}: ${rows.length} registros`);
  }
  // Credenciais de demonstracao nunca devem chegar a uma URL publica.
  const demoUsers = source.prepare("SELECT id, email, papel, senha_hash FROM usuarios").all()
    .filter((user) => senhaPadrao(user.senha_hash));
  for (const user of demoUsers) {
    const password = randomBytes(24).toString("base64url");
    const pin = String(randomBytes(4).readUInt32BE() % 1000000).padStart(6, "0");
    await client.query("UPDATE usuarios SET senha_hash = $1, pin = $2 WHERE id = $3", [hashSenha(password), pin, user.id]);
    if (user.papel === "admin" && !acessoInicial) acessoInicial = { email: user.email, password, pin };
  }
  if (!acessoInicial) throw new Error("Nao foi encontrado administrador com senha de demonstracao; configure uma conta administradora antes de publicar.");
  await client.query("COMMIT");
  const accessPath = process.env.BDE_INITIAL_ACCESS_PATH ?? join(root, "data", "acesso-inicial.txt");
  writeFileSync(accessPath,
    `Acesso inicial a producao (mude a senha depois de entrar)\nEmail: ${acessoInicial.email}\nSenha: ${acessoInicial.password}\nPIN: ${acessoInicial.pin}\n`,
    { mode: 0o600 });
  console.log("Acesso inicial salvo em arquivo local privado (ignorado pelo Git por padrao).");
  console.log(`Migracao concluida: ${total} registros em ${tables.length} tabelas.`);
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* conexao ja encerrada */ }
  throw error;
} finally {
  client.release();
  await pool.end();
  source.close();
}
