"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one, run, tx, auditar, salvarConfig } from "@/lib/db";
import { arred, parseMoeda, moeda } from "@/lib/format";
import { exigir, exigirGestao, hashSenha } from "@/lib/auth";

const inteiro = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || 0);
const texto = (v: FormDataEntryValue | null) => {
  const s = v === null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const num = (v: FormDataEntryValue | null, padrao = 0) => {
  if (v === null || v === "") return padrao;
  const n = parseMoeda(String(v));
  return Number.isFinite(n) ? n : padrao;
};
const flag = (v: FormDataEntryValue | null) => (v === "1" || v === "on" ? 1 : 0);

/* ================================================================== */
/* Cadastros auxiliares (marcas, cores, texturas, categorias, etc.)    */
/* ================================================================== */

const TABELAS: Record<string, { cols: string[]; rotulo: string; nome: string }> = {
  marcas: { cols: ["nome", "site"], rotulo: "Marca", nome: "nome" },
  linhas_colecao: { cols: ["nome", "marca_id", "descricao"], rotulo: "Linha", nome: "nome" },
  categorias: { cols: ["nome", "pai_id", "slug", "ordem"], rotulo: "Categoria", nome: "nome" },
  cores: { cols: ["nome", "codigo", "familia", "hex", "ordem"], rotulo: "Cor", nome: "codigo" },
  texturas: { cols: ["nome", "ordem"], rotulo: "Textura", nome: "nome" },
  comprimentos: { cols: ["valor", "unidade", "rotulo", "ordem"], rotulo: "Comprimento", nome: "rotulo" },
  tipos_produto: { cols: ["nome", "ordem"], rotulo: "Tipo de produto", nome: "nome" },
  materiais: { cols: ["nome"], rotulo: "Material / fibra base", nome: "nome" },
  tipos_fibra: { cols: ["nome"], rotulo: "Tipo de fibra", nome: "nome" },
  tecnicas: { cols: ["nome"], rotulo: "Tecnica", nome: "nome" },
  publicos: { cols: ["nome"], rotulo: "Publico", nome: "nome" },
  fornecedores: { cols: ["razao_social", "nome_fantasia", "cnpj", "contato", "telefone", "whatsapp", "email", "site", "endereco", "cidade", "uf", "cep", "prazo_medio_entrega", "condicao_pagamento", "observacoes"], rotulo: "Fornecedor", nome: "razao_social" },
  formas_pagamento: { cols: ["nome", "tipo", "taxa_pct", "prazo_dias", "aceita_troco", "entra_no_caixa", "ordem"], rotulo: "Forma de pagamento", nome: "nome" },
  unidades_medida: { cols: ["sigla", "nome"], rotulo: "Unidade", nome: "sigla" },
};

export async function salvarAuxiliar(form: FormData) {
  await exigir();
  const tabela = String(form.get("__tabela") || "");
  const id = inteiro(form.get("__id"));
  const def = TABELAS[tabela];
  if (!def) return { ok: false, erro: "Cadastro invalido." };

  const vals: Record<string, any> = {};
  for (const c of def.cols) {
    if (form.get(c) === null) continue;
    const v = form.get(c)!;
    if (["ordem", "marca_id", "pai_id"].includes(c)) vals[c] = String(v).trim() === "" ? null : Number(v);
    else if (["valor", "taxa_pct", "prazo_dias", "prazo_medio_entrega"].includes(c)) vals[c] = num(v);
    else if (["aceita_troco", "entra_no_caixa"].includes(c)) vals[c] = flag(v);
    else vals[c] = texto(v);
  }
  if (Object.keys(vals).length === 0) return { ok: false, erro: "Preencha ao menos um campo." };

  try {
    if (id) {
      const sets = Object.keys(vals).map((k) => `${k} = ?`).join(", ");
      await run(`UPDATE ${tabela} SET ${sets} WHERE ${tabela === "unidades_medida" ? "sigla" : "id"} = ?`, ...Object.values(vals), id);
    } else {
      await run(`INSERT INTO ${tabela}(${Object.keys(vals).join(",")}) VALUES (${Object.keys(vals).map(() => "?").join(",")})`, ...Object.values(vals));
    }
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE")) return { ok: false, erro: "Ja existe um registro com esses dados." };
    return { ok: false, erro: msg };
  }
  revalidatePath("/cadastros");
  revalidatePath(`/cadastros/${tabela}`);
  return { ok: true };
}

export async function alternarAtivo(tabela: string, id: number, ativo: number) {
  await exigir();
  const col = tabela === "unidades_medida" ? "sigla" : "id";
  const temColuna = (await one<{ existe: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'banho_encanto' AND table_name = ? AND column_name = 'ativo') AS existe",
    tabela
  ))?.existe ?? false;
  if (!temColuna) return { ok: false, erro: "Este cadastro nao pode ser desativado." };
  await run(`UPDATE ${tabela} SET ativo = ? WHERE ${col} = ?`, ativo ? 0 : 1, id);
  revalidatePath("/cadastros");
  revalidatePath(`/cadastros/${tabela}`);
  return { ok: true };
}

