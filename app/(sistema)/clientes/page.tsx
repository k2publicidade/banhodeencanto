import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, dataBR, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoArea, Linha, Kpi, Grade } from "@/components/ui";
import { postSalvarCliente } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string; q?: string; fiado?: string }>;
}) {
  await exigir();
  const sp = await searchParams;
  const editando = sp.editar ? one<any>("SELECT * FROM clientes WHERE id = ?", Number(sp.editar)) : null;
  const like = "%" + (sp.q ?? "") + "%";

  const clientes = all<any>(
    `SELECT c.*,
            COALESCE((SELECT SUM(CASE WHEN f.tipo='compra' THEN f.valor ELSE -f.valor END)
                      FROM fiado_lancamentos f WHERE f.cliente_id = c.id), 0) saldo_fiado,
            (SELECT COUNT(*) FROM vendas v WHERE v.cliente_id = c.id AND v.status='concluida') compras,
            (SELECT COALESCE(SUM(v.total),0) FROM vendas v WHERE v.cliente_id = c.id AND v.status='concluida') total_gasto,
            (SELECT MAX(v.data) FROM vendas v WHERE v.cliente_id = c.id) ultima_compra
     FROM clientes c
     WHERE c.nome LIKE ? COLLATE NOCASE OR COALESCE(c.apelido,'') LIKE ? COLLATE NOCASE
        OR COALESCE(c.cpf_cnpj,'') LIKE ? OR COALESCE(c.telefone,'') LIKE ? OR COALESCE(c.codigo,'') LIKE ?
     ORDER BY c.nome`,
    like, like, like, like, like
  );

  const comFiado = clientes.filter((c) => c.saldo_fiado > 0.01);
  const totalFiado = comFiado.reduce((s, c) => s + c.saldo_fiado, 0);
  const limiteTotal = comFiado.reduce((s, c) => s + Number(c.limite_credito), 0);

  return (
    <>
      <Cabecalho
        titulo="Clientes e fiado"
        subtitulo="Cadastro de clientes, historico de compras e controle de crediario"
        acoes={<Link className="btn btn-neutro" href="/vendas">Ver vendas</Link>}
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Clientes cadastrados" valor={String(clientes.length)} detalhe={`${clientes.filter((c) => c.compras > 0).length} ja compraram`} />
          <Kpi rotulo="Fiado em aberto" valor={moeda(totalFiado)} detalhe={`${comFiado.length} clientes devendo`} variante={totalFiado > 0 ? "amarelo" : "claro"} />
          <Kpi rotulo="Limite de credito concedido" valor={moeda(limiteTotal)} detalhe="Soma dos limites dos devedores" />
          <Kpi rotulo="Maior saldo devedor" valor={comFiado.length ? moeda(comFiado[0].saldo_fiado) : moeda(0)} detalhe={comFiado[0]?.nome ?? "—"} variante="vermelho" />
        </Grade>

        <Secao titulo={editando ? `Editar ${editando.nome}` : "Cadastrar cliente"}>
          <form action={postSalvarCliente}>
            <input type="hidden" name="__id" value={editando?.id ?? ""} />
            <Linha colunas="2fr 1fr 1fr 1fr">
              <Campo rotulo="Nome" nome="nome" valor={editando?.nome} obrigatorio />
              <Campo rotulo="Apelido" nome="apelido" valor={editando?.apelido} />
              <Campo rotulo="CPF / CNPJ" nome="cpf_cnpj" valor={editando?.cpf_cnpj} />
              <Campo rotulo="Data de nascimento" nome="nascimento" valor={editando?.nascimento} tipo="date" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Telefone" nome="telefone" valor={editando?.telefone} />
              <Campo rotulo="WhatsApp" nome="whatsapp" valor={editando?.whatsapp} />
              <Campo rotulo="E-mail" nome="email" valor={editando?.email} tipo="email" />
              <Campo rotulo="Limite de fiado (R$)" nome="limite_credito" valor={editando?.limite_credito} ajuda="0 = sem crediario" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Endereco" nome="endereco" valor={editando?.endereco} />
              <Campo rotulo="Cidade" nome="cidade" valor={editando?.cidade} />
              <Campo rotulo="UF" nome="uf" valor={editando?.uf} />
              <Campo rotulo="CEP" nome="cep" valor={editando?.cep} />
            </Linha>
            <CampoArea rotulo="Observacoes" nome="observacoes" valor={editando?.observacoes} linhas={2} placeholder="Preferencias de cor, historico, indicacao..." />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Cadastrar cliente"}</button>
              {editando ? <Link className="btn btn-neutro" href="/clientes">Cancelar edicao</Link> : null}
            </div>
          </form>
        </Secao>

        {comFiado.length > 0 ? (
          <Secao titulo="Crediario em aberto" descricao="Clientes com saldo devedor" padding={false}>
            <Tabela>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Telefone</th>
                  <th className="num">Saldo devedor</th>
                  <th className="num">Limite</th>
                  <th className="num">Disponivel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {comFiado.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nome}</strong></td>
                    <td>{c.telefone ?? "—"}</td>
                    <td className="num"><strong style={{ color: "#9c2b2b" }}>{moeda(c.saldo_fiado)}</strong></td>
                    <td className="num">{moeda(c.limite_credito)}</td>
                    <td className="num">{moeda(Math.max(0, Number(c.limite_credito) - c.saldo_fiado))}</td>
                    <td><Link className="btn btn-sm btn-primario" href={`/clientes/${c.id}`}>Ver ficha / receber</Link></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>
        ) : null}

        <Secao titulo="Buscar">
          <form method="get" className="grade-form" style={{ "--cols-desktop": "2fr auto" } as React.CSSProperties}>
            <Campo rotulo="Buscar" nome="q" valor={sp.q} placeholder="Nome, apelido, CPF, telefone ou codigo" />
            <button className="btn btn-primario" type="submit">Buscar</button>
          </form>
        </Secao>

        <Secao titulo={`${clientes.length} cliente(s)`} padding={false}>
          <Tabela maxAltura={560}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Cliente</th>
                <th>Contato</th>
                <th className="num">Compras</th>
                <th className="num">Total gasto</th>
                <th className="num">Fiado</th>
                <th>Ultima compra</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontSize: 12, color: "#7d7466" }}>{c.codigo}</td>
                  <td>
                    <Link href={`/clientes/${c.id}`} style={{ color: "#0a5c6b", fontWeight: 600 }}>{c.nome}</Link>
                    {c.apelido ? <div style={{ fontSize: 11.5, color: "#7d7466" }}>{c.apelido}</div> : null}
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {c.telefone ?? "—"}
                    <div style={{ color: "#7d7466" }}>{c.cpf_cnpj ?? ""}</div>
                  </td>
                  <td className="num">{c.compras}</td>
                  <td className="num">{moeda(c.total_gasto)}</td>
                  <td className="num">
                    {c.saldo_fiado > 0.01 ? <span className="tag tag-vermelho">{moeda(c.saldo_fiado)}</span> : <span style={{ color: "#7d7466" }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{c.ultima_compra ? dataBR(c.ultima_compra) : "—"}</td>
                  <td><Link className="btn btn-sm btn-neutro" href={`/clientes?editar=${c.id}`}>Editar</Link></td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Secao>
      </Conteudo>
    </>
  );
}
