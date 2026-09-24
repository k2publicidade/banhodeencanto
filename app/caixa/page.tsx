import { exigir } from "@/lib/auth";
import { all, one, config } from "@/lib/db";
import { caixaAberto, resumoCaixa } from "@/app/actions/pdv";
import { listarEstoques, estoqueQueVende, estoqueDoCaixaAberto } from "@/lib/estoques";
import PdvCaixa from "./PdvCaixa";

export const dynamic = "force-dynamic";

export default async function PaginaCaixa() {
  const usuario = await exigir();

  const cx = await caixaAberto();
  const resumo = cx ? await resumoCaixa(cx.id) : { dinheiro: 0, esperadoDinheiro: 0, totalGeral: 0, qtd: 0, sangrias: 0, suprimentos: 0, abertura: 0 };

  // Estoque de onde este PDV vende: o do caixa aberto ou o estoque padrao.
  const [estoques, estoqueVendaId] = await Promise.all([listarEstoques(), cx?.loja_id ?? estoqueDoCaixaAberto()]);
  const vendaveis = estoques.filter((e) => e.eh_deposito === 0);
  const estoqueAtual = estoques.find((e) => e.loja_id === estoqueVendaId) ?? (await estoqueQueVende());
  const estoque = {
    id: estoqueAtual?.loja_id ?? estoqueVendaId,
    nome: estoqueAtual?.nome ?? "Estoque principal",
    eh_deposito: estoqueAtual?.eh_deposito ?? 0,
    opcoes: (vendaveis.length ? vendaveis : estoques).map((e) => ({ id: e.loja_id, nome: `${e.nome} — ${e.pecas} pecas` })),
  };

  const [formas, vendedores] = await Promise.all([
    all<{ id: number; nome: string; tipo: string; aceita_troco: number }>(
      "SELECT id, nome, tipo, aceita_troco FROM formas_pagamento WHERE ativo = 1 ORDER BY ordem, nome"
    ),
    all<{ id: number; nome: string; apelido: string | null; papel: string }>(
      `SELECT id, nome, apelido, papel FROM usuarios
       WHERE ativo = 1 AND papel IN ('admin','gerente','vendedor','operador')
       ORDER BY CASE papel WHEN 'vendedor' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END, nome`
    ),
  ]);

  const dia = await one<{ qtd: number; total: number; pecas: number }>(
    `SELECT COUNT(DISTINCT v.id) qtd, COALESCE(SUM(v.total),0) total,
            COALESCE((SELECT SUM(vi.quantidade) FROM vendas_itens vi WHERE vi.venda_id IN
              (SELECT id FROM vendas WHERE CAST(data AS DATE) = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AND status = 'concluida')),0) pecas
     FROM vendas v
     WHERE CAST(v.data AS DATE) = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AND v.status = 'concluida'`
  ) ?? { qtd: 0, total: 0, pecas: 0 };

  const cfg: Record<string, string> = {};
  for (const c of await all<{ chave: string; valor: string }>("SELECT chave, valor FROM configuracoes")) cfg[c.chave] = c.valor ?? "";

  return (
    <PdvCaixa
      usuario={{ id: usuario.id, nome: usuario.apelido || usuario.nome, papel: usuario.papel }}
      caixa={cx ? { id: cx.id, terminal: cx.terminal, abertura_em: cx.abertura_em, esperadoDinheiro: resumo.esperadoDinheiro } : null}
      estoque={estoque}
      formas={formas}
      vendedores={vendedores}
      config={cfg}
      resumoCaixa={{
        dinheiro: resumo.dinheiro, esperadoDinheiro: resumo.esperadoDinheiro, totalGeral: resumo.totalGeral,
        qtd: resumo.qtd, sangrias: resumo.sangrias, suprimentos: resumo.suprimentos, abertura: resumo.abertura,
      }}
      resumoDia={{ vendas: dia.qtd, total: dia.total, pecas: dia.pecas }}
    />
  );
}
