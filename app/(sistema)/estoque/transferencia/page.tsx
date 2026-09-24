import Link from "next/link";
import { exigir, podeGerenciar } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num, dataBR, dataHoraBR } from "@/lib/format";
import { listarEstoques, rotuloEstoque } from "@/lib/estoques";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Kpi, Grade, SituacaoEstoque } from "@/components/ui";
import { acaoCancelarTransferencia } from "@/app/actions/estoque";
import FormTransferencia from "./FormTransferencia";

export const dynamic = "force-dynamic";

export default async function PaginaTransferencia({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; erro?: string; estoque?: string; item?: string; origem?: string; destino?: string; destaque?: string }>;
}) {
  const u = await exigir();
  const sp = await searchParams;
  const gestor = podeGerenciar(u);

  const estoques = await listarEstoques();
  const galpao = estoques.find((e) => e.eh_deposito === 1);
  const loja = estoques.find((e) => e.padrao === 1 && e.eh_deposito === 0) ?? estoques.find((e) => e.eh_deposito === 0);
  const filtroLoja = sp.estoque ? Number(sp.estoque) : 0;

  const filtroWhere = filtroLoja ? "WHERE loja_origem = ? OR loja_destino = ?" : "";
  const filtroParams = filtroLoja ? [filtroLoja, filtroLoja] : [];

  const [transferencias, resumo30, skus, sugestoes] = await Promise.all([
    all<any>(
      `SELECT * FROM vw_transferencias ${filtroWhere} ORDER BY id DESC LIMIT 30`,
      ...filtroParams
    ),
    one<any>(
      `SELECT COUNT(*) qtd, COALESCE(SUM(pecas),0) pecas, COALESCE(SUM(valor_custo),0) valor
       FROM transferencias WHERE status = 'concluida'
         AND CAST(data AS DATE) >= ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '30 days')::date`
    ),
    all<any>(
      `SELECT variacao_id id, sku, produto, cor_codigo, comprimento, comprimento_unidade, estoque AS total
       FROM vw_estoque_posicao WHERE variacao_status = 'ativo' AND produto_status = 'ativo'
       ORDER BY produto, cor_codigo, comprimento LIMIT 800`
    ),
    // O que a loja precisa e o galpao tem: reposicao em um clique
    galpao && loja && galpao.loja_id !== loja.loja_id
      ? all<any>(
          `SELECT lv.variacao_id, lv.sku, lv.produto, lv.cor_codigo, lv.comprimento, lv.comprimento_unidade,
                  lv.quantidade loja_qtd, lv.estoque_min, lv.situacao_estoque,
                  (SELECT COALESCE(e.quantidade,0) FROM estoque e WHERE e.variacao_id = lv.variacao_id AND e.loja_id = ?) galpao_qtd
           FROM vw_estoque_loja lv
           WHERE lv.loja_id = ? AND lv.variacao_status = 'ativo'
             AND lv.situacao_estoque IN ('sem_estoque','critico','repor')
             AND (SELECT COALESCE(e.quantidade,0) FROM estoque e WHERE e.variacao_id = lv.variacao_id AND e.loja_id = ?) > 0
           ORDER BY CASE lv.situacao_estoque WHEN 'sem_estoque' THEN 0 WHEN 'critico' THEN 1 ELSE 2 END, lv.disponivel
           LIMIT 12`,
          galpao.loja_id, loja.loja_id, galpao.loja_id
        )
      : Promise.resolve([] as any[]),
  ]);

  const itensPorTransferencia: Record<number, any[]> = {};
  if (transferencias.length) {
    const marcadores = transferencias.map(() => "?").join(",");
    const itens = await all<any>(
      `SELECT ti.transferencia_id, ti.quantidade, ti.custo_unitario, v.sku, p.nome produto,
              c.codigo cor_codigo, v.comprimento_valor, v.comprimento_unidade
       FROM transferencias_itens ti
       JOIN variacoes v ON v.id = ti.variacao_id
       JOIN produtos p ON p.id = v.produto_id
       LEFT JOIN cores c ON c.id = v.cor_id
       WHERE ti.transferencia_id IN (${marcadores})
       ORDER BY ti.id`,
      ...transferencias.map((t) => t.id)
    );
    for (const it of itens) (itensPorTransferencia[it.transferencia_id] ??= []).push(it);
  }

  const opcoesSku = skus
    .filter((s) => Number(s.total) > 0)
    .map((s) => ({
      id: s.id,
      texto: `${s.produto} | ${s.cor_codigo ?? "-"} ${s.comprimento ? s.comprimento + (s.comprimento_unidade ?? "") : ""} | ${s.sku} (total ${s.total})`,
    }));

  const origemInicial = sp.origem ? Number(sp.origem) : galpao?.loja_id ?? estoques[0]?.loja_id ?? 0;
  const destinoInicial = sp.destino ? Number(sp.destino) : loja?.loja_id ?? estoques[1]?.loja_id ?? 0;

  return (
    <>
      <Cabecalho
        titulo="Transferir entre estoques"
        subtitulo="Move produtos de um estoque para outro com documento numerado, historico nos dois lados e estorno se precisar"
        acoes={
          <>
            <Link className="btn btn-neutro" href="/estoque">Voltar para os estoques</Link>
            <Link className="btn btn-neutro" href="/estoque/movimentos">Historico de movimentos</Link>
          </>
        }
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        {estoques.length < 2 ? (
          <Secao titulo="Precisa de dois estoques">
            <Vazio
              titulo="Voce tem apenas um estoque cadastrado"
              descricao="Crie o galpao (centro de distribuicao) ou uma filial para poder transferir produtos entre os locais."
              acao={<Link className="btn btn-primario" href="/configuracoes/lojas">Criar outro estoque</Link>}
            />
          </Secao>
        ) : null}

        <Grade colunas={Math.min(estoques.length + 1, 4)}>
          {estoques.map((e) => (
            <Kpi
              key={e.loja_id}
              rotulo={rotuloEstoque(e)}
              valor={num(e.pecas) + " pecas"}
              detalhe={`${moeda(e.valor_custo)} a custo • ${e.transferencias} transferencia(s)`}
              variante={e.padrao ? "teal" : "claro"}
            />
          ))}
          <Kpi
            rotulo="Ultimos 30 dias"
            valor={`${num(resumo30?.qtd)} transferencia(s)`}
            detalhe={`${num(resumo30?.pecas)} pecas • ${moeda(resumo30?.valor)} a custo`}
            variante="ouro"
          />
        </Grade>

        {sugestoes.length > 0 && galpao && loja ? (
          <Secao
            titulo={`Repor ${loja.nome} a partir de ${galpao.nome}`}
            descricao="Estes SKUs estao faltando ou abaixo do minimo na loja e o galpao tem saldo. Transferencia em um clique."
            padding={false}
          >
            <Tabela maxAltura={340}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Cor / Comp.</th>
                  <th className="num">Na loja</th>
                  <th className="num">Minimo</th>
                  <th className="num">No galpao</th>
                  <th>Situacao na loja</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sugestoes.map((s) => (
                  <tr key={s.variacao_id}>
                    <td>
                      <strong style={{ fontSize: 13 }}>{s.produto}</strong>
                      <div style={{ fontSize: 11, color: "#7d7466" }}>{s.sku}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{s.cor_codigo ?? "—"} {s.comprimento ? `${s.comprimento}${s.comprimento_unidade ?? ""}` : ""}</td>
                    <td className="num">{num(s.loja_qtd)}</td>
                    <td className="num">{num(s.estoque_min)}</td>
                    <td className="num" style={{ color: "#166b46", fontWeight: 600 }}>{num(s.galpao_qtd)}</td>
                    <td><SituacaoEstoque situacao={s.situacao_estoque} disponivel={s.loja_qtd} /></td>
                    <td>
                      <Link
                        className="btn btn-sm btn-primario"
                        href={`/estoque/transferencia?item=${s.variacao_id}&origem=${galpao.loja_id}&destino=${loja.loja_id}`}
                      >
                        Transferir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>
        ) : null}

        {estoques.length >= 2 ? (
          <Secao
            titulo="Nova transferencia"
            descricao="Escolha de onde sai e para onde vai, adicione quantos produtos quiser e confirme. O saldo dos dois estoques muda na hora."
          >
            <FormTransferencia
              estoques={estoques.map((e) => ({ loja_id: e.loja_id, nome: e.nome, eh_deposito: e.eh_deposito, padrao: e.padrao, pecas: e.pecas }))}
              skus={opcoesSku}
              origemInicial={origemInicial}
              destinoInicial={destinoInicial}
              itemInicial={sp.item ? Number(sp.item) : undefined}
            />
          </Secao>
        ) : null}

        <Secao
          titulo="Transferencias feitas"
          descricao="Cada transferencia fica registrada com o que saiu, o que entrou, quem fez e quando"
          acoes={
            <form method="get" className="filtros" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select name="estoque" defaultValue={filtroLoja ? String(filtroLoja) : ""} aria-label="Filtrar por estoque">
                <option value="">Todos os estoques</option>
                {estoques.map((e) => (
                  <option key={e.loja_id} value={e.loja_id}>{e.nome}</option>
                ))}
              </select>
              <button className="btn btn-sm btn-neutro" type="submit">Filtrar</button>
            </form>
          }
          padding={false}
        >
          {transferencias.length === 0 ? (
            <Vazio titulo="Nenhuma transferencia ainda" descricao="A primeira transferencia aparece aqui com todos os itens." />
          ) : (
            <Tabela maxAltura={620} principal={1}>
              <thead>
                <tr>
                  <th>Numero</th>
                  <th>Data</th>
                  <th>Sai de &rarr; Entra em</th>
                  <th className="num">Itens</th>
                  <th className="num">Pecas</th>
                  <th className="num">Valor a custo</th>
                  <th>Autor</th>
                  <th>Status</th>
                  <th>Produtos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transferencias.map((t) => {
                  const itens = itensPorTransferencia[t.id] ?? [];
                  const cancelada = t.status === "cancelada";
                  return (
                    <tr key={t.id} style={cancelada ? { opacity: 0.65 } : undefined}>
                      <td>
                        <strong style={{ fontSize: 12.5 }}>{t.numero}</strong>
                        <div style={{ fontSize: 11, color: "#7d7466" }}>{t.id === Number(sp.destaque) ? "ultima criada" : ""}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{dataBR(t.data)}</td>
                      <td style={{ fontSize: 12.5 }}>
                        <span className="tag tag-azul">{t.origem_deposito ? "Galpao" : "Loja"}</span> {t.origem}
                        <div style={{ marginTop: 3 }}>
                          <span className="tag tag-verde">{t.destino_deposito ? "Galpao" : "Loja"}</span> {t.destino}
                        </div>
                      </td>
                      <td className="num">{num(t.itens)}</td>
                      <td className="num"><strong>{num(t.pecas)}</strong></td>
                      <td className="num">{moeda(t.valor_custo)}</td>
                      <td style={{ fontSize: 12 }}>
                        {t.autor ?? "—"}
                        <div style={{ fontSize: 11, color: "#7d7466" }}>{dataHoraBR(t.criado_em)}</div>
                      </td>
                      <td>
                        <span className={"tag " + (cancelada ? "tag-vermelho" : "tag-verde")}>{cancelada ? "cancelada" : "concluida"}</span>
                        {cancelada ? <div style={{ fontSize: 11, color: "#7d7466" }}>{t.motivo_cancelamento ?? ""}</div> : null}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <details>
                          <summary style={{ cursor: "pointer", color: "#0a5c6b" }}>{itens.length} SKU(s)</summary>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                            {itens.map((i, idx) => (
                              <div key={idx} style={{ fontSize: 11.5 }}>
                                <strong>{i.quantidade}</strong>x {i.produto}
                                {i.cor_codigo ? ` (${i.cor_codigo})` : ""} <span style={{ color: "#7d7466" }}>{i.sku}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td>
                        {gestor && !cancelada ? (
                          <form action={acaoCancelarTransferencia} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="hidden" name="transferencia_id" value={t.id} />
                            <input
                              name="motivo"
                              placeholder="Motivo"
                              aria-label={"Motivo do cancelamento de " + t.numero}
                              style={{ maxWidth: 120 }}
                            />
                            <button className="btn btn-sm btn-perigo" type="submit">Cancelar</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Como funciona" descricao="Regra simples: o galpao guarda, a loja vende.">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "#4c463d" }}>
            <li>Cada estoque tem saldo proprio: o mesmo SKU pode ter 100 no galpao e 3 na loja.</li>
            <li>Transferir e a unica forma de mover saldo entre eles, e sempre gera um documento (TRF-xxxxx) com autor e data.</li>
            <li>O saldo nao aparece do nada: a origem precisa ter a quantidade transferida (falta de saldo bloqueia e explica).</li>
            <li>Cancelar estorna as duas pontas; se o destino ja consumiu, o sistema avisa em vez de deixar saldo negativo.</li>
            <li>A venda no PDV baixa do estoque do caixa aberto ({loja?.nome ?? "estoque de venda"}).</li>
          </ul>
        </Secao>
      </Conteudo>
    </>
  );
}
