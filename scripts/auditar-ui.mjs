/**
 * Auditoria de interface no celular (e no desktop).
 *
 * Abre o sistema num Chrome de verdade, com viewport de celular, entra com o
 * usuario admin, percorre todas as rotas e reporta:
 *   - rolagem horizontal (elemento que passa da largura da tela)
 *   - erros de console e de pagina
 *   - alvos de toque menores que 36px
 * Alem disso salva um print de cada tela para revisao visual.
 *
 * Uso:
 *   npm i --no-save puppeteer-core
 *   node scripts/auditar-ui.mjs                 (celular 390x844)
 *   node scripts/auditar-ui.mjs --desktop       (notebook 1366x768)
 *   node scripts/auditar-ui.mjs --largura=360 --altura=640
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const DESKTOP = argv.includes("--desktop");
const LARGURA = Number(arg("largura", DESKTOP ? "1366" : "390"));
const ALTURA = Number(arg("altura", DESKTOP ? "768" : "844"));
const BASE = arg("base", "http://localhost:3000");
const SAIDA = arg("saida", join(process.env.LOCALAPPDATA || process.env.TEMP || ".", "Temp", "bde-ui", DESKTOP ? "desktop" : `${LARGURA}x${ALTURA}`));

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => existsSync(p));

const ROTAS = [
  ["/painel", "Painel"],
  ["/caixa", "PDV / Caixa"],
  ["/vendas", "Vendas"],
  ["/vendas/1", "Venda (detalhe)"],
  ["/produtos", "Produtos"],
  ["/produtos/1", "Produto (detalhe)"],
  ["/produtos/1?aba=cabelos", "Produto - classificacao"],
  ["/produtos/1?aba=variacoes", "Produto - variacoes"],
  ["/produtos/1?aba=precos", "Produto - precos"],
  ["/produtos/1?aba=estoque", "Produto - estoque"],
  ["/produtos/1?aba=fornecedores", "Produto - fornecedores"],
  ["/produtos/1?aba=fiscal", "Produto - fiscal"],
  ["/produtos/1?aba=site", "Produto - site"],
  ["/produtos/1?aba=gestao", "Produto - gestao"],
  ["/produtos/novo", "Novo produto"],
  ["/estoque", "Estoque"],
  ["/compras", "Compras"],
  ["/compras/nova", "Nova compra"],
  ["/fornecedores", "Fornecedores"],
  ["/clientes", "Clientes"],
  ["/clientes/1", "Cliente (ficha)"],
  ["/relatorios", "Relatorios"],
  ["/cadastros", "Cadastros"],
  ["/cadastros/marcas", "Cadastros - marcas"],
  ["/configuracoes", "Configuracoes"],
  ["/configuracoes/usuarios", "Usuarios"],
  ["/configuracoes/lojas", "Lojas"],
  ["/login", "Login"],
];

const problemas = [];
const resumo = [];

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

const pagina = await navegador.newPage();
await pagina.setViewport(
  DESKTOP
    ? { width: LARGURA, height: ALTURA, deviceScaleFactor: 1 }
    : { width: LARGURA, height: ALTURA, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
);
await pagina.setUserAgent(
  DESKTOP
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
    : "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
);

let erros = [];
pagina.on("console", (m) => {
  if (m.type() === "error") erros.push("console: " + m.text().slice(0, 300));
});
pagina.on("pageerror", (e) => erros.push("pageerror: " + String(e.message).slice(0, 300)));

mkdirSync(SAIDA, { recursive: true });

function slug(rota) {
  return rota.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "raiz";
}

/* ---------------- login pela tela ---------------- */
await pagina.goto(BASE + "/login", { waitUntil: "networkidle2" });
await pagina.type('input[name="email"]', "admin@banhodeencanto.com.br");
await pagina.type('input[name="senha"]', "encanto123");
await Promise.all([
  pagina.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
  pagina.click('button[type="submit"]'),
]);
const logado = !pagina.url().includes("/login");
console.log(`Login pela tela: ${logado ? "OK" : "FALHOU"} -> ${pagina.url()}`);
if (!logado) {
  problemas.push("Nao consegui entrar no sistema pela tela de login.");
  await pagina.screenshot({ path: join(SAIDA, "00-login-falhou.png") });
}

