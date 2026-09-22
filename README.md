# Banho de Encanto - Sistema de Gestao e PDV

Sistema de gestao e ponto de venda para loja de cabelos sinteticos: catalogo de
produtos com variacoes (cor, comprimento, textura), estoque, compras, clientes com
fiado (caderneta), PDV de balcao, caixa, devolucoes, cancelamentos, relatorios e
etiquetas com codigo de barras.

Feito em **Next.js 16** (App Router) com **PostgreSQL (Supabase)**. A conexao do
servidor usa `DATABASE_URL`; o antigo SQLite fica apenas como origem da migracao.

A interface e **mobile first**: o layout base e o do celular, com cara de aplicativo
(barras fixas, gaveta de menu, folhas inferiores) e todas as funcoes disponiveis no
telefone. Em telas a partir de 900px o sistema mostra a barra lateral e as tabelas
completas. Tambem pode ser instalado na tela inicial do celular (PWA).

## Requisitos

- Node.js 24 (mesma versao usada no projeto Vercel)
- Banco PostgreSQL com `lib/schema-postgres.sql` aplicado
- `DATABASE_URL` e `BDE_SECRET` no ambiente do servidor

## Como rodar

```bash
npm install
npm run dev
```

Para usar o banco local existente, execute `npm run db:migrar -- --confirmar`
uma vez com `DATABASE_URL` configurada. Acesse http://localhost:3000.

### Acesso inicial

A migracao troca automaticamente todas as senhas de demonstracao. O acesso do
administrador fica em `data/acesso-inicial.txt` (arquivo local ignorado pelo Git).

### Usando no celular

Abra a URL HTTPS publicada na Vercel. No Chrome do Android, use "Adicionar a
tela inicial" para abrir o sistema como aplicativo.

## Publicar (hospedagem)

O projeto funciona na Vercel com PostgreSQL externo. A receita de configuracao,
migracao dos dados e deploy esta em [docs/DEPLOY.md](docs/DEPLOY.md).

## Banco de dados

O arquivo `data/banho.db` **nao vai para o repositorio** (contem dados de clientes,
vendas e fiado da loja). Para transferir os dados uma vez ao Supabase:

```bash
npm run db:migrar -- --confirmar
```

## Verificacao (rodar antes de publicar mudancas)

```bash
npm run test:postgres    # schema + integracao PostgreSQL + fluxos principais do PDV
npm run build            # verificacao de tipos e build de producao
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
