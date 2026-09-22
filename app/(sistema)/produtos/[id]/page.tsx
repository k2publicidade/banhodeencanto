import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, pct, num, dataBR, dataHoraBR, arred } from "@/lib/format";
import { listaFiltros, fornecedoresComparativo } from "@/lib/consultas";
import {
  Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, CampoArea, Linha,
  TagStatus, CorBolinha, SituacaoEstoque, Kpi, Grade, Barra,
} from "@/components/ui";
import {
  postSalvarBloco, postGerarVariacoes, postAjustarPrecos, postAplicarEstoque,
  postVincularFornecedor, postRemoverFornecedor, postExcluirProduto, postExcluirVariacao,
} from "@/app/actions/produto-form";

export const dynamic = "force-dynamic";

const ABAS = [
  { id: "identificacao", rotulo: "1. Identificacao" },
  { id: "cabelos", rotulo: "2. Cabelos" },
  { id: "variacoes", rotulo: "3. Variacoes / SKUs" },
  { id: "precos", rotulo: "4. Comercial e precos" },
  { id: "estoque", rotulo: "5. Estoque" },
  { id: "fornecedores", rotulo: "6. Fornecedores" },
  { id: "fiscal", rotulo: "7. Fiscal" },
  { id: "site", rotulo: "8. E-commerce" },
  { id: "gestao", rotulo: "9. Gestao" },
];

