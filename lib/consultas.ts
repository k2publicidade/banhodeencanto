import { all, one } from "./db";

/* ================================================================== */
/* Resumos de venda                                                    */
/* ================================================================== */

export function resumoPeriodo(dias = 30) {
  return (
    one<{ vendas: number; receita: number; custo: number; lucro: number; pecas: number }>(
      `SELECT COUNT(*) vendas,
              COALESCE(SUM(total),0) receita,
              COALESCE(SUM(custo_total),0) custo,
              COALESCE(SUM(total - custo_total),0) lucro,
              COALESCE((SELECT SUM(vi.quantidade) FROM vendas_itens vi JOIN vendas v2 ON v2.id = vi.venda_id
                        WHERE v2.status='concluida' AND date(v2.data) >= date('now','localtime','-${dias} days')),0) pecas
       FROM vendas
       WHERE status = 'concluida' AND date(data) >= date('now','localtime','-${dias} days')`
    ) ?? { vendas: 0, receita: 0, custo: 0, lucro: 0, pecas: 0 }
  );
}

export function resumoHoje() {
  return (
    one<{ vendas: number; receita: number; lucro: number }>(
      `SELECT COUNT(*) vendas, COALESCE(SUM(total),0) receita, COALESCE(SUM(total - custo_total),0) lucro
       FROM vendas WHERE status='concluida' AND date(data) = date('now','localtime')`
    ) ?? { vendas: 0, receita: 0, lucro: 0 }
  );
}

export function resumoEstoque() {
  return (
    one<{ skus: number; pecas: number; valor_custo: number; valor_venda: number; sem_estoque: number; criticos: number; repor: number }>(
      `SELECT COUNT(*) skus,
              COALESCE(SUM(estoque),0) pecas,
              COALESCE(SUM(estoque * custo_medio),0) valor_custo,
              COALESCE(SUM(estoque * preco_venda),0) valor_venda,
              SUM(CASE WHEN situacao_estoque='sem_estoque' THEN 1 ELSE 0 END) sem_estoque,
              SUM(CASE WHEN situacao_estoque='critico' THEN 1 ELSE 0 END) criticos,
              SUM(CASE WHEN situacao_estoque='repor' THEN 1 ELSE 0 END) repor
       FROM vw_estoque_posicao WHERE variacao_status = 'ativo'`
    ) ?? { skus: 0, pecas: 0, valor_custo: 0, valor_venda: 0, sem_estoque: 0, criticos: 0, repor: 0 }
  );
}

/* ================================================================== */
/* Series e rankings                                                   */
/* ================================================================== */

export function vendasPorDia(dias = 30) {
  const linhas = all<{ dia: string; total: number; qtd: number }>(
    `SELECT date(data) dia, COALESCE(SUM(total),0) total, COUNT(*) qtd
     FROM vendas WHERE status='concluida' AND date(data) >= date('now','localtime','-${dias - 1} days')
     GROUP BY date(data) ORDER BY dia`
  );
  const mapa = new Map(linhas.map((l) => [l.dia, l]));
  const saida: { rotulo: string; valor: number; qtd: number; dia: string }[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const r = mapa.get(iso);
    saida.push({
      dia: iso,
      rotulo: String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"),
      valor: r?.total ?? 0,
      qtd: r?.qtd ?? 0,
    });
  }
  return saida;
}

export function topProdutos(dias = 30, limite = 10) {
  return all<{ produto: string; skus: number; pecas: number; receita: number; lucro: number; margem: number }>(
    `SELECT vv.produto,
            COUNT(DISTINCT vv.variacao_id) skus,
            SUM(vi.quantidade) pecas,
            SUM(vi.total) receita,
            SUM(vi.total - vi.quantidade * vi.custo_unitario) lucro,
            CASE WHEN SUM(vi.total) > 0
                 THEN SUM(vi.total - vi.quantidade * vi.custo_unitario) * 100.0 / SUM(vi.total) END margem
     FROM vendas_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY vv.produto_id
     ORDER BY receita DESC
     LIMIT ?`,
    limite
  );
}

