/**
 * TESTE DE FLUXO REAL (ponta a ponta) do PDV Banho de Encanto.
 *
 * Diferente do teste-rotas (que so verifica se as paginas respondem), este
 * script exercita as REGRAS DE NEGOCIO chamando as mesmas server actions que
 * o caixa usa na tela: abrir caixa, vender em dinheiro, vender no fiado,
 * desconto com supervisor, bloqueio de estoque insuficiente, sangria,
 * devolucao, cancelamento e fechamento de caixa. Depois confere o resultado
 * direto no banco (estoque, movimentos, caixa, fiado, auditoria).
 *
 * Roda em um banco de TESTE (copia do banco real) e em um servidor proprio na
 * porta 3100, para nao sujar os dados da loja.
 *
 * Uso:
 *   node scripts/teste-fluxos.mjs                (sobe o servidor de teste sozinho)
 *   node scripts/teste-fluxos.mjs --sem-servidor --base=http://localhost:3000
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import { decodificarFlight as decodificarResposta } from "./_flight.mjs";

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};
const PORTA = Number(arg("porta", "3000"));
const BASE = arg("base", `http://127.0.0.1:${PORTA}`);
const SEM_SERVIDOR = argv.includes("--sem-servidor");
const NAO_REINICIAR = argv.includes("--nao-reiniciar");
const RAIZ = process.cwd();
const DIR_DADOS = join(RAIZ, "data");
const DB_ORIGEM = join(DIR_DADOS, "banho.db");
const DB_TESTE = join(DIR_DADOS, "teste-fluxos.db");
const ARQ_SEGREDO = join(DIR_DADOS, ".secret");

/* ------------------------------------------------------------------ */
/* Infra: banco de teste, servidor, cookie, chamada de action          */
/* ------------------------------------------------------------------ */

if (!existsSync(DB_ORIGEM)) {
  console.error("Banco de origem nao encontrado: " + DB_ORIGEM);
  process.exit(1);
}

// Copia consistente do banco (checkpoint do WAL antes de copiar)
{
  const origem = new DatabaseSync(DB_ORIGEM);
  origem.exec("PRAGMA busy_timeout = 8000;");
  origem.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  origem.close();
  for (const sufixo of ["", "-wal", "-shm"]) {
    const p = DB_TESTE + sufixo;
    if (existsSync(p)) rmSync(p);
  }
  copyFileSync(DB_ORIGEM, DB_TESTE);
}

const SEGREDO = existsSync(ARQ_SEGREDO) ? readFileSync(ARQ_SEGREDO, "utf8").trim() : randomBytes(48).toString("hex");

function cookiePara(uid) {
  const corpo = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 3600_000 })).toString("base64url");
  return "bde_sessao=" + corpo + "." + createHmac("sha256", SEGREDO).update(corpo).digest("base64url");
}

let servidor = null;
const logServidor = [];

const NEXT_BIN = join(RAIZ, "node_modules", "next", "dist", "bin", "next");

/** PIDs escutando na porta (o Next 16 nao permite dois `next dev` na mesma pasta) */
function pidsNaPorta(porta) {
  try {
    const saida = execSync(process.platform === "win32" ? "netstat -ano" : "netstat -tlnp", { encoding: "utf8" });
    const pids = new Set();
    for (const linha of saida.split(/\r?\n/)) {
      if (!/LISTENING|LISTEN/.test(linha)) continue;
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
      if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      else process.kill(Number(pid), "SIGKILL");
    } catch {}
  }
}

function limparLock() {
  try { rmSync(join(RAIZ, ".next", "dev", "lock"), { force: true }); } catch {}
}

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
      if (logServidor.length > 200) logServidor.shift();
    };
    p.stdout.on("data", guardar);
    p.stderr.on("data", guardar);
    p.on("exit", (c) => logServidor.push(`[servidor saiu: ${c}]`));
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
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function subirServidor() {
  if (SEM_SERVIDOR) return;
  matarNaPorta(PORTA); // derruba o dev server atual (ele usa o banco real)
  limparLock();
  await new Promise((r) => setTimeout(r, 1200));
  servidor = iniciarServidor({ BDE_DB_PATH: DB_TESTE, BDE_SECRET: SEGREDO });
  if (!(await esperarServidor())) {
    throw new Error("Servidor de teste nao subiu em 3 minutos.\n" + logServidor.join("").slice(-2000));
  }
}

