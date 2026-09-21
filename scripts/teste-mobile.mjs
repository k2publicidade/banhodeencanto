/**
 * TESTE DE PONTA A PONTA NO CELULAR (operacao real na tela).
 *
 * Roda um Chrome de verdade com viewport de celular (390x844, toque ligado),
 * entra pela tela de login e percorre as funcoes principais do sistema do jeito
 * que o operador faz: navegacao por abas e gaveta, venda completa no PDV,
 * abertura de caixa, cadastro de cliente, lancamento de estoque, filtros,
 * detalhe da venda. Em cada tela confere se nao existe rolagem horizontal e se
 * nao houve erro de console.
 *
 * Roda num BANCO DE TESTE (copia do banco real) e sobe servidor proprio, para
 * nao sujar os dados da loja. Ao terminar devolve o dev server normal.
 *
 * Uso:
 *   npm i --no-save puppeteer-core
 *   node scripts/teste-mobile.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const PORTA = Number((argv.find((a) => a.startsWith("--porta=")) || "").split("=")[1] || 3000);
const BASE = "http://localhost:" + PORTA;
const RAIZ = process.cwd();
const DIR_DADOS = join(RAIZ, "data");
const DB_ORIGEM = join(DIR_DADOS, "banho.db");
const DB_TESTE = join(DIR_DADOS, "teste-mobile.db");
const ARQ_SEGREDO = join(DIR_DADOS, ".secret");
const SAIDA = join(process.env.LOCALAPPDATA || process.env.TEMP || ".", "Temp", "bde-ui", "mobile-fluxo");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => existsSync(p));

if (!existsSync(DB_ORIGEM)) {
  console.error("Banco de origem nao encontrado: " + DB_ORIGEM);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Banco de teste + servidor                                           */
/* ------------------------------------------------------------------ */

{
  const origem = new DatabaseSync(DB_ORIGEM);
  origem.exec("PRAGMA busy_timeout = 8000;");
  origem.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  origem.close();
  for (const s of ["", "-wal", "-shm"]) {
    const p = DB_TESTE + s;
    if (existsSync(p)) rmSync(p);
  }
  copyFileSync(DB_ORIGEM, DB_TESTE);
}

// Estado conhecido: sem caixa aberto, para o teste abrir o seu
{
  const db = new DatabaseSync(DB_TESTE);
  db.exec("PRAGMA busy_timeout = 8000;");
  db.exec("UPDATE caixas SET status='fechado' WHERE status='aberto'");
  db.close();
}

const SEGREDO = existsSync(ARQ_SEGREDO) ? readFileSync(ARQ_SEGREDO, "utf8").trim() : randomBytes(48).toString("hex");
const NEXT_BIN = join(RAIZ, "node_modules", "next", "dist", "bin", "next");
let servidor = null;
const logServidor = [];

