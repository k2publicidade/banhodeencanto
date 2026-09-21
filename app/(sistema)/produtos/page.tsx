import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, pct, num } from "@/lib/format";
import { listaFiltros } from "@/lib/consultas";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, TagStatus, Campo, CampoSelect } from "@/components/ui";

export const dynamic = "force-dynamic";

type Busca = Promise<{ q?: string; marca?: string; categoria?: string; status?: string; situacao?: string; ordem?: string }>;

export default async function ListaProdutos({ searchParams }: { searchParams: Busca }) {
  await exigir();
  const sp = await searchParams;
  const f = listaFiltros();

  const where: string[] = ["1=1"];
  const params: any[] = [];

  if (sp.q) {
    where.push(`(p.nome LIKE ? COLLATE NOCASE OR p.sku LIKE ? COLLATE NOCASE OR p.modelo_estilo LIKE ? COLLATE NOCASE
                 OR EXISTS (SELECT 1 FROM variacoes vx WHERE vx.produto_id = p.id AND (vx.sku LIKE ? COLLATE NOCASE OR vx.ean LIKE ? COLLATE NOCASE)))`);
    const l = "%" + sp.q + "%";
    params.push(l, l, l, l, l);
  }
  if (sp.marca) { where.push("p.marca_id = ?"); params.push(Number(sp.marca)); }
  if (sp.categoria) { where.push("(p.categoria_id = ? OR p.subcategoria_id = ?)"); params.push(Number(sp.categoria), Number(sp.categoria)); }
  if (sp.status) { where.push("p.status = ?"); params.push(sp.status); }

  const ordem =
    sp.ordem === "nome" ? "p.nome"
    : sp.ordem === "estoque" ? "estoque_custo DESC"
    : sp.ordem === "skus" ? "qtd_skus DESC"
    : sp.ordem === "margem" ? "margem_media DESC"
    : "vendas_receita DESC";

  const produtos = all<any>(
    `SELECT p.id, p.nome, p.sku, p.status, p.modelo_estilo, p.foto_principal, p.destaque, p.exibir_site,
            m.nome marca, lc.nome linha, cat.nome categoria, tp.nome tipo_produto, tx.nome textura,
            COUNT(DISTINCT v.id) qtd_skus,
            COALESCE(SUM(e.quantidade), 0) estoque_total,
            COALESCE(SUM(e.quantidade * v.custo_medio), 0) estoque_custo,
            COALESCE(SUM(e.quantidade * v.preco_venda), 0) estoque_venda,
            MIN(v.preco_venda) preco_min,
            MAX(v.preco_venda) preco_max,
            AVG(v.margem_percentual) margem_media,
            SUM(CASE WHEN COALESCE(e.quantidade,0) <= 0 THEN 1 ELSE 0 END) skus_zerados,
            COALESCE((SELECT SUM(vi.total) FROM vendas_itens vi JOIN vendas vd ON vd.id = vi.venda_id
                      JOIN variacoes v2 ON v2.id = vi.variacao_id
                      WHERE v2.produto_id = p.id AND vd.status='concluida'
                        AND date(vd.data) >= date('now','localtime','-90 days')), 0) vendas_receita
     FROM produtos p
     LEFT JOIN marcas m ON m.id = p.marca_id
     LEFT JOIN linhas_colecao lc ON lc.id = p.linha_id
     LEFT JOIN categorias cat ON cat.id = p.categoria_id
     LEFT JOIN tipos_produto tp ON tp.id = p.tipo_produto_id
     LEFT JOIN texturas tx ON tx.id = p.textura_id
     LEFT JOIN variacoes v ON v.produto_id = p.id
     LEFT JOIN estoque e ON e.variacao_id = v.id
     WHERE ${where.join(" AND ")}
     GROUP BY p.id
     ORDER BY ${ordem} LIMIT 300`,
    ...params
  );

  const totais = one<any>(
    `SELECT COUNT(*) n FROM produtos`
  );

  const totalSkuGeral = one<{ n: number }>("SELECT COUNT(*) n FROM variacoes")?.n ?? 0;
  const semVariacao = produtos.filter((p) => p.qtd_skus === 0).length;

  return (
    <>
      <Cabecalho
        titulo="Produtos e SKUs"
        subtitulo={`${totais?.n ?? 0} produtos cadastrados • ${totalSkuGeral} variacoes/SKUs • estrutura produto pai + variacoes`}
        acoes={
          <>
            <Link className="btn btn-neutro" href="/estoque">Posicao de estoque</Link>
            <Link className="btn btn-primario" href="/produtos/novo">+ Novo produto</Link>
          </>
        }
      />

      <Conteudo>
        <Secao titulo="Filtros">
          <form method="get" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="Nome, SKU, codigo de barras ou modelo" />
            <CampoSelect
              rotulo="Marca"
              nome="marca"
              valor={sp.marca}
              placeholder="Todas"
              opcoes={f.marcas.map((m) => ({ valor: m.id, texto: m.nome }))}
            />
            <div>
              <label htmlFor="categoria">Categoria</label>
              <select id="categoria" name="categoria" defaultValue={sp.categoria ?? ""}>
                <option value="">Todas</option>
                {f.categoriasPai.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
                <optgroup label="Subcategorias">
                  {f.subcategorias.map((c) => (
                    <option key={"s" + c.id} value={c.id}>{c.nome}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <CampoSelect
              rotulo="Status"
              nome="status"
              valor={sp.status}
              placeholder="Todos"
              opcoes={[
                { valor: "ativo", texto: "Ativo" },
                { valor: "inativo", texto: "Inativo" },
                { valor: "descontinuado", texto: "Descontinuado" },
              ]}
            />
            <CampoSelect
              rotulo="Ordenar por"
              nome="ordem"
              valor={sp.ordem}
              placeholder="Mais vendidos"
              opcoes={[
                { valor: "vendas", texto: "Mais vendidos (90d)" },
                { valor: "nome", texto: "Nome" },
                { valor: "estoque", texto: "Valor em estoque" },
                { valor: "skus", texto: "Qtd de SKUs" },
                { valor: "margem", texto: "Margem media" },
              ]}
            />
            <button className="btn btn-primario" type="submit">Filtrar</button>
            <Link className="btn btn-neutro" href="/produtos">Limpar</Link>
          </form>
        </Secao>

        {semVariacao > 0 ? (
          <div className="card" style={{ padding: "11px 15px", marginBottom: 16, borderLeft: "4px solid #c8913a", fontSize: 13.5 }}>
            <strong>{semVariacao} produto(s) sem nenhuma variacao cadastrada.</strong>{" "}
            <span style={{ color: "#7d7466" }}>
              Abra o produto, va na aba Variacoes e use o gerador automatico por cor e comprimento.
            </span>
          </div>
        ) : null}

        <Secao
          titulo={`${produtos.length} produto(s) encontrado(s)`}
          descricao="Clique em um produto para editar o cadastro completo, precos, estoque e fornecedores"
          padding={false}
        >
          {produtos.length === 0 ? (
            <Vazio
              titulo="Nenhum produto encontrado"
              descricao="Ajuste os filtros ou cadastre um novo produto."
              acao={<Link className="btn btn-primario" href="/produtos/novo">+ Cadastrar produto</Link>}
            />
          ) : (
            <Tabela>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Marca / Linha</th>
                  <th>Categoria</th>
                  <th className="num">SKUs</th>
                  <th className="num">Estoque</th>
                  <th className="num">Preco</th>
                  <th className="num">Margem</th>
                  <th className="num">Vendas 90d</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/produtos/${p.id}`} style={{ color: "#0a5c6b", fontWeight: 600 }}>
                        {p.nome}
                        {p.destaque ? <span title="Destaque no site" style={{ color: "#c8913a" }}> ★</span> : null}
                      </Link>
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>
                        {p.sku}
                        {p.modelo_estilo ? ` • ${p.modelo_estilo}` : ""}
                        {p.textura ? ` • ${p.textura}` : ""}
                        {p.tipo_produto ? ` • ${p.tipo_produto}` : ""}
                      </div>
                    </td>
                    <td>
                      <div>{p.marca ?? "—"}</div>
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>{p.linha ?? ""}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{p.categoria ?? "—"}</td>
                    <td className="num">
                      {p.qtd_skus}
                      {p.skus_zerados > 0 ? (
                        <span className="tag tag-vermelho" style={{ marginLeft: 5, fontSize: 10 }}>
                          {p.skus_zerados} zerado{p.skus_zerados > 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">
                      <div>{num(p.estoque_total, 0)} un</div>
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>{moeda(p.estoque_custo)}</div>
                    </td>
                    <td className="num">
                      {p.qtd_skus === 0
                        ? "—"
                        : p.preco_min === p.preco_max
                        ? moeda(p.preco_min)
                        : `${moeda(p.preco_min)} – ${moeda(p.preco_max)}`}
                    </td>
                    <td className="num" style={{ color: (p.margem_media ?? 0) < 25 ? "#9c2b2b" : "#166b46", fontWeight: 600 }}>
                      {pct(p.margem_media)}
                    </td>
                    <td className="num">{p.vendas_receita > 0 ? moeda(p.vendas_receita) : "—"}</td>
                    <td><TagStatus status={p.status} /></td>
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
