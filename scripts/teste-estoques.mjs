/**
 * TESTE DE ESTOQUES SEPARADOS (ponta a ponta, PostgreSQL/PGlite).
 *
 * Exercita as regras dos 2+ estoques de verdade: sobe um servidor Next com um
 * banco PostgreSQL em memoria (PGlite), migra os dados do banco local e chama
 * as MESMAS server actions que a tela usa (postando formulario como o navegador
 * faz). Depois confere o resultado direto no banco.
 *
 * O que e verificado:
 *   1. transferencia move os dois estoques e cria o documento TRF-xxxxx
 *   2. saldo insuficiente bloqueia e nao muda nada
 *   3. origem igual ao destino e recusada
 *   4. galpao/deposito nao abre caixa (nao vende no balcao)
 *   5. a venda baixa do estoque do caixa (loja), nao do total
 *   6. venda maior que o saldo DO LOCAL e bloqueada mesmo sobrando no galpao
 *   7. cancelar a transferencia estorna as duas pontas
 *   8. cancelar e bloqueado quando o destino ja consumiu (nao deixa negativo)
 *   9. as telas de estoque separado respondem e mostram os dois locais
 *  10. o CSV de estoque traz uma coluna de saldo por estoque
 *
 * Uso: node scripts/teste-estoques.mjs
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";
import { decodificarFlight } from "./_flight.mjs";

const SCHEMA = "banho_encanto";
const root = new URL("..", import.meta.url);
const temporario = await mkdtemp(join(tmpdir(), "bde-estoques-"));
const engine = new PGlite();
const wire = createServer(engine);
let app = null;
let falhas = 0;
let passos = 0;

async function porta() {
  const s = createTcpServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

async function rodar(bin, args, env) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    p.stdout.on("data", (c) => (saida += c));
    p.stderr.on("data", (c) => (saida += c));
    p.on("close", (code) => resolve({ code, saida }));
  });
}

const q = async (sql, params = []) => (await engine.query(sql, params)).rows;
const linhas = (sql, params) => q(sql, params);

async function saldo(variacaoId, lojaId) {
  const r = await linhas(`SELECT quantidade FROM ${SCHEMA}.estoque WHERE variacao_id=$1 AND loja_id=$2`, [variacaoId, lojaId]);
  return Number(r[0]?.quantidade ?? 0);
}

async function passo(nome, fn) {
  passos++;
  try {
    const detalhe = await fn();
    console.log(`  OK   ${nome}${detalhe ? "  (" + detalhe + ")" : ""}`);
  } catch (e) {
    falhas++;
    console.log(`  FALHA ${nome}\n        -> ${e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Descoberta das server actions (nome -> id)                          */
/* ------------------------------------------------------------------ */

const acoes = {};
const RE_ACAO = /"([0-9a-f]{40,})"[\s\S]{0,900}?"([A-Za-z0-9_]+)"\s*\)/g;

function extrairAcoes(texto) {
  if (!texto.includes("createServerReference") && !texto.includes("$ACTION_ID_")) return;
  RE_ACAO.lastIndex = 0;
  let m;
  while ((m = RE_ACAO.exec(texto)) !== null) acoes[m[2]] ??= m[1];
}

async function aquecer(paginas, cookie) {
  for (const p of paginas) {
    let html = "";
    try {
      html = await (await fetch(BASE + p, { headers: { cookie } })).text();
    } catch {
      continue;
    }
    extrairAcoes(html);
    const srcs = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+?\.js(?:\?[^"]*)?)"/g)) srcs.add(m[1]);
    for (const s of srcs) {
      const url = s.startsWith("http") ? s : BASE + (s.startsWith("/") ? s : "/" + s);
      try {
        const r = await fetch(url);
        if (r.ok) extrairAcoes(await r.text());
      } catch {
        /* chunk opcional */
      }
    }
  }
}

