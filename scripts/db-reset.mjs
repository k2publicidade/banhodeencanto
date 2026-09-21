/**
 * Recria o banco do zero.
 *
 * Uso:
 *   node scripts/db-reset.mjs --confirmar                 # apaga data/banho.db e cria vazio
 *   node scripts/db-reset.mjs --confirmar --com-dados      # ... e roda a carga de demonstracao
 *   node scripts/db-reset.mjs --confirmar --banco=outro.db # em outro arquivo
 *
 * Sem --confirmar o script NAO apaga nada: os dados da loja (vendas, clientes,
 * fiado) vivem nesse arquivo, entao a exclusao precisa ser explicita.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (nome) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : null;
};

const raiz = process.cwd();
const banco = arg("banco") || process.env.BDE_DB_PATH || join(raiz, "data", "banho.db");
const confirmar = argv.includes("--confirmar");
const comDados = argv.includes("--com-dados");
const schema = join(raiz, "lib", "schema.sql");

console.log("Banco: " + banco);

if (!existsSync(schema)) {
  console.error("Schema nao encontrado: " + schema);
  process.exit(1);
}

if (!confirmar) {
  const existe = existsSync(banco);
  console.error(
    "\nNada foi apagado: falta a confirmacao.\n" +
      (existe ? "O arquivo atual sera REMOVIDO (dados da loja!): " + banco + "\n" : "O arquivo ainda nao existe, entao nada se perde.\n") +
      "\nPara confirmar, rode de novo com --confirmar:\n  node scripts/db-reset.mjs --confirmar\n"
  );
  process.exit(existe ? 2 : 0);
}

/* 1. Remove o banco atual (arquivo + WAL) */
let removidos = 0;
for (const sufixo of ["", "-wal", "-shm"]) {
  const p = banco + sufixo;
  if (existsSync(p)) {
    const kb = Math.round(statSync(p).size / 1024);
    rmSync(p);
    removidos++;
    console.log(`  removido ${p} (${kb} KB)`);
  }
}
if (!removidos) console.log("  (nao havia banco para remover)");

/* 2. Cria o banco vazio aplicando o schema */
mkdirSync(dirname(banco), { recursive: true });
const db = new DatabaseSync(banco);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(schema, "utf8"));
const { tabelas } = db.prepare("SELECT COUNT(*) tabelas FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
db.close();
console.log(`Banco criado: ${tabelas} tabelas (schema aplicado).`);

/* 3. Carga de demonstracao (opcional) */
if (comDados) {
  console.log("Rodando a carga de demonstracao (db-seed)...");
  execFileSync(process.execPath, [join(raiz, "scripts", "db-seed.mjs")], {
    stdio: "inherit",
    env: { ...process.env, BDE_DB_PATH: banco },
  });
} else {
  console.log("\nBanco vazio. Para carregar dados de demonstracao: npm run db:seed");
  console.log("Acessos do sistema: veja o README.md");
}
