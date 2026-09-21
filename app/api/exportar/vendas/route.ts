import { all, one } from "@/lib/db";
import { sessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await sessao();
  if (!u) return new Response("nao autorizado", { status: 401 });

  const linhas = all<any>(
    `SELECT v.numero, v.data, COALESCE(c.nome,'Balcao') cliente, u.nome operador, uv.nome vendedor,
            v.subtotal, v.desconto_valor, v.acrescimo, v.total, v.custo_total,
            ROUND(v.total - v.custo_total, 2) lucro, v.status, v.motivo_cancelamento,
            (SELECT GROUP_CONCAT(fp.nome, ' + ') FROM vendas_pagamentos vp JOIN formas_pagamento fp ON fp.id = vp.forma_pagamento_id WHERE vp.venda_id = v.id) formas,
            (SELECT COALESCE(SUM(vi.quantidade),0) FROM vendas_itens vi WHERE vi.venda_id = v.id) pecas
     FROM vendas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN usuarios u ON u.id = v.usuario_id
     LEFT JOIN usuarios uv ON uv.id = v.vendedor_id
     ORDER BY v.id DESC LIMIT 20000`
  );

  const cols = ["numero", "data", "cliente", "operador", "vendedor", "formas", "pecas", "subtotal", "desconto_valor", "acrescimo", "total", "custo_total", "lucro", "status", "motivo_cancelamento"];
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(".", ",");
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "\uFEFF" + cols.join(";") + "\n" + linhas.map((l) => cols.map((c) => esc(l[c])).join(";")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vendas-banho-de-encanto-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
