import { exigir } from "@/lib/auth";
import { all, one, config } from "@/lib/db";
import { caixaAberto, resumoCaixa } from "@/app/actions/pdv";
import PdvCaixa from "./PdvCaixa";

export const dynamic = "force-dynamic";

export default async function PaginaCaixa() {
  const usuario = await exigir();

  const cx = await caixaAberto();
  const resumo = cx ? await resumoCaixa(cx.id) : { dinheiro: 0, esperadoDinheiro: 0, totalGeral: 0, qtd: 0, sangrias: 0, suprimentos: 0, abertura: 0 };

  const formas = all<{ id: number; nome: string; tipo: string; aceita_troco: number }>(
    "SELECT id, nome, tipo, aceita_troco FROM formas_pagamento WHERE ativo = 1 ORDER BY ordem, nome"
  );

  const vendedores = all<{ id: number; nome: string; apelido: string | null; papel: string }>(
    `SELECT id, nome, apelido, papel FROM usuarios
     WHERE ativo = 1 AND papel IN ('admin','gerente','vendedor','operador')
     ORDER BY CASE papel WHEN 'vendedor' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END, nome`
  );

  const dia = one<{ qtd: number; total: number; pecas: number }>(
    `SELECT COUNT(DISTINCT v.id) qtd, COALESCE(SUM(v.total),0) total,
            COALESCE((SELECT SUM(vi.quantidade) FROM vendas_itens vi WHERE vi.venda_id IN
              (SELECT id FROM vendas WHERE date(data) = date('now','localtime') AND status = 'concluida')),0) pecas
     FROM vendas v
     WHERE date(v.data) = date('now','localtime') AND v.status = 'concluida'`
  ) ?? { qtd: 0, total: 0, pecas: 0 };

  const cfg: Record<string, string> = {};
  for (const c of all<{ chave: string; valor: string }>("SELECT chave, valor FROM configuracoes")) cfg[c.chave] = c.valor ?? "";

  return (
    <PdvCaixa
      usuario={{ id: usuario.id, nome: usuario.apelido || usuario.nome, papel: usuario.papel }}
      caixa={cx ? { id: cx.id, terminal: cx.terminal, abertura_em: cx.abertura_em, esperadoDinheiro: resumo.esperadoDinheiro } : null}
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