function derrubarServidor() {
  if (!servidor) return;
  try {
    matarNaPorta(PORTA);
  } catch {}
  try { servidor.kill(); } catch {}
  servidor = null;
}

/** Devolve o dev server normal (banco real) no ar ao terminar. */
async function restaurarServidor() {
  if (SEM_SERVIDOR || NAO_REINICIAR) return;
  limparLock();
  await new Promise((r) => setTimeout(r, 1000));
  iniciarServidor({}, true);
  const ok = await esperarServidor(120_000);
  console.log(ok ? `\nDev server normal de volta em http://localhost:${PORTA}` : "\nAtencao: o dev server normal nao subiu - rode `npm run dev` manualmente.");
}

process.on("exit", derrubarServidor);
process.on("SIGINT", () => { derrubarServidor(); process.exit(130); });

/** Encerra o servidor de teste, devolve o dev server normal e sai. */
async function finalizar(codigo) {
  derrubarServidor();
  await restaurarServidor();
  process.exit(codigo);
}

// Banco de leitura para as conferencias
const con = new DatabaseSync(DB_TESTE);
con.exec("PRAGMA busy_timeout = 8000;");
const all = (sql, ...p) => con.prepare(sql).all(...p).map((r) => ({ ...r }));
const one = (sql, ...p) => all(sql, ...p)[0] ?? null;

// Descoberta dos IDs das server actions.
//
// O id de cada action e gerado quando o dev server compila o bundle, entao ele
// so vale para a instancia que esta no ar. Por isso a fonte e o PROPRIO
// SERVIDOR: baixamos os chunks que a pagina usa (como o navegador faz) e lemos
// o id em `createServerReference("<id>", ..., "<nome>")`. Varrer a pasta .next
// no disco nao serve: ela acumula chunks de execucoes anteriores do `next dev`,
// com ids que nao existem mais no servidor de teste.
const acoes = {};
const RE_ACAO = /"([0-9a-f]{40,})"[\s\S]{0,700}?"([A-Za-z0-9_]+)"\s*\)/g;

function extrairAcoes(txt, destino) {
  if (!txt.includes("createServerReference")) return;
  RE_ACAO.lastIndex = 0;
  let m;
  while ((m = RE_ACAO.exec(txt)) !== null) destino[m[2]] = m[1];
}

function decodificarFlight(txt) {
  return decodificarResposta(txt);
}