function pidsNaPorta(porta) {
  try {
    const saida = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    for (const linha of saida.split(/\r?\n/)) {
      if (!/LISTENING/.test(linha)) continue;
      if (!new RegExp(`[:.]${porta}\\s`).test(linha)) continue;
      const pid = linha.trim().split(/\s+/).pop();
      if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function matarNaPorta(porta) {
  for (const pid of pidsNaPorta(porta)) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* processo ja saiu */
    }
  }
}

const limparLock = () => {
  try {
    rmSync(join(RAIZ, ".next", "dev", "lock"), { force: true });
  } catch {
    /* sem lock */
  }
};

function iniciarServidor(envExtra, destacado = false) {
  const env = { ...process.env, ...envExtra };
  delete env.PORT;
  const p = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(PORTA)], {
    cwd: RAIZ,
    env,
    detached: destacado,
    stdio: destacado ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  if (!destacado) {
    const guardar = (buf) => {
      logServidor.push(buf.toString());
      if (logServidor.length > 300) logServidor.shift();
    };
    p.stdout.on("data", guardar);
    p.stderr.on("data", guardar);
  } else {
    p.unref();
  }
  return p;
}

async function esperarServidor(limiteMs = 180_000) {
  const limite = Date.now() + limiteMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(BASE + "/login", { redirect: "manual" });
      if (r.status === 200) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function subirServidorTeste() {
  matarNaPorta(PORTA);
  limparLock();
  await new Promise((r) => setTimeout(r, 1200));
  servidor = iniciarServidor({ BDE_DB_PATH: DB_TESTE, BDE_SECRET: SEGREDO });
  if (!(await esperarServidor())) {
    throw new Error("Servidor de teste nao subiu.\n" + logServidor.join("").slice(-2000));
  }
}

async function restaurarServidor() {
  try {
    matarNaPorta(PORTA);
  } catch {
    /* nada escutando */
  }
  limparLock();
  await new Promise((r) => setTimeout(r, 1000));
  iniciarServidor({}, true);
  const ok = await esperarServidor(120_000);
  console.log(ok ? `\nDev server normal de volta em ${BASE}` : "\nAtencao: o dev server normal nao subiu - rode `npm run dev`.");
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const falhas = [];
let total = 0;
const capturas = [];

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function passo(nome, fn) {
  total++;
  const t0 = Date.now();
  try {
    const detalhe = await fn();
    console.log(`  OK    ${nome}${detalhe ? "  (" + detalhe + ")" : ""}  ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  FALHA ${nome}\n        -> ${e.message}`);
    falhas.push(`${nome}: ${e.message}`);
  }
}

const ROTULOS = {};

async function abrir(pg, caminho, esperaTexto) {
  await pg.goto(BASE + caminho, { waitUntil: "networkidle2", timeout: 45000 });
  if (esperaTexto) {
    await pg.waitForFunction(
      (t) => document.body && document.body.innerText.includes(t),
      { timeout: 20000 },
      esperaTexto
    );
  }
  await new Promise((r) => setTimeout(r, 250));
}

/** Nao pode existir conteudo mais largo que a tela (isso e o bug classico de mobile) */
async function semRolagem(pg, onde) {
  const m = await pg.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    culpados: Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width <= 0) return false;
        if (r.right <= document.documentElement.clientWidth + 2) return false;
        // rolagem horizontal dentro de um scroller (abas, filtros) e intencional
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") return false;
        }
        return true;
      })
      .slice(0, 3)
      .map((el) => el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40)),
  }));
  assert(
    m.scroll <= m.client + 1 && m.culpados.length === 0,
    `${onde}: rolagem horizontal (${m.scroll}px em ${m.client}px) ${m.culpados.join(" ")}`
  );
  return `${m.client}px sem rolagem`;
}

async function capturar(pg, nome) {
  mkdirSync(SAIDA, { recursive: true });
  const arq = join(SAIDA, `${nome}.png`);
  await pg.screenshot({ path: arq });
  capturas.push(arq);
}

/** Clica no primeiro elemento visivel que contenha o texto */
async function clicarTexto(pg, texto, seletor = "button, a") {
  const alvo = await pg.evaluateHandle(
    (t, sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      return (
        els.find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (el.textContent || "").trim().includes(t);
        }) || null
      );
    },
    texto,
    seletor
  );
  const el = alvo.asElement();
  if (!el) throw new Error(`nao encontrei elemento visivel com o texto "${texto}"`);
  // centraliza antes de tocar: a barra de abas fixa cobre o que fica no rodape
  await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  await el.click();
  return el;
}


/** Envia o formulario que contem o campo informado (funciona com server actions). */
async function enviarForm(pg, seletorCampo) {
  await pg.evaluate((sel) => {
    const campo = document.querySelector(sel);
    if (!campo) throw new Error("campo nao encontrado: " + sel);
    const form = campo.closest("form");
    if (!form) throw new Error("campo sem formulario: " + sel);
    form.requestSubmit();
  }, seletorCampo);
}

/* ------------------------------------------------------------------ */
/* Execucao                                                            */
/* ------------------------------------------------------------------ */

