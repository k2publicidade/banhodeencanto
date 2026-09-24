/**
 * Estoques (locais de armazenagem) em um unico lugar.
 *
 * O sistema trabalha com VARIOS estoques separados: cada local (galpao /
 * centro de distribuicao, loja, filial) tem o proprio saldo por SKU, gravado em
 * `estoque(variacao_id, loja_id)`. Tudo que e "consolidado" no sistema soma os
 * locais (view vw_variacoes) e tudo que e "de um local" usa a view
 * vw_estoque_loja. A conversa entre os locais acontece por transferencia.
 */
import { all, one } from "./db";

export type Estoque = {
  loja_id: number;
  nome: string;
  apelido: string | null;
  razao_social: string | null;
  cnpj: string | null;
  inscricao_est: string | null;
  endereco: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  eh_deposito: number;
  padrao: number;
  ativa: number;
  cidade: string | null;
  uf: string | null;
  tipo: "loja" | "deposito";
  skus: number;
  pecas: number;
  valor_custo: number;
  valor_venda: number;
  transferencias: number;
};

/** Lista os estoques/locais. `incluirInativos` mostra tambem os desativados. */
export async function listarEstoques(incluirInativos = false): Promise<Estoque[]> {
  return await all<Estoque>(
    `SELECT * FROM vw_estoques
     ${incluirInativos ? "" : "WHERE ativa = 1"}
     ORDER BY eh_deposito, padrao DESC, nome`
  );
}

/** Estoque que vende no balcao (padrao=1). Cai no primeiro ativo se ninguem for marcado. */
export async function estoqueQueVende(): Promise<Estoque | undefined> {
  const lista = await listarEstoques();
  return lista.find((l) => l.padrao === 1 && l.eh_deposito === 0) ?? lista.find((l) => l.eh_deposito === 0) ?? lista[0];
}

/** Resolve o id de estoque vindo da tela (valida e cai no padrao quando vazio). */
export async function resolverEstoque(id?: number | string | null): Promise<number> {
  const n = Number(id);
  if (n > 0) {
    const existe = await one<{ id: number }>("SELECT id FROM lojas WHERE id = ?", n);
    if (existe) return existe.id;
  }
  return (await estoqueQueVende())?.loja_id ?? 1;
}

export async function nomeEstoque(id: number): Promise<string> {
  return (await one<{ nome: string }>("SELECT nome FROM lojas WHERE id = ?", id))?.nome ?? "—";
}

/**
 * Nome curto do estoque para usar em tabela/coluna/cartao: tira o nome da marca
 * ("Banho de Encanto - Matriz" -> "Matriz") e corta se ficar muito longo.
 */
export function rotuloCurto(e: { nome: string; apelido?: string | null }): string {
  const semMarca = String(e.nome ?? "").replace(/^banho de encanto\s*[-–]?\s*/i, "").trim();
  const base = semMarca.length ? semMarca : (e.apelido ?? "Estoque");
  return base.length > 16 ? base.slice(0, 15).trimEnd() + "." : base;
}

/**
 * Rotulo completo para cartao/titulo: diz o tipo (Loja / Galpao) sem repetir a
 * palavra quando o proprio nome do local ja explica ("Deposito Central").
 */
export function rotuloEstoque(e: { nome: string; apelido?: string | null; eh_deposito: number }): string {
  const curto = rotuloCurto(e);
  const jaDiz = /galp|depos|centro de distrib|estoque central|almox/i.test(curto);
  return jaDiz ? curto : `${e.eh_deposito === 1 ? "Galpao" : "Loja"} - ${curto}`;
}

export type ResumoEstoque = {
  skus: number;
  pecas: number;
  valor_custo: number;
  valor_venda: number;
  sem_estoque: number;
  criticos: number;
  repor: number;
};

/**
 * Resumo da posicao de estoque. Sem `lojaId` soma todos os locais (consolidado);
 * com `lojaId` mostra somente aquele estoque.
 */
export async function resumoEstoqueLocal(lojaId?: number | null): Promise<ResumoEstoque> {
  const vazio: ResumoEstoque = { skus: 0, pecas: 0, valor_custo: 0, valor_venda: 0, sem_estoque: 0, criticos: 0, repor: 0 };
  if (lojaId) {
    return (
      (await one<ResumoEstoque>(
        `SELECT COUNT(*) skus,
                COALESCE(SUM(quantidade),0) pecas,
                COALESCE(SUM(quantidade * custo_medio),0) valor_custo,
                COALESCE(SUM(quantidade * preco_venda),0) valor_venda,
                SUM(CASE WHEN situacao_estoque='sem_estoque' THEN 1 ELSE 0 END) sem_estoque,
                SUM(CASE WHEN situacao_estoque='critico' THEN 1 ELSE 0 END) criticos,
                SUM(CASE WHEN situacao_estoque='repor' THEN 1 ELSE 0 END) repor
         FROM vw_estoque_loja WHERE variacao_status = 'ativo' AND loja_id = ?`,
        lojaId
      )) ?? vazio
    );
  }
  return (
    (await one<ResumoEstoque>(
      `SELECT COUNT(*) skus,
              COALESCE(SUM(estoque),0) pecas,
              COALESCE(SUM(estoque * custo_medio),0) valor_custo,
              COALESCE(SUM(estoque * preco_venda),0) valor_venda,
              SUM(CASE WHEN situacao_estoque='sem_estoque' THEN 1 ELSE 0 END) sem_estoque,
              SUM(CASE WHEN situacao_estoque='critico' THEN 1 ELSE 0 END) criticos,
              SUM(CASE WHEN situacao_estoque='repor' THEN 1 ELSE 0 END) repor
       FROM vw_estoque_posicao WHERE variacao_status = 'ativo'`
    )) ?? vazio
  );
}

export type SaldoLocal = { loja_id: number; loja: string; eh_deposito: number; quantidade: number; disponivel: number };

/** Saldos de um SKU em cada estoque (usado na transferencia e no PDV). */
export async function saldosDoSku(variacaoId: number): Promise<SaldoLocal[]> {
  return await all<SaldoLocal>(
    `SELECT e.loja_id, l.nome loja, l.eh_deposito, e.quantidade, e.disponivel
     FROM estoque e JOIN lojas l ON l.id = e.loja_id
     WHERE e.variacao_id = ? ORDER BY l.eh_deposito, l.nome`,
    variacaoId
  );
}

/** Id do estoque (loja) do caixa aberto; sem caixa aberto cai no estoque que vende. */
export async function estoqueDoCaixaAberto(): Promise<number> {
  const cx = await one<{ loja_id: number }>(
    "SELECT loja_id FROM caixas WHERE status = 'aberto' ORDER BY id DESC LIMIT 1"
  );
  if (cx?.loja_id) return cx.loja_id;
  return (await estoqueQueVende())?.loja_id ?? 1;
}
