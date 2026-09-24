"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, one, run, tx, proximoNumero, auditar } from "@/lib/db";
import { arred, parseMoeda } from "@/lib/format";
import { exigir } from "@/lib/auth";

const inteiro = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || 0);
const texto = (v: FormDataEntryValue | null) => {
  const s = v === null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const num = (v: FormDataEntryValue | number | null, padrao = 0) => {
  if (v === null || v === "") return padrao;
  const n = parseMoeda(String(v));
  return Number.isFinite(n) ? n : padrao;
};

async function lojaPadrao(): Promise<number> {
  return (await one<{ id: number }>("SELECT id FROM lojas WHERE padrao = 1 LIMIT 1"))?.id ?? 1;
}

/* ================================================================== */
/* Movimentacao manual de estoque                                      */
/* ================================================================== */

export async function lancarEstoque(form: FormData) {
  const u = await exigir();
  const variacaoId = inteiro(form.get("variacao_id"));
  const tipo = String(form.get("tipo") || "entrada") as
    | "entrada" | "saida" | "ajuste" | "perda" | "inventario" | "transferencia_saida" | "transferencia_entrada";
  const quantidade = num(form.get("quantidade"));
  const motivo = texto(form.get("motivo")) ?? "Lancamento manual";
  const documento = texto(form.get("documento"));
  const custo = form.get("custo") === "" || form.get("custo") === null ? null : num(form.get("custo"));
  const lojaId = inteiro(form.get("loja_id")) || await lojaPadrao();

  if (!variacaoId) return { ok: false, erro: "Selecione o SKU." };
  if (quantidade <= 0 && tipo !== "inventario" && tipo !== "ajuste") return { ok: false, erro: "Informe uma quantidade maior que zero." };

  let produtoId = 0;
  try {
    await tx(async () => {
      const v = await one<any>("SELECT id, sku, produto_id, custo_medio FROM variacoes WHERE id = ?", variacaoId);
      if (!v) throw new Error("SKU nao encontrado.");
      produtoId = v.produto_id;
      const est = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", variacaoId, lojaId);
      const antes = est?.quantidade ?? 0;

      let depois = antes;
      let qtdMov = quantidade;
      if (tipo === "entrada" || tipo === "transferencia_entrada") depois = antes + quantidade;
      else if (tipo === "saida" || tipo === "perda" || tipo === "transferencia_saida") depois = antes - quantidade;
      else if (tipo === "inventario" || tipo === "ajuste") {
        depois = quantidade;             // no inventario a quantidade informada E o novo saldo
        qtdMov = Math.abs(quantidade - antes);
      }

      if (depois < 0 && tipo !== "ajuste" && tipo !== "inventario") {
        throw new Error(`Saldo insuficiente: existem ${antes} unidades de ${v.sku}.`);
      }

      if (est) {
        await run("UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE variacao_id = ? AND loja_id = ?", depois, variacaoId, lojaId);
      } else {
        await run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", variacaoId, lojaId, depois);
      }

      // Entrada recalcula o custo medio ponderado (metodo da media ponderada)
      if ((tipo === "entrada" || tipo === "transferencia_entrada") && custo !== null && custo > 0 && depois > 0) {
        const novoCusto = arred(((antes * Number(v.custo_medio)) + (quantidade * custo)) / depois);
        await run("UPDATE variacoes SET custo_medio = ?, ultimo_custo = ?, custo_aquisicao = ? WHERE id = ?", novoCusto, custo, custo, variacaoId);
      }

      await run(
        `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
           custo_unitario, documento, motivo, referencia_tipo, usuario_id)
         VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?)`,
        variacaoId, lojaId, tipo, qtdMov, antes, depois, custo ?? Number(v.custo_medio), documento, motivo, u.id
      );

      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "mov_estoque", entidade: "variacoes", entidade_id: variacaoId, detalhe: `${tipo} ${qtdMov} -> ${depois}` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha no lancamento." };
  }

  revalidatePath("/estoque");
  revalidatePath(`/produtos/${produtoId}`);
  return { ok: true };
}

export async function acaoLancarEstoque(form: FormData) {
  const r = await lancarEstoque(form);
  const volta = String(form.get("__volta") || "/estoque");
  if (!r.ok) redirect(`${volta}?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`${volta}?msg=${encodeURIComponent("Estoque atualizado.")}`);
}

/* ================================================================== */
/* Transferencia entre estoques (documento numerado, varias SKUs)      */
/* ================================================================== */

export type ItemTransferencia = { variacao_id: number; quantidade: number };

/** Le os itens do formulario (varios SKUs) somando linhas repetidas. */
function itensDaTransferencia(form: FormData): ItemTransferencia[] {
  const ids = form.getAll("variacao_id").map((v) => inteiro(v));
  const qtds = form.getAll("quantidade").map((v) => num(v));
  const mapa = new Map<number, number>();
  ids.forEach((id, i) => {
    const q = qtds[i] ?? 0;
    if (!id || !(q > 0)) return;
    mapa.set(id, arred((mapa.get(id) ?? 0) + q));
  });
  return [...mapa.entries()].map(([variacao_id, quantidade]) => ({ variacao_id, quantidade }));
}

/**
 * Soma (ou subtrai) quantidade num estoque e grava o movimento.
 * Centraliza tudo: quem chama nunca mexe em `estoque` na mao.
 */
async function movimentarLocal(opts: {
  variacaoId: number;
  lojaId: number;
  delta: number;
  tipo: "transferencia_saida" | "transferencia_entrada";
  motivo: string;
  documento: string;
  referenciaId: number;
  usuarioId: number;
  custo: number;
}) {
  const est = await one<{ quantidade: number }>(
    "SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?",
    opts.variacaoId, opts.lojaId
  );
  const antes = Number(est?.quantidade ?? 0);
  const depois = arred(antes + opts.delta);
  if (est) {
    await run(
      `UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')
       WHERE variacao_id = ? AND loja_id = ?`,
      depois, opts.variacaoId, opts.lojaId
    );
  } else {
    await run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", opts.variacaoId, opts.lojaId, depois);
  }
  await run(
    `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
       custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
     VALUES (?,?,?,?,?,?,?,?,?, 'transferencia', ?, ?)`,
    opts.variacaoId, opts.lojaId, opts.tipo, Math.abs(opts.delta), antes, depois,
    opts.custo, opts.documento, opts.motivo, opts.referenciaId, opts.usuarioId
  );
  return { antes, depois };
}

/** Dados da transferencia (o formulario e a API usam o mesmo caminho). */
export type DadosTransferencia = {
  loja_origem: number;
  loja_destino: number;
  observacoes?: string | null;
  itens: ItemTransferencia[];
};

/** Cria a transferencia e ja movimenta os dois estoques (uma unica transacao). */
export async function transferirEstoque(
  dados: DadosTransferencia
): Promise<{ ok: true; id: number; numero: string; itens: number; pecas: number } | { ok: false; erro: string }> {
  const u = await exigir();
  const origem = inteiro(String(dados.loja_origem ?? 0));
  const destino = inteiro(String(dados.loja_destino ?? 0));
  const observacoes = dados.observacoes ? String(dados.observacoes).trim() : null;
  const itens = (dados.itens ?? [])
    .map((i) => ({ variacao_id: inteiro(String(i.variacao_id ?? 0)), quantidade: num(i.quantidade) }))
    .filter((i) => i.variacao_id > 0 && i.quantidade > 0);

  if (!origem || !destino) return { ok: false, erro: "Escolha o estoque de origem e o de destino." };
  if (origem === destino) return { ok: false, erro: "Origem e destino precisam ser estoques diferentes." };
  if (itens.length === 0) return { ok: false, erro: "Adicione ao menos um produto com quantidade." };

  let resultado: { id: number; numero: string; itens: number; pecas: number } | null = null;
  try {
    resultado = await tx(async () => {
      const lo = await one<any>("SELECT id, nome, ativa FROM lojas WHERE id = ?", origem);
      const ld = await one<any>("SELECT id, nome, ativa FROM lojas WHERE id = ?", destino);
      if (!lo || !ld) throw new Error("Estoque nao encontrado.");
      if (!lo.ativa || !ld.ativa) throw new Error("Um dos estoques esta desativado. Ative antes de transferir.");

      const numero = await proximoNumero("transferencia", "TRF-", 5, "transferencias");
      const r = await run(
        `INSERT INTO transferencias(numero, loja_origem, loja_destino, data, status, observacoes, usuario_id, usuario_nome, criado_em)
         VALUES (?,?,?, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'),
                 'concluida', ?, ?, ?, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')) RETURNING id`,
        numero, origem, destino, observacoes, u.id, u.nome
      );
      const transferenciaId = Number(r.lastInsertRowid);

      let pecas = 0;
      let valor = 0;
      for (const it of itens) {
        const v = await one<any>(
          `SELECT v.id, v.sku, v.produto_id, v.custo_medio, p.nome produto
             FROM variacoes v JOIN produtos p ON p.id = v.produto_id
            WHERE v.id = ?`,
          it.variacao_id
        );
        if (!v) throw new Error("SKU " + it.variacao_id + " nao encontrado.");
        const custo = Number(v.custo_medio ?? 0);

        const saldo = await one<{ quantidade: number }>(
          "SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", it.variacao_id, origem
        );
        const tem = Number(saldo?.quantidade ?? 0);
        if (tem < it.quantidade) {
          throw new Error(
            `Saldo insuficiente em ${lo.nome}: ${v.produto} (${v.sku ?? "sem SKU"}) tem ${num(tem)} e a transferencia pede ${num(it.quantidade)}.`
          );
        }

        await run(
          "INSERT INTO transferencias_itens(transferencia_id, variacao_id, quantidade, custo_unitario) VALUES (?,?,?,?)",
          transferenciaId, it.variacao_id, it.quantidade, custo
        );
        await movimentarLocal({
          variacaoId: it.variacao_id, lojaId: origem, delta: -it.quantidade, tipo: "transferencia_saida",
          motivo: `Transferencia para ${ld.nome}`, documento: numero, referenciaId: transferenciaId,
          usuarioId: u.id, custo,
        });
        await movimentarLocal({
          variacaoId: it.variacao_id, lojaId: destino, delta: it.quantidade, tipo: "transferencia_entrada",
          motivo: `Transferencia de ${lo.nome}`, documento: numero, referenciaId: transferenciaId,
          usuarioId: u.id, custo,
        });

        pecas += it.quantidade;
        valor += it.quantidade * custo;
      }

      await run(
        "UPDATE transferencias SET itens = ?, pecas = ?, valor_custo = ? WHERE id = ?",
        itens.length, arred(pecas), arred(valor), transferenciaId
      );
      await auditar({
        usuario_id: u.id, usuario_nome: u.nome, acao: "transferencia", entidade: "transferencias",
        entidade_id: transferenciaId,
        detalhe: `${numero} | ${lo.nome} -> ${ld.nome} | ${itens.length} SKU(s) | ${arred(pecas)} peca(s)`,
      });
      return { id: transferenciaId, numero, itens: itens.length, pecas: arred(pecas) };
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha na transferencia." };
  }

  revalidatePath("/estoque");
  revalidatePath("/estoque/transferencia");
  revalidatePath("/estoque/movimentos");
  revalidatePath("/painel");
  return { ok: true, ...resultado };
}

export async function acaoCriarTransferencia(form: FormData) {
  const r = await transferirEstoque({
    loja_origem: inteiro(form.get("loja_origem")),
    loja_destino: inteiro(form.get("loja_destino")),
    observacoes: texto(form.get("observacoes")),
    itens: itensDaTransferencia(form),
  });
  if (!r.ok) redirect(`/estoque/transferencia?erro=${encodeURIComponent(r.erro || "Falha na transferencia.")}`);
  redirect(`/estoque/transferencia?msg=${encodeURIComponent(`Transferencia ${r.numero} concluida: ${r.pecas} peca(s) movimentada(s).`)}&destaque=${r.id}`);
}

/** Cancela a transferencia e estorna as duas pontas (nao deixa saldo negativo). */
export async function cancelarTransferencia(transferenciaId: number, motivo: string) {
  const u = await exigir();
  if (u.papel !== "admin" && u.papel !== "gerente") {
    return { ok: false, erro: "Somente administrador ou gerente pode cancelar uma transferencia." };
  }

  try {
    await tx(async () => {
      const t = await one<any>("SELECT * FROM transferencias WHERE id = ?", transferenciaId);
      if (!t) throw new Error("Transferencia nao encontrada.");
      if (t.status !== "concluida") throw new Error("Esta transferencia ja foi cancelada.");

      const itens = await all<any>(
        `SELECT ti.variacao_id, ti.quantidade, ti.custo_unitario, v.sku, p.nome produto
         FROM transferencias_itens ti
         JOIN variacoes v ON v.id = ti.variacao_id
         JOIN produtos p ON p.id = v.produto_id
         WHERE ti.transferencia_id = ?`,
        transferenciaId
      );
      const origem = await one<any>("SELECT nome FROM lojas WHERE id = ?", t.loja_origem);
      const destino = await one<any>("SELECT nome FROM lojas WHERE id = ?", t.loja_destino);

      // Confere antes de estornar: se o destino ja consumiu, o cancelamento
      // deixaria saldo negativo e o estoque viraria ficcao.
      for (const it of itens) {
        const d = await one<{ quantidade: number }>(
          "SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", it.variacao_id, t.loja_destino
        );
        const tem = Number(d?.quantidade ?? 0);
        if (tem < it.quantidade) {
          throw new Error(
            `Nao da para cancelar: ${it.produto} (${it.sku}) ja saiu de ${destino?.nome} ` +
            `(restam ${num(tem)} de ${num(it.quantidade)}). Faca um ajuste de estoque.`
          );
        }
      }

      for (const it of itens) {
        await movimentarLocal({
          variacaoId: it.variacao_id, lojaId: t.loja_destino, delta: -it.quantidade, tipo: "transferencia_saida",
          motivo: `Cancelamento da transferencia ${t.numero}`, documento: t.numero, referenciaId: t.id,
          usuarioId: u.id, custo: Number(it.custo_unitario ?? 0),
        });
        await movimentarLocal({
          variacaoId: it.variacao_id, lojaId: t.loja_origem, delta: it.quantidade, tipo: "transferencia_entrada",
          motivo: `Cancelamento da transferencia ${t.numero}`, documento: t.numero, referenciaId: t.id,
          usuarioId: u.id, custo: Number(it.custo_unitario ?? 0),
        });
      }

      await run(
        `UPDATE transferencias SET status='cancelada',
           cancelada_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),
           cancelada_por_id = ?, motivo_cancelamento = ?
         WHERE id = ?`,
        u.id, motivo || "Nao informado", transferenciaId
      );
      await auditar({
        usuario_id: u.id, usuario_nome: u.nome, acao: "cancelar_transferencia", entidade: "transferencias",
        entidade_id: transferenciaId, detalhe: `${t.numero}: ${origem?.nome} <- ${destino?.nome} | ${motivo || "sem motivo"}`,
      });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao cancelar a transferencia." };
  }

  revalidatePath("/estoque");
  revalidatePath("/estoque/transferencia");
  revalidatePath("/estoque/movimentos");
  return { ok: true };
}

export async function acaoCancelarTransferencia(form: FormData) {
  const id = inteiro(form.get("transferencia_id"));
  const motivo = String(form.get("motivo") || "").trim();
  const r = await cancelarTransferencia(id, motivo);
  if (!r.ok) redirect(`/estoque/transferencia?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`/estoque/transferencia?msg=${encodeURIComponent("Transferencia cancelada e estoque estornado nas duas pontas.")}`);
}

/** Saldos do SKU em cada estoque (a tela de transferencia usa ao escolher o item). */
export async function saldosDoItem(variacaoId: number) {
  await exigir();
  const id = inteiro(String(variacaoId));
  if (!id) return [];
  return await all<{ loja_id: number; loja: string; eh_deposito: number; quantidade: number; disponivel: number }>(
    `SELECT e.loja_id, l.nome loja, l.eh_deposito, e.quantidade, e.disponivel
     FROM estoque e JOIN lojas l ON l.id = e.loja_id
     WHERE e.variacao_id = ? ORDER BY l.eh_deposito, l.nome`,
    id
  );
}

/* ================================================================== */
/* Gestao dos estoques (padrao de venda, ativar/desativar)             */
/* ================================================================== */

/** Define qual estoque abastece o PDV (o que "vende"). */
export async function definirEstoquePadrao(lojaId: number) {
  const u = await exigir();
  if (u.papel !== "admin" && u.papel !== "gerente") {
    return { ok: false, erro: "Somente administrador ou gerente pode definir o estoque que vende." };
  }
  try {
    await tx(async () => {
      const l = await one<any>("SELECT id, nome, eh_deposito, ativa FROM lojas WHERE id = ?", lojaId);
      if (!l) throw new Error("Estoque nao encontrado.");
      if (!l.ativa) throw new Error("Ative o estoque antes de definir como padrao.");
      if (l.eh_deposito === 1) throw new Error("Deposito/galpao nao vende no balcao: marque um estoque do tipo loja.");
      await run("UPDATE lojas SET padrao = CASE WHEN id = ? THEN 1 ELSE 0 END", lojaId);
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "definir_estoque_padrao", entidade: "lojas", entidade_id: lojaId, detalhe: l.nome });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao definir o estoque padrao." };
  }
  revalidatePath("/estoque");
  revalidatePath("/configuracoes/lojas");
  revalidatePath("/caixa");
  return { ok: true };
}

export async function acaoDefinirEstoquePadrao(form: FormData) {
  const id = inteiro(form.get("loja_id"));
  const r = await definirEstoquePadrao(id);
  if (!r.ok) redirect(`/configuracoes/lojas?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`/configuracoes/lojas?msg=${encodeURIComponent("Estoque de venda atualizado.")}`);
}

/** Liga/desliga um estoque. Nunca deixa o sistema sem estoque que vende. */
export async function alternarEstoqueAtivo(form: FormData) {
  const u = await exigir();
  if (u.papel !== "admin" && u.papel !== "gerente") {
    redirect(`/configuracoes/lojas?erro=${encodeURIComponent("Somente administrador ou gerente pode ativar/desativar estoque.")}`);
  }
  const id = inteiro(form.get("loja_id"));
  const ativo = inteiro(form.get("ativo")) === 1 ? 1 : 0;
  try {
    await tx(async () => {
      const l = await one<any>("SELECT id, nome, padrao FROM lojas WHERE id = ?", id);
      if (!l) throw new Error("Estoque nao encontrado.");
      if (!ativo) {
        const outros = await one<{ n: number }>("SELECT COUNT(*) n FROM lojas WHERE ativa = 1 AND id <> ?", id);
        if (Number(outros?.n ?? 0) === 0) throw new Error("O sistema precisa de ao menos um estoque ativo.");
        if (l.padrao === 1) throw new Error("Este e o estoque que vende no PDV. Defina outro como padrao antes de desativar.");
      }
      await run("UPDATE lojas SET ativa = ? WHERE id = ?", ativo, id);
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: ativo ? "ativar_estoque" : "desativar_estoque", entidade: "lojas", entidade_id: id, detalhe: l.nome });
    });
  } catch (e: any) {
    redirect(`/configuracoes/lojas?erro=${encodeURIComponent(e?.message || "Falha")}`);
  }
  revalidatePath("/estoque");
  revalidatePath("/configuracoes/lojas");
  redirect(`/configuracoes/lojas?msg=${encodeURIComponent("Estoque atualizado.")}`);
}

/* ================================================================== */
/* Compras                                                             */
/* ================================================================== */

export async function criarCompra(form: FormData) {
  const u = await exigir();
  const fornecedorId = inteiro(form.get("fornecedor_id"));
  if (!fornecedorId) return { ok: false, erro: "Selecione o fornecedor." };

  const variacoes = form.getAll("variacao_id").map((v) => inteiro(v));
  const quantidades = form.getAll("quantidade").map((v) => num(v));
  const custos = form.getAll("custo_unitario").map((v) => num(v));

  const itens = variacoes
    .map((vid, i) => ({ variacao_id: vid, quantidade: quantidades[i] ?? 0, custo_unitario: custos[i] ?? 0 }))
    .filter((i) => i.variacao_id && i.quantidade > 0);

  if (itens.length === 0) return { ok: false, erro: "Adicione ao menos um item com quantidade." };

  const frete = num(form.get("frete"));
  const desconto = num(form.get("desconto"));
  const subtotal = arred(itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0));
  const total = arred(subtotal + frete - desconto);

  try {
    const id = await tx(async () => {
      const numero = await proximoNumero("compra", "CMP-", 5, "compras");
      const r = await run(
        `INSERT INTO compras(numero, fornecedor_id, loja_id, data, documento, status, subtotal, frete, desconto, total, observacoes, usuario_id)
         VALUES (?,?,?,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'),?,'rascunho',?,?,?,?,?,?) RETURNING id`,
        numero, fornecedorId, inteiro(form.get("loja_id")) || await lojaPadrao(), texto(form.get("documento")),
        subtotal, frete, desconto, total, texto(form.get("observacoes")), u.id
      );
      const compraId = Number(r.lastInsertRowid);
      for (const it of itens) {
        await run(
          "INSERT INTO compras_itens(compra_id, variacao_id, quantidade, custo_unitario, total) VALUES (?,?,?,?,?)",
          compraId, it.variacao_id, it.quantidade, it.custo_unitario, arred(it.quantidade * it.custo_unitario)
        );
      }
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "criar", entidade: "compras", entidade_id: compraId, detalhe: `${numero} R$ ${total}` });
      return compraId;
    });
    revalidatePath("/compras");
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao criar a compra." };
  }
}

