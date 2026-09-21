/**
 * Smoke test HTTP: forja uma sessao valida (mesmo algoritmo de lib/auth.ts)
 * e percorre todas as rotas do sistema, verificando status e ausencia de erro.
 *
 * Uso: node scripts/teste-rotas.mjs [--base http://localhost:3000]
 */
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1] || process.env.BASE || "http://localhost:3000";

const segredoPath = join(process.cwd(), "data", ".secret");
let segredo;
if (process.env.BDE_SECRET) {
  segredo = process.env.BDE_SECRET;
} else if (existsSync(segredoPath)) {
  segredo = readFileSync(segredoPath, "utf8").trim();
} else {
  // Mesmo comportamento de lib/auth.ts: cria a chave na primeira execucao
  const { randomBytes, writeFileSync, mkdirSync } = await import("node:crypto").then(async (c) => ({
    randomBytes: c.randomBytes,
    writeFileSync: (await import("node:fs")).writeFileSync,
    mkdirSync: (await import("node:fs")).mkdirSync,
  }));
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  segredo = randomBytes(48).toString("hex");
  writeFileSync(segredoPath, segredo, { mode: 0o600 });
  console.log("data/.secret criado agora.");
}

function cookiePara(uid) {
  const corpo = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 3600_000 })).toString("base64url");
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("base64url");
  return "bde_sessao=" + corpo + "." + assinatura;
}

const COOKIE_ADMIN = cookiePara(1);   // Admin
const COOKIE_CAIXA = cookiePara(5);   // Operador de caixa

const ROTAS = [
  { url: "/login", semSessao: true, espera: [200] },
  { url: "/painel", espera: [200], marca: "Visao geral da loja" },
  { url: "/caixa", espera: [200], marca: "Banho de Encanto" },
  { url: "/produtos", espera: [200], marca: "Produtos e SKUs" },
  { url: "/produtos?q=jumbo", espera: [200], marca: "produto(s) encontrado" },
  { url: "/produtos?marca=1&status=ativo&ordem=margem", espera: [200] },
  { url: "/produtos/1", espera: [200], marca: "Identificacao" },
  { url: "/produtos/1?aba=cabelos", espera: [200], marca: "Classificacao especifica" },
  { url: "/produtos/1?aba=variacoes", espera: [200], marca: "variacao" },
  { url: "/produtos/1?aba=precos", espera: [200], marca: "Tabela comercial" },
  { url: "/produtos/1?aba=estoque", espera: [200] },
  { url: "/produtos/1?aba=fornecedores", espera: [200] },
  { url: "/produtos/1?aba=fiscal", espera: [200], marca: "NCM" },
  { url: "/produtos/1?aba=site", espera: [200], marca: "E-commerce" },
  { url: "/produtos/1?aba=gestao", espera: [200], marca: "Curva ABC" },
  { url: "/produtos/1/etiquetas", espera: [200], marca: "codigo de barras" },
  { url: "/produtos/novo", espera: [200] },
  { url: "/estoque", espera: [200], marca: "Posicao de estoque" },
  { url: "/estoque?situacao=critico", espera: [200] },
  { url: "/estoque?q=1B", espera: [200] },
  { url: "/compras", espera: [200], marca: "entrada de mercadoria" },
  { url: "/compras/nova", espera: [200], marca: "Sugestao de compra" },
  { url: "/compras/nova?q=jumbo", espera: [200] },
  { url: "/fornecedores", espera: [200], marca: "Fornecedores" },
  { url: "/clientes", espera: [200], marca: "Clientes e fiado" },
  { url: "/clientes/1", espera: [200] },
  { url: "/vendas", espera: [200], marca: "Vendas" },
  { url: "/vendas?status=concluida", espera: [200] },
  { url: "/vendas/1", espera: [200], marca: "Registrar devolucao" },
  { url: "/relatorios", espera: [200], marca: "Curva ABC" },
  { url: "/relatorios?dias=7", espera: [200] },
  { url: "/cadastros", espera: [200], marca: "Cadastros auxiliares" },
  { url: "/cadastros/marcas", espera: [200] },
  { url: "/cadastros/cores", espera: [200] },
  { url: "/cadastros/categorias", espera: [200] },
  { url: "/cadastros/formas_pagamento", espera: [200] },
  { url: "/configuracoes", espera: [200], marca: "Configuracoes" },
  { url: "/configuracoes/usuarios", espera: [200] },
  { url: "/configuracoes/lojas", espera: [200] },
  { url: "/api/exportar/estoque", espera: [200], csv: true },
  { url: "/api/exportar/vendas", espera: [200], csv: true },
];

