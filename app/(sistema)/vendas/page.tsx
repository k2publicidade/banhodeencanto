import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num, dataHoraBR, pct } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, Linha, Kpi, Grade, TagStatus } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaginaVendas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; de?: string; ate?: string; forma?: string; msg?: string; erro?: string; operador?: string }>;
}) {
  await exigir();
  const sp = await searchParams;

  const where: string[] = ["1=1"];
  const params: any[] = [];
  if (sp.q) {
    where.push(`(v.numero ILIKE ? OR COALESCE(c.nome,'') ILIKE ? OR COALESCE(c.cpf_cnpj,'') ILIKE ?)`);
    const l = "%" + sp.q + "%";
    params.push(l, l, l);
  }
  if (sp.status) { where.push("v.status = ?"); params.push(sp.status); }
  if (sp.de) { where.push("CAST(v.data AS DATE) >= ?"); params.push(sp.de); }
  if (sp.ate) { where.push("CAST(v.data AS DATE) <= ?"); params.push(sp.ate); }
  if (sp.operador) { where.push("v.usuario_id = ?"); params.push(Number(sp.operador)); }
  if (sp.forma) {
    where.push("EXISTS (SELECT 1 FROM vendas_pagamentos vp WHERE vp.venda_id = v.id AND vp.forma_pagamento_id = ?)");
    params.push(Number(sp.forma));
  }

  const [vendas, tot, usuarios, formas] = await Promise.all([
    all<any>(
      `SELECT v.id, v.numero, v.data, v.subtotal, v.desconto_valor, v.total, v.custo_total, v.status,
              COALESCE(c.nome,'Balcao') cliente, u.nome operador, uv.nome vendedor,
              (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id = v.id) itens,
              (SELECT COALESCE(SUM(vi.quantidade),0) FROM vendas_itens vi WHERE vi.venda_id = v.id) pecas,
              (SELECT STRING_AGG(fp.nome, ' + ') FROM vendas_pagamentos vp JOIN formas_pagamento fp ON fp.id = vp.forma_pagamento_id WHERE vp.venda_id = v.id) formas
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN usuarios u ON u.id = v.usuario_id
       LEFT JOIN usuarios uv ON uv.id = v.vendedor_id
       WHERE ${where.join(" AND ")}
       ORDER BY v.id DESC LIMIT 400`,
      ...params
    ),
    one<any>(
      `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN v.status <> 'cancelada' THEN v.total ELSE 0 END),0) total,
              COALESCE(SUM(CASE WHEN v.status <> 'cancelada' THEN v.total - v.custo_total ELSE 0 END),0) lucro,
              SUM(CASE WHEN v.status='cancelada' THEN 1 ELSE 0 END) canceladas
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE ${where.join(" AND ")}`,
      ...params
    ),
    all<{ id: number; nome: string }>("SELECT id, nome FROM usuarios WHERE ativo=1 ORDER BY nome"),
    all<{ id: number; nome: string }>("SELECT id, nome FROM formas_pagamento ORDER BY ordem"),
  ]);
  const ticket = (tot?.n ?? 0) > 0 ? Number(tot.total) / Number(tot.n) : 0;

  return (
    <>
      <Cabecalho
        titulo="Vendas"
        subtitulo={`${tot?.n ?? 0} venda(s) no filtro • ${moeda(tot?.total ?? 0)} • ticket medio ${moeda(ticket)}`}
        acoes={
          <>
            <a className="btn btn-neutro" href="/api/exportar/vendas">Exportar CSV</a>
            <Link className="btn btn-ouro" href="/caixa">Ir para o PDV</Link>
          </>
        }
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Vendas no filtro" valor={String(tot?.n ?? 0)} detalhe={`${tot?.canceladas ?? 0} cancelada(s)`} />
          <Kpi rotulo="Faturamento" valor={moeda(tot?.total ?? 0)} detalhe="Exclui canceladas" variante="teal" />
          <Kpi rotulo="Lucro bruto" valor={moeda(tot?.lucro ?? 0)} detalhe={`Margem ${pct(Number(tot?.total) > 0 ? (Number(tot.lucro) / Number(tot.total)) * 100 : 0)}`} variante="verde" />
          <Kpi rotulo="Ticket medio" valor={moeda(ticket)} detalhe="Por venda" />
        </Grade>

        <Secao titulo="Filtros">
          <form method="get" className="grade-form filtros-vendas" style={{ "--cols-desktop": "1.6fr 1fr 1fr 1fr 1fr 1fr auto auto" } as React.CSSProperties}>
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="Numero da venda, cliente ou CPF" />
            <Campo rotulo="De" nome="de" valor={sp.de} tipo="date" />
            <Campo rotulo="Ate" nome="ate" valor={sp.ate} tipo="date" />
            <CampoSelect
              rotulo="Status"
              nome="status"
              valor={sp.status}
              placeholder="Todos"
              opcoes={[
                { valor: "concluida", texto: "Concluida" },
                { valor: "cancelada", texto: "Cancelada" },
                { valor: "devolvida_parcial", texto: "Devolvida parcial" },
                { valor: "devolvida_total", texto: "Devolvida total" },
              ]}
            />
            <CampoSelect rotulo="Operador" nome="operador" valor={sp.operador} placeholder="Todos" opcoes={usuarios.map((u) => ({ valor: u.id, texto: u.nome }))} />
            <CampoSelect rotulo="Forma de pagamento" nome="forma" valor={sp.forma} placeholder="Todas" opcoes={formas.map((f) => ({ valor: f.id, texto: f.nome }))} />
            <button className="btn btn-primario" type="submit">Filtrar</button>
            <Link className="btn btn-neutro" href="/vendas">Limpar</Link>
          </form>
        </Secao>

        <Secao titulo={`${vendas.length} venda(s)`} padding={false}>
          {vendas.length === 0 ? (
            <Vazio titulo="Nenhuma venda encontrada" descricao="Ajuste os filtros ou faca uma venda no PDV." acao={<Link className="btn btn-primario" href="/caixa">Abrir o PDV</Link>} />
          ) : (
            <Tabela maxAltura={650}>
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Pagamento</th>
                  <th className="num">Itens</th>
                  <th className="num">Pecas</th>
                  <th className="num">Desconto</th>
                  <th className="num">Total</th>
                  <th className="num">Lucro</th>
                  <th>Operador</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/vendas/${v.id}`} style={{ color: "#0a5c6b", fontWeight: 600 }}>{v.numero}</Link></td>
                    <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{dataHoraBR(v.data)}</td>
                    <td style={{ fontSize: 12.5 }}>{v.cliente}</td>
                    <td style={{ fontSize: 12 }}>{v.formas ?? "—"}</td>
                    <td className="num">{v.itens}</td>
                    <td className="num">{num(v.pecas)}</td>
                    <td className="num">{v.desconto_valor > 0 ? moeda(v.desconto_valor) : "—"}</td>
                    <td className="num"><strong>{moeda(v.total)}</strong></td>
                    <td className="num" style={{ color: Number(v.total) - Number(v.custo_total) >= 0 ? "#166b46" : "#9c2b2b" }}>
                      {moeda(Number(v.total) - Number(v.custo_total))}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{v.operador ?? "—"}</td>
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