export async function excluirAuxiliar(tabela: string, id: number) {
  await exigir();
  const col = tabela === "unidades_medida" ? "sigla" : "id";
  try {
    await run(`DELETE FROM ${tabela} WHERE ${col} = ?`, id);
  } catch (e: any) {
    return { ok: false, erro: "Nao foi possivel excluir: este registro esta sendo usado em produtos. Desative-o em vez de excluir." };
  }
  revalidatePath("/cadastros");
  revalidatePath(`/cadastros/${tabela}`);
  return { ok: true };
}

/* ================================================================== */
/* Clientes + fiado                                                    */
/* ================================================================== */

export async function salvarCliente(form: FormData) {
  await exigir();
  const id = inteiro(form.get("__id"));
  const nome = texto(form.get("nome"));
  if (!nome) return { ok: false, erro: "O nome do cliente e obrigatorio." };

  const vals: Record<string, any> = {
    nome,
    apelido: texto(form.get("apelido")),
    cpf_cnpj: texto(form.get("cpf_cnpj")),
    telefone: texto(form.get("telefone")),
    whatsapp: texto(form.get("whatsapp")),
    email: texto(form.get("email")),
    nascimento: texto(form.get("nascimento")),
    endereco: texto(form.get("endereco")),
    cidade: texto(form.get("cidade")),
    uf: texto(form.get("uf")),
    cep: texto(form.get("cep")),
    limite_credito: num(form.get("limite_credito")),
    observacoes: texto(form.get("observacoes")),
  };
  try {
    if (id) {
      const sets = Object.keys(vals).map((k) => `${k} = ?`).join(", ");
      await run(`UPDATE clientes SET ${sets} WHERE id = ?`, ...Object.values(vals), id);
    } else {
      const prox = Number((await one<{ n: number }>("SELECT COUNT(*) n FROM clientes"))?.n ?? 0) + 1;
      await run(
        `INSERT INTO clientes(codigo, ${Object.keys(vals).join(",")}) VALUES (?, ${Object.keys(vals).map(() => "?").join(",")})`,
        "CLI-" + String(prox).padStart(4, "0"), ...Object.values(vals)
      );
    }
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao salvar o cliente." };
  }
  revalidatePath("/clientes");
  return { ok: true };
}