// Rotas que exigem sessao: sem cookie devem redirecionar para /login
const PROTEgidas = ["/painel", "/produtos", "/estoque", "/vendas", "/relatorios", "/configuracoes"];

const problemas = [];
let ok = 0;

async function checar(rota) {
  const cookie = rota.semSessao ? "" : COOKIE_ADMIN;
  let r, corpo = "";
  try {
    r = await fetch(BASE + rota.url, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    if (rota.csv || rota.espera.includes(200)) {
      corpo = await r.text();
    }
  } catch (e) {
    problemas.push(`${rota.url} -> erro de conexao: ${e.message}`);
    return;
  }
  const status = r.status;
  if (!rota.espera.includes(status)) {
    problemas.push(`${rota.url} -> HTTP ${status} (esperado ${rota.espera.join("/")})`);
    return;
  }
  if (status === 200) {
    const marcasErro = ["Application error", "Internal Server Error", "Unhandled Runtime Error", "digest"];
    const achouErro = marcasErro.find((m) => corpo.includes(m));
    if (achouErro) {
      problemas.push(`${rota.url} -> corpo contem "${achouErro}"`);
      return;
    }
    if (rota.marca && !corpo.includes(rota.marca)) {
      problemas.push(`${rota.url} -> nao contem o texto esperado "${rota.marca}"`);
      return;
    }
  }
  ok++;
}

console.log("BASE = " + BASE + "\n");

for (const rota of ROTAS) {
  await checar(rota);
  process.stdout.write(problemas.length && problemas[problemas.length - 1].startsWith(rota.url) ? "" : "");
}

// Sessao obrigatoria
console.log("--- Rotas protegidas sem sessao (devem redirecionar para /login) ---");
for (const p of PROTEgidas) {
  try {
    const r = await fetch(BASE + p, { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    if (r.status >= 300 && r.status < 400 && loc.includes("/login")) {
      ok++;
    } else {
      problemas.push(`${p} sem sessao -> HTTP ${r.status} location=${loc} (esperado redirect para /login)`);
    }
  } catch (e) {
    problemas.push(`${p} sem sessao -> erro: ${e.message}`);
  }
}

// Cookie invalido nao pode autenticar
console.log("--- Cookie adulterado (deve falhar) ---");
{
  const r = await fetch(BASE + "/painel", { headers: { cookie: "bde_sessao=abcdef.assinaturafalsa" }, redirect: "manual" });
  const loc = r.headers.get("location") || "";
  if (r.status >= 300 && r.status < 400 && loc.includes("/login")) ok++;
  else problemas.push(`/painel com cookie falso -> HTTP ${r.status} (deveria redirecionar para /login)`);
}

// Exportacao CSV precisa ter conteudo real
console.log("--- Exportacao CSV ---");
{
  const r = await fetch(BASE + "/api/exportar/estoque", { headers: { cookie: COOKIE_ADMIN } });
  const csv = await r.text();
  const linhas = csv.trim().split("\n").length;
  if (linhas > 100 && csv.includes("sku;ean;produto")) {
    ok++;
    console.log(`  estoque.csv ok: ${linhas} linhas`);
  } else {
    problemas.push(`estoque.csv com ${linhas} linhas - conteudo inesperado`);
  }
}

// Operador de caixa nao pode acessar area de gestao restrita
console.log("--- Permissoes ---");
{
  const r = await fetch(BASE + "/configuracoes/usuarios", { headers: { cookie: COOKIE_CAIXA }, redirect: "manual" });
  const loc = r.headers.get("location") || "";
  if (r.status >= 300 && r.status < 400) {
    ok++;
    console.log("  operador redirecionado de /configuracoes/usuarios -> " + loc);
  } else {
    problemas.push(`operador acessou /configuracoes/usuarios com HTTP ${r.status} (esperado redirect)`);
  }
}

console.log("\n============================================");
console.log(` VERIFICACOES OK: ${ok}`);
if (problemas.length) {
  console.log(` FALHAS: ${problemas.length}`);
  for (const p of problemas) console.log("   - " + p);
} else {
  console.log(" NENHUMA FALHA");
}
console.log("============================================");
process.exit(problemas.length ? 1 : 0);
