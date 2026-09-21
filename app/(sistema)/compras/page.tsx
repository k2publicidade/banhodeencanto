import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num, dataBR, dataHoraBR } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Kpi, Grade, TagStatus } from "@/components/ui";
import { acaoConfirmarCompra, acaoCancelarCompra } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

export default async function PaginaCompras({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; erro?: string; status?: string; fornecedor?: string }>;
}) {
  await exigir();
  const sp = await searchParams;

  const where: string[] = ["1=1"];
  const params: any[] = [];
  if (sp.status) { where.push("c.status = ?"); params.push(sp.status); }
  if (sp.fornecedor) { where.push("c.fornecedor_id = ?"); params.push(Number(sp.fornecedor)); }

  const compras = all<any>(
    `SELECT c.id, c.numero, c.data, c.documento, c.status, c.subtotal, c.frete, c.desconto, c.total,
            f.nome_fantasia fornecedor, f.razao_social, u.nome usuario, c.confirmado_em,
            (SELECT COUNT(*) FROM compras_itens ci WHERE ci.compra_id = c.id) itens,
            (SELECT COALESCE(SUM(ci.quantidade),0) FROM compras_itens ci WHERE ci.compra_id = c.id) pecas
     FROM compras c
     JOIN fornecedores f ON f.id = c.fornecedor_id
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.id DESC LIMIT 200`,
    ...params
  );

  const totais = one<any>(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='confirmado' THEN total ELSE 0 END),0) confirmado,
            SUM(CASE WHEN status='rascunho' THEN 1 ELSE 0 END) rascunhos
     FROM compras`
  );
  const mes = one<any>(
    `SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM compras
     WHERE status='confirmado' AND date(data) >= date('now','localtime','-30 days')`
  );

  const fornecedores = all<{ id: number; nome: string }>(
    "SELECT id, COALESCE(nome_fantasia, razao_social) nome FROM fornecedores WHERE ativo=1 ORDER BY nome_fantasia"
  );

  return (
    <>
      <Cabecalho
        titulo="Compras e entrada de mercadoria"
        subtitulo="Rascunho nao mexe no estoque. Ao confirmar, o sistema da entrada e recalcula o custo medio ponderado."
        acoes={<Link className="btn btn-primario" href="/compras/nova">+ Nova compra</Link>}
      />

      <Conteudo>
        {sp.msg ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #1f8a5b", color: "#166b46", fontWeight: 600 }}>{sp.msg}</div> : null}
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Compras registradas" valor={String(totais?.n ?? 0)} detalhe={`${totais?.rascunhos ?? 0} em rascunho`} />
          <Kpi rotulo="Total confirmado" valor={moeda(totais?.confirmado ?? 0)} detalhe="Historico completo" variante="teal" />
          <Kpi rotulo="Ultimos 30 dias" valor={moeda(mes?.total ?? 0)} detalhe={`${mes?.n ?? 0} compras confirmadas`} />
          <Kpi rotulo="Fornecedores ativos" valor={String(fornecedores.length)} detalhe="Cadastro de fornecedores" href="/fornecedores" />
        </Grade>

        <Secao titulo="Filtros">
          <form method="get" className="grade-form" style={{ "--cols-desktop": "1fr 1fr auto auto" } as React.CSSProperties}>
            <div>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={sp.status ?? ""}>
                <option value="">Todos</option>
                <option value="rascunho">Rascunho</option>
                <option value="confirmado">Confirmado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <div>
              <label htmlFor="fornecedor">Fornecedor</label>
              <select id="fornecedor" name="fornecedor" defaultValue={sp.fornecedor ?? ""}>
                <option value="">Todos</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primario" type="submit">Filtrar</button>
            <Link className="btn btn-neutro" href="/compras">Limpar</Link>
          </form>
        </Secao>

        <Secao titulo={`${compras.length} compra(s)`} padding={false}>
          {compras.length === 0 ? (
            <Vazio
              titulo="Nenhuma compra registrada"
              descricao="Registre uma compra para dar entrada no estoque com custo e fornecedor."
              acao={<Link className="btn btn-primario" href="/compras/nova">+ Nova compra</Link>}
            />
          ) : (
            <Tabela maxAltura={600}>
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Data</th>
                  <th>Fornecedor</th>
                  <th>Documento</th>
                  <th className="num">Itens</th>
                  <th className="num">Pecas</th>
                  <th className="num">Frete</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {compras.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.numero}</strong><div style={{ fontSize: 11, color: "#7d7466" }}>{c.usuario ?? ""}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>{dataBR(c.data)}</td>
                    <td>{c.fornecedor || c.razao_social}</td>
                    <td style={{ fontSize: 12.5 }}>{c.documento ?? "—"}</td>
                    <td className="num">{c.itens}</td>
                    <td className="num">{num(c.pecas)}</td>
                    <td className="num">{moeda(c.frete)}</td>
                    <td className="num"><strong>{moeda(c.total)}</strong></td>
                    <td>
                      <TagStatus status={c.status} />
                      {c.confirmado_em ? <div style={{ fontSize: 10.5, color: "#7d7466" }}>{dataHoraBR(c.confirmado_em)}</div> : null}
                    </td>
                    <td>
                      {c.status === "rascunho" ? (
                        <div style={{ display: "flex", gap: 5 }}>
                          <form action={acaoConfirmarCompra}>
                            <input type="hidden" name="compra_id" value={c.id} />
                            <button className="btn btn-sm btn-sucesso">Confirmar entrada</button>
                          </form>
                          <form action={acaoCancelarCompra}>
                            <input type="hidden" name="compra_id" value={c.id} />
                            <button className="btn btn-sm btn-perigo">×</button>
                          </form>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "#7d7466" }}>{c.status === "confirmado" ? "entrada no estoque" : "—"}</span>
                      )}
                    </td>
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
