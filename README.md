# Banho de Encanto - Sistema de Gestao e PDV

Sistema de gestao e ponto de venda para loja de cabelos sinteticos: catalogo de
produtos com variacoes (cor, comprimento, textura), estoque, compras, clientes com
fiado (caderneta), PDV de balcao, caixa, devolucoes, cancelamentos, relatorios e
etiquetas com codigo de barras.

Feito em **Next.js 16** (App Router) com **SQLite nativo do Node** (`node:sqlite`) -
nao precisa de servidor de banco: os dados ficam no arquivo `data/banho.db`.

A interface e **mobile first**: o layout base e o do celular, com cara de aplicativo
(barras fixas, gaveta de menu, folhas inferiores) e todas as funcoes disponiveis no
telefone. Em telas a partir de 900px o sistema mostra a barra lateral e as tabelas
completas. Tambem pode ser instalado na tela inicial do celular (PWA).

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

### Usando no celular

O servidor roda na maquina da loja; o celular acessa pelo IP dessa maquina na rede
(ex.: `http://192.168.0.10:3000`). No Chrome do Android use "Adicionar a tela inicial"
e o sistema abre em tela cheia, como um aplicativo - o atalho ja abre o PDV.

## Publicar (hospedagem)

O banco e um arquivo SQLite, entao o sistema precisa de um lugar com disco (VPS com
Docker, ou o proprio PC da loja). **Na Vercel nao funciona**: o ambiente serverless nao
tem disco gravavel e a primeira consulta ao banco derruba a pagina.

Passo a passo das duas opcoes (com HTTPS e backup) em
[docs/DEPLOY.md](docs/DEPLOY.md). O caminho do banco e definido por variavel de
ambiente, o que permite apontar para um volume:

```bash
BDE_DB_PATH=/dados/banho.db BDE_SECRET=<chave> npm start
```

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
npm run test:mobile      # fluxos principais num Chrome com tela de celular
npm run auditar:ui       # varre todas as telas procurando quebra de layout no celular
npm run test:tudo        # validar:schema + validar:sql + test:rotas
```

Os testes de interface precisam do Chrome instalado. Instale as ferramentas sob
demanda (nao entram no `package.json`):

```bash
npm i --no-save puppeteer-core sharp
```

Detalhes das armadilhas do ambiente de teste (IDs das server actions, leitura da
resposta flight) e das convencoes de interface estao em
[docs/VERIFICACAO.md](docs/VERIFICACAO.md).

## Funcionalidades

- **PDV de balcao**: leitura por codigo de barras, busca por nome, venda em varias
  formas de pagamento, troco, desconto com autorizacao de supervisor por PIN,
  venda no fiado e impressao de cupom. No celular o carrinho vira lista de cartoes
  com passo de quantidade, e o pagamento abre em folha inferior.
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
app/            telas (App Router), server actions e manifest do app instalavel
  caixa/        PDV de balcao
  (sistema)/    painel, produtos, estoque, compras, clientes, vendas, relatorios...
  actions/      server actions por area (pdv.ts, estoque.ts, produtos.ts, cadastros.ts)
components/     interface compartilhada (ui.tsx, NavegacaoMobile, Sidebar, menu.ts)
lib/            schema.sql, conexao e helpers do banco, auth, formatacao, codigo de barras
scripts/        carga de dados, validacoes, testes e geracao de assets
docs/           notas de verificacao
```
