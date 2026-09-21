"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, one, run, tx, auditar, config } from "@/lib/db";
import { slugify, arred, parseMoeda } from "@/lib/format";
import { ean13Interno, codigoInterno } from "@/lib/barcode";
import { exigir } from "@/lib/auth";

const N = (v: FormDataEntryValue | null, padrao = 0) => {
  if (v === null || v === "") return padrao;
  const n = parseMoeda(String(v));
  return Number.isFinite(n) ? n : padrao;
};
const S = (v: FormDataEntryValue | null) => {
  const s = v === null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const BOOL = (v: FormDataEntryValue | null) => (v === "1" || v === "on" ? 1 : 0);
const ID = (v: FormDataEntryValue | null) => {
  const s = S(v);
  return s === null ? null : Number(s);
};

/* ================================================================== */
/* Criar / atualizar produto (pai)                                     */
/* ================================================================== */

export async function salvarProduto(form: FormData, idExistente?: number) {
  const u = await exigir();
  const nome = S(form.get("nome"));
  if (!idExistente && !nome) return { ok: false, erro: "O nome do produto e obrigatorio." };

  // Permite salvar por bloco: "__campos" lista somente os campos do formulario enviado.
  const declarados = S(form.get("__campos"));
  const permitir = declarados ? new Set(declarados.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const so = (k: string) => !permitir || permitir.has(k);

  const todos = {
    sku: S(form.get("sku")) ?? "BDE-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    ean: S(form.get("ean")),
    nome,
    nome_reduzido: S(form.get("nome_reduzido")) ?? nome,
    marca_id: ID(form.get("marca_id")),
    linha_id: ID(form.get("linha_id")),
    categoria_id: ID(form.get("categoria_id")),
    subcategoria_id: ID(form.get("subcategoria_id")),
    status: S(form.get("status")) ?? "ativo",
    tipo_produto_id: ID(form.get("tipo_produto_id")),
    material_id: ID(form.get("material_id")),
    tipo_fibra_id: ID(form.get("tipo_fibra_id")),
    modelo_estilo: S(form.get("modelo_estilo")),
    textura_id: ID(form.get("textura_id")),
    tecnica_id: ID(form.get("tecnica_id")),
    publico_id: ID(form.get("publico_id")),
    observacoes_tecnicas: S(form.get("observacoes_tecnicas")),
    cor_id: ID(form.get("cor_id")),
    comprimento_id: ID(form.get("comprimento_id")),
    ncm: S(form.get("ncm")),
    cest: S(form.get("cest")),
    origem_mercadoria: S(form.get("origem_mercadoria")) ?? "0",
    unidade_comercial: S(form.get("unidade_comercial")) ?? "UN",
    classificacao_fiscal: S(form.get("classificacao_fiscal")),
    tributacao: S(form.get("tributacao")),
    observacao_fiscal: S(form.get("observacao_fiscal")),
    nome_site: S(form.get("nome_site")),
    descricao_curta: S(form.get("descricao_curta")),
    descricao_completa: S(form.get("descricao_completa")),
    caracteristicas: S(form.get("caracteristicas")),
    modo_uso: S(form.get("modo_uso")),
    cuidados: S(form.get("cuidados")),
    foto_principal: S(form.get("foto_principal")),
    galeria: S(form.get("galeria")),
    video: S(form.get("video")),
    tags: S(form.get("tags")),
    destaque: BOOL(form.get("destaque")),
    exibir_site: BOOL(form.get("exibir_site")),
    ordem_exibicao: N(form.get("ordem_exibicao")),
    slug: S(form.get("slug")) ?? slugify(nome ?? ""),
  };

  const campos: Record<string, any> = {};
  for (const [k, v] of Object.entries(todos)) {
    if (so(k)) campos[k] = v;
  }
  // Ao criar, o nome e o slug sempre entram
  if (!idExistente) {
    campos.nome = nome!;
    campos.slug = todos.slug;
    if (!campos.sku) campos.sku = todos.sku;
  }
  if (Object.keys(campos).length === 0) return { ok: false, erro: "Nenhum campo para salvar." };


  try {
    const id = tx(() => {
      if (idExistente) {
        const sets = Object.keys(campos).map((k) => `${k} = ?`).join(", ");
        run(`UPDATE produtos SET ${sets}, atualizado_em = datetime('now','localtime') WHERE id = ?`, ...Object.values(campos), idExistente);
        auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "alterar", entidade: "produtos", entidade_id: idExistente, detalhe: nome });
        return idExistente;
      }
      const cols = Object.keys(campos).join(", ");
      const ph = Object.keys(campos).map(() => "?").join(",");
      const r = run(`INSERT INTO produtos(${cols}) VALUES (${ph})`, ...Object.values(campos));
      const novo = Number(r.lastInsertRowid);
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "criar", entidade: "produtos", entidade_id: novo, detalhe: nome });
      return novo;
    });
    revalidatePath("/produtos");
    revalidatePath(`/produtos/${id}`);
    return { ok: true, id };
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE") && msg.includes("slug")) return { ok: false, erro: "Ja existe um produto com essa URL/slug." };
    if (msg.includes("UNIQUE") && msg.includes("sku")) return { ok: false, erro: "Ja existe um produto com esse SKU." };
    return { ok: false, erro: msg || "Falha ao salvar o produto." };
  }
}

