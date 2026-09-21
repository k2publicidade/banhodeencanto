import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num, dataBR } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoArea, Linha, Kpi, Grade } from "@/components/ui";
import { postSalvarAuxiliar } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

export default async function PaginaFornecedores({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string; q?: string }>;
}) {
  await exigir();
  const sp = await searchParams;
  const editando = sp.editar ? one<any>("SELECT * FROM fornecedores WHERE id = ?", Number(sp.editar)) : null;

  const like = "%" + (sp.q ?? "") + "%";
  const fornecedores = all<any>(
    `SELECT f.*,
            (SELECT COUNT(DISTINCT pf.produto_id) FROM produto_fornecedor pf WHERE pf.fornecedor_id = f.id) produtos,
            (SELECT COUNT(*) FROM compras c WHERE c.fornecedor_id = f.id AND c.status='confirmado') compras,
            (SELECT COALESCE(SUM(c.total),0) FROM compras c WHERE c.fornecedor_id = f.id AND c.status='confirmado') total_comprado,
            (SELECT MAX(c.data) FROM compras c WHERE c.fornecedor_id = f.id AND c.status='confirmado') ultima_compra
     FROM fornecedores f
     WHERE f.razao_social LIKE ? COLLATE NOCASE OR COALESCE(f.nome_fantasia,'') LIKE ? COLLATE NOCASE
        OR COALESCE(f.cnpj,'') LIKE ? OR COALESCE(f.contato,'') LIKE ? COLLATE NOCASE
     ORDER BY f.razao_social`,
    like, like, like, like
  );

  const tot = one<any>(
    `SELECT COUNT(*) n, (SELECT COUNT(*) FROM produto_fornecedor) vinculos,
            (SELECT COALESCE(SUM(total),0) FROM compras WHERE status='confirmado') comprado,
            (SELECT COUNT(*) FROM compras WHERE status='confirmado') ncompras FROM fornecedores`
  );

  return (
    <>
      <Cabecalho
        titulo="Fornecedores"
        subtitulo="Fornecedor e uma entidade com relacao N:N com os produtos - nao um campo de texto"
        acoes={<Link className="btn btn-neutro" href="/compras/nova">Registrar compra</Link>}
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={3}>
          <Kpi rotulo="Fornecedores" valor={String(tot?.n ?? 0)} detalhe={`${tot?.vinculos ?? 0} vinculos produto x fornecedor`} />
          <Kpi rotulo="Total comprado" valor={moeda(tot?.comprado ?? 0)} detalhe="Compras confirmadas" variante="teal" />
          <Kpi
            rotulo="Ticket medio por compra"
            valor={moeda((tot?.ncompras ?? 0) > 0 ? Number(tot.comprado) / Number(tot.ncompras) : 0)}
            detalhe={`${tot?.ncompras ?? 0} compras confirmadas`}
          />
        </Grade>

        <Secao titulo={editando ? `Editar ${editando.razao_social}` : "Cadastrar fornecedor"}>
          <form action={postSalvarAuxiliar}>
            <input type="hidden" name="__tabela" value="fornecedores" />
            <input type="hidden" name="__id" value={editando?.id ?? ""} />
            <Linha colunas="2fr 1fr 1fr">
              <Campo rotulo="Razao social" nome="razao_social" valor={editando?.razao_social} obrigatorio />
              <Campo rotulo="Nome fantasia" nome="nome_fantasia" valor={editando?.nome_fantasia} />
              <Campo rotulo="CNPJ" nome="cnpj" valor={editando?.cnpj} placeholder="00.000.000/0001-00" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(170px,1fr))">
              <Campo rotulo="Contato" nome="contato" valor={editando?.contato} placeholder="Nome do vendedor" />
              <Campo rotulo="Telefone" nome="telefone" valor={editando?.telefone} />
              <Campo rotulo="WhatsApp" nome="whatsapp" valor={editando?.whatsapp} />
              <Campo rotulo="E-mail" nome="email" valor={editando?.email} tipo="email" />
              <Campo rotulo="Prazo medio de entrega (dias)" nome="prazo_medio_entrega" valor={editando?.prazo_medio_entrega} tipo="number" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(170px,1fr))">
              <Campo rotulo="Endereco" nome="endereco" valor={editando?.endereco} />
              <Campo rotulo="Cidade" nome="cidade" valor={editando?.cidade} />
              <Campo rotulo="UF" nome="uf" valor={editando?.uf} />
              <Campo rotulo="CEP" nome="cep" valor={editando?.cep} />
              <Campo rotulo="Condicao de pagamento" nome="condicao_pagamento" valor={editando?.condicao_pagamento} placeholder="30/60/90 dias" />
            </Linha>
            <CampoArea rotulo="Observacoes" nome="observacoes" valor={editando?.observacoes} linhas={2} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Cadastrar fornecedor"}</button>
              {editando ? <Link className="btn btn-neutro" href="/fornecedores">Cancelar edicao</Link> : null}
            </div>
          </form>
        </Secao>

        <Secao titulo="Buscar e listar">
          <form method="get" className="grade-form" style={{ "--cols-desktop": "2fr auto" } as React.CSSProperties}>
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="Razao social, fantasia, CNPJ ou contato" />
            <button className="btn btn-primario" type="submit">Buscar</button>
          </form>
        </Secao>

        <Secao titulo={`${fornecedores.length} fornecedor(es)`} padding={false}>
          {fornecedores.length === 0 ? (
            <Vazio titulo="Nenhum fornecedor encontrado" />
          ) : (
            <Tabela maxAltura={560}>
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Contato</th>
                  <th className="num">Prazo</th>
                  <th className="num">Produtos</th>
                  <th className="num">Compras</th>
                  <th className="num">Total comprado</th>
                  <th>Ultima compra</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.razao_social}</strong>
                      <div style={{ fontSize: 11.5, color: "#7d7466" }}>
                        {f.nome_fantasia ? f.nome_fantasia + " • " : ""}{f.cnpj ?? "sem CNPJ"}
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {f.contato ?? "—"}
                      <div style={{ color: "#7d7466" }}>{f.telefone ?? f.whatsapp ?? ""}</div>
                    </td>
                    <td className="num">{f.prazo_medio_entrega ? f.prazo_medio_entrega + "d" : "—"}</td>
                    <td className="num">{f.produtos}</td>
                    <td className="num">{f.compras}</td>
                    <td className="num">{moeda(f.total_comprado)}</td>
                    <td style={{ fontSize: 12.5 }}>{f.ultima_compra ? dataBR(f.ultima_compra) : "—"}</td>
                    <td>
                      <Link className="btn btn-sm btn-neutro" href={`/fornecedores?editar=${f.id}`}>Editar</Link>
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
