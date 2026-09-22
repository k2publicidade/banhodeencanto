"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  salvarProduto, salvarVariacao, gerarVariacoes, ajustarPrecosProduto,
  aplicarEstoquePadrao, vincularFornecedor, removerVinculoFornecedor, excluirVariacao,
} from "./produtos";
import { run, tx } from "@/lib/db";
import { exigir } from "@/lib/auth";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function volta(idProduto: number, aba: string, msg?: string, erro?: string) {
  const p = new URLSearchParams({ aba });
  if (msg) p.set("msg", msg);
  if (erro) p.set("erro", erro);
  revalidatePath(`/produtos/${idProduto}`);
  redirect(`/produtos/${idProduto}?` + p.toString());
}

function voltaVariacao(idProduto: number, msg?: string, erro?: string) {
  const p = new URLSearchParams();
  if (msg) p.set("msg", msg);
  if (erro) p.set("erro", erro);
  revalidatePath(`/produtos/${idProduto}?aba=variacoes`);
  redirect(`/produtos/${idProduto}?aba=variacoes` + (p.toString() ? "&" + p.toString() : ""));
}

const inteiro = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || 0);

/* ------------------------------------------------------------------ */
/* Produto - blocos de cadastro                                        */
/* ------------------------------------------------------------------ */

export async function postSalvarBloco(form: FormData) {
  const id = inteiro(form.get("id_produto"));
  const aba = String(form.get("__aba") || "identificacao");
  const r = await salvarProduto(form, id || undefined);
  if (!r.ok) volta(id, aba, undefined, r.erro);
  volta(id || (r.id as number), aba, "Alteracoes salvas com sucesso.");
}

export async function postCriarProduto(form: FormData) {
  const r = await salvarProduto(form, undefined);
  if (!r.ok) redirect(`/produtos/novo?erro=${encodeURIComponent(r.erro || "Falha ao criar")}`);
  revalidatePath("/produtos");
  redirect(`/produtos/${r.id}?aba=variacoes&msg=${encodeURIComponent("Produto criado. Agora gere as variacoes por cor e comprimento.")}`);
}

/* ------------------------------------------------------------------ */
/* Variacoes                                                           */
/* ------------------------------------------------------------------ */

export async function postGerarVariacoes(form: FormData) {
  const produtoId = inteiro(form.get("id_produto"));
  const cores = form.getAll("cores").map((v) => Number(v)).filter(Boolean);
  const comps = form.getAll("comprimentos").map((v) => Number(v)).filter(Boolean);
  const custo = Number(String(form.get("custo_base") || "0").replace(",", "."));
  const markup = Number(String(form.get("markup") || "0").replace(",", "."));
  const r = await gerarVariacoes(produtoId, cores, comps, custo, markup);
  if (!r.ok) volta(produtoId, "variacoes", undefined, r.erro);
  volta(produtoId, "variacoes", `${r.criadas} variacao(oes) criada(s). ${r.ignoradas} combinacao(oes) ja existiam.`);
}

export async function postSalvarVariacao(form: FormData) {
  const produtoId = inteiro(form.get("id_produto"));
  const r = await salvarVariacao(form);
  if (!r.ok) volta(produtoId, "variacoes", undefined, r.erro);
  volta(produtoId, "variacoes", "SKU salvo.");
}

export async function postExcluirVariacao(form: FormData) {
  const produtoId = inteiro(form.get("id_produto"));
  const vid = inteiro(form.get("variacao_id"));
  const r = await excluirVariacao(vid);
  if (!r.ok) volta(produtoId, "variacoes", undefined, r.erro);
  volta(produtoId, "variacoes", "Variacao excluida.");
}

export async function postAjustarPrecos(form: FormData) {
  const produtoId = inteiro(form.get("id_produto"));
  const modo = String(form.get("modo") || "markup") as "percentual" | "margem" | "markup";
  const valor = Number(String(form.get("valor") || "0").replace(",", "."));
  const r = await ajustarPrecosProduto(produtoId, modo, valor);
  if (!r.ok) volta(produtoId, "precos", undefined, r.erro);
  const rotulo = modo === "percentual" ? `${valor}%` : modo === "margem" ? `margem ${valor}%` : `markup ${valor}x`;
  volta(produtoId, "precos", `${r.alterados} preco(s) atualizado(s) por ${rotulo}.`);
}

/* ------------------------------------------------------------------ */
/* Estoque                                                             */
/* ------------------------------------------------------------------ */

export async function postAplicarEstoque(form: FormData) {
  const produtoId = inteiro(form.get("id_produto"));
  const r = await aplicarEstoquePadrao(produtoId, form);
  if (!r.ok) volta(produtoId, "estoque", undefined, r.erro);
  volta(produtoId, "estoque", `Parametros aplicados em ${r.alterados} variacao(oes).`);
}

/* ------------------------------------------------------------------ */
/* Fornecedores                                                        */
/* ------------------------------------------------------------------ */

export async function postVincularFornecedor(form: FormData) {
  const produtoId = inteiro(form.get("produto_id"));
  const r = await vincularFornecedor(form);
  if (!r.ok) volta(produtoId, "fornecedores", undefined, r.erro);
  volta(produtoId, "fornecedores", "Fornecedor vinculado.");
}

export async function postRemoverFornecedor(form: FormData) {
  const produtoId = inteiro(form.get("produto_id"));
  await removerVinculoFornecedor(inteiro(form.get("vinculo_id")), produtoId);
  volta(produtoId, "fornecedores", "Vinculo removido.");
}

/* ------------------------------------------------------------------ */
/* Exclusao de produto                                                 */
/* ------------------------------------------------------------------ */

export async function postExcluirProduto(form: FormData) {
  const u = await exigir();
  const id = inteiro(form.get("id_produto"));
  if (u.papel !== "admin") redirect(`/produtos/${id}?erro=${encodeURIComponent("Somente o administrador pode excluir produtos.")}`);
  try {
    await tx(async () => {
      await run("DELETE FROM variacoes WHERE produto_id = ?", id);
      await run("DELETE FROM produtos WHERE id = ?", id);
    });
  } catch {
    redirect(`/produtos/${id}?erro=${encodeURIComponent("Nao foi possivel excluir: existem registros ligados a este produto.")}`);
  }
  revalidatePath("/produtos");
  redirect(`/produtos?msg=${encodeURIComponent("Produto excluido.")}`);
}
