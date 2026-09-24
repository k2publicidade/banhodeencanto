import { all } from "@/lib/db";
import { sessao } from "@/lib/auth";
import { rotuloCurto } from "@/lib/estoques";

export const dynamic = "force-dynamic";

/** Exporta a posicao de estoque em CSV (abre no Excel), com uma coluna de saldo por estoque. */
export async function GET() {
  const u = await sessao();
  if (!u) return new Response("nao autorizado", { status: 401 });

  const estoques = await all<{ loja_id: number; nome: string; apelido: string | null; eh_deposito: number }>(
    "SELECT loja_id, nome, apelido, eh_deposito FROM vw_estoques WHERE ativa = 1 ORDER BY eh_deposito, padrao DESC, nome"
  );

  const linhas = await all<any>(
    `SELECT sku, ean, produto, marca, linha, categoria, subcategoria, tipo_produto, material, fibra,
            textura, tecnica, cor, cor_codigo, comprimento, comprimento_unidade,
            custo_medio, preco_venda, ROUND(margem_percentual,2) margem_pct, ROUND(markup,3) markup,
            estoque, reservado, disponivel, estoque_min, estoque_max, ponto_reposicao,
            localizacao, corredor, prateleira, posicao, unidade_estoque,
            ROUND(estoque * custo_medio,2) valor_custo, ROUND(estoque * preco_venda,2) valor_venda, situacao_estoque
     FROM vw_estoque_posicao WHERE variacao_status = 'ativo'
     ORDER BY produto, cor_codigo, comprimento`
  );

  // Saldo de cada estoque por SKU (uma coluna por local no CSV)
  const mapa: Record<string, Record<number, number>> = {};
  if (estoques.length > 1) {
    const saldos = await all<any>("SELECT v.sku, e.loja_id, e.quantidade FROM estoque e JOIN variacoes v ON v.id = e.variacao_id");
    for (const s of saldos) (mapa[s.sku] ??= {})[s.loja_id] = Number(s.quantidade);
  }
  const colunasLocal = estoques.map((e) => ({ loja_id: e.loja_id, titulo: `saldo_${rotuloCurto(e)}` }));
  const registros = linhas.map((l) => {
    const row: any = { ...l };
    for (const c of colunasLocal) row[c.titulo] = mapa[l.sku]?.[c.loja_id] ?? 0;
    return row;
  });

  const cols = registros.length ? Object.keys(registros[0]) : ["sku", "ean", "produto"];
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv =
    "\uFEFF" +
    cols.join(";") +
    "\n" +
    registros.map((l) => cols.map((c) => esc(l[c])).join(";")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="estoque-banho-de-encanto-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
