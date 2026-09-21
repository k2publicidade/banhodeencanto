import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Kpi, Grade, Campo, CampoSelect, CampoArea, Linha } from "@/components/ui";
import { postSalvarConfiguracoes } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

export default async function PaginaConfiguracoes({ searchParams }: { searchParams: Promise<{ msg?: string; erro?: string }> }) {
  await exigir();
  const sp = await searchParams;

  const cfg: Record<string, string> = {};
  for (const c of all<{ chave: string; valor: string }>("SELECT chave, valor FROM configuracoes")) cfg[c.chave] = c.valor ?? "";

  const lojas = all<any>("SELECT * FROM lojas ORDER BY padrao DESC, nome");
  const usuarios = all<any>("SELECT id, nome, apelido, email, papel, ativo, comissao_pct FROM usuarios ORDER BY nome");
  const produtos = one<{ n: number }>("SELECT COUNT(*) n FROM produtos")?.n ?? 0;
  const skus = one<{ n: number }>("SELECT COUNT(*) n FROM variacoes")?.n ?? 0;
  const vendas = one<any>("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM vendas")?.n ?? 0;
  const vendasTotal = one<any>("SELECT COALESCE(SUM(total),0) t FROM vendas WHERE status='concluida'")?.t ?? 0;
  const movimentos = one<{ n: number }>("SELECT COUNT(*) n FROM estoque_movimentos")?.n ?? 0;
  const audit = all<any>(
    `SELECT a.acao, a.entidade, a.detalhe, a.criado_em, COALESCE(a.usuario_nome,'sistema') usuario
     FROM auditoria a ORDER BY a.id DESC LIMIT 20`
  );

  return (
    <>
      <Cabecalho
        titulo="Configuracoes"
        subtitulo="Dados da empresa, cupom, regras do PDV, usuarios e unidades"
        acoes={
          <>
            <Link className="btn btn-neutro" href="/configuracoes/usuarios">Usuarios</Link>
            <Link className="btn btn-neutro" href="/configuracoes/lojas">Unidades / lojas</Link>
            <Link className="btn btn-neutro" href="/cadastros">Cadastros auxiliares</Link>
          </>
        }
      />

      <Conteudo largura={1150}>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Grade colunas={5}>
          <Kpi rotulo="Produtos" valor={String(produtos)} detalhe={`${skus} SKUs`} />
          <Kpi rotulo="Vendas" valor={String(vendas)} detalhe={moeda(vendasTotal)} />
          <Kpi rotulo="Movimentacoes de estoque" valor={String(movimentos)} detalhe="Historico completo" />
          <Kpi rotulo="Usuarios" valor={String(usuarios.length)} detalhe={`${usuarios.filter((u) => u.ativo).length} ativos`} href="/configuracoes/usuarios" />
          <Kpi rotulo="Unidades" valor={String(lojas.length)} detalhe={`${lojas.filter((l) => l.eh_deposito).length} deposito(s)`} href="/configuracoes/lojas" />
        </Grade>

        <form action={postSalvarConfiguracoes}>
          <Secao titulo="Dados da empresa" descricao="Aparecem no cupom, nas etiquetas e no sistema">
            <Linha colunas="2fr 2fr">
              <Campo rotulo="Nome fantasia" nome="empresa_nome" valor={cfg.empresa_nome} />
              <Campo rotulo="Assinatura / slogan" nome="empresa_slogan" valor={cfg.empresa_slogan} placeholder="Cabelos Sinteticos" />
            </Linha>
          </Secao>

          <Secao titulo="Cupom e impressora" descricao="Configuracao da impressao no caixa">
            <Linha colunas="1fr 1fr 1fr">
              <CampoSelect
                rotulo="Largura da impressora"
                nome="cupom_impressora"
                valor={cfg.cupom_impressora ?? "80mm"}
                opcoes={[
                  { valor: "58mm", texto: "Bobina termica 58mm" },
                  { valor: "80mm", texto: "Bobina termica 80mm" },
                  { valor: "a4", texto: "Folha A4 / impressora comum" },
                ]}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="cupom_imprimir_automatico" value="1" defaultChecked={cfg.cupom_imprimir_automatico === "1"} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Abrir impressao automaticamente ao finalizar</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="cupom_mostrar_cnpj" value="1" defaultChecked={cfg.cupom_mostrar_cnpj === "1"} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Mostrar CNPJ no cupom</span>
              </div>
            </Linha>
            <CampoArea rotulo="Mensagem no rodape do cupom" nome="cupom_mensagem" valor={cfg.cupom_mensagem} linhas={2} />
          </Secao>

          <Secao titulo="Regras do PDV e do estoque">
            <Linha colunas="1fr 1fr 1fr">
              <Campo
                rotulo="Desconto maximo do operador (%)"
                nome="cupom_desconto_max_pct"
                valor={cfg.cupom_desconto_max_pct}
                tipo="number"
                ajuda="Acima disso, exige PIN de gerente/administrador"
              />
              <CampoSelect
                rotulo="Metodo de custo"
                nome="estoque_metodo_custo"
                valor={cfg.estoque_metodo_custo ?? "medio"}
                opcoes={[
                  { valor: "medio", texto: "Custo medio ponderado" },
                  { valor: "ultimo", texto: "Ultimo custo de compra" },
                ]}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="pdv_permite_estoque_negativo" value="1" defaultChecked={cfg.pdv_permite_estoque_negativo === "1"} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Permitir vender com estoque zerado</span>
              </div>
            </Linha>
            <Linha colunas="1fr 1fr">
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 16 }}>
                <input type="checkbox" name="pdv_leitor_codigo_barras" value="1" defaultChecked={cfg.pdv_leitor_codigo_barras === "1"} style={{ width: "auto" }} />
                <span style={{ fontSize: 13.5 }}>Leitor de codigo de barras ativo no caixa</span>
              </div>
            </Linha>
            <div style={{ marginTop: 4 }}>
              <button className="btn btn-primario" type="submit">Salvar configuracoes</button>
            </div>
          </Secao>
        </form>

        <Secao titulo="Ultimas acoes no sistema" descricao="Trilha de auditoria" padding={false}>
          <Tabela maxAltura={380}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Usuario</th>
                <th>Acao</th>
                <th>Registro</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{a.criado_em}</td>
                  <td style={{ fontSize: 12.5 }}>{a.usuario}</td>
                  <td><span className="tag tag-cinza">{a.acao}</span></td>
                  <td style={{ fontSize: 12.5 }}>{a.entidade}</td>
                  <td style={{ fontSize: 12 }}>{a.detalhe ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Secao>
      </Conteudo>
    </>
  );
}
