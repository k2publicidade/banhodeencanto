/**
 * Valida TODAS as consultas SQL escritas no codigo-fonte contra o schema real.
 *
 * Por que existe: em 21/09 um JOIN apontava para a tabela `variacoes` (que nao
 * tem cor_codigo/comprimento) enquanto o SELECT usava colunas da view
 * `vw_variacoes`. O erro so aparecia ao abrir a pagina (HTTP 500). Este script
 * roda no CI local e aponta arquivo + linha + mensagem do SQLite.
 *
 * Uso: node scripts/validar-sql.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const RAIZ = process.cwd();
const DB = join(RAIZ, "data", "banho.db");

const db = new DatabaseSync(DB);
db.exec("PRAGMA foreign_keys = ON;");

const ALVOS = ["app", "lib", "components", "scripts"];

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome.startsWith(".")) continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) saida.push(...arquivos(p));
    else if ([".ts", ".tsx", ".mjs", ".js"].includes(extname(nome))) saida.push(p);
  }
  return saida;
}

/** Conta os `?` de posicao (ignora os que estao dentro de strings). */
function contarParams(sql) {
  let n = 0;
  let dentroAspas = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (dentroAspas && sql[i + 1] === "'") { i++; continue; }
      dentroAspas = !dentroAspas;
    } else if (c === "?" && !dentroAspas) {
      // ?1, ?2 (numerados) contam 1 vez
      n++;
      while (/\d/.test(sql[i + 1] || "")) i++;
    }
  }
  return n;
}

const problemas = [];
let analisadas = 0;
let dinamicas = 0;

for (const alvo of ALVOS) {
  let lista;
  try {
    lista = arquivos(join(RAIZ, alvo));
  } catch {
    continue;
  }
  for (const arquivo of lista) {
    const rel = relative(RAIZ, arquivo).replace(/\\/g, "/");
    if (rel.startsWith("scripts/validar-sql")) continue; // ele mesmo
    const fonte = readFileSync(arquivo, "utf8");
    const linhas = fonte.split(/\r?\n/);

    // template literals ou strings comuns
    const regex = /`([^`]*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/gs;
    let m;
    while ((m = regex.exec(fonte)) !== null) {
      const sql = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql)) continue;
      if (sql.length < 25) continue; // evita falsos positivos (strings soltas tipo "SELECT")
      if (sql.includes("${")) { dinamicas++; continue; } // SQL montado em runtime: nao da para validar aqui

      // linhas que NAO contem placeholders de template (aquelas ja chegam prontas)
      const linha = fonte.slice(0, m.index).split(/\r?\n/).length;
      const params = new Array(contarParams(sql)).fill(null);
      analisadas++;
      try {
        // EXPLAIN nao executa: valida sintaxe e nomes de colunas
        const sqlLimpo = sql.replace(/\$\{[^}]*\}/g, "'x'");
        db.prepare("EXPLAIN QUERY PLAN " + sqlLimpo).all(...params);
      } catch (e) {
        problemas.push({
          arquivo: rel,
          linha,
          erro: String(e.message || e).replace(/\s+/g, " "),
          sql: sql.replace(/\s+/g, " ").slice(0, 180),
          trechoFonte: linhas[linha - 1]?.trim().slice(0, 120) || "",
        });
      }
    }
  }
}

console.log(`Consultas analisadas: ${analisadas} (ignoradas por montagem dinamica: ${dinamicas})`);
if (!problemas.length) {
  console.log("RESULTADO: TODAS AS CONSULTAS OK");
  process.exit(0);
}
console.log(`CONSULTAS COM ERRO: ${problemas.length}\n`);
for (const p of problemas) {
  console.log(`- ${p.arquivo}:${p.linha}  ${p.erro}`);
  console.log(`    SQL: ${p.sql}`);
  if (p.trechoFonte) console.log(`    src: ${p.trechoFonte}`);
}
process.exit(1);