async function chamar(nome, args, pagina = "/caixa", cookie = null) {
  const id = acoes[nome];
  if (!id) throw new Error(`Server action "${nome}" nao encontrada nos chunks compilados.`);
  const r = await fetch(BASE + pagina, {
    method: "POST",
    headers: {
      cookie: cookie || SESSOES.admin,
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: BASE,
      Accept: "text/x-component",
    },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (r.status !== 200) throw new Error(`${nome} -> HTTP ${r.status}: ${txt.slice(0, 300)}`);
  return decodificarFlight(txt);
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const falhas = [];
let passos = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function passo(nome, fn) {
  passos++;
  const t0 = Date.now();
  try {
    const detalhe = await fn();
    console.log(`  OK   ${nome}${detalhe ? "  (" + detalhe + ")" : ""}  ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  FALHA ${nome}\n        -> ${e.message}`);
    falhas.push(`${nome}: ${e.message}`);
  }
}

const arred = (n) => Math.round(Number(n) * 100) / 100;
const SESSOES = {};

/* ------------------------------------------------------------------ */
/* Execucao                                                            */
/* ------------------------------------------------------------------ */

console.log(`BASE=${BASE}  DB=${DB_TESTE}\n`);
await subirServidor();

// Aquece as paginas e os chunks do navegador, colhendo os ids das actions
const paginaDeVenda = "/vendas/" + (one("SELECT id FROM vendas ORDER BY id LIMIT 1")?.id ?? 1);
const paginasQuentes = ["/caixa", "/vendas", paginaDeVenda, "/painel", "/estoque", "/compras/nova"];

async function aquecer(paginas, destino) {
  let scripts = 0;
  for (const p of paginas) {
    let html = "";
    try {
      const r = await fetch(BASE + p, { headers: { cookie: cookiePara(1) } });
      html = await r.text();
    } catch {
      continue;
    }
    const srcs = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+?\.js(?:\?[^"]*)?)"/g)) srcs.add(m[1]);
    for (const s of srcs) {
      const url = s.startsWith("http") ? s : BASE + (s.startsWith("/") ? s : "/" + s);
      try {
        const rr = await fetch(url);
        if (rr.ok) {
          extrairAcoes(await rr.text(), destino);
          scripts++;
        }
      } catch {
        /* chunk opcional */
      }
    }
  }
  return scripts;
}

const necessarias = ["abrirCaixa", "fecharCaixa", "lancarMovimentoCaixa", "finalizarVenda", "buscarPorCodigo", "buscarItens", "cancelarVenda", "registrarDevolucao", "validarSupervisor"];

await aquecer(paginasQuentes, acoes);

// Segunda passada: o primeiro acesso compila a pagina, o segundo entrega os
// chunks ja prontos (as actions podem aparecer so agora).
if (necessarias.some((n) => !acoes[n])) {
  await aquecer(paginasQuentes, acoes);
}

const faltando = necessarias.filter((n) => !acoes[n]);
if (faltando.length) {
  console.error("Nao encontrei as server actions: " + faltando.join(", "));
  console.error("Acoes encontradas: " + Object.keys(acoes).join(", "));
  await finalizar(1);
}

// Contexto: usuarios, formas de pagamento e SKU usado nos testes
const admin = one("SELECT id, nome, pin FROM usuarios WHERE papel='admin' AND ativo=1 ORDER BY id LIMIT 1");
const gerente = one("SELECT id, nome, pin FROM usuarios WHERE papel IN ('gerente','admin') AND ativo=1 ORDER BY id LIMIT 1");
const operador = one("SELECT id, nome FROM usuarios WHERE papel='operador' AND ativo=1 ORDER BY id LIMIT 1");
const formaDinheiro = one("SELECT id, nome FROM formas_pagamento WHERE tipo='dinheiro' LIMIT 1");
const formaFiado = one("SELECT id, nome FROM formas_pagamento WHERE tipo='fiado' LIMIT 1");
const cliente = one("SELECT id, nome, limite_credito FROM clientes WHERE ativo=1 AND limite_credito>0 ORDER BY limite_credito DESC LIMIT 1");
const sku = one(
  `SELECT variacao_id, sku, produto, cor_codigo, ean, preco_venda, disponivel
   FROM vw_variacoes
   WHERE variacao_status='ativo' AND produto_status='ativo' AND disponivel >= 30 AND permite_estoque_negativo=0
   ORDER BY disponivel DESC LIMIT 1`
);
assert(admin && operador && formaDinheiro && formaFiado && cliente && sku, "Dados de apoio insuficientes no banco de teste.");

SESSOES.admin = cookiePara(admin.id);
SESSOES.operador = cookiePara(operador.id);

// Estado inicial limpo: nenhum caixa aberto
con.exec("UPDATE caixas SET status='fechado' WHERE status='aberto'");

const estoqueDe = (variacaoId) =>
  Number(one("SELECT quantidade FROM estoque WHERE variacao_id=? AND loja_id=(SELECT id FROM lojas WHERE padrao=1 LIMIT 1)", variacaoId)?.quantidade ?? 0);
const saldoFiado = (clienteId) =>
  Number(one("SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s FROM fiado_lancamentos WHERE cliente_id=?", clienteId)?.s ?? 0);
const qtdVendas = () => Number(one("SELECT COUNT(*) n FROM vendas")?.n ?? 0);

const estoqueInicial = estoqueDe(sku.variacao_id);
const vendasInicial = qtdVendas();
const precoVenda = Number(sku.preco_venda);

console.log(`SKU de teste: ${sku.sku} (id ${sku.variacao_id}) | preco R$ ${precoVenda.toFixed(2)} | estoque ${estoqueInicial}`);
console.log(`Cliente de teste: ${cliente.nome} (limite R$ ${Number(cliente.limite_credito).toFixed(2)})`);
console.log(`Operador: ${operador.nome} | Admin: ${admin.nome}\n`);

let caixaId = null;
let vendaDinheiro = null;
let vendaFiado = null;

await passo("Abrir caixa com fundo de R$ 200", async () => {
  const r = await chamar("abrirCaixa", [200, "CAIXA 1"]);
  assert(r?.ok, "abrirCaixa nao retornou ok: " + JSON.stringify(r));
  const cx = one("SELECT id, status, valor_abertura FROM caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  assert(cx, "nenhum caixa aberto no banco");
  caixaId = cx.id;
  assert(Number(cx.valor_abertura) === 200, "valor de abertura gravado diferente de 200: " + cx.valor_abertura);
  const mov = one("SELECT COUNT(*) n FROM caixa_movimentos WHERE caixa_id=? AND tipo='abertura'", caixaId);
  assert(Number(mov.n) === 1, "movimento de abertura nao registrado");
  assert(one("SELECT COUNT(*) n FROM auditoria WHERE acao='abrir_caixa' AND entidade_id=?", caixaId).n > 0, "abertura nao auditada");
  return `caixa #${caixaId}`;
});

await passo("Abrir um segundo caixa e bloqueado", async () => {
  const r = await chamar("abrirCaixa", [100, "CAIXA 2"]);
  assert(r && r.ok === false, "permitiu abrir dois caixas ao mesmo tempo");
  return r.erro;
});

await passo("Busca por codigo de barras e por nome", async () => {
  const porEan = await chamar("buscarPorCodigo", [String(sku.ean)]);
  assert(porEan && Number(porEan.variacao_id) === Number(sku.variacao_id), "buscarPorCodigo nao encontrou o SKU pelo EAN: " + JSON.stringify(porEan));
  const porSku = await chamar("buscarPorCodigo", [sku.sku]);
  assert(porSku && Number(porSku.variacao_id) === Number(sku.variacao_id), "buscarPorCodigo nao encontrou pelo SKU interno");
  const lista = await chamar("buscarItens", ["jumbo", 24]);
  assert(Array.isArray(lista) && lista.length > 0, "buscarItens nao retornou itens para 'jumbo'");
  return `EAN ${sku.ean} e ${lista.length} itens por nome`;
});

await passo("Venda em dinheiro baixa estoque, entra no caixa e calcula troco", async () => {
  const total = arred(precoVenda * 2);
  const r = await chamar("finalizarVenda", [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 2, preco_unitario: precoVenda, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: total, valor_recebido: arred(total + 10) }],
  }]);
  assert(r?.ok, "venda recusada: " + JSON.stringify(r));
  assert(arred(r.troco) === 10, "troco incorreto: " + r.troco);
  assert(arred(r.total) === total, `total incorreto: ${r.total} (esperado ${total})`);
  vendaDinheiro = r.venda_id;

  const v = one("SELECT * FROM vendas WHERE id=?", r.venda_id);
  assert(v.status === "concluida", "venda nao ficou concluida");
  assert(arred(v.total) === total, "total gravado na venda difere");
  assert(Number(v.caixa_id) === caixaId, "venda nao foi vinculada ao caixa aberto");

  const item = one("SELECT quantidade, total FROM vendas_itens WHERE venda_id=?", r.venda_id);
  assert(Number(item.quantidade) === 2, "quantidade do item errada");

  const estoqueAgora = estoqueDe(sku.variacao_id);
  assert(estoqueAgora === estoqueInicial - 2, `estoque nao baixou 2 (antes ${estoqueInicial}, agora ${estoqueAgora})`);
  const mov = one("SELECT * FROM estoque_movimentos WHERE referencia_id=? AND tipo='venda'", r.venda_id);
  assert(mov && Number(mov.saldo_apos) === estoqueInicial - 2, "movimento de estoque da venda incorreto");
  const noCaixa = one("SELECT COUNT(*) n FROM caixa_movimentos WHERE caixa_id=? AND tipo='venda'", caixaId);
  assert(Number(noCaixa.n) === 1, "venda em dinheiro nao entrou no caixa");
  assert(one("SELECT COUNT(*) n FROM auditoria WHERE acao='venda' AND entidade_id=?", r.venda_id).n > 0, "venda nao auditada");
  return `${r.numero} R$ ${total.toFixed(2)} | troco R$ 10,00`;
});

await passo("Venda no fiado lanca na caderneta do cliente", async () => {
  const saldoAntes = saldoFiado(cliente.id);
  const total = arred(precoVenda);
  const r = await chamar("finalizarVenda", [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 1, preco_unitario: precoVenda, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaFiado.id, valor: total }],
    cliente_id: cliente.id,
  }]);
  assert(r?.ok, "venda no fiado recusada: " + JSON.stringify(r));
  vendaFiado = r.venda_id;
  const saldoDepois = saldoFiado(cliente.id);
  assert(arred(saldoDepois - saldoAntes) === total, `caderneta nao aumentou o valor da venda (antes ${saldoAntes}, depois ${saldoDepois})`);
  const lanc = one("SELECT * FROM fiado_lancamentos WHERE venda_id=? AND tipo='compra'", r.venda_id);
  assert(lanc && arred(lanc.valor) === total, "lancamento de fiado nao gravado");
  assert(Number(lanc.saldo_apos) === saldoDepois, "saldo_apos do lancamento difere do saldo calculado");
  const noCaixa = one("SELECT COUNT(*) n FROM caixa_movimentos WHERE caixa_id=? AND tipo='venda'", caixaId);
  assert(Number(noCaixa.n) === 1, "fiado nao deveria entrar no caixa como dinheiro");
  return `${cliente.nome}: R$ ${saldoAntes.toFixed(2)} -> R$ ${saldoDepois.toFixed(2)}`;
});

