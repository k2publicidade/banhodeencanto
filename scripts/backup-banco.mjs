/**
 * Backup consistente do banco (copia o arquivo com o WAL ja aplicado).
 *
 * Uso:
 *   node scripts/backup-banco.mjs                      # salva em backups/banho-AAAA-MM-DD-HHMM.db
 *   node scripts/backup-banco.mjs --destino=/backups   # pasta de destino (volume do Docker)
 *   node scripts/backup-banco.mjs --manter=30          # quantos backups manter (padrao 30)
 *
 * Agende no servidor (cron): 0 3 * * * cd /app && node scripts/backup-banco.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const origem = process.env.BDE_DB_PATH || join(process.cwd(), "data", "banho.db");
const destinoDir = arg("destino", join(process.cwd(), "backups"));
const manter = Number(arg("manter", "30"));

if (!existsSync(origem)) {
  console.error("Banco nao encontrado: " + origem);
  process.exit(1);
}

/* 1. Aplica o WAL no arquivo principal (senao a copia perde as ultimas gravacoes) */
try {
  const db = new DatabaseSync(origem);
  db.exec("PRAGMA busy_timeout = 8000;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
} catch (e) {
  console.error("Nao consegui preparar o banco: " + e.message);
  process.exit(1);
}

/* 2. Copia para o nome com data e hora */
mkdirSync(destinoDir, { recursive: true });
const agora = new Date();
const dois = (n) => String(n).padStart(2, "0");
const nome = `banho-${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}.db`;
const destino = join(destinoDir, nome);
copyFileSync(origem, destino);
const kb = Math.round(statSync(destino).size / 1024);
console.log(`Backup criado: ${destino} (${kb} KB)`);

/* 3. Remove os backups mais antigos, mantendo os N ultimos */
const backups = readdirSync(destinoDir)
  .filter((f) => /^banho-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f))
  .map((f) => ({ f, t: statSync(join(destinoDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

for (const antigo of backups.slice(manter)) {
  rmSync(join(destinoDir, antigo.f), { force: true });
  console.log("Removido (acima do limite de " + manter + "): " + antigo.f);
}
console.log(`Backups guardados em ${destinoDir}: ${Math.min(backups.length, manter)}`);

/* Para restaurar: pare o sistema, copie o arquivo escolhido para o caminho do
   banco (BDE_DB_PATH) e suba de novo. O arquivo -wal pode ser apagado. */
