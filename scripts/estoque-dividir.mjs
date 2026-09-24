/**
 * Divide o estoque de uma loja com o galpao (centro de distribuicao).
 *
 * Por que existe: quando o sistema passa a controlar DOIS estoques separados
 * (galpao + loja), o banco que ja existia tem todo o saldo num unico local.
 * Este script faz a divisao usando transferencias de verdade - nada e digitado
 * nem inventado: o que sai da loja entra no galpao, com documento TRF-xxxxx,
 * movimentos nas duas pontas e historico.
 *
 * Uso:
 *   node scripts/estoque-dividir.mjs                        # so mostra o que faria
 *   node scripts/estoque-dividir.mjs --confirmar            # grava (padrao: 60% para o galpao)
 *   node scripts/estoque-dividir.mjs --confirmar --percentual=70
 *   node scripts/estoque-dividir.mjs --confirmar --banco=data/apresentacao.db
 *
 * Seguranca: nunca roda duas vezes no mesmo banco sem --refazer e ao final
 * confere que a soma das pecas continua a mesma (nada criado do nada).
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { dividirEstoque, sincronizarSequenciaTransferencia } from "./_dividir-estoque.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const arg = (nome, padrao = null) => {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto ? bruto.slice(nome.length + 3) : padrao;
};
const confirmar = process.argv.includes("--confirmar");
const refazer = process.argv.includes("--refazer");
const percentual = Math.min(Math.max(Number(arg("percentual", "60")) / 100, 0.05), 0.95);
const banco = resolve(arg("banco", join(root, "data", "banho.db")));

if (!existsSync(banco)) {
  console.error(`Banco nao encontrado: ${banco}`);
  process.exit(1);
}

const db = new DatabaseSync(banco);
db.exec("PRAGMA foreign_keys = ON;");
// Garante as tabelas/views novas (transferencias) sem apagar nada
db.exec(readFileSync(join(root, "lib", "schema.sql"), "utf8"));

const local = (id) => db.prepare("SELECT id, nome, eh_deposito, padrao, ativa FROM lojas WHERE id = ?").get(id);
const resumo = (id) =>
  db.prepare(
    `SELECT COUNT(DISTINCT e.variacao_id) skus, COALESCE(SUM(e.quantidade),0) pecas,
            COALESCE(SUM(e.quantidade * v.custo_medio),0) valor
       FROM estoque e JOIN variacoes v ON v.id = e.variacao_id WHERE e.loja_id = ?`
  ).get(id);
const pecasTotais = () => db.prepare("SELECT COALESCE(SUM(quantidade),0) s FROM estoque").get().s;

// ---------------------------------------------------------------- origem
let origem = Number(arg("origem", 0)) || db.prepare("SELECT id FROM lojas WHERE ativa = 1 AND eh_deposito = 0 AND padrao = 1 LIMIT 1").get()?.id
  || db.prepare("SELECT id FROM lojas WHERE ativa = 1 AND eh_deposito = 0 ORDER BY id LIMIT 1").get()?.id;
if (!origem) {
  console.error("Nenhuma loja cadastrada para servir de origem.");
  process.exit(1);
}

// ---------------------------------------------------------------- destino
let destino = Number(arg("destino", 0)) || db.prepare("SELECT id FROM lojas WHERE eh_deposito = 1 ORDER BY id LIMIT 1").get()?.id;
if (!destino) {
  if (!confirmar) {
    console.log("Nao existe galpao (deposito) cadastrado. Com --confirmar o script cria um:");
    console.log("  Galpao / Centro de Distribuicao");
  }
  if (confirmar) {
    const r = db.prepare("INSERT INTO lojas(nome, apelido, eh_deposito, padrao, ativa) VALUES (?,?,1,0,1)")
      .run("Galpao / Centro de Distribuicao", "GALPAO");
    destino = Number(r.lastInsertRowid);
    console.log(`Galpao criado (id ${destino}).`);
  } else {
    process.exit(0);
  }
}

const lo = local(origem);
const ld = local(destino);
if (!lo || !ld || origem === destino) {
  console.error("Origem/destino invalidos.");
  process.exit(1);
}

const antesOrigem = resumo(origem);
const antesDestino = resumo(destino);
const antesTotal = pecasTotais();

console.log("Estoques");
console.log(`  origem .: ${lo.nome}${lo.eh_deposito ? " (galpao)" : ""} - ${antesOrigem.pecas} pecas, R$ ${Number(antesOrigem.valor).toFixed(2)} a custo`);
console.log(`  destino : ${ld.nome}${ld.eh_deposito ? " (galpao)" : ""} - ${antesDestino.pecas} pecas, R$ ${Number(antesDestino.valor).toFixed(2)} a custo`);
console.log(`  divisao : ${(percentual * 100).toFixed(0)}% do saldo de cada SKU vai para o destino (origem nunca fica zerada)`);

const jaTemTransferencia = Number(db.prepare("SELECT COUNT(*) n FROM transferencias").get().n);
if (jaTemTransferencia > 0 && !refazer) {
  console.log(`\nEste banco ja tem ${jaTemTransferencia} transferencia(s) registrada(s).`);
  console.log("Se quiser dividir de novo (movendo outro tanto do saldo atual), rode com --refazer.");
  process.exit(0);
}

if (!confirmar) {
  const previa = db.prepare(
    `SELECT COUNT(*) skus, COALESCE(SUM(CAST(e.quantidade * ? AS INTEGER)),0) pecas
       FROM estoque e WHERE e.loja_id = ? AND e.quantidade >= 3`
  ).get(percentual, origem);
  console.log(`\nSIMULACAO (sem gravar nada): ${previa.skus} SKU(s), cerca de ${previa.pecas} peca(s) para o destino.`);
  console.log("Para gravar: node scripts/estoque-dividir.mjs --confirmar");
  process.exit(0);
}

// Backup antes de escrever (arquivo ao lado do banco)
const backup = `${banco}.antes-da-divisao-${new Date().toISOString().slice(0, 10)}.bak`;
if (!existsSync(backup)) {
  copyFileSync(banco, backup);
  console.log(`\nBackup do banco: ${backup}`);
}

const r = dividirEstoque(db, {
  origemId: origem,
  destinoId: destino,
  percentualMovido: percentual,
  loteMax: 15,
  usuarioId: db.prepare("SELECT id FROM usuarios WHERE papel = 'admin' ORDER BY id LIMIT 1").get()?.id ?? null,
  usuarioNome: "Administrador",
  observacao: "Transferencia de abertura do galpao",
});
sincronizarSequenciaTransferencia(db);

const depoisOrigem = resumo(origem);
const depoisDestino = resumo(destino);
const depoisTotal = pecasTotais();

console.log("\nDepois da divisao");
console.log(`  ${lo.nome}: ${depoisOrigem.pecas} pecas (${depoisOrigem.skus} SKUs)`);
console.log(`  ${ld.nome}: ${depoisDestino.pecas} pecas (${depoisDestino.skus} SKUs)`);
console.log(`  Transferencias criadas: ${r.documentos} documento(s) ${r.numeros.slice(0, 3).join(", ")}${r.numeros.length > 3 ? " ..." : ""}`);
console.log(`  Pecas movimentadas: ${r.pecas} | valor a custo R$ ${r.valor.toFixed(2)}`);

if (Number(antesTotal) !== Number(depoisTotal)) {
  console.error(`\nERRO: o total de pecas mudou (${antesTotal} -> ${depoisTotal}). Restaure o backup: ${backup}`);
  process.exit(1);
}
console.log(`\nConfere: total de pecas continua ${depoisTotal} (nada criado nem perdido). OK`);

const criticos = db.prepare(
  `SELECT COUNT(*) n FROM estoque e JOIN variacoes v ON v.id = e.variacao_id
    WHERE e.loja_id = ? AND v.estoque_min > 0 AND e.quantidade <= v.estoque_min`
).get(origem).n;
console.log(`SKUs abaixo do minimo na origem (para demonstrar a reposicao): ${criticos}`);
console.log("Agora a tela /estoque/transferencia mostra o que falta na loja e o que tem no galpao.");
db.close();
