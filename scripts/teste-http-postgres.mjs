import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";

const root = new URL("..", import.meta.url);
const db = new PGlite();
const wire = createServer(db);
const temporary = await mkdtemp(join(tmpdir(), "bde-http-"));
let app;
async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function childProcess(bin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}
try {
  await db.waitReady;
  await new Promise((resolve, reject) => {
    wire.once("error", reject);
    wire.listen(0, "127.0.0.1", resolve);
  });
  const pgPort = wire.address().port;
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`;
  const secret = randomBytes(48).toString("hex");
  const env = { ...process.env, DATABASE_URL: databaseUrl, BDE_SECRET: secret, BDE_INITIAL_ACCESS_PATH: join(temporary, "access.txt") };
  const migration = await childProcess(process.execPath, ["scripts/migrar-sqlite-postgres.mjs", "--confirmar"], env);
  assert.equal(migration.code, 0, migration.output.slice(-2500));

  const port = await freePort();
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: root, env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let appOutput = "";
  app.stdout.on("data", (chunk) => { appOutput += chunk; });
  app.stderr.on("data", (chunk) => { appOutput += chunk; });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (app.exitCode !== null) throw new Error(`Next encerrou: ${appOutput.slice(-2000)}`);
    try {
      const response = await fetch(base + "/login", { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* ainda inicializando */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Next nao respondeu /login: ${appOutput.slice(-2000)}`);

  const body = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 3600000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  const cookie = `bde_sessao=${body}.${signature}`;
  const routes = [
    "/painel", "/produtos", "/produtos/1", "/produtos/1/etiquetas",
    "/produtos/novo", "/estoque", "/compras", "/compras/nova",
    "/clientes", "/clientes/1", "/fornecedores", "/vendas", "/vendas/1",
    "/relatorios", "/cadastros", "/cadastros/marcas", "/configuracoes",
    "/configuracoes/lojas", "/configuracoes/usuarios", "/caixa",
    "/api/exportar/estoque", "/api/exportar/vendas", "/api/venda/1",
  ];
  const failures = [];
  for (const route of routes) {
    try {
      const response = await fetch(base + route, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
      const html = await response.text();
      if (response.status !== 200 || /Internal Server Error|relation .* does not exist|errorId/.test(html)) {
        failures.push(`${route}: HTTP ${response.status} ${html.slice(0, 220)}`);
      } else {
        console.log(`OK ${route}`);
      }
    } catch (error) { failures.push(`${route}: ${error.message}`); }
  }
  assert.deepEqual(failures, [], `${failures.join("\n")}\n${appOutput.slice(-5000)}`);
  console.log(`HTTP POSTGRES OK: login e ${routes.length} rotas no build de producao.`);
} finally {
  if (app && app.exitCode === null) app.kill();
  if (wire.listening) await new Promise((resolve) => wire.close(resolve));
  await db.close();
  await rm(temporary, { recursive: true, force: true });
}