/** Confirma a compra: da entrada no estoque e recalcula o custo medio. */
export async function confirmarCompra(compraId: number) {
  const u = await exigir();

  try {
    await tx(async () => {
      const c = await one<any>("SELECT id, numero, loja_id, status, frete FROM compras WHERE id = ?", compraId);
      if (!c) throw new Error("Compra nao encontrada.");
      if (c.status === "confirmado") throw new Error("Compra ja confirmada.");

      const itens = await all<any>(
        `SELECT ci.variacao_id, ci.quantidade, ci.custo_unitario, v.custo_medio, v.sku, v.produto_id
         FROM compras_itens ci JOIN variacoes v ON v.id = ci.variacao_id WHERE ci.compra_id = ?`,
        compraId
      );
      for (const it of itens) {
        const est = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", it.variacao_id, c.loja_id);
        const antes = est?.quantidade ?? 0;
        const depois = antes + it.quantidade;
        if (est) await run("UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE variacao_id = ? AND loja_id = ?", depois, it.variacao_id, c.loja_id);
        else await run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", it.variacao_id, c.loja_id, depois);

        // custo medio ponderado
        const novoCusto = depois > 0 ? arred(((antes * Number(it.custo_medio)) + (it.quantidade * Number(it.custo_unitario))) / depois) : Number(it.custo_unitario);
        await run("UPDATE variacoes SET custo_medio = ?, ultimo_custo = ?, custo_aquisicao = ? WHERE id = ?", novoCusto, it.custo_unitario, it.custo_unitario, it.variacao_id);

        await run(
          `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
             custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
           VALUES (?,?, 'entrada', ?,?,?,?,?,?, 'compra', ?,?)`,
          it.variacao_id, c.loja_id, it.quantidade, antes, depois, it.custo_unitario, c.numero, "Entrada por compra", compraId, u.id
        );

        await run(
          `UPDATE produto_fornecedor SET ultima_compra = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'), ultimo_custo_compra = ?
           WHERE produto_id = ? AND (variacao_id = ? OR variacao_id IS NULL)`,
          it.custo_unitario, it.produto_id, it.variacao_id
        );
      }

      await run("UPDATE compras SET status='confirmado', confirmado_em=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE id = ?", compraId);
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "confirmar_compra", entidade: "compras", entidade_id: compraId, detalhe: c.numero });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao confirmar a compra." };
  }
  revalidatePath("/compras");
  revalidatePath("/estoque");
  return { ok: true };
}

