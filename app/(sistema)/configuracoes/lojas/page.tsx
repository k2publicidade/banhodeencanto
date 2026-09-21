import Link from "next/link";
import { exigirGestao } from "@/lib/auth";
import { all } from "@/lib/db";
import { moeda, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Campo, Linha, Vazio } from "@/components/ui";
import { postSalvarLoja } from "@/app/actions/cadastros";
import { acaoTransferir } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

export default async function PaginaLojas({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string }>;
}) {
  await exigirGestao();
  const sp = await searchParams;

  const lojas = all<any>(
    `SELECT l.*,
            (SELECT COUNT(DISTINCT variacao_id) FROM estoque e WHERE e.loja_id = l.id AND e.quantidade > 0) skus,
            (SELECT COALESCE(SUM(e.quantidade),0) FROM estoque e WHERE e.loja_id = l.id) pecas,
            (SELECT COALESCE(SUM(e.quantidade * v.custo_medio),0) FROM estoque e JOIN variacoes v ON v.id = e.variacao_id WHERE e.loja_id = l.id) valor,
            (SELECT COUNT(*) FROM vendas v WHERE v.loja_id = l.id) vendas
     FROM lojas l ORDER BY l.padrao DESC, l.nome`
  );

  const editando = sp.editar ? lojas.find((l) => l.id === Number(sp.editar)) : null;

  return (
    <>
      <Cabecalho
        titulo="Unidades, lojas e depositos"
        subtitulo="O estoque e controlado por SKU x unidade: replicar o modelo nao exige reconstruir o sistema"
        acoes={<Link className="btn btn-neutro" href="/configuracoes">Configuracoes</Link>}
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #1f8a5b", color: "#166b46", fontWeight: 600 }}>{sp.msg}</div> : null}
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}

        <Secao
          titulo={editando ? `Editar ${editando.nome}` : "Nova unidade"}
          descricao="Cadastre a loja matriz, filiais e depositos. Cada unidade tem seu proprio saldo por SKU."
        >
          <form action={postSalvarLoja}>
            <input type="hidden" name="__id" value={editando?.id ?? ""} />
            <Linha colunas="2fr 1fr 2fr 1fr">
              <Campo rotulo="Nome da unidade" nome="nome" valor={editando?.nome} obrigatorio placeholder="Banho de Encanto - Matriz" />
              <Campo rotulo="Apelido (cupom)" nome="apelido" valor={editando?.apelido} placeholder="BANHO DE ENCANTO" />
              <Campo rotulo="Razao social" nome="razao_social" valor={editando?.razao_social} />
              <Campo rotulo="CNPJ" nome="cnpj" valor={editando?.cnpj} />
            </Linha>
            <Linha colunas="2fr 1fr 1fr 1fr">
              <Campo rotulo="Endereco" nome="endereco" valor={editando?.endereco} />
              <Campo rotulo="Cidade" nome="cidade" valor={editando?.cidade} />
              <Campo rotulo="UF" nome="uf" valor={editando?.uf} />
              <Campo rotulo="CEP" nome="cep" valor={editando?.cep} />
            </Linha>
            <Linha colunas="1fr 1fr 1fr">
              <Campo rotulo="Telefone" nome="telefone" valor={editando?.telefone} />
              <Campo rotulo="E-mail" nome="email" valor={editando?.email} />
              <Campo rotulo="Inscricao estadual" nome="inscricao_est" valor={editando?.inscricao_est} />
            </Linha>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input type="checkbox" name="eh_deposito" value="1" defaultChecked={!!editando?.eh_deposito} style={{ width: "auto" }} />
              <span style={{ fontSize: 13.5 }}>Esta unidade e um deposito (nao vende no balcao)</span>
            </div>
            <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Cadastrar unidade"}</button>
          </form>
        </Secao>

        <Secao titulo={`${lojas.length} unidade(s)`} padding={false}>
          {lojas.length === 0 ? (
            <Vazio titulo="Nenhuma unidade cadastrada" />
          ) : (
            <Tabela>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>CNPJ</th>
                  <th>Cidade</th>
                  <th className="num">SKUs com saldo</th>
                  <th className="num">Pecas</th>
                  <th className="num">Valor a custo</th>
                  <th className="num">Vendas</th>
                  <th>Tipo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lojas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.nome}</strong>
                      {l.padrao ? <span className="tag tag-amarelo" style={{ marginLeft: 6, fontSize: 10 }}>PADRAO</span> : null}
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>{l.apelido ?? ""}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{l.cnpj ?? "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{l.cidade ? `${l.cidade} ${l.uf ?? ""}` : "—"}</td>
                    <td className="num">{l.skus}</td>
                    <td className="num">{num(l.pecas)}</td>
                    <td className="num">{moeda(l.valor)}</td>
                    <td className="num">{l.vendas}</td>
                    <td><span className={"tag " + (l.eh_deposito ? "tag-azul" : "tag-verde")}>{l.eh_deposito ? "deposito" : "loja"}</span></td>
                    <td><Link className="btn btn-sm btn-neutro" href={`/configuracoes/lojas?editar=${l.id}`}>Editar</Link></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Transferencia entre unidades" descricao="Mova estoque de uma unidade para outra mantendo o historico">
          <TransferenciaForm
            variacoes={all<any>(
              `SELECT variacao_id, sku, produto, cor_codigo, comprimento, comprimento_unidade
               FROM vw_estoque_posicao WHERE variacao_status='ativo' ORDER BY produto, cor_codigo LIMIT 400`
            ).map((v) => ({
              id: v.variacao_id,
              texto: `${v.produto} | ${v.cor_codigo ?? "-"} ${v.comprimento ? v.comprimento + (v.comprimento_unidade ?? "") : ""} | ${v.sku}`,
            }))}
            lojas={lojas.map((l) => ({ id: l.id, texto: l.nome }))}
          />
        </Secao>
      </Conteudo>
    </>
  );
}

function TransferenciaForm({ variacoes, lojas }: { variacoes: { id: number; texto: string }[]; lojas: { id: number; texto: string }[] }) {
  return (
    <form action={acaoTransferir} className="grade-form" style={{ "--cols-desktop": "2.5fr 1fr 1fr 1fr auto" } as React.CSSProperties}>
      <div>
        <label htmlFor="variacao_id">SKU</label>
        <select id="variacao_id" name="variacao_id" required defaultValue="">
          <option value="">— selecione —</option>
          {variacoes.map((v) => (
            <option key={v.id} value={v.id}>{v.texto}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="loja_origem">Origem</label>
        <select id="loja_origem" name="loja_origem" required defaultValue="">
          <option value="">—</option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>{l.texto}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="loja_destino">Destino</label>
        <select id="loja_destino" name="loja_destino" required defaultValue="">
          <option value="">—</option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>{l.texto}</option>
          ))}
        </select>
      </div>
      <Campo rotulo="Quantidade" nome="quantidade" placeholder="10" />
      <button className="btn btn-primario" type="submit">Transferir</button>
    </form>
  );
}
