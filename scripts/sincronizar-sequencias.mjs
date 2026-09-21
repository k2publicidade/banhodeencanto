/**
 * Sincroniza a tabela `sequencias` com os numeros ja gravados.
 *
 * Serve para bancos que foram semeados/importados sem atualizar as sequencias:
 * sem isso, a proxima venda tentaria usar um numero ja existente e falharia
 * com "UNIQUE constraint failed: vendas.numero".
 *
 * Uso: node scripts/sincronizar-sequencias.mjs [caminho-do-banco]
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dbPath = process.argv[2] || process.env.BDE_DB_PATH || join(process.cwd(), "data", "banho.db");
if (!existsSync(dbPath)) {
  console.error("Banco nao encontrado: " + dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 8000;");

const TABELAS = [
  { nome: "venda", prefixo: "V", tabela: "vendas" },
  { nome: "compra", prefixo: "CMP-", tabela: "compras" },
  { nome: "devolucao", prefixo: "D", tabela: "devolucoes" },
];

let mudou = 0;
for (const t of TABELAS) {
  const { m } = db
    .prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(numero, ${t.prefixo.length + 1}) AS INTEGER)), 0) m FROM ${t.tabela}`)
    .get();
  const antes = db.prepare("SELECT ultimo FROM sequencias WHERE nome = ?").get(t.nome)?.ultimo ?? null;
  db.prepare(
    `INSERT INTO sequencias(nome, ultimo) VALUES (?, ?)
     ON CONFLICT(nome) DO UPDATE SET ultimo = MAX(sequencias.ultimo, excluded.ultimo)`
  ).run(t.nome, m);
  const depois = db.prepare("SELECT ultimo FROM sequencias WHERE nome = ?").get(t.nome).ultimo;
  if (antes !== depois) mudou++;
  console.log(`${t.tabela.padEnd(11)} maior numero gravado: ${m} | sequencia: ${antes ?? "(nao existia)"} -> ${depois}`);
}

db.close();
console.log(mudou ? `\n${mudou} sequencia(s) ajustada(s).` : "\nNada a ajustar.");
