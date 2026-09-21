-- ============================================================================
-- BANHO DE ENCANTO - Cabelos Sinteticos
-- Sistema de Gestao + PDV  |  Schema relacional (SQLite / node:sqlite)
--
-- Arquitetura de dados (nao e uma tabela gigante de produtos):
--   PRODUTO -> VARIACOES/SKUs -> ESTOQUE -> PRECOS -> FORNECEDORES -> MOVIMENTACOES
--   + tabelas auxiliares: marcas, categorias, cores, texturas, comprimentos,
--     fornecedores, unidades/lojas
--
-- Regra de ouro: campos de GESTAO (margem, markup, curva ABC, giro,
-- dias sem venda, estoque em R$, receita/lucro acumulado) NUNCA sao digitados.
-- Sao calculados pelo sistema (colunas geradas ou views).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ============================================================================
-- 0. AUXILIARES GERAIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS configuracoes (
  chave         TEXT PRIMARY KEY,
  valor         TEXT,
  descricao     TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sequencias (
  nome    TEXT PRIMARY KEY,       -- 'venda', 'compra', 'orcamento'
  loja_id INTEGER,
  ultimo  INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- 1. UNIDADES / LOJAS / USUARIOS
-- (estoque por unidade desde a V1 -> replicar o modelo nao exige reconstruir)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lojas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  apelido       TEXT,                      -- nome reduzido p/ cabecalho do cupom
  razao_social  TEXT,
  cnpj          TEXT,
  inscricao_est  TEXT,
  endereco      TEXT,
  cidade        TEXT,
  uf            TEXT,
  cep           TEXT,
  telefone      TEXT,
  email         TEXT,
  eh_deposito   INTEGER NOT NULL DEFAULT 0 CHECK (eh_deposito IN (0,1)),
  padrao        INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
  ativa         INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  apelido     TEXT,                        -- como aparece no PDV / comissao
  email       TEXT UNIQUE,
  senha_hash  TEXT,                        -- scrypt: salt:hash
  pin         TEXT,                        -- PIN rapido p/ caixa (4-6 digitos)
  papel       TEXT NOT NULL DEFAULT 'operador'
              CHECK (papel IN ('admin','gerente','operador','vendedor')),
  comissao_pct REAL NOT NULL DEFAULT 0,    -- % de comissao padrao
  telefone    TEXT,
  loja_id     INTEGER REFERENCES lojas(id),
  ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ultimo_acesso TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================================
-- 2. TABELAS AUXILIARES DO CADASTRO (alimentam filtros, relatorios e o site)
-- ============================================================================

CREATE TABLE IF NOT EXISTS marcas (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome   TEXT NOT NULL UNIQUE,
  site   TEXT,
  logo   TEXT,
  ativo  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS categorias (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nome     TEXT NOT NULL,
  pai_id   INTEGER REFERENCES categorias(id),   -- subcategoria = filho
  slug     TEXT,
  ordem    INTEGER NOT NULL DEFAULT 0,
  ativo    INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (nome, pai_id)
);

CREATE TABLE IF NOT EXISTS linhas_colecao (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  marca_id  INTEGER REFERENCES marcas(id),
  descricao TEXT,
  ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS cores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL,          -- "Preto", "Castanho Escuro"
  codigo       TEXT,                   -- "1", "1B", "613" (codigo de mercado)
  familia      TEXT,                   -- preto / castanho / loiro / ruivo / colorido / acinzentado
  hex          TEXT,                   -- cor para exibir como bolinha no PDV
  ordem        INTEGER NOT NULL DEFAULT 0,
  ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (nome, codigo)
);

CREATE TABLE IF NOT EXISTS texturas (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- liso, ondulado, cacheado, crespo, jumbo...
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS comprimentos (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  valor    REAL NOT NULL,
  unidade  TEXT NOT NULL DEFAULT 'cm' CHECK (unidade IN ('cm','pol','m')),
  rotulo   TEXT,                        -- "60 cm" | "24 pol"
  ordem    INTEGER NOT NULL DEFAULT 0,
  ativo    INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (valor, unidade)
);

CREATE TABLE IF NOT EXISTS tipos_produto (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- Cabelo / Acessorio / Cosmetico / Ferramenta
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS materiais (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- Organico, Sintetico, Humano, Misto, Fibra natural
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS tipos_fibra (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- Kanekalon, Toyokalon, Modacrylic, PP, Fibra premium
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS tecnicas (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- Tranca, Crochet, Entrelace, Mega Hair, Box Braids
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS publicos (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,          -- Adulto, Infantil, Profissional
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE IF NOT EXISTS unidades_medida (
  sigla TEXT PRIMARY KEY,              -- UN, PCT, CX, KG, MT, PAR
  nome  TEXT NOT NULL
);

-- ============================================================================
-- 3. FORNECEDORES  (nao e campo de texto: e entidade com relacao N:N)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fornecedores (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  razao_social        TEXT NOT NULL,
  nome_fantasia       TEXT,
  cnpj                TEXT,
  inscricao_est       TEXT,
  contato             TEXT,             -- pessoa de contato
  telefone            TEXT,
  whatsapp            TEXT,
  email               TEXT,
  site                TEXT,
  endereco            TEXT,
  cidade              TEXT,
  uf                  TEXT,
  cep                 TEXT,
  prazo_medio_entrega INTEGER,          -- dias
  condicao_pagamento  TEXT,
  observacoes         TEXT,
  ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================================
-- 4. PRODUTO (PAI)  -- identificacao, classificacao de cabelos, fiscal, site
-- ============================================================================

CREATE TABLE IF NOT EXISTS produtos (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  -- --- 1. Identificacao -------------------------------------------------
  sku                   TEXT UNIQUE,            -- SKU do pai (ex: BDE-JUB)
  ean                   TEXT,                   -- EAN/GTIN do pai, quando existir
  nome                  TEXT NOT NULL,
  nome_reduzido         TEXT,                   -- aparece no cupom e na etiqueta
  marca_id              INTEGER REFERENCES marcas(id),
  linha_id              INTEGER REFERENCES linhas_colecao(id),
  categoria_id          INTEGER REFERENCES categorias(id),
  subcategoria_id       INTEGER REFERENCES categorias(id),
  status                TEXT NOT NULL DEFAULT 'ativo'
                        CHECK (status IN ('ativo','inativo','descontinuado')),
  criado_em             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now','localtime')),

  -- --- 2. Classificacao especifica de cabelos ---------------------------
  tipo_produto_id       INTEGER REFERENCES tipos_produto(id),
  material_id           INTEGER REFERENCES materiais(id),
  tipo_fibra_id         INTEGER REFERENCES tipos_fibra(id),
  modelo_estilo         TEXT,                   -- "Jumbo Ultra Braid"
  textura_id            INTEGER REFERENCES texturas(id),
  tecnica_id            INTEGER REFERENCES tecnicas(id),
  publico_id            INTEGER REFERENCES publicos(id),
  observacoes_tecnicas  TEXT,
  -- atributos que geram variacao (padrao herdado pelas variacoes)
  cor_id                INTEGER REFERENCES cores(id),
  comprimento_id        INTEGER REFERENCES comprimentos(id),

  -- --- 7. Fiscal (preparado; emissao de nota fica para a 2a etapa) ------
  ncm                   TEXT,
  cest                  TEXT,
  origem_mercadoria     TEXT DEFAULT '0',       -- tabela de origem da mercadoria
  unidade_comercial     TEXT DEFAULT 'UN',
  classificacao_fiscal  TEXT,
  tributacao            TEXT,                   -- CST/CSOSN / regra tributaria
  observacao_fiscal     TEXT,

  -- --- 8. E-commerce e catalogo ----------------------------------------
  nome_site             TEXT,
  descricao_curta       TEXT,
  descricao_completa    TEXT,
  caracteristicas       TEXT,
  modo_uso              TEXT,
  cuidados              TEXT,
  foto_principal        TEXT,
  galeria               TEXT,                   -- JSON: ["/uploads/a.jpg", ...]
  video                 TEXT,
  tags                  TEXT,                   -- palavras-chave separadas por virgula
  destaque              INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0,1)),
  exibir_site           INTEGER NOT NULL DEFAULT 1 CHECK (exibir_site IN (0,1)),
  ordem_exibicao        INTEGER NOT NULL DEFAULT 0,
  slug                  TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS ix_produtos_nome     ON produtos(nome);
CREATE INDEX IF NOT EXISTS ix_produtos_marca    ON produtos(marca_id);
CREATE INDEX IF NOT EXISTS ix_produtos_cat      ON produtos(categoria_id);
CREATE INDEX IF NOT EXISTS ix_produtos_status   ON produtos(status);

-- ============================================================================
-- 5. VARIACOES / SKUs  (o que realmente tem estoque, custo e preco)
-- ============================================================================

CREATE TABLE IF NOT EXISTS variacoes (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id               INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,

  -- identificacao da variacao
  sku                      TEXT UNIQUE,
  ean                      TEXT UNIQUE,
  codigo_interno           TEXT,             -- etiqueta interna (COD-000123)
  codigo_barras_adicional  TEXT,

  -- atributos que diferenciam esta variacao
  cor_id                   INTEGER REFERENCES cores(id),
  cor_codigo_fabricante    TEXT,             -- "1B"
  cor_nome_comercial       TEXT,             -- "Preto Natural 1B"
  comprimento_valor        REAL,
  comprimento_unidade      TEXT DEFAULT 'cm' CHECK (comprimento_unidade IN ('cm','pol','m')),
  peso_pacote              REAL,             -- gramas
  quantidade_por_pacote    REAL,
  quantidade_recomendada   REAL,             -- pacotes p/ um penteado / cabeca
  publico_id               INTEGER REFERENCES publicos(id),
  observacoes              TEXT,

  -- --- 4. Comercial e precos -------------------------------------------
  custo_aquisicao          REAL NOT NULL DEFAULT 0,
  custo_medio              REAL NOT NULL DEFAULT 0,     -- recalculado pelas entradas
  ultimo_custo             REAL NOT NULL DEFAULT 0,
  preco_venda              REAL NOT NULL DEFAULT 0,
  preco_promocional        REAL,
  preco_minimo_autorizado  REAL,
  data_ultima_alteracao_preco TEXT,
  -- margem/markup calculados pelo banco, nunca digitados
  margem_valor             REAL GENERATED ALWAYS AS (preco_venda - custo_medio) VIRTUAL,
  margem_percentual        REAL GENERATED ALWAYS AS
                             (CASE WHEN preco_venda > 0
                                   THEN (preco_venda - custo_medio) * 100.0 / preco_venda
                                   ELSE NULL END) VIRTUAL,
  markup                   REAL GENERATED ALWAYS AS
                             (CASE WHEN custo_medio > 0
                                   THEN preco_venda / custo_medio
                                   ELSE NULL END) VIRTUAL,

  -- --- 5. Estoque (parametros) -----------------------------------------
  estoque_min              REAL NOT NULL DEFAULT 0,
  estoque_max              REAL NOT NULL DEFAULT 0,
  ponto_reposicao          REAL NOT NULL DEFAULT 0,
  unidade_estoque          TEXT NOT NULL DEFAULT 'UN',
  localizacao              TEXT,             -- "Parede A"
  corredor                 TEXT,
  prateleira               TEXT,
  posicao                  TEXT,
  permite_estoque_negativo INTEGER NOT NULL DEFAULT 0 CHECK (permite_estoque_negativo IN (0,1)),
  controle_lote            INTEGER NOT NULL DEFAULT 0 CHECK (controle_lote IN (0,1)),

  -- fiscal herdado (override opcional do pai)
  ncm                      TEXT,
  peso_bruto               REAL,

  status                   TEXT NOT NULL DEFAULT 'ativo'
                           CHECK (status IN ('ativo','inativo','descontinuado')),
  criado_em                TEXT NOT NULL DEFAULT (datetime('now','localtime')),

  UNIQUE (produto_id, cor_id, comprimento_valor, comprimento_unidade)
);

CREATE INDEX IF NOT EXISTS ix_var_produto ON variacoes(produto_id);
CREATE INDEX IF NOT EXISTS ix_var_cor     ON variacoes(cor_id);
CREATE INDEX IF NOT EXISTS ix_var_ean     ON variacoes(ean);

-- atributos extras da variacao (chave/valor) -> cobre campos futuros sem migration
CREATE TABLE IF NOT EXISTS variacao_atributos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id  INTEGER NOT NULL REFERENCES variacoes(id) ON DELETE CASCADE,
  atributo     TEXT NOT NULL,
  valor        TEXT,
  UNIQUE (variacao_id, atributo)
);

-- ============================================================================
-- 5b. HISTORICO DE PRECOS  (toda alteracao de preco fica registrada)
-- ============================================================================

CREATE TABLE IF NOT EXISTS precos_historico (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id    INTEGER NOT NULL REFERENCES variacoes(id) ON DELETE CASCADE,
  preco_anterior REAL,
  preco_novo     REAL,
  usuario_id     INTEGER REFERENCES usuarios(id),
  usuario_nome   TEXT,
  motivo         TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_preco_var ON precos_historico(variacao_id);

-- ============================================================================
-- 6. FORNECEDOR x PRODUTO  (quem vende, por quanto, em que condicao)
-- ============================================================================

CREATE TABLE IF NOT EXISTS produto_fornecedor (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id           INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  variacao_id          INTEGER REFERENCES variacoes(id) ON DELETE CASCADE, -- NULL = vale p/ o produto
  fornecedor_id        INTEGER NOT NULL REFERENCES fornecedores(id),
  codigo_fornecedor    TEXT,           -- codigo/ref do produto no fornecedor
  referencia_fabricante TEXT,
  custo                REAL,
  qtd_minima_compra    REAL,
  multiplo_compra      REAL,
  prazo_entrega_dias   INTEGER,
  ultima_compra        TEXT,
  ultimo_custo_compra  REAL,
  principal            INTEGER NOT NULL DEFAULT 0 CHECK (principal IN (0,1)),
  observacoes          TEXT,
  criado_em            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_prodforn_produto    ON produto_fornecedor(produto_id);
CREATE INDEX IF NOT EXISTS ix_prodforn_fornecedor ON produto_fornecedor(fornecedor_id);

-- ============================================================================
-- 7. ESTOQUE  (por variacao x loja/deposito)
-- ============================================================================

CREATE TABLE IF NOT EXISTS estoque (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id  INTEGER NOT NULL REFERENCES variacoes(id) ON DELETE CASCADE,
  loja_id      INTEGER NOT NULL REFERENCES lojas(id),
  quantidade   REAL NOT NULL DEFAULT 0,
  reservado    REAL NOT NULL DEFAULT 0,
  disponivel   REAL GENERATED ALWAYS AS (quantidade - reservado) VIRTUAL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (variacao_id, loja_id)
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id      INTEGER NOT NULL REFERENCES variacoes(id),
  loja_id          INTEGER NOT NULL REFERENCES lojas(id),
  tipo             TEXT NOT NULL CHECK (tipo IN (
                     'entrada','venda','saida','ajuste','devolucao',
                     'transferencia_saida','transferencia_entrada',
                     'perda','inventario','cancelamento')),
  quantidade       REAL NOT NULL,             -- sempre positivo; o tipo define o sinal
  saldo_anterior   REAL NOT NULL DEFAULT 0,
  saldo_apos       REAL NOT NULL DEFAULT 0,
  custo_unitario   REAL,
  documento        TEXT,                      -- NF, pedido, cupom
  motivo           TEXT,
  referencia_tipo  TEXT,                      -- 'venda','compra','manual','inventario'
  referencia_id    INTEGER,
  usuario_id       INTEGER REFERENCES usuarios(id),
  criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_mov_variacao ON estoque_movimentos(variacao_id);
CREATE INDEX IF NOT EXISTS ix_mov_criado   ON estoque_movimentos(criado_em);
CREATE INDEX IF NOT EXISTS ix_mov_tipo     ON estoque_movimentos(tipo);

CREATE TABLE IF NOT EXISTS lotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  variacao_id INTEGER NOT NULL REFERENCES variacoes(id) ON DELETE CASCADE,
  loja_id     INTEGER REFERENCES lojas(id),
  codigo      TEXT NOT NULL,
  validade    TEXT,
  quantidade  REAL NOT NULL DEFAULT 0,
  custo       REAL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (variacao_id, codigo)
);

-- ============================================================================
-- 8. COMPRAS / ENTRADA DE MERCADORIA
-- ============================================================================

CREATE TABLE IF NOT EXISTS compras (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          TEXT UNIQUE,
  fornecedor_id   INTEGER NOT NULL REFERENCES fornecedores(id),
  loja_id         INTEGER NOT NULL REFERENCES lojas(id),
  data            TEXT NOT NULL DEFAULT (date('now','localtime')),
  documento       TEXT,                        -- numero da NF do fornecedor
  status          TEXT NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','confirmado','cancelado')),
  subtotal        REAL NOT NULL DEFAULT 0,
  frete           REAL NOT NULL DEFAULT 0,
  desconto        REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  observacoes     TEXT,
  usuario_id      INTEGER REFERENCES usuarios(id),
  confirmado_em   TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS compras_itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id      INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  variacao_id    INTEGER NOT NULL REFERENCES variacoes(id),
  quantidade     REAL NOT NULL,
  custo_unitario REAL NOT NULL,
  total          REAL NOT NULL,
  lote           TEXT,
  validade       TEXT
);

-- ============================================================================
-- 9. CLIENTES + FIADO / CREDIARIO
-- ============================================================================

CREATE TABLE IF NOT EXISTS clientes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo          TEXT UNIQUE,
  nome            TEXT NOT NULL,
  apelido         TEXT,
  cpf_cnpj        TEXT,
  telefone        TEXT,
  whatsapp        TEXT,
  email           TEXT,
  nascimento      TEXT,
  endereco        TEXT,
  cidade          TEXT,
  uf              TEXT,
  cep             TEXT,
  limite_credito  REAL NOT NULL DEFAULT 0,
  observacoes     TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fiado_lancamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id),
  venda_id    INTEGER,
  tipo        TEXT NOT NULL CHECK (tipo IN ('compra','pagamento','ajuste','cancelamento')),
  valor       REAL NOT NULL,
  saldo_apos  REAL NOT NULL DEFAULT 0,
  vencimento  TEXT,
  data        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  forma_pagamento_id INTEGER,
  observacoes TEXT,
  usuario_id  INTEGER REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS ix_fiado_cliente ON fiado_lancamentos(cliente_id);

-- ============================================================================
-- 10. CAIXA (abertura, sangria, suprimento, fechamento com conferencia)
-- ============================================================================

CREATE TABLE IF NOT EXISTS caixas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  loja_id             INTEGER NOT NULL REFERENCES lojas(id),
  usuario_id          INTEGER REFERENCES usuarios(id),      -- quem abriu
  fechado_por_id      INTEGER REFERENCES usuarios(id),
  terminal            TEXT,                                  -- "CAIXA 1"
  abertura_em         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  fechamento_em       TEXT,
  valor_abertura      REAL NOT NULL DEFAULT 0,
  valor_fechamento_informado REAL,
  valor_sistema       REAL,
  diferenca           REAL,
  status              TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  observacoes         TEXT
);

CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_id           INTEGER NOT NULL REFERENCES caixas(id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL CHECK (tipo IN
                       ('abertura','sangria','suprimento','venda','recebimento','despesa','estorno')),
  valor              REAL NOT NULL,
  forma_pagamento_id INTEGER REFERENCES formas_pagamento(id),
  descricao          TEXT,
  usuario_id         INTEGER REFERENCES usuarios(id),
  criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================================
-- 11. FORMAS DE PAGAMENTO
-- ============================================================================

CREATE TABLE IF NOT EXISTS formas_pagamento (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT NOT NULL UNIQUE,
  tipo           TEXT NOT NULL DEFAULT 'dinheiro'
                 CHECK (tipo IN ('dinheiro','credito','debito','pix','fiado','transferencia','outro')),
  taxa_pct       REAL NOT NULL DEFAULT 0,
  prazo_dias     INTEGER NOT NULL DEFAULT 0,
  aceita_troco   INTEGER NOT NULL DEFAULT 0 CHECK (aceita_troco IN (0,1)),
  entra_no_caixa INTEGER NOT NULL DEFAULT 1 CHECK (entra_no_caixa IN (0,1)),
  ordem          INTEGER NOT NULL DEFAULT 0,
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- ============================================================================
-- 12. VENDAS (PDV)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vendas (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  numero             TEXT UNIQUE,
  loja_id            INTEGER NOT NULL REFERENCES lojas(id),
  caixa_id           INTEGER REFERENCES caixas(id),
  usuario_id         INTEGER REFERENCES usuarios(id),
  vendedor_id        INTEGER REFERENCES usuarios(id),
  cliente_id         INTEGER REFERENCES clientes(id),
  data               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  subtotal           REAL NOT NULL DEFAULT 0,
  desconto_valor     REAL NOT NULL DEFAULT 0,
  desconto_pct       REAL NOT NULL DEFAULT 0,
  acrescimo          REAL NOT NULL DEFAULT 0,
  frete              REAL NOT NULL DEFAULT 0,
  total              REAL NOT NULL DEFAULT 0,
  custo_total        REAL NOT NULL DEFAULT 0,   -- congelado no momento da venda
  lucro              REAL GENERATED ALWAYS AS (total - custo_total) VIRTUAL,
  status             TEXT NOT NULL DEFAULT 'concluida'
                     CHECK (status IN ('concluida','cancelada','devolvida_parcial','devolvida_total')),
  observacoes        TEXT,
  cancelada_em       TEXT,
  cancelada_por_id   INTEGER REFERENCES usuarios(id),
  motivo_cancelamento TEXT,
  criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_vendas_data   ON vendas(data);
CREATE INDEX IF NOT EXISTS ix_vendas_status ON vendas(status);

CREATE TABLE IF NOT EXISTS vendas_itens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id        INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  variacao_id     INTEGER NOT NULL REFERENCES variacoes(id),
  descricao       TEXT NOT NULL,             -- texto congelado (historico fiel)
  quantidade      REAL NOT NULL,
  preco_unitario  REAL NOT NULL,
  preco_tabela    REAL,                      -- preco cheio, p/ mostrar o desconto
  desconto_valor  REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL,
  custo_unitario  REAL NOT NULL DEFAULT 0,
  comissao_pct    REAL NOT NULL DEFAULT 0,
  devolvido       REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendas_pagamentos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id           INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  forma_pagamento_id INTEGER NOT NULL REFERENCES formas_pagamento(id),
  valor              REAL NOT NULL,
  parcelas           INTEGER NOT NULL DEFAULT 1,
  valor_recebido     REAL,
  troco              REAL,
  autorizacao        TEXT,
  criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS devolucoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT UNIQUE,
  venda_id    INTEGER NOT NULL REFERENCES vendas(id),
  loja_id     INTEGER NOT NULL REFERENCES lojas(id),
  data        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  motivo      TEXT,
  total       REAL NOT NULL DEFAULT 0,
  usuario_id  INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS devolucoes_itens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  devolucao_id  INTEGER NOT NULL REFERENCES devolucoes(id) ON DELETE CASCADE,
  venda_item_id INTEGER NOT NULL REFERENCES vendas_itens(id),
  variacao_id   INTEGER NOT NULL REFERENCES variacoes(id),
  quantidade    REAL NOT NULL,
  valor         REAL NOT NULL,
  destino       TEXT NOT NULL DEFAULT 'estoque' CHECK (destino IN ('estoque','perda'))
);

-- ============================================================================
-- 13. AUDITORIA
-- ============================================================================

CREATE TABLE IF NOT EXISTS auditoria (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER,
  usuario_nome TEXT,
  acao         TEXT NOT NULL,        -- criar / alterar / excluir / vender / cancelar
  entidade     TEXT NOT NULL,
  entidade_id  INTEGER,
  detalhe      TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_auditoria_entidade ON auditoria(entidade, entidade_id);

-- ============================================================================
-- 14. VIEWS  (campos de GESTAO calculados: nada aqui e digitado)
-- ============================================================================

-- Visao unica do SKU: produto + atributos + preco + margem + estoque + metricas
DROP VIEW IF EXISTS vw_variacoes;
CREATE VIEW vw_variacoes AS
SELECT
  v.id                       AS variacao_id,
  v.sku,
  v.ean,
  v.codigo_interno,
  p.id                       AS produto_id,
  p.nome                     AS produto,
  COALESCE(NULLIF(p.nome_reduzido,''), p.nome) AS nome_reduzido,
  p.status                   AS produto_status,
  v.status                   AS variacao_status,
  m.nome                     AS marca,
  lc.nome                    AS linha,
  cat.nome                   AS categoria,
  sub.nome                   AS subcategoria,
  tp.nome                    AS tipo_produto,
  mat.nome                   AS material,
  tf.nome                    AS fibra,
  tx.nome                    AS textura,
  tec.nome                   AS tecnica,
  p.modelo_estilo,
  v.cor_id,
  c.nome                     AS cor,
  c.codigo                   AS cor_codigo,
  c.familia                  AS cor_familia,
  c.hex                      AS cor_hex,
  v.cor_nome_comercial,
  v.cor_codigo_fabricante,
  COALESCE(v.comprimento_valor, cp.valor) AS comprimento,
  COALESCE(v.comprimento_unidade, cp.unidade) AS comprimento_unidade,
  v.peso_pacote,
  v.quantidade_por_pacote,
  v.quantidade_recomendada,
  v.custo_aquisicao,
  v.custo_medio,
  v.ultimo_custo,
  v.preco_venda,
  v.preco_promocional,
  v.preco_minimo_autorizado,
  v.data_ultima_alteracao_preco,
  v.margem_valor,
  v.margem_percentual,
  v.markup,
  v.estoque_min,
  v.estoque_max,
  v.ponto_reposicao,
  v.unidade_estoque,
  v.localizacao,
  v.corredor,
  v.prateleira,
  v.posicao,
  v.permite_estoque_negativo,
  v.controle_lote,
  v.observacoes,
  COALESCE(est.quantidade, 0) AS estoque,
  COALESCE(est.reservado, 0)  AS reservado,
  COALESCE(est.disponivel, 0) AS disponivel,
  (COALESCE(est.quantidade,0) * v.custo_medio) AS estoque_custo,
  (COALESCE(est.quantidade,0) * v.preco_venda) AS estoque_venda,
  p.ncm, p.cest, p.origem_mercadoria, p.unidade_comercial,
  p.exibir_site, p.destaque, p.slug, p.foto_principal
FROM variacoes v
JOIN produtos p            ON p.id  = v.produto_id
LEFT JOIN marcas m         ON m.id  = p.marca_id
LEFT JOIN linhas_colecao lc ON lc.id = p.linha_id
LEFT JOIN categorias cat   ON cat.id = p.categoria_id
LEFT JOIN categorias sub   ON sub.id = p.subcategoria_id
LEFT JOIN tipos_produto tp ON tp.id = p.tipo_produto_id
LEFT JOIN materiais mat    ON mat.id = p.material_id
LEFT JOIN tipos_fibra tf   ON tf.id = p.tipo_fibra_id
LEFT JOIN texturas tx      ON tx.id = p.textura_id
LEFT JOIN tecnicas tec     ON tec.id = p.tecnica_id
LEFT JOIN cores c          ON c.id  = v.cor_id
LEFT JOIN comprimentos cp  ON cp.id = p.comprimento_id
LEFT JOIN estoque est      ON est.variacao_id = v.id;

-- Metricas de gestao por SKU (giro, dias sem venda, receita, lucro, curva ABC)
DROP VIEW IF EXISTS vw_metricas_variacao;
CREATE VIEW vw_metricas_variacao AS
SELECT
  vi.variacao_id,
  MIN(v.data)                                   AS primeira_venda,
  MAX(v.data)                                   AS ultima_venda,
  SUM(vi.quantidade)                            AS quantidade_vendida,
  SUM(vi.total)                                 AS receita_acumulada,
  SUM(vi.total - (vi.quantidade * vi.custo_unitario)) AS lucro_acumulado,
  COUNT(DISTINCT v.id)                          AS num_vendas,
  CASE WHEN MAX(v.data) IS NULL THEN NULL
       ELSE CAST(julianday('now') - julianday(MAX(v.data)) AS INTEGER) END AS dias_sem_venda,
  CASE WHEN SUM(vi.quantidade) > 0
       THEN SUM(vi.total) / SUM(vi.quantidade) END AS preco_medio_praticado
FROM vendas_itens vi
JOIN vendas v ON v.id = vi.venda_id
WHERE v.status <> 'cancelada'
GROUP BY vi.variacao_id;

-- Posicao de estoque consolidada (com alerta de reposicao)
DROP VIEW IF EXISTS vw_estoque_posicao;
CREATE VIEW vw_estoque_posicao AS
SELECT
  vv.*,
  (vv.estoque * vv.custo_medio)      AS valor_custo,
  (vv.estoque * vv.preco_venda)      AS valor_venda,
  CASE
    WHEN vv.disponivel <= 0                 THEN 'sem_estoque'
    WHEN vv.estoque_min > 0 AND vv.disponivel <= vv.estoque_min THEN 'critico'
    WHEN vv.ponto_reposicao > 0 AND vv.disponivel <= vv.ponto_reposicao THEN 'repor'
    WHEN vv.estoque_max > 0 AND vv.disponivel >= vv.estoque_max THEN 'excesso'
    ELSE 'ok'
  END                                 AS situacao_estoque
FROM vw_variacoes vv;
