import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { num, dataHoraBR, moeda } from "@/lib/format";
import { listarEstoques } from "@/lib/estoques";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, Linha, Kpi, Grade } from "@/components/ui";

export const dynamic = "force-dynamic";

const TIPOS = [
  "entrada", "venda", "saida", "ajuste", "devolucao",
  "transferencia_saida", "transferencia_entrada", "perda", "inventario", "cancelamento",
];

export default async function PaginaMovimentos({
  searchParams,
}: {
  searchParams: Promise<{ estoque?: string; tipo?: string; q?: string; dias?: string; msg?: string; erro?: string }>;
}) {
  await exigir();
  const sp = await searchParams;

  const estoques = await listarEstoques();
  const loja = Number(sp.estoque) > 0 ? Number(sp.estoque) : 0;
  const dias = Number(sp.dias) > 0 ? Number(sp.dias) : 30;

  const condicoes: string[] = [
    `CAST(m.criado_em AS DATE) >= ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '${dias} days')::date`,
  ];
  const params: any[] = [];
  if (loja) { condicoes.push("m.loja_id = ?"); params.push(loja); }
  if (sp.tipo && TIPOS.includes(sp.tipo)) { condicoes.push("m.tipo = ?"); params.push(sp.tipo); }
  if (sp.q) {
    condicoes.push("(v.sku ILIKE ? OR p.nome ILIKE ? OR m.motivo ILIKE ? OR m.documento ILIKE ?)");
    const l = "%" + sp.q + "%";
    params.push(l, l, l, l);
  }
  const where = "WHERE " + condicoes.join(" AND ");

  const [movimentos, resumo] = await Promise.all([
    all<any>(
      `SELECT m.id, m.tipo, m.quantidade, m.saldo_anterior, m.saldo_apos, m.custo_unitario, m.documento, m.motivo,
              m.referencia_tipo, m.referencia_id, m.criado_em, m.variacao_id, m.loja_id,
              v.sku, v.produto_id, p.nome produto, u.nome usuario, l.nome loja, l.eh_deposito
       FROM estoque_movimentos m
       JOIN variacoes v ON v.id = m.variacao_id
       JOIN produtos p ON p.id = v.produto_id
       JOIN lojas l ON l.id = m.loja_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       ${where}
       ORDER BY m.id DESC LIMIT 300`,
      ...params
    ),
    one<any>(
      `SELECT COUNT(*) movimentos,
              COALESCE(SUM(CASE WHEN m.saldo_apos >= m.saldo_anterior THEN m.saldo_apos - m.saldo_anterior ELSE 0 END),0) entradas,
              COALESCE(SUM(CASE WHEN m.saldo_apos < m.saldo_anterior THEN m.saldo_anterior - m.saldo_apos ELSE 0 END),0) saidas,
              COALESCE(SUM(ABS(m.quantidade) * m.custo_unitario),0) valor
       FROM estoque_movimentos m
       JOIN variacoes v ON v.id = m.variacao_id
       JOIN produtos p ON p.id = v.produto_id
       ${where}`,
      ...params
    ),
  ]);

  const q = new URLSearchParams();
  if (loja) q.set("estoque", String(loja));
  if (sp.tipo) q.set("tipo", sp.tipo);
  if (sp.q) q.set("q", sp.q);
  q.set("dias", String(dias));
  const querystring = q.toString();

  return (
    <>
      <Cabecalho
        titulo="Movimentacoes de estoque"
        subtitulo={`${dias} dias • ${loja ? estoques.find((e) => e.loja_id === loja)?.nome ?? "" : "todos os estoques"} • ${num(resumo?.movimentos)} movimento(s)`}
        acoes={
          <>
            <a className="btn btn-neutro" href={`/api/exportar/movimentos?${querystring}`}>Exportar CSV</a>
            <Link className="btn btn-neutro" href="/estoque">Voltar aos estoques</Link>
            <Link className="btn btn-primario" href="/estoque/transferencia">Transferir entre estoques</Link>
          </>
        }
      />

      <Conteudo largura={1250}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Movimentos" valor={num(resumo?.movimentos)} detalhe={`Ultimos ${dias} dias`} variante="teal" />
          <Kpi rotulo="Entradas" valor={num(resumo?.entradas) + " pecas"} detalhe="Compras, devolucoes, transferencias recebidas" variante="verde" />
          <Kpi rotulo="Saidas" valor={num(resumo?.saidas) + " pecas"} detalhe="Vendas, perdas, transferencias enviadas" variante="vermelho" />
          <Kpi rotulo="Valor movimentado" valor={moeda(resumo?.valor)} detalhe="A custo medio" />
        </Grade>

        <Secao titulo="Filtros" descricao="Mostra os 300 movimentos mais recentes do periodo escolhido">
          <form method="get" className="grade-form" style={{ "--cols-desktop": "1.4fr 1.2fr 2fr 1fr auto auto" } as React.CSSProperties}>
            <CampoSelect
              rotulo="Estoque"
              nome="estoque"
              valor={sp.estoque}
              placeholder="Todos"
              opcoes={estoques.map((e) => ({ valor: e.loja_id, texto: `${e.nome}${e.eh_deposito ? " (galpao)" : ""}` }))}
            />
            <CampoSelect
              rotulo="Tipo"
              nome="tipo"
              valor={sp.tipo}
              placeholder="Todos"
              opcoes={TIPOS.map((t) => ({ valor: t, texto: t.replace(/_/g, " ") }))}
            />
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="SKU, produto, motivo ou documento" />
            <CampoSelect
              rotulo="Periodo"
              nome="dias"
              valor={String(dias)}
              opcoes={[
                { valor: "7", texto: "7 dias" },
                { valor: "30", texto: "30 dias" },
                { valor: "90", texto: "90 dias" },
                { valor: "365", texto: "1 ano" },
              ]}
            />
            <button className="btn btn-primario" type="submit">Filtrar</button>
            <Link className="btn btn-neutro" href="/estoque/movimentos">Limpar</Link>
          </form>
        </Secao>

        <Secao titulo="Historico" padding={false}>
          {movimentos.length === 0 ? (
            <Vazio titulo="Nenhum movimento no periodo" descricao="Troque o filtro ou aumente o periodo." />
          ) : (
            <Tabela maxAltura={700} principal={2}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Estoque</th>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Tipo</th>
                  <th className="num">Qtd</th>
                  <th className="num">Saldo</th>
                  <th>Motivo</th>
                  <th>Documento</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => {
                  const entrada = Number(m.saldo_apos) >= Number(m.saldo_anterior);
                  const delta = Number(m.saldo_apos) - Number(m.saldo_anterior);
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{dataHoraBR(m.criado_em)}</td>
                      <td style={{ fontSize: 12 }}>
                        <span className={"tag " + (m.eh_deposito ? "tag-azul" : "tag-verde")}>{m.eh_deposito ? "Galpao" : "Loja"}</span>
                        <div style={{ fontSize: 11, color: "#7d7466" }}>{m.loja}</div>
                      </td>
                      <td>
                        <Link href={`/produtos/${m.produto_id}?aba=estoque`} style={{ fontWeight: 600, fontSize: 12.5 }}>{m.produto}</Link>
                      </td>
                      <td style={{ fontSize: 12 }}>{m.sku}</td>
                      <td><span className="tag tag-cinza">{m.tipo.replace(/_/g, " ")}</span></td>
                      <td className="num" style={{ color: entrada ? "#166b46" : "#9c2b2b", fontWeight: 600 }}>
                        {delta > 0 ? "+" : "−"}{num(Math.abs(delta))}
                      </td>
                      <td className="num">{num(m.saldo_apos)}</td>
                      <td style={{ fontSize: 12 }}>{m.motivo ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>
                        {m.documento ?? "—"}
                        {m.referencia_id && m.referencia_tipo === "venda" ? (
                          <Link href={`/vendas/${m.referencia_id}`} style={{ marginLeft: 6 }}>ver</Link>
                        ) : null}
                        {m.referencia_id && m.referencia_tipo === "transferencia" ? (
                          <Link href={`/estoque/transferencia?destaque=${m.referencia_id}`} style={{ marginLeft: 6 }}>ver</Link>
                        ) : null}
                        {m.referencia_id && m.referencia_tipo === "compra" ? (
                          <Link href="/compras" style={{ marginLeft: 6 }}>ver</Link>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 12 }}>{m.usuario ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          )}
        </Secao>
      </Conteudo>
    </>
  );
}