await passo("Fiado acima do limite do cliente e bloqueado", async () => {
  const saldoAntes = saldoFiado(cliente.id);
  const vendasAntes = qtdVendas();
  const excedente = arred(Number(cliente.limite_credito) + 100);
  const r = await chamar("finalizarVenda", [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 1, preco_unitario: excedente, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaFiado.id, valor: excedente }],
    cliente_id: cliente.id,
  }]);
  assert(r && r.ok === false, "venda no fiado acima do limite foi aceita");
  assert(/excedido/i.test(r.erro || ""), "mensagem de erro inesperada: " + r.erro);
  assert(saldoFiado(cliente.id) === saldoAntes, "saldo de fiado mudou mesmo com venda recusada");
  assert(qtdVendas() === vendasAntes, "venda recusada foi gravada no banco");
  return r.erro;
});

await passo("Desconto acima do limite exige senha de supervisor (operador)", async () => {
  const vendasAntes = qtdVendas();
  const payload = (extra = {}) => [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 1, preco_unitario: precoVenda, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: arred(precoVenda * 0.5) }],
    desconto_pct: 50,
    ...extra,
  }];

  const semSenha = await chamar("finalizarVenda", payload(), "/caixa", SESSOES.operador);
  assert(semSenha && semSenha.ok === false && semSenha.precisa_supervisor === true, "operador conseguiu 50% de desconto sem supervisor: " + JSON.stringify(semSenha));
  assert(qtdVendas() === vendasAntes, "venda com desconto bloqueado foi gravada");

  const pinErrado = await chamar("finalizarVenda", payload({ senha_supervisor: "0000" }), "/caixa", SESSOES.operador);
  assert(pinErrado && pinErrado.ok === false, "aceitou PIN invalido de supervisor");

  const valida = await chamar("validarSupervisor", [String(gerente.pin)], "/caixa", SESSOES.operador);
  assert(valida === true, "validarSupervisor nao reconheceu o PIN do gerente");

  const comSenha = await chamar("finalizarVenda", payload({ senha_supervisor: String(gerente.pin) }), "/caixa", SESSOES.operador);
  assert(comSenha?.ok, "venda com desconto autorizado foi recusada: " + JSON.stringify(comSenha));
  const v = one("SELECT total, desconto_pct, usuario_id FROM vendas WHERE id=?", comSenha.venda_id);
  assert(arred(v.total) === arred(precoVenda * 0.5), `total com 50% de desconto incorreto: ${v.total}`);
  assert(Number(v.usuario_id) === Number(operador.id), "venda autorizada registrou usuario errado");
  return `PIN do gerente aceito | total R$ ${arred(v.total).toFixed(2)}`;
});

