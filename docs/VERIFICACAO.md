# Verificacao do sistema (Banho de Encanto)

Notas para quem for continuar o projeto: como conferir se o sistema esta saudavel,
as armadilhas do ambiente de teste e as convencoes da interface mobile.

## Comandos

```
npm run dev              # dev server (porta 3000)
npm run build            # build de producao (roda o TypeScript)
npm run db:reset -- --confirmar   # recria o banco vazio
npm run db:seed          # dados de demonstracao (90 dias de movimento)
npm run db:sequencias    # alinha a tabela `sequencias` com os numeros gravados
npm run assets           # regenera logos leves e icones do app (precisa de sharp)

npm run validar:schema   # DDL aplica e e idempotente; colunas/views conferidas
npm run validar:sql      # analisa as consultas SQL escritas no codigo
npm run test:rotas       # checagens HTTP: telas, permissoes, CSV, cookie adulterado
npm run test:fluxos      # 17 passos de regra de negocio (venda, fiado, desconto,
                         # sangria, devolucao, cancelamento, fechamento de caixa)
npm run test:mobile      # 18 passos no Chrome em viewport de celular
npm run auditar:ui       # auditoria visual/estrutural de todas as telas (celular)
npm run auditar:ui:desktop
npm run test:tudo        # validar:schema + validar:sql + test:rotas
```

`test:fluxos` e `test:mobile` copiam o banco para um arquivo de teste
(`data/teste-fluxos.db`, `data/teste-mobile.db`), sobem servidor proprio e devolvem
o dev server normal ao terminar - a loja nao e afetada.

Os comandos de UI (auditoria e teste mobile) precisam do Chrome instalado e do
puppeteer-core sob demanda:

```
npm i --no-save puppeteer-core sharp
```

## Armadilha 1: descobrir os IDs das server actions

Em desenvolvimento o Next so compila o bundle do navegador quando ele e pedido, e o id
de cada action vive nesse bundle (`createServerReference("<id>", ..., "<nome>")`).
Por isso o teste baixa as paginas E os chunks **via HTTP, do servidor que esta no ar**.

Varrer a pasta `.next` no disco nao serve: ela acumula chunks de execucoes antigas do
`next dev`, e os ids de uma execucao anterior nao valem no servidor atual (o sintoma e
`HTTP 404: Server action not found` em todas as chamadas).

## Armadilha 2: ler a resposta flight

Action que chama `revalidatePath` devolve, na MESMA resposta, o resultado **e** o
re-render da pagina. Ler "a ultima linha que for JSON" devolve a arvore da pagina
(o sintoma parece bug de regra de negocio: `abrirCaixa nao retornou ok`).

Use `scripts/_flight.mjs`: ele monta as linhas da resposta, segue a referencia
`"a":"$@1"` da linha 0 e devolve o valor da action.

## Armadilha 3: testar com 127.0.0.1

Com `http://127.0.0.1:3000` o websocket de HMR do dev server recusa a conexao e a
pagina nao hidrata - os cliques nao fazem nada e parece que a interface esta quebrada.
Nos testes de navegador use sempre `http://localhost:3000`.

## Armadilha 4: elemento coberto pela barra de abas

A barra inferior e fixa. Se o teste clicar num elemento que caiu embaixo dela, o toque
acerta a aba (e o teste acaba navegando para outra tela). Antes de clicar, centralize
o elemento na tela (`scrollIntoView({ block: "center" })`).

## Interface: convencoes mobile first

- Ponto de corte: **900px**. O CSS base e o do celular; as telas grandes ganham regras
  dentro de `@media (min-width: 900px)`. Nunca o contrario.
- Classe `.so-no-mobile` esconde no desktop (com `!important`, para vencer display
  proprio do elemento); `.so-no-desktop` esconde no celular.
- Grades: `.grade` (2 colunas no celular, `--cols` no desktop), `.grade-form` (filtros,
  1 coluna no celular), `.grade-responsiva` (blocos de conteudo lado a lado so no
  desktop), `.linha-campos` (campos de formulario; `--cols-desktop` define as colunas).
- Listagens: `<Tabela>` vira **cartao** no celular automaticamente - ela le os rotulos
  do `<thead>` e injeta `data-rotulo` em cada celula. Nao precisa repetir rotulos a mao;
  use `principal={n}` para escolher qual coluna vira o titulo do cartao e
  `cartoes={false}` para manter a tabela rolavel.
- Toque: alvo minimo de 46px (`.btn`, campos com `min-height`), 16px de fonte nos campos
  (evita o zoom automatico do iOS), `appearance: none` nos selects mas `appearance: auto`
  em checkbox/radio (senao o desenho some).
- Areas seguras: `env(safe-area-inset-*)` nas barras fixas (topo e rodape), `100dvh` no
  lugar de `100vh`, e o conteudo das paginas reserva `padding-bottom` para a barra de abas.
- Modais: use `<Folha>` (folha inferior no celular, janela centralizada no desktop). Ela
  ja trava a rolagem do fundo, fecha com Esc e recebe `aviso` para mostrar erro/sucesso
  por dentro (o aviso flutuante nao aparece com folha aberta).
- App instalavel: `app/manifest.ts` + icones em `public/` (start_url `/caixa`, standalone),
  `viewport-fit=cover` e `appleWebApp` no layout raiz.

## Numeracao (vendas, compras, devolucoes)

`proximoNumero(nome, prefixo, largura, tabela)` em `lib/db.ts` alinha a sequencia com o
maior numero ja gravado e so devolve um numero livre. Um banco semeado (ou importado)
sem a tabela `sequencias` nao quebra mais com
`UNIQUE constraint failed: vendas.numero`.
