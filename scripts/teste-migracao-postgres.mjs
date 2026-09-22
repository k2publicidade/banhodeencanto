import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";

const engine = new PGlite();
const server = createServer(engine);
const temporary = await mkdtemp(join(tmpdir(), "bde-migracao-"));
const access = join(temporary, "acesso.txt");
try {
  await engine.waitReady;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  const processResult = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrar-sqlite-postgres.mjs", "--confirmar"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: url, BDE_INITIAL_ACCESS_PATH: access },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
  assert.equal(processResult.code, 0, processResult.output.slice(-1500));
  const source = new DatabaseSync(fileURLToPath(new URL("../data/banho.db", import.meta.url)), { readOnly: true });
  try {
    for (const table of ["usuarios", "produtos", "variacoes", "clientes", "vendas", "vendas_itens", "estoque"]) {
      const sqlite = source.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
      const pg = (await engine.query(`SELECT COUNT(*)::int n FROM banho_encanto.${table}`)).rows[0].n;
      assert.equal(pg, sqlite, `Contagem divergente em ${table}`);
    }
    const login = await readFile(access, "utf8");
    assert.match(login, /Email: admin@banhodeencanto\.com\.br/);
    assert.doesNotMatch(login, /encanto123/);
    const admin = (await engine.query("SELECT senha_hash FROM banho_encanto.usuarios WHERE papel='admin' LIMIT 1")).rows[0];
    assert.ok(admin?.senha_hash?.includes(":"));
    const password = login.match(/^Senha: (.+)$/m)?.[1];
    const [salt, expectedHash] = admin.senha_hash.split(":");
    assert.equal(scryptSync(password, salt, 64).toString("hex"), expectedHash);
  } finally {
    source.close();
  }
  console.log("MIGRACAO OK: registros preservados e senha inicial rotacionada em PostgreSQL temporario.");
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await engine.close();
  await rm(temporary, { recursive: true, force: true });
}
