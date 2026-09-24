import { all } from "@/lib/db";
import { sessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TIPOS = [
  "entrada", "venda", "saida", "ajuste", "devolucao",
  "transferencia_saida", "transferencia_entrada", "perda", "inventario", "cancelamento",
];

/** Exporta as movimentacoes de estoque em CSV (abre no Excel), com os mesmos filtros da tela. */
export async function GET(request: Request) {
  const u = await sessao();
  if (!u) return new Response("nao autorizado", { status: 401 });

  const url = new URL(request.url);
  const loja = Number(url.searchParams.get("estoque") || 0);
  const tipo = url.searchParams.get("tipo") || "";
  const busca = (url.searchParams.get("q") || "").trim();
  const dias = Math.min(Math.max(Number(url.searchParams.get("dias") || 30), 1), 3650);

  const condicoes: string[] = [
    `CAST(m.criado_em AS DATE) >= ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '${dias} days')::date`,
  ];
  const params: any[] = [];
  if (loja) { condicoes.push("m.loja_id = ?"); params.push(loja); }
  if (tipo && TIPOS.includes(tipo)) { condicoes.push("m.tipo = ?"); params.push(tipo); }
  if (busca) {
    condicoes.push("(v.sku ILIKE ? OR p.nome ILIKE ? OR m.motivo ILIKE ? OR m.documento ILIKE ?)");
    const l = "%" + busca + "%";
    params.push(l, l, l, l);
  }

  const linhas = await all<any>(
    `SELECT CAST(m.criado_em AS TEXT) criado_em, l.nome estoque,
            CASE WHEN l.eh_deposito = 1 THEN 'galpao' ELSE 'loja' END tipo_estoque,
            p.nome produto, v.sku, m.tipo, m.quantidade, m.saldo_anterior, m.saldo_apos,
            (m.saldo_apos - m.saldo_anterior) variacao_saldo,
            m.custo_unitario, m.documento, m.motivo, m.referencia_tipo, m.referencia_id, u.nome usuario
     FROM estoque_movimentos m
     JOIN variacoes v ON v.id = m.variacao_id
     JOIN produtos p ON p.id = v.produto_id
     JOIN lojas l ON l.id = m.loja_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE ${condicoes.join(" AND ")}
     ORDER BY m.id DESC`,
    ...params
  );

  const cols = linhas.length
    ? Object.keys(linhas[0])
    : ["criado_em", "estoque", "tipo_estoque", "produto", "sku", "tipo", "quantidade", "saldo_anterior", "saldo_apos", "variacao_saldo", "custo_unitario", "documento", "motivo", "referencia_tipo", "referencia_id", "usuario"];
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "\uFEFF" + cols.join(";") + "\n" + linhas.map((l) => cols.map((c) => esc(l[c])).join(";")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="movimentacoes-estoque-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
