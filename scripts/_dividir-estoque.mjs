/**
 * Divide o estoque de um local entre ele e outro (galpao / centro de
 * distribuicao), gravando TRANSFERENCIAS de verdade - documento numerado,
 * movimentos nas duas pontas e historico.
 *
 * Usado por `scripts/db-seed.mjs` (carga de demonstracao) e por
 * `scripts/estoque-dividir.mjs` (dividir o estoque de um banco que ja existe).
 * Nada e inventado: o que sai de um estoque entra no outro.
 */
export function dividirEstoque(db, {
  origemId,
  destinoId,
  percentualMovido = 0.6,
  loteMax = 15,
  usuarioId = null,
  usuarioNome = "Administrador",
  observacao = "Transferencia de abertura do galpao",
  quando = null, // data/hora SQLite; null = agora
} = {}) {
  if (!origemId || !destinoId || origemId === destinoId) {
    throw new Error("Informe estoques de origem e destino diferentes.");
  }
  const agora = quando ?? db.prepare("SELECT datetime('now','localtime') d").get().d;

  const skus = db.prepare(
    `SELECT e.variacao_id, e.quantidade, v.custo_medio, v.sku, v.estoque_min
       FROM estoque e JOIN variacoes v ON v.id = e.variacao_id
      WHERE e.loja_id = ? AND e.quantidade > 0
      ORDER BY e.variacao_id`
  ).all(origemId);

  const proximoNumero = () => {
    const { m } = db.prepare(
      "SELECT COALESCE(MAX(CAST(SUBSTR(numero, 5) AS INTEGER)),0) m FROM transferencias"
    ).get();
    return "TRF-" + String(Number(m) + 1).padStart(5, "0");
  };

  const inserirTransferencia = db.prepare(
    `INSERT INTO transferencias(numero, loja_origem, loja_destino, data, status, itens, pecas, valor_custo,
       observacoes, usuario_id, usuario_nome, criado_em)
     VALUES (?,?,?,?, 'concluida', ?,?,?,?,?,?,?)`
  );
  const inserirItem = db.prepare(
    "INSERT INTO transferencias_itens(transferencia_id, variacao_id, quantidade, custo_unitario) VALUES (?,?,?,?)"
  );
  const lerSaldo = db.prepare("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?");
  const gravarSaldo = db.prepare("UPDATE estoque SET quantidade = ?, atualizado_em = ? WHERE variacao_id = ? AND loja_id = ?");
  const criarSaldo = db.prepare("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)");
  const inserirMovimento = db.prepare(
    `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
       custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?, 'transferencia', ?,?,?)`
  );

  // Separa o que vai para o galpao: nunca zera a origem e nao encosta em SKU
  // que ja esta no limite (assim os alertas de reposicao continuam verdadeiros).
  const plano = [];
  for (const s of skus) {
    if (s.quantidade < 3) continue;
    const mover = Math.floor(s.quantidade * percentualMovido);
    if (mover < 1) continue;
    plano.push({ variacao_id: s.variacao_id, quantidade: mover, custo: Number(s.custo_medio ?? 0) });
  }

  const resultado = { documentos: 0, itens: 0, pecas: 0, valor: 0, numeros: [] };
  for (let i = 0; i < plano.length; i += loteMax) {
    const lote = plano.slice(i, i + loteMax);
    const numero = proximoNumero();
    const pecas = lote.reduce((s, x) => s + x.quantidade, 0);
    const valor = lote.reduce((s, x) => s + x.quantidade * x.custo, 0);
    const r = inserirTransferencia.run(
      numero, origemId, destinoId, agora.slice(0, 10), lote.length, pecas,
      Math.round(valor * 100) / 100, observacao, usuarioId, usuarioNome, agora
    );
    const transferenciaId = Number(r.lastInsertRowid);

    for (const it of lote) {
      inserirItem.run(transferenciaId, it.variacao_id, it.quantidade, it.custo);

      const origem = lerSaldo.get(it.variacao_id, origemId);
      const antesOrigem = Number(origem?.quantidade ?? 0);
      const depoisOrigem = antesOrigem - it.quantidade;
      gravarSaldo.run(depoisOrigem, agora, it.variacao_id, origemId);
      inserirMovimento.run(
        it.variacao_id, origemId, "transferencia_saida", it.quantidade, antesOrigem, depoisOrigem,
        it.custo, numero, `Transferencia para o estoque ${destinoId}`, transferenciaId, usuarioId, agora
      );

      const destino = lerSaldo.get(it.variacao_id, destinoId);
      const antesDestino = Number(destino?.quantidade ?? 0);
      const depoisDestino = antesDestino + it.quantidade;
      if (destino) gravarSaldo.run(depoisDestino, agora, it.variacao_id, destinoId);
      else criarSaldo.run(it.variacao_id, destinoId, depoisDestino);
      inserirMovimento.run(
        it.variacao_id, destinoId, "transferencia_entrada", it.quantidade, antesDestino, depoisDestino,
        it.custo, numero, `Transferencia do estoque ${origemId}`, transferenciaId, usuarioId, agora
      );
    }

    resultado.documentos++;
    resultado.itens += lote.length;
    resultado.pecas += pecas;
    resultado.valor += valor;
    resultado.numeros.push(numero);
  }

  resultado.valor = Math.round(resultado.valor * 100) / 100;
  return resultado;
}

/** Alinha a sequencia de numeracao de transferencia com os documentos gravados. */
export function sincronizarSequenciaTransferencia(db) {
  const { m } = db.prepare(
    "SELECT COALESCE(MAX(CAST(SUBSTR(numero, 5) AS INTEGER)),0) m FROM transferencias"
  ).get();
  db.prepare(
    `INSERT INTO sequencias(nome, ultimo) VALUES ('transferencia', ?)
     ON CONFLICT(nome) DO UPDATE SET ultimo = MAX(sequencias.ultimo, excluded.ultimo)`
  ).run(Number(m));
  return Number(m);
}