export async function cancelarCompra(compraId: number) {
  const u = await exigir();
  const resultado = await tx(async () => {
    const c = await one<any>("SELECT id, numero, status FROM compras WHERE id = ?", compraId);
    if (!c) return { ok: false, erro: "Compra nao encontrada." };
    if (c.status === "confirmado") return { ok: false, erro: "Compra ja confirmada nao pode ser cancelada. Faca um ajuste de estoque." };
    await run("UPDATE compras SET status='cancelado' WHERE id = ?", compraId);
    await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "cancelar_compra", entidade: "compras", entidade_id: compraId });
    return { ok: true };
  });
  if (!resultado.ok) return resultado;
  revalidatePath("/compras");
  return resultado;
}

export async function acaoConfirmarCompra(form: FormData) {
  const id = inteiro(form.get("compra_id"));
  const r = await confirmarCompra(id);
  if (!r.ok) redirect(`/compras?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`/compras?msg=${encodeURIComponent("Compra confirmada e estoque atualizado.")}`);
}

export async function acaoCancelarCompra(form: FormData) {
  const id = inteiro(form.get("compra_id"));
  const r = await cancelarCompra(id);
  if (!r.ok) redirect(`/compras?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`/compras?msg=${encodeURIComponent("Compra cancelada.")}`);
}

export async function acaoCriarCompra(form: FormData) {
  const r = await criarCompra(form);
  if (!r.ok) redirect(`/compras/nova?erro=${encodeURIComponent(r.erro || "Falha")}`);
  redirect(`/compras?msg=${encodeURIComponent("Compra criada como rascunho. Confirme para dar entrada no estoque.")}`);
}
