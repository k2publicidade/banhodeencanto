import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, pct, dataBR, dataHoraBR, num } from "@/lib/format";
import { listaFiltros, fornecedoresComparativo } from "@/lib/consultas";
import { listarEstoques, saldosDoSku } from "@/lib/estoques";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoSelect, CampoArea, Linha, SituacaoEstoque, Grade, Kpi } from "@/components/ui";
import { postSalvarVariacao } from "@/app/actions/produto-form";

export const dynamic = "force-dynamic";

export default async function PaginaVariacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; vid: string }>;
  searchParams: Promise<{ msg?: string; erro?: string }>;
}) {
  await exigir();
  const { id, vid } = await params;
  const sp = await searchParams;
  const produtoId = Number(id);
  const variacaoId = Number(vid);

  const v = await one<any>(`SELECT * FROM vw_estoque_posicao WHERE variacao_id = ?`, variacaoId);
  if (!v || v.produto_id !== produtoId) notFound();

  const [f, fornecedores, movimentos, vendas, precos] = await Promise.all([
    listaFiltros(),
    fornecedoresComparativo(variacaoId),
    all<any>(
      `SELECT m.tipo, m.quantidade, m.saldo_anterior, m.saldo_apos, m.motivo, m.documento, m.criado_em, u.nome usuario
       FROM estoque_movimentos m LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.variacao_id = ? ORDER BY m.id DESC LIMIT 25`,
      variacaoId
    ),
    one<any>(
      `SELECT COUNT(*) n, COALESCE(SUM(vi.quantidade),0) pecas, COALESCE(SUM(vi.total),0) receita,
              MIN(v.data) primeira, MAX(v.data) ultima
       FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
       WHERE vi.variacao_id = ? AND v.status <> 'cancelada'`,
      variacaoId
    ),
    all<any>(
      `SELECT preco_anterior, preco_novo, usuario_nome, criado_em FROM precos_historico
       WHERE variacao_id = ? ORDER BY id DESC LIMIT 10`,
      variacaoId
    ),
  ]);

  // Saldo deste SKU em cada estoque (estoques separados)
  const [estoques, saldos] = await Promise.all([listarEstoques(), saldosDoSku(variacaoId)]);

  const semFiscal = !v.ncm;

  return (
    <>
      <Cabecalho
        titulo={`SKU ${v.sku}`}
        subtitulo={`${v.produto} • ${v.cor_codigo ? "Cor " + v.cor_codigo : "sem cor"} ${v.comprimento ? "• " + v.comprimento + v.comprimento_unidade : ""} • ${v.marca ?? ""}`}
        acoes={
          <>
            <Link className="btn btn-neutro" href={`/produtos/${produtoId}?aba=variacoes`}>Voltar ao produto</Link>
          </>
        }
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={5}>
          <Kpi rotulo="Estoque disponivel" valor={String(v.disponivel)} detalhe={`${v.estoque} total • ${v.reservado} reservado`} variante={v.disponivel <= 0 ? "vermelho" : v.disponivel <= v.estoque_min ? "amarelo" : "claro"} />
          <Kpi rotulo="Custo medio" valor={moeda(v.custo_medio)} detalhe={`Aquisicao ${moeda(v.custo_aquisicao)} • ultimo ${moeda(v.ultimo_custo)}`} />
          <Kpi rotulo="Preco de venda" valor={moeda(v.preco_venda)} detalhe={v.preco_promocional ? `Promocional ${moeda(v.preco_promocional)}` : "sem promocao"} />
          <Kpi rotulo="Margem" valor={pct(v.margem_percentual)} detalhe={`${moeda(v.margem_valor)} por unidade • markup ${v.markup ? v.markup.toFixed(2) + "x" : "—"}`} variante="verde" />
          <Kpi rotulo="Vendido (total)" valor={`${vendas?.pecas ?? 0} un`} detalhe={vendas?.n ? `${moeda(vendas.receita)} em ${vendas.n} vendas` : "sem venda ainda"} />
        </Grade>

        <form action={postSalvarVariacao}>
          <input type="hidden" name="id_produto" value={produtoId} />
          <input type="hidden" name="__id" value={variacaoId} />

          <Secao titulo="Identificacao do SKU" descricao="Cada variacao tem SKU, codigo de barras, cor e comprimento proprios">
            <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
              <Campo rotulo="SKU" nome="sku" valor={v.sku} obrigatorio />
              <Campo rotulo="Codigo de barras (EAN/GTIN)" nome="ean" valor={v.ean} ajuda="13 digitos, validado pelo sistema" />
              <Campo rotulo="Codigo interno" nome="codigo_interno" valor={v.codigo_interno} />
              <CampoSelect
                rotulo="Status"
                nome="status"
                valor={v.variacao_status}
                opcoes={[
                  { valor: "ativo", texto: "Ativo" },
                  { valor: "inativo", texto: "Inativo" },
                  { valor: "descontinuado", texto: "Descontinuado" },
                ]}
              />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(180px,1fr))">
              <CampoSelect rotulo="Cor" nome="cor_id" valor={v.cor_id ?? ""} opcoes={f.cores.map((c) => ({ valor: c.id, texto: `${c.codigo} - ${c.nome}` }))} />
              <Campo rotulo="Codigo da cor (fabricante)" nome="cor_codigo_fabricante" valor={v.cor_codigo_fabricante} placeholder="1B" />
              <Campo rotulo="Nome comercial da cor" nome="cor_nome_comercial" valor={v.cor_nome_comercial} placeholder="Preto Natural 1B" />
              <Campo rotulo="Comprimento" nome="comprimento_valor" valor={v.comprimento} tipo="number" step="0.01" />
              <CampoSelect
                rotulo="Unidade do comprimento"
                nome="comprimento_unidade"
                valor={v.comprimento_unidade ?? "cm"}
                opcoes={[
                  { valor: "cm", texto: "cm" },
                  { valor: "pol", texto: "polegadas" },
                  { valor: "m", texto: "metros" },
                ]}
              />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(180px,1fr))">
              <Campo rotulo="Peso do pacote (g)" nome="peso_pacote" valor={v.peso_pacote} tipo="number" />
              <Campo rotulo="Quantidade por pacote" nome="quantidade_por_pacote" valor={v.quantidade_por_pacote} tipo="number" step="0.01" />
              <Campo rotulo="Qtd recomendada por penteado" nome="quantidade_recomendada" valor={v.quantidade_recomendada} tipo="number" step="0.01" ajuda="Quantos pacotes para uma cabeca" />
            </Linha>
          </Secao>

          <Secao titulo="Comercial e precos" descricao="Margem, markup e margem percentual sao calculados automaticamente pelo sistema">
            <Linha colunas="repeat(auto-fit,minmax(180px,1fr))">
              <Campo rotulo="Custo de aquisicao (R$)" nome="custo_aquisicao" valor={v.custo_aquisicao} />
              <Campo rotulo="Preco de venda (R$)" nome="preco_venda" valor={v.preco_venda} obrigatorio />
              <Campo rotulo="Preco promocional (R$)" nome="preco_promocional" valor={v.preco_promocional} ajuda="Deixe vazio se nao houver" />
              <Campo rotulo="Preco minimo autorizado (R$)" nome="preco_minimo_autorizado" valor={v.preco_minimo_autorizado} ajuda="Limite para desconto no PDV" />
            </Linha>
            <div style={{ display: "flex", gap: 24, background: "#faf8f4", border: "1px solid #e7e1d6", borderRadius: 11, padding: 12, fontSize: 13.5, flexWrap: "wrap" }}>
              <span>Custo medio atual: <strong>{moeda(v.custo_medio)}</strong></span>
              <span>Margem: <strong>{moeda(v.margem_valor)}</strong> ({pct(v.margem_percentual)})</span>
              <span>Markup: <strong>{v.markup ? v.markup.toFixed(2) + "x" : "—"}</strong></span>
              <span>Ultima alteracao de preco: <strong>{dataBR(v.data_ultima_alteracao_preco)}</strong></span>
            </div>
          </Secao>

          <Secao titulo="Estoque e localizacao fisica">
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Estoque minimo" nome="estoque_min" valor={v.estoque_min} tipo="number" />
              <Campo rotulo="Estoque maximo" nome="estoque_max" valor={v.estoque_max} tipo="number" />
              <Campo rotulo="Ponto de reposicao" nome="ponto_reposicao" valor={v.ponto_reposicao} tipo="number" />
              <CampoSelect
                rotulo="Unidade de estoque"
                nome="unidade_estoque"
                valor={v.unidade_estoque}
                opcoes={f.unidades.map((u) => ({ valor: u.sigla, texto: `${u.sigla} - ${u.nome}` }))}
              />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(150px,1fr))">
              <Campo rotulo="Localizacao" nome="localizacao" valor={v.localizacao} placeholder="Parede A" />
              <Campo rotulo="Corredor" nome="corredor" valor={v.corredor} />
              <Campo rotulo="Prateleira" nome="prateleira" valor={v.prateleira} />
              <Campo rotulo="Posicao" nome="posicao" valor={v.posicao} />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(260px,1fr))">
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="permite_estoque_negativo" value="1" defaultChecked={!!v.permite_estoque_negativo} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Permite vender mesmo sem saldo</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="controle_lote" value="1" defaultChecked={!!v.controle_lote} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Controlar lote e validade</span>
              </div>
            </Linha>
            <Linha colunas="1fr">
              <CampoSelect
                rotulo="NCM (fiscal)"
                nome="ncm"
                valor={v.ncm}
                opcoes={[{ valor: "6704.20.00", texto: "6704.20.00 - Cabelos posticos" }, { valor: "9615.11.00", texto: "9615.11.00 - Pentes e acessorios" }]}
                ajuda={semFiscal ? "O produto-pai nao tem NCM definido" : undefined}
              />
            </Linha>
            <CampoArea rotulo="Observacoes" nome="observacoes" valor={v.observacoes} linhas={2} />
          </Secao>

          <div className="acoes-form" style={{ marginBottom: 20 }}>
            <button className="btn btn-primario btn-lg" type="submit">Salvar SKU</button>
            <Link className="btn btn-neutro btn-lg" href={`/produtos/${produtoId}?aba=variacoes`}>Voltar</Link>
          </div>
        </form>

        <div className="grade-responsiva">
          <Secao
            titulo="Saldo por estoque"
            descricao="Este SKU pode ter saldo diferente em cada local"
            acoes={<Link className="btn btn-sm btn-neutro" href={`/estoque/transferencia?item=${variacaoId}`}>Transferir este SKU</Link>}
            padding={false}
          >
            {estoques.length === 0 ? (
              <Vazio titulo="Nenhum estoque cadastrado" />
            ) : (
              <Tabela>
                <thead>
                  <tr>
                    <th>Estoque</th>
                    <th>Tipo</th>
                    <th className="num">Saldo</th>
                    <th className="num">Disponivel</th>
                  </tr>
                </thead>
                <tbody>
                  {estoques.map((e) => {
                    const s = saldos.find((x) => x.loja_id === e.loja_id);
                    return (
                      <tr key={e.loja_id}>
                        <td>
                          <strong>{e.nome}</strong>
                          {e.padrao ? <span className="tag tag-amarelo" style={{ marginLeft: 6, fontSize: 10 }}>VENDE</span> : null}
                          <div style={{ fontSize: 11, color: "#7d7466" }}>
                            <Link href={`/estoque?estoque=${e.loja_id}`}>ver posicao deste estoque</Link>
                          </div>
                        </td>
                        <td><span className={"tag " + (e.eh_deposito ? "tag-azul" : "tag-verde")}>{e.eh_deposito ? "galpao" : "loja"}</span></td>
                        <td className="num" style={{ fontWeight: 600 }}>{s ? num(s.quantidade) : "—"}</td>
                        <td className="num">{s ? num(s.disponivel) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <Secao titulo="Movimentacoes de estoque" descricao="Ultimas 25" padding={false}>
            {movimentos.length === 0 ? (
              <Vazio titulo="Sem movimentacoes" />
            ) : (
              <Tabela maxAltura={330}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="num">Qtd</th>
                    <th className="num">Saldo</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentos.map((m, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12 }}>{dataHoraBR(m.criado_em)}</td>
                      <td><span className="tag tag-cinza">{m.tipo}</span></td>
                      <td className="num" style={{ color: ["entrada", "devolucao", "cancelamento", "inventario"].includes(m.tipo) ? "#166b46" : "#9c2b2b" }}>
                        {["entrada", "devolucao", "cancelamento", "inventario"].includes(m.tipo) ? "+" : "−"}{m.quantidade}
                      </td>
                      <td className="num">{m.saldo_apos}</td>
                      <td style={{ fontSize: 12 }}>{m.motivo ?? "—"}{m.usuario ? ` • ${m.usuario}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Secao>

          <div>
            <Secao titulo="Fornecedores deste SKU" descricao="Ordenado do mais barato para o mais caro" padding={false}>
              {fornecedores.length === 0 ? (
                <Vazio titulo="Nenhum fornecedor vinculado" descricao="Vincule na aba Fornecedores do produto." />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>Fornecedor</th>
                      <th className="num">Custo</th>
                      <th className="num">Qtd min.</th>
                      <th className="num">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fornecedores.map((x, i) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.nome_fantasia || x.razao_social}</strong>
                          {i === 0 ? <span className="tag tag-verde" style={{ marginLeft: 6, fontSize: 10 }}>MAIS BARATO</span> : null}
                        </td>
                        <td className="num">{x.custo ? moeda(x.custo) : "—"}</td>
                        <td className="num">{x.qtd_minima_compra ?? "—"}</td>
                        <td className="num">{x.prazo_entrega_dias ? x.prazo_entrega_dias + "d" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>

            <Secao titulo="Historico de precos" padding={false}>
              {precos.length === 0 ? (
                <Vazio titulo="Nenhuma alteracao de preco registrada" />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th className="num">De</th>
                      <th className="num">Para</th>
                      <th>Por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {precos.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12 }}>{dataHoraBR(p.criado_em)}</td>
                        <td className="num">{moeda(p.preco_anterior)}</td>
                        <td className="num">
                          <strong style={{ color: p.preco_novo > p.preco_anterior ? "#166b46" : "#9c2b2b" }}>{moeda(p.preco_novo)}</strong>
                        </td>
                        <td style={{ fontSize: 12 }}>{p.usuario_nome ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </Secao>
          </div>
        </div>
      </Conteudo>
    </>
  );
}
