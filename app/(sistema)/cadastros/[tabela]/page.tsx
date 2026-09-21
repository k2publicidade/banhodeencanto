import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { moeda, num } from "@/lib/format";
import { Cabecalho, Conteudo, Secao, Tabela, Vazio, Campo, Linha } from "@/components/ui";
import { postSalvarAuxiliar, postAlternarAtivo, postExcluirAuxiliar } from "@/app/actions/cadastros";

export const dynamic = "force-dynamic";

type CampoDef = { nome: string; rotulo: string; tipo?: string; largura?: string; ajuda?: string; opcoes?: { valor: any; texto: string }[] };

const DEF: Record<string, {
  rotulo: string;
  descricao: string;
  campos: CampoDef[];
  colunas: { chave: string; rotulo: string; tipo?: "cor" | "num" | "bool" | "ref" }[];
  ordem?: string;
}> = {
  marcas: {
    rotulo: "Marcas",
    descricao: "Fabricantes e marcas. Aparecem nos filtros, relatorios e no site.",
    campos: [
      { nome: "nome", rotulo: "Nome da marca", largura: "2fr" },
      { nome: "site", rotulo: "Site" },
    ],
    colunas: [{ chave: "nome", rotulo: "Marca" }, { chave: "site", rotulo: "Site" }],
  },
  linhas_colecao: {
    rotulo: "Linhas / colecoes",
    descricao: "Agrupamento comercial dentro da marca (ex: Ultra Braid, Box Braid).",
    campos: [
      { nome: "nome", rotulo: "Nome da linha", largura: "2fr" },
      { nome: "descricao", rotulo: "Descricao" },
    ],
    colunas: [{ chave: "nome", rotulo: "Linha" }, { chave: "marca", rotulo: "Marca" }, { chave: "descricao", rotulo: "Descricao" }],
  },
  categorias: {
    rotulo: "Categorias e subcategorias",
    descricao: "Arvore do catalogo. Categoria sem pai = categoria principal; com pai = subcategoria.",
    campos: [
      { nome: "nome", rotulo: "Nome", largura: "2fr" },
      { nome: "pai_id", rotulo: "Categoria pai", ajuda: "Deixe vazio para criar uma categoria principal" },
      { nome: "ordem", rotulo: "Ordem" },
    ],
    colunas: [{ chave: "nome", rotulo: "Categoria" }, { chave: "pai", rotulo: "Pai" }, { chave: "ordem", rotulo: "Ordem", tipo: "num" }],
  },
  cores: {
    rotulo: "Cores",
    descricao: "O codigo de mercado (1, 1B, 613) e o que aparece no PDV, no cupom e nos relatorios de giro por cor.",
    campos: [
      { nome: "codigo", rotulo: "Codigo (mercado)", largura: "1fr", ajuda: "Ex: 1B, 613, 99J" },
      { nome: "nome", rotulo: "Nome da cor", largura: "2fr" },
      ...[] as CampoDef[],
      { nome: "familia", rotulo: "Familia", opcoes: [
        { valor: "preto", texto: "Preto" }, { valor: "castanho", texto: "Castanho" },
        { valor: "loiro", texto: "Loiro" }, { valor: "ruivo", texto: "Ruivo" },
        { valor: "acinzentado", texto: "Acinzentado" }, { valor: "colorido", texto: "Colorido" },
        { valor: "mescla", texto: "Mescla" },
      ] },
      { nome: "hex", rotulo: "Cor (hex)", tipo: "color" },
      { nome: "ordem", rotulo: "Ordem" },
    ] as CampoDef[],
    colunas: [
      { chave: "codigo", rotulo: "Codigo" }, { chave: "nome", rotulo: "Cor" },
      { chave: "familia", rotulo: "Familia" }, { chave: "hex", rotulo: "Amostra", tipo: "cor" },
      { chave: "ordem", rotulo: "Ordem", tipo: "num" },
    ],
    ordem: "ordem, codigo",
  },
  texturas: {
    rotulo: "Texturas",
    descricao: "Liso, ondulado, cacheado, crespo, jumbo, bob, yaki...",
    campos: [{ nome: "nome", rotulo: "Textura", largura: "2fr" }, { nome: "ordem", rotulo: "Ordem" }],
    colunas: [{ chave: "nome", rotulo: "Textura" }, { chave: "ordem", rotulo: "Ordem", tipo: "num" }],
    ordem: "ordem, nome",
  },
  comprimentos: {
    rotulo: "Comprimentos",
    descricao: "Unidades de comprimento usadas nas variacoes.",
    campos: [
      { nome: "valor", rotulo: "Valor", tipo: "number" },
      { nome: "unidade", rotulo: "Unidade", opcoes: [{ valor: "cm", texto: "cm" }, { valor: "pol", texto: "polegadas" }, { valor: "m", texto: "metros" }] },
      { nome: "rotulo", rotulo: "Rotulo", ajuda: "Ex: 60 cm" },
      { nome: "ordem", rotulo: "Ordem" },
    ],
    colunas: [{ chave: "valor", rotulo: "Valor", tipo: "num" }, { chave: "unidade", rotulo: "Unidade" }, { chave: "rotulo", rotulo: "Rotulo" }, { chave: "ordem", rotulo: "Ordem", tipo: "num" }],
    ordem: "ordem, valor",
  },
  tipos_produto: { rotulo: "Tipos de produto", descricao: "Cabelo, acessorio, cosmetico, ferramenta, peruca.", campos: [{ nome: "nome", rotulo: "Tipo", largura: "2fr" }, { nome: "ordem", rotulo: "Ordem" }], colunas: [{ chave: "nome", rotulo: "Tipo" }, { chave: "ordem", rotulo: "Ordem", tipo: "num" }], ordem: "ordem, nome" },
  materiais: { rotulo: "Materiais / fibra base", descricao: "Sintetico, organico, humano, misto.", campos: [{ nome: "nome", rotulo: "Material", largura: "2fr" }], colunas: [{ chave: "nome", rotulo: "Material" }] },
  tipos_fibra: { rotulo: "Tipos de fibra", descricao: "Kanekalon, Toyokalon, modacrylic, polipropileno...", campos: [{ nome: "nome", rotulo: "Fibra", largura: "2fr" }], colunas: [{ chave: "nome", rotulo: "Fibra" }] },
  tecnicas: { rotulo: "Tecnicas / indicacao", descricao: "Tranca, box braids, crochet, entrelace, mega hair.", campos: [{ nome: "nome", rotulo: "Tecnica", largura: "2fr" }], colunas: [{ chave: "nome", rotulo: "Tecnica" }] },
  publicos: { rotulo: "Publicos", descricao: "Adulto, infantil, profissional, unissex.", campos: [{ nome: "nome", rotulo: "Publico", largura: "2fr" }], colunas: [{ chave: "nome", rotulo: "Publico" }] },
  unidades_medida: {
    rotulo: "Unidades de medida",
    descricao: "Siglas usadas em estoque e unidade comercial.",
    campos: [{ nome: "sigla", rotulo: "Sigla", largura: "1fr" }, { nome: "nome", rotulo: "Descricao", largura: "2fr" }],
    colunas: [{ chave: "sigla", rotulo: "Sigla" }, { chave: "nome", rotulo: "Descricao" }],
    ordem: "sigla",
  },
  formas_pagamento: {
    rotulo: "Formas de pagamento",
    descricao: "Usadas no PDV. Taxa e prazo entram no calculo do caixa e dos relatorios.",
    campos: [
      { nome: "nome", rotulo: "Nome", largura: "2fr" },
      { nome: "tipo", rotulo: "Tipo", opcoes: [
        { valor: "dinheiro", texto: "Dinheiro" }, { valor: "pix", texto: "PIX" },
        { valor: "debito", texto: "Cartao de debito" }, { valor: "credito", texto: "Cartao de credito" },
        { valor: "fiado", texto: "Fiado / crediario" }, { valor: "transferencia", texto: "Transferencia" },
        { valor: "outro", texto: "Outro" },
      ] },
      { nome: "taxa_pct", rotulo: "Taxa (%)" },
      { nome: "prazo_dias", rotulo: "Prazo (dias)" },
      { nome: "ordem", rotulo: "Ordem" },
    ],
    colunas: [
      { chave: "nome", rotulo: "Forma" }, { chave: "tipo", rotulo: "Tipo" },
      { chave: "taxa_pct", rotulo: "Taxa %", tipo: "num" }, { chave: "prazo_dias", rotulo: "Prazo", tipo: "num" },
      { chave: "ordem", rotulo: "Ordem", tipo: "num" },
    ],
    ordem: "ordem, nome",
  },
};

