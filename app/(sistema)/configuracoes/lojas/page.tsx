import Link from "next/link";
import { exigirGestao, podeGerenciar } from "@/lib/auth";
import { all } from "@/lib/db";
import { moeda, num } from "@/lib/format";
import { listarEstoques, rotuloEstoque } from "@/lib/estoques";
import { Cabecalho, Conteudo, Secao, Tabela, Campo, CampoSelect, Linha, Vazio, Kpi, Grade } from "@/components/ui";
import { postSalvarLoja } from "@/app/actions/cadastros";
import { acaoDefinirEstoquePadrao, alternarEstoqueAtivo } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

export default async function PaginaEstoques({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string }>;
}) {
  const u = await exigirGestao();
  const gestor = podeGerenciar(u);
  const sp = await searchParams;

  const [estoques, vendasPorLoja] = await Promise.all([
    listarEstoques(true),
    all<any>("SELECT loja_id, COUNT(*) vendas FROM vendas GROUP BY loja_id"),
  ]);
  const vendas = new Map(vendasPorLoja.map((v) => [Number(v.loja_id), Number(v.vendas)]));
  const editando = sp.editar ? estoques.find((l) => l.loja_id === Number(sp.editar)) : null;
  const ativos = estoques.filter((e) => e.ativa === 1);
  const totalPecas = ativos.reduce((s, e) => s + Number(e.pecas), 0);
  const totalValor = ativos.reduce((s, e) => s + Number(e.valor_custo), 0);

  return (
    <>
      <Cabecalho
        titulo="Estoques e locais"
        subtitulo="Cada estoque tem saldo proprio por SKU. O galpao e o centro de distribuicao (guarda) e a loja vende no balcao."
        acoes={
          <>
            <Link className="btn btn-neutro" href="/estoque">Ver estoques</Link>
            <Link className="btn btn-primario" href="/estoque/transferencia">Transferir entre estoques</Link>
          </>
        }
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Estoques ativos" valor={String(ativos.length)} detalhe={`${ativos.filter((e) => e.eh_deposito === 0).length} loja(s) • ${ativos.filter((e) => e.eh_deposito === 1).length} galpao(s)`} variante="teal" />
          <Kpi rotulo="Pecas em estoque" valor={num(totalPecas)} detalhe="Somando todos os locais" />
          <Kpi rotulo="Valor a custo" valor={moeda(totalValor)} detalhe="Capital parado no estoque" />
          <Kpi
            rotulo="Estoque que vende"
            valor={ativos.find((e) => e.padrao === 1)?.nome ?? "—"}
            detalhe="E o estoque usado pelo PDV"
            variante="ouro"
          />
        </Grade>

        <Secao
          titulo={editando ? `Editar ${editando.nome}` : "Novo estoque / local"}
          descricao="Galpao (centro de distribuicao) nao vende no balcao, so guarda e abastece. Loja vende e pode ser o estoque padrao do PDV."
        >
          <form action={postSalvarLoja}>
            <input type="hidden" name="__id" value={editando?.loja_id ?? ""} />
            <Linha colunas="2fr 1.4fr 1fr">
              <Campo rotulo="Nome do estoque / local" nome="nome" valor={editando?.nome} obrigatorio placeholder="Banho de Encanto - Loja Centro" />
              <CampoSelect
                rotulo="Tipo"
                nome="tipo"
                valor={editando ? (editando.eh_deposito ? "deposito" : "loja") : "loja"}
                opcoes={[
                  { valor: "loja", texto: "Loja que vende (balcao / PDV)" },
                  { valor: "deposito", texto: "Galpao / centro de distribuicao (so armazena)" },
                ]}
                ajuda="Depois de salvar, o tipo fica gravado conforme a opcao escolhida."
              />
              <Campo rotulo="Apelido (cupom)" nome="apelido" valor={editando?.apelido} placeholder="BANHO DE ENCANTO" />
            </Linha>
            <Linha colunas="2fr 1fr 1fr">
              <Campo rotulo="Razao social" nome="razao_social" valor={editando?.razao_social} />
              <Campo rotulo="CNPJ" nome="cnpj" valor={editando?.cnpj} />
              <Campo rotulo="Inscricao estadual" nome="inscricao_est" valor={editando?.inscricao_est} />
            </Linha>
            <Linha colunas="2fr 1fr 1fr 1fr">
              <Campo rotulo="Endereco" nome="endereco" valor={editando?.endereco} />
              <Campo rotulo="Cidade" nome="cidade" valor={editando?.cidade} />
              <Campo rotulo="UF" nome="uf" valor={editando?.uf} />
              <Campo rotulo="CEP" nome="cep" valor={editando?.cep} />
            </Linha>
            <Linha colunas="1fr 1fr">
              <Campo rotulo="Telefone" nome="telefone" valor={editando?.telefone} />
              <Campo rotulo="E-mail" nome="email" valor={editando?.email} />
            </Linha>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px 0 14px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, textTransform: "none", letterSpacing: 0 }}>
                <input type="checkbox" name="padrao" value="1" defaultChecked={!!editando?.padrao} style={{ width: "auto" }} />
                <span>Usar este estoque como o estoque de venda (o PDV baixa daqui)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, textTransform: "none", letterSpacing: 0 }}>
                <input type="hidden" name="ativa" value="0" />
                <input type="checkbox" name="ativa" value="1" defaultChecked={!editando || !!editando.ativa} style={{ width: "auto" }} />
                <span>Estoque ativo (aparece nas telas e pode receber transferencia)</span>
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Criar estoque"}</button>
              {editando ? <Link className="btn btn-neutro" href="/configuracoes/lojas">Cancelar edicao</Link> : null}
            </div>
          </form>
        </Secao>

        <Secao titulo={`${estoques.length} estoque(s) cadastrado(s)`} padding={false}>
          {estoques.length === 0 ? (
            <Vazio titulo="Nenhum estoque cadastrado" descricao="Crie a loja e o galpao para comecar." />
          ) : (
            <Tabela principal={0}>
              <thead>
                <tr>
                  <th>Estoque</th>
                  <th>Tipo</th>
                  <th>Cidade</th>
                  <th className="num">SKUs com saldo</th>
                  <th className="num">Pecas</th>
                  <th className="num">Valor a custo</th>
                  <th className="num">Transferencias</th>
                  <th className="num">Vendas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {estoques.map((l) => (
                  <tr key={l.loja_id} style={l.ativa ? undefined : { opacity: 0.6 }}>
                    <td>
                      <strong>{l.nome}</strong>
                      {l.padrao ? <span className="tag tag-amarelo" style={{ marginLeft: 6, fontSize: 10 }}>VENDE NO PDV</span> : null}
                      {l.ativa ? null : <span className="tag tag-cinza" style={{ marginLeft: 6, fontSize: 10 }}>INATIVO</span>}
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>{l.apelido ?? ""} {l.cnpj ?? ""}</div>
                    </td>
                    <td>
                      <span className={"tag " + (l.eh_deposito ? "tag-azul" : "tag-verde")}>{l.eh_deposito ? "galpao" : "loja"}</span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{l.cidade ? `${l.cidade} ${l.uf ?? ""}` : "—"}</td>
                    <td className="num">{num(l.skus)}</td>
                    <td className="num">{num(l.pecas)}</td>
                    <td className="num">{moeda(l.valor_custo)}</td>
                    <td className="num">{num(l.transferencias)}</td>
                    <td className="num">{num(vendas.get(l.loja_id) ?? 0)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Link className="btn btn-sm btn-neutro" href={`/estoque?estoque=${l.loja_id}`}>Estoque</Link>
                        <Link className="btn btn-sm btn-neutro" href={`/configuracoes/lojas?editar=${l.loja_id}`}>Editar</Link>
                        {l.padrao ? null : (
                          <form action={acaoDefinirEstoquePadrao}>
                            <input type="hidden" name="loja_id" value={l.loja_id} />
                            <button
                              className="btn btn-sm btn-neutro"
                              type="submit"
                              disabled={l.eh_deposito === 1}
                              title={l.eh_deposito === 1 ? "Galpao/deposito nao vende no balcao" : "Marcar como o estoque que abastece o PDV"}
                            >
                              Vende no PDV
                            </button>
                          </form>
                        )}
                        <form action={alternarEstoqueAtivo}>
                          <input type="hidden" name="loja_id" value={l.loja_id} />
                          <input type="hidden" name="ativo" value={l.ativa ? "0" : "1"} />
                          <button className="btn btn-sm btn-neutro" type="submit">{l.ativa ? "Desativar" : "Ativar"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Como o estoque esta organizado" descricao="Regra simples e sem complicacao: o galpao guarda, a loja vende.">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.75, color: "#4c463d" }}>
            <li><strong>Saldo separado:</strong> o mesmo SKU pode ter 200 pecas no galpao e 12 na loja. Nada se mistura.</li>
            <li><strong>Visualizacao:</strong> a tela <Link href="/estoque">Estoques</Link> mostra cada local em um cartao e permite filtrar por estoque ou ver o consolidado.</li>
            <li><strong>Conversam entre si:</strong> a <Link href="/estoque/transferencia">transferencia</Link> move saldo do galpao para a loja (ou de volta) com documento numerado, autor e data.</li>
            <li><strong>Reposicao em um clique:</strong> a tela de transferencia lista o que esta faltando na loja e sobrando no galpao.</li>
            <li><strong>Venda:</strong> o PDV baixa do estoque do caixa aberto. O estoque marcado como "vende no PDV" e o padrao quando nenhum caixa esta aberto.</li>
            <li><strong>Compras:</strong> ao confirmar uma compra, escolha em qual estoque a mercadoria entrou.</li>
          </ul>
        </Secao>

        <Secao titulo="Resumo por local" descricao="Mesma informacao da tela de estoque, aqui para gestao rapida">
          <Grade colunas={Math.min(estoques.length, 4)}>
            {estoques.map((l) => (
              <Kpi
                key={l.loja_id}
                rotulo={rotuloEstoque(l)}
                valor={num(l.pecas) + " pecas"}
                detalhe={`${moeda(l.valor_custo)} a custo • ${moeda(l.valor_venda)} a venda`}
                href={`/estoque?estoque=${l.loja_id}`}
              />
            ))}
          </Grade>
        </Secao>
      </Conteudo>
    </>
  );
}