await passo("Venda acima do estoque disponivel e bloqueada", async () => {
  const estoqueAntes = estoqueDe(sku.variacao_id);
  const vendasAntes = qtdVendas();
  const r = await chamar("finalizarVenda", [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 99999, preco_unitario: precoVenda, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: arred(precoVenda * 99999) }],
  }]);
  assert(r && r.ok === false, "vendeu 99999 unidades sem estoque");
  assert(/Estoque insuficiente/i.test(r.erro || ""), "mensagem inesperada: " + r.erro);
  assert(estoqueDe(sku.variacao_id) === estoqueAntes, "estoque mudou em venda recusada");
  assert(qtdVendas() === vendasAntes, "venda recusada foi gravada");
  return r.erro;
});

await passo("Pagamento insuficiente nao gera venda nem baixa estoque (rollback)", async () => {
  const estoqueAntes = estoqueDe(sku.variacao_id);
  const vendasAntes = qtdVendas();
  const r = await chamar("finalizarVenda", [{
    itens: [{ variacao_id: sku.variacao_id, quantidade: 1, preco_unitario: precoVenda, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: arred(precoVenda / 2) }],
  }]);
  assert(r && r.ok === false, "aceitou venda com pagamento menor que o total");
  assert(/Pagamento insuficiente/i.test(r.erro || ""), "mensagem inesperada: " + r.erro);
  assert(estoqueDe(sku.variacao_id) === estoqueAntes, "estoque foi baixado em venda recusada");
  assert(qtdVendas() === vendasAntes, "venda recusada foi gravada");
  return r.erro;
});