export async function lancarFiado(clienteId: number, tipo: "pagamento" | "ajuste", valor: number, observacoes: string) {
  const u = await exigir();
  if (valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  const cli = await one<any>("SELECT id, nome FROM clientes WHERE id = ?", clienteId);
  if (!cli) return { ok: false, erro: "Cliente nao encontrado." };

  try {
    await tx(async () => {
      const saldoAnt = Number((await one<{ s: number }>(
        "SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s FROM fiado_lancamentos WHERE cliente_id = ?",
        clienteId
      ))?.s ?? 0);
      const delta = tipo === "pagamento" ? -valor : valor;
      const novo = arred(saldoAnt + delta);
      if (novo < -0.01) throw new Error(`O cliente deve apenas ${moeda(saldoAnt)}.`);

      await run(
        `INSERT INTO fiado_lancamentos(cliente_id, tipo, valor, saldo_apos, observacoes, usuario_id)
         VALUES (?,?,?,?,?,?)`,
        clienteId, tipo, valor, novo, observacoes || null, u.id
      );
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "fiado_" + tipo, entidade: "clientes", entidade_id: clienteId, detalhe: `R$ ${valor} -> saldo ${novo}` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha no lancamento." };
  }
  revalidatePath("/clientes");
  return { ok: true };
}

/* ================================================================== */
/* Usuarios                                                            */
/* ================================================================== */

export async function salvarUsuario(form: FormData) {
  const u = await exigirGestao();
  const id = inteiro(form.get("__id"));
  const nome = texto(form.get("nome"));
  if (!nome) return { ok: false, erro: "Informe o nome." };
  const senha = texto(form.get("senha"));
  const pin = texto(form.get("pin"));
  const papel = String(form.get("papel") || "operador");

  try {
    if (id) {
      await run(
        `UPDATE usuarios SET nome=?, apelido=?, email=?, papel=?, comissao_pct=?, pin=?, telefone=?, ativo=? WHERE id=?`,
        nome, texto(form.get("apelido")), texto(form.get("email")), papel, num(form.get("comissao_pct")),
        pin ?? (await one<{ pin: string }>("SELECT pin FROM usuarios WHERE id = ?", id))?.pin ?? null,
        texto(form.get("telefone")), flag(form.get("ativo")), id
      );
      if (senha) await run("UPDATE usuarios SET senha_hash = ? WHERE id = ?", hashSenha(senha), id);
    } else {
      if (!senha) return { ok: false, erro: "Defina uma senha para o novo usuario." };
      await run(
        `INSERT INTO usuarios(nome, apelido, email, senha_hash, pin, papel, comissao_pct, telefone, ativo)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        nome, texto(form.get("apelido")), texto(form.get("email")), hashSenha(senha), pin, papel,
        num(form.get("comissao_pct")), texto(form.get("telefone"))
      );
    }
    await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: id ? "alterar" : "criar", entidade: "usuarios", entidade_id: id || null, detalhe: nome });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("UNIQUE")) return { ok: false, erro: "Ja existe um usuario com esse e-mail." };
    return { ok: false, erro: msg };
  }
  revalidatePath("/configuracoes/usuarios");
  return { ok: true };
}

/* ================================================================== */
/* Configuracoes e lojas                                              */
/* ================================================================== */

export async function salvarConfiguracoes(form: FormData) {
  const u = await exigirGestao();
  const chaves = [
    "empresa_nome", "empresa_slogan", "cupom_mensagem", "cupom_impressora",
    "cupom_desconto_max_pct", "estoque_metodo_custo", "pdv_permite_estoque_negativo",
  ];
  for (const k of chaves) {
    const v = form.get(k);
    if (v !== null) await salvarConfig(k, String(v));
  }
  for (const k of ["cupom_imprimir_automatico", "cupom_mostrar_cnpj", "pdv_leitor_codigo_barras"]) {
    await salvarConfig(k, form.get(k) === null ? "0" : "1");
  }
  await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "alterar", entidade: "configuracoes", detalhe: "Configuracoes da loja" });
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function salvarLoja(form: FormData) {
  const u = await exigirGestao();
  const id = inteiro(form.get("__id"));
  const nome = texto(form.get("nome"));
  if (!nome) return { ok: false, erro: "Informe o nome da loja." };
  const vals = {
    nome,
    apelido: texto(form.get("apelido")),
    razao_social: texto(form.get("razao_social")),
    cnpj: texto(form.get("cnpj")),
    inscricao_est: texto(form.get("inscricao_est")),
    endereco: texto(form.get("endereco")),
    cidade: texto(form.get("cidade")),
    uf: texto(form.get("uf")),
    cep: texto(form.get("cep")),
    telefone: texto(form.get("telefone")),
    email: texto(form.get("email")),
    eh_deposito: flag(form.get("eh_deposito")),
    ativa: form.get("ativa") === null ? 1 : 1,
  };
  try {
    if (id) {
      const sets = Object.keys(vals).map((k) => `${k} = ?`).join(", ");
      await run(`UPDATE lojas SET ${sets} WHERE id = ?`, ...Object.values(vals), id);
    } else {
      await run(`INSERT INTO lojas(${Object.keys(vals).join(",")}) VALUES (${Object.keys(vals).map(() => "?").join(",")})`, ...Object.values(vals));
    }
    await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: id ? "alterar" : "criar", entidade: "lojas", entidade_id: id || null, detalhe: nome });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao salvar a loja." };
  }
  revalidatePath("/configuracoes/lojas");
  return { ok: true };
}

/* ================================================================== */
/* Wrappers com redirect (para uso direto em <form action>)            */
/* ================================================================== */

function voltaPara(url: string, msg?: string, erro?: string): never {
  const sep = url.includes("?") ? "&" : "?";
  const p = new URLSearchParams();
  if (msg) p.set("msg", msg);
  if (erro) p.set("erro", erro);
  const q = p.toString();
  redirect(url + (q ? sep + q : ""));
}

export async function postSalvarAuxiliar(form: FormData) {
  const tabela = String(form.get("__tabela") || "");
  const r = await salvarAuxiliar(form);
  revalidatePath("/cadastros");
  if (!r.ok) voltaPara(`/cadastros/${tabela}`, undefined, r.erro);
  voltaPara(`/cadastros/${tabela}`, (TABELAS[tabela]?.rotulo ?? "Registro") + " salvo.");
}

export async function postAlternarAtivo(form: FormData) {
  const tabela = String(form.get("__tabela") || "");
  const r = await alternarAtivo(tabela, inteiro(form.get("__id")), inteiro(form.get("__ativo")));
  if (!r.ok) voltaPara(`/cadastros/${tabela}`, undefined, r.erro);
  voltaPara(`/cadastros/${tabela}`, "Situacao alterada.");
}

export async function postExcluirAuxiliar(form: FormData) {
  const tabela = String(form.get("__tabela") || "");
  const r = await excluirAuxiliar(tabela, inteiro(form.get("__id")));
  if (!r.ok) voltaPara(`/cadastros/${tabela}`, undefined, r.erro);
  voltaPara(`/cadastros/${tabela}`, "Registro excluido.");
}

export async function postSalvarCliente(form: FormData) {
  const r = await salvarCliente(form);
  const id = inteiro(form.get("__id"));
  if (!r.ok) voltaPara(id ? `/clientes/${id}` : "/clientes", undefined, r.erro);
  voltaPara(id ? `/clientes/${id}` : "/clientes", "Cliente salvo.");
}

export async function postLancarFiado(form: FormData) {
  const clienteId = inteiro(form.get("cliente_id"));
  const tipo = String(form.get("tipo") || "pagamento") as "pagamento" | "ajuste";
  const r = await lancarFiado(clienteId, tipo, num(form.get("valor")), String(form.get("observacoes") || ""));
  if (!r.ok) voltaPara(`/clientes/${clienteId}`, undefined, r.erro);
  voltaPara(`/clientes/${clienteId}`, tipo === "pagamento" ? "Pagamento registrado." : "Ajuste registrado.");
}

export async function postSalvarUsuario(form: FormData) {
  const r = await salvarUsuario(form);
  if (!r.ok) voltaPara("/configuracoes/usuarios", undefined, r.erro);
  voltaPara("/configuracoes/usuarios", "Usuario salvo.");
}

export async function postSalvarConfiguracoes(form: FormData) {
  await salvarConfiguracoes(form);
  voltaPara("/configuracoes", "Configuracoes salvas.");
}

export async function postSalvarLoja(form: FormData) {
  const r = await salvarLoja(form);
  if (!r.ok) voltaPara("/configuracoes/lojas", undefined, r.erro);
  voltaPara("/configuracoes/lojas", "Loja salva.");
}
