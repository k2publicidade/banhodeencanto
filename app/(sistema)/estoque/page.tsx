import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num, dataHoraBR } from "@/lib/format";
import { listaFiltros } from "@/lib/consultas";
import { listarEstoques, resumoEstoqueLocal, rotuloCurto, rotuloEstoque, resolverEstoque } from "@/lib/estoques";
import {
  Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, Linha,
  SituacaoEstoque, CorBolinha, Kpi, Grade,
} from "@/components/ui";
import { acaoLancarEstoque } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

export default async function PaginaEstoque({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string; marca?: string; categoria?: string; cor?: string; msg?: string; erro?: string; ordem?: string; estoque?: string }>;
}) {
  await exigir();
  const sp = await searchParams;

  const estoques = await listarEstoques();
  const temVarios = estoques.length > 1;
  // "estoque" vazio ou 0 = visao consolidada (todos os locais somados)
  const filtroLoja = Number(sp.estoque) > 0 ? await resolverEstoque(sp.estoque) : 0;
  const local = estoques.find((e) => e.loja_id === filtroLoja);
  const escopo = filtroLoja ? `/estoque?estoque=${filtroLoja}` : "/estoque";

  const [f, r] = await Promise.all([
    listaFiltros(),
    resumoEstoqueLocal(filtroLoja || null),
  ]);

  const where: string[] = ["variacao_status = 'ativo'"];
  const params: any[] = [];
  if (sp.q) {
    where.push(`(sku ILIKE ? OR produto ILIKE ? OR cor_codigo ILIKE ?
                 OR localizacao ILIKE ? OR marca ILIKE ?)`);
    const l = "%" + sp.q + "%";
    params.push(l, l, l, l, l);
  }
  if (sp.situacao) { where.push("situacao_estoque = ?"); params.push(sp.situacao); }
  if (sp.marca) { where.push("marca = (SELECT nome FROM marcas WHERE id = ?)"); params.push(Number(sp.marca)); }
  if (sp.categoria) { where.push("(categoria = (SELECT nome FROM categorias WHERE id = ?) OR subcategoria = (SELECT nome FROM categorias WHERE id = ?))"); params.push(Number(sp.categoria), Number(sp.categoria)); }
  if (sp.cor) { where.push("cor_id = ?"); params.push(Number(sp.cor)); }
  if (filtroLoja) { where.push("loja_id = ?"); params.push(filtroLoja); }

  const ordem =
    sp.ordem === "produto" ? "produto, cor_codigo, comprimento"
    : sp.ordem === "valor" ? "valor_custo DESC"
    : sp.ordem === "local" ? "localizacao, corredor, prateleira, posicao"
    : "CASE situacao_estoque WHEN 'sem_estoque' THEN 0 WHEN 'critico' THEN 1 WHEN 'repor' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END, disponivel";
  // Em vw_estoque_posicao (visao consolidada) a coluna de valor a custo chama estoque_custo
  const ordemFinal = !filtroLoja && sp.ordem === "valor" ? "estoque_custo DESC" : ordem;

  const origemItens = filtroLoja ? "vw_estoque_loja" : "vw_estoque_posicao";
  const base = `FROM ${origemItens} WHERE ${where.join(" AND ")} ORDER BY ${ordemFinal} LIMIT 500`;
  // As duas views guardam o saldo em colunas diferentes (local = quantidade,
  // consolidado = estoque); a consulta normaliza para `quantidade`.
  const campoQtd = filtroLoja ? "quantidade" : "estoque";
  const campoLoja = filtroLoja ? "loja_id" : "CAST(NULL AS INTEGER) AS loja_id";

  const [itens, movimentos] = await Promise.all([
    all<any>(
      `SELECT variacao_id, ${campoLoja}, sku, ean, produto, produto_id, marca, linha, categoria, cor, cor_codigo, cor_hex,
              comprimento, comprimento_unidade, custo_medio, preco_venda, margem_percentual, ${campoQtd} AS quantidade,
              disponivel, estoque_min, estoque_max, ponto_reposicao, localizacao, corredor, prateleira, posicao,
              unidade_estoque, situacao_estoque, valor_custo, valor_venda
       ${base}`,
      ...params
    ),
    all<any>(
      `SELECT m.id, m.tipo, m.quantidade, m.saldo_apos, m.motivo, m.documento, m.criado_em, m.referencia_tipo,
              v.sku, p.nome produto, u.nome usuario, l.nome loja, l.eh_deposito
       FROM estoque_movimentos m
       JOIN variacoes v ON v.id = m.variacao_id
       JOIN produtos p ON p.id = v.produto_id
       JOIN lojas l ON l.id = m.loja_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       ${filtroLoja ? "WHERE m.loja_id = ?" : ""}
       ORDER BY m.id DESC LIMIT 25`,
      ...(filtroLoja ? [filtroLoja] : [])
    ),
  ]);

  // Saldo de cada estoque por SKU (para as colunas quando a visao e consolidada)
  const saldos: Record<number, Record<number, number>> = {};
  if (!filtroLoja && temVarios && itens.length) {
    const linhas = await all<any>(
      `SELECT e.variacao_id, e.loja_id, e.quantidade FROM estoque e
       WHERE e.variacao_id IN (SELECT variacao_id ${base})`,
      ...params
    );
    for (const l of linhas) {
      (saldos[l.variacao_id] ??= {})[l.loja_id] = Number(l.quantidade);
    }
  }

  const totalListado = itens.reduce((s, i) => s + Number(i.valor_custo ?? 0), 0);
  const pecasListadas = itens.reduce((s, i) => s + Number(i.quantidade ?? 0), 0);

  const opcoesSku = await all<any>(
    `SELECT variacao_id, sku, produto, cor_codigo, comprimento, comprimento_unidade, disponivel
     FROM vw_estoque_posicao WHERE variacao_status='ativo'
     ORDER BY produto, cor_codigo, comprimento`
  );

  const filtrosQ = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "estoque") filtrosQ.set(k, String(v));

  return (
    <>
      <Cabecalho
        titulo="Estoques"
        subtitulo={
          local
            ? `${local.nome} (${local.tipo === "deposito" ? "galpao / centro de distribuicao" : "loja"}) • ${num(r.pecas)} pecas • ${moeda(r.valor_custo)} a custo`
            : `${estoques.length} estoque(s) • ${num(r.pecas)} pecas no total • ${moeda(r.valor_custo)} a custo`
        }
        acoes={
          <>
            <a className="btn btn-neutro" href="/api/exportar/estoque">Exportar CSV</a>
            <Link className="btn btn-neutro" href="/estoque/movimentos">Historico</Link>
            <Link className="btn btn-primario" href="/estoque/transferencia">Transferir entre estoques</Link>
          </>
        }
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Secao
          titulo="Estoques separados"
          descricao="Cada estoque tem saldo proprio por SKU. Clique para ver a posicao de um estoque ou fique no consolidado."
        >
          <Grade colunas={Math.min(estoques.length + 1, 4)}>
            <Kpi
              rotulo="Consolidado (todos)"
              valor={num(estoques.reduce((s, e) => s + Number(e.pecas), 0)) + " pecas"}
              detalhe={`${moeda(estoques.reduce((s, e) => s + Number(e.valor_custo), 0))} a custo`}
              variante={!filtroLoja ? "teal" : "claro"}
              href={`/estoque${filtrosQ.toString() ? "?" + filtrosQ.toString() : ""}`}
            />
            {estoques.map((e) => (
              <Kpi
                key={e.loja_id}
                rotulo={rotuloEstoque(e)}
                valor={num(e.pecas) + " pecas"}
                detalhe={`${e.skus} SKU(s) com saldo • ${moeda(e.valor_custo)} a custo${e.padrao ? " • vende no PDV" : ""}`}
                variante={filtroLoja === e.loja_id ? "ouro" : "claro"}
                href={`/estoque?estoque=${e.loja_id}${filtrosQ.toString() ? "&" + filtrosQ.toString() : ""}`}
              />
            ))}
          </Grade>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <Link className="btn btn-sm btn-neutro" href="/configuracoes/lojas">Gerenciar os estoques (criar, editar, padrao de venda)</Link>
            {temVarios ? (
              <Link className="btn btn-sm btn-neutro" href="/estoque/movimentos">Ver todas as movimentacoes</Link>
            ) : (
              <Link className="btn btn-sm btn-neutro" href="/configuracoes/lojas">Criar um segundo estoque (galpao)</Link>
            )}
          </div>
        </Secao>

        <Grade colunas={5}>
          <Kpi rotulo="Valor a custo" valor={moeda(r.valor_custo)} detalhe={filtroLoja ? `em ${local?.nome}` : "todos os estoques"} variante="teal" />
          <Kpi rotulo="Valor a preco de venda" valor={moeda(r.valor_venda)} detalhe={`Potencial de lucro ${moeda(r.valor_venda - r.valor_custo)}`} />
          <Kpi rotulo="SKUs sem estoque" valor={String(r.sem_estoque)} detalhe={filtroLoja ? "Neste estoque" : "Nenhum estoque"} variante={r.sem_estoque > 0 ? "vermelho" : "claro"} href={`${escopo}${filtroLoja ? "&" : "?"}situacao=sem_estoque`} />
          <Kpi rotulo="Abaixo do minimo" valor={String(r.criticos)} detalhe="Repor com urgencia" variante={r.criticos > 0 ? "amarelo" : "claro"} href={`${escopo}${filtroLoja ? "&" : "?"}situacao=critico`} />
          <Kpi rotulo="No ponto de reposicao" valor={String(r.repor)} detalhe="Programar compra" variante={r.repor > 0 ? "amarelo" : "claro"} href={`${escopo}${filtroLoja ? "&" : "?"}situacao=repor`} />
        </Grade>

        <Secao
          titulo="Movimentar estoque"
          descricao="Entrada (compra / devolucao), saida, perda, inventario. O movimento sempre entra ou sai de um estoque escolhido."
        >
          <form action={acaoLancarEstoque}>
            <input type="hidden" name="__volta" value={escopo} />
            <Linha colunas="2.2fr 1.2fr 1fr 1fr">
              <div>
                <label htmlFor="variacao_id">SKU</label>
                <select id="variacao_id" name="variacao_id" required defaultValue="">
                  <option value="">— selecione o SKU —</option>
                  {opcoesSku.map((o) => (
                    <option key={o.variacao_id} value={o.variacao_id}>
                      {o.produto} | {o.cor_codigo ?? "-"} {o.comprimento ? `| ${o.comprimento}${o.comprimento_unidade}` : ""} | {o.sku} (total {o.disponivel})
                    </option>
                  ))}
                </select>
              </div>
              <CampoSelect
                rotulo="Tipo de movimento"
                nome="tipo"
                valor="entrada"
                opcoes={[
                  { valor: "entrada", texto: "Entrada (compra / devolucao de cliente)" },
                  { valor: "saida", texto: "Saida (uso interno, amostra, brinde)" },
                  { valor: "perda", texto: "Perda / avaria / roubo" },
                  { valor: "inventario", texto: "Inventario (informar o novo saldo)" },
                  { valor: "ajuste", texto: "Ajuste (definir novo saldo)" },
                ]}
              />
              <Campo rotulo="Quantidade" nome="quantidade" placeholder="12" obrigatorio ajuda="No inventario, este e o novo saldo" />
              <Campo rotulo="Custo unitario (R$)" nome="custo" placeholder="9,50" ajuda="Recalcula o custo medio ponderado" />
            </Linha>
            <Linha colunas="2fr 1fr 1.2fr auto">
              <Campo rotulo="Motivo / observacao" nome="motivo" placeholder="Ex: compra NF 12345, avaria no transporte, contagem mensal" />
              <Campo rotulo="Documento" nome="documento" placeholder="NF 12345" />
              <CampoSelect
                rotulo="Estoque"
                nome="loja_id"
                valor={filtroLoja || estoques.find((e) => e.padrao === 1)?.loja_id || estoques[0]?.loja_id}
                opcoes={estoques.map((e) => ({ valor: e.loja_id, texto: `${e.nome}${e.eh_deposito ? " (galpao)" : ""}` }))}
                ajuda="Galpao guarda, loja vende. Para trocar de local use a transferencia."
              />
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn btn-primario" type="submit">Lancar movimento</button>
              </div>
            </Linha>
          </form>
        </Secao>

        <Secao titulo="Filtros" descricao={`${itens.length} SKU(s) • ${num(pecasListadas)} pecas • ${moeda(totalListado)} a custo`}>
          <form method="get" className="grade-form" style={{ "--cols-desktop": "2fr 1fr 1fr 1fr 1fr 1fr 1fr auto auto" } as React.CSSProperties}>
            {filtroLoja ? <input type="hidden" name="estoque" value={filtroLoja} /> : null}
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="Produto, SKU, cor ou localizacao" />
            <CampoSelect
              rotulo="Situacao"
              nome="situacao"
              valor={sp.situacao}
              placeholder="Todas"
              opcoes={[
                { valor: "sem_estoque", texto: "Sem estoque" },
                { valor: "critico", texto: "Critico (abaixo do minimo)" },
                { valor: "repor", texto: "Repor (ponto de reposicao)" },
                { valor: "ok", texto: "OK" },
                { valor: "excesso", texto: "Excesso" },
              ]}
            />
            <CampoSelect rotulo="Marca" nome="marca" valor={sp.marca} placeholder="Todas" opcoes={f.marcas.map((m) => ({ valor: m.id, texto: m.nome }))} />
            <CampoSelect rotulo="Categoria" nome="categoria" valor={sp.categoria} placeholder="Todas" opcoes={f.categoriasPai.map((c) => ({ valor: c.id, texto: c.nome }))} />
            <CampoSelect
              rotulo="Cor"
              nome="cor"
              valor={sp.cor}
              placeholder="Todas"
              opcoes={f.cores.map((c) => ({ valor: c.id, texto: `${c.codigo} - ${c.nome}` }))}
            />
            <CampoSelect
              rotulo="Ordenar"
              nome="ordem"
              valor={sp.ordem}
              placeholder="Situacao"
              opcoes={[
                { valor: "situacao", texto: "Situacao" },
                { valor: "produto", texto: "Produto" },
                { valor: "valor", texto: "Valor em estoque" },
                { valor: "local", texto: "Localizacao fisica" },
              ]}
            />
            <button className="btn btn-primario" type="submit">Filtrar</button>
            <Link className="btn btn-neutro" href={escopo}>Limpar</Link>
          </form>
        </Secao>

        <Secao
          titulo={local ? `Posicao de estoque • ${local.nome}` : "Posicao de estoque consolidada"}
          descricao={local ? "Este e o saldo deste estoque, separado dos demais" : "Soma de todos os estoques com a quebra por local"}
          padding={false}
        >
          {itens.length === 0 ? (
            <Vazio titulo="Nenhum SKU encontrado" descricao="Ajuste os filtros ou cadastre produtos com variacoes." />
          ) : (
            <Tabela maxAltura={620} principal={1}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Cor / Comp.</th>
                  {!filtroLoja ? <th>Localizacao</th> : null}
                  {!filtroLoja && temVarios
                    ? estoques.map((e) => <th className="num" key={e.loja_id}>{rotuloCurto(e)}</th>)
                    : null}
                  <th className="num">{filtroLoja ? "Saldo" : "Total"}</th>
                  <th className="num">Disp.</th>
                  <th className="num">Min.</th>
                  <th className="num">Custo</th>
                  <th className="num">Valor</th>
                  <th>Situacao</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={`${i.variacao_id}-${i.loja_id ?? 0}`}>
                    <td style={{ fontWeight: 600, fontSize: 12.5 }}>{i.sku}</td>
                    <td>
                      <Link href={`/produtos/${i.produto_id}?aba=estoque`} style={{ color: "#0a5c6b", fontWeight: 600 }}>
                        {i.produto}
                      </Link>
                      <div style={{ fontSize: 11, color: "#7d7466" }}>{i.marca ?? ""} {i.categoria ? `• ${i.categoria}` : ""}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      <CorBolinha hex={i.cor_hex} codigo={i.cor_codigo} />
                      {i.comprimento ? <div>{i.comprimento}{i.comprimento_unidade}</div> : null}
                    </td>
                    {!filtroLoja ? (
                      <td style={{ fontSize: 12 }}>
                        {[i.localizacao, i.corredor, i.prateleira, i.posicao].filter(Boolean).join(" ") || "—"}
                      </td>
                    ) : null}
                    {!filtroLoja && temVarios
                      ? estoques.map((e) => {
                          const q = saldos[i.variacao_id]?.[e.loja_id] ?? 0;
                          return (
                            <td className="num" key={e.loja_id} style={{ color: q > 0 ? "#166b46" : "#a09889" }}>
                              {q > 0 ? num(q) : "—"}
                            </td>
                          );
                        })
                      : null}
                    <td className="num"><strong>{num(i.quantidade)}</strong></td>
                    <td className="num">{num(i.disponivel)}</td>
                    <td className="num">{num(i.estoque_min)}</td>
                    <td className="num">{moeda(i.custo_medio)}</td>
                    <td className="num">{moeda(i.valor_custo ?? Number(i.quantidade) * Number(i.custo_medio))}</td>
                    <td><SituacaoEstoque situacao={i.situacao_estoque} disponivel={i.disponivel} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link className="btn btn-sm btn-neutro" href={`/produtos/${i.produto_id}/variacao/${i.variacao_id}`}>Ver</Link>
                      {temVarios ? (
                        <Link
                          className="btn btn-sm btn-neutro"
                          style={{ marginLeft: 6 }}
                          href={`/estoque/transferencia?item=${i.variacao_id}${filtroLoja ? `&origem=${filtroLoja}` : ""}`}
                        >
                          Transferir
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao
          titulo="Ultimas movimentacoes"
          descricao={filtroLoja ? `Somente ${local?.nome}` : "Todos os estoques"}
          acoes={<Link className="btn btn-sm btn-neutro" href="/estoque/movimentos">Historico completo</Link>}
          padding={false}
        >
          {movimentos.length === 0 ? (
            <Vazio titulo="Sem movimentacoes" />
          ) : (
            <Tabela maxAltura={430}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Estoque</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Tipo</th>
                  <th className="num">Qtd</th>
                  <th className="num">Saldo</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => {
                  const entrada = ["entrada", "devolucao", "cancelamento", "transferencia_entrada", "inventario"].includes(m.tipo);
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{dataHoraBR(m.criado_em)}</td>
                      <td style={{ fontSize: 12 }}>
                        <span className={"tag " + (m.eh_deposito ? "tag-azul" : "tag-verde")}>{m.eh_deposito ? "Galpao" : "Loja"}</span>
                        <div style={{ fontSize: 11, color: "#7d7466" }}>{m.loja}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{m.sku}</td>
                      <td style={{ fontSize: 12.5 }}>{m.produto}</td>
                      <td><span className="tag tag-cinza">{m.tipo.replace(/_/g, " ")}</span></td>
                      <td className="num" style={{ color: entrada ? "#166b46" : "#9c2b2b", fontWeight: 600 }}>
                        {entrada ? "+" : "−"}{num(m.quantidade)}
                      </td>
                      <td className="num">{num(m.saldo_apos)}</td>
                      <td style={{ fontSize: 12 }}>{m.motivo ?? "—"}{m.documento ? ` (${m.documento})` : ""}</td>
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