/* ---------------- auditoria das rotas ---------------- */
for (const [rota, nome] of ROTAS) {
  erros = [];
  let status = 0;
  try {
    const resp = await pagina.goto(BASE + rota, { waitUntil: "networkidle2", timeout: 45000 });
    status = resp?.status() ?? 0;
  } catch (e) {
    problemas.push(`${rota} -> falha ao abrir: ${e.message}`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 350));

  const medida = await pagina.evaluate(() => {
    const largura = window.innerWidth;
    const doc = document.documentElement;
    const culpados = [];
    if (doc.scrollWidth > largura + 1) {
      for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 4000)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const estilo = getComputedStyle(el);
        if (estilo.position === "fixed" && estilo.overflowX !== "visible") continue;
        let emScroller = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") {
            emScroller = true;
            break;
          }
        }
        if (r.right > largura + 2 && !emScroller) {
          culpados.push({
            tag: el.tagName.toLowerCase(),
            classe: String(el.className).slice(0, 90),
            direita: Math.round(r.right),
            largura: Math.round(r.width),
            texto: (el.textContent || "").trim().slice(0, 40),
          });
        }
      }
    }
    // alvos de toque pequenos (apenas interativos visiveis)
    const pequenos = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input, select"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest("[hidden]")) continue;
      const tipo = el.tagName === "INPUT" ? el.type : "";
      if (tipo === "hidden") continue;
      // checkbox/radio: a area de toque e o label que envolve o campo
      if (tipo === "checkbox" || tipo === "radio") {
        const rotulo = el.closest("label");
        if (rotulo && rotulo.getBoundingClientRect().height >= 36) continue;
      }
      if (r.height < 36) {
        pequenos.push({
          tag: el.tagName.toLowerCase(),
          texto: (el.textContent || el.placeholder || "").trim().slice(0, 30),
          altura: Math.round(r.height),
        });
      }
    }
    return {
      status: 0,
      scrollWidth: doc.scrollWidth,
      innerWidth: largura,
      culpados: culpados.slice(0, 6),
      totalCulpados: culpados.length,
      pequenos: pequenos.slice(0, 8),
      totalPequenos: pequenos.length,
    };
  });

  await pagina.screenshot({ path: join(SAIDA, `${slug(rota)}.png`), fullPage: argv.includes("--completo") });

  const registro = { rota, nome, status, ...medida, erros: [...erros] };
  resumo.push(registro);

  if (medida.scrollWidth > medida.innerWidth + 1) {
    problemas.push(
      `${rota} -> rolagem horizontal: ${medida.scrollWidth}px de conteudo em ${medida.innerWidth}px ` +
        `| ${medida.totalCulpados} elemento(s): ` +
        medida.culpados.map((c) => `${c.tag}.${c.classe}(${c.direita}px)`).join(" ")
    );
  }
  if (status >= 400) problemas.push(`${rota} -> HTTP ${status}`);
  if (erros.length) problemas.push(`${rota} -> ${erros.length} erro(s) de console: ${erros[0]}`);
  if (!DESKTOP && medida.totalPequenos > 6) {
    problemas.push(
      `${rota} -> ${medida.totalPequenos} alvos de toque abaixo de 36px (ex: ` +
        medida.pequenos.map((p) => `${p.tag}"${p.texto}"=${p.altura}px`).join(", ") +
        ")"
    );
  }
}

await navegador.close();

writeFileSync(join(SAIDA, "relatorio.json"), JSON.stringify({ resumo, problemas }, null, 1));

console.log(`\nPrints e relatorio em: ${SAIDA}`);
console.log(`Rotas auditadas: ${resumo.length}`);
console.log(`\n============================================`);
if (problemas.length === 0) {
  console.log(" NENHUM PROBLEMA DE INTERFACE ENCONTRADO");
} else {
  console.log(` PROBLEMAS: ${problemas.length}`);
  for (const p of problemas) console.log("  - " + p);
}
console.log("============================================");
process.exit(problemas.length ? 1 : 0);