export default async function PaginaCadastroTabela({
  params,
  searchParams,
}: {
  params: Promise<{ tabela: string }>;
  searchParams: Promise<{ editar?: string; msg?: string; erro?: string }>;
}) {
  await exigir();
  const { tabela } = await params;
  const sp = await searchParams;
  const def = DEF[tabela];
  if (!def) notFound();

  const pk = tabela === "unidades_medida" ? "sigla" : "id";
  const editando = sp.editar ? one<any>(`SELECT * FROM ${tabela} WHERE ${pk} = ?`, isNaN(Number(sp.editar)) ? sp.editar : Number(sp.editar)) : null;

  const temAtivo = (all<{ n: number }>("SELECT COUNT(*) n FROM pragma_table_info(?) WHERE name='ativo'", tabela)[0]?.n ?? 0) > 0;

  const registros = all<any>(
    `SELECT t.*,
            ${tabela === "linhas_colecao" ? "(SELECT nome FROM marcas m WHERE m.id = t.marca_id)" : "NULL"} marca,
            ${tabela === "categorias" ? "(SELECT nome FROM categorias c2 WHERE c2.id = t.pai_id)" : "NULL"} pai
     FROM ${tabela} t
     ORDER BY ${def.ordem ?? (tabela === "categorias" ? "pai_id NULLS FIRST, nome" : "nome")}`
  );

  const usos: Record<string, number> = {};
  if (tabela === "marcas") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE marca_id = ?", r.id)[0].n;
  if (tabela === "cores") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM variacoes WHERE cor_id = ?", r.id)[0].n;
  if (tabela === "categorias") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE categoria_id = ? OR subcategoria_id = ?", r.id, r.id)[0].n;
  if (tabela === "texturas") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE textura_id = ?", r.id)[0].n;
  if (tabela === "comprimentos") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM variacoes WHERE comprimento_valor = ? AND comprimento_unidade = ?", r.valor, r.unidade)[0].n;
  if (tabela === "formas_pagamento") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM vendas_pagamentos WHERE forma_pagamento_id = ?", r.id)[0].n;
  if (tabela === "tipos_produto") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE tipo_produto_id = ?", r.id)[0].n;
  if (tabela === "materiais") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE material_id = ?", r.id)[0].n;
  if (tabela === "tipos_fibra") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE tipo_fibra_id = ?", r.id)[0].n;
  if (tabela === "tecnicas") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE tecnica_id = ?", r.id)[0].n;
  if (tabela === "publicos") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE publico_id = ?", r.id)[0].n;
  if (tabela === "linhas_colecao") for (const r of registros) usos[r.id] = all<{ n: number }>("SELECT COUNT(*) n FROM produtos WHERE linha_id = ?", r.id)[0].n;

  const marcas = all<{ id: number; nome: string }>("SELECT id, nome FROM marcas ORDER BY nome");
  const categoriasPai = all<{ id: number; nome: string }>("SELECT id, nome FROM categorias WHERE pai_id IS NULL ORDER BY nome");

  return (
    <>
      <Cabecalho
        titulo={def.rotulo}
        subtitulo={def.descricao}
        acoes={<Link className="btn btn-neutro" href="/cadastros">Todos os cadastros</Link>}
      />

      <Conteudo largura={1200}>
        {sp.msg ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #1f8a5b", color: "#166b46", fontWeight: 600 }}>{sp.msg}</div> : null}
        {sp.erro ? <div className="card" style={{ padding: "11px 15px", marginBottom: 14, borderLeft: "4px solid #9c2b2b", color: "#9c2b2b", fontWeight: 600 }}>{sp.erro}</div> : null}

        <Secao titulo={editando ? `Editar registro` : "Novo registro"}>
          <form action={postSalvarAuxiliar}>
            <input type="hidden" name="__tabela" value={tabela} />
            <input type="hidden" name="__id" value={editando ? (editando[pk] ?? "") : ""} />
            <Linha colunas={def.campos.map((c) => c.largura ?? "1fr").join(" ")}>
              {def.campos.map((c) => {
                const valor = editando ? editando[c.nome] : undefined;
                if (c.nome === "pai_id") {
                  return (
                    <div key={c.nome}>
                      <label htmlFor={c.nome}>{c.rotulo}</label>
                      <select id={c.nome} name={c.nome} defaultValue={valor ?? ""}>
                        <option value="">— categoria principal —</option>
                        {categoriasPai.filter((x) => !editando || x.id !== editando.id).map((x) => (
                          <option key={x.id} value={x.id}>{x.nome}</option>
                        ))}
                      </select>
                      {c.ajuda ? <div style={{ fontSize: 11.5, color: "#7d7466", marginTop: 4 }}>{c.ajuda}</div> : null}
                    </div>
                  );
                }
                if ((c.nome === "marca_id") || (c.opcoes && (c.nome === "familia" || c.nome === "tipo" || c.nome === "unidade"))) {
                  return (
                    <div key={c.nome}>
                      <label htmlFor={c.nome}>{c.rotulo}</label>
                      <select id={c.nome} name={c.nome} defaultValue={valor ?? ""}>
                        <option value="">— selecione —</option>
                        {(c.nome === "marca_id" ? marcas.map((m) => ({ valor: m.id, texto: m.nome })) : c.opcoes!).map((o) => (
                          <option key={String(o.valor)} value={String(o.valor)}>{o.texto}</option>
                        ))}
                      </select>
                      {c.ajuda ? <div style={{ fontSize: 11.5, color: "#7d7466", marginTop: 4 }}>{c.ajuda}</div> : null}
                    </div>
                  );
                }
                return <Campo key={c.nome} rotulo={c.rotulo} nome={c.nome} valor={valor} tipo={c.tipo ?? "text"} ajuda={c.ajuda} />;
              })}
            </Linha>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="btn btn-primario" type="submit">{editando ? "Salvar alteracoes" : "Cadastrar"}</button>
              {editando ? <Link className="btn btn-neutro" href={`/cadastros/${tabela}`}>Cancelar</Link> : null}
            </div>
          </form>
        </Secao>

        <Secao titulo={`${registros.length} registro(s)`} padding={false}>
          {registros.length === 0 ? (
            <Vazio titulo="Nenhum registro" descricao="Cadastre o primeiro registro usando o formulario acima." />
          ) : (
            <Tabela maxAltura={620}>
              <thead>
                <tr>
                  {def.colunas.map((c) => (
                    <th key={c.chave} className={c.tipo === "num" ? "num" : undefined}>{c.rotulo}</th>
                  ))}
                  {temAtivo ? <th>Situacao</th> : null}
                  <th className="num">Em uso</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r[pk]}>
                    {def.colunas.map((c) => (
                      <td key={c.chave} className={c.tipo === "num" ? "num" : undefined}>
                        {c.tipo === "cor" && r[c.chave] ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 4, background: r[c.chave], border: "1px solid #d5ccba", display: "inline-block" }} />
                            <span style={{ fontSize: 12, color: "#7d7466" }}>{r[c.chave]}</span>
                          </span>
                        ) : c.tipo === "bool" ? (
                          r[c.chave] ? "Sim" : "Nao"
                        ) : (
                          r[c.chave] ?? "—"
                        )}
                      </td>
                    ))}
                    {temAtivo ? (
                      <td>
                        <span className={"tag " + (r.ativo ? "tag-verde" : "tag-cinza")}>{r.ativo ? "ativo" : "inativo"}</span>
                      </td>
                    ) : null}
                    <td className="num">{usos[r[pk]] ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        <Link className="btn btn-sm btn-neutro" href={`/cadastros/${tabela}?editar=${r[pk]}`}>Editar</Link>
                        {temAtivo ? (
                          <form action={postAlternarAtivo}>
                            <input type="hidden" name="__tabela" value={tabela} />
                            <input type="hidden" name="__id" value={r[pk]} />
                            <input type="hidden" name="__ativo" value={r.ativo ? "1" : "0"} />
                            <button className="btn btn-sm btn-neutro" title={r.ativo ? "Desativar" : "Reativar"}>
                              {r.ativo ? "Desativar" : "Reativar"}
                            </button>
                          </form>
                        ) : null}
                        <form action={postExcluirAuxiliar}>
                          <input type="hidden" name="__tabela" value={tabela} />
                          <input type="hidden" name="__id" value={r[pk]} />
                          <button className="btn btn-sm btn-perigo" title="Excluir">×</button>
                        </form>
                      </div>
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
