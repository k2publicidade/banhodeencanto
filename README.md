# Banho de Encanto - Sistema de Gestao e PDV

Sistema de gestao e ponto de venda para loja de cabelos sinteticos: catalogo de
produtos com variacoes (cor, comprimento, textura), estoque, compras, clientes com
fiado (caderneta), PDV de balcao, caixa, devolucoes, cancelamentos, relatorios e
etiquetas com codigo de barras.

Feito em **Next.js 16** (App Router) com **SQLite nativo do Node** (`node:sqlite`) -
nao precisa de servidor de banco: os dados ficam no arquivo `data/banho.db`.

## Requisitos

- Node.js 22.13 ou superior (o projeto usa o modulo `node:sqlite`)

## Como rodar

```bash
npm install
npm run dev
```

Na primeira execucao o banco e criado automaticamente (a partir de `lib/schema.sql`).
Acesse http://localhost:3000

### Acessos de demonstracao

| Perfil | Login | Senha |
|---|---|---|
| Administrador | admin@banhodeencanto.com.br | encanto123 |
| Operador de caixa | caixa@banhodeencanto.com.br | encanto123 |

PIN do operador de caixa: **1234**

## Banco de dados

O arquivo `data/banho.db` **nao vai para o repositorio** (contem dados de clientes,
vendas e fiado da loja). Para criar um banco novo:

```bash
npm run db:reset -- --confirmar   # apaga o banco atual e recria vazio
npm run db:seed                   # carga de demonstracao (90 dias de movimento)
npm run db:sequencias             # alinha a numeracao de venda/compra com o banco
```

## Verificacao (rodar antes de publicar mudancas)

```bash
npm run validar:schema   # o schema aplica e e idempotente
npm run validar:sql      # confere as consultas SQL escritas no codigo
npm run test:rotas       # checagens HTTP em todas as telas, permissoes e exportacoes
npm run test:fluxos      # regras de negocio de ponta a ponta no PDV
npm run test:tudo        # validar:schema + validar:sql + test:rotas
```

Detalhes das duas armadilhas do ambiente de teste (IDs das server actions e leitura
da resposta flight) estao em [docs/VERIFICACAO.md](docs/VERIFICACAO.md).

## Funcionalidades

- **PDV de balcao**: leitura por codigo de barras, busca por nome, venda em varias
  formas de pagamento, troco, desconto com autorizacao de supervisor por PIN,
  venda no fiado e impressao de cupom.
- **Caixa**: abertura com fundo, sangria, suprimento, despesa, fechamento com
  conferencia de dinheiro e diferenca.
- **Vendas**: detalhe da venda, devolucao parcial ou total (volta ao estoque ou
  vira perda) e cancelamento com estorno de estoque, caixa e fiado.
- **Cadastros**: produtos com variacoes, precos e margens, fornecedores, clientes,
  usuarios, lojas e tabelas auxiliares (marcas, cores, categorias...).
- **Estoque**: posicao por variacao, entradas, transferencias entre lojas, perdas,
  sugestao de compra e curva ABC.
- **Relatorios**: vendas por periodo, curva ABC, margem, fiado em aberto e
  exportacao em CSV.
- **Rastreabilidade**: toda operacao relevante e gravada em `auditoria`.

## Estrutura

```
app/            telas (App Router) e server actions
  caixa/        PDV de balcao
  (sistema)/    painel, produtos, estoque, compras, clientes, vendas, relatorios...
  actions/      server actions por area (pdv.ts, estoque.ts, produtos.ts, cadastros.ts)
components/     componentes de interface
lib/            schema.sql, conexao e helpers do banco, auth, formatacao, codigo de barras
scripts/        carga de dados, validacoes e testes automatizados
docs/           notas de verificacao
```
