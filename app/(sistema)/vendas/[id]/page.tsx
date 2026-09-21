import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir, podeGerenciar } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, pct, dataHoraBR, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, Linha, Kpi, Grade, TagStatus } from "@/components/ui";
import { PainelCancelamento, PainelDevolucao } from "./AcoesVenda";

export const dynamic = "force-dynamic";

export default async function DetalheVenda({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; erro?: string }>;
}) {
  const u = await exigir();
  const { id } = await params;
  const sp = await searchParams;
  const vendaId = Number(id);

  const v = one<any>(
    `SELECT v.*, lo.nome loja, lo.razao_social, lo.cnpj, uo.nome operador, uv.nome vendedor,
            c.nome cliente, c.telefone cliente_telefone, c.id cliente_id, cx.terminal
     FROM vendas v
     LEFT JOIN lojas lo ON lo.id = v.loja_id
     LEFT JOIN usuarios uo ON uo.id = v.usuario_id
     LEFT JOIN usuarios uv ON uv.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN caixas cx ON cx.id = v.caixa_id
     WHERE v.id = ?`,
    vendaId
  );
  if (!v) notFound();

  const itens = all<any>(
    `SELECT vi.*, vv.sku, vv.cor_codigo, vv.cor_hex, vv.comprimento, vv.comprimento_unidade,
            (vi.quantidade - vi.devolvido) disponivel_devolver
     FROM vendas_itens vi LEFT JOIN vw_variacoes vv ON vv.variacao_id = vi.variacao_id
     WHERE vi.venda_id = ? ORDER BY vi.id`,
    vendaId
  );

  const pagamentos = all<any>(
    `SELECT vp.*, fp.nome forma, fp.tipo FROM vendas_pagamentos vp
     JOIN formas_pagamento fp ON fp.id = vp.forma_pagamento_id WHERE vp.venda_id = ?`,
    vendaId
  );

  const devolucoes = all<any>(
    `SELECT d.numero, d.data, d.total, d.motivo, u.nome usuario,
            (SELECT GROUP_CONCAT(vv.sku, ', ') FROM devolucoes_itens di
             JOIN variacoes vv ON vv.id = di.variacao_id WHERE di.devolucao_id = d.id) skus
     FROM devolucoes d LEFT JOIN usuarios u ON u.id = d.usuario_id
     WHERE d.venda_id = ? ORDER BY d.id DESC`,
    vendaId
  );

  const lucro = Number(v.total) - Number(v.custo_total);
  const margem = Number(v.total) > 0 ? (lucro / Number(v.total)) * 100 : 0;
  const cancelada = v.status === "cancelada";
  const podeDevolver = !cancelada && itens.some((i) => i.disponivel_devolver > 0);
  const gestor = podeGerenciar(u);

  return (
    <>
      <Cabecalho
        titulo={`Venda ${v.numero}`}
        subtitulo={`${dataHoraBR(v.data)} • ${v.loja ?? ""} • ${v.terminal ?? ""} • operador ${v.operador ?? "—"}`}
        acoes={
          <>
            <TagStatus status={v.status} />
            <a className="btn btn-neutro" href={`/api/venda/${vendaId}`} target="_blank" rel="noreferrer">Ver cupom (JSON)</a>
            <Link className="btn btn-neutro" href="/vendas">Voltar</Link>
          </>
        }
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #1f8a5b", color: "#166b46", fontWeight: 600 }}>{sp.msg}</div> : null}
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}
        {cancelada ? (
          <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b" }}>
            <strong>Venda cancelada</strong> em {dataHoraBR(v.cancelada_em)}. Motivo: {v.motivo_cancelamento ?? "nao informado"}.
            O estoque foi devolvido e lancado no historico de movimentacoes.
          </div>
        ) : null}

        <Grade colunas={5}>
          <Kpi rotulo="Total" valor={moeda(v.total)} detalhe={`${itens.length} itens • ${num(itens.reduce((s, i) => s + Number(i.quantidade), 0))} pecas`} variante="teal" />
          <Kpi rotulo="Subtotal" valor={moeda(v.subtotal)} detalhe={v.desconto_valor > 0 ? `Desconto ${moeda(v.desconto_valor)}` : "sem desconto"} />
          <Kpi rotulo="Custo total" valor={moeda(v.custo_total)} detalhe="Custo congelado no momento da venda" />
          <Kpi rotulo="Lucro" valor={moeda(lucro)} detalhe={`Margem ${pct(margem)}`} variante="verde" />
          <Kpi rotulo="Cliente" valor={v.cliente ?? "Balcao"} detalhe={v.cliente_telefone ?? "sem cadastro"} />
        </Grade>

        <Secao titulo="Itens da venda" descricao="Descricao, quantidade, preco praticado, custo e lucro por item" padding={false}>
          <Tabela>
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th className="num">Qtd</th>
                <th className="num">Preco unit.</th>
                <th className="num">Desconto</th>
                <th className="num">Total</th>
                <th className="num">Custo unit.</th>
                <th className="num">Lucro</th>
                <th className="num">Devolvido</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>{i.descricao}</td>
                  <td style={{ fontSize: 12 }}>
                    {i.sku ?? "—"}
                    {i.cor_codigo ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: i.cor_hex, border: "1px solid #d5ccba", display: "inline-block" }} />
                        {i.cor_codigo}
                      </span>
                    ) : null}
                    {i.comprimento ? ` ${i.comprimento}${i.comprimento_unidade}` : ""}
                  </td>
                  <td className="num">{num(i.quantidade)}</td>
                  <td className="num">{moeda(i.preco_unitario)}</td>
                  <td className="num">{i.desconto_valor > 0 ? moeda(i.desconto_valor) : "—"}</td>
                  <td className="num"><strong>{moeda(i.total)}</strong></td>
                  <td className="num">{moeda(i.custo_unitario)}</td>
                  <td className="num" style={{ color: Number(i.total) - Number(i.quantidade) * Number(i.custo_unitario) >= 0 ? "#166b46" : "#9c2b2b" }}>
                    {moeda(Number(i.total) - Number(i.quantidade) * Number(i.custo_unitario))}
                  </td>
                  <td className="num">{i.devolvido > 0 ? num(i.devolvido) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Secao>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
          <Secao titulo="Pagamentos" padding={false}>
            <Tabela>
              <thead>
                <tr>
                  <th>Forma</th>
                  <th className="num">Parcelas</th>
                  <th className="num">Valor</th>
                  <th className="num">Recebido</th>
                  <th className="num">Troco</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p, i) => (
                  <tr key={i}>
                    <td>{p.forma}</td>
                    <td className="num">{p.parcelas > 1 ? p.parcelas + "x" : "a vista"}</td>
                    <td className="num"><strong>{moeda(p.valor)}</strong></td>
                    <td className="num">{p.valor_recebido ? moeda(p.valor_recebido) : "—"}</td>
                    <td className="num">{p.troco ? moeda(p.troco) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>

          <Secao titulo="Informacoes" padding={false}>
            <Tabela>
              <tbody>
                <tr><td style={{ color: "#7d7466" }}>Numero</td><td style={{ fontWeight: 600 }}>{v.numero}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Data / hora</td><td>{dataHoraBR(v.data)}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Vendedor</td><td>{v.vendedor ?? "—"}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Operador do caixa</td><td>{v.operador ?? "—"}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Unidade</td><td>{v.loja ?? "—"}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Caixa</td><td>{v.terminal ?? "—"}</td></tr>
                <tr><td style={{ color: "#7d7466" }}>Observacoes</td><td>{v.observacoes ?? "—"}</td></tr>
              </tbody>
            </Tabela>
          </Secao>
        </div>

        {devolucoes.length > 0 ? (
          <Secao titulo="Devolucoes registradas" padding={false}>
            <Tabela>
              <thead>
                <tr>
                  <th>Numero</th>
                  <th>Data</th>
                  <th className="num">Valor</th>
                  <th>Itens</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {devolucoes.map((d, i) => (
                  <tr key={i}>
                    <td>{d.numero}</td>
                    <td>{dataHoraBR(d.data)}</td>
                    <td className="num">{moeda(d.total)}</td>
                    <td style={{ fontSize: 12 }}>{d.skus}</td>
                    <td style={{ fontSize: 12.5 }}>{d.motivo ?? "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{d.usuario ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>
        ) : null}

        {podeDevolver ? (
          <PainelDevolucao
            vendaId={vendaId}
            itens={itens.map((i) => ({
              id: i.id,
              descricao: i.descricao,
              quantidade: Number(i.quantidade),
              devolvido: Number(i.devolvido),
              disponivel_devolver: Number(i.disponivel_devolver),
            }))}
          />
        ) : null}

        {!cancelada && gestor ? <PainelCancelamento vendaId={vendaId} numero={v.numero} /> : null}

        {!cancelada && !gestor ? (
          <Secao titulo="Cancelamento">
            <p style={{ fontSize: 13.5, color: "#7d7466", margin: 0 }}>
              Somente gerente ou administrador pode cancelar uma venda. Procure um responsavel.
            </p>
          </Secao>
        ) : null}
      </Conteudo>
    </>
  );
}