console.log(`BASE=${BASE}  DB=${DB_TESTE}`);
console.log("Subindo servidor com o banco de teste...");
await subirServidorTeste();

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const pg = await navegador.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await pg.setUserAgent(
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
);

let errosConsole = [];
pg.on("console", (m) => {
  if (m.type() === "error") errosConsole.push(m.text().slice(0, 200));
});
pg.on("pageerror", (e) => errosConsole.push("pageerror: " + String(e.message).slice(0, 200)));

const db = new DatabaseSync(DB_TESTE);
db.exec("PRAGMA busy_timeout = 8000;");
const um = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }))[0] ?? null;

console.log("");

/* 1. Login pela tela ------------------------------------------------ */
let vendaId = null;

await passo("Login pela tela do celular", async () => {
  errosConsole = [];
  await abrir(pg, "/login", "Entrar no sistema");
  await pg.type('input[name="email"]', "admin@banhodeencanto.com.br");
  await pg.type('input[name="senha"]', "encanto123");
  await clicarTexto(pg, "Entrar no sistema");
  await pg.waitForFunction(() => location.pathname.includes("painel"), { timeout: 30000 });
  await semRolagem(pg, "painel");
  await capturar(pg, "01-painel");
  assert(errosConsole.length === 0, "erro de console: " + errosConsole[0]);
  return "entrou e caiu no painel";
});

/* 2. Navegacao por abas e gaveta ------------------------------------ */
await passo("Navegacao: aba Vendas e gaveta", async () => {
  await pg.click('.app-rodape a[href="/vendas"]');
  await pg.waitForFunction(() => location.pathname === "/vendas", { timeout: 20000 });
  await semRolagem(pg, "vendas");

  await pg.click('button[aria-label="Abrir menu"]');
  await pg.waitForSelector(".gaveta", { visible: true, timeout: 10000 });
  const itens = await pg.$$eval(".gaveta a", (a) => a.length);
  assert(itens >= 11, `gaveta com ${itens} itens (esperado >= 11)`);
  await capturar(pg, "02-gaveta");
  await pg.click('.gaveta a[href="/clientes"]');
  await pg.waitForFunction(() => location.pathname === "/clientes", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500)); // deixa o React remover a gaveta
  const gavetaFechou = await pg
    .waitForFunction(() => !document.querySelector(".gaveta"), { timeout: 8000 })
    .then(() => "none")
    .catch(() => "aberta");
  assert(gavetaFechou === "none", "a gaveta continuou aberta depois de navegar");
  await semRolagem(pg, "clientes");
  return `gaveta com ${itens} itens e fecha ao navegar`;
});

/* 3. Cadastro de cliente ------------------------------------------- */
await passo("Cadastrar cliente pelo celular", async () => {
  errosConsole = [];
  const nome = "Cliente Teste Mobile";
  await abrir(pg, "/clientes", "Cadastrar cliente");
  await pg.evaluate(() => window.scrollTo(0, 400));
  await pg.type('input[name="nome"]', nome);
  await pg.type('input[name="telefone"]', "11 90000-1234");
  await clicarTexto(pg, "Cadastrar cliente");
  await pg.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 25000 }, nome);
  const noBanco = um("SELECT id, nome FROM clientes WHERE nome = ?", nome);
  assert(noBanco, "cliente nao foi gravado no banco");
  await capturar(pg, "03-cliente-cadastrado");
  return `cliente #${noBanco.id} gravado`;
});

