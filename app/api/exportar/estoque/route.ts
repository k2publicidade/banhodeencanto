import { all } from "@/lib/db";
import { sessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Exporta a posicao de estoque em CSV (abre no Excel). */
export async function GET() {
  const u = await sessao();
  if (!u) return new Response("nao autorizado", { status: 401 });

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

  if (linhas.length === 0) return new Response("SKU;EAN\n", { headers: { "content-type": "text/csv; charset=utf-8" } });

  const cols = Object.keys(linhas[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv =
    "\uFEFF" +
    cols.join(";") +
    "\n" +
    linhas.map((l) => cols.map((c) => esc(l[c])).join(";")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="estoque-banho-de-encanto-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