export function topVariacoes(dias = 30, limite = 15) {
  return all<any>(
    `SELECT vv.sku, vv.produto, vv.cor_codigo, vv.cor, vv.comprimento, vv.comprimento_unidade,
            SUM(vi.quantidade) pecas, SUM(vi.total) receita,
            SUM(vi.total - vi.quantidade * vi.custo_unitario) lucro,
            vv.estoque, vv.disponivel, vv.situacao_estoque
     FROM vendas_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN vw_estoque_posicao vv ON vv.variacao_id = vi.variacao_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY vi.variacao_id
     ORDER BY receita DESC LIMIT ?`,
    limite
  );
}

export function corQueMaisGira(dias = 90, limite = 8) {
  return all<any>(
    `SELECT vv.cor, vv.cor_codigo, vv.cor_hex, vv.cor_familia,
            SUM(vi.quantidade) pecas, SUM(vi.total) receita
     FROM vendas_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
     WHERE v.status='concluida' AND vv.cor_codigo IS NOT NULL
       AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY vv.cor_id
     ORDER BY pecas DESC LIMIT ?`,
    limite
  );
}

export function investimentoPorLinha() {
  return all<any>(
    `SELECT COALESCE(vv.linha,'(sem linha)') linha,
            COUNT(*) skus,
            SUM(vv.estoque) pecas,
            SUM(vv.estoque * vv.custo_medio) custo,
            SUM(vv.estoque * vv.preco_venda) venda,
            AVG(vv.margem_percentual) margem
     FROM vw_estoque_posicao vv
     WHERE vv.variacao_status='ativo'
     GROUP BY COALESCE(vv.linha,'(sem linha)')
     ORDER BY custo DESC`
  );
}

export function curvaABC(dias = 90) {
  const base = all<{ variacao_id: number; sku: string; produto: string; cor_codigo: string | null; receita: number }>(
    `SELECT vi.variacao_id, vv.sku, vv.produto, vv.cor_codigo, SUM(vi.total) receita
     FROM vendas_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY vi.variacao_id
     ORDER BY receita DESC`
  );
  const total = base.reduce((s, b) => s + b.receita, 0);
  let acumulado = 0;
  return base.map((b) => {
    const pct = total > 0 ? (b.receita / total) * 100 : 0;
    acumulado += pct;
    return {
      ...b,
      pct,
      acumulado,
      classe: acumulado <= 80 ? "A" : acumulado <= 95 ? "B" : "C",
    };
  });
}

export function alertasEstoque(limite = 12) {
  return all<any>(
    `SELECT * FROM vw_estoque_posicao
     WHERE variacao_status='ativo' AND situacao_estoque IN ('sem_estoque','critico','repor')
     ORDER BY CASE situacao_estoque WHEN 'sem_estoque' THEN 0 WHEN 'critico' THEN 1 ELSE 2 END,
              disponivel ASC
     LIMIT ?`,
    limite
  );
}

export function ultimasVendas(limite = 10) {
  return all<any>(
    `SELECT v.id, v.numero, v.data, v.total, v.status, c.nome cliente, u.nome operador,
            (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id = v.id) itens
     FROM vendas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN usuarios u ON u.id = v.usuario_id
     ORDER BY v.id DESC LIMIT ?`,
    limite
  );
}

export function fiadoAberto() {
  return all<any>(
    `SELECT c.id, c.nome, c.telefone, c.limite_credito,
            COALESCE(SUM(CASE WHEN f.tipo='compra' THEN f.valor ELSE -f.valor END),0) saldo,
            MAX(f.data) ultimo
     FROM clientes c
     JOIN fiado_lancamentos f ON f.cliente_id = c.id
     GROUP BY c.id
     HAVING saldo > 0.01
     ORDER BY saldo DESC`
  );
}

