/**
 * Confere o link publico como o cliente vai ver: entra pela tela de login do
 * endereco da internet, navega pelas telas e faz uma venda no PDV.
 *
 *   BASE=https://xxxx.trycloudflare.com node scripts/verificar-link-publico.mjs
 *
 * Precisa do Chrome instalado (usa puppeteer-core).
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE;
if (!BASE) {
  console.error("Informe BASE=https://....trycloudflare.com");
  process.exit(1);
}
const BANCO = process.env.BDE_DB_PATH || join(process.cwd(), "data", "apresentacao.db");
const SAIDA = join(process.env.LOCALAPPDATA || ".", "Temp", "bde-ui", "link-publico");
mkdirSync(SAIDA, { recursive: true });
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));

const db = new DatabaseSync(BANCO);
db.exec("PRAGMA busy_timeout = 8000;");
const um = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }))[0] ?? null;

const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const erros = [];
pg.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 160)));
pg.on("pageerror", (e) => erros.push(String(e.message).slice(0, 160)));

console.log("endereco:", BASE);
const t0 = Date.now();
const r = await pg.goto(BASE + "/login", { waitUntil: "networkidle2", timeout: 60000 });
console.log(`  /login -> HTTP ${r.status()} (${Date.now() - t0} ms)`);

await pg.type('input[name="email"]', "admin@banhodeencanto.com.br");
await pg.type('input[name="senha"]', "encanto123");
await Promise.all([pg.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}), pg.click('button[type="submit"]')]);
console.log("  login ->", pg.url());
await pg.screenshot({ path: join(SAIDA, "01-painel.png") });

for (const [rota, marca] of [["/caixa", "Itens da venda"], ["/produtos", "produto(s) encontrado(s)"], ["/vendas", "venda(s) no filtro"], ["/relatorios", "Curva ABC"], ["/estoque", "Lancar movimento"]]) {
  const rr = await pg.goto(BASE + rota, { waitUntil: "networkidle2", timeout: 60000 });
  const ok = await pg.evaluate((m) => document.body.innerText.includes(m), marca);
  console.log(`  ${rota.padEnd(12)} HTTP ${rr.status()}  conteudo esperado: ${ok ? "sim" : "NAO"}`);
  if (rota === "/caixa") await pg.screenshot({ path: join(SAIDA, "02-pdv.png") });
  if (rota === "/vendas") await pg.screenshot({ path: join(SAIDA, "03-vendas.png") });
}

/* venda pelo link publico (prova que a escrita funciona de fora) */
await pg.goto(BASE + "/caixa", { waitUntil: "networkidle2" });
const sku = um("select ean, produto from vw_variacoes where variacao_status='ativo' and disponivel >= 5 and ean is not null order by disponivel desc limit 1");
await pg.click("#bip");
await pg.type("#bip", String(sku.ean));
await pg.keyboard.press("Enter");
await pg.waitForFunction(() => document.querySelectorAll(".pdv-item").length > 0, { timeout: 40000 });
await pg.click(".pdv-resumo .btn-sucesso");
await pg.waitForSelector(".folha", { visible: true, timeout: 20000 });
for (const texto of ["Dinheiro", "Exato"]) {
  const el = await pg.evaluateHandle((t) => Array.from(document.querySelectorAll(".folha .btn")).find((x) => (x.textContent || "").includes(t)), texto);
  await el.asElement().click();
  await new Promise((res) => setTimeout(res, 300));
}
await pg.click(".folha-rodape .btn-sucesso");
await pg.waitForFunction(() => document.body.innerText.includes("Imprimir cupom"), { timeout: 60000 });
await pg.screenshot({ path: join(SAIDA, "04-cupom.png") });
const venda = um("select numero, total, status from vendas order by id desc limit 1");
console.log(`  venda pelo link publico: ${venda.numero} R$ ${Number(venda.total).toFixed(2)} (${venda.status})`);

console.log("  erros de console:", erros.length ? erros[0] : "nenhum");
console.log("  prints em", SAIDA);
await b.close();
db.close();
