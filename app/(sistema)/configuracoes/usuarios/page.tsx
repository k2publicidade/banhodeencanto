import Link from "next/link";
import { exigirGestao } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Campo, CampoSelect, Linha } from "@/components/ui";
import { postSalvarUsuario } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

export default async function PaginaUsuarios({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string }>;
}) {
  const eu = await exigirGestao();
  const sp = await searchParams;
  const editando = sp.editar ? one<any>("SELECT * FROM usuarios WHERE id = ?", Number(sp.editar)) : null;

  const usuarios = all<any>(
    `SELECT u.*, l.nome loja,
            (SELECT COUNT(*) FROM vendas v WHERE v.usuario_id = u.id) vendas,
            (SELECT COALESCE(SUM(v.total),0) FROM vendas v WHERE v.vendedor_id = u.id AND v.status='concluida') faturamento
     FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id
     ORDER BY CASE u.papel WHEN 'admin' THEN 0 WHEN 'gerente' THEN 1 WHEN 'vendedor' THEN 2 ELSE 3 END, u.nome`
  );

  return (
    <>
      <Cabecalho
        titulo="Usuarios e permissoes"
        subtitulo="Quem opera o caixa, quem gerencia e quem vende (com comissao)"
        acoes={<Link className="btn btn-neutro" href="/configuracoes">Configuracoes</Link>}
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #1f8a5b", color: "#166b46", fontWeight: 600 }}>{sp.msg}</div> : null}
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}

        <Secao
          titulo={editando ? `Editar ${editando.nome}` : "Novo usuario"}
          descricao="O PIN numerico permite autorizar desconto e liberar acoes no caixa sem sair do PDV"
        >
          <form action={postSalvarUsuario}>
            <input type="hidden" name="__id" value={editando?.id ?? ""} />
            <Linha colunas="2fr 1fr 2fr">
              <Campo rotulo="Nome completo" nome="nome" valor={editando?.nome} obrigatorio />
              <Campo rotulo="Apelido (PDV e cupom)" nome="apelido" valor={editando?.apelido} />
              <Campo rotulo="E-mail de acesso" nome="email" valor={editando?.email} tipo="email" />
            </Linha>
            <Linha colunas="1fr 1fr 1fr 1fr 1fr">
              <CampoSelect
                rotulo="Papel"
                nome="papel"
                valor={editando?.papel ?? "operador"}
                opcoes={[
                  { valor: "admin", texto: "Administrador (acesso total)" },
                  { valor: "gerente", texto: "Gerente (gestao e cancelamentos)" },
                  { valor: "vendedor", texto: "Vendedor (vende no PDV, com comissao)" },
                  { valor: "operador", texto: "Operador de caixa" },
                ]}
              />
              <Campo
                rotulo="PIN numerico"
                nome="pin"
                valor={editando?.pin}
                placeholder="1234"
                ajuda="4 a 6 digitos"
              />
              <Campo rotulo="Comissao (%)" nome="comissao_pct" valor={editando?.comissao_pct} tipo="number" />
              <Campo rotulo="Telefone" nome="telefone" valor={editando?.telefone} />
              <Campo
                rotulo={editando ? "Nova senha (opcional)" : "Senha"}
                nome="senha"
                tipo="password"
                ajuda={editando ? "Deixe vazio para manter a atual" : "Minimo 6 caracteres"}
              />
            </Linha>
            {editando ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <input type="checkbox" name="ativo" value="1" defaultChecked={!!editando.ativo} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Usuario ativo</span>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Cadastrar usuario"}</button>
              {editando ? <Link className="btn btn-neutro" href="/configuracoes/usuarios">Cancelar</Link> : null}
            </div>
          </form>
        </Secao>

        <Secao titulo={`${usuarios.length} usuario(s)`} padding={false}>
          <Tabela>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th className="num">PIN</th>
                <th className="num">Comissao</th>
                <th className="num">Vendas</th>
                <th className="num">Faturamento como vendedor</th>
                <th>Ultimo acesso</th>
                <th>Situacao</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.nome}</strong>
                    {u.apelido ? <div style={{ fontSize: 11.5, color: "#7d7466" }}>{u.apelido}</div> : null}
                    {u.id === eu.id ? <span className="tag tag-azul" style={{ marginLeft: 6, fontSize: 10 }}>VOCE</span> : null}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{u.email ?? "—"}</td>
                  <td>
                    <span className={"tag " + (u.papel === "admin" ? "tag-amarelo" : u.papel === "gerente" ? "tag-azul" : "tag-cinza")}>
                      {u.papel}
                    </span>
                  </td>
                  <td className="num">{u.pin ?? "—"}</td>
                  <td className="num">{u.comissao_pct ? u.comissao_pct + "%" : "—"}</td>
                  <td className="num">{u.vendas}</td>
                  <td className="num">{moeda(u.faturamento)}</td>
                  <td style={{ fontSize: 12 }}>{u.ultimo_acesso ?? "nunca"}</td>
                  <td><span className={"tag " + (u.ativo ? "tag-verde" : "tag-vermelho")}>{u.ativo ? "ativo" : "inativo"}</span></td>
                  <td><Link className="btn btn-sm btn-neutro" href={`/configuracoes/usuarios?editar=${u.id}`}>Editar</Link></td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Secao>
      </Conteudo>
    </>
  );
}
