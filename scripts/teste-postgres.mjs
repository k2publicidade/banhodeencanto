// Integracao local com o motor PostgreSQL do PGlite, usando o mesmo driver pg da aplicacao.
// O servidor de teste compartilha uma sessao: pool max=1 e intencional. Os testes
// cobrem contexto async, filas e rollback; isolamento entre backends exige PostgreSQL/Supabase.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { createServer, LogLevel } from "pglite-server";
import ts from "typescript";

const engine = new PGlite();
const server = createServer(engine, { logLevel: LogLevel.Error });
const sockets = new Set();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
let db;
let passed = 0;
const checks = [];
async function test(name, fn) {
  await fn();
  passed++;
  checks.push(name);
  console.log(`OK ${name}`);
}

try {
  await engine.waitReady;
  await test("schema PostgreSQL aplicavel e idempotente", async () => {
    const schema = await readFile(new URL("../lib/schema-postgres.sql", import.meta.url), "utf8");
    await engine.exec(schema);
    await engine.exec(schema);
    const result = await engine.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'banho_encanto'");
    const names = new Set(result.rows.map((row) => row.table_name));
    for (const name of ["usuarios", "produtos", "variacoes", "estoque", "vendas", "devolucoes", "vw_variacoes", "vw_metricas_variacao", "vw_estoque_posicao"]) {
      assert.ok(names.has(name), `Tabela/view ausente: ${name}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  // Sempre substitui qualquer credencial herdada: este script so escreve no banco em memoria.
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres?sslmode=disable`;
  process.env.BDE_DB_POOL_MAX = "1";
  db = await import("../lib/db.ts");

  await test("driver pg preserva parametros, tipos numericos e schema", async () => {
    const value = "Teste d'aspas ?; SELECT 1";
    const row = await db.one("SELECT '?' AS literal, ?::text AS valor, 12.50::numeric AS dinheiro, COUNT(*) AS quantidade FROM usuarios -- ? ignorado", value);
    assert.equal(row.literal, "?");
    assert.equal(row.valor, value);
    assert.equal(row.dinheiro, 12.5);
    assert.equal(typeof row.quantidade, "number");
    assert.equal(await db.one("SELECT id FROM usuarios WHERE id = ?", -1), undefined);
  });

  const fixture = await db.tx(async () => {
    const id = async (sql, ...params) => Number((await db.run(sql + " RETURNING id", ...params)).lastInsertRowid);
    const loja = await id("INSERT INTO lojas(nome, padrao) VALUES (?,1)", "Loja de teste");
    const usuario = await id("INSERT INTO usuarios(nome, papel, loja_id, comissao_pct) VALUES (?, 'admin', ?, 2)", "Administrador teste", loja);
    const produto = await id("INSERT INTO produtos(nome, nome_reduzido, sku) VALUES (?,?,?)", "Cabelo de teste", "Cabelo", "PROD-TESTE");
    const variacao = await id("INSERT INTO variacoes(produto_id, sku, ean, custo_medio, preco_venda) VALUES (?,?,?,10,20)", produto, "SKU-TESTE", "7890000000001");
    await db.run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,20,0)", variacao, loja);
    const pagamento = await id("INSERT INTO formas_pagamento(nome,tipo,aceita_troco) VALUES (?, 'dinheiro', 1)", "Dinheiro de teste");
    const fiado = await id("INSERT INTO formas_pagamento(nome,tipo,entra_no_caixa) VALUES (?, 'fiado', 0)", "Fiado de teste");
    const cliente = await id("INSERT INTO clientes(nome, limite_credito) VALUES (?,30)", "Cliente de teste");
    return { loja, usuario, produto, variacao, pagamento, fiado, cliente };
  });

  await test("CRUD persistente, colunas geradas e views", async () => {
    assert.ok(fixture.variacao > 0);
    const row = await db.one("SELECT margem_valor, margem_percentual, markup, estoque, disponivel, estoque_custo FROM vw_variacoes WHERE variacao_id = ?", fixture.variacao);
    assert.deepEqual(row, { margem_valor: 10, margem_percentual: 50, markup: 2, estoque: 20, disponivel: 20, estoque_custo: 200 });
    const changed = await db.run("UPDATE estoque SET reservado = 2 WHERE variacao_id = ?", fixture.variacao);
    assert.equal(changed.changes, 1);
    assert.equal((await db.one("SELECT disponivel FROM vw_variacoes WHERE variacao_id = ?", fixture.variacao)).disponivel, 18);
    await db.run("UPDATE estoque SET reservado = 0 WHERE variacao_id = ?", fixture.variacao);
  });

  await test("rollback desfaz todas as escritas e recupera a conexao", async () => {
    await assert.rejects(db.tx(async () => {
      await db.run("INSERT INTO configuracoes(chave, valor) VALUES (?,?)", "teste_rollback", "antes");
      await delay(5);
      assert.equal((await db.one("SELECT valor FROM configuracoes WHERE chave = ?", "teste_rollback")).valor, "antes");
      await db.run("INSERT INTO estoque(variacao_id,loja_id,quantidade) VALUES (-1,?,1)", fixture.loja);
    }));
    assert.equal(await db.one("SELECT chave FROM configuracoes WHERE chave = ?", "teste_rollback"), undefined);
    assert.equal((await db.one("SELECT COUNT(*) AS n FROM produtos")).n, 1);
  });

  await test("configuracoes e contexto async em transacoes concorrentes", async () => {
    await db.salvarConfig("teste_contador", "0", "Teste de concorrencia");
    await Promise.all(Array.from({ length: 6 }, () => db.tx(async () => {
      const value = Number(await db.config("teste_contador"));
      await delay(5);
      await db.salvarConfig("teste_contador", String(value + 1));
      assert.equal(await db.config("teste_contador"), String(value + 1));
    })));
    assert.equal(await db.config("teste_contador"), "6");
    assert.equal(await db.config("teste_ausente", "padrao"), "padrao");
  });

  await test("sequencias existentes e numeracao concorrente", async () => {
    await db.run("INSERT INTO vendas(numero,loja_id) VALUES (?,?)", "V000042", fixture.loja);
    await db.run("INSERT INTO sequencias(nome,ultimo) VALUES ('venda',1) ON CONFLICT(nome) DO UPDATE SET ultimo = 1");
    assert.equal(await db.proximoNumero("venda", "V", 6, "vendas"), "V000043");
    const numbers = await Promise.all(Array.from({ length: 4 }, () => db.proximoNumero("venda", "V", 6, "vendas")));
    assert.deepEqual([...numbers].sort(), ["V000044", "V000045", "V000046", "V000047"]);
  });

  // Executa as Server Actions reais; apenas sessao e invalidacao Next sao substituidas.
  // O SQL, os helpers de banco e as regras comerciais continuam os mesmos da aplicacao.
  const source = await readFile(new URL("../app/actions/pdv.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const format = await import("../lib/format.ts");
  const pdv = {};
  const operator = { id: fixture.usuario, nome: "Administrador teste", papel: "admin", comissao_pct: 2 };
  new Function("require", "exports", compiled)((name) => {
    if (name === "@/lib/db") return db;
    if (name === "@/lib/format") return format;
    if (name === "next/cache") return { revalidatePath() {} };
    if (name === "@/lib/auth") return { exigir: async () => operator, verificarSenha: () => false };
    throw new Error(`Dependencia inesperada na action: ${name}`);
  }, pdv);
  const stock = async () => (await db.one("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", fixture.variacao, fixture.loja)).quantidade;
  const sale = (quantidade, valor = quantidade * 20, extra = {}) => pdv.finalizarVenda({
    itens: [{ variacao_id: fixture.variacao, quantidade, preco_unitario: 20, desconto_valor: 0 }],
    pagamentos: [{ forma_pagamento_id: fixture.pagamento, valor }],
    ...extra,
  });

  await test("buscas PostgreSQL por nome e codigo", async () => {
    assert.equal((await pdv.buscarItens("cabelo"))[0].variacao_id, fixture.variacao);
    assert.equal((await pdv.buscarPorCodigo("7890000000001")).variacao_id, fixture.variacao);
    assert.equal((await pdv.buscarClientes("CLIENTE"))[0].id, fixture.cliente);
  });

  await test("abertura concorrente cria somente um caixa", async () => {
    const results = await Promise.all([pdv.abrirCaixa(100), pdv.abrirCaixa(100)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await db.one("SELECT COUNT(*) AS n FROM caixas WHERE status='aberto'")).n, 1);
  });

  let venda;
  await test("venda persiste itens, pagamento, estoque e caixa", async () => {
    venda = await sale(2);
    assert.equal(venda.ok, true, venda.erro);
    assert.equal(venda.total, 40);
    assert.ok(venda.venda_id > 0);
    assert.equal(await stock(), 18);
    const resumo = await pdv.resumoCaixa((await pdv.caixaAberto()).id);
    assert.equal(resumo.esperadoDinheiro, 140);
    const metricas = await db.one("SELECT receita_acumulada, lucro_acumulado FROM vw_metricas_variacao WHERE variacao_id = ?", fixture.variacao);
    assert.equal(metricas.receita_acumulada, 40);
    assert.equal(metricas.lucro_acumulado, 20);
  });

  await test("pagamento insuficiente reverte venda inteira", async () => {
    const before = (await db.one("SELECT COUNT(*) AS n FROM vendas")).n;
    const result = await sale(1, 1);
    assert.equal(result.ok, false);
    assert.match(result.erro, /Pagamento insuficiente/);
    assert.equal(await stock(), 18);
    assert.equal((await db.one("SELECT COUNT(*) AS n FROM vendas")).n, before);
  });

  await test("cancelamento concorrente estorna estoque uma unica vez", async () => {
    const results = await Promise.all([pdv.cancelarVenda(venda.venda_id, "Teste"), pdv.cancelarVenda(venda.venda_id, "Repetida")]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await stock(), 20);
    const item = await db.one("SELECT id FROM vendas_itens WHERE venda_id = ?", venda.venda_id);
    const devolucao = await pdv.registrarDevolucao(venda.venda_id, [{ venda_item_id: item.id, quantidade: 1, destino: "estoque" }], "Venda cancelada");
    assert.equal(devolucao.ok, false);
    assert.equal(await stock(), 20);
  });

  await test("devolucoes parcial e concorrente respeitam quantidade vendida", async () => {
    const result = await sale(2);
    assert.equal(result.ok, true, result.erro);
    const item = await db.one("SELECT id FROM vendas_itens WHERE venda_id = ?", result.venda_id);
    const args = [result.venda_id, [{ venda_item_id: item.id, quantidade: 1, destino: "estoque" }], "Teste"];
    assert.equal((await pdv.registrarDevolucao(...args)).ok, true);
    assert.equal((await db.one("SELECT status FROM vendas WHERE id = ?", result.venda_id)).status, "devolvida_parcial");
    const returns = await Promise.all([pdv.registrarDevolucao(...args), pdv.registrarDevolucao(...args)]);
    assert.equal(returns.filter((response) => response.ok).length, 1);
    assert.equal((await db.one("SELECT status FROM vendas WHERE id = ?", result.venda_id)).status, "devolvida_total");
    assert.equal(await stock(), 20);
  });

  await test("fiado aplica vencimento PostgreSQL e impede ultrapassar limite", async () => {
    const extra = { cliente_id: fixture.cliente, pagamentos: [{ forma_pagamento_id: fixture.fiado, valor: 20 }] };
    const first = await sale(1, 20, extra);
    assert.equal(first.ok, true, first.erro);
    const entry = await db.one("SELECT valor, vencimento FROM fiado_lancamentos WHERE venda_id = ?", first.venda_id);
    assert.equal(entry.valor, 20);
    assert.match(entry.vencimento, /^\d{4}-\d{2}-\d{2}$/);
    const second = await sale(1, 20, extra);
    assert.equal(second.ok, false);
    assert.match(second.erro, /Limite de fiado/);
    assert.equal(await stock(), 19);
  });

  await test("vendas concorrentes nao vendem o mesmo saldo duas vezes", async () => {
    const results = await Promise.all([sale(15), sale(15)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.match(results.find((result) => !result.ok).erro, /Estoque insuficiente/);
    assert.equal(await stock(), 4);
  });

  await test("movimentos e fechamento de caixa persistem", async () => {
    assert.equal((await pdv.lancarMovimentoCaixa("suprimento", 10, "Teste")).ok, true);
    const aberto = await pdv.caixaAberto();
    const resumo = await pdv.resumoCaixa(aberto.id);
    const result = await pdv.fecharCaixa(resumo.esperadoDinheiro, "Teste PostgreSQL");
    assert.equal(result.ok, true);
    assert.equal(result.diferenca, 0);
    assert.equal(await pdv.caixaAberto(), undefined);
    assert.ok((await db.one("SELECT COUNT(*) AS n FROM auditoria")).n > 0);
  });

  console.log(`\nPOSTGRES OK: ${passed} verificacoes; banco temporario somente em memoria.`);
} catch (error) {
  console.error(`\nFALHA depois de ${passed} verificacoes:`, error);
  process.exitCode = 1;
} finally {
  if (db?.fecharDb) await db.fecharDb();
  for (const socket of sockets) socket.destroy();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await engine.close();
}
