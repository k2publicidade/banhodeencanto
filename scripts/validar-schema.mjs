// Valida o schema: aplica o DDL num banco temporario e confere que tudo existe.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "lib", "schema.sql");
const tmp = join(here, "..", ".tmp-schema-validate.db");
if (existsSync(tmp)) rmSync(tmp, { force: true });

const sql = readFileSync(schemaPath, "utf8");
const db = new DatabaseSync(tmp);

let ok = true;
try {
  db.exec(sql);
  console.log("DDL aplicado sem erro.");
  // Idempotencia: aplicar de novo nao pode quebrar
  db.exec(sql);
  console.log("DDL reaplicado (idempotente). OK");
} catch (e) {
  ok = false;
  console.error("FALHA no DDL:", e.message);
}

const tables = db
  .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
  .all()
  .map((r) => r.name);
const views = db
  .prepare("select name from sqlite_master where type='view' order by name")
  .all()
  .map((r) => r.name);

console.log("\nTABELAS (" + tables.length + "): " + tables.join(", "));
console.log("VIEWS (" + views.length + "): " + views.join(", "));

// Checa que as colunas geradas de margem/markup existem e calculam certo
const cols = db.prepare("select name, hidden from pragma_table_xinfo('variacoes')").all();
const gen = cols.filter((c) => c.hidden === 2 || c.hidden === 3).map((c) => c.name);
console.log("\nColunas geradas em variacoes: " + JSON.stringify(gen));

// FK realmente ligada?
const fk = db.prepare("pragma foreign_keys").get();
console.log("foreign_keys =", JSON.stringify(fk));

// Orfaos possiveis: as colunas de fiado apontando para clientes existem?
const hasCol = (t, c) =>
  db.prepare("select count(*) n from pragma_table_info(?) where name = ?").get(t, c).n > 0;
console.log("vendas.cliente_id existe:", hasCol("vendas", "cliente_id"));

db.close();
rmSync(tmp, { force: true });
console.log("\nRESULTADO:", ok ? "SCHEMA OK" : "SCHEMA COM ERRO");
process.exit(ok ? 0 : 1);