/** Comparativo de custo do mesmo SKU entre fornecedores (quem vende mais barato) */
export function fornecedoresComparativo(variacaoId: number) {
  return all<any>(
    `SELECT f.id, f.nome_fantasia, f.razao_social, pf.codigo_fornecedor, pf.custo,
            pf.qtd_minima_compra, pf.multiplo_compra, pf.prazo_entrega_dias, pf.ultima_compra, pf.principal
     FROM produto_fornecedor pf
     JOIN fornecedores f ON f.id = pf.fornecedor_id
     WHERE pf.variacao_id = ?
     ORDER BY pf.custo ASC`,
    variacaoId
  );
}

export function caixaAbertoResumo() {
  const cx = one<any>(
    `SELECT c.id, c.terminal, c.abertura_em, c.valor_abertura, u.nome operador
     FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.status='aberto' ORDER BY c.id DESC LIMIT 1`
  );
  if (!cx) return null;
  const mov = one<any>(
    `SELECT COALESCE(SUM(CASE WHEN tipo='venda' THEN valor ELSE 0 END),0) vendas,
            COALESCE(SUM(CASE WHEN tipo='venda' THEN 1 ELSE 0 END),0) qtd,
            COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0) sangrias,
            COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0) suprimentos,
            COALESCE(SUM(CASE WHEN tipo='venda' AND forma_pagamento_id IN
              (SELECT id FROM formas_pagamento WHERE tipo='dinheiro') THEN valor ELSE 0 END),0) dinheiro
     FROM caixa_movimentos WHERE caixa_id = ?`,
    cx.id
  );
  const esperado = Number(cx.valor_abertura) + Number(mov.dinheiro) + Number(mov.suprimentos) - Number(mov.sangrias);
  return { ...cx, ...mov, esperado };
}

/* ================================================================== */
/* Listas auxiliares para selects                                      */
/* ================================================================== */

export function opcoesSimples(tabela: string, ordem = "nome") {
  return all<{ id: number; nome: string }>(`SELECT id, nome FROM ${tabela} WHERE ativo = 1 ORDER BY ${ordem}`);
}

export function listaFiltros() {
  return {
    marcas: opcoesSimples("marcas"),
    categoriasPai: all<{ id: number; nome: string }>("SELECT id, nome FROM categorias WHERE pai_id IS NULL ORDER BY nome"),
    subcategorias: all<{ id: number; nome: string; pai_id: number }>("SELECT id, nome, pai_id FROM categorias WHERE pai_id IS NOT NULL ORDER BY nome"),
    cores: all<{ id: number; nome: string; codigo: string; hex: string; familia: string }>(
      "SELECT id, nome, codigo, hex, familia FROM cores WHERE ativo=1 ORDER BY ordem, nome"
    ),
    texturas: opcoesSimples("texturas"),
    comprimentos: all<{ id: number; valor: number; unidade: string; rotulo: string }>(
      "SELECT id, valor, unidade, COALESCE(rotulo, valor || ' ' || unidade) rotulo FROM comprimentos WHERE ativo=1 ORDER BY ordem, valor"
    ),
    tiposProduto: opcoesSimples("tipos_produto"),
    materiais: opcoesSimples("materiais"),
    fibras: opcoesSimples("tipos_fibra"),
    tecnicas: opcoesSimples("tecnicas"),
    publicos: opcoesSimples("publicos"),
    linhas: opcoesSimples("linhas_colecao"),
    fornecedores: all<{ id: number; nome: string; razao_social: string }>(
      "SELECT id, nome_fantasia nome, razao_social FROM fornecedores WHERE ativo=1 ORDER BY nome_fantasia"
    ),
    unidades: all<{ sigla: string; nome: string }>("SELECT sigla, nome FROM unidades_medida ORDER BY sigla"),
  };
}
