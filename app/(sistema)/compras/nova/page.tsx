import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Campo, CampoSelect, CampoArea, Linha, Vazio, CorBolinha } from "@/components/ui";
import { acaoCriarCompra } from "@/app/actions/estoque";

export const dynamic = "force-dynamic";

const LINHAS_ITEM = 10;

export default async function NovaCompra({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; q?: string; fornecedor?: string }>;
}) {
  await exigir();
  const sp = await searchParams;

  const [fornecedores, lojas] = await Promise.all([
    all<{ id: number; nome: string; prazo_medio_entrega: number | null }>(
      "SELECT id, COALESCE(nome_fantasia, razao_social) nome, prazo_medio_entrega FROM fornecedores WHERE ativo=1 ORDER BY nome_fantasia"
    ),
    all<{ id: number; nome: string }>("SELECT id, nome FROM lojas WHERE ativa=1 ORDER BY padrao DESC, nome"),
  ]);

  let opcoes: any[] = [];
  if (sp.q && sp.q.trim().length >= 2) {
    opcoes = await all<any>(
      `SELECT variacao_id, sku, produto, cor_codigo, comprimento, comprimento_unidade, custo_medio, disponivel, produto_id
       FROM vw_estoque_posicao
       WHERE (produto ILIKE ? OR sku ILIKE ? OR cor_codigo ILIKE ?)
       ORDER BY produto, cor_codigo LIMIT 250`,
      "%" + sp.q + "%", "%" + sp.q + "%", "%" + sp.q + "%"
    );
  }

  // Sugestao de compra: SKUs no ponto de reposicao ou abaixo
  const sugestoes = await all<any>(
    `SELECT variacao_id, sku, produto, cor_codigo, cor_hex, comprimento, comprimento_unidade,
            disponivel, estoque_min, estoque_max, ponto_reposicao, custo_medio, situacao_estoque, produto_id
     FROM vw_estoque_posicao
     WHERE variacao_status='ativo' AND situacao_estoque IN ('sem_estoque','critico','repor')
     ORDER BY CASE situacao_estoque WHEN 'sem_estoque' THEN 0 WHEN 'critico' THEN 1 ELSE 2 END, disponivel
     LIMIT 40`
  );

  const sugerido = (s: any) => {
    const alvo = Number(s.estoque_max) > 0 ? Number(s.estoque_max) : Math.max(Number(s.estoque_min) * 3, 10);
    return Math.max(1, Math.ceil(alvo - Number(s.disponivel)));
  };

  return (
    <>
      <Cabecalho
        titulo="Nova compra"
        subtitulo="Crie como rascunho e confirme depois: a entrada no estoque so acontece na confirmacao"
        acoes={<Link className="btn btn-neutro" href="/compras">Voltar</Link>}
      />

      <Conteudo largura={1250}>
        {sp.erro ? <div className="aviso aviso-erro">{sp.erro}</div> : null}

        <Secao
          titulo="Sugestao de compra"
          descricao="SKUs zerados ou abaixo do ponto de reposicao. Use os numeros para preencher os itens abaixo."
          padding={false}
        >
          {sugestoes.length === 0 ? (
            <Vazio titulo="Nada precisando de reposicao" descricao="Todos os SKUs estao acima do ponto de reposicao." />
          ) : (
            <Tabela maxAltura={280}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Cor / Comp.</th>
                  <th className="num">Disponivel</th>
                  <th className="num">Minimo</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Custo medio</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {sugestoes.map((s) => (
                  <tr key={s.variacao_id}>
                    <td style={{ fontWeight: 600, fontSize: 12.5 }}>{s.sku}</td>
                    <td>
                      <Link href={`/produtos/${s.produto_id}?aba=estoque`} style={{ color: "#0a5c6b" }}>{s.produto}</Link>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      <CorBolinha hex={s.cor_hex} codigo={s.cor_codigo} />
                      {s.comprimento ? ` ${s.comprimento}${s.comprimento_unidade}` : ""}
                    </td>
                    <td className="num">{num(s.disponivel)}</td>
                    <td className="num">{num(s.estoque_min)}</td>
                    <td className="num"><strong style={{ color: "#8a5a12" }}>{num(sugerido(s))}</strong></td>
                    <td className="num">{moeda(s.custo_medio)}</td>
                    <td>
                      <span className={"tag " + (s.situacao_estoque === "sem_estoque" ? "tag-vermelho" : "tag-amarelo")}>
                        {s.situacao_estoque.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Secao>

        <Secao titulo="Buscar SKUs para incluir" descricao="Busque por nome, cor ou SKU e depois selecione os itens na tabela abaixo">
          <form method="get" className="grade-form" style={{ "--cols-desktop": "2fr auto" } as React.CSSProperties}>
            <Campo rotulo="Buscar SKU" nome="q" valor={sp.q} placeholder="Ex: jumbo 1B, crochet, mega hair" />
            <button className="btn btn-primario" type="submit">Buscar</button>
          </form>
          {sp.q && opcoes.length === 0 ? (
            <p style={{ fontSize: 13, color: "#9c2b2b", marginTop: 10, marginBottom: 0 }}>Nenhum SKU encontrado para "{sp.q}".</p>
          ) : null}
          {opcoes.length > 0 ? (
            <p style={{ fontSize: 13, color: "#166b46", marginTop: 10, marginBottom: 0 }}>
              {opcoes.length} SKU(s) disponiveis no seletor abaixo.
            </p>
          ) : null}
        </Secao>

        <form action={acaoCriarCompra}>
          <Secao titulo="Dados da compra">
            <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
              <CampoSelect
                rotulo="Fornecedor"
                nome="fornecedor_id"
                obrigatorio
                valor={sp.fornecedor}
                opcoes={fornecedores.map((f) => ({ valor: f.id, texto: f.nome }))}
              />
              <Campo rotulo="Numero da nota do fornecedor" nome="documento" placeholder="NF 12345" />
              <CampoSelect rotulo="Entregar em" nome="loja_id" valor={lojas[0]?.id} opcoes={lojas.map((l) => ({ valor: l.id, texto: l.nome }))} />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(160px,1fr))">
              <Campo rotulo="Frete (R$)" nome="frete" placeholder="0,00" />
              <Campo rotulo="Desconto (R$)" nome="desconto" placeholder="0,00" />
              <Campo rotulo="Observacoes" nome="observacoes" placeholder="Condicao de pagamento, prazo..." />
            </Linha>
          </Secao>

          <Secao
            titulo="Itens da compra"
            descricao={`Preencha ate ${LINHAS_ITEM} linhas. Deixe em branco as que nao usar. O custo informado recalcula o custo medio do SKU.`}
            padding={false}
          >
            <Tabela>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>SKU</th>
                  <th style={{ width: 120 }} className="num">Quantidade</th>
                  <th style={{ width: 150 }} className="num">Custo unitario (R$)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: LINHAS_ITEM }, (_, i) => (
                  <tr key={i}>
                    <td style={{ color: "#7d7466" }}>{i + 1}</td>
                    <td>
                      <select name="variacao_id" defaultValue="">
                        <option value="">— selecione o SKU —</option>
                        {(opcoes.length ? opcoes : []).map((o) => (
                          <option key={o.variacao_id} value={o.variacao_id}>
                            {o.produto} | {o.cor_codigo ?? "-"} {o.comprimento ? `| ${o.comprimento}${o.comprimento_unidade}` : ""} | {o.sku} | custo {moeda(o.custo_medio)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><input name="quantidade" placeholder="0" style={{ textAlign: "right" }} /></td>
                    <td><input name="custo_unitario" placeholder="0,00" style={{ textAlign: "right" }} /></td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Secao>

          <div className="acoes-form">
            <button className="btn btn-primario btn-lg" type="submit">Criar compra (rascunho)</button>
            <Link className="btn btn-neutro btn-lg" href="/compras">Cancelar</Link>
          </div>
        </form>
      </Conteudo>
    </>
  );
}
