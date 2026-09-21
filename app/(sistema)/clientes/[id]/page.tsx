import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, dataBR, dataHoraBR, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, CampoArea, Linha, Kpi, Grade, TagStatus } from "@/components/ui";
import { postLancarFiado, postSalvarCliente } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

export default async function FichaCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; erro?: string }>;
}) {
  await exigir();
  const { id } = await params;
  const sp = await searchParams;
  const clienteId = Number(id);

  const c = one<any>("SELECT * FROM clientes WHERE id = ?", clienteId);
  if (!c) notFound();

  const fiado = all<any>(
    `SELECT f.*, fp.nome forma, u.nome usuario, v.numero venda_numero
     FROM fiado_lancamentos f
     LEFT JOIN formas_pagamento fp ON fp.id = f.forma_pagamento_id
     LEFT JOIN usuarios u ON u.id = f.usuario_id
     LEFT JOIN vendas v ON v.id = f.venda_id
     WHERE f.cliente_id = ? ORDER BY f.id DESC`,
    clienteId
  );

  const vendas = all<any>(
    `SELECT v.id, v.numero, v.data, v.total, v.status, u.nome operador,
            (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id = v.id) itens
     FROM vendas v LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.cliente_id = ? ORDER BY v.id DESC LIMIT 100`,
    clienteId
  );

  const saldo = one<{ s: number }>(
    "SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s FROM fiado_lancamentos WHERE cliente_id = ?",
    clienteId
  )?.s ?? 0;

  const totalGasto = vendas.filter((v) => v.status !== "cancelada").reduce((s, v) => s + Number(v.total), 0);
  const ticket = vendas.length ? totalGasto / vendas.filter((v) => v.status !== "cancelada").length : 0;

  return (
    <>
      <Cabecalho
        titulo={c.nome}
        subtitulo={`${c.codigo ?? ""} • ${c.telefone ?? "sem telefone"} • ${c.cidade ?? ""} ${c.uf ?? ""}`}
        acoes={<Link className="btn btn-neutro" href="/clientes">Voltar</Link>}
      />

      <Conteudo largura={1200}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Saldo de fiado" valor={moeda(saldo)} detalhe={saldo > 0 ? "em aberto" : "nada devendo"} variante={saldo > 0 ? "vermelho" : "verde"} />
          <Kpi rotulo="Limite de credito" valor={moeda(c.limite_credito)} detalhe={`Disponivel ${moeda(Math.max(0, Number(c.limite_credito) - saldo))}`} />
          <Kpi rotulo="Total gasto" valor={moeda(totalGasto)} detalhe={`${vendas.length} vendas`} variante="teal" />
          <Kpi rotulo="Ticket medio" valor={moeda(ticket)} detalhe="Media por compra" />
        </Grade>

        {saldo > 0 ? (
          <Secao titulo="Receber pagamento do fiado" descricao="Registre o valor pago pelo cliente para abater o saldo">
            <form action={postLancarFiado}>
              <input type="hidden" name="cliente_id" value={clienteId} />
              <Linha colunas="180px 180px 2fr auto">
                <Campo rotulo="Valor recebido (R$)" nome="valor" placeholder={String(saldo).replace(".", ",")} obrigatorio />
                <div>
                  <label htmlFor="tipo">Tipo</label>
                  <select id="tipo" name="tipo" defaultValue="pagamento">
                    <option value="pagamento">Pagamento (abate o saldo)</option>
                    <option value="ajuste">Ajuste (aumenta o saldo)</option>
                  </select>
                </div>
                <Campo rotulo="Observacao" nome="observacoes" placeholder="Ex: pagou em dinheiro, PIX" />
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button className="btn btn-primario" type="submit">Registrar</button>
                </div>
              </Linha>
            </form>
          </Secao>
        ) : null}

        <Secao titulo="Extrato do crediario" descricao="Todas as compras no fiado e todos os pagamentos" padding={false}>
          {fiado.length === 0 ? (
            <Vazio titulo="Nenhum lancamento de fiado" descricao="Este cliente nunca comprou no crediario." />
          ) : (
            <Tabela>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Venda</th>
                  <th className="num">Valor</th>
                  <th className="num">Saldo apos</th>
                  <th>Vencimento</th>
                  <th>Observacao</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {[...fiado].reverse().map((f) => (
                  <tr key={f.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{dataHoraBR(f.data)}</td>
                    <td>
                      <span className={"tag " + (f.tipo === "compra" ? "tag-vermelho" : f.tipo === "pagamento" ? "tag-verde" : "tag-cinza")}>
                        {f.tipo}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {f.venda_id ? <Link href={`/vendas/${f.venda_id}`} style={{ color: "#0a5c6b" }}>{f.venda_numero}</Link> : "—"}
                    </td>
                    <td className="num" style={{ color: f.tipo === "pagamento" ? "#166b46" : "#9c2b2b", fontWeight: 600 }}>
                      {f.tipo === "pagamento" ? "− " : "+ "}{moeda(f.valor)}
                    </td>
                    <td className="num"><strong>{moeda(f.saldo_apos)}</strong></td>
                    <td style={{ fontSize: 12.5 }}>{f.vencimento ? dataBR(f.vencimento) : "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{f.observacoes ?? "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{f.usuario ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Historico de compras" descricao={`${vendas.length} venda(s)`} padding={false}>
          {vendas.length === 0 ? (
            <Vazio titulo="Nenhuma compra registrada" />
          ) : (
            <Tabela maxAltura={420}>
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Data</th>
                  <th className="num">Itens</th>
                  <th className="num">Total</th>
                  <th>Operador</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/vendas/${v.id}`} style={{ color: "#0a5c6b", fontWeight: 600 }}>{v.numero}</Link></td>
                    <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{dataHoraBR(v.data)}</td>
                    <td className="num">{v.itens}</td>
                    <td className="num"><strong>{moeda(v.total)}</strong></td>
                    <td style={{ fontSize: 12.5 }}>{v.operador ?? "—"}</td>
                    <td><TagStatus status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Dados cadastrais">
          <form action={postSalvarCliente}>
            <input type="hidden" name="__id" value={clienteId} />
            <Linha colunas="2fr 1fr 1fr 1fr">
              <Campo rotulo="Nome" nome="nome" valor={c.nome} obrigatorio />
              <Campo rotulo="Apelido" nome="apelido" valor={c.apelido} />
              <Campo rotulo="CPF / CNPJ" nome="cpf_cnpj" valor={c.cpf_cnpj} />
              <Campo rotulo="Nascimento" nome="nascimento" valor={c.nascimento} tipo="date" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Telefone" nome="telefone" valor={c.telefone} />
              <Campo rotulo="WhatsApp" nome="whatsapp" valor={c.whatsapp} />
              <Campo rotulo="E-mail" nome="email" valor={c.email} />
              <Campo rotulo="Limite de fiado (R$)" nome="limite_credito" valor={c.limite_credito} />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Endereco" nome="endereco" valor={c.endereco} />
              <Campo rotulo="Cidade" nome="cidade" valor={c.cidade} />
              <Campo rotulo="UF" nome="uf" valor={c.uf} />
              <Campo rotulo="CEP" nome="cep" valor={c.cep} />
            </Linha>
            <CampoArea rotulo="Observacoes" nome="observacoes" valor={c.observacoes} linhas={2} />
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primario" type="submit">Salvar cadastro</button>
            </div>
          </form>
        </Secao>
      </Conteudo>
    </>
  );
}