export default async function PaginaProduto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; msg?: string; erro?: string }>;
}) {
  await exigir();
  const { id } = await params;
  const sp = await searchParams;
  const produtoId = Number(id);
  const aba = ABAS.some((a) => a.id === sp.aba) ? sp.aba! : "identificacao";

  const p = await one<any>(
    `SELECT p.*, m.nome marca, lc.nome linha, cat.nome categoria, sub.nome subcategoria,
            tp.nome tipo_produto, mat.nome material, tf.nome fibra, tx.nome textura,
            tec.nome tecnica, pub.nome publico, co.nome cor_padrao, co.codigo cor_padrao_codigo, co.hex cor_padrao_hex,
            cp.rotulo comprimento_padrao
     FROM produtos p
     LEFT JOIN marcas m ON m.id = p.marca_id
     LEFT JOIN linhas_colecao lc ON lc.id = p.linha_id
     LEFT JOIN categorias cat ON cat.id = p.categoria_id
     LEFT JOIN categorias sub ON sub.id = p.subcategoria_id
     LEFT JOIN tipos_produto tp ON tp.id = p.tipo_produto_id
     LEFT JOIN materiais mat ON mat.id = p.material_id
     LEFT JOIN tipos_fibra tf ON tf.id = p.tipo_fibra_id
     LEFT JOIN texturas tx ON tx.id = p.textura_id
     LEFT JOIN tecnicas tec ON tec.id = p.tecnica_id
     LEFT JOIN publicos pub ON pub.id = p.publico_id
     LEFT JOIN cores co ON co.id = p.cor_id
     LEFT JOIN comprimentos cp ON cp.id = p.comprimento_id
     WHERE p.id = ?`,
    produtoId
  );
  if (!p) notFound();

  const [f, variacoes, vinculos, metricas] = await Promise.all([
    listaFiltros(),
    all<any>(
      `SELECT * FROM vw_estoque_posicao WHERE produto_id = ? ORDER BY cor_codigo, comprimento`,
      produtoId
    ),
    all<any>(
      `SELECT pf.*, fo.nome_fantasia, fo.razao_social, vv.sku, vv.cor_codigo, vv.comprimento, vv.comprimento_unidade
       FROM produto_fornecedor pf
       JOIN fornecedores fo ON fo.id = pf.fornecedor_id
       LEFT JOIN vw_variacoes vv ON vv.variacao_id = pf.variacao_id
       WHERE pf.produto_id = ?
       ORDER BY pf.principal DESC, pf.custo`,
      produtoId
    ),
    one<any>(
      `SELECT COUNT(*) skus, SUM(estoque) pecas, SUM(estoque_custo) estoque_custo, SUM(estoque_venda) estoque_venda,
              AVG(margem_percentual) margem_media, MIN(preco_venda) preco_min, MAX(preco_venda) preco_max
       FROM vw_estoque_posicao WHERE produto_id = ?`,
      produtoId
    ),
  ]);

  const vendas = await one<any>(
    `SELECT COALESCE(SUM(vi.quantidade),0) pecas, COALESCE(SUM(vi.total),0) receita,
            COALESCE(SUM(vi.total - vi.quantidade*vi.custo_unitario),0) lucro,
            MIN(v.data) primeira, MAX(v.data) ultima, COUNT(DISTINCT v.id) num_vendas
     FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
     JOIN variacoes v2 ON v2.id = vi.variacao_id
     WHERE v2.produto_id = ? AND v.status <> 'cancelada'`,
    produtoId
  ) ?? {};

  const rankingGlobal = await all<{ variacao_id: number; receita: number; acumulado: number }>(
    `WITH r AS (
       SELECT vi.variacao_id, SUM(vi.total) receita
       FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
       WHERE v.status='concluida' AND CAST(v.data AS DATE) >= ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '90 days')::date
       GROUP BY vi.variacao_id
     )
     SELECT variacao_id, receita,
            (SELECT SUM(receita) FROM r r2 WHERE r2.receita >= r.receita) * 100.0 /
            (SELECT SUM(receita) FROM r) AS acumulado
     FROM r`
  );
  const somaReceitaRank = rankingGlobal.reduce((s, r) => s + r.receita, 0) || 1;

  const porMes = await all<any>(
    `SELECT to_char(v.data::timestamp, 'YYYY-MM') mes, COUNT(DISTINCT v.id) vendas, SUM(vi.quantidade) pecas, SUM(vi.total) receita
     FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
     JOIN variacoes v2 ON v2.id = vi.variacao_id
     WHERE v2.produto_id = ? AND v.status <> 'cancelada'
     GROUP BY to_char(v.data::timestamp, 'YYYY-MM') ORDER BY mes DESC LIMIT 12`,
    produtoId
  );

  const camposId = "sku,ean,nome,nome_reduzido,marca_id,linha_id,categoria_id,subcategoria_id,status";
  const camposCab = "tipo_produto_id,material_id,tipo_fibra_id,modelo_estilo,textura_id,tecnica_id,publico_id,observacoes_tecnicas,cor_id,comprimento_id";
  const camposFiscal = "ncm,cest,origem_mercadoria,unidade_comercial,classificacao_fiscal,tributacao,observacao_fiscal";
  const camposSite = "nome_site,descricao_curta,descricao_completa,caracteristicas,modo_uso,cuidados,foto_principal,galeria,video,tags,destaque,exibir_site,ordem_exibicao,slug";

  const optsMarca = f.marcas.map((m) => ({ valor: m.id, texto: m.nome }));
  const optsCategoria = f.categoriasPai.map((c) => ({ valor: c.id, texto: c.nome }));
  const optsSub = f.subcategorias.map((c) => ({ valor: c.id, texto: c.nome }));

  return (
    <>
      <Cabecalho
        titulo={p.nome}
        subtitulo={`${p.sku ?? "sem SKU"} • ${p.tipo_produto ?? "tipo nao definido"} • ${variacoes.length} SKU(s) • ${p.marca ?? "sem marca"}`}
        acoes={
          <>
            <TagStatus status={p.status} />
            <Link className="btn btn-neutro" href="/produtos">Voltar</Link>
            <Link className="btn btn-neutro" href={`/produtos/${produtoId}/etiquetas`}>Etiquetas</Link>
          </>
        }
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}
        {p.status !== "ativo" ? (
          <div className="aviso aviso-info">
            Este produto esta <strong>{p.status}</strong> e nao aparece para venda no PDV.
          </div>
        ) : null}
        {variacoes.length === 0 ? (
          <div className="aviso aviso-info">
            <strong>Este produto ainda nao tem variacoes/SKUs.</strong>{" "}
            <span style={{ color: "#7d7466" }}>
              Sem variacao nao existe estoque, custo nem preco. Va na aba{" "}
              <Link href={`/produtos/${produtoId}?aba=variacoes`} style={{ color: "#0a5c6b", fontWeight: 700 }}>3. Variacoes / SKUs</Link>{" "}
              e gere as combinacoes de cor e comprimento.
            </span>
          </div>
        ) : null}

        <Grade colunas={5}>
          <Kpi rotulo="SKUs" valor={String(metricas?.skus ?? 0)} detalhe={`${pct(metricas?.margem_media)} margem media`} />
          <Kpi rotulo="Estoque" valor={`${num(metricas?.pecas)} un`} detalhe={`a custo ${moeda(metricas?.estoque_custo)}`} />
          <Kpi rotulo="Estoque a venda" valor={moeda(metricas?.estoque_venda)} detalhe={`potencial ${moeda((metricas?.estoque_venda ?? 0) - (metricas?.estoque_custo ?? 0))}`} />
          <Kpi rotulo="Vendido (total)" valor={`${num(vendas.pecas)} un`} detalhe={`${moeda(vendas.receita)} em ${vendas.num_vendas ?? 0} vendas`} variante="verde" />
          <Kpi rotulo="Preco" valor={metricas?.preco_min === metricas?.preco_max ? moeda(metricas?.preco_min) : `${moeda(metricas?.preco_min)} – ${moeda(metricas?.preco_max)}`} detalhe={`Lucro acumulado ${moeda(vendas.lucro)}`} />
        </Grade>

        {/* ------------------ ABAS ------------------ */}
        <div className="card" style={{ marginBottom: 18, padding: "0 8px", display: "flex", gap: 2, overflowX: "auto" }}>
          {ABAS.map((a) => (
            <Link key={a.id} href={`/produtos/${produtoId}?aba=${a.id}`} className={"aba" + (aba === a.id ? " ativa" : "")}>
              {a.rotulo}
            </Link>
          ))}
        </div>

        {/* ============================================================ */}
        {/* 1. IDENTIFICACAO                                             */}
        {/* ============================================================ */}
        {aba === "identificacao" ? (
          <form action={postSalvarBloco}>
            <input type="hidden" name="id_produto" value={produtoId} />
            <input type="hidden" name="__aba" value="identificacao" />
            <input type="hidden" name="__campos" value={camposId} />
            <Secao titulo="1. Identificacao do produto" descricao="Dados que identificam o produto-pai no catalogo">
              <Linha colunas="repeat(auto-fit,minmax(220px,1fr))">
                <Campo rotulo="SKU do produto (pai)" nome="sku" valor={p.sku} placeholder="BDE-JUB01" ajuda="Codigo interno unico do produto pai" />
                <Campo rotulo="Codigo de barras (EAN/GTIN)" nome="ean" valor={p.ean} placeholder="Somente se o fabricante informar" />
                <Campo rotulo="Data de cadastro" nome="criado_em" valor={dataBR(p.criado_em)} disabled />
              </Linha>
              <Linha colunas="2fr 1fr">
                <Campo rotulo="Nome do produto" nome="nome" valor={p.nome} obrigatorio placeholder="Jumbo Ultra Braid" />
                <Campo rotulo="Nome reduzido" nome="nome_reduzido" valor={p.nome_reduzido} ajuda="Aparece no cupom e na etiqueta" />
              </Linha>
              <Linha colunas="repeat(auto-fit,minmax(190px,1fr))">
                <CampoSelect rotulo="Marca" nome="marca_id" valor={p.marca_id} opcoes={optsMarca} />
                <CampoSelect rotulo="Linha / colecao" nome="linha_id" valor={p.linha_id} opcoes={f.linhas.map((l) => ({ valor: l.id, texto: l.nome }))} />
                <CampoSelect rotulo="Categoria" nome="categoria_id" valor={p.categoria_id} opcoes={optsCategoria} />
                <CampoSelect rotulo="Subcategoria" nome="subcategoria_id" valor={p.subcategoria_id} opcoes={optsSub} />
                <CampoSelect
                  rotulo="Status"
                  nome="status"
                  valor={p.status}
                  opcoes={[
                    { valor: "ativo", texto: "Ativo" },
                    { valor: "inativo", texto: "Inativo" },
                    { valor: "descontinuado", texto: "Descontinuado" },
                  ]}
                />
              </Linha>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-primario" type="submit">Salvar identificacao</button>
                <Link className="btn btn-neutro" href="/cadastros">Gerenciar marcas e categorias</Link>
              </div>
            </Secao>
          </form>
        ) : null}

        {/* ============================================================ */}
        {/* 2. CABELOS                                                   */}
        {/* ============================================================ */}
        {aba === "cabelos" ? (
          <form action={postSalvarBloco}>
            <input type="hidden" name="id_produto" value={produtoId} />
            <input type="hidden" name="__aba" value="cabelos" />
            <input type="hidden" name="__campos" value={camposCab} />
            <Secao
              titulo="2. Classificacao especifica - cabelos"
              descricao="E o que faz o sistema refletir o negocio da loja, e nao virar um ERP generico"
            >
              <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
                <CampoSelect rotulo="Tipo de produto" nome="tipo_produto_id" valor={p.tipo_produto_id} opcoes={f.tiposProduto.map((t) => ({ valor: t.id, texto: t.nome }))} />
                <CampoSelect rotulo="Material / fibra base" nome="material_id" valor={p.material_id} opcoes={f.materiais.map((t) => ({ valor: t.id, texto: t.nome }))} />
                <CampoSelect rotulo="Tipo de fibra" nome="tipo_fibra_id" valor={p.tipo_fibra_id} opcoes={f.fibras.map((t) => ({ valor: t.id, texto: t.nome }))} />
              </Linha>
              <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
                <Campo rotulo="Modelo / estilo" nome="modelo_estilo" valor={p.modelo_estilo} placeholder="Jumbo Ultra Braid" />
                <CampoSelect rotulo="Textura" nome="textura_id" valor={p.textura_id} opcoes={f.texturas.map((t) => ({ valor: t.id, texto: t.nome }))} />
                <CampoSelect rotulo="Tecnica / indicacao" nome="tecnica_id" valor={p.tecnica_id} opcoes={f.tecnicas.map((t) => ({ valor: t.id, texto: t.nome }))} />
                <CampoSelect rotulo="Publico / indicacao" nome="publico_id" valor={p.publico_id} opcoes={f.publicos.map((t) => ({ valor: t.id, texto: t.nome }))} />
              </Linha>

              <div style={{ background: "#faf8f4", border: "1px solid #e7e1d6", borderRadius: 11, padding: 14, marginTop: 6 }}>
                <strong style={{ fontSize: 13.5 }}>Atributos que geram variacao</strong>
                <p style={{ fontSize: 12.5, color: "#7d7466", margin: "4px 0 12px" }}>
                  Estes dois campos definem quais combinacoes o gerador de SKUs vai criar na aba 3. Cor e comprimento
                  ficam na variacao (cada combinacao tem seu proprio SKU, EAN, custo, preco e estoque).
                </p>
                <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
                  <CampoSelect rotulo="Cor padrao" nome="cor_id" valor={p.cor_id} opcoes={f.cores.map((c) => ({ valor: c.id, texto: `${c.codigo} - ${c.nome}` }))} />
                  <CampoSelect rotulo="Comprimento padrao" nome="comprimento_id" valor={p.comprimento_id} opcoes={f.comprimentos.map((c) => ({ valor: c.id, texto: c.rotulo }))} />
                </Linha>
              </div>

              <div style={{ marginTop: 12 }}>
                <CampoArea
                  rotulo="Observacoes tecnicas"
                  nome="observacoes_tecnicas"
                  valor={p.observacoes_tecnicas}
                  linhas={3}
                  placeholder="Ex: fibra resistente a calor ate 120C, indicada para tranças de longa duracao"
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-primario" type="submit">Salvar classificacao</button>
              </div>
            </Secao>
          </form>
        ) : null}

        {/* ============================================================ */}
        {/* 3. VARIACOES                                                 */}
        {/* ============================================================ */}
        {aba === "variacoes" ? (
          <>
            <Secao
              titulo="Gerar variacoes automaticamente"
              descricao="Escolha as cores e os comprimentos: o sistema cria os SKUs que faltam, cada um com EAN, custo, preco e estoque proprios"
            >
              <form action={postGerarVariacoes}>
                <input type="hidden" name="id_produto" value={produtoId} />
                <div className="grade-responsiva" style={{ gap: 18 }}>
                  <div>
                    <label style={{ marginBottom: 8 }}>Cores ({f.cores.length} disponiveis)</label>
                    <div style={{ maxHeight: 210, overflowY: "auto", border: "1px solid #e7e1d6", borderRadius: 9, padding: 9, background: "#fff" }}>
                      {f.cores.map((c) => (
                        <label
                          key={c.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, textTransform: "none", letterSpacing: 0,
                            fontWeight: 400, fontSize: 13.5, color: "#3a352e", padding: "3px 0", marginBottom: 0, cursor: "pointer",
                          }}
                        >
                          <input type="checkbox" name="cores" value={c.id} defaultChecked={["1", "1B", "2", "613"].includes(c.codigo)} style={{ width: "auto" }} />
                          <span style={{ width: 13, height: 13, borderRadius: 4, background: c.hex, border: "1px solid #d5ccba" }} />
                          <strong style={{ minWidth: 44 }}>{c.codigo}</strong>
                          <span style={{ color: "#7d7466" }}>{c.nome}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ marginBottom: 8 }}>Comprimentos</label>
                    <div style={{ maxHeight: 210, overflowY: "auto", border: "1px solid #e7e1d6", borderRadius: 9, padding: 9, background: "#fff" }}>
                      {f.comprimentos.map((c) => (
                        <label
                          key={c.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, textTransform: "none", letterSpacing: 0,
                            fontWeight: 400, fontSize: 13.5, color: "#3a352e", padding: "3px 0", marginBottom: 0, cursor: "pointer",
                          }}
                        >
                          <input type="checkbox" name="comprimentos" value={c.id} style={{ width: "auto" }} />
                          {c.rotulo}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <Linha colunas="repeat(3, 1fr)" gap={12}>
                  <Campo rotulo="Custo base de aquisicao (R$)" nome="custo_base" placeholder="9,50" ajuda="Custo do comprimento padrao" />
                  <Campo rotulo="Markup desejado" nome="markup" placeholder="2,4" ajuda="Preco = custo x markup" />
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button className="btn btn-ouro" type="submit" style={{ width: "100%" }}>Gerar SKUs que faltam</button>
                  </div>
                </Linha>
                <p style={{ fontSize: 12.5, color: "#7d7466", margin: 0 }}>
                  Combinacoes ja existentes sao preservadas com seus valores atuais - nada e sobrescrito.
                </p>
              </form>
            </Secao>

            <Secao
              titulo={`${variacoes.length} variacao(oes) / SKU(s)`}
              descricao="Cada SKU tem SKU, EAN, cor, comprimento, peso, custo, preco, estoque e fornecedor proprios"
              padding={false}
            >
              {variacoes.length === 0 ? (
                <Vazio titulo="Nenhuma variacao cadastrada" descricao="Use o gerador acima para criar as combinacoes." />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Cor</th>
                      <th>Comp.</th>
                      <th className="num">Custo</th>
                      <th className="num">Preco</th>
                      <th className="num">Margem</th>
                      <th className="num">Estoque</th>
                      <th>Local</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variacoes.map((v) => (
                      <tr key={v.variacao_id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{v.sku}</div>
                          <div style={{ fontSize: 11, color: "#7d7466" }}>{v.ean}</div>
                        </td>
                        <td><CorBolinha hex={v.cor_hex} codigo={v.cor_codigo} /></td>
                        <td>{v.comprimento ? `${v.comprimento}${v.comprimento_unidade}` : "—"}</td>
                        <td className="num">{moeda(v.custo_medio)}</td>
                        <td className="num">
                          <strong>{moeda(v.preco_venda)}</strong>
                          {v.preco_promocional ? <div style={{ fontSize: 11, color: "#8a5a12" }}>promo {moeda(v.preco_promocional)}</div> : null}
                        </td>
                        <td className="num" style={{ color: (v.margem_percentual ?? 0) < 25 ? "#9c2b2b" : "#166b46" }}>
                          {pct(v.margem_percentual)}
                          <div style={{ fontSize: 10.5, color: "#7d7466" }}>{v.markup ? v.markup.toFixed(2) + "x" : "—"}</div>
                        </td>
                        <td className="num"><SituacaoEstoque situacao={v.situacao_estoque} disponivel={v.disponivel} /></td>
                        <td style={{ fontSize: 11.5, color: "#7d7466" }}>
                          {[v.localizacao, v.corredor, v.prateleira, v.posicao].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 5 }}>
                            <Link className="btn btn-sm btn-neutro" href={`/produtos/${produtoId}/variacao/${v.variacao_id}`}>Editar</Link>
                            <form action={postExcluirVariacao}>
                              <input type="hidden" name="id_produto" value={produtoId} />
                              <input type="hidden" name="variacao_id" value={v.variacao_id} />
                              <button className="btn btn-sm btn-perigo" title="Excluir SKU">×</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </>
        ) : null}

        {/* ============================================================ */}
        {/* 4. PRECOS                                                    */}
        {/* ============================================================ */}
        {aba === "precos" ? (
          <>
            <Secao
              titulo="Ajuste de precos em lote"
              descricao="Margem, markup e percentuais sao sempre calculados pelo sistema - nunca digitados"
            >
              <form action={postAjustarPrecos}>
                <input type="hidden" name="id_produto" value={produtoId} />
                <Linha colunas="220px 200px auto">
                  <CampoSelect
                    rotulo="Modo de ajuste"
                    nome="modo"
                    valor="markup"
                    opcoes={[
                      { valor: "markup", texto: "Definir markup (preco = custo x)" },
                      { valor: "margem", texto: "Definir margem liquida (%)" },
                      { valor: "percentual", texto: "Reajuste percentual (%)" },
                    ]}
                  />
                  <Campo rotulo="Valor" nome="valor" placeholder="2,4" obrigatorio />
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button className="btn btn-ouro" type="submit">Aplicar a todos os SKUs</button>
                  </div>
                </Linha>
                <p style={{ fontSize: 12.5, color: "#7d7466", margin: 0 }}>
                  Ex.: markup <strong>2,4</strong> = preco 2,4x o custo medio. Margem <strong>50</strong> = preco que deixa 50% de margem.
                  Percentual <strong>10</strong> = aumenta 10% o preco atual. Cada alteracao fica registrada no historico de precos.
                </p>
              </form>
            </Secao>

            <Secao titulo="Tabela comercial por SKU" descricao="Custo medio, ultimo custo, preco, margem, markup e preco minimo autorizado" padding={false}>
              {variacoes.length === 0 ? (
                <Vazio titulo="Sem SKUs para precificar" />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th className="num">Custo aquisicao</th>
                      <th className="num">Custo medio</th>
                      <th className="num">Ultimo custo</th>
                      <th className="num">Preco venda</th>
                      <th className="num">Promocional</th>
                      <th className="num">Margem R$</th>
                      <th className="num">Margem %</th>
                      <th className="num">Markup</th>
                      <th className="num">Min. autorizado</th>
                      <th>Ultima alteracao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variacoes.map((v) => (
                      <tr key={v.variacao_id}>
                        <td>
                          <strong>{v.sku}</strong>
                          <div style={{ fontSize: 11, color: "#7d7466" }}>
                            <CorBolinha hex={v.cor_hex} codigo={v.cor_codigo} /> {v.comprimento ? `${v.comprimento}${v.comprimento_unidade}` : ""}
                          </div>
                        </td>
                        <td className="num">{moeda(v.custo_aquisicao)}</td>
                        <td className="num"><strong>{moeda(v.custo_medio)}</strong></td>
                        <td className="num">{moeda(v.ultimo_custo)}</td>
                        <td className="num"><strong>{moeda(v.preco_venda)}</strong></td>
                        <td className="num">{v.preco_promocional ? moeda(v.preco_promocional) : "—"}</td>
                        <td className="num">{moeda(v.margem_valor)}</td>
                        <td className="num" style={{ color: (v.margem_percentual ?? 0) < 25 ? "#9c2b2b" : "#166b46", fontWeight: 600 }}>
                          {pct(v.margem_percentual)}
                        </td>
                        <td className="num">{v.markup ? v.markup.toFixed(2) + "x" : "—"}</td>
                        <td className="num">{v.preco_minimo_autorizado ? moeda(v.preco_minimo_autorizado) : "—"}</td>
                        <td style={{ fontSize: 11.5, color: "#7d7466" }}>{dataBR(v.data_ultima_alteracao_preco)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </>
        ) : null}

        {/* ============================================================ */}
        {/* 5. ESTOQUE                                                   */}
        {/* ============================================================ */}
        {aba === "estoque" ? (
          <>
            <Secao
              titulo="Parametros de estoque (aplicar a todas as variacoes)"
              descricao="Minimo, maximo, ponto de reposicao, localizacao fisica e regras de controle"
            >
              <form action={postAplicarEstoque}>
                <input type="hidden" name="id_produto" value={produtoId} />
                <Linha colunas="repeat(auto-fit,minmax(170px,1fr))">
                  <Campo rotulo="Estoque minimo" nome="estoque_min" placeholder="5" />
                  <Campo rotulo="Estoque maximo" nome="estoque_max" placeholder="100" />
                  <Campo rotulo="Ponto de reposicao" nome="ponto_reposicao" placeholder="10" />
                  <CampoSelect
                    rotulo="Unidade de estoque"
                    nome="unidade_estoque"
                    opcoes={f.unidades.map((u) => ({ valor: u.sigla, texto: `${u.sigla} - ${u.nome}` }))}
                  />
                </Linha>
                <Linha colunas="repeat(auto-fit,minmax(150px,1fr))">
                  <Campo rotulo="Localizacao fisica" nome="localizacao" placeholder="Parede A" />
                  <Campo rotulo="Corredor" nome="corredor" placeholder="A1" />
                  <Campo rotulo="Prateleira" nome="prateleira" placeholder="1" />
                  <Campo rotulo="Posicao" nome="posicao" placeholder="2" />
                </Linha>
                <Linha colunas="repeat(auto-fit,minmax(240px,1fr))">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                    <input type="checkbox" name="permite_estoque_negativo" value="1" style={{ width: "auto" }} />
                    <span style={{ fontSize: 13.5 }}>Permite estoque negativo neste produto</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                    <input type="checkbox" name="controle_lote" value="1" style={{ width: "auto" }} />
                    <span style={{ fontSize: 13.5 }}>Controlar lote e validade</span>
                  </div>
                </Linha>
                <button className="btn btn-primario" type="submit">Aplicar aos SKUs deste produto</button>
              </form>
            </Secao>

            <Secao titulo="Estoque por SKU e por unidade" descricao="Arquitetura preparada para multiplas lojas e depositos" padding={false}>
              {variacoes.length === 0 ? (
                <Vazio titulo="Sem SKUs" />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th className="num">Estoque</th>
                      <th className="num">Reservado</th>
                      <th className="num">Disponivel</th>
                      <th className="num">Minimo</th>
                      <th className="num">Reposicao</th>
                      <th className="num">Maximo</th>
                      <th className="num">Valor a custo</th>
                      <th>Localizacao</th>
                      <th>Situacao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variacoes.map((v) => (
                      <tr key={v.variacao_id}>
                        <td><strong>{v.sku}</strong></td>
                        <td className="num">{num(v.estoque)}</td>
                        <td className="num">{num(v.reservado)}</td>
                        <td className="num"><strong>{num(v.disponivel)}</strong></td>
                        <td className="num">{num(v.estoque_min)}</td>
                        <td className="num">{num(v.ponto_reposicao)}</td>
                        <td className="num">{num(v.estoque_max)}</td>
                        <td className="num">{moeda(v.estoque_custo)}</td>
                        <td style={{ fontSize: 12 }}>{[v.localizacao, v.corredor, v.prateleira, v.posicao].filter(Boolean).join(" ") || "—"}</td>
                        <td><SituacaoEstoque situacao={v.situacao_estoque} disponivel={v.disponivel} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </>
        ) : null}

        {/* ============================================================ */}
        {/* 6. FORNECEDORES                                              */}
        {/* ============================================================ */}
        {aba === "fornecedores" ? (
          <>
            <Secao
              titulo="Fornecedores deste produto"
              descricao="Relacao produto x fornecedor: quem vende, por quanto, em que condicao e em quanto tempo entrega"
            >
              <form action={postVincularFornecedor}>
                <input type="hidden" name="produto_id" value={produtoId} />
                <Linha colunas="repeat(auto-fit,minmax(180px,1fr))">
                  <CampoSelect rotulo="Fornecedor" nome="fornecedor_id" opcoes={f.fornecedores.map((x) => ({ valor: x.id, texto: x.razao_social }))} obrigatorio />
                  <CampoSelect
                    rotulo="Vale para (SKU especifico)"
                    nome="variacao_id"
                    opcoes={variacoes.map((v) => ({ valor: v.variacao_id, texto: `${v.sku} ${v.cor_codigo ?? ""} ${v.comprimento ?? ""}` }))}
                    placeholder="Todo o produto"
                  />
                  <Campo rotulo="Codigo no fornecedor" nome="codigo_fornecedor" />
                  <Campo rotulo="Referencia do fabricante" nome="referencia_fabricante" />
                </Linha>
                <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
                  <Campo rotulo="Custo do fornecedor (R$)" nome="custo" placeholder="9,50" />
                  <Campo rotulo="Qtd minima de compra" nome="qtd_minima_compra" placeholder="12" />
                  <Campo rotulo="Multiplo de compra" nome="multiplo_compra" placeholder="6" />
                  <Campo rotulo="Prazo de entrega (dias)" nome="prazo_entrega_dias" placeholder="7" />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                    <input type="checkbox" name="principal" value="1" style={{ width: "auto" }} />
                    <span style={{ fontSize: 13.5 }}>Fornecedor principal</span>
                  </div>
                </Linha>
                <button className="btn btn-primario" type="submit">Vincular fornecedor</button>
              </form>
            </Secao>

            <Secao titulo={`${vinculos.length} vinculo(s)`} descricao="O fornecedor mais barato aparece primeiro quando o custo esta informado" padding={false}>
              {vinculos.length === 0 ? (
                <Vazio titulo="Nenhum fornecedor vinculado" descricao="Vincule ao menos o fornecedor principal deste produto." />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>Fornecedor</th>
                      <th>SKU / abrangencia</th>
                      <th>Codigo fornecedor</th>
                      <th className="num">Custo</th>
                      <th className="num">Qtd minima</th>
                      <th className="num">Multiplo</th>
                      <th className="num">Prazo</th>
                      <th>Ultima compra</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vinculos.map((v, i) => (
                      <tr key={v.id}>
                        <td>
                          <strong>{v.nome_fantasia || v.razao_social}</strong>
                          {v.principal ? <span className="tag tag-azul" style={{ marginLeft: 6, fontSize: 10 }}>PRINCIPAL</span> : null}
                          {i === 0 && v.custo ? <span className="tag tag-verde" style={{ marginLeft: 6, fontSize: 10 }}>MAIS BARATO</span> : null}
                        </td>
                        <td style={{ fontSize: 12.5 }}>{v.sku ? `${v.sku} ${v.cor_codigo ?? ""} ${v.comprimento ? v.comprimento + (v.comprimento_unidade ?? "") : ""}` : "Todo o produto"}</td>
                        <td style={{ fontSize: 12.5 }}>{v.codigo_fornecedor ?? "—"}</td>
                        <td className="num">{v.custo ? moeda(v.custo) : "—"}</td>
                        <td className="num">{v.qtd_minima_compra ?? "—"}</td>
                        <td className="num">{v.multiplo_compra ?? "—"}</td>
                        <td className="num">{v.prazo_entrega_dias ? v.prazo_entrega_dias + " dias" : "—"}</td>
                        <td style={{ fontSize: 12 }}>{v.ultima_compra ? dataBR(v.ultima_compra) : "—"}</td>
                        <td>
                          <form action={postRemoverFornecedor}>
                            <input type="hidden" name="produto_id" value={produtoId} />
                            <input type="hidden" name="vinculo_id" value={v.id} />
                            <button className="btn btn-sm btn-perigo">×</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </>
        ) : null}

        {/* ============================================================ */}
        {/* 7. FISCAL                                                    */}
        {/* ============================================================ */}
        {aba === "fiscal" ? (
          <form action={postSalvarBloco}>
            <input type="hidden" name="id_produto" value={produtoId} />
            <input type="hidden" name="__aba" value="fiscal" />
            <input type="hidden" name="__campos" value={camposFiscal} />
            <Secao
              titulo="7. Fiscal"
              descricao="Parametrizacao preparada para emissao de nota. Nesta versao o sistema nao emite documento fiscal."
            >
              <Linha colunas="repeat(auto-fit,minmax(190px,1fr))">
                <Campo rotulo="NCM" nome="ncm" valor={p.ncm} placeholder="6704.20.00" ajuda="Cabelos posticos / perucas" />
                <Campo rotulo="CEST" nome="cest" valor={p.cest} />
                <CampoSelect
                  rotulo="Origem da mercadoria"
                  nome="origem_mercadoria"
                  valor={p.origem_mercadoria}
                  opcoes={[
                    { valor: "0", texto: "0 - Nacional" },
                    { valor: "1", texto: "1 - Estrangeira, importacao direta" },
                    { valor: "2", texto: "2 - Estrangeira, adquirida no mercado interno" },
                    { valor: "3", texto: "3 - Nacional, conteudo de importacao 40% a 70%" },
                    { valor: "8", texto: "8 - Nacional, conteudo de importacao acima de 70%" },
                  ]}
                />
                <CampoSelect
                  rotulo="Unidade comercial"
                  nome="unidade_comercial"
                  valor={p.unidade_comercial}
                  opcoes={f.unidades.map((u) => ({ valor: u.sigla, texto: `${u.sigla} - ${u.nome}` }))}
                />
                <Campo rotulo="Classificacao fiscal" nome="classificacao_fiscal" valor={p.classificacao_fiscal} placeholder="SIMPLES NACIONAL - CSOSN 102" />
                <Campo rotulo="Tributacao aplicavel" nome="tributacao" valor={p.tributacao} placeholder="ICMS 18% (credito)" />
              </Linha>
              <CampoArea rotulo="Observacao fiscal" nome="observacao_fiscal" valor={p.observacao_fiscal} linhas={3} />
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primario" type="submit">Salvar dados fiscais</button>
              </div>
            </Secao>
          </form>
        ) : null}

        {/* ============================================================ */}
        {/* 8. E-COMMERCE                                                */}
        {/* ============================================================ */}
        {aba === "site" ? (
          <form action={postSalvarBloco}>
            <input type="hidden" name="id_produto" value={produtoId} />
            <input type="hidden" name="__aba" value="site" />
            <input type="hidden" name="__campos" value={camposSite} />
            <Secao titulo="8. E-commerce e catalogo" descricao="Conteudo pronto para publicar no site da loja">
              <Linha colunas="2fr 1fr">
                <Campo rotulo="Nome comercial para o site" nome="nome_site" valor={p.nome_site} placeholder="Jumbo Ultra Braid 60cm" />
                <Campo rotulo="URL / slug" nome="slug" valor={p.slug} ajuda="endereco do produto no site" />
              </Linha>
              <div style={{ marginBottom: 12 }}>
                <CampoArea rotulo="Descricao curta" nome="descricao_curta" valor={p.descricao_curta} linhas={2} placeholder="Aparece na listagem e nos resultados de busca" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <CampoArea rotulo="Descricao completa" nome="descricao_completa" valor={p.descricao_completa} linhas={5} />
              </div>
              <Linha colunas="repeat(auto-fit,minmax(280px,1fr))">
                <CampoArea rotulo="Caracteristicas" nome="caracteristicas" valor={p.caracteristicas} linhas={3} placeholder="Uma por linha" />
                <CampoArea rotulo="Modo de uso / aplicacao" nome="modo_uso" valor={p.modo_uso} linhas={3} />
                <CampoArea rotulo="Cuidados" nome="cuidados" valor={p.cuidados} linhas={3} />
              </Linha>
              <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
                <Campo rotulo="Foto principal (URL ou caminho)" nome="foto_principal" valor={p.foto_principal} placeholder="/produtos/jumbo-ultra-braid.jpg" />
                <Campo rotulo="Video (URL)" nome="video" valor={p.video} />
                <Campo rotulo="Tags / palavras-chave" nome="tags" valor={p.tags} placeholder="cabelo sintetico, jumbo, tranca" />
                <Campo rotulo="Ordem de exibicao" nome="ordem_exibicao" valor={p.ordem_exibicao} tipo="number" />
              </Linha>
              <div style={{ marginBottom: 12 }}>
                <CampoArea rotulo="Galeria de fotos" nome="galeria" valor={p.galeria} linhas={2} ajuda='Um caminho por linha, ou JSON: ["/a.jpg","/b.jpg"]' />
              </div>
              <Linha colunas="repeat(auto-fit,minmax(230px,1fr))">
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                  <input type="checkbox" name="destaque" value="1" defaultChecked={!!p.destaque} style={{ width: "auto" }} />
                  <span style={{ fontSize: 13.5 }}>Produto em destaque no site</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                  <input type="checkbox" name="exibir_site" value="1" defaultChecked={!!p.exibir_site} style={{ width: "auto" }} />
                  <span style={{ fontSize: 13.5 }}>Exibir no site</span>
                </div>
              </Linha>
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primario" type="submit">Salvar conteudo do site</button>
              </div>
            </Secao>
          </form>
        ) : null}

        {/* ============================================================ */}
        {/* 9. GESTAO                                                    */}
        {/* ============================================================ */}
        {aba === "gestao" ? (
          <>
            <Secao titulo="9. Gestao" descricao="Nenhum destes campos e digitado: o sistema calcula a partir das vendas e movimentacoes">
              <Grade colunas={4}>
                <Kpi rotulo="Primeira venda" valor={vendas.primeira ? dataBR(vendas.primeira) : "—"} detalhe={vendas.num_vendas ? `${vendas.num_vendas} vendas` : "sem venda"} />
                <Kpi rotulo="Ultima venda" valor={vendas.ultima ? dataBR(vendas.ultima) : "—"} detalhe={vendas.ultima ? diasSemVenda(vendas.ultima) : "—"} />
                <Kpi rotulo="Receita acumulada" valor={moeda(vendas.receita)} detalhe={`${num(vendas.pecas)} pecas vendidas`} variante="verde" />
                <Kpi rotulo="Lucro acumulado" valor={moeda(vendas.lucro)} detalhe={`Margem ${pct(vendas.receita > 0 ? (vendas.lucro / vendas.receita) * 100 : 0)}`} variante="verde" />
              </Grade>
              <Grade colunas={4}>
                <Kpi rotulo="Estoque em R$ (custo)" valor={moeda(metricas?.estoque_custo)} detalhe={`${num(metricas?.pecas)} pecas`} />
                <Kpi rotulo="Estoque em R$ (venda)" valor={moeda(metricas?.estoque_venda)} detalhe={`Potencial ${moeda((metricas?.estoque_venda ?? 0) - (metricas?.estoque_custo ?? 0))}`} />
                <Kpi rotulo="Giro medio (90d)" valor={giro(metricas, vendas)} detalhe="Vendido / estoque medio" />
                <Kpi
                  rotulo="Curva ABC (90d)"
                  valor={classeABC(rankingGlobal, variacoes)}
                  detalhe="Participacao na receita da loja"
                  variante="ouro"
                />
              </Grade>

              <Secao titulo="Participacao de cada SKU na receita da loja (90 dias)" padding={false}>
                {variacoes.length === 0 ? (
                  <Vazio titulo="Sem dados" />
                ) : (
                  <Tabela>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th className="num">Receita 90d</th>
                        <th className="num">% do total</th>
                        <th className="num">Acumulado</th>
                        <th style={{ width: 140 }}>Classe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variacoes.map((v) => {
                        const r = rankingGlobal.find((x) => x.variacao_id === v.variacao_id);
                        const acc = r?.acumulado ?? 0;
                        const cls = r ? (acc <= 80 ? "A" : acc <= 95 ? "B" : "C") : "—";
                        return (
                          <tr key={v.variacao_id}>
                            <td><strong>{v.sku}</strong> <span style={{ color: "#7d7466", fontSize: 12 }}>{v.cor_codigo} {v.comprimento}{v.comprimento_unidade}</span></td>
                            <td className="num">{moeda(r?.receita ?? 0)}</td>
                            <td className="num">{pct(r ? (r.receita / somaReceitaRank) * 100 : 0)}</td>
                            <td className="num">{r ? pct(acc) : "—"}</td>
                            <td>
                              <span className={"tag " + (cls === "A" ? "tag-verde" : cls === "B" ? "tag-amarelo" : "tag-cinza")} style={{ marginRight: 6 }}>
                                {cls}
                              </span>
                              <Barra pct={acc} cor={cls === "A" ? "#1f8a5b" : cls === "B" ? "#c8913a" : "#d5ccba"} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Tabela>
                )}
              </Secao>
            </Secao>

            <Secao titulo="Historico de vendas por mes" padding={false}>
              {porMes.length === 0 ? (
                <Vazio titulo="Sem historico de vendas" />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th className="num">Vendas</th>
                      <th className="num">Pecas</th>
                      <th className="num">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porMes.map((m) => (
                      <tr key={m.mes}>
                        <td>{m.mes}</td>
                        <td className="num">{m.vendas}</td>
                        <td className="num">{num(m.pecas)}</td>
                        <td className="num"><strong>{moeda(m.receita)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>

            <Secao titulo="Zona de risco">
              <p style={{ fontSize: 13.5, color: "#7d7466", marginTop: 0 }}>
                Excluir o produto apaga tambem todas as suas variacoes. Vendas antigas permanecem no historico.
                Se o produto apenas saiu de linha, prefira mudar o status para <strong>descontinuado</strong>.
              </p>
              <form action={postExcluirProduto}>
                <input type="hidden" name="id_produto" value={produtoId} />
                <button className="btn btn-perigo" type="submit">Excluir produto definitivamente</button>
              </form>
            </Secao>
          </>
        ) : null}
      </Conteudo>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Utilitarios de calculo (gestao)                                     */
/* ------------------------------------------------------------------ */

function diasSemVenda(ultima: string): string {
  const d = Math.floor((Date.now() - new Date(String(ultima).replace(" ", "T")).getTime()) / 86400000);
  return d <= 0 ? "vendeu hoje" : `${d} dias sem venda`;
}

function giro(metricas: any, vendas: any): string {
  const estoque = Number(metricas?.pecas ?? 0);
  const vendido = Number(vendas?.pecas ?? 0);
  if (estoque <= 0) return "—";
  return (vendido / estoque).toFixed(2) + "x";
}

function classeABC(ranking: { variacao_id: number; acumulado: number }[], variacoes: any[]): string {
  if (!variacoes.length) return "—";
  const ids = new Set(variacoes.map((v) => v.variacao_id));
  const meus = ranking.filter((r) => ids.has(r.variacao_id));
  if (!meus.length) return "sem venda";
  const melhor = Math.min(...meus.map((m) => m.acumulado));
  return melhor <= 80 ? "A" : melhor <= 95 ? "B" : "C";
}