export async function acaoSalvarProduto(form: FormData) {
  const id = ID(form.get("__id"));
  const r = await salvarProduto(form, id ?? undefined);
  if (!r.ok) return r;
  if (!id) redirect(`/produtos/${r.id}`);
  return { ok: true, id: r.id };
}

export async function excluirProduto(id: number) {
  const u = await exigir();
  if (u.papel !== "admin") return { ok: false, erro: "Somente o administrador pode excluir produtos." };
  try {
    tx(() => {
      run("DELETE FROM variacoes WHERE produto_id = ?", id);
      run("DELETE FROM produtos WHERE id = ?", id);
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "excluir", entidade: "produtos", entidade_id: id });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao excluir." };
  }
  revalidatePath("/produtos");
  return { ok: true };
}

/* ================================================================== */
/* Variacoes / SKUs                                                    */
/* ================================================================== */

/** Gera as combinacoes que faltam (cor x comprimento) para o produto. */
export async function gerarVariacoes(
  produtoId: number,
  coresIds: number[],
  comprimentosIds: number[],
  custoBase: number,
  markup: number
) {
  const u = await exigir();
  const p = one<any>("SELECT id, sku, nome, publico_id, tipo_produto_id FROM produtos WHERE id = ?", produtoId);
  if (!p) return { ok: false, erro: "Produto nao encontrado." };

  const cores = coresIds.length
    ? all<any>(`SELECT id, nome, codigo FROM cores WHERE id IN (${coresIds.map(() => "?").join(",")})`, ...coresIds)
    : [null];
  const comps = comprimentosIds.length
    ? all<any>(`SELECT id, valor, unidade FROM comprimentos WHERE id IN (${comprimentosIds.map(() => "?").join(",")})`, ...comprimentosIds)
    : [];

  let criadas = 0;
  let ignoradas = 0;
  let seq = one<{ n: number }>("SELECT COALESCE(MAX(id),0) n FROM variacoes")?.n ?? 0;
  const maxEan = one<{ n: number }>("SELECT COALESCE(MAX(CAST(SUBSTR(ean,4,9) AS INTEGER)),100000000) n FROM variacoes WHERE ean LIKE '200%'")?.n ?? 100000000;

  try {
    tx(() => {
      for (const c of cores) {
        for (const cp of comps) {
          const existe = one<{ id: number }>(
            `SELECT id FROM variacoes WHERE produto_id = ?
             AND COALESCE(cor_id,0) = COALESCE(?,0)
             AND COALESCE(comprimento_valor,0) = COALESCE(?,0)
             AND COALESCE(comprimento_unidade,'') = COALESCE(?,'')`,
            produtoId, c?.id ?? null, cp?.valor ?? null, cp?.unidade ?? null
          );
          if (existe) {
            ignoradas++;
            continue;
          }
          seq++;
          const sufixo = (c?.codigo ? c.codigo.replace(/[^A-Za-z0-9]/g, "") : "U") + (cp ? "-" + cp.valor + cp.unidade.toUpperCase() : "");
          const sku = (p.sku || "BDE") + "-" + sufixo;
          const custo = arred(custoBase * (cp?.valor >= 100 ? 1.35 : cp?.valor >= 80 ? 1.15 : 1));
          const preco = arred(custo * (markup > 0 ? markup : 2.2));
          const ean = ean13Interno(maxEan + criadas + 1);
          run(
            `INSERT INTO variacoes(produto_id, sku, ean, codigo_interno, cor_id, cor_codigo_fabricante, cor_nome_comercial,
               comprimento_valor, comprimento_unidade, publico_id, custo_aquisicao, custo_medio, ultimo_custo,
               preco_venda, preco_minimo_autorizado, data_ultima_alteracao_preco, estoque_min, estoque_max,
               ponto_reposicao, unidade_estoque, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),5,100,5,'PCT','ativo')`,
            produtoId, sku, ean, codigoInterno(seq), c?.id ?? null, c?.codigo ?? null,
            c ? `${c.nome} ${c.codigo}` : null, cp?.valor ?? null, cp?.unidade ?? null, p.publico_id ?? null,
            custo, custo, custo, preco, arred(preco * 0.9)
          );
          const varId = one<{ id: number }>("SELECT id FROM variacoes WHERE sku = ?", sku)?.id;
          if (varId) {
            for (const loja of all<{ id: number }>("SELECT id FROM lojas WHERE ativa = 1")) {
              run("INSERT OR IGNORE INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,0,0)", varId, loja.id);
            }
          }
          criadas++;
        }
      }
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "gerar_variacoes", entidade: "produtos", entidade_id: produtoId, detalhe: `${criadas} criadas, ${ignoradas} ja existiam` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao gerar variacoes." };
  }
  revalidatePath(`/produtos/${produtoId}`);
  return { ok: true, criadas, ignoradas };
}

export async function salvarVariacao(form: FormData) {
  const u = await exigir();
  const id = ID(form.get("__id"));
  if (!id) return { ok: false, erro: "Variacao nao informada." };

  const anterior = one<any>("SELECT preco_venda, custo_medio, produto_id FROM variacoes WHERE id = ?", id);
  if (!anterior) return { ok: false, erro: "Variacao nao encontrada." };

  const custo = N(form.get("custo_aquisicao"));
  const preco = N(form.get("preco_venda"));
  const promocional = S(form.get("preco_promocional"));
  const precoPromo = promocional === null ? null : parseMoeda(promocional);

  const campos = {
    sku: S(form.get("sku")),
    ean: S(form.get("ean")),
    codigo_interno: S(form.get("codigo_interno")),
    cor_id: ID(form.get("cor_id")),
    cor_codigo_fabricante: S(form.get("cor_codigo_fabricante")),
    cor_nome_comercial: S(form.get("cor_nome_comercial")),
    comprimento_valor: form.get("comprimento_valor") === null || form.get("comprimento_valor") === "" ? null : N(form.get("comprimento_valor")),
    comprimento_unidade: S(form.get("comprimento_unidade")) ?? "cm",
    peso_pacote: form.get("peso_pacote") === "" ? null : N(form.get("peso_pacote")),
    quantidade_por_pacote: N(form.get("quantidade_por_pacote"), 1),
    quantidade_recomendada: N(form.get("quantidade_recomendada"), 1),
    custo_aquisicao: custo,
    ultimo_custo: custo,
    preco_venda: preco,
    preco_promocional: precoPromo,
    preco_minimo_autorizado: form.get("preco_minimo_autorizado") === "" ? null : N(form.get("preco_minimo_autorizado")),
    estoque_min: N(form.get("estoque_min")),
    estoque_max: N(form.get("estoque_max")),
    ponto_reposicao: N(form.get("ponto_reposicao")),
    unidade_estoque: S(form.get("unidade_estoque")) ?? "PCT",
    localizacao: S(form.get("localizacao")),
    corredor: S(form.get("corredor")),
    prateleira: S(form.get("prateleira")),
    posicao: S(form.get("posicao")),
    permite_estoque_negativo: BOOL(form.get("permite_estoque_negativo")),
    controle_lote: BOOL(form.get("controle_lote")),
    ncm: S(form.get("ncm")),
    status: S(form.get("status")) ?? "ativo",
    observacoes: S(form.get("observacoes")),
  };

  try {
    tx(() => {
      const sets = Object.keys(campos).map((k) => `${k} = ?`).join(", ");
      const mudouPreco = preco !== Number(anterior.preco_venda);
      run(
        `UPDATE variacoes SET ${sets}${mudouPreco ? ", data_ultima_alteracao_preco = datetime('now','localtime')" : ""} WHERE id = ?`,
        ...Object.values(campos), id
      );
      if (mudouPreco) {
        run(
          `INSERT INTO precos_historico(variacao_id, preco_anterior, preco_novo, usuario_id, usuario_nome)
           VALUES (?,?,?,?,?)`,
          id, Number(anterior.preco_venda), preco, u.id, u.nome
        );
      }
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "alterar", entidade: "variacoes", entidade_id: id, detalhe: `${campos.sku} preco=${preco}` });
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE")) return { ok: false, erro: "SKU ou codigo de barras ja usado em outra variacao." };
    return { ok: false, erro: msg || "Falha ao salvar a variacao." };
  }
  revalidatePath(`/produtos/${anterior.produto_id}`);
  revalidatePath("/produtos");
  return { ok: true };
}

export async function excluirVariacao(id: number) {
  const u = await exigir();
  const v = one<any>("SELECT produto_id, sku FROM variacoes WHERE id = ?", id);
  if (!v) return { ok: false, erro: "Variacao nao encontrada." };
  const usado = one<{ n: number }>("SELECT COUNT(*) n FROM vendas_itens WHERE variacao_id = ?", id)?.n ?? 0;
  if (usado > 0) {
    return { ok: false, erro: `Este SKU tem ${usado} venda(s) registrada(s). Marque como "descontinuado" em vez de excluir, para preservar o historico.` };
  }
  try {
    run("DELETE FROM variacoes WHERE id = ?", id);
    auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "excluir", entidade: "variacoes", entidade_id: id, detalhe: v.sku });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao excluir." };
  }
  revalidatePath(`/produtos/${v.produto_id}`);
  return { ok: true };
}