await passo("Sangria nao pode passar do dinheiro em caixa", async () => {
  const grande = await chamar("lancarMovimentoCaixa", ["sangria", 999999, "teste"]);
  assert(grande && grande.ok === false, "aceitou sangria maior que o dinheiro em caixa");
  const ok = await chamar("lancarMovimentoCaixa", ["sangria", 50, "Sangria de teste"]);
  assert(ok?.ok, "sangria valida recusada: " + JSON.stringify(ok));
  const mov = one("SELECT COUNT(*) n FROM caixa_movimentos WHERE caixa_id=? AND tipo='sangria' AND valor=50", caixaId);
  assert(Number(mov.n) === 1, "sangria nao gravada no caixa");
  return "sangria de R$ 50 registrada";
});

await passo("Devolucao parcial volta para o estoque e nao apaga a venda", async () => {
  const estoqueAntes = estoqueDe(sku.variacao_id);
  const item = one("SELECT id, preco_unitario FROM vendas_itens WHERE venda_id=? ORDER BY id LIMIT 1", vendaDinheiro);
  const r = await chamar("registrarDevolucao", [vendaDinheiro, [{ venda_item_id: item.id, quantidade: 1, destino: "estoque" }], "Cliente trocou a cor"], "/vendas/" + vendaDinheiro);
  assert(r?.ok, "devolucao recusada: " + JSON.stringify(r));
  assert(estoqueDe(sku.variacao_id) === estoqueAntes + 1, "estoque nao recebeu a peca devolvida");
  const dev = one("SELECT * FROM devolucoes WHERE venda_id=? ORDER BY id DESC LIMIT 1", vendaDinheiro);
  assert(dev && arred(dev.total) === arred(item.preco_unitario), `total da devolucao incorreto: ${dev?.total}`);
  assert(Number(one("SELECT devolvido FROM vendas_itens WHERE id=?", item.id).devolvido) === 1, "item nao marcou devolvido");
  assert(one("SELECT status FROM vendas WHERE id=?", vendaDinheiro).status === "devolvida_parcial", "status da venda nao virou devolvida_parcial");
  const mov = one("SELECT COUNT(*) n FROM estoque_movimentos WHERE referencia_id=? AND tipo='devolucao'", dev.id);
  assert(Number(mov.n) === 1, "movimento de devolucao nao gerado");
  return `${dev.numero} R$ ${arred(dev.total).toFixed(2)}`;
});

await passo("Devolucao maior que o vendido e bloqueada", async () => {
  const item = one("SELECT id FROM vendas_itens WHERE venda_id=? ORDER BY id LIMIT 1", vendaDinheiro);
  const r = await chamar("registrarDevolucao", [vendaDinheiro, [{ venda_item_id: item.id, quantidade: 99, destino: "estoque" }], "teste"], "/vendas/" + vendaDinheiro);
  assert(r && r.ok === false, "aceitou devolver 99 unidades de um item com 2");
  return r.erro;
});

