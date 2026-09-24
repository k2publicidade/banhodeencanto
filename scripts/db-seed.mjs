/* ==================================================================
 * BANHO DE ENCANTO - dados iniciais (seed)
 * Roda com:  node scripts/db-seed.mjs [--force]
 * ================================================================== */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { dividirEstoque, sincronizarSequenciaTransferencia } from "./_dividir-estoque.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");
const dbPath = process.env.BDE_DB_PATH || join(dataDir, "banho.db");
const force = process.argv.includes("--force");

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
if (force && existsSync(dbPath)) { rmSync(dbPath, { force: true }); rmSync(dbPath + "-wal", { force: true }); rmSync(dbPath + "-shm", { force: true }); }

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(join(root, "lib", "schema.sql"), "utf8"));

const jaTem = db.prepare("select count(*) n from produtos").get().n;
if (jaTem > 0 && !force) {
  console.log("Banco ja possui " + jaTem + " produtos. Use --force para recriar.");
  process.exit(0);
}

/* ---------------- utilitarios ---------------- */
function hashSenha(senha) {
  const salt = randomBytes(16).toString("hex");
  const h = scryptSync(senha, salt, 64).toString("hex");
  return salt + ":" + h;
}
let semente = 20260921;
function rnd() { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; }
function rint(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function precoDe(custo, mult) { return Math.round((custo * mult) / 10) * 10 - 0.1; }
function diasAtras(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}
function dataHoraAtras(dias, hora, min) {
  const d = new Date(Date.now() - dias * 86400000);
  d.setHours(hora, min, rint(0, 59), 0);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
const ins = (sql) => db.prepare(sql);
function idDe(sql, ...p) { const r = db.prepare(sql).get(...p); return r ? r.id : null; }
/** Digito verificador EAN-13 - usado para gerar codigos de barras validos no seed */
function digitoEAN13(doze) {
  const d = String(doze).replace(/\D/g, "").padStart(12, "0").slice(0, 12);
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  const r = soma % 10;
  return String(r === 0 ? 0 : 10 - r);
}
function geraEAN13(base12) {
  const b = String(base12).replace(/\D/g, "").padStart(12, "0").slice(0, 12);
  return b + digitoEAN13(b);
}

/* ---------------- 1. LOJA / CONFIG / USUARIOS ---------------- */
db.prepare(`INSERT INTO lojas(nome,apelido,razao_social,cnpj,endereco,cidade,uf,cep,telefone,email,eh_deposito,padrao,ativa)
  VALUES (?,?,?,?,?,?,?,?,?,?,0,1,1)`).run(
  "Banho de Encanto - Matriz", "BANHO DE ENCANTO", "BANHO DE ENCANTO COMERCIO DE CABELOS LTDA",
  "12.345.678/0001-90", "Rua das Flores, 250 - Centro", "Sao Paulo", "SP", "01000-000",
  "(11) 99999-0000", "contato@banhodeencanto.com.br"
);
db.prepare(`INSERT INTO lojas(nome,apelido,eh_deposito,padrao,ativa) VALUES (?,?,1,0,1)`)
  .run("Deposito Central", "DEPOSITO");
const LOJA = 1;

const cfgs = [
  ["empresa_nome", "Banho de Encanto", "Nome fantasia exibido no sistema e no cupom"],
  ["empresa_slogan", "Cabelos Sinteticos", "Assinatura da marca"],
  ["cupom_mensagem", "Obrigado pela preferencia! Volte sempre <3", "Mensagem no rodape do cupom"],
  ["cupom_impressora", "80mm", "58mm | 80mm | a4"],
  ["cupom_imprimir_automatico", "1", "Imprime o cupom automaticamente ao finalizar"],
  ["cupom_mostrar_cnpj", "1", "Exibe CNPJ no cupom"],
  ["cupom_desconto_max_pct", "20", "Desconto maximo que o operador pode dar sem senha"],
  ["pdv_permite_estoque_negativo", "0", "Bloqueia venda sem saldo"],
  ["pdv_leitor_codigo_barras", "1", "Foca o campo de codigo de barras automaticamente"],
  ["estoque_metodo_custo", "medio", "medio | ultimo"],
];
for (const [k, v, d] of cfgs) db.prepare("INSERT INTO configuracoes(chave,valor,descricao) VALUES (?,?,?)").run(k, v, d);

const usuarios = [
  ["Administrador", "Admin", "admin@banhodeencanto.com.br", "admin", "1234", 0],
  ["Maria Souza", "Maria", "maria@banhodeencanto.com.br", "gerente", "2345", 2],
  ["Rafaela Lima", "Rafaela", "rafaela@banhodeencanto.com.br", "vendedor", "3456", 4],
  ["Joana Alves", "Joana", "joana@banhodeencanto.com.br", "vendedor", "4567", 3],
  ["Caixa Loja", "Caixa", "caixa@banhodeencanto.com.br", "operador", "1234", 0],
];
for (const [nome, apelido, email, papel, pin, com] of usuarios) {
  db.prepare(`INSERT INTO usuarios(nome,apelido,email,senha_hash,pin,papel,comissao_pct,loja_id,ativo)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(nome, apelido, email, hashSenha(papel === "admin" ? "encanto123" : "encanto123"), pin, papel, com, LOJA);
}
const U_ADMIN = 1, U_MARIA = 2, U_RAFA = 3, U_JOANA = 4, U_CAIXA = 5;

/* ---------------- 2. AUXILIARES ---------------- */
const marcas = ["X-Pression", "Darling", "Diana", "Bella Braids", "Havana"];
for (const m of marcas) db.prepare("INSERT INTO marcas(nome) VALUES (?)").run(m);
const ID = {};
marcas.forEach((m, i) => (ID["marca_" + m] = i + 1));

const linhas = [["Ultra Braid", 1], ["Jumbo Braid", 1], ["Box Braid", 2], ["Crochet Braids", 3], ["Twist & Locs", 4], ["Mega Hair", 5], ["Lace Front", 5]];
for (const [n, m] of linhas) db.prepare("INSERT INTO linhas_colecao(nome,marca_id) VALUES (?,?)").run(n, m);

// Categorias (arvore): pais primeiro
const catsPai = [["Cabelos", "cabelos"], ["Acessorios", "acessorios"], ["Cosmeticos", "cosmeticos"], ["Ferramentas", "ferramentas"]];
catsPai.forEach((c, i) => db.prepare("INSERT INTO categorias(nome,slug,ordem) VALUES (?,?,?)").run(c[0], c[1], i + 1));
const subcats = {
  Cabelos: ["Jumbo Braid", "Box Braid", "Crochet", "Mega Hair", "Aplique / Tic Tac", "Peruca", "Lace"],
  Acessorios: ["Agulha de Crochet", "Linha de Costura", "Rede / Touca", "Presilha", "Elastico", "Kit Tranca"],
  Cosmeticos: ["Shampoo", "Condicionador", "Oleo Capilar", "Gel / Fixador", "Cola e Removedor"],
  Ferramentas: ["Secador", "Prancha", "Escova", "Tesoura", "Boneca Cabeca"],
};
const idCat = {};
catsPai.forEach((c, i) => {
  const paiId = i + 1;
  idCat[c[0]] = paiId;
  (subcats[c[0]] || []).forEach((s, j) =>
    db.prepare("INSERT INTO categorias(nome,pai_id,slug,ordem) VALUES (?,?,?,?)").run(s, paiId, s.toLowerCase().replace(/[^a-z0-9]+/g, "-"), j + 1)
  );
});
function catId(pai, sub) { return idDe("select id from categorias where nome=? and pai_id=?", sub, idCat[pai]); }

// Cores (codigo de mercado + hex para exibir no PDV)
const cores = [
  ["Preto", "1", "preto", "#161616"],
  ["Preto Natural", "1B", "preto", "#221C1A"],
  ["Castanho Escuro", "2", "castanho", "#33241C"],
  ["Castanho Medio", "4", "castanho", "#54402C"],
  ["Castanho Claro", "6", "castanho", "#6E5136"],
  ["Castanho Muito Claro", "8", "castanho", "#8C6A45"],
  ["Castanho Dourado", "30", "castanho", "#9A6B33"],
  ["Mel", "27", "loiro", "#B98C4A"],
  ["Castanho Avermelhado", "33", "ruivo", "#6E3520"],
  ["Vinho", "99J", "colorido", "#5A1226"],
  ["Ruivo", "130", "ruivo", "#8C3A18"],
  ["Ruivo Intenso", "350", "ruivo", "#A33A10"],
  ["Preto e Mel", "M1B/27", "mescla", "#3A2A20"],
  ["Prateado", "60", "acinzentado", "#A9A9A9"],
  ["Loiro Platinado", "613", "loiro", "#E2CE96"],
  ["Loiro Claro", "24", "loiro", "#CDAE72"],
  ["Azul", "900", "colorido", "#1B3A8C"],
  ["Rosa", "800", "colorido", "#C2467E"],
  ["Verde", "700", "colorido", "#1F7A4D"],
  ["Roxo", "600", "colorido", "#6A3CA0"],
];
cores.forEach((c, i) => db.prepare("INSERT INTO cores(nome,codigo,familia,hex,ordem) VALUES (?,?,?,?,?)").run(c[0], c[1], c[2], c[3], i + 1));
const idCor = {};
cores.forEach((c, i) => (idCor[c[1]] = i + 1));

const texturas = ["Liso", "Ondulado", "Cacheado", "Crespo", "Jumbo", "Bob", "Yaki", "Nao aplicavel"];
texturas.forEach((t, i) => db.prepare("INSERT INTO texturas(nome,ordem) VALUES (?,?)").run(t, i + 1));
const idTex = {}; texturas.forEach((t, i) => (idTex[t] = i + 1));

const comps = [[40, "cm"], [50, "cm"], [60, "cm"], [80, "cm"], [100, "cm"], [24, "pol"], [30, "pol"]];
comps.forEach(([v, u], i) => db.prepare("INSERT INTO comprimentos(valor,unidade,rotulo,ordem) VALUES (?,?,?,?)").run(v, u, `${v} ${u}`, i + 1));
const idComp = {}; comps.forEach(([v, u], i) => (idComp[`${v}${u}`] = i + 1));

["Cabelo", "Acessorio", "Cosmetico", "Ferramenta", "Peruca"].forEach((t, i) => db.prepare("INSERT INTO tipos_produto(nome,ordem) VALUES (?,?)").run(t, i + 1));
const idTipo = {}; ["Cabelo", "Acessorio", "Cosmetico", "Ferramenta", "Peruca"].forEach((t, i) => (idTipo[t] = i + 1));

const materiais = ["Sintetico", "Organico", "Humano", "Misto", "Fibra Natural", "Nao aplicavel"];
materiais.forEach((m) => db.prepare("INSERT INTO materiais(nome) VALUES (?)").run(m));
const idMat = {}; materiais.forEach((m, i) => (idMat[m] = i + 1));

const fibras = ["Kanekalon", "Toyokalon", "Modacrylic", "Polipropileno", "Fibra Premium", "Nao aplicavel"];
fibras.forEach((f) => db.prepare("INSERT INTO tipos_fibra(nome) VALUES (?)").run(f));
const idFibra = {}; fibras.forEach((f, i) => (idFibra[f] = i + 1));

const tecnicas = ["Tranca", "Box Braids", "Crochet", "Entrelace", "Mega Hair", "Twist", "Nago", "Uso direto"];
tecnicas.forEach((t) => db.prepare("INSERT INTO tecnicas(nome) VALUES (?)").run(t));
const idTec = {}; tecnicas.forEach((t, i) => (idTec[t] = i + 1));

["Adulto", "Infantil", "Profissional", "Unissex"].forEach((p) => db.prepare("INSERT INTO publicos(nome) VALUES (?)").run(p));
const idPub = { Adulto: 1, Infantil: 2, Profissional: 3, Unissex: 4 };

[["UN", "Unidade"], ["PCT", "Pacote"], ["CX", "Caixa"], ["KG", "Quilograma"], ["MT", "Metro"], ["PAR", "Par"], ["KIT", "Kit"]]
  .forEach(([s, n]) => db.prepare("INSERT INTO unidades_medida(sigla,nome) VALUES (?,?)").run(s, n));

const formas = [
  ["Dinheiro", "dinheiro", 0, 0, 1],
  ["PIX", "pix", 0, 0, 1],
  ["Cartao de Debito", "debito", 1.2, 1, 1],
  ["Cartao de Credito", "credito", 3.5, 30, 1],
  ["Credito 2x", "credito", 4.5, 30, 1],
  ["Fiado", "fiado", 0, 30, 0],
];
formas.forEach(([n, t, tx, pz, cx], i) =>
  db.prepare("INSERT INTO formas_pagamento(nome,tipo,taxa_pct,prazo_dias,aceita_troco,entra_no_caixa,ordem) VALUES (?,?,?,?,?,?,?)")
    .run(n, t, tx, pz, n === "Dinheiro" ? 1 : 0, cx, i + 1));
const idForma = {}; formas.forEach((f, i) => (idForma[f[0]] = i + 1));

/* ---------------- 3. FORNECEDORES ---------------- */
const forns = [
  ["DISTRIBUIDORA BELEZA TOTAL LTDA", "Beleza Total", "11.222.333/0001-44", "Carlos", "(11) 98888-1111", 7, "Jumbo, Box Braid"],
  ["IMPORTADORA FIBRA HAIR LTDA", "Fibra Hair", "22.333.444/0001-55", "Ana", "(11) 97777-2222", 12, "Ulta braid, Kanekalon"],
  ["COMERCIAL CABELOS E ARTE ME", "Cabelos e Arte", "33.444.555/0001-66", "Roberto", "(11) 96666-3333", 5, "Crochet, mega hair"],
  ["ATACADAO DOS CABELOS LTDA", "Atacadao dos Cabelos", "44.555.666/0001-77", "Lucia", "(11) 95555-4444", 10, "Acessorios e kits"],
  ["BELEZA & CIA SUPRIMENTOS", "Beleza & Cia", "55.666.777/0001-88", "Marcos", "(11) 94444-5555", 4, "Cosmeticos e ferramentas"],
];
forns.forEach(([r, f, c, cont, tel, prazo, obs]) =>
  db.prepare(`INSERT INTO fornecedores(razao_social,nome_fantasia,cnpj,contato,telefone,email,prazo_medio_entrega,observacoes)
    VALUES (?,?,?,?,?,?,?,?)`).run(r, f, c, cont, tel, f.toLowerCase().replace(/[^a-z]/g, "") + "@fornecedor.com.br", prazo, obs));
const idForn = {}; forns.forEach((f, i) => (idForn[f[1]] = i + 1));

/* ---------------- 4. PRODUTOS + VARIACOES ---------------- */
/* [nome, marca, linha, categoria, subcategoria, tipo, material, fibra, modelo,
    textura, tecnica, publico, comps[], cores[], custoBase, markup, peso, qtdPct, qtdRecom, local] */
const catalogo = [
  ["Jumbo Ultra Braid", "X-Pression", "Ultra Braid", "Cabelos", "Jumbo Braid", "Cabelo", "Sintetico", "Kanekalon",
   "Jumbo Ultra Braid", "Jumbo", "Tranca", "Adulto", ["60cm", "80cm", "100cm"], ["1", "1B", "2", "4", "27", "30", "33", "99J", "613", "M1B/27"],
   9.5, 2.4, 120, 1, 4, "Parede A", "A1", "1", "2"],
  ["Jumbo Braid Classico", "Darling", "Jumbo Braid", "Cabelos", "Jumbo Braid", "Cabelo", "Sintetico", "Kanekalon",
   "Jumbo Braid", "Jumbo", "Tranca", "Adulto", ["60cm", "80cm"], ["1", "1B", "2", "4", "6", "33", "613"],
   7.8, 2.5, 100, 1, 4, "Parede A", "A1", "1", "3"],
  ["Box Braid Premium", "X-Pression", "Box Braid", "Cabelos", "Box Braid", "Cabelo", "Sintetico", "Toyokalon",
   "Box Braid", "Liso", "Box Braids", "Adulto", ["60cm", "80cm"], ["1", "1B", "2", "4", "27", "30", "613"],
   12.0, 2.3, 150, 1, 5, "Parede A", "A2", "1", "1"],
  ["Crochet Braid Corkscrew", "Diana", "Crochet Braids", "Cabelos", "Crochet", "Cabelo", "Sintetico", "Modacrylic",
   "Corkscrew", "Cacheado", "Crochet", "Adulto", ["40cm", "60cm"], ["1", "1B", "2", "4", "27", "99J", "613"],
   14.5, 2.2, 130, 1, 3, "Parede B", "B1", "1", "2"],
  ["Crochet Twist Out", "Diana", "Crochet Braids", "Cabelos", "Crochet", "Cabelo", "Sintetico", "Modacrylic",
   "Twist Out", "Crespo", "Crochet", "Adulto", ["40cm", "60cm"], ["1", "1B", "2", "30", "33", "613"],
   15.0, 2.2, 130, 1, 3, "Parede B", "B1", "2", "1"],
  ["Mega Hair Fita Adesiva", "Bella Braids", "Mega Hair", "Cabelos", "Mega Hair", "Cabelo", "Humano", "Fibra Premium",
   "Fita Adesiva", "Liso", "Mega Hair", "Profissional", ["50cm", "60cm"], ["1", "1B", "2", "4", "6", "8", "27", "613"],
   42.0, 1.9, 100, 1, 2, "Vitrine", "V1", "1", "1"],
  ["Mega Hair Micro Anel", "Bella Braids", "Mega Hair", "Cabelos", "Mega Hair", "Cabelo", "Humano", "Fibra Premium",
   "Micro Anel", "Ondulado", "Mega Hair", "Profissional", ["50cm", "60cm"], ["1", "1B", "2", "4", "27", "613"],
   48.0, 1.9, 100, 1, 2, "Vitrine", "V1", "2", "1"],
  ["Aplique Tic Tac 3 Pentes", "Darling", "Twist & Locs", "Cabelos", "Aplique / Tic Tac", "Cabelo", "Sintetico", "Kanekalon",
   "3 Pentes", "Ondulado", "Uso direto", "Adulto", ["40cm", "60cm"], ["1", "1B", "2", "4", "30", "613"],
   11.0, 2.6, 90, 1, 1, "Balcao", "C1", "1", "1"],
  ["Peruca Lace Front Bob", "Havana", "Lace Front", "Cabelos", "Peruca", "Peruca", "Sintetico", "Fibra Premium",
   "Bob", "Bob", "Uso direto", "Adulto", ["30pol"], ["1", "1B", "2", "4", "613"],
   95.0, 2.0, 250, 1, 1, "Vitrine", "V2", "1", "1"],
  ["Kit Tranca Completo 4 Pecas", "Darling", "Box Braid", "Acessorios", "Kit Tranca", "Acessorio", "Nao aplicavel", "Nao aplicavel",
   "Kit 4 pecas", "Nao aplicavel", "Tranca", "Adulto", [], [],
   16.0, 2.5, 200, 1, 1, "Balcao", "C1", "2", "1"],
  ["Agulha de Crochet Ergonomic", "Darling", "Crochet Braids", "Acessorios", "Agulha de Crochet", "Acessorio", "Nao aplicavel", "Nao aplicavel",
   "Ergonomic 5mm", "Nao aplicavel", "Crochet", "Profissional", [], [],
   9.0, 2.8, 40, 1, 1, "Balcao", "C1", "3", "1"],
  ["Rede para Cabelo (Touca)", "Darling", "Box Braid", "Acessorios", "Rede / Touca", "Acessorio", "Nao aplicavel", "Nao aplicavel",
   "Rede elastica", "Nao aplicavel", "Uso direto", "Unissex", [], [],
   3.2, 3.2, 20, 5, 1, "Balcao", "C2", "1", "2"],
  ["Oleo Capilar Nutritivo 60ml", "Bella Braids", "Mega Hair", "Cosmeticos", "Oleo Capilar", "Cosmetico", "Nao aplicavel", "Nao aplicavel",
   "Nutritivo", "Nao aplicavel", "Uso direto", "Adulto", [], [],
   12.5, 2.6, 80, 1, 1, "Prateleira C", "D1", "1", "2"],
  ["Cola para Peruca 30ml", "Havana", "Lace Front", "Cosmeticos", "Cola e Removedor", "Cosmetico", "Nao aplicavel", "Nao aplicavel",
   "Fixacao forte", "Nao aplicavel", "Uso direto", "Adulto", [], [],
   22.0, 2.4, 60, 1, 1, "Prateleira C", "D1", "2", "1"],
  ["Secador Profissional 2000W", "Diana", "Mega Hair", "Ferramentas", "Secador", "Ferramenta", "Nao aplicavel", "Nao aplicavel",
   "Ionico 2000W", "Nao aplicavel", "Uso direto", "Profissional", [], [],
   135.0, 1.8, 800, 1, 1, "Prateleira D", "E1", "1", "1"],
  ["Prancha Alisadora Titanium", "Diana", "Mega Hair", "Ferramentas", "Prancha", "Ferramenta", "Nao aplicavel", "Nao aplicavel",
   "Titanium 230C", "Nao aplicavel", "Uso direto", "Profissional", [], [],
   118.0, 1.85, 700, 1, 1, "Prateleira D", "E1", "2", "1"],
  ["Boneca Cabeca para Treino", "Bella Braids", "Mega Hair", "Ferramentas", "Boneca Cabeca", "Ferramenta", "Nao aplicavel", "Nao aplicavel",
   "Treino com tripé", "Nao aplicavel", "Mega Hair", "Profissional", [], [],
   88.0, 1.9, 1200, 1, 1, "Prateleira D", "E2", "1", "1"],
];

const insertProduto = db.prepare(`INSERT INTO produtos(
  sku, nome, nome_reduzido, marca_id, linha_id, categoria_id, subcategoria_id, status,
  tipo_produto_id, material_id, tipo_fibra_id, modelo_estilo, textura_id, tecnica_id, publico_id,
  cor_id, comprimento_id, observacoes_tecnicas,
  ncm, cest, origem_mercadoria, unidade_comercial, classificacao_fiscal, tributacao,
  nome_site, descricao_curta, descricao_completa, caracteristicas, modo_uso, cuidados,
  foto_principal, tags, destaque, exibir_site, ordem_exibicao, slug
) VALUES (${Array(36).fill("?").join(",")})`);

const insertVar = db.prepare(`INSERT INTO variacoes(
  produto_id, sku, ean, codigo_interno, cor_id, cor_codigo_fabricante, cor_nome_comercial,
  comprimento_valor, comprimento_unidade, peso_pacote, quantidade_por_pacote, quantidade_recomendada, publico_id,
  custo_aquisicao, custo_medio, ultimo_custo, preco_venda, preco_promocional, preco_minimo_autorizado,
  data_ultima_alteracao_preco, estoque_min, estoque_max, ponto_reposicao, unidade_estoque,
  localizacao, corredor, prateleira, posicao, permite_estoque_negativo, controle_lote, status
) VALUES (${Array(31).fill("?").join(",")})`);

const insertEstoque = db.prepare("INSERT INTO estoque(variacao_id,loja_id,quantidade,reservado) VALUES (?,?,?,?)");
const insertProdForn = db.prepare(`INSERT INTO produto_fornecedor(produto_id,variacao_id,fornecedor_id,codigo_fornecedor,
  referencia_fabricante,custo,qtd_minima_compra,multiplo_compra,prazo_entrega_dias,principal,ultima_compra,ultimo_custo_compra)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

let seqProd = 0, seqVar = 0, seqEan = 0;
const variacoesCriadas = [];   // { id, custo, preco }
const porProduto = {};

for (const p of catalogo) {
  const [nome, marca, linha, cat, sub, tipo, mat, fibra, modelo, tex, tec, pub, compsP, coresP, custoBase, mult, peso, qtdPct, qtdRec, loc, corr, prat, pos] = p;
  seqProd++;
  const skuPai = "BDE-" + nome.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 3) + String(seqProd).padStart(2, "0");
  const slug = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
  const descricao = `${nome} da marca ${marca}. Fibra ${fibra} de alta qualidade, textura ${tex.toLowerCase()}, ideal para ${tec.toLowerCase()}.`;
  const argsProduto = [
    skuPai, nome, nome, idDe("select id from marcas where nome=?", marca), idDe("select id from linhas_colecao where nome=?", linha),
    idCat[cat], catId(cat, sub), "ativo", idTipo[tipo], idMat[mat], idFibra[fibra], modelo, idTex[tex], idTec[tec], idPub[pub],
    null, null, null,
    tipo === "Cabelo" ? "6704.20.00" : "9615.11.00", null, "0", "UN", "SIMPLES NACIONAL - CSOSN 102", "ICMS 18% (credito)",
    nome, descricao.slice(0, 120), descricao,
    `Fibra ${fibra}; ${peso}g por pacote; textura ${tex.toLowerCase()}`,
    `Separe a quantidade recomendada (${qtdRec} pacote${qtdRec > 1 ? "s" : ""}), deslize as mechas e finalize com agua morna.`,
    "Nao aplique calor acima de 120C. Lave com shampoo neutro e seque a sombra.",
    null, `${nome}, ${marca}, ${tex}, cabelo sintetico, ${tec}`, seqProd % 4 === 0 ? 1 : 0, 1, seqProd, slug
  ];
  const ruins = argsProduto.map((v, i) => [i + 1, v]).filter(([, v]) => v === undefined || (typeof v === "number" && !Number.isFinite(v)));
  if (ruins.length) {
    console.error("FALHA no produto " + JSON.stringify(nome) + " - argumentos invalidos: " + JSON.stringify(ruins));
    throw new Error("Argumento invalido no insert de produtos");
  }
  if (argsProduto.length !== 36) throw new Error("Esperado 36 argumentos, veio " + argsProduto.length);
  const produtoId = Number(insertProduto.run(...argsProduto).lastInsertRowid);
  const idFornecedorPrincipal = idForn[forns[(seqProd - 1) % forns.length][1]];
  porProduto[produtoId] = [];

  const combos = [];
  if (coresP.length === 0) {
    combos.push({ corCod: null, comp: compsP[0] || null });
  } else {
    for (const cc of coresP) for (const cp of compsP) combos.push({ corCod: cc, comp: cp });
  }

  let i = 0;
  for (const cb of combos) {
    i++; seqVar++; seqEan++;
    const corIdx = cb.corCod ? Object.keys(idCor).find((k) => k === cb.corCod) : null;
    const corId = cb.corCod ? idCor[cb.corCod] : null;
    const corInfo = cores.find((c) => c[1] === cb.corCod);
    const compMatch = cb.comp ? /^(\d+)(cm|pol)$/.exec(cb.comp) : null;
    const compVal = compMatch ? Number(compMatch[1]) : null;
    const compUn = compMatch ? compMatch[2] : null;

    // custo varia por comprimento (mais longo = mais caro)
    let custo = custoBase * (cb.comp === "100cm" ? 1.35 : cb.comp === "80cm" ? 1.15 : cb.comp === "30pol" ? 1.25 : 1);
    if (["613", "60", "24", "27"].includes(cb.corCod)) custo *= 1.08;   // cores claras custam mais
    if (["99J", "900", "800", "700", "600"].includes(cb.corCod)) custo *= 1.12;
    custo = Math.round(custo * 100) / 100;
    const preco = precoDe(custo, mult);
    const sku = skuPai + "-" + (cb.corCod ? cb.corCod.replace(/[^A-Za-z0-9]/g, "") : "U") + (cb.comp ? "-" + cb.comp.toUpperCase() : "");
    const ean = geraEAN13("200" + String(100000000 + seqEan).padStart(9, "0").slice(0, 9));
    const pesoVar = peso * (cb.comp === "100cm" ? 1.3 : cb.comp === "80cm" ? 1.15 : 1);

    const varId = Number(insertVar.run(
      produtoId, sku, ean, "COD-" + String(seqVar).padStart(6, "0"),
      corId, cb.corCod, corInfo ? `${corInfo[0]} ${cb.corCod}` : null,
      compVal, compUn, Math.round(pesoVar), qtdPct, qtdRec, idPub[pub],
      custo, custo, custo, preco, null, Math.round(preco * 0.9 * 100) / 100,
      dataHoraAtras(rint(20, 120), rint(9, 17), rint(0, 59)),
      Math.max(2, Math.round(qtdRec * 2)), Math.max(80, Math.round(qtdRec * 25)), Math.max(4, Math.round(qtdRec * 4)), "PCT",
      loc, corr, prat, pos, 0, 0, "ativo"
    ).lastInsertRowid);

    // estoque: a maioria saudavel, alguns criticos/zerados para demonstracao
    let qtd;
    if (seqVar % 17 === 0) qtd = 0;
    else if (seqVar % 11 === 0) qtd = rint(1, 2);
    else if (seqVar % 5 === 0) qtd = rint(3, 6);
    else qtd = rint(8, 45);
    insertEstoque.run(varId, LOJA, qtd, 0);

    // custo por fornecedor (mesmo SKU mais barato em outro fornecedor)
    const f2 = forns[(seqProd + i) % forns.length][1];
    insertProdForn.run(produtoId, varId, idFornecedorPrincipal, "F" + String(idFornecedorPrincipal) + "-" + String(seqVar).padStart(4, "0"),
      `${marca} ${cb.corCod || ""} ${cb.comp || ""}`.trim(), custo, 12, 6, forns[(seqProd - 1) % forns.length][5], 1,
      dataHoraAtras(rint(10, 90), 10, 0), custo);
    if (f2 !== forns[(seqProd - 1) % forns.length][1]) {
      const cf = Math.round(custo * (0.92 + rnd() * 0.14) * 100) / 100;
      insertProdForn.run(produtoId, varId, idForn[f2], "F" + String(idForn[f2]) + "-" + String(seqVar).padStart(4, "0"),
        `${marca} ${cb.corCod || ""} ${cb.comp || ""}`.trim(), cf, 24, 12, forns.find((x) => x[1] === f2)[5], 0,
        dataHoraAtras(rint(20, 120), 10, 0), cf);
    }

    variacoesCriadas.push({ id: varId, custo, preco, produtoId });
    porProduto[produtoId].push(varId);
  }
}
console.log("Produtos: " + catalogo.length + " | Variacoes/SKUs: " + variacoesCriadas.length);

/* ---------------- 5. CLIENTES ---------------- */
const clientes = [
  ["Fernanda Ribeiro", "Fe", "123.456.789-00", "(11) 98888-1234", 0],
  ["Juliana Prado", "Ju", "234.567.890-11", "(11) 97777-2345", 300],
  ["Camila Nogueira", "Cami", "345.678.901-22", "(11) 96666-3456", 0],
  ["Patricia Alves", "Paty", "456.789.012-33", "(11) 95555-4567", 500],
  ["Sandra Moreira", "Sandra", "567.890.123-44", "(11) 94444-5678", 0],
  ["Adriana Costa", "Drica", "678.901.234-55", "(11) 93333-6789", 200],
  ["Vanessa Dias", "Vane", "789.012.345-66", "(11) 92222-7890", 0],
  ["Salão Estrela (Ana)", "Salao Estrela", "12.987.654/0001-11", "(11) 91111-8901", 1500],
  ["Instituto Bella (Bruna)", "Instituto Bella", "98.765.432/0001-22", "(11) 90000-9012", 2000],
  ["Cliente Balcao", "-", null, null, 0],
];
const insertCli = db.prepare(`INSERT INTO clientes(codigo,nome,apelido,cpf_cnpj,telefone,email,cidade,uf,limite_credito,ativo,criado_em)
  VALUES (?,?,?,?,?,?,?,?,?,1,?)`);
clientes.forEach(([nome, ap, doc, tel, limite], i) =>
  insertCli.run("CLI-" + String(i + 1).padStart(4, "0"), nome, ap, doc, tel,
    nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, ".") + "@email.com",
    "Sao Paulo", "SP", limite, dataHoraAtras(rint(60, 400), 10, 0)));
const IDX_CLI = { balcao: 10 };

/* ---------------- 6. COMPRAS ---------------- */
const insertCompra = db.prepare(`INSERT INTO compras(numero,fornecedor_id,loja_id,data,documento,status,subtotal,frete,desconto,total,observacoes,usuario_id,confirmado_em,criado_em)
  VALUES (?,?,?,?,?,'confirmado',?,?,?,?,?,?,?,?)`);
const insertCompraItem = db.prepare(`INSERT INTO compras_itens(compra_id,variacao_id,quantidade,custo_unitario,total,lote,validade)
  VALUES (?,?,?,?,?,?,?)`);
const movEstoque = db.prepare(`INSERT INTO estoque_movimentos(variacao_id,loja_id,tipo,quantidade,saldo_anterior,saldo_apos,
  custo_unitario,documento,motivo,referencia_tipo,referencia_id,usuario_id,criado_em) VALUES (?,?,'entrada',?,?,?,?,?,?, 'compra', ?,?,?)`);

let seqCompra = 0;
for (let c = 0; c < 4; c++) {
  seqCompra++;
  const forn = 1 + (c % forns.length);
  const dias = 90 - c * 22;
  const data = diasAtras(dias);
  const itens = [];
  for (let k = 0; k < rint(4, 8); k++) {
    const v = pick(variacoesCriadas);
    const qtd = rint(6, 30);
    itens.push({ v, qtd, custo: v.custo });
  }
  const subtotal = itens.reduce((s, it) => s + it.qtd * it.custo, 0);
  const frete = Math.round(subtotal * 0.02 * 100) / 100;
  const total = Math.round((subtotal + frete) * 100) / 100;
  const compraId = Number(insertCompra.run(
    "CMP-" + String(seqCompra).padStart(5, "0"), forn, LOJA, data, "NF-" + rint(10000, 99999),
    Math.round(subtotal * 100) / 100, frete, 0, total,
    forns[forn - 1][6], U_ADMIN, data + " 10:30:00", data + " 09:00:00"
  ).lastInsertRowid);
  for (const it of itens) {
    insertCompraItem.run(compraId, it.v.id, it.qtd, it.custo, Math.round(it.qtd * it.custo * 100) / 100, null, null);
    const atual = db.prepare("select quantidade from estoque where variacao_id=? and loja_id=?").get(it.v.id, LOJA);
    const antes = atual ? atual.quantidade : 0;
    const depois = antes + it.qtd;
    db.prepare("update estoque set quantidade=?, atualizado_em=datetime('now','localtime') where variacao_id=? and loja_id=?").run(depois, it.v.id, LOJA);
    movEstoque.run(it.v.id, LOJA, it.qtd, antes, depois, it.custo, "NF-" + compraId, "Entrada por compra", compraId, U_ADMIN, data + " 10:30:00");
  }
}
console.log("Compras: " + seqCompra);

/* ---------------- 7. CAIXAS (sessoes) ---------------- */
const insertCaixa = db.prepare(`INSERT INTO caixas(loja_id,usuario_id,fechado_por_id,terminal,abertura_em,fechamento_em,valor_abertura,valor_fechamento_informado,valor_sistema,diferenca,status,observacoes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertCaixaMov = db.prepare(`INSERT INTO caixa_movimentos(caixa_id,tipo,valor,forma_pagamento_id,descricao,usuario_id,criado_em)
  VALUES (?,?,?,?,?,?,?)`);

/* ---------------- 8. VENDAS ---------------- */
const insertVenda = db.prepare(`INSERT INTO vendas(numero,loja_id,caixa_id,usuario_id,vendedor_id,cliente_id,data,subtotal,desconto_valor,
  desconto_pct,acrescimo,frete,total,custo_total,status,observacoes,criado_em)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'concluida',?,?)`);
const insertVendaItem = db.prepare(`INSERT INTO vendas_itens(venda_id,variacao_id,descricao,quantidade,preco_unitario,preco_tabela,
  desconto_valor,total,custo_unitario,comissao_pct) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const insertPag = db.prepare(`INSERT INTO vendas_pagamentos(venda_id,forma_pagamento_id,valor,parcelas,valor_recebido,troco,criado_em)
  VALUES (?,?,?,?,?,?,?)`);
const insertFiado = db.prepare(`INSERT INTO fiado_lancamentos(cliente_id,venda_id,tipo,valor,saldo_apos,vencimento,data,forma_pagamento_id,usuario_id)
  VALUES (?,?,'compra',?,?,?,?,?,?)`);

let seqVenda = 0;
let caixaAbertoId = null;
for (let d = 89; d >= 0; d--) {
  const dataBase = diasAtras(d);
  const diaSemana = new Date(dataBase + "T12:00:00").getDay();
  if (diaSemana === 0) continue;                       // domingo fechado
  const movimento = diaSemana === 6 ? rint(6, 12) : rint(3, 9);
  const valorAbertura = 200;
  const sessaoId = Number(insertCaixa.run(LOJA, U_CAIXA, null, "CAIXA 1",
    dataBase + " 09:00:00", null, valorAbertura, null, null, null, "aberto", null).lastInsertRowid);
  insertCaixaMov.run(sessaoId, "abertura", valorAbertura, null, "Abertura de caixa", U_CAIXA, dataBase + " 09:00:00");
  if (d === 0) caixaAbertoId = sessaoId;

  let dinheiro = 0;
  for (let v = 0; v < movimento; v++) {
    seqVenda++;
    const hora = rint(9, 19), min = rint(0, 59);
    const dataVenda = dataHoraAtras(d, hora, min);
    const nItens = rint(1, 4);
    const escolhidas = [];
    for (let k = 0; k < nItens; k++) escolhidas.push({ v: pick(variacoesCriadas), qtd: rnd() > 0.85 ? 2 : 1 });

    let subtotal = 0, custoTotal = 0;
    const itens = [];
    for (const e of escolhidas) {
      const estoqueAtual = db.prepare("select quantidade from estoque where variacao_id=? and loja_id=?").get(e.v.id, LOJA);
      if (!estoqueAtual || estoqueAtual.quantidade < e.qtd) continue;   // nao vende sem saldo
      const desconto = rnd() > 0.88 ? Math.round(e.v.preco * e.qtd * 0.1 * 100) / 100 : 0;
      const total = Math.round(e.v.preco * e.qtd * 100) / 100 - desconto;
      subtotal += Math.round(e.v.preco * e.qtd * 100) / 100;
      custoTotal += e.v.custo * e.qtd;
      itens.push({ ...e, desconto, total });
    }
    if (itens.length === 0) { seqVenda--; continue; }

    const descVenda = rnd() > 0.9 ? Math.round(subtotal * 0.05 * 100) / 100 : 0;
    const total = Math.round((subtotal - descVenda) * 100) / 100;
    const clienteId = rnd() > 0.7 ? rint(1, 9) : IDX_CLI.balcao;
    const vendedor = pick([U_RAFA, U_JOANA, U_MARIA]);
    const vendaId = Number(insertVenda.run(
      "V" + String(seqVenda).padStart(6, "0"), LOJA, sessaoId, U_CAIXA, vendedor, clienteId, dataVenda,
      subtotal, descVenda, descVenda > 0 ? 5 : 0, 0, 0, total, Math.round(custoTotal * 100) / 100,
      null, dataVenda
    ).lastInsertRowid);

    for (const it of itens) {
      insertVendaItem.run(vendaId, it.v.id, "SKU " + it.v.id, it.qtd, it.v.preco, it.v.preco, it.desconto, it.total, it.v.custo, 3);
      const est = db.prepare("select quantidade from estoque where variacao_id=? and loja_id=?").get(it.v.id, LOJA);
      const antes = est ? est.quantidade : 0;
      const depois = antes - it.qtd;
      db.prepare("update estoque set quantidade=?, atualizado_em=datetime('now','localtime') where variacao_id=? and loja_id=?").run(depois, it.v.id, LOJA);
      db.prepare(`INSERT INTO estoque_movimentos(variacao_id,loja_id,tipo,quantidade,saldo_anterior,saldo_apos,custo_unitario,
        documento,motivo,referencia_tipo,referencia_id,usuario_id,criado_em)
        VALUES (?,?,'venda',?,?,?,?,?,?, 'venda',?,?,?)`)
        .run(it.v.id, LOJA, it.qtd, antes, depois, it.v.custo, "V" + String(seqVenda).padStart(6, "0"), "Venda PDV", vendaId, U_CAIXA, dataVenda);
    }

    // pagamento
    const r = rnd();
    let formaId, parcelas = 1, recebido = null, troco = null;
    if (clienteId !== IDX_CLI.balcao && r > 0.94) {
      formaId = idForma["Fiado"]; parcelas = 1;
      const saldoAnt = db.prepare("select COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s from fiado_lancamentos where cliente_id=?").get(clienteId).s;
      insertFiado.run(clienteId, vendaId, total, Math.round((saldoAnt + total) * 100) / 100,
        diasAtras(d - 30), dataVenda, formaId, U_CAIXA);
    } else if (r > 0.72) { formaId = idForma["PIX"]; }
    else if (r > 0.5) { formaId = idForma["Cartao de Debito"]; }
    else if (r > 0.3) { formaId = idForma["Cartao de Credito"]; if (r > 0.42) parcelas = 2; }
    else if (r > 0.2) { formaId = idForma["Credito 2x"]; parcelas = 2; }
    else { formaId = idForma["Dinheiro"]; recebido = Math.ceil(total / 10) * 10; troco = Math.round((recebido - total) * 100) / 100; }
    insertPag.run(vendaId, formaId, total, parcelas, recebido, troco, dataVenda);

    if (formaId === idForma["Dinheiro"]) {
      dinheiro += total;
      insertCaixaMov.run(sessaoId, "venda", total, formaId, "V" + String(seqVenda).padStart(6, "0"), U_CAIXA, dataVenda);
    } else {
      insertCaixaMov.run(sessaoId, "venda", total, formaId, "V" + String(seqVenda).padStart(6, "0"), U_CAIXA, dataVenda);
    }
  }

  // sangria e fechamento
  if (rnd() > 0.6 && dinheiro > 400) {
    const sangria = Math.round((dinheiro - 300) * 100) / 100;
    insertCaixaMov.run(sessaoId, "sangria", sangria, null, "Retirada para cofre", U_MARIA, dataBase + " 18:00:00");
  }
  if (d > 0) {
    const sistema = db.prepare(`select COALESCE(SUM(CASE WHEN tipo IN ('venda','recebimento','suprimento','abertura') THEN valor
      WHEN tipo IN ('sangria','despesa','estorno') THEN -valor ELSE 0 END),0) s from caixa_movimentos where caixa_id=?`).get(sessaoId).s;
    const informado = Math.round((sistema + (rnd() > 0.8 ? (rnd() > 0.5 ? 5 : -5) : 0)) * 100) / 100;
    db.prepare(`update caixas set status='fechado', fechamento_em=?, valor_fechamento_informado=?, valor_sistema=?, diferenca=?, fechado_por_id=?
      where id=?`).run(dataBase + " 19:30:00", informado, Math.round(sistema * 100) / 100, Math.round((informado - sistema) * 100) / 100, U_MARIA, sessaoId);
  }
}
console.log("Vendas: " + seqVenda);

/* ---------------- 8b. REPOSICAO POS-VENDAS ----------------
 * O historico de vendas drena o estoque. Repomos a maior parte para a loja
 * ficar num estado saudavel, mantendo alguns SKUs baixos/zerados de proposito
 * para demonstrar os alertas de reposicao na tela de estoque. */
const repor = db.prepare("update estoque set quantidade=?, atualizado_em=datetime('now','localtime') where variacao_id=? and loja_id=?");
const movReposicao = db.prepare(`INSERT INTO estoque_movimentos(variacao_id,loja_id,tipo,quantidade,saldo_anterior,saldo_apos,
  motivo,referencia_tipo,usuario_id,criado_em) VALUES (?,?,'entrada',?,?,?,?,'manual',?,?)`);
{
  const todas = db.prepare(`select e.variacao_id, e.quantidade, v.estoque_min, v.ponto_reposicao, v.quantidade_recomendada, v.custo_medio
    from estoque e join variacoes v on v.id = e.variacao_id where e.loja_id = ?`).all(LOJA);
  let i = 0;
  for (const r of todas) {
    i++;
    // 1 em cada 12 fica zerado, 1 em cada 9 fica critico - de proposito
    if (i % 12 === 0) { if (r.quantidade !== 0) { repor.run(0, r.variacao_id, LOJA);
        movReposicao.run(r.variacao_id, LOJA, r.quantidade, r.quantidade, 0, "Ajuste de inventario", U_MARIA, dataHoraAtras(rint(1,20),16,0)); } continue; }
    const alvo = i % 9 === 0 ? Math.max(1, r.estoque_min) : rint(18, 60);
    if (r.quantidade < alvo) {
      repor.run(alvo, r.variacao_id, LOJA);
      movReposicao.run(r.variacao_id, LOJA, alvo - r.quantidade, r.quantidade, alvo, "Reposicao de estoque", U_ADMIN, dataHoraAtras(rint(1, 25), 9, 0));
    }
  }
}

/* ---------------- 9. AJUSTES / PERDAS / INVENTARIO (historico) ---------------- */
for (let k = 0; k < 8; k++) {
  const v = pick(variacoesCriadas);
  const est = db.prepare("select quantidade from estoque where variacao_id=? and loja_id=?").get(v.id, LOJA);
  if (!est || est.quantidade < 2) continue;
  const qtd = rint(1, 2);
  db.prepare("update estoque set quantidade=quantidade-? where variacao_id=? and loja_id=?").run(qtd, v.id, LOJA);
  db.prepare(`INSERT INTO estoque_movimentos(variacao_id,loja_id,tipo,quantidade,saldo_anterior,saldo_apos,motivo,referencia_tipo,usuario_id,criado_em)
    VALUES (?,?,'perda',?,?,?,?,'manual',?,?)`).run(v.id, LOJA, qtd, est.quantidade, est.quantidade - qtd,
    pick(["Mecha danificada na aplicacao", "Pacote aberto", "Avaria no transporte", "Material vencido"]), U_MARIA, dataHoraAtras(rint(1, 60), 15, 0));
}

/* ---------------- 9b. ESTOQUES SEPARADOS (galpao x loja) ----------------
   O sistema controla estoque POR LOCAL: a loja vende, o galpao (deposito
   central) guarda o volume. Aqui o galpao e abastecido com uma transferencia
   de verdade (documento TRF-xxxxx + movimentos nos dois estoques), do mesmo
   jeito que o cliente vai fazer na tela de transferencia. */
const DEPOSITO = db.prepare("select id from lojas where eh_deposito = 1 order by id limit 1").get()?.id;
const transferenciaAbertura = DEPOSITO
  ? dividirEstoque(db, {
      origemId: LOJA,
      destinoId: DEPOSITO,
      percentualMovido: 0.6,
      loteMax: 15,
      usuarioId: U_ADMIN,
      usuarioNome: "Administrador",
      observacao: "Transferencia de abertura do galpao",
    })
  : null;
sincronizarSequenciaTransferencia(db);

/* ---------------- 11. SEQUENCIAIS ----------------
   As numeracoes acima foram gravadas direto no banco: aqui a tabela
   `sequencias` e alinhada com o maior numero existente, senao a proxima
   venda/compra tentaria usar um numero ja usado.                              */
for (const [nome, prefixo, tabela] of [["venda", "V", "vendas"], ["compra", "CMP-", "compras"], ["devolucao", "D", "devolucoes"]]) {
  const { m } = db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(numero, ${prefixo.length + 1}) AS INTEGER)), 0) m FROM ${tabela}`).get();
  db.prepare(`INSERT INTO sequencias(nome, ultimo) VALUES (?, ?)
    ON CONFLICT(nome) DO UPDATE SET ultimo = MAX(sequencias.ultimo, excluded.ultimo)`).run(nome, m);
}

/* ---------------- 12. AUDITORIA ---------------- */
db.prepare(`INSERT INTO auditoria(usuario_id,usuario_nome,acao,entidade,detalhe,criado_em) VALUES (?,?,'carga_inicial','sistema',?,datetime('now','localtime'))`)
  .run(U_ADMIN, "Administrador", "Carga inicial de dados de demonstracao");

const totalSkus = db.prepare("select count(*) n from variacoes").get().n;
const totalEstoque = db.prepare("select COALESCE(SUM(quantidade),0) s from estoque").get().s;
const totalVendas = db.prepare("select count(*) n from vendas").get().n;
const porLocal = db.prepare(`select l.nome, l.eh_deposito, COALESCE(SUM(e.quantidade),0) pecas
  from lojas l left join estoque e on e.loja_id = l.id group by l.id order by l.eh_deposito`).all();
const resumoEstoques = porLocal.map((l) => `  ${l.eh_deposito ? "Galpao" : "Loja  "} ${l.nome} ....: ${l.pecas} pecas`).join("\n");
console.log(`
============================================================
 BANCO CRIADO COM SUCESSO
============================================================
 Produtos (pai) ....: ${catalogo.length}
 Variacoes / SKUs ...: ${totalSkus}
 Pecas em estoque ...: ${totalEstoque}
${resumoEstoques}
 Transferencias .....: ${transferenciaAbertura ? transferenciaAbertura.documentos + " documento(s), " + transferenciaAbertura.pecas + " pecas movidas" : "nenhuma"}
 Vendas registradas .: ${totalVendas}
 Clientes ...........: ${clientes.length}
 Fornecedores .......: ${forns.length}
 Arquivo ............: ${dbPath}
------------------------------------------------------------
 ACESSO AO SISTEMA
   Admin ...: admin@banhodeencanto.com.br  / encanto123
   Caixa ...: caixa@banhodeencanto.com.br  / encanto123
   PIN caixa: 1234
============================================================`);
db.close();
