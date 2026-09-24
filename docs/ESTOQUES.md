# Estoques separados (galpao x loja) - Banho de Encanto

Como o sistema controla mais de um estoque, o que conversa entre eles e o que
nao pode regredir.

## O modelo (ja preparado desde a V1, agora usado de verdade)

- **Local de estoque = `lojas`**: cada linha e um local fisico com
  `eh_deposito` (0 = loja que vende, 1 = galpao/deposito) e `padrao`
  (1 = o estoque que abastece o PDV quando nenhum caixa esta aberto).
- **Saldo = `estoque(variacao_id, loja_id)`**: o mesmo SKU tem saldo proprio em
  cada local. Um SKU pode ter 200 no galpao e 12 na loja; nada se mistura.
- **Conversa entre eles = `transferencias` + `transferencias_itens`**: documento
  numerado (`TRF-00001`), origem, destino, itens, pecas, valor a custo, autor e
  data. Cada transferencia grava dois movimentos por item em
  `estoque_movimentos` (`transferencia_saida` na origem e
  `transferencia_entrada` no destino) com `referencia_tipo='transferencia'`.

## Views (a parte que mais importa)

| View | Para que serve |
| --- | --- |
| `vw_variacoes` | SKU **consolidado** (soma todos os locais). O `LEFT JOIN` e **agregado por variacao**: sem isso cada SKU apareceria uma vez por local e todo total do sistema dobraria. |
| `vw_estoque_posicao` | Posicao consolidada com alerta de reposicao. |
| `vw_estoque_loja` | Posicao **por local** (variacao x loja): base das telas de estoque separado, da transferencia e do PDV. |
| `vw_estoques` | Cadastro dos locais com resumo de cada um (SKUs, pecas, valor a custo/venda, transferencias). |
| `vw_transferencias` | Historico das transferencias com nomes de origem/destino e autor. |

Regra de ouro: **consolidado** usa `vw_variacoes`/`vw_estoque_posicao`;
**de um local** usa `vw_estoque_loja`. Nunca juntar `estoque` direto numa view de
SKU sem agregar.

## Telas

- `/estoque` - cartoes de cada estoque (pecas, valor, tipo), filtro por local ou
  consolidado, colunas de saldo por local, movimentacao manual e ultimas
  movimentacoes.
- `/estoque/transferencia` - nova transferencia com varios SKUs, saldo da origem
  por item, sugestao de reposicao ("a loja precisa, o galpao tem"), historico com
  os itens de cada documento e cancelamento (admin/gerente).
- `/estoque/movimentos` - historico completo com filtro por estoque, tipo, texto
  e periodo + exportacao CSV.
- `/configuracoes/lojas` ("Estoques e locais") - criar/editar local (tipo loja ou
  galpao), definir qual vende no PDV, ativar/desativar.
- `/produtos/[id]?aba=estoque` e `/produtos/[id]/variacao/[vid]` - saldo por
  estoque de cada SKU.
- `/api/exportar/estoque` - CSV com uma coluna `saldo_<local>` por estoque.

## PDV

- O caixa abre **em um estoque** (`caixas.loja_id`); galpao/deposito nao abre
  caixa.
- A busca do PDV usa `vw_estoque_loja` do estoque do caixa, entao o operador ve o
  saldo do local - nao o total.
- `finalizarVenda` valida e baixa do **estoque do caixa**; vender mais do que
  existe no local e bloqueado com a mensagem dizendo em qual estoque falta, mesmo
  que ainda sobre no galpao.
- Sem caixa aberto, o sistema usa o estoque marcado como `padrao` (o que vende).

## Regras que o teste garante

`npm run test:estoques` cobre: transferencia move as duas pontas e cria o
documento; saldo insuficiente bloqueia sem mudar nada; origem = destino recusada;
galpao nao abre caixa; venda baixa so do estoque do caixa; venda acima do saldo
local bloqueada mesmo com saldo no galpao; cancelar estorna as duas pontas
(liquido zero por SKU); cancelar bloqueado quando o destino ja consumiu; telas
respondem; CSV tem uma coluna por estoque; o `estoque:dividir:pg` aplica o schema
e divide o estoque preservando o total de pecas.

## Numeracao

`proximoNumero(nome, prefixo, largura, tabela)` em `lib/db.ts` aceita
`transferencias` na lista de tabelas permitidas (`TRF-`). Scripts que gravam
transferencia direto no banco (seed e `estoque:dividir`) alinham a sequencia com
`sincronizarSequenciaTransferencia`.

## Dividir um estoque que ja existe

Quando o cliente passa a separar galpao e loja e todo o saldo esta num local so:

```
npm run estoque:dividir                    # simulacao (nao grava)
npm run estoque:dividir -- --confirmar     # 60% de cada SKU vai para o galpao
npm run estoque:dividir -- --confirmar --percentual=70
npm run estoque:dividir -- --confirmar --banco=data/apresentacao.db
```

O script aplica o schema (sem apagar nada), cria o galpao se nao existir, faz
backup do banco antes de escrever, grava transferencias de verdade e no final
confere que o total de pecas continua o mesmo. A origem nunca fica zerada e SKUs
ja criticos sao preservados para a tela de reposicao continuar fazendo sentido.

### No producao (Supabase/PostgreSQL)

O mesmo trabalho, falando direto com o PostgreSQL - e ja aplicando o schema novo
(tabelas/views) de forma idempotente:

```
DATABASE_URL="postgresql://..." npm run estoque:dividir:pg                  # simulacao
DATABASE_URL="postgresql://..." npm run estoque:dividir:pg -- --so-schema   # so aplica o DDL
DATABASE_URL="postgresql://..." npm run estoque:dividir:pg -- --confirmar   # divide 60/40
```

Ordem recomendada no deploy: `--so-schema` (ou `--confirmar`, que aplica junto)
**antes** de publicar o codigo novo - as telas usam as tabelas `transferencias`
e as views `vw_estoques`/`vw_estoque_loja`.
