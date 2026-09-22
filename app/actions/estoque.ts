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
const num = (v: FormDataEntryValue | null, padrao = 0) => {
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

export async function acaoTransferir(form: FormData) {
  const u = await exigir();
  const variacaoId = inteiro(form.get("variacao_id"));
  const origem = inteiro(form.get("loja_origem"));
  const destino = inteiro(form.get("loja_destino"));
  const quantidade = num(form.get("quantidade"));
  const volta = (msg?: string, erro?: string): never => {
    const p = new URLSearchParams();
    if (msg) p.set("msg", msg);
    if (erro) p.set("erro", erro);
    const q = p.toString();
    redirect("/configuracoes/lojas" + (q ? "?" + q : ""));
  };

  if (!variacaoId || !origem || !destino || origem === destino) return volta(undefined, "Origem e destino devem ser diferentes.");
  if (quantidade <= 0) return volta(undefined, "Informe a quantidade.");

  try {
    await tx(async () => {
      const eo = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", variacaoId, origem);
      const antes = eo?.quantidade ?? 0;
      if (antes < quantidade) throw new Error(`Saldo insuficiente na origem (${antes} unidades).`);
      await run("UPDATE estoque SET quantidade = quantidade - ? WHERE variacao_id = ? AND loja_id = ?", quantidade, variacaoId, origem);
      const ed = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", variacaoId, destino);
      if (ed) await run("UPDATE estoque SET quantidade = quantidade + ? WHERE variacao_id = ? AND loja_id = ?", quantidade, variacaoId, destino);
      else await run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", variacaoId, destino, quantidade);

      await run(
        `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos, motivo, referencia_tipo, usuario_id)
         VALUES (?,?, 'transferencia_saida', ?,?,?,?,'transferencia',?)`,
        variacaoId, origem, quantidade, antes, antes - quantidade, `Transferencia para unidade ${destino}`, u.id
      );
      await run(
        `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos, motivo, referencia_tipo, usuario_id)
         VALUES (?,?, 'transferencia_entrada', ?,?,?,?,'transferencia',?)`,
        variacaoId, destino, quantidade, ed?.quantidade ?? 0, (ed?.quantidade ?? 0) + quantidade, `Transferencia da unidade ${origem}`, u.id
      );
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "transferencia", entidade: "variacoes", entidade_id: variacaoId, detalhe: `${quantidade} de ${origem} para ${destino}` });
    });
  } catch (e: any) {
    return volta(undefined, e?.message || "Falha na transferencia.");
  }
  revalidatePath("/estoque");
  revalidatePath("/configuracoes/lojas");
  return volta(`${quantidade} unidade(s) transferida(s).`);
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