/** Ajuste de precos em lote (por % ou margem alvo) para o produto inteiro. */
export async function ajustarPrecosProduto(
  produtoId: number,
  modo: "percentual" | "margem" | "markup",
  valor: number
) {
  const u = await exigir();
  const vs = all<any>("SELECT id, custo_medio, preco_venda FROM variacoes WHERE produto_id = ?", produtoId);
  let n = 0;
  try {
    tx(() => {
      for (const v of vs) {
        const custo = Number(v.custo_medio);
        let novo = Number(v.preco_venda);
        if (modo === "percentual") novo = arred(Number(v.preco_venda) * (1 + valor / 100));
        else if (modo === "margem") novo = custo > 0 ? arred(custo / (1 - Math.min(valor, 99.5) / 100)) : Number(v.preco_venda);
        else if (modo === "markup") novo = arred(custo * valor);
        if (novo <= 0 || Math.abs(novo - Number(v.preco_venda)) < 0.005) continue;
        run(
          "UPDATE variacoes SET preco_venda = ?, data_ultima_alteracao_preco = datetime('now','localtime') WHERE id = ?",
          novo, v.id
        );
        run(
          "INSERT INTO precos_historico(variacao_id, preco_anterior, preco_novo, usuario_id, usuario_nome) VALUES (?,?,?,?,?)",
          v.id, Number(v.preco_venda), novo, u.id, u.nome
        );
        n++;
      }
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "ajuste_preco_lote", entidade: "produtos", entidade_id: produtoId, detalhe: `${modo} ${valor} -> ${n} SKUs` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha no ajuste de precos." };
  }
  revalidatePath(`/produtos/${produtoId}`);
  return { ok: true, alterados: n };
}

/** Aplica parametros de estoque/localizacao a todas as variacoes do produto. */
export async function aplicarEstoquePadrao(produtoId: number, form: FormData) {
  const u = await exigir();
  const campos = ["estoque_min", "estoque_max", "ponto_reposicao", "unidade_estoque", "localizacao", "corredor", "prateleira", "posicao", "permite_estoque_negativo", "controle_lote"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const c of campos) {
    if (form.get(c) === null) continue;
    if (c === "permite_estoque_negativo" || c === "controle_lote") {
      sets.push(`${c} = ?`);
      vals.push(BOOL(form.get(c)));
    } else if (["unidade_estoque", "localizacao", "corredor", "prateleira", "posicao"].includes(c)) {
      const v = S(form.get(c));
      if (v === null) continue;
      sets.push(`${c} = ?`);
      vals.push(v);
    } else {
      sets.push(`${c} = ?`);
      vals.push(N(form.get(c)));
    }
  }
  if (sets.length === 0) return { ok: false, erro: "Informe ao menos um parametro." };

  try {
    const r = run(`UPDATE variacoes SET ${sets.join(", ")} WHERE produto_id = ?`, ...vals, produtoId);
    auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "aplicar_estoque_padrao", entidade: "produtos", entidade_id: produtoId, detalhe: sets.join(", ") });
    revalidatePath(`/produtos/${produtoId}`);
    return { ok: true, alterados: Number(r.changes) };
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao aplicar." };
  }
}

