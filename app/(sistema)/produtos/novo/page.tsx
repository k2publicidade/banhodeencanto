import Link from "next/link";
import { exigir } from "@/lib/auth";
import { one } from "@/lib/db";
import { listaFiltros } from "@/lib/consultas";
import { Cabecalho, Conteudo, Secao, Campo, CampoSelect, CampoArea, Linha } from "@/components/ui";
import { postCriarProduto } from "@/app/actions/produto-form";

export const dynamic = "force-dynamic";

export default async function NovoProduto({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await exigir();
  const sp = await searchParams;
  const f = listaFiltros();
  const nSku = (one<{ n: number }>("SELECT COUNT(*) n FROM produtos")?.n ?? 0) + 1;

  return (
    <>
      <Cabecalho
        titulo="Novo produto"
        subtitulo="Passo 1 de 2: identifique o produto. Depois voce gera as variacoes por cor e comprimento."
        acoes={<Link className="btn btn-neutro" href="/produtos">Cancelar</Link>}
      />

      <Conteudo largura={1100}>
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}

        <form action={postCriarProduto}>
          <Secao titulo="Identificacao" descricao="O produto-pai agrupa todas as cores e comprimentos. Nao cadastre cada cor como um produto separado.">
            <Linha colunas="2fr 1fr 1fr">
              <Campo rotulo="Nome do produto" nome="nome" obrigatorio placeholder="Jumbo Ultra Braid" ajuda="Ex.: Jumbo Ultra Braid, Crochet Twist Out, Mega Hair Fita Adesiva" />
              <Campo rotulo="SKU do produto" nome="sku" placeholder={`BDE-${String(nSku).padStart(3, "0")}`} ajuda="Deixe vazio para gerar" />
              <Campo rotulo="Codigo de barras do pai" nome="ean" placeholder="Opcional" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(190px,1fr))">
              <CampoSelect rotulo="Marca" nome="marca_id" opcoes={f.marcas.map((m) => ({ valor: m.id, texto: m.nome }))} />
              <CampoSelect rotulo="Linha / colecao" nome="linha_id" opcoes={f.linhas.map((l) => ({ valor: l.id, texto: l.nome }))} />
              <CampoSelect rotulo="Categoria" nome="categoria_id" opcoes={f.categoriasPai.map((c) => ({ valor: c.id, texto: c.nome }))} />
              <CampoSelect rotulo="Subcategoria" nome="subcategoria_id" opcoes={f.subcategorias.map((c) => ({ valor: c.id, texto: c.nome }))} />
              <CampoSelect
                rotulo="Status"
                nome="status"
                valor="ativo"
                opcoes={[
                  { valor: "ativo", texto: "Ativo" },
                  { valor: "inativo", texto: "Inativo" },
                ]}
              />
            </Linha>
          </Secao>

          <Secao titulo="Classificacao de cabelos" descricao="O que faz o sistema refletir o negocio de cabelos">
            <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
              <CampoSelect rotulo="Tipo de produto" nome="tipo_produto_id" opcoes={f.tiposProduto.map((t) => ({ valor: t.id, texto: t.nome }))} />
              <CampoSelect rotulo="Material / fibra" nome="material_id" opcoes={f.materiais.map((t) => ({ valor: t.id, texto: t.nome }))} />
              <CampoSelect rotulo="Tipo de fibra" nome="tipo_fibra_id" opcoes={f.fibras.map((t) => ({ valor: t.id, texto: t.nome }))} />
              <Campo rotulo="Modelo / estilo" nome="modelo_estilo" placeholder="Ultra Braid" />
            </Linha>
            <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
              <CampoSelect rotulo="Textura" nome="textura_id" opcoes={f.texturas.map((t) => ({ valor: t.id, texto: t.nome }))} />
              <CampoSelect rotulo="Tecnica / indicacao" nome="tecnica_id" opcoes={f.tecnicas.map((t) => ({ valor: t.id, texto: t.nome }))} />
              <CampoSelect rotulo="Publico" nome="publico_id" opcoes={f.publicos.map((t) => ({ valor: t.id, texto: t.nome }))} />
            </Linha>
            <CampoArea
              rotulo="Observacoes tecnicas"
              nome="observacoes_tecnicas"
              linhas={2}
              placeholder="Ex: fibra resistente ao calor, indicada para trancas de longa duracao"
            />
          </Secao>

          <Secao titulo="Opcional agora, importante depois" descricao="Voce pode preencher tudo isso depois, na tela do produto">
            <Linha colunas="repeat(auto-fit,minmax(200px,1fr))">
              <Campo rotulo="NCM" nome="ncm" placeholder="6704.20.00" />
              <Campo rotulo="Tags para o site" nome="tags" placeholder="jumbo, cabelo sintetico, tranca" />
              <Campo rotulo="Descricao curta para o site" nome="descricao_curta" placeholder="Aparece na listagem" />
            </Linha>
          </Secao>

          <div className="acoes-form">
            <button className="btn btn-primario btn-lg" type="submit">Criar produto e ir para as variacoes</button>
            <Link className="btn btn-neutro btn-lg" href="/produtos">Cancelar</Link>
          </div>
        </form>
      </Conteudo>
    </>
  );
}
