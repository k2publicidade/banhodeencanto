import Link from "next/link";
import { exigir } from "@/lib/auth";
import { all } from "@/lib/db";
import { Cabecalho, Conteudo, Secao, Tabela, Kpi, Grade } from "@/components/ui";

export const dynamic = "force-dynamic";

const CADASTROS = [
  { tabela: "marcas", rotulo: "Marcas", descricao: "Fabricantes e marcas dos produtos", icone: "❖" },
  { tabela: "linhas_colecao", rotulo: "Linhas / colecoes", descricao: "Agrupamento comercial dentro da marca", icone: "≡" },
  { tabela: "categorias", rotulo: "Categorias e subcategorias", descricao: "Arvore de classificacao do catalogo", icone: "▤" },
  { tabela: "cores", rotulo: "Cores", descricao: "Codigo de mercado (1B, 613), familia e cor visual", icone: "◐" },
  { tabela: "texturas", rotulo: "Texturas", descricao: "Liso, ondulado, cacheado, crespo, jumbo", icone: "≈" },
  { tabela: "comprimentos", rotulo: "Comprimentos", descricao: "cm, polegadas e metros", icone: "↕" },
  { tabela: "tipos_produto", rotulo: "Tipos de produto", descricao: "Cabelo, acessorio, cosmetico, ferramenta", icone: "◆" },
  { tabela: "materiais", rotulo: "Materiais / fibra base", descricao: "Sintetico, organico, humano, misto", icone: "❋" },
  { tabela: "tipos_fibra", rotulo: "Tipos de fibra", descricao: "Kanekalon, Toyokalon, modacrylic...", icone: "✳" },
  { tabela: "tecnicas", rotulo: "Tecnicas / indicacao", descricao: "Tranca, crochet, entrelace, mega hair", icone: "✦" },
  { tabela: "publicos", rotulo: "Publicos", descricao: "Adulto, infantil, profissional", icone: "☺" },
  { tabela: "unidades_medida", rotulo: "Unidades de medida", descricao: "UN, PCT, CX, KG, MT", icone: "▣" },
  { tabela: "formas_pagamento", rotulo: "Formas de pagamento", descricao: "Dinheiro, PIX, cartoes, fiado e taxas", icone: "❂" },
];

export default async function PaginaCadastros({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await exigir();
  const sp = await searchParams;

  const contagens: Record<string, number> = {};
  for (const c of CADASTROS) {
    contagens[c.tabela] = all<{ n: number }>(`SELECT COUNT(*) n FROM ${c.tabela}`)[0]?.n ?? 0;
  }
  const fornecedores = all<{ n: number }>("SELECT COUNT(*) n FROM fornecedores")[0]?.n ?? 0;
  const clientes = all<{ n: number }>("SELECT COUNT(*) n FROM clientes")[0]?.n ?? 0;

  return (
    <>
      <Cabecalho
        titulo="Cadastros auxiliares"
        subtitulo="As tabelas que alimentam estoque, compras, vendas, site e relatorios"
        acoes={<Link className="btn btn-neutro" href="/configuracoes">Configuracoes</Link>}
      />

      <Conteudo>
        {sp.msg ? <div className="aviso aviso-ok">{sp.msg}</div> : null}

        <Grade colunas={4}>
          <Kpi rotulo="Tabelas de apoio" valor={String(CADASTROS.length + 2)} detalhe="Marcas, cores, texturas, tecnicas..." />
          <Kpi rotulo="Fornecedores" valor={String(fornecedores)} detalhe="Com relacao N:N com produtos" href="/fornecedores" />
          <Kpi rotulo="Clientes" valor={String(clientes)} detalhe="Com crediario opcional" href="/clientes" />
          <Kpi rotulo="Cores cadastradas" valor={String(contagens.cores ?? 0)} detalhe="Base para variacoes" />
        </Grade>

        <Secao titulo="Classificacao de produtos">
          <Tabela>
            <thead>
              <tr>
                <th style={{ width: 44 }} />
                <th>Cadastro</th>
                <th>Para que serve</th>
                <th className="num">Registros</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {CADASTROS.map((c) => (
                <tr key={c.tabela}>
                  <td style={{ fontSize: 17, color: "#c8913a", textAlign: "center" }}>{c.icone}</td>
                  <td><strong>{c.rotulo}</strong></td>
                  <td style={{ color: "#7d7466", fontSize: 13 }}>{c.descricao}</td>
                  <td className="num">{contagens[c.tabela] ?? 0}</td>
                  <td><Link className="btn btn-sm btn-primario" href={`/cadastros/${c.tabela}`}>Gerenciar</Link></td>
                </tr>
              ))}
              <tr>
                <td style={{ fontSize: 17, color: "#c8913a", textAlign: "center" }}>◇</td>
                <td><strong>Fornecedores</strong></td>
                <td style={{ color: "#7d7466", fontSize: 13 }}>Entidade completa com prazo, contato e condicao</td>
                <td className="num">{fornecedores}</td>
                <td><Link className="btn btn-sm btn-primario" href="/fornecedores">Gerenciar</Link></td>
              </tr>
              <tr>
                <td style={{ fontSize: 17, color: "#c8913a", textAlign: "center" }}>☺</td>
                <td><strong>Clientes</strong></td>
                <td style={{ color: "#7d7466", fontSize: 13 }}>Cadastro, historico e crediario</td>
                <td className="num">{clientes}</td>
                <td><Link className="btn btn-sm btn-primario" href="/clientes">Gerenciar</Link></td>
              </tr>
            </tbody>
          </Tabela>
        </Secao>
      </Conteudo>
    </>
  );
}