/** Ids de server action embutidos em formularios renderizados pelo servidor. */
function acoesDeFormulario(html) {
  const encontrados = [];
  for (const bloco of html.split(/<form/i).slice(1)) {
    const corpo = bloco.split(/<\/form>/i)[0];
    const id = corpo.match(/\$ACTION_ID_([0-9a-f]{20,})/)?.[1];
    if (id) encontrados.push({ id, corpo });
  }
  return encontrados;
}

let BASE = "";

/** Chama uma action passando um objeto JSON (acoes que recebem objeto). */
async function chamar(nome, args, pagina = "/caixa") {
  const id = acoes[nome];
  if (!id) throw new Error(`server action "${nome}" nao encontrada nos chunks compilados`);
  const r = await fetch(BASE + pagina, {
    method: "POST",
    headers: {
      cookie: SESSOES.admin,
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: BASE,
      Accept: "text/x-component",
    },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  if (r.status !== 200) throw new Error(`${nome} -> HTTP ${r.status}: ${texto.slice(0, 200)}`);
  return decodificarFlight(texto);
}

/** Envia um formulario de verdade (multipart) como o navegador faz — sem JS. */
async function enviarFormulario(pagina, idAcao, campos) {
  const form = new FormData();
  form.append(`$ACTION_ID_${idAcao}`, "");
  for (const [chave, valor] of campos) form.append(chave, String(valor));
  const r = await fetch(BASE + pagina, {
    method: "POST",
    headers: { cookie: SESSOES.admin, Origin: BASE },
    body: form,
    redirect: "manual",
  });
  const destino = r.headers.get("x-action-redirect") || r.headers.get("location") || "";
  const corpo = r.status === 200 && !destino ? await r.text() : "";
  return { status: r.status, destino, corpo };
}

const parametro = (destino, nome) => {
  const m = destino.match(new RegExp(`[?&]${nome}=([^&]*)`));
  return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
};

/* ------------------------------------------------------------------ */
/* Infra                                                               */
/* ------------------------------------------------------------------ */

const SESSOES = {};
let penduradas = [];

try {
  await engine.waitReady;
  await new Promise((resolve, reject) => {
    wire.once("error", reject);
    wire.listen(0, "127.0.0.1", resolve);
  });
  const portaPG = wire.address().port;
  const DATABASE_URL = `postgresql://postgres:***@127.0.0.1:${portaPG}/postgres?sslmode=disable`;
  const BDE_SECRET = randomBytes(48).toString("hex");
  const env = { ...process.env, DATABASE_URL, BDE_SECRET, BDE_INITIAL_ACCESS_PATH: join(temporario, "acesso.txt") };

  console.log("1/3  Migrando os dados locais para o PostgreSQL em memoria...");
  const migracao = await rodar(process.execPath, ["scripts/migrar-sqlite-postgres.mjs", "--confirmar"], env);
  assert.equal(migracao.code, 0, "migracao falhou: " + migracao.saida.slice(-1500));

  console.log("2/3  Subindo o servidor (next dev)...");
  const portaApp = await porta();
  BASE = `http://127.0.0.1:${portaApp}`;
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(portaApp)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logApp = "";
  app.stdout.on("data", (c) => (logApp += c));
  app.stderr.on("data", (c) => (logApp += c));

  let pronto = false;
  for (let i = 0; i < 200; i++) {
    if (app.exitCode !== null) throw new Error("next encerrou: " + logApp.slice(-1500));
    try {
      const r = await fetch(BASE + "/login", { signal: AbortSignal.timeout(3000) });
      if (r.status === 200) {
        pronto = true;
        break;
      }
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(pronto, "servidor nao respondeu em 100s: " + logApp.slice(-1200));

  console.log("3/3  Verificando os fluxos de estoque separado\n");

  /* ---------------------------------------------------------------- */
  /* Contexto                                                         */
  /* ---------------------------------------------------------------- */

  const usuarios = await linhas(`SELECT id, nome, papel, pin FROM ${SCHEMA}.usuarios WHERE ativo=1 ORDER BY id`);
  const admin = usuarios.find((u) => u.papel === "admin") ?? usuarios[0];
  assert.ok(admin, "sem usuario para a sessao");
  const ehAdmin = admin.papel === "admin" || admin.papel === "gerente";
  assert.ok(ehAdmin, "o usuario do teste precisa ser admin/gerente");

  SESSOES.admin = (() => {
    const corpo = Buffer.from(JSON.stringify({ uid: admin.id, exp: Date.now() + 3600_000 })).toString("base64url");
    return "bde_sessao=" + corpo + "." + createHmac("sha256", BDE_SECRET).update(corpo).digest("base64url");
  })();

  const lojas = await linhas(`SELECT id, nome, eh_deposito, padrao, ativa FROM ${SCHEMA}.lojas ORDER BY id`);
  const loja = lojas.find((l) => l.ativa === 1 && l.eh_deposito === 0 && l.padrao === 1) ?? lojas.find((l) => l.eh_deposito === 0);
  assert.ok(loja, "sem loja (eh_deposito = 0) no banco de teste");
  let galpao = lojas.find((l) => l.eh_deposito === 1);
  if (!galpao) {
    const nome = "Galpao de Teste";
    const r = await engine.query(
      `INSERT INTO ${SCHEMA}.lojas(nome, apelido, eh_deposito, padrao, ativa) VALUES ($1,'TESTE',1,0,1) RETURNING id`,
      [nome]
    );
    galpao = { id: r.rows[0].id, nome, eh_deposito: 1 };
  }
  console.log(`  contexto: loja ${loja.id} (${loja.nome}) | galpao ${galpao.id} (${galpao.nome})`);

  // SKUs com saldo na loja para a transferencia
  const skus = await linhas(
    `SELECT e.variacao_id, e.quantidade, v.sku, v.preco_venda
       FROM ${SCHEMA}.estoque e JOIN ${SCHEMA}.variacoes v ON v.id = e.variacao_id
      WHERE e.loja_id = $1 AND e.quantidade >= 10 AND v.permite_estoque_negativo = 0 AND v.status = 'ativo'
      ORDER BY e.quantidade DESC LIMIT 3`,
    [loja.id]
  );
  assert.ok(skus.length >= 2, "o banco de teste precisa de 2 SKUs com saldo >= 10 na loja");
  const [skuA, skuB] = skus;
  const formaDinheiro = (await linhas(`SELECT id FROM ${SCHEMA}.formas_pagamento WHERE tipo='dinheiro' AND ativo=1 LIMIT 1`))[0];
  assert.ok(formaDinheiro, "sem forma de pagamento em dinheiro");

  // Nada de caixa aberto sobrando
  await engine.exec(`UPDATE ${SCHEMA}.caixas SET status='fechado' WHERE status='aberto'`);

  /* ---------------------------------------------------------------- */
  /* Aquecimento: descobre as actions                                 */
  /* ---------------------------------------------------------------- */

  const paginas = ["/caixa", "/estoque", "/estoque/transferencia", "/configuracoes/lojas"];
  await aquecer(paginas, SESSOES.admin);
  await aquecer(paginas, SESSOES.admin);
  const necesarias = ["abrirCaixa", "finalizarVenda", "acaoCriarTransferencia", "saldosDoItem"];
  const faltando = necesarias.filter((n) => !acoes[n]);
  if (faltando.length) {
    console.error("Nao encontrei as server actions: " + faltando.join(", "));
    console.error("Encontradas: " + Object.keys(acoes).sort().join(", "));
    throw new Error("descoberta de server actions incompleta");
  }

  /* ---------------------------------------------------------------- */
  /* 1. Transferencia                                                 */
  /* ---------------------------------------------------------------- */

  const antesA = await saldo(skuA.variacao_id, loja.id);
  const antesB = await saldo(skuB.variacao_id, loja.id);
  const galpaoA = await saldo(skuA.variacao_id, galpao.id);
  const galpaoB = await saldo(skuB.variacao_id, galpao.id);
  let transferencia = null;

  await passo("Transferencia (formulario) move os dois estoques e cria o documento", async () => {
    const r = await enviarFormulario("/estoque/transferencia", acoes.acaoCriarTransferencia, [
      ["loja_origem", loja.id],
      ["loja_destino", galpao.id],
      ["variacao_id", skuA.variacao_id],
      ["quantidade", 3],
      ["variacao_id", skuB.variacao_id],
      ["quantidade", 2],
      ["observacoes", "Teste automatizado de estoque separado"],
    ]);
    const erro = parametro(r.destino, "erro");
    assert.ok(!erro, "a transferencia foi recusada: " + erro + " | " + r.corpo.slice(0, 200));
    const msg = parametro(r.destino, "msg");
    assert.ok(msg && /TRF-\d{5}/.test(msg), "nao redirecionou com o numero da transferencia: " + r.destino);

    const t = (await linhas(`SELECT * FROM ${SCHEMA}.transferencias ORDER BY id DESC LIMIT 1`))[0];
    transferencia = t;
    assert.ok(t && /^TRF-\d{5}$/.test(t.numero), "documento de transferencia nao gravado");
    assert.equal(Number(t.loja_origem), loja.id, "origem errada no documento");
    assert.equal(Number(t.loja_destino), galpao.id, "destino errado no documento");
    assert.equal(t.status, "concluida", "transferencia deveria nascer concluida");
    assert.equal(Number(t.itens), 2, `documento deveria ter 2 itens (tem ${t.itens})`);
    assert.equal(Number(t.pecas), 5, `documento deveria ter 5 pecas (tem ${t.pecas})`);

    assert.equal(await saldo(skuA.variacao_id, loja.id), antesA - 3, "saldo da origem (SKU A) nao baixou 3");
    assert.equal(await saldo(skuB.variacao_id, loja.id), antesB - 2, "saldo da origem (SKU B) nao baixou 2");
    assert.equal(await saldo(skuA.variacao_id, galpao.id), galpaoA + 3, "saldo do destino (SKU A) nao subiu 3");
    assert.equal(await saldo(skuB.variacao_id, galpao.id), galpaoB + 2, "saldo do destino (SKU B) nao subiu 2");

    const saidas = await linhas(
      `SELECT * FROM ${SCHEMA}.estoque_movimentos WHERE referencia_tipo='transferencia' AND referencia_id=$1 AND tipo='transferencia_saida'`,
      [t.id]
    );
    const entradas = await linhas(
      `SELECT * FROM ${SCHEMA}.estoque_movimentos WHERE referencia_tipo='transferencia' AND referencia_id=$1 AND tipo='transferencia_entrada'`,
      [t.id]
    );
    assert.equal(saidas.length, 2, "faltou movimento de saida na origem");
    assert.equal(entradas.length, 2, "faltou movimento de entrada no destino");
    assert.ok(saidas.every((m) => Number(m.loja_id) === loja.id), "movimento de saida no estoque errado");
    assert.ok(entradas.every((m) => Number(m.loja_id) === galpao.id), "movimento de entrada no estoque errado");
    assert.ok(saidas.every((m) => m.documento === t.numero), "movimento sem o documento da transferencia");

    const auditoria = await linhas(
      `SELECT * FROM ${SCHEMA}.auditoria WHERE acao='transferencia' AND entidade_id=$1`,
      [t.id]
    );
    assert.ok(auditoria.length > 0, "transferencia nao auditada");
    return `${t.numero}: ${t.pecas} pecas, 2 saidas + 2 entradas`;
  });

  await passo("Saldo insuficiente bloqueia e nao muda nada", async () => {
    const totalAntes = (await linhas(`SELECT COALESCE(SUM(quantidade),0) s FROM ${SCHEMA}.estoque`))[0].s;
    const docAntes = (await linhas(`SELECT COUNT(*) n FROM ${SCHEMA}.transferencias`))[0].n;
    const r = await enviarFormulario("/estoque/transferencia", acoes.acaoCriarTransferencia, [
      ["loja_origem", loja.id],
      ["loja_destino", galpao.id],
      ["variacao_id", skuA.variacao_id],
      ["quantidade", 999999],
    ]);
    const erro = parametro(r.destino, "erro");
    assert.ok(erro && /Saldo insuficiente/i.test(erro), "deveria recusar por saldo: " + (erro || r.corpo.slice(0, 200)));
    assert.equal(await saldo(skuA.variacao_id, loja.id), antesA - 3, "o saldo da origem mudou mesmo com erro");
    assert.equal(await saldo(skuA.variacao_id, galpao.id), galpaoA + 3, "o saldo do destino mudou mesmo com erro");
    const totalDepois = (await linhas(`SELECT COALESCE(SUM(quantidade),0) s FROM ${SCHEMA}.estoque`))[0].s;
    assert.equal(Number(totalDepois), Number(totalAntes), "o total de pecas mudou numa transferencia recusada");
    assert.equal((await linhas(`SELECT COUNT(*) n FROM ${SCHEMA}.transferencias`))[0].n, docAntes, "criou documento de uma transferencia recusada");
    return erro.slice(0, 90);
  });

  await passo("Origem igual ao destino e recusada", async () => {
    const r = await enviarFormulario("/estoque/transferencia", acoes.acaoCriarTransferencia, [
      ["loja_origem", loja.id],
      ["loja_destino", loja.id],
      ["variacao_id", skuA.variacao_id],
      ["quantidade", 1],
    ]);
    const erro = parametro(r.destino, "erro");
    assert.ok(erro && /diferentes/i.test(erro), "deveria recusar origem = destino: " + (erro || r.corpo.slice(0, 200)));
    return erro.slice(0, 80);
  });

  /* ---------------------------------------------------------------- */
  /* 2. PDV por estoque                                               */
  /* ---------------------------------------------------------------- */

  await passo("Galpao/deposito nao abre caixa (nao vende no balcao)", async () => {
    const r = await chamar("abrirCaixa", [150, "CAIXA TESTE", galpao.id]);
    assert.ok(r && r.ok === false, "o galpao nao deveria abrir caixa: " + JSON.stringify(r));
    assert.ok(/deposito|galpao/i.test(r.erro || ""), "mensagem pouco clara: " + r.erro);
    return r.erro.slice(0, 80);
  });

  await passo("Venda baixa do estoque do caixa (loja) e nao do total", async () => {
    const aberto = await chamar("abrirCaixa", [200, "CAIXA TESTE", loja.id]);
    assert.ok(aberto?.ok, "nao abriu o caixa na loja: " + JSON.stringify(aberto));
    const caixa = (await linhas(`SELECT * FROM ${SCHEMA}.caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1`))[0];
    assert.equal(Number(caixa.loja_id), loja.id, "o caixa abriu no estoque errado");

    const lojaAntes = await saldo(skuA.variacao_id, loja.id);
    const galpaoAntes = await saldo(skuA.variacao_id, galpao.id);
    const preco = Number(skuA.preco_venda);
    const venda = await chamar("finalizarVenda", [
      {
        itens: [{ variacao_id: skuA.variacao_id, quantidade: 2, preco_unitario: preco, desconto_valor: 0 }],
        pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: Math.round(preco * 2 * 100) / 100 }],
      },
    ]);
    assert.ok(venda?.ok, "venda recusada: " + JSON.stringify(venda));
    assert.equal(await saldo(skuA.variacao_id, loja.id), lojaAntes - 2, "a venda nao baixou do estoque da loja");
    assert.equal(await saldo(skuA.variacao_id, galpao.id), galpaoAntes, "a venda mexeu no estoque do galpao (nao podia)");
    const v = (await linhas(`SELECT loja_id FROM ${SCHEMA}.vendas WHERE id=$1`, [venda.venda_id]))[0];
    assert.equal(Number(v.loja_id), loja.id, "a venda foi gravada em outro estoque");
    const mov = await linhas(
      `SELECT * FROM ${SCHEMA}.estoque_movimentos WHERE referencia_id=$1 AND tipo='venda'`,
      [venda.venda_id]
    );
    assert.ok(mov.length === 1 && Number(mov[0].loja_id) === loja.id, "movimento de venda no estoque errado");
    return `${venda.numero}: loja ${lojaAntes}->${lojaAntes - 2}, galpao intacto`;
  });

  await passo("Venda maior que o saldo DO LOCAL e bloqueada (mesmo sobrando no galpao)", async () => {
    const lojaSaldo = await saldo(skuA.variacao_id, loja.id);
    const galpaoS = await saldo(skuA.variacao_id, galpao.id);
    assert.ok(galpaoS > 0, "o galpao precisa ter saldo para este teste");
    const pedido = lojaSaldo + galpaoS; // existe no total, mas nao na loja
    const antesVendas = (await linhas(`SELECT COUNT(*) n FROM ${SCHEMA}.vendas`))[0].n;
    const r = await chamar("finalizarVenda", [
      {
        itens: [{ variacao_id: skuA.variacao_id, quantidade: pedido, preco_unitario: Number(skuA.preco_venda), desconto_valor: 0 }],
        pagamentos: [{ forma_pagamento_id: formaDinheiro.id, valor: Math.round(Number(skuA.preco_venda) * pedido * 100) / 100 }],
      },
    ]);
    assert.ok(r && r.ok === false, "a venda deveria ser recusada: " + JSON.stringify(r));
    assert.ok(/Estoque insuficiente/i.test(r.erro || ""), "mensagem inesperada: " + r.erro);
    assert.ok((r.erro || "").includes(loja.nome.slice(0, 12)), "a mensagem deveria dizer em qual estoque falta: " + r.erro);
    assert.equal(await saldo(skuA.variacao_id, loja.id), lojaSaldo, "a loja mudou numa venda recusada");
    assert.equal(await saldo(skuA.variacao_id, galpao.id), galpaoS, "o galpao mudou numa venda recusada");
    assert.equal((await linhas(`SELECT COUNT(*) n FROM ${SCHEMA}.vendas`))[0].n, antesVendas, "gravou venda recusada");
    return r.erro.slice(0, 90);
  });

  /* ---------------------------------------------------------------- */
  /* 3. Cancelamento                                                  */
  /* ---------------------------------------------------------------- */

  await passo("Cancelar a transferencia estorna as duas pontas", async () => {
    // O formulario de cancelamento e renderizado pelo servidor: o id da action
    // vem do proprio HTML da pagina (campo $ACTION_ID_ do form).
    const html = await (await fetch(`${BASE}/estoque/transferencia?destaque=${transferencia.id}`, { headers: { cookie: SESSOES.admin } })).text();
    const formulario = acoesDeFormulario(html).find((f) => f.corpo.includes("transferencia_id"));
    assert.ok(formulario, "nao achei o formulario de cancelar transferencia na pagina");

    // Saldos no momento do cancelamento (entre a transferencia e agora houve venda)
    const lojaA = await saldo(skuA.variacao_id, loja.id);
    const lojaB = await saldo(skuB.variacao_id, loja.id);
    const galpaoA2 = await saldo(skuA.variacao_id, galpao.id);
    const galpaoB2 = await saldo(skuB.variacao_id, galpao.id);

    const r = await enviarFormulario("/estoque/transferencia", formulario.id, [
      ["transferencia_id", transferencia.id],
      ["motivo", "Erro de digitacao no pedido"],
    ]);
    const msg = parametro(r.destino, "msg");
    const erro = parametro(r.destino, "erro");
    assert.ok(!erro, "cancelamento recusado: " + (erro || r.corpo.slice(0, 200)));

    const t = (await linhas(`SELECT * FROM ${SCHEMA}.transferencias WHERE id=$1`, [transferencia.id]))[0];
    assert.equal(t.status, "cancelada", "a transferencia nao foi marcada como cancelada");
    assert.ok(t.motivo_cancelamento, "cancelamento sem motivo");
    assert.equal(await saldo(skuA.variacao_id, loja.id), lojaA + 3, "a origem (SKU A) nao recebeu as 3 pecas de volta");
    assert.equal(await saldo(skuB.variacao_id, loja.id), lojaB + 2, "a origem (SKU B) nao recebeu as 2 pecas de volta");
    assert.equal(await saldo(skuA.variacao_id, galpao.id), galpaoA2 - 3, "o destino (SKU A) nao devolveu as 3 pecas");
    assert.equal(await saldo(skuB.variacao_id, galpao.id), galpaoB2 - 2, "o destino (SKU B) nao devolveu as 2 pecas");
    const estornos = await linhas(
      `SELECT * FROM ${SCHEMA}.estoque_movimentos WHERE referencia_id=$1 AND tipo IN ('transferencia_saida','transferencia_entrada')`,
      [transferencia.id]
    );
    // 2 itens x 2 pontas na ida + 2 itens x 2 pontas no estorno
    assert.equal(estornos.length, 8, `deveria ter 8 movimentos (ida e volta), tem ${estornos.length}`);
    const doEstorno = estornos.filter((m) => /Cancelamento/i.test(m.motivo || ""));
    assert.equal(doEstorno.length, 4, "o estorno deveria registrar 4 movimentos");
    // Efeito liquido da transferencia cancelada tem de ser zero em cada SKU
    for (const vid of [skuA.variacao_id, skuB.variacao_id]) {
      const doSku = estornos.filter((m) => Number(m.variacao_id) === Number(vid));
      const liquido = doSku.reduce(
        (s, m) => s + (m.tipo === "transferencia_entrada" ? Number(m.quantidade) : -Number(m.quantidade)),
        0
      );
      assert.equal(liquido, 0, `a transferencia cancelada deixou saldo residual no SKU ${vid}`);
    }
    return msg ? msg.slice(0, 70) : "estornado nas duas pontas";
  });

  await passo("Cancelar e bloqueado quando o destino ja consumiu (nao deixa negativo)", async () => {
    const r = await enviarFormulario("/estoque/transferencia", acoes.acaoCriarTransferencia, [
      ["loja_origem", loja.id],
      ["loja_destino", galpao.id],
      ["variacao_id", skuB.variacao_id],
      ["quantidade", 4],
    ]);
    assert.ok(!parametro(r.destino, "erro"), "a transferencia de apoio falhou: " + r.destino);
    const t = (await linhas(`SELECT * FROM ${SCHEMA}.transferencias ORDER BY id DESC LIMIT 1`))[0];
    const saldoGalpaoAntes = await saldo(skuB.variacao_id, galpao.id);

    // Simula que o destino JA consumiu tudo (saida/perda la dentro): o
    // cancelamento nao pode deixar saldo negativo, entao tem de ser bloqueado.
    await engine.exec(
      `UPDATE ${SCHEMA}.estoque SET quantidade = 0 WHERE variacao_id = ${skuB.variacao_id} AND loja_id = ${galpao.id}`
    );
    const html = await (await fetch(`${BASE}/estoque/transferencia`, { headers: { cookie: SESSOES.admin } })).text();
    const formulario = acoesDeFormulario(html).find((f) => f.corpo.includes("transferencia_id"));
    assert.ok(formulario, "nao achei o formulario de cancelar transferencia");
    const res = await enviarFormulario("/estoque/transferencia", formulario.id, [
      ["transferencia_id", t.id],
      ["motivo", "teste"],
    ]);
    const erro = parametro(res.destino, "erro");
    assert.ok(erro && /Nao da para cancelar/i.test(erro), "deveria bloquear o cancelamento: " + (erro || res.corpo.slice(0, 200)));
    const t2 = (await linhas(`SELECT status FROM ${SCHEMA}.transferencias WHERE id=$1`, [t.id]))[0];
    assert.equal(t2.status, "concluida", "a transferencia foi cancelada mesmo sem saldo no destino");
    assert.equal(await saldo(skuB.variacao_id, galpao.id), 0, "o saldo do destino foi mexido");
    // devolve o saldo para nao deixar o teste com estado estranho
    await engine.exec(
      `UPDATE ${SCHEMA}.estoque SET quantidade = ${saldoGalpaoAntes} WHERE variacao_id = ${skuB.variacao_id} AND loja_id = ${galpao.id}`
    );
    return erro.slice(0, 90);
  });

  /* ---------------------------------------------------------------- */
  /* 4. Telas e CSV                                                   */
  /* ---------------------------------------------------------------- */

  await passo("Telas de estoque separado respondem e mostram os dois locais", async () => {
    const alvos = ["/estoque", `/estoque?estoque=${galpao.id}`, "/estoque/transferencia", "/estoque/movimentos", "/configuracoes/lojas"];
    for (const alvo of alvos) {
      const r = await fetch(BASE + alvo, { headers: { cookie: SESSOES.admin }, redirect: "manual" });
      const html = await r.text();
      assert.equal(r.status, 200, `${alvo} -> HTTP ${r.status}`);
      assert.ok(!/Internal Server Error|does not exist|errorId/.test(html), `${alvo} respondeu com erro de servidor`);
    }
    const html = await (await fetch(`${BASE}/estoque`, { headers: { cookie: SESSOES.admin } })).text();
    assert.ok(html.includes(galpao.nome), "a tela de estoque nao mostra o galpao");
    assert.ok(html.includes(loja.nome), "a tela de estoque nao mostra a loja");
    assert.ok(/Transferir entre estoques/.test(html), "a tela de estoque nao oferece a transferencia");
    const soGalpao = await (await fetch(`${BASE}/estoque?estoque=${galpao.id}`, { headers: { cookie: SESSOES.admin } })).text();
    assert.ok(soGalpao.includes(galpao.nome.slice(0, 15)), "a posicao por estoque nao filtrou o galpao");
    assert.ok(/Posicao de estoque/.test(soGalpao), "a tela nao mostra a secao de posicao");
    return `${alvos.length} telas OK`;
  });

  await passo("CSV de estoque traz uma coluna de saldo por estoque", async () => {
    const r = await fetch(BASE + "/api/exportar/estoque", { headers: { cookie: SESSOES.admin } });
    assert.equal(r.status, 200, "CSV -> HTTP " + r.status);
    const csv = await r.text();
    const cabecalho = csv.split(/\r?\n/)[0];
    const colunas = (await linhas(`SELECT nome, apelido, eh_deposito FROM ${SCHEMA}.vw_estoques ORDER BY loja_id`)).length;
    const comSaldo = (cabecalho.match(/saldo_/g) ?? []).length;
    assert.ok(comSaldo >= 2, `o CSV deveria ter uma coluna de saldo por estoque (tem ${comSaldo})`);
    assert.equal(comSaldo, colunas, `o CSV tem ${comSaldo} colunas de saldo para ${colunas} estoques`);
    assert.ok(/disponivel/.test(cabecalho), "o CSV perdeu a coluna de disponivel");
    return `${comSaldo} colunas por estoque`;
  });

  /* ---------------------------------------------------------------- */
} catch (e) {
  falhas++;
  console.error("\nERRO NA PREPARACAO: " + (e?.message || e));
} finally {
  if (app) {
    try {
      app.kill();
    } catch {}
  }
  try {
    wire.close();
  } catch {}
  try {
    await engine.close();
  } catch {}
  await rm(temporario, { recursive: true, force: true });
}

console.log("\n============================================");
console.log(` PASSOS OK: ${passos - falhas}/${passos}`);
if (falhas) console.log(` FALHAS: ${falhas}`);
else console.log(" ESTOQUES SEPARADOS: TUDO OK");
console.log("============================================");
process.exit(falhas ? 1 : 0);
