import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, pct, num, dataBR } from "@/lib/format";
import {
  resumoPeriodo, vendasPorDia, topProdutos, topVariacoes, corQueMaisGira,
  investimentoPorLinha, curvaABC, alertasEstoque, fiadoAberto,
} from "@/lib/consultas";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Kpi, Grade, GraficoBarras, Barra, CorBolinha, SituacaoEstoque, CampoSelect, Campo, Linha } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaginaRelatorios({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  await exigir();
  const sp = await searchParams;
  const dias = [7, 15, 30, 60, 90, 180, 365].includes(Number(sp.dias)) ? Number(sp.dias) : 30;

  const periodo = resumoPeriodo(dias);
  const serie = vendasPorDia(Math.min(dias, 60));
  const top = topProdutos(dias, 12);
  const topSku = topVariacoes(dias, 15);
  const cores = corQueMaisGira(dias, 10);
  const linhas = investimentoPorLinha();
  const abc = curvaABC(dias);
  const alertas = alertasEstoque(30);
  const fiado = fiadoAberto();

  const porForma = all<any>(
    `SELECT fp.nome forma, fp.tipo, COUNT(*) qtd, SUM(vp.valor) valor,
            SUM(vp.parcelas) parcelas
     FROM vendas_pagamentos vp
     JOIN vendas v ON v.id = vp.venda_id
     JOIN formas_pagamento fp ON fp.id = vp.forma_pagamento_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY fp.id ORDER BY valor DESC`
  );

  const porOperador = all<any>(
    `SELECT u.nome operador, u.papel, COUNT(*) vendas, SUM(v.total) total,
            SUM(v.total - v.custo_total) lucro, AVG(v.total) ticket
     FROM vendas v JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY u.id ORDER BY total DESC`
  );

  const porVendedor = all<any>(
    `SELECT COALESCE(u.apelido, u.nome) vendedor, COUNT(*) vendas, SUM(v.total) total,
            SUM(v.total - v.custo_total) lucro,
            SUM(v.total * COALESCE(u.comissao_pct,0) / 100.0) comissao
     FROM vendas v JOIN usuarios u ON u.id = v.vendedor_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY u.id ORDER BY total DESC`
  );

  const porMarca = all<any>(
    `SELECT COALESCE(vv.marca,'(sem marca)') marca, COUNT(DISTINCT vi.variacao_id) skus,
            SUM(vi.quantidade) pecas, SUM(vi.total) receita,
            SUM(vi.total - vi.quantidade*vi.custo_unitario) lucro
     FROM vendas_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY vv.marca ORDER BY receita DESC`
  );

  const porDiaSemana = all<any>(
    `SELECT CAST(strftime('%w', v.data) AS INTEGER) dow, COUNT(*) vendas, SUM(v.total) total
     FROM vendas v WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY dow ORDER BY dow`
  );
  const nomesDow = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

  const semVenda = all<any>(
    `SELECT vv.sku, vv.produto, vv.cor_codigo, vv.comprimento, vv.comprimento_unidade,
            vv.estoque, vv.estoque_custo, vv.preco_venda,
            (SELECT MAX(v.data) FROM vendas_itens vi JOIN vendas v ON v.id=vi.venda_id
             WHERE vi.variacao_id = vv.variacao_id AND v.status<>'cancelada') ultima_venda
     FROM vw_estoque_posicao vv
     WHERE vv.variacao_status='ativo' AND vv.estoque > 0
       AND NOT EXISTS (SELECT 1 FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
                       WHERE vi.variacao_id = vv.variacao_id AND v.status<>'cancelada'
                         AND date(v.data) >= date('now','localtime','-${dias} days'))
     ORDER BY vv.estoque_custo DESC LIMIT 25`
  );

  const topClientes = all<any>(
    `SELECT c.nome, COUNT(*) compras, SUM(v.total) total, AVG(v.total) ticket
     FROM vendas v JOIN clientes c ON c.id = v.cliente_id
     WHERE v.status='concluida' AND date(v.data) >= date('now','localtime','-${dias} days')
     GROUP BY c.id ORDER BY total DESC LIMIT 12`
  );

  const fornecedoresBaratos = all<any>(
    `SELECT p.nome produto, vv.sku, f.nome_fantasia fornecedor, pf.custo, vv.custo_medio,
            ROUND((vv.custo_medio - pf.custo) * 100.0 / NULLIF(vv.custo_medio,0), 1) economia_pct
     FROM produto_fornecedor pf
     JOIN fornecedores f ON f.id = pf.fornecedor_id
     JOIN variacoes vv ON vv.id = pf.variacao_id
     JOIN produtos p ON p.id = pf.produto_id
     WHERE pf.custo IS NOT NULL AND vv.custo_medio > 0 AND pf.custo < vv.custo_medio
     ORDER BY economia_pct DESC LIMIT 20`
  );

  const totalAbc = abc.reduce((s, a) => s + a.receita, 0);
  const classeA = abc.filter((a) => a.classe === "A");

  return (
    <>
      <Cabecalho
        titulo="Relatorios"
        subtitulo={`Analise dos ultimos ${dias} dias • ${periodo.vendas} vendas • ${moeda(periodo.receita)}`}
        acoes={
          <>
            <Grade colunas={1} gap={0}>
              <form method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ width: 150 }}>
                  <label htmlFor="dias">Periodo</label>
                  <select id="dias" name="dias" defaultValue={String(dias)}>
                    {[7, 15, 30, 60, 90, 180, 365].map((d) => (
                      <option key={d} value={d}>Ultimos {d} dias</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primario" type="submit">Aplicar</button>
              </form>
            </Grade>
          </>
        }
      />

      <Conteudo>
        <Grade colunas={5}>
          <Kpi rotulo="Faturamento" valor={moeda(periodo.receita)} detalhe={`${periodo.vendas} vendas`} variante="teal" />
          <Kpi rotulo="Lucro bruto" valor={moeda(periodo.lucro)} detalhe={`Margem ${pct(periodo.receita > 0 ? (periodo.lucro / periodo.receita) * 100 : 0)}`} variante="verde" />
          <Kpi rotulo="Ticket medio" valor={moeda(periodo.vendas > 0 ? periodo.receita / periodo.vendas : 0)} detalhe={`${num(periodo.pecas)} pecas vendidas`} />
          <Kpi rotulo="Custo das mercadorias" valor={moeda(periodo.custo)} detalhe={`CMV ${pct(periodo.receita > 0 ? (periodo.custo / periodo.receita) * 100 : 0)} da receita`} />
          <Kpi rotulo="SKUs classe A" valor={String(classeA.length)} detalhe={`${pct(totalAbc > 0 ? (classeA.reduce((s, a) => s + a.receita, 0) / totalAbc) * 100 : 0)} da receita`} variante="ouro" />
        </Grade>

        <Secao titulo="Vendas por dia" descricao={dias > 60 ? "Mostrando os ultimos 60 dias" : `Ultimos ${dias} dias`}>
          <GraficoBarras dados={serie.map((s) => ({ rotulo: s.rotulo, valor: s.valor }))} formato={(v) => moeda(v)} cor="#0a5c6b" />
        </Secao>

        <Secao titulo="Curva ABC de SKUs" descricao={`Classe A = 80% da receita, B = 15%, C = 5% • ${abc.length} SKUs com venda no periodo`} padding={false}>
          {abc.length === 0 ? (
            <Vazio titulo="Sem vendas no periodo" />
          ) : (
            <Tabela maxAltura={430}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th className="num">Receita</th>
                  <th className="num">% do total</th>
                  <th className="num">Acumulado</th>
                  <th>Classe</th>
                  <th style={{ width: 130 }}>Participacao</th>
                </tr>
              </thead>
              <tbody>
                {abc.slice(0, 80).map((a, i) => (
                  <tr key={a.variacao_id}>
                    <td style={{ color: "#7d7466" }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: 12.5 }}>{a.sku}</td>
                    <td>
                      {a.produto}
                      {a.cor_codigo ? <span style={{ color: "#7d7466" }}> • {a.cor_codigo}</span> : null}
                    </td>
                    <td className="num"><strong>{moeda(a.receita)}</strong></td>
                    <td className="num">{pct(a.pct)}</td>
                    <td className="num">{pct(a.acumulado)}</td>
                    <td>
                      <span className={"tag " + (a.classe === "A" ? "tag-verde" : a.classe === "B" ? "tag-amarelo" : "tag-cinza")}>
                        {a.classe}
                      </span>
                    </td>
                    <td><Barra pct={a.pct} cor={a.classe === "A" ? "#1f8a5b" : a.classe === "B" ? "#c8913a" : "#d5ccba"} /></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <div className="grade-responsiva">
          <Secao titulo="Produtos que mais vendem" descricao="Por receita no periodo" padding={false}>
            {top.length === 0 ? <Vazio titulo="Sem vendas" /> : (
              <Tabela>
                <thead>
                  <tr><th>Produto</th><th className="num">Pecas</th><th className="num">Receita</th><th className="num">Margem</th></tr>
                </thead>
                <tbody>
                  {top.map((t, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{t.produto}</td>
                      <td className="num">{num(t.pecas)}</td>
                      <td className="num">{moeda(t.receita)}</td>
                      <td className="num">{pct(t.margem)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Formas de pagamento" padding={false}>
            {porForma.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead>
                  <tr><th>Forma</th><th className="num">Vendas</th><th className="num">Valor</th><th className="num">%</th></tr>
                </thead>
                <tbody>
                  {porForma.map((f, i) => (
                    <tr key={i}>
                      <td>{f.forma}</td>
                      <td className="num">{f.qtd}</td>
                      <td className="num"><strong>{moeda(f.valor)}</strong></td>
                      <td className="num">{pct(periodo.receita > 0 ? (f.valor / periodo.receita) * 100 : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Cores que mais giram" descricao="Base para decidir a compra por cor" padding={false}>
            {cores.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead>
                  <tr><th>Cor</th><th className="num">Pecas</th><th className="num">Receita</th></tr>
                </thead>
                <tbody>
                  {cores.map((c, i) => (
                    <tr key={i}>
                      <td><CorBolinha hex={c.cor_hex} codigo={c.cor_codigo} nome={c.cor} /></td>
                      <td className="num"><strong>{num(c.pecas)}</strong></td>
                      <td className="num">{moeda(c.receita)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Vendas por marca" padding={false}>
            {porMarca.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead>
                  <tr><th>Marca</th><th className="num">Pecas</th><th className="num">Receita</th><th className="num">Lucro</th></tr>
                </thead>
                <tbody>
                  {porMarca.map((m, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{m.marca}</td>
                      <td className="num">{num(m.pecas)}</td>
                      <td className="num">{moeda(m.receita)}</td>
                      <td className="num" style={{ color: "#166b46" }}>{moeda(m.lucro)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Desempenho por operador" padding={false}>
            {porOperador.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead>
                  <tr><th>Operador</th><th className="num">Vendas</th><th className="num">Faturamento</th><th className="num">Ticket</th><th className="num">Lucro</th></tr>
                </thead>
                <tbody>
                  {porOperador.map((o, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{o.operador}<div style={{ fontSize: 11, color: "#7d7466" }}>{o.papel}</div></td>
                      <td className="num">{o.vendas}</td>
                      <td className="num"><strong>{moeda(o.total)}</strong></td>
                      <td className="num">{moeda(o.ticket)}</td>
                      <td className="num">{moeda(o.lucro)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Comissao por vendedor" descricao="Calculada pelo percentual cadastrado em cada usuario" padding={false}>
            {porVendedor.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead>
                  <tr><th>Vendedor</th><th className="num">Vendas</th><th className="num">Faturamento</th><th className="num">Comissao</th></tr>
                </thead>
                <tbody>
                  {porVendedor.map((v, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{v.vendedor}</td>
                      <td className="num">{v.vendas}</td>
                      <td className="num">{moeda(v.total)}</td>
                      <td className="num" style={{ color: "#8a5a12", fontWeight: 600 }}>{moeda(v.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>
        </div>

        <Secao titulo="Investimento em estoque por linha" descricao="Quanto esta aplicado em cada linha e qual o potencial de retorno" padding={false}>
          <Tabela>
            <thead>
              <tr>
                <th>Linha</th>
                <th className="num">SKUs</th>
                <th className="num">Pecas</th>
                <th className="num">Investido (custo)</th>
                <th className="num">A preco de venda</th>
                <th className="num">Potencial de lucro</th>
                <th className="num">Margem media</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{l.linha}</td>
                  <td className="num">{l.skus}</td>
                  <td className="num">{num(l.pecas)}</td>
                  <td className="num"><strong>{moeda(l.custo)}</strong></td>
                  <td className="num">{moeda(l.venda)}</td>
                  <td className="num" style={{ color: "#166b46" }}>{moeda(l.venda - l.custo)}</td>
                  <td className="num">{pct(l.margem)}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Secao>

        <div className="grade-responsiva">
          <Secao titulo="SKUs sem venda no periodo" descricao="Dinheiro parado na prateleira - avalie promocao ou redistribuicao" padding={false}>
            {semVenda.length === 0 ? <Vazio titulo="Todos os SKUs com estoque venderam" /> : (
              <Tabela maxAltura={400}>
                <thead>
                  <tr><th>SKU</th><th>Produto</th><th className="num">Estoque</th><th className="num">Parado (R$)</th><th>Ultima venda</th></tr>
                </thead>
                <tbody>
                  {semVenda.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12 }}>{s.sku}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {s.produto}
                        <div style={{ color: "#7d7466" }}>{s.cor_codigo ?? ""} {s.comprimento ? `${s.comprimento}${s.comprimento_unidade}` : ""}</div>
                      </td>
                      <td className="num">{num(s.estoque)}</td>
                      <td className="num" style={{ color: "#9c2b2b" }}>{moeda(s.estoque_custo)}</td>
                      <td style={{ fontSize: 12 }}>{s.ultima_venda ? dataBR(s.ultima_venda) : "nunca"}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Alertas de reposicao" descricao="SKUs zerados ou abaixo do minimo" padding={false}>
            {alertas.length === 0 ? <Vazio titulo="Estoque saudavel" /> : (
              <Tabela maxAltura={400}>
                <thead>
                  <tr><th>SKU</th><th>Produto</th><th className="num">Disponivel</th><th className="num">Minimo</th><th>Situacao</th></tr>
                </thead>
                <tbody>
                  {alertas.map((a, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12 }}>{a.sku}</td>
                      <td style={{ fontSize: 12.5 }}>{a.produto}<div style={{ color: "#7d7466" }}>{a.cor_codigo ?? ""} {a.comprimento ? `${a.comprimento}${a.comprimento_unidade}` : ""}</div></td>
                      <td className="num">{num(a.disponivel)}</td>
                      <td className="num">{num(a.estoque_min)}</td>
                      <td><SituacaoEstoque situacao={a.situacao_estoque} disponivel={a.disponivel} /></td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>
        </div>

        <Secao titulo="Economia possivel na compra" descricao="SKUs em que outro fornecedor esta mais barato que o seu custo medio atual" padding={false}>
          {fornecedoresBaratos.length === 0 ? <Vazio titulo="Nenhuma oportunidade identificada" /> : (
            <Tabela maxAltura={420}>
              <thead>
                <tr><th>Produto / SKU</th><th>Fornecedor mais barato</th><th className="num">Custo dele</th><th className="num">Seu custo medio</th><th className="num">Economia</th></tr>
              </thead>
              <tbody>
                {fornecedoresBaratos.map((f, i) => (
                  <tr key={i}>
                    <td><strong>{f.produto}</strong><div style={{ fontSize: 11, color: "#7d7466" }}>{f.sku}</div></td>
                    <td>{f.fornecedor}</td>
                    <td className="num">{moeda(f.custo)}</td>
                    <td className="num">{moeda(f.custo_medio)}</td>
                    <td className="num"><span className="tag tag-verde">{pct(f.economia_pct)} mais barato</span></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <div className="grade-responsiva">
          <Secao titulo="Melhores clientes" padding={false}>
            {topClientes.length === 0 ? <Vazio titulo="Sem dados" /> : (
              <Tabela>
                <thead><tr><th>Cliente</th><th className="num">Compras</th><th className="num">Total</th><th className="num">Ticket</th></tr></thead>
                <tbody>
                  {topClientes.map((c, i) => (
                    <tr key={i}><td style={{ fontWeight: 600 }}>{c.nome}</td><td className="num">{c.compras}</td><td className="num">{moeda(c.total)}</td><td className="num">{moeda(c.ticket)}</td></tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Vendas por dia da semana" descricao="Ajuda a dimensionar escala e promocoes" padding={false}>
            <Tabela>
              <thead><tr><th>Dia</th><th className="num">Vendas</th><th className="num">Faturamento</th></tr></thead>
              <tbody>
                {porDiaSemana.map((d, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{nomesDow[d.dow]}</td>
                    <td className="num">{d.vendas}</td>
                    <td className="num">{moeda(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>
        </div>

        <Secao titulo="Crediario em aberto" padding={false}>
          {fiado.length === 0 ? <Vazio titulo="Nenhum cliente devendo" /> : (
            <Tabela>
              <thead><tr><th>Cliente</th><th>Telefone</th><th className="num">Saldo</th><th className="num">Limite</th><th>Ultimo lancamento</th><th></th></tr></thead>
              <tbody>
                {fiado.map((f, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{f.nome}</td>
                    <td>{f.telefone ?? "—"}</td>
                    <td className="num" style={{ color: "#9c2b2b", fontWeight: 600 }}>{moeda(f.saldo)}</td>
                    <td className="num">{moeda(f.limite_credito)}</td>
                    <td>{dataBR(f.ultimo)}</td>
                    <td><Link className="btn btn-sm btn-neutro" href={`/clientes/${f.id}`}>Ver ficha</Link></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>
      </Conteudo>
    </>
  );
}
