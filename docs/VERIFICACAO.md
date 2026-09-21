# Verificacao do sistema (Banho de Encanto)

Notas para quem for continuar o projeto: como conferir se o sistema esta saudavel e
duas armadilhas do ambiente de teste que ja custaram tempo.

## Comandos

```
npm run dev            # dev server (porta 3000)
npm run build          # build de producao (roda o TypeScript)
npm run db:reset       # recria o banco
npm run db:seed        # dados de demonstracao (90 dias de movimento)
npm run db:sequencias  # alinha a tabela `sequencias` com os numeros ja gravados

npm run validar:schema # DDL aplica e e idempotente; colunas/views conferidas
npm run validar:sql    # analisa as consultas SQL escritas no codigo
npm run test:rotas     # 50 checagens HTTP: telas, permissoes, CSV, cookie adulterado
npm run test:fluxos    # 17 passos de regra de negocio (venda, fiado, desconto,
                       # sangria, devolucao, cancelamento, fechamento de caixa)
npm run test:tudo      # validar:schema + validar:sql + test:rotas
```

`test:fluxos` copia o banco para `data/teste-fluxos.db` e sobe um dev server proprio
(as regras sao exercitadas pelas MESMAS server actions que a tela usa; ao terminar ele
devolve o dev server normal no ar).

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
(o mesmo sintoma parece um bug de regra de negocio: `abrirCaixa nao retornou ok`).

Use `scripts/_flight.mjs`: ele monta as linhas da resposta, segue a referencia
`"a":"$@1"` da linha 0 e devolve o valor da action.

## Numeracao (vendas, compras, devolucoes)

`proximoNumero(nome, prefixo, largura, tabela)` em `lib/db.ts` alinha a sequencia com o
maior numero ja gravado e so devolve um numero livre. Um banco semeado (ou importado)
sem a tabela `sequencias` nao quebra mais com
`UNIQUE constraint failed: vendas.numero`.