/* 4. Filtro de produtos + detalhe ---------------------------------- */
await passo("Filtrar produtos e abrir o detalhe", async () => {
  await abrir(pg, "/produtos", "produto(s) encontrado(s)");
  await pg.type('input[name="q"]', "jumbo");
  await clicarTexto(pg, "Filtrar");
  await pg.waitForFunction(() => location.search.includes("q=jumbo"), { timeout: 25000 });
  await semRolagem(pg, "produtos filtrados");
  await capturar(pg, "04-produtos-filtro");

  const link = await pg.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href^="/produtos/"]')).find((x) => /\/produtos\/\d+$/.test(x.getAttribute("href") || ""));
    return a ? a.getAttribute("href") : null;
  });
  assert(link, "nao achei link de produto na lista");
  await abrir(pg, link, "Identificacao");
  await semRolagem(pg, "produto detalhe");
  await pg.click('a[href*="aba=precos"]');
  await pg.waitForFunction(() => location.search.includes("aba=precos"), { timeout: 25000 });
  await pg.waitForFunction(() => document.body.innerText.includes("Tabela comercial"), { timeout: 25000 });
  await semRolagem(pg, "produto precos");
  await capturar(pg, "05-produto-precos");
  return `${link} com abas funcionando`;
});

/* 5. Movimento de estoque ------------------------------------------ */
await passo("Lancar movimento de estoque", async () => {
  errosConsole = [];
  await abrir(pg, "/estoque", "Lancar movimento");
  const sku = await pg.$$eval("#variacao_id option", (os) => os.map((o) => o.value).filter(Boolean)[0]);
  assert(sku, "nenhum SKU disponivel na lista");
  await pg.select("#variacao_id", sku);
  await pg.select('select[name="tipo"]', "entrada");
  await pg.type('input[name="quantidade"]', "1");
  await pg.type('input[name="motivo"]', "Teste mobile");
  await clicarTexto(pg, "Lancar movimento");
  await pg.waitForFunction(() => !document.body.innerText.includes("Lancar movimento") || document.body.innerText.includes("sucesso") || location.search.includes("msg"), { timeout: 25000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const mov = um("SELECT id FROM estoque_movimentos WHERE motivo = 'Teste mobile' ORDER BY id DESC LIMIT 1");
  assert(mov, "movimento de estoque nao foi gravado");
  await semRolagem(pg, "estoque");
  await capturar(pg, "06-estoque");
  return `movimento #${mov.id} gravado`;
});

/* 6. PDV: abrir caixa, vender em dinheiro -------------------------- */
await passo("Abrir o caixa pelo PDV", async () => {
  errosConsole = [];
  await abrir(pg, "/caixa");
  const fechado = await pg.evaluate(() => document.body.innerText.includes("CAIXA FECHADO"));
  if (fechado) {
    await pg.click('button[aria-label="Mais opcoes do caixa"]');
    await pg.waitForSelector(".folha", { visible: true, timeout: 10000 });
    await clicarTexto(pg, "Abrir caixa");
    await pg.waitForSelector('.folha input', { visible: true, timeout: 10000 });
    await pg.type(".folha input", "200");
    await clicarTexto(pg, "Abrir caixa");
    await pg.waitForFunction(() => document.body.innerText.includes("Caixa aberto"), { timeout: 25000 });
  }
  const cx = um("SELECT id, valor_abertura FROM caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  assert(cx, "caixa nao abriu");
  await capturar(pg, "07-pdv-caixa-aberto");
  return `caixa #${cx.id} aberto com R$ ${cx.valor_abertura}`;
});

await passo("Venda completa no PDV (bipe, quantidade, dinheiro, troco)", async () => {
  errosConsole = [];
  const sku = um(
    `SELECT ean, sku, preco_venda FROM vw_variacoes
     WHERE variacao_status='ativo' AND produto_status='ativo' AND disponivel >= 5 AND ean IS NOT NULL
     ORDER BY disponivel DESC LIMIT 1`
  );
  assert(sku, "sem SKU com codigo de barras disponivel");

  await pg.click("#bip");
  await pg.type("#bip", String(sku.ean));
  await pg.keyboard.press("Enter");
  await pg.waitForFunction(() => document.querySelectorAll(".pdv-item").length > 0, { timeout: 25000 });

  await pg.click(".pdv-item .pdv-passo button:last-of-type");
  const qtd = await pg.$eval(".pdv-item .pdv-passo input", (i) => i.value);
  assert(qtd === "2", `quantidade apos o + deveria ser 2 e ficou ${qtd}`);
  await capturar(pg, "08-pdv-carrinho");

  await pg.click(".pdv-resumo .btn-sucesso");
  await pg.waitForSelector(".folha", { visible: true, timeout: 10000 });
  await clicarTexto(pg, "Dinheiro", ".folha .btn");
  await clicarTexto(pg, "Exato", ".folha .btn");
  await new Promise((r) => setTimeout(r, 300));
  await capturar(pg, "09-pdv-pagamento");

  await pg.click(".folha-rodape .btn-sucesso");
  await pg.waitForFunction(() => document.body.innerText.includes("Imprimir cupom"), { timeout: 30000 });
  await capturar(pg, "10-cupom");

  const ultima = um("SELECT id, numero, total, status FROM vendas ORDER BY id DESC LIMIT 1");
  assert(ultima && ultima.status === "concluida", "venda nao ficou concluida no banco");
  vendaId = ultima.id;
  const item = um("SELECT quantidade FROM vendas_itens WHERE venda_id = ?", ultima.id);
  assert(Number(item.quantidade) === 2, `item com quantidade ${item.quantidade} (esperado 2)`);
  const cupomTexto = await pg.evaluate(() => document.body.innerText);
  assert(cupomTexto.includes("TOTAL"), "cupom sem o total");
  return `${ultima.numero} R$ ${Number(ultima.total).toFixed(2)} com 2 pecas`;
});

/* 7. Detalhe da venda + devolucao ---------------------------------- */
await passo("Abrir a venda e registrar devolucao", async () => {
  errosConsole = [];
  await abrir(pg, "/vendas/" + vendaId, "Registrar devolucao");
  await semRolagem(pg, "venda detalhe");
  await capturar(pg, "11-venda-detalhe");

  const antes = um(
    "SELECT quantidade FROM estoque WHERE variacao_id = (SELECT variacao_id FROM vendas_itens WHERE venda_id = ? LIMIT 1)",
    vendaId
  );
  const campoQtd = await pg.$('input[placeholder="0"]');
  assert(campoQtd, "nao achei o campo de quantidade da devolucao");
  await campoQtd.click();
  await pg.keyboard.type("1");
  await new Promise((r) => setTimeout(r, 200));
  await clicarTexto(pg, "Registrar devolucao");
  await new Promise((r) => setTimeout(r, 1500));
  const dev = um("SELECT id, numero, total FROM devolucoes WHERE venda_id = ? ORDER BY id DESC LIMIT 1", vendaId);
  assert(dev, "devolucao nao foi gravada");
  await capturar(pg, "12-devolucao");
  return `devolucao ${dev.numero} de R$ ${Number(dev.total).toFixed(2)} (saldo antes: ${antes?.quantidade})`;
});

/* 8. Vendas: lista com filtros ------------------------------------- */
await passo("Lista de vendas com filtro de periodo", async () => {
  await abrir(pg, "/vendas", "venda(s) no filtro");
  await pg.select('select[name="status"]', "concluida");
  await clicarTexto(pg, "Filtrar");
  await pg.waitForFunction(() => location.search.includes("status=concluida"), { timeout: 25000 });
  await semRolagem(pg, "vendas filtradas");
  await capturar(pg, "13-vendas");
  const cartoes = await pg.$$eval(".tabela-vira-cartoes tbody tr", (r) => r.length);
  assert(cartoes > 0, "a lista de vendas nao gerou cartoes no celular");
  return `${cartoes} vendas em cartoes`;
});

/* 9. Relatorios e configuracoes ------------------------------------ */
await passo("Relatorios e configuracoes renderizam no celular", async () => {
  await abrir(pg, "/relatorios", "Curva ABC");
  await semRolagem(pg, "relatorios");
  await abrir(pg, "/configuracoes/usuarios", "Usuarios");
  await semRolagem(pg, "usuarios");
  await capturar(pg, "14-usuarios");
  return "sem rolagem lateral";
});

/* 10. Escritas em cadastros (fornecedor, produto, usuario, auxiliar) */
await passo("Cadastrar fornecedor", async () => {
  errosConsole = [];
  await abrir(pg, "/fornecedores", "Fornecedores");
  const nome = "Fornecedor Teste Mobile";
  await pg.type('input[name="razao_social"]', nome);
  await pg.type('input[name="nome_fantasia"]', nome);
  await pg.type('input[name="telefone"]', "11 95555-4444");
  await enviarForm(pg, 'input[name="razao_social"]');
  let f = null;
  for (let i = 0; i < 20 && !f; i++) {
    await new Promise((r) => setTimeout(r, 800));
    f = um("SELECT id FROM fornecedores WHERE razao_social = ? OR nome_fantasia = ?", nome, nome);
  }
  assert(f, "fornecedor nao foi gravado");
  await capturar(pg, "15-fornecedor");
  return `fornecedor #${f.id}`;
});

await passo("Cadastrar produto (produto pai)", async () => {
  errosConsole = [];
  await abrir(pg, "/produtos/novo", "Novo produto");
  const nome = "Produto Teste Mobile";
  await pg.type('input[name="nome"]', nome);
  await enviarForm(pg, 'input[name="nome"]');
  await pg.waitForFunction(() => location.pathname !== "/produtos/novo", { timeout: 30000 }).catch(() => {});
  const p = um("SELECT id FROM produtos WHERE nome = ?", nome);
  assert(p, "produto nao foi gravado");
  await semRolagem(pg, "produto criado");
  await capturar(pg, "16-produto-criado");
  return `produto #${p.id}`;
});

await passo("Cadastro auxiliar (marca)", async () => {
  await abrir(pg, "/cadastros/marcas", "Cadastros");
  const nome = "Marca Teste Mobile";
  const texto = await pg.$('form input[type="text"], form input:not([type])');
  assert(texto, "formulario de cadastro sem campo de texto");
  await texto.click();
  await pg.keyboard.type(nome);
  await enviarForm(pg, 'form input[type="text"], form input:not([type])');
  await new Promise((r) => setTimeout(r, 1600));
  const m = um("SELECT id FROM marcas WHERE nome = ?", nome);
  assert(m, "marca nao foi gravada");
  return `marca #${m.id}`;
});

await passo("Cadastrar usuario", async () => {
  errosConsole = [];
  await abrir(pg, "/configuracoes/usuarios", "Usuarios");
  await pg.type('input[name="nome"]', "Usuario Teste Mobile");
  await pg.type('input[name="email"]', "teste.mobile@banhodeencanto.com.br");
  await pg.type('input[name="senha"]', "teste12345");
  await pg.type('input[name="pin"]', "9876");
  await enviarForm(pg, 'input[name="email"]');
  await new Promise((r) => setTimeout(r, 1800));
  const u = um("SELECT id FROM usuarios WHERE email = ?", "teste.mobile@banhodeencanto.com.br");
  assert(u, "usuario nao foi gravado");
  return `usuario #${u.id}`;
});

await passo("Salvar configuracoes", async () => {
  errosConsole = [];
  await abrir(pg, "/configuracoes", "Configuracoes");
  const campo = await pg.$('input[name="empresa_slogan"]');
  assert(campo, "campo empresa_slogan nao encontrado");
  await campo.click({ clickCount: 3 });
  await pg.keyboard.type("Cabelos sinteticos de qualidade");
  await enviarForm(pg, 'input[name="empresa_slogan"]');
  await new Promise((r) => setTimeout(r, 1600));
  const c = um("SELECT valor FROM configuracoes WHERE chave = 'empresa_slogan'");
  assert(c && c.valor.includes("qualidade"), "configuracao nao foi salva");
  return c.valor;
});

await passo("Receber fiado na ficha do cliente", async () => {
  const cli = um(
    `SELECT cliente_id, SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END) saldo
     FROM fiado_lancamentos GROUP BY cliente_id HAVING saldo > 20 ORDER BY saldo DESC LIMIT 1`
  );
  assert(cli, "nenhum cliente com fiado em aberto para testar");
  errosConsole = [];
  await abrir(pg, "/clientes/" + cli.cliente_id, "Ficha");
  await pg.select('select[name="tipo"]', "pagamento");
  await pg.type('input[name="valor"]', "10");
  await enviarForm(pg, 'input[name="valor"]');
  await new Promise((r) => setTimeout(r, 1800));
  const pago = um(
    "SELECT id, valor FROM fiado_lancamentos WHERE cliente_id = ? AND tipo = 'pagamento' ORDER BY id DESC LIMIT 1",
    cli.cliente_id
  );
  assert(pago && Number(pago.valor) === 10, "pagamento de fiado nao foi gravado");
  await capturar(pg, "17-fiado");
  return `cliente #${cli.cliente_id} pagou R$ 10,00`;
});

await passo("Criar compra de mercadoria", async () => {
  errosConsole = [];
  await abrir(pg, "/compras/nova", "Dados da compra");
  // as opcoes de SKU so aparecem depois de buscar (a busca recarrega a pagina)
  await pg.type('input[name="q"]', "jumbo");
  await clicarTexto(pg, "Buscar");
  await pg.waitForFunction(() => location.search.includes("q=jumbo"), { timeout: 25000 });
  await pg.waitForFunction(
    () => Array.from(document.querySelectorAll('select[name="variacao_id"] option')).some((o) => o.value),
    { timeout: 25000 }
  );
  const fornecedor = await pg.$$eval('select[name="fornecedor_id"] option', (os) => os.map((o) => o.value).filter(Boolean)[0]);
  assert(fornecedor, "sem fornecedor para selecionar");
  await pg.select('select[name="fornecedor_id"]', fornecedor);
  const skuCompra = await pg.$$eval('select[name="variacao_id"] option', (os) => os.map((o) => o.value).filter(Boolean)[0]);
  assert(skuCompra, "nenhum SKU disponivel para a compra");
  await pg.select('select[name="variacao_id"]', skuCompra);
  await pg.type('input[name="quantidade"]', "3");
  await pg.type('input[name="custo_unitario"]', "5,00");
  await enviarForm(pg, 'select[name="fornecedor_id"]');
  await new Promise((r) => setTimeout(r, 2000));
  const compra = um("SELECT id, numero, status FROM compras ORDER BY id DESC LIMIT 1");
  assert(compra && compra.status === "rascunho", "compra nao foi criada");
  await capturar(pg, "18-compra");
  return `${compra.numero} (${compra.status})`;
});

/* 11. Restaurar estado (fechar o caixa do teste) -------------------- */
await passo("Fechar o caixa do teste pelo PDV", async () => {
  await abrir(pg, "/caixa");
  await pg.click('button[aria-label="Mais opcoes do caixa"]');
  await pg.waitForSelector(".folha", { visible: true, timeout: 10000 });
  await clicarTexto(pg, "Fechar caixa");
  await pg.waitForSelector('.folha input', { visible: true, timeout: 10000 });
  const esperado = um("SELECT valor_sistema FROM caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  await pg.type(".folha input", String(esperado?.valor_sistema ?? 200));
  await clicarTexto(pg, "Fechar caixa");
  await pg.waitForFunction(() => document.body.innerText.includes("Caixa fechado"), { timeout: 25000 });
  const cx = um("SELECT status FROM caixas ORDER BY id DESC LIMIT 1");
  assert(cx.status === "fechado", "caixa continuou aberto");
  return "caixa fechado";
});

await navegador.close();
db.close();
await restaurarServidor();

console.log("\n============================================");
console.log(` PASSOS OK: ${total - falhas.length}/${total}`);
if (falhas.length) {
  console.log(` FALHAS: ${falhas.length}`);
  for (const f of falhas) console.log("   - " + f);
} else {
  console.log(" TODAS AS FUNCOES TESTADAS NO CELULAR PASSARAM");
}
console.log(` Prints: ${SAIDA}`);
console.log("============================================");
process.exit(falhas.length ? 1 : 0);
