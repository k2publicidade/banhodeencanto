# Publicar na Vercel com Supabase

O aplicativo usa PostgreSQL nas requisicoes e um schema proprio, `banho_encanto`,
separado das outras tabelas do mesmo projeto Supabase. O arquivo SQLite em `data/`
serve somente como origem para uma migracao unica; ele nao e lido pela Vercel.

## Configurar o banco

No projeto Supabase, em **Connect > Direct > Transaction pooler**, copie a URI de
conexao da porta `6543`. Substitua `[YOUR-PASSWORD]` pela senha do banco com
caracteres reservados codificados para URL. Nao use a chave `anon`/publishable:
o sistema precisa de acesso PostgreSQL no servidor. Nunca use `NEXT_PUBLIC_` para
esta URI.

Com `DATABASE_URL` configurada apenas no terminal local ou em um gerenciador de
segredos, migre o banco atual:

```bash
npm ci
npm run db:migrar -- --confirmar
```

Neste projeto Supabase especifico, no PowerShell e possivel fazer a migracao e
configurar a Vercel sem mostrar nem salvar a senha de banco:

```powershell
./scripts/configurar-banco-vercel.ps1
```

O comando aplica `lib/schema-postgres.sql`, recusa destino com usuarios ou produtos,
e copia as tabelas dentro de uma transacao. Preserva os IDs e avanca as sequencias.
As contas que ainda usam a senha de demonstracao recebem senhas aleatorias; o
acesso do administrador fica em `data/acesso-inicial.txt`, ignorado pelo Git.
Mude a senha e o PIN em `/configuracoes/usuarios` apos entrar. O arquivo SQLite
original permanece intacto.

Para iniciar um banco vazio, execute `lib/schema-postgres.sql` no SQL Editor do
Supabase e crie um administrador antes de publicar. O script de migracao acima e
o caminho indicado para aproveitar os dados existentes.

## Variaveis na Vercel

No projeto `banhodeencanto`, configure em **Settings > Environment Variables**:

| Variavel | Valor |
|---|---|
| `DATABASE_URL` | URI do Transaction pooler do Supabase (`:6543`), privada |
| `BDE_SECRET` | String aleatoria de pelo menos 32 caracteres, privada |

Use as mesmas variaveis em Production e Preview se ambos forem apontar para o
mesmo banco; para testar alteracoes com isolamento, crie outro banco para Preview.
O segredo de sessao deve ser estavel entre deploys. Gerar um valor novo:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

O codigo usa `pg` com pool de uma conexao por instancia e
`attachDatabasePool` da Vercel. Cada transacao conserva a mesma conexao; as
escritas de caixa, venda, estoque e fiado sao serializadas no PostgreSQL.
O schema `banho_encanto` nao e publicado pela Data API padrao do Supabase.

## Deploy e verificacao

**Antes de publicar codigo que usa tabelas/views novas** (como as de estoque
separado: `transferencias`, `vw_estoques`, `vw_estoque_loja`), aplique o schema em
producao - senao as telas quebram com `relation does not exist`:

```powershell
.\scripts\aplicar-estoques-supabase.ps1          # aplica o schema (idempotente)
```

Veja [ESTOQUES.md](ESTOQUES.md) para separar o estoque entre loja e galpao.

Na pasta `sistema`:

```bash
npm run test:tudo
npx vercel link --yes --project banhodeencanto
npx vercel --prod
```

Abra a URL de producao e verifique login, painel, cadastro, venda, devolucao e
exportacao CSV. Sem `DATABASE_URL`, o build passa, mas as paginas dinamicas
mostram erro ao tentar consultar dados. Sem `BDE_SECRET`, o login falha de
forma explicita; nao e gerada uma chave efemera no filesystem da Vercel.

## Desenvolvimento e scripts antigos

Para desenvolvimento local com o mesmo PostgreSQL, defina `DATABASE_URL` e
`BDE_SECRET` no ambiente e rode `npm run dev`. Os scripts antigos
`db:seed`, `db:reset`, `test:rotas`, `test:fluxos` e `apresentar` ainda usam
SQLite e servem apenas para gerar/inspecionar o arquivo de origem. O aplicativo
Next.js executa exclusivamente no PostgreSQL.

Referencia: [conexoes em ambiente serverless do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