await passo("Cancelamento estorna estoque, fiado e caixa", async () => {
  const estoqueAntes = estoqueDe(sku.variacao_id);
  const item = one("SELECT variacao_id, quantidade FROM vendas_itens WHERE venda_id=? LIMIT 1", vendaFiado);
  const r = await chamar("cancelarVenda", [vendaFiado, "Cliente desistiu"], "/vendas/" + vendaFiado);
  assert(r?.ok, "cancelamento recusado: " + JSON.stringify(r));
  const v = one("SELECT status, motivo_cancelamento FROM vendas WHERE id=?", vendaFiado);
  assert(v.status === "cancelada", "venda nao ficou cancelada");
  assert(/desistiu/i.test(v.motivo_cancelamento || ""), "motivo do cancelamento nao gravado");
  assert(estoqueDe(item.variacao_id) === estoqueAntes + Number(item.quantidade), "estoque nao voltou no cancelamento");
  const est = one("SELECT COUNT(*) n FROM caixa_movimentos WHERE caixa_id=? AND tipo='estorno'", caixaId);
  assert(Number(est.n) >= 1, "estorno nao lancado no caixa");
  const fia = one("SELECT tipo FROM fiado_lancamentos WHERE venda_id=?", vendaFiado);
  assert(fia.tipo === "cancelamento", "lancamento de fiado nao foi estornado");
  return "estoque devolvido, fiado estornado e caixa estornado";
});

await passo("Cancelar venda ja cancelada e bloqueado", async () => {
  const r = await chamar("cancelarVenda", [vendaFiado, "de novo"], "/vendas/" + vendaFiado);
  assert(r && r.ok === false, "cancelou duas vezes a mesma venda");
  return r.erro;
});

await passo("Fechamento de caixa confere dinheiro e diferenca", async () => {
  const abertura = Number(one("SELECT valor_abertura FROM caixas WHERE id=?", caixaId).valor_abertura);
  const soma = one(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento_id IN (SELECT id FROM formas_pagamento WHERE tipo='dinheiro') THEN valor ELSE 0 END),0) dinheiro,
       COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0) sangrias,
       COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0) suprimentos,
       COALESCE(SUM(CASE WHEN tipo='estorno' THEN valor ELSE 0 END),0) estornos
     FROM caixa_movimentos WHERE caixa_id=?`,
    caixaId
  );
  const esperado = arred(abertura + Number(soma.dinheiro) + Number(soma.suprimentos) - Number(soma.sangrias));
  const r = await chamar("fecharCaixa", [esperado, "Fechamento do teste"]);
  assert(r?.ok, "fechamento recusado: " + JSON.stringify(r));
  assert(arred(r.esperado) === esperado, `valor de sistema do fechamento difere (${r.esperado} x ${esperado})`);
  assert(arred(r.diferenca) === 0, "diferenca deveria ser zero: " + r.diferenca);
  const cx = one("SELECT status, valor_sistema, valor_fechamento_informado, diferenca FROM caixas WHERE id=?", caixaId);
  assert(cx.status === "fechado", "caixa nao ficou fechado");
  assert(arred(cx.valor_sistema) === esperado, "valor_sistema gravado difere do esperado");
  assert(one("SELECT COUNT(*) n FROM auditoria WHERE acao='fechar_caixa' AND entidade_id=?", caixaId).n > 0, "fechamento nao auditado");
  return `esperado R$ ${esperado.toFixed(2)} | diferenca R$ 0,00`;
});

await passo("Fechar caixa sem caixa aberto e bloqueado", async () => {
  const r = await chamar("fecharCaixa", [100, "teste"]);
  assert(r && r.ok === false, "fechou um caixa que nao estava aberto");
  return r.erro;
});

await passo("Auditoria registrou as operacoes do dia", async () => {
  const acoesAuditadas = all("SELECT DISTINCT acao FROM auditoria WHERE criado_em >= datetime('now','localtime','-1 day')").map((r) => r.acao);
  for (const esperada of ["abrir_caixa", "venda", "devolucao", "cancelar_venda", "fechar_caixa"]) {
    assert(acoesAuditadas.includes(esperada), "auditoria nao registrou: " + esperada);
  }
  return acoesAuditadas.join(", ");
});

/* ------------------------------------------------------------------ */
/* Resultado                                                           */
/* ------------------------------------------------------------------ */

console.log("\n============================================");
console.log(` PASSOS OK: ${passos - falhas.length}/${passos}`);
if (falhas.length) {
  console.log(` FALHAS: ${falhas.length}`);
  for (const f of falhas) console.log("   - " + f);
} else {
  console.log(" TODOS OS FLUXOS DE NEGOCIO PASSARAM");
}
console.log("============================================");

con.close();
await finalizar(falhas.length ? 1 : 0);
