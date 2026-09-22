import { NextResponse } from "next/server";
import { all, one, config } from "@/lib/db";
import { sessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Detalhe da venda formatado para o cupom. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await sessao();
  if (!u) return NextResponse.json({ erro: "nao autorizado" }, { status: 401 });

  const { id } = await ctx.params;
  const v = await one<any>(
    `SELECT v.id, v.numero, v.data, v.subtotal, v.desconto_valor, v.desconto_pct, v.acrescimo, v.total,
            v.custo_total, v.status, v.observacoes,
            lo.nome AS loja, lo.razao_social, lo.cnpj, lo.endereco, lo.cidade, lo.uf, lo.telefone,
            uo.nome AS operador, uv.nome AS vendedor, c.nome AS cliente
     FROM vendas v
     LEFT JOIN lojas lo ON lo.id = v.loja_id
     LEFT JOIN usuarios uo ON uo.id = v.usuario_id
     LEFT JOIN usuarios uv ON uv.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.id = ?`, Number(id)
  );
  if (!v) return NextResponse.json({ erro: "venda nao encontrada" }, { status: 404 });

  const [itens, pagamentos, empresa, slogan, mensagem, larguraCupom, mostrarCnpj] = await Promise.all([
    all<any>(
      `SELECT vi.descricao, vi.quantidade, vi.preco_unitario, vi.desconto_valor, vi.total, vi.devolvido,
              vv.sku, vv.cor_codigo
       FROM vendas_itens vi LEFT JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
       WHERE vi.venda_id = ?`, Number(id)
    ),
    all<any>(
      `SELECT fp.nome AS forma, fp.tipo, vp.valor, vp.parcelas, vp.valor_recebido, vp.troco
       FROM vendas_pagamentos vp JOIN formas_pagamento fp ON fp.id = vp.forma_pagamento_id
       WHERE vp.venda_id = ?`, Number(id)
    ),
    config("empresa_nome", "Banho de Encanto"),
    config("empresa_slogan", "Cabelos Sinteticos"),
    config("cupom_mensagem", "Obrigado pela preferencia!"),
    config("cupom_impressora", "80mm"),
    config("cupom_mostrar_cnpj", "1"),
  ]);

  const troco = pagamentos.reduce((s, p) => s + Number(p.troco || 0), 0);
  const pecas = itens.reduce((s, i) => s + Number(i.quantidade), 0);

  return NextResponse.json({
    id: v.id,
    numero: v.numero,
    data: new Date(String(v.data).replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
    empresa,
    slogan,
    mensagem,
    larguraCupom,
    mostrarCnpj: mostrarCnpj === "1",
    cnpj: v.cnpj,
    endereco: [v.endereco, v.cidade, v.uf].filter(Boolean).join(" - "),
    telefone: v.telefone,
    operador: v.operador,
    vendedor: v.vendedor,
    cliente: v.cliente,
    subtotal: Number(v.subtotal),
    desconto_valor: Number(v.desconto_valor),
    desconto_pct: Number(v.desconto_pct),
    acrescimo: Number(v.acrescimo),
    total: Number(v.total),
    custo_total: Number(v.custo_total),
    status: v.status,
    troco,
    pecas,
    itens,
    pagamentos,
    codigoBarrasTexto: String(v.numero).padEnd(20, " "),
  });
}
