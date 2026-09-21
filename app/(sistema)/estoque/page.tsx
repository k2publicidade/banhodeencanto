import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one, config } from "@/lib/db";
import { moeda, num, dataHoraBR, pct } from "@/lib/format";
import { listaFiltros, resumoEstoque } from "@/lib/consultas";
import {
  Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, Linha,
  SituacaoEstoque, CorBolinha, Kpi, Grade,
} from "@/components/ui";
import { acaoLancarEstoque } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

export default async function PaginaEstoque({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string; marca?: string; categoria?: string; cor?: string; msg?: string; erro?: string; ordem?: string }>;
}) {
  await exigir();
  const sp = await searchParams;
  const f = listaFiltros();
  const r = resumoEstoque();

  const where: string[] = ["variacao_status = 'ativo'"];
  const params: any[] = [];
  if (sp.q) {
    where.push(`(sku LIKE ? COLLATE NOCASE OR produto LIKE ? COLLATE NOCASE OR cor_codigo LIKE ?
                 OR localizacao LIKE ? COLLATE NOCASE OR marca LIKE ? COLLATE NOCASE)`);
    const l = "%" + sp.q + "%";
    params.push(l, l, l, l, l);
  }
  if (sp.situacao) { where.push("situacao_estoque = ?"); params.push(sp.situacao); }
  if (sp.marca) { where.push("marca = (SELECT nome FROM marcas WHERE id = ?)"); params.push(Number(sp.marca)); }
  if (sp.categoria) { where.push("(categoria = (SELECT nome FROM categorias WHERE id = ?) OR subcategoria = (SELECT nome FROM categorias WHERE id = ?))"); params.push(Number(sp.categoria), Number(sp.categoria)); }
  if (sp.cor) { where.push("cor_id = ?"); params.push(Number(sp.cor)); }

  const ordem =
    sp.ordem === "produto" ? "produto, cor_codigo, comprimento"
    : sp.ordem === "valor" ? "estoque_custo DESC"
    : sp.ordem === "local" ? "localizacao, corredor, prateleira, posicao"
    : "CASE situacao_estoque WHEN 'sem_estoque' THEN 0 WHEN 'critico' THEN 1 WHEN 'repor' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END, disponivel";

  const itens = all<any>(
    `SELECT variacao_id, sku, ean, produto, produto_id, marca, linha, categoria, cor, cor_codigo, cor_hex, comprimento, comprimento_unidade,
            custo_medio, preco_venda, margem_percentual, estoque, reservado, disponivel, estoque_min, estoque_max,
            ponto_reposicao, localizacao, corredor, prateleira, posicao, unidade_estoque, estoque_custo, estoque_venda, situacao_estoque
     FROM vw_estoque_posicao
     WHERE ${where.join(" AND ")}
     ORDER BY ${ordem}
     LIMIT 500`,
    ...params
  );

  const movimentos = all<any>(
    `SELECT m.id, m.tipo, m.quantidade, m.saldo_apos, m.motivo, m.documento, m.criado_em, m.referencia_tipo,
            v.sku, v.id variacao_id, p.nome produto, u.nome usuario
     FROM estoque_movimentos m
     JOIN variacoes v ON v.id = m.variacao_id
     JOIN produtos p ON p.id = v.produto_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     ORDER BY m.id DESC LIMIT 40`
  );

  const lojas = all<{ id: number; nome: string }>("SELECT id, nome FROM lojas WHERE ativa = 1 ORDER BY padrao DESC, nome");
  const totalListado = itens.reduce((s, i) => s + i.estoque_custo, 0);
  const pecasListadas = itens.reduce((s, i) => s + i.estoque, 0);

  const opcoesSku = all<any>(
    `SELECT variacao_id, sku, produto, cor_codigo, comprimento, comprimento_unidade, disponivel
     FROM vw_estoque_posicao WHERE variacao_status='ativo'
     ORDER BY produto, cor_codigo, comprimento`
  );

  return (
    <>
      <Cabecalho
        titulo="Estoque"
        subtitulo={`${r.skus} SKUs ativos • ${num(r.pecas)} pecas • valor a custo ${moeda(r.valor_custo)}`}
        acoes={
          <>
            <a className="btn btn-neutro" href="/api/exportar/estoque">Exportar CSV</a>
            <Link className="btn btn-neutro" href="/compras/nova">Registrar compra</Link>
          </>
        }
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={5}>
          <Kpi rotulo="Valor a custo" valor={moeda(r.valor_custo)} detalhe={`${num(r.pecas)} pecas`} variante="teal" />
          <Kpi rotulo="Valor a preco de venda" valor={moeda(r.valor_venda)} detalhe={`Potencial de lucro ${moeda(r.valor_venda - r.valor_custo)}`} />
          <Kpi rotulo="SKUs sem estoque" valor={String(r.sem_estoque)} detalhe="Venda bloqueada" variante={r.sem_estoque > 0 ? "vermelho" : "claro"} href="/estoque?situacao=sem_estoque" />
          <Kpi rotulo="Abaixo do minimo" valor={String(r.criticos)} detalhe="Repor com urgencia" variante={r.criticos > 0 ? "amarelo" : "claro"} href="/estoque?situacao=critico" />
          <Kpi rotulo="No ponto de reposicao" valor={String(r.repor)} detalhe="Programar compra" variante={r.repor > 0 ? "amarelo" : "claro"} href="/estoque?situacao=repor" />
        </Grade>

        <Secao
          titulo="Movimentar estoque"
          descricao="Entrada (compra/ajuste), saida, perda, inventario ou transferencia entre unidades"
        >
          <form action={acaoLancarEstoque}>
            <input type="hidden" name="__volta" value="/estoque" />
            <Linha colunas="2.2fr 1.2fr 1fr 1fr">
              <div>
                <label htmlFor="variacao_id">SKU</label>
                <select id="variacao_id" name="variacao_id" required defaultValue="">
                  <option value="">— selecione o SKU —</option>
                  {opcoesSku.map((o) => (
                    <option key={o.variacao_id} value={o.variacao_id}>
                      {o.produto} | {o.cor_codigo ?? "-"} {o.comprimento ? `| ${o.comprimento}${o.comprimento_unidade}` : ""} | {o.sku} (saldo {o.disponivel})
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
            <Linha colunas="2fr 1fr 1fr auto">
              <Campo rotulo="Motivo / observacao" nome="motivo" placeholder="Ex: compra NF 12345, avaria no transporte, contagem mensal" />
              <Campo rotulo="Documento" nome="documento" placeholder="NF 12345" />
              <CampoSelect rotulo="Unidade" nome="loja_id" valor={lojas.find((l) => l.nome.includes("Matriz"))?.id ?? lojas[0]?.id} opcoes={lojas.map((l) => ({ valor: l.id, texto: l.nome }))} />
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn btn-primario" type="submit">Lancar movimento</button>
              </div>
            </Linha>
          </form>
        </Secao>

        <Secao titulo="Filtros" descricao={`${itens.length} SKU(s) listados • ${num(pecasListadas)} pecas • ${moeda(totalListado)} a custo`}>
          <form method="get" className="grade-form" style={{ "--cols-desktop": "2fr 1fr 1fr 1fr 1fr 1fr auto auto" } as React.CSSProperties}>
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
            <Link className="btn btn-neutro" href="/estoque">Limpar</Link>
          </form>
        </Secao>

        <Secao titulo="Posicao de estoque por SKU" padding={false}>
          {itens.length === 0 ? (
            <Vazio titulo="Nenhum SKU encontrado" descricao="Ajuste os filtros ou cadastre produtos com variacoes." />
          ) : (
            <Tabela maxAltura={620}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Cor / Comp.</th>
                  <th>Localizacao</th>
                  <th className="num">Estoque</th>
                  <th className="num">Disp.</th>
                  <th className="num">Min.</th>
                  <th className="num">Ponto</th>
                  <th className="num">Custo</th>
                  <th className="num">Valor</th>
                  <th>Situacao</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.variacao_id}>
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
                    <td style={{ fontSize: 12 }}>
                      {[i.localizacao, i.corredor, i.prateleira, i.posicao].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="num">{num(i.estoque)}</td>
                    <td className="num"><strong>{num(i.disponivel)}</strong></td>
                    <td className="num">{num(i.estoque_min)}</td>
                    <td className="num">{num(i.ponto_reposicao)}</td>
                    <td className="num">{moeda(i.custo_medio)}</td>
                    <td className="num">{moeda(i.estoque_custo)}</td>
                    <td><SituacaoEstoque situacao={i.situacao_estoque} disponivel={i.disponivel} /></td>
                    <td>
                      <Link className="btn btn-sm btn-neutro" href={`/produtos/${i.produto_id}/variacao/${i.variacao_id}`}>Ver</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Ultimas movimentacoes" descricao="Historico completo de entradas, saidas, vendas, ajustes e perdas" padding={false}>
          {movimentos.length === 0 ? (
            <Vazio titulo="Sem movimentacoes" />
          ) : (
            <Tabela maxAltura={430}>
              <thead>
                <tr>
                  <th>Data</th>
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
