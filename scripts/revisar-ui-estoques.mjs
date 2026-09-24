/**
 * Revisao visual das telas de estoque separado.
 *
 * Sobe o sistema com um PostgreSQL em memoria (PGlite) carregado do banco
 * local (que ja tem loja + galpao) e tira foto das telas novas em celular e
 * desktop. E so para olhar com os proprios olhos - nao valida regra de negocio
 * (isso e o test:estoques).
 *
 * Uso: node scripts/revisar-ui-estoques.mjs [--pasta=data/revisao-ui]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const arg = (nome, padrao) => {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};
const pasta = arg("pasta", join(process.cwd(), "data", "revisao-ui"));

const TELAS = [
  { nome: "estoque-mobile", url: "/estoque", largura: 390, altura: 900 },
  { nome: "estoque-desktop", url: "/estoque", largura: 1440, altura: 1000 },
  { nome: "estoque-galpao", url: "/estoque?estoque=2", largura: 1440, altura: 1000 },
  { nome: "transferencia-mobile", url: "/estoque/transferencia", largura: 390, altura: 1200 },
  { nome: "transferencia-desktop", url: "/estoque/transferencia", largura: 1440, altura: 1200 },
  { nome: "movimentos-desktop", url: "/estoque/movimentos", largura: 1440, altura: 1000 },
  { nome: "locais-desktop", url: "/configuracoes/lojas", largura: 1440, altura: 1200 },
  { nome: "pdv-mobile", url: "/caixa", largura: 390, altura: 900 },
  { nome: "pdv-desktop", url: "/caixa", largura: 1440, altura: 1000 },
];

const engine = new PGlite();
const wire = createServer(engine);
let app = null;
let navegador = null;
const temporario = await mkdtemp(join(tmpdir(), "bde-ui-"));

const porta = async () => {
  const s = createTcpServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};

try {
  await mkdir(pasta, { recursive: true });
  await engine.waitReady;
  await new Promise((resolve, reject) => {
    wire.once("error", reject);
    wire.listen(0, "127.0.0.1", resolve);
  });
  const DATABASE_URL = `postgresql://postgres:***@127.0.0.1:${wire.address().port}/postgres?sslmode=disable`;
  const BDE_SECRET = randomBytes(48).toString("hex");

  const migrar = spawn(process.execPath, ["scripts/migrar-sqlite-postgres.mjs", "--confirmar"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL, BDE_SECRET },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const saidaMigracao = await new Promise((r) => {
    let t = "";
    migrar.stderr.on("data", (c) => (t += c));
    migrar.on("close", (code) => r({ code, t }));
  });
  if (saidaMigracao.code !== 0) throw new Error("migracao falhou: " + saidaMigracao.t.slice(-800));

  const portaApp = await porta();
  const BASE = `http://127.0.0.1:${portaApp}`;
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(portaApp)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL, BDE_SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logApp = "";
  app.stdout.on("data", (c) => (logApp += c));
  app.stderr.on("data", (c) => (logApp += c));

  let pronto = false;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(BASE + "/login", { signal: AbortSignal.timeout(3000) });
      if (r.status === 200) {
        pronto = true;
        break;
      }
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!pronto) throw new Error("servidor nao subiu: " + logApp.slice(-1200));

  const adminId = (await engine.query("SELECT id FROM banho_encanto.usuarios WHERE papel='admin' ORDER BY id LIMIT 1")).rows[0].id;
  const corpo = Buffer.from(JSON.stringify({ uid: adminId, exp: Date.now() + 3600_000 })).toString("base64url");
  const valorCookie = corpo + "." + createHmac("sha256", BDE_SECRET).update(corpo).digest("base64url");

  navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const alvos = await navegador.pages();
  const pg = alvos[0] ?? (await navegador.newPage());
  await pg.setCookie({ name: "bde_sessao", value: valorCookie, url: BASE });

  for (const tela of TELAS) {
    await pg.setViewport({ width: tela.largura, height: tela.altura, deviceScaleFactor: 1, isMobile: tela.largura < 900 });
    await pg.goto(BASE + tela.url, { waitUntil: "networkidle2", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 600));
    const arquivo = join(pasta, `${tela.nome}.png`);
    await pg.screenshot({ path: arquivo, fullPage: false });
    console.log("foto: " + arquivo);
  }
  console.log("\nPronto. Abra a pasta para conferir: " + pasta);
} catch (e) {
  console.error("FALHA: " + (e?.message || e));
  process.exitCode = 1;
} finally {
  if (navegador) await navegador.close().catch(() => {});
  if (app) app.kill();
  try {
    wire.close();
  } catch {
    /* ja fechado */
  }
  await engine.close().catch(() => {});
  await rm(temporario, { recursive: true, force: true });
}
