import Link from "next/link";
import { exigir } from "@/lib/auth";
import { moeda, pct, num, dataHoraBR, moeda as m } from "@/lib/format";
import {
  resumoPeriodo, resumoHoje, resumoEstoque, vendasPorDia, topProdutos,
  alertasEstoque, ultimasVendas, fiadoAberto, corQueMaisGira, caixaAbertoResumo,
} from "@/lib/consultas";
import { Cabecalho, Conteudo, Grade, Kpi, Secao, Tabela, Vazio, GraficoBarras, SituacaoEstoque, CorBolinha, Barra, TagStatus } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Painel() {
  const u = await exigir();

  const hoje = resumoHoje();
  const mes = resumoPeriodo(30);
  const est = resumoEstoque();
  const serie = vendasPorDia(30);
  const top = topProdutos(30, 8);
  const alertas = alertasEstoque(8);
  const ultimas = ultimasVendas(8);
  const fiado = fiadoAberto();
  const cores = corQueMaisGira(90, 6);
  const caixa = caixaAbertoResumo();

  const ticket = mes.vendas > 0 ? mes.receita / mes.vendas : 0;
  const margemMes = mes.receita > 0 ? (mes.lucro / mes.receita) * 100 : 0;
  const totalFiado = fiado.reduce((s, f) => s + f.saldo, 0);
  const maxTop = Math.max(...top.map((t) => t.receita), 1);

  return (
    <>
      <Cabecalho
        titulo={`Ola, ${u.apelido || u.nome.split(" ")[0]}`}
        subtitulo="Visao geral da loja"
        acoes={
          <>
            <Link className="btn btn-ouro" href="/caixa">Abrir PDV</Link>
            <Link className="btn btn-primario" href="/produtos/novo">+ Novo produto</Link>
          </>
        }
      />

      <Conteudo>
        {/* Situacao do caixa */}
        {caixa ? (
          <div
            className="aviso aviso-ok"
          >
            <span className="tag tag-verde">CAIXA ABERTO</span>
            <span style={{ fontSize: 13.5 }}>
              <strong>{caixa.terminal || "CAIXA"}</strong> • aberto {dataHoraBR(caixa.abertura_em)} por {caixa.operador}
            </span>
            <span style={{ fontSize: 13.5, color: "#7d7466" }}>
              {caixa.qtd} vendas • {moeda(caixa.vendas)}
            </span>
            <span style={{ fontSize: 13.5 }}>
              Dinheiro na gaveta: <strong>{moeda(caixa.esperado)}</strong>
            </span>
            <div style={{ flex: 1 }} />
            <Link className="btn btn-sm btn-primario" href="/caixa">Ir para o caixa</Link>
          </div>
        ) : (
          <div
            className="aviso aviso-erro"
          >
            <span className="tag tag-vermelho">CAIXA FECHADO</span>
            <span style={{ fontSize: 13.5, color: "#7d7466" }}>Nenhum caixa aberto no momento.</span>
            <div style={{ flex: 1 }} />
            <Link className="btn btn-sm btn-ouro" href="/caixa">Abrir caixa</Link>
          </div>
        )}

        <Grade colunas={4}>
          <Kpi rotulo="Vendas hoje" valor={moeda(hoje.receita)} detalhe={`${hoje.vendas} vendas • lucro ${moeda(hoje.lucro)}`} variante="teal" />
          <Kpi rotulo="Ultimos 30 dias" valor={moeda(mes.receita)} detalhe={`${mes.vendas} vendas • ${num(mes.pecas)} pecas`} />
          <Kpi rotulo="Ticket medio (30d)" valor={moeda(ticket)} detalhe={`Margem ${pct(margemMes)}`} />
          <Kpi rotulo="Lucro bruto (30d)" valor={moeda(mes.lucro)} detalhe={`Custo ${moeda(mes.custo)}`} variante="verde" />
        </Grade>

        <Grade colunas={4}>
          <Kpi rotulo="Estoque a custo" valor={moeda(est.valor_custo)} detalhe={`${num(est.pecas)} pecas • ${est.skus} SKUs`} />
          <Kpi rotulo="Estoque a preco de venda" valor={moeda(est.valor_venda)} detalhe={`Potencial de lucro ${moeda(est.valor_venda - est.valor_custo)}`} />
          <Kpi rotulo="Precisa repor" valor={String(est.criticos + est.repor)} detalhe={`${est.sem_estoque} SKUs sem estoque`} variante={est.criticos > 0 ? "vermelho" : "amarelo"} href="/estoque?situacao=critico" />
          <Kpi rotulo="Fiado em aberto" valor={moeda(totalFiado)} detalhe={`${fiado.length} clientes`} variante={totalFiado > 0 ? "amarelo" : "claro"} href="/clientes" />
        </Grade>

        {/* Grafico */}
        <Secao titulo="Vendas dos ultimos 30 dias" descricao="Receita por dia (domingos fechados)">
          <GraficoBarras
            dados={serie.map((s) => ({ rotulo: s.rotulo, valor: s.valor }))}
            formato={(v) => moeda(v)}
            cor="#0a5c6b"
          />
        </Secao>

        <div className="grade-responsiva" style={{ "--cols-desktop": "minmax(0,1.25fr) minmax(0,1fr)" } as React.CSSProperties}>
          {/* Top produtos */}
          <Secao
            titulo="Produtos que mais vendem (30 dias)"
            descricao="Ordenado por receita"
            acoes={<Link className="btn btn-sm btn-neutro" href="/relatorios">Ver relatorios</Link>}
            padding={false}
          >
            {top.length === 0 ? (
              <Vazio titulo="Sem vendas no periodo" />
            ) : (
              <Tabela>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Pecas</th>
                    <th className="num">Receita</th>
                    <th className="num">Margem</th>
                    <th style={{ width: 90 }}>Participacao</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((t, i) => (
                    <tr key={i}>
                      <td><strong>{t.produto}</strong></td>
                      <td className="num">{num(t.pecas)}</td>
                      <td className="num">{moeda(t.receita)}</td>
                      <td className="num">{pct(t.margem)}</td>
                      <td><Barra pct={(t.receita / maxTop) * 100} /></td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <div>
            {/* Alertas de estoque */}
            <Secao
              titulo="Alertas de reposicao"
              descricao="SKUs zerados ou abaixo do minimo"
              acoes={<Link className="btn btn-sm btn-neutro" href="/estoque">Ver estoque</Link>}
              padding={false}
            >
              {alertas.length === 0 ? (
                <Vazio titulo="Estoque saudavel" descricao="Nenhum SKU abaixo do ponto de reposicao." />
              ) : (
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {alertas.map((a, i) => (
                    <Link
                      key={i}
                      href={`/produtos/${a.produto_id}`}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        padding: "9px 14px",
                        borderBottom: "1px solid #f2eee6",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{a.produto}</div>
                        <div style={{ fontSize: 11.5, color: "#7d7466" }}>
                          {a.sku} • <CorBolinha hex={a.cor_hex} codigo={a.cor_codigo} />
                          {a.comprimento ? ` • ${a.comprimento}${a.comprimento_unidade}` : ""}
                        </div>
                      </div>
                      <SituacaoEstoque situacao={a.situacao_estoque} disponivel={a.disponivel} />
                    </Link>
                  ))}
                </div>
              )}
            </Secao>

            {/* Cores que mais giram */}
            <Secao titulo="Cores que mais giram (90 dias)" padding={false}>
              {cores.length === 0 ? (
                <Vazio titulo="Sem dados de venda" />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>Cor</th>
                      <th className="num">Pecas</th>
                      <th className="num">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cores.map((c, i) => (
                      <tr key={i}>
                        <td><CorBolinha hex={c.cor_hex} codigo={c.cor_codigo} nome={c.cor} /></td>
                        <td className="num">{num(c.pecas)}</td>
                        <td className="num">{moeda(c.receita)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </div>
        </div>

        {/* Ultimas vendas */}
        <Secao
          titulo="Ultimas vendas"
          acoes={<Link className="btn btn-sm btn-neutro" href="/vendas">Ver todas</Link>}
          padding={false}
        >
          {ultimas.length === 0 ? (
            <Vazio titulo="Nenhuma venda registrada" />
          ) : (
            <Tabela>
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Operador</th>
                  <th className="num">Itens</th>
                  <th className="num">Total</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {ultimas.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/vendas/${v.id}`} style={{ color: "#0a5c6b", fontWeight: 600 }}>{v.numero}</Link></td>
                    <td>{dataHoraBR(v.data)}</td>
                    <td>{v.cliente ?? "Balcao"}</td>
                    <td>{v.operador}</td>
                    <td className="num">{v.itens}</td>
                    <td className="num"><strong>{moeda(v.total)}</strong></td>
                    <td><TagStatus status={v.status} /></td>
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
