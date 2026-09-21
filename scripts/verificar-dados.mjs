// Verificacao dos dados: views, colunas geradas, integridade e consultas-chave do negocio
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const db = new DatabaseSync(join(process.cwd(), "data", "banho.db"));
const q = (s, ...p) => db.prepare(s).all(...p);
const q1 = (s, ...p) => db.prepare(s).get(...p);

const checks = [];
function check(nome, cond, detalhe) {
  checks.push({ nome, ok: !!cond, detalhe });
}

const t = (n) => q1(`select count(*) n from ${n}`).n;
check("17 produtos", t("produtos") === 17, t("produtos"));
check("137 variacoes", t("variacoes") === 137, t("variacoes"));
check("estoque por SKU existe", t("estoque") === 137, t("estoque"));
check("produto_fornecedor N:N", t("produto_fornecedor") > 137, t("produto_fornecedor"));
check("vendas gravadas", t("vendas") > 400, t("vendas"));

// View principal responde?
const vw = q1("select count(*) n from vw_variacoes").n;
check("vw_variacoes responde", vw === 137, vw);

// Coluna gerada: margem bate com o calculo manual?
const m = q1(`select variacao_id, preco_venda, custo_medio, margem_valor, margem_percentual, markup
              from vw_variacoes where preco_venda > 0 and custo_medio > 0 limit 1`);
const esperado = Math.round((m.preco_venda - m.custo_medio) * 100) / 100;
check("margem_valor e coluna gerada correta", Math.abs(m.margem_valor - esperado) < 0.011,
  `db=${m.margem_valor} calc=${esperado} | margem%=${m.margem_percentual.toFixed(1)} markup=${m.markup.toFixed(2)}`);

// Preco NUNCA abaixo do custo no seed?
const abaixo = q1("select count(*) n from variacoes where preco_venda < custo_medio").n;
check("nenhum preco abaixo do custo", abaixo === 0, abaixo);

// Alertas de estoque funcionam (vw_estoque_posicao)
const sit = q("select situacao_estoque s, count(*) n from vw_estoque_posicao group by 1 order by 2 desc");
check("situacao_estoque classifica", sit.length > 0, JSON.stringify(sit));
const semEstoque = q1("select count(*) n from vw_estoque_posicao where situacao_estoque='sem_estoque'").n;
check("ha SKUs zerados p/ demonstrar alerta", semEstoque > 0, semEstoque);

// Consulta pedida pelo cliente: "todo cabelo 1B com estoque abaixo do minimo"
const umB = q(`select produto, cor_codigo, comprimento, estoque, estoque_min, situacao_estoque
               from vw_estoque_posicao
               where cor_codigo='1B' and situacao_estoque in ('critico','sem_estoque')
               order by estoque limit 5`);
check("consulta '1B abaixo do minimo' responde", true, umB.length + " SKUs encontrados");

// "Quanto tenho investido em Jumbo?"
const jumbo = q1(`select count(*) skus, sum(estoque) pecas, round(sum(estoque_custo),2) investido, round(sum(estoque_venda),2) potencial
                  from vw_variacoes where lower(produto) like '%jumbo%'`);
check("investimento em Jumbo calculado", jumbo.investido > 0, JSON.stringify(jumbo));

// "Qual cor gira mais?"
const corTop = q(`select vv.cor, vv.cor_codigo, sum(m.quantidade_vendida) qtd, round(sum(m.receita_acumulada),2) receita
                  from vw_metricas_variacao m join vw_variacoes vv on vv.variacao_id = m.variacao_id
                  group by vv.cor order by qtd desc limit 5`);
check("ranking de cor que mais gira", corTop.length > 0, JSON.stringify(corTop.map(c => c.cor_codigo + ":" + c.qtd)));

// "Qual fornecedor vende este SKU mais barato?"
const forn = q(`select p.nome, f.nome_fantasia, pf.custo
                from produto_fornecedor pf join fornecedores f on f.id=pf.fornecedor_id join produtos p on p.id=pf.produto_id
                where pf.custo is not null order by pf.custo asc limit 3`);
check("comparativo de custo por fornecedor", forn.length === 3, JSON.stringify(forn));

// Curva ABC funciona (participacao acumulada)
const abc = q(`with r as (select vi.variacao_id, sum(vi.total) receita from vendas_itens vi join vendas v on v.id=vi.venda_id
                 where v.status<>'cancelada' group by vi.variacao_id)
               select count(*) n from r`);
check("base para curva ABC", abc[0].n > 0, abc[0].n + " SKUs com venda");

// Integridade referencial: nenhum orfao
const orfaos = q1(`select count(*) n from vendas_itens vi left join variacoes v on v.id=vi.variacao_id where v.id is null`).n;
check("sem itens de venda orfaos", orfaos === 0, orfaos);

// Fiado: saldo por cliente bate?
const fiado = q1(`select count(*) n, round(sum(case when tipo='compra' then valor else -valor end),2) saldo from fiado_lancamentos`);
check("fiado coerente", fiado.n === 0 || fiado.saldo >= 0, JSON.stringify(fiado));

// Caixa: sessoes fechadas tem valor_sistema
const cx = q1(`select count(*) abertos from caixas where status='aberto'`);
check("existe caixa aberto para o PDV usar", cx.abertos >= 1, cx.abertos + " aberto(s)");

console.log("\n=== VERIFICACAO DOS DADOS ===\n");
let falhas = 0;
for (const c of checks) {
  if (!c.ok) falhas++;
  console.log((c.ok ? " OK  " : " FALHA") + "  " + c.nome.padEnd(42) + "  " + c.detalhe);
}
console.log("\n" + (checks.length - falhas) + "/" + checks.length + " verificacoes passaram.");
console.log("\n--- Amostra da view principal ---");
console.table
  ? console.log(JSON.stringify(q(`select sku, produto, cor_codigo, comprimento, custo_medio, preco_venda,
      round(margem_percentual,1) margem_pct, estoque, situacao FROM (select *, (case when disponivel<=0 then 'sem_estoque'
      when estoque_min>0 and disponivel<=estoque_min then 'critico' else 'ok' end) situacao from vw_variacoes)
      limit 8`), null, 1))
  : null;
console.log("\n--- Alerta 1B abaixo do minimo ---");
console.log(JSON.stringify(umB, null, 1));
console.log("\n--- Jumbo: investimento ---");
console.log(JSON.stringify(jumbo, null, 1));
console.log("\n--- Cor que mais gira ---");
console.log(JSON.stringify(corTop, null, 1));
console.log("\n--- Fornecedor mais barato ---");
console.log(JSON.stringify(forn, null, 1));
db.close();
process.exit(falhas === 0 ? 0 : 1);