/* ================================================================== */
/* Produto x Fornecedor                                               */
/* ================================================================== */

export async function vincularFornecedor(form: FormData) {
  const u = await exigir();
  const produtoId = ID(form.get("produto_id"));
  const fornecedorId = ID(form.get("fornecedor_id"));
  const variacaoId = ID(form.get("variacao_id"));
  if (!produtoId || !fornecedorId) return { ok: false, erro: "Informe o fornecedor." };

  try {
    tx(() => {
      run(
        `INSERT INTO produto_fornecedor(produto_id, variacao_id, fornecedor_id, codigo_fornecedor, referencia_fabricante,
           custo, qtd_minima_compra, multiplo_compra, prazo_entrega_dias, principal, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        produtoId, variacaoId, fornecedorId, S(form.get("codigo_fornecedor")), S(form.get("referencia_fabricante")),
        form.get("custo") === "" ? null : N(form.get("custo")),
        form.get("qtd_minima_compra") === "" ? null : N(form.get("qtd_minima_compra")),
        form.get("multiplo_compra") === "" ? null : N(form.get("multiplo_compra")),
        form.get("prazo_entrega_dias") === "" ? null : N(form.get("prazo_entrega_dias")),
        BOOL(form.get("principal")), S(form.get("observacoes"))
      );
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "vincular_fornecedor", entidade: "produtos", entidade_id: produtoId });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao vincular fornecedor." };
  }
  revalidatePath(`/produtos/${produtoId}`);
  return { ok: true };
}

export async function removerVinculoFornecedor(id: number, produtoId: number) {
  await exigir();
  run("DELETE FROM produto_fornecedor WHERE id = ?", id);
  revalidatePath(`/produtos/${produtoId}`);
  return { ok: true };
}

/* ================================================================== */
/* Criacao rapida de cadastros auxiliares (usada dentro do produto)     */
/* ================================================================== */

export async function criarAuxiliar(tabela: string, dados: Record<string, string | number | null>) {
  await exigir();
  const permitidas: Record<string, string[]> = {
    marcas: ["nome"],
    linhas_colecao: ["nome", "marca_id"],
    categorias: ["nome", "pai_id"],
    cores: ["nome", "codigo", "familia", "hex"],
    texturas: ["nome"],
    comprimentos: ["valor", "unidade", "rotulo"],
    fornecedores: ["razao_social", "nome_fantasia", "cnpj", "telefone", "email", "prazo_medio_entrega"],
    tipos_produto: ["nome"],
    materiais: ["nome"],
    tipos_fibra: ["nome"],
    tecnicas: ["nome"],
    publicos: ["nome"],
    formas_pagamento: ["nome", "tipo", "taxa_pct", "prazo_dias"],
  };
  const cols = permitidas[tabela];
  if (!cols) return { ok: false, erro: "Cadastro nao permitido: " + tabela };

  const usadas = cols.filter((c) => dados[c] !== undefined && dados[c] !== null && dados[c] !== "");
  if (usadas.length === 0) return { ok: false, erro: "Informe ao menos um campo." };

  try {
    const r = run(
      `INSERT INTO ${tabela}(${usadas.join(",")}) VALUES (${usadas.map(() => "?").join(",")})`,
      ...usadas.map((c) => dados[c] as any)
    );
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE")) return { ok: false, erro: "Ja existe um registro com esse nome/codigo." };
    return { ok: false, erro: msg };
  }
}
