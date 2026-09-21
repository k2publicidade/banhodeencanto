"use server";

import { revalidatePath } from "next/cache";
import { all, one, run, tx, proximoNumero, auditar, config } from "@/lib/db";
import { arred } from "@/lib/format";
import { exigir, sessao, verificarSenha } from "@/lib/auth";

/* ================================================================== */
/* Busca de itens (PDV)                                               */
/* ================================================================== */

export type ItemBusca = {
  variacao_id: number;
  sku: string;
  ean: string | null;
  produto: string;
  nome_reduzido: string;
  marca: string | null;
  cor: string | null;
  cor_codigo: string | null;
  cor_hex: string | null;
  comprimento: number | null;
  comprimento_unidade: string | null;
  preco_venda: number;
  preco_promocional: number | null;
  custo_medio: number;
  estoque: number;
  disponivel: number;
  unidade_estoque: string;
  localizacao: string | null;
  corredor: string | null;
  prateleira: string | null;
  posicao: string | null;
  ean13: string | null;
};

const CAMPOS_ITEM = `
  vv.variacao_id, vv.sku, vv.ean, vv.produto, vv.nome_reduzido, vv.marca,
  vv.cor, vv.cor_codigo, vv.cor_hex, vv.comprimento, vv.comprimento_unidade,
  vv.preco_venda, vv.preco_promocional, vv.custo_medio,
  vv.estoque, vv.disponivel, vv.unidade_estoque,
  vv.localizacao, vv.corredor, vv.prateleira, vv.posicao,
  vv.ean as ean13
`;

/** Busca por nome, SKU, cor, marca, codigo interno ou codigo de barras. */
export async function buscarItens(termo: string, limite = 24): Promise<ItemBusca[]> {
  await exigir();
  const t = String(termo || "").trim();
  if (t.length < 1) return [];

  const soDigitos = t.replace(/\D/g, "");
  const like = "%" + t.replace(/[%_]/g, "") + "%";

  // 1) Casamento exato por codigo (barras / interno / SKU) tem prioridade
  if (soDigitos.length >= 6) {
    const exatos = all<ItemBusca>(
      `SELECT ${CAMPOS_ITEM} FROM vw_variacoes vv
       WHERE vv.ean = ? OR vv.codigo_interno = ? OR vv.sku = ?
       LIMIT ?`,
      soDigitos, t.toUpperCase(), t.toUpperCase(), limite
    );
    if (exatos.length) return exatos;
  }

  // 2) Busca textual
  return all<ItemBusca>(
    `SELECT ${CAMPOS_ITEM} FROM vw_variacoes vv
     WHERE vv.variacao_status = 'ativo'
       AND (vv.produto LIKE ? COLLATE NOCASE
            OR vv.nome_reduzido LIKE ? COLLATE NOCASE
            OR vv.sku LIKE ? COLLATE NOCASE
            OR vv.ean LIKE ?
            OR vv.marca LIKE ? COLLATE NOCASE
            OR vv.cor LIKE ? COLLATE NOCASE
            OR vv.cor_codigo LIKE ?
            OR vv.localizacao LIKE ? COLLATE NOCASE)
     ORDER BY
       CASE WHEN vv.produto LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
       vv.produto, vv.cor_codigo, vv.comprimento
     LIMIT ?`,
    like, like, like, "%" + soDigitos + "%", like, like, like, like, t + "%", limite
  );
}

/** Casamento exato por codigo de barras / codigo interno / SKU (leitor USB). */
export async function buscarPorCodigo(codigo: string): Promise<ItemBusca | null> {
  await exigir();
  const c = String(codigo || "").trim();
  if (!c) return null;
  const r = one<ItemBusca>(
    `SELECT ${CAMPOS_ITEM} FROM vw_variacoes vv
     WHERE vv.ean = ? OR vv.codigo_interno = ? OR vv.sku = ? OR vv.ean = ?
     LIMIT 1`,
    c, c.toUpperCase(), c.toUpperCase(), c.replace(/\D/g, "")
  );
  return r ?? null;
}

export async function buscarClientes(termo: string, limite = 12) {
  await exigir();
  const like = "%" + String(termo || "").trim() + "%";
  return all<{ id: number; nome: string; apelido: string | null; telefone: string | null; cpf_cnpj: string | null; limite_credito: number; saldo_fiado: number }>(
    `SELECT c.id, c.nome, c.apelido, c.telefone, c.cpf_cnpj, c.limite_credito,
            COALESCE((SELECT SUM(CASE WHEN f.tipo='compra' THEN f.valor ELSE -f.valor END)
                      FROM fiado_lancamentos f WHERE f.cliente_id = c.id), 0) AS saldo_fiado
     FROM clientes c
     WHERE c.ativo = 1 AND (c.nome LIKE ? COLLATE NOCASE OR c.apelido LIKE ? COLLATE NOCASE
           OR c.cpf_cnpj LIKE ? OR c.telefone LIKE ? OR c.codigo LIKE ?)
     ORDER BY c.nome LIMIT ?`,
    like, like, like, like, like, limite
  );
}

/* ================================================================== */
/* Caixa                                                              */
/* ================================================================== */

export async function caixaAberto() {
  return one<{ id: number; abertura_em: string; valor_abertura: number; terminal: string | null; usuario_id: number | null; operador: string | null }>(
    `SELECT c.id, c.abertura_em, c.valor_abertura, c.terminal, c.usuario_id, u.nome AS operador
     FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.status = 'aberto' ORDER BY c.id DESC LIMIT 1`
  );
}

export async function resumoCaixa(caixaId: number) {
  const r = one<{ dinheiro: number; outras: number; sangrias: number; suprimentos: number; vendas: number; qtd: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo='venda' AND COALESCE(forma_pagamento_id,0) IN
         (SELECT id FROM formas_pagamento WHERE tipo='dinheiro') THEN valor ELSE 0 END),0) AS dinheiro,
       COALESCE(SUM(CASE WHEN tipo='venda' AND COALESCE(forma_pagamento_id,0) NOT IN
         (SELECT id FROM formas_pagamento WHERE tipo='dinheiro') THEN valor ELSE 0 END),0) AS outras,
       COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0) AS sangrias,
       COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0) AS suprimentos,
       COALESCE(SUM(CASE WHEN tipo='venda' THEN valor ELSE 0 END),0) AS vendas,
       COALESCE(SUM(CASE WHEN tipo='venda' THEN 1 ELSE 0 END),0) AS qtd
     FROM caixa_movimentos WHERE caixa_id = ?`,
    caixaId
  ) ?? { dinheiro: 0, outras: 0, sangrias: 0, suprimentos: 0, vendas: 0, qtd: 0 };

  const cx = one<{ valor_abertura: number }>("SELECT valor_abertura FROM caixas WHERE id = ?", caixaId);
  const abertura = cx?.valor_abertura ?? 0;
  const esperadoDinheiro = arred(abertura + r.dinheiro + r.suprimentos - r.sangrias);
  return { ...r, abertura, esperadoDinheiro, totalGeral: arred(abertura + r.vendas + r.suprimentos - r.sangrias) };
}

export async function abrirCaixa(valorAbertura: number, terminal = "CAIXA 1") {
  const u = await exigir();
  const ja = await caixaAberto();
  if (ja) return { ok: false, erro: "Ja existe um caixa aberto (" + (ja.terminal || "caixa") + ")." };

  const loja = one<{ id: number }>("SELECT id FROM lojas WHERE padrao = 1 LIMIT 1")?.id ?? 1;
  const id = tx(() => {
    const r = run(
      "INSERT INTO caixas(loja_id, usuario_id, terminal, valor_abertura, status) VALUES (?,?,?,?, 'aberto')",
      loja, u.id, terminal, arred(valorAbertura)
    );
    const caixaId = Number(r.lastInsertRowid);
    run(
      "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, descricao, usuario_id) VALUES (?, 'abertura', ?, ?, ?)",
      caixaId, arred(valorAbertura), "Abertura de caixa", u.id
    );
    auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "abrir_caixa", entidade: "caixas", entidade_id: caixaId, detalhe: "Valor " + valorAbertura });
    return caixaId;
  });
  revalidatePath("/caixa");
  return { ok: true, caixa_id: id };
}

export async function lancarMovimentoCaixa(tipo: "sangria" | "suprimento" | "despesa", valor: number, descricao: string) {
  const u = await exigir();
  const cx = await caixaAberto();
  if (!cx) return { ok: false, erro: "Nenhum caixa aberto." };
  if (valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };

  const r = await resumoCaixa(cx.id);
  if (tipo === "sangria" && valor > r.esperadoDinheiro) {
    return { ok: false, erro: `Sangria maior que o dinheiro em caixa (${r.esperadoDinheiro.toFixed(2)}).` };
  }

  tx(() => {
    run(
      "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, descricao, usuario_id) VALUES (?,?,?,?,?)",
      cx.id, tipo, arred(valor), descricao || tipo, u.id
    );
    auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: tipo, entidade: "caixas", entidade_id: cx.id, detalhe: descricao + " R$ " + valor });
  });
  revalidatePath("/caixa");
  return { ok: true };
}

export async function fecharCaixa(valorInformado: number, observacoes = "") {
  const u = await exigir();
  const cx = await caixaAberto();
  if (!cx) return { ok: false, erro: "Nenhum caixa aberto." };

  const r = await resumoCaixa(cx.id);
  const diferenca = arred(valorInformado - r.esperadoDinheiro);

  tx(() => {
    run(
      `UPDATE caixas SET status='fechado', fechamento_em=datetime('now','localtime'),
        valor_fechamento_informado=?, valor_sistema=?, diferenca=?, fechado_por_id=?, observacoes=?
       WHERE id=?`,
      arred(valorInformado), r.esperadoDinheiro, diferenca, u.id, observacoes || null, cx.id
    );
    auditar({
      usuario_id: u.id, usuario_nome: u.nome, acao: "fechar_caixa", entidade: "caixas", entidade_id: cx.id,
      detalhe: `informado=${valorInformado} sistema=${r.esperadoDinheiro} diferenca=${diferenca}`,
    });
  });
  revalidatePath("/caixa");
  return { ok: true, diferenca, esperado: r.esperadoDinheiro };
}

/* ================================================================== */
/* Venda                                                              */
/* ================================================================== */

export type ItemVenda = {
  variacao_id: number;
  quantidade: number;
  preco_unitario: number;
  desconto_valor: number;
};

export type PagamentoVenda = {
  forma_pagamento_id: number;
  valor: number;
  parcelas?: number;
  valor_recebido?: number | null;
  autorizacao?: string;
};

export type PayloadVenda = {
  itens: ItemVenda[];
  pagamentos: PagamentoVenda[];
  cliente_id?: number | null;
  vendedor_id?: number | null;
  desconto_valor?: number;
  desconto_pct?: number;
  acrescimo?: number;
  observacoes?: string;
  senha_supervisor?: string;
};

export async function validarSupervisor(senha: string): Promise<boolean> {
  if (!senha) return false;
  const pin = String(senha).trim();
  // Aceita PIN de 4-6 digitos ou a senha de um usuario admin/gerente
  const porPin = one<{ id: number; nome: string }>(
    "SELECT id, nome FROM usuarios WHERE pin = ? AND papel IN ('admin','gerente') AND ativo = 1",
    pin
  );
  if (porPin) return true;

  const admins = all<{ id: number; senha_hash: string }>(
    "SELECT id, senha_hash FROM usuarios WHERE papel IN ('admin','gerente') AND ativo = 1"
  );
  return admins.some((a) => verificarSenha(pin, a.senha_hash));
}

export async function finalizarVenda(p: PayloadVenda) {
  const u = await exigir();
  if (!p.itens || p.itens.length === 0) return { ok: false, erro: "Venda sem itens." };

  // Limite de desconto para o operador (config configuravel)
  const limite = Number(config("cupom_desconto_max_pct", "20")) || 20;
  let subtotalBruto = 0;
  for (const it of p.itens) subtotalBruto += arred(it.preco_unitario * it.quantidade);
  const descPctSol = Number(p.desconto_pct || 0);
  const descValorSol = arred(p.desconto_valor || 0);
  const descTotal = arred(descValorSol + (subtotalBruto * descPctSol) / 100);
  const pctEfetivo = subtotalBruto > 0 ? (descTotal / subtotalBruto) * 100 : 0;

  const ehGestor = u.papel === "admin" || u.papel === "gerente";
  if (!ehGestor && pctEfetivo > limite) {
    if (!p.senha_supervisor) {
      return {
        ok: false,
        erro: `Desconto de ${pctEfetivo.toFixed(1)}% acima do limite de ${limite}%. Informe a senha/PIN do supervisor.`,
        precisa_supervisor: true,
      };
    }
    if (!(await validarSupervisor(p.senha_supervisor))) {
      return { ok: false, erro: "Senha de supervisor invalida.", precisa_supervisor: true };
    }
  }

  const cx = await caixaAberto();
  const loja = one<{ id: number }>("SELECT id FROM lojas WHERE padrao = 1 LIMIT 1")?.id ?? 1;

  let resultado: any;
  try {
    resultado = tx(() => {
      const numero = proximoNumero("venda", "V", 6, "vendas");
      let subtotal = 0;
      let custoTotal = 0;
      const linhas: any[] = [];

      // 1) Valida itens e calcula totais (o preco vem do banco, nao do cliente)
      for (const it of p.itens) {
        const v = one<any>(
          `SELECT vv.variacao_id, vv.produto, vv.nome_reduzido, vv.sku, vv.cor_codigo, vv.comprimento, vv.comprimento_unidade,
                  vv.preco_venda, vv.preco_promocional, vv.custo_medio, vv.disponivel, vv.permite_estoque_negativo,
                  vv.produto_status, vv.variacao_status
           FROM vw_variacoes vv WHERE vv.variacao_id = ?`,
          it.variacao_id
        );
        if (!v) throw new Error("SKU " + it.variacao_id + " nao encontrado.");
        if (v.variacao_status !== "ativo") throw new Error("SKU " + v.sku + " esta inativo.");
        const qtd = Number(it.quantidade);
        if (!(qtd > 0)) throw new Error("Quantidade invalida para " + v.sku + ".");

        const permiteNegativo = Number(v.permite_estoque_negativo) === 1 || config("pdv_permite_estoque_negativo", "0") === "1";
        if (!permiteNegativo && Number(v.disponivel) < qtd) {
          throw new Error(`Estoque insuficiente de ${v.produto} ${v.cor_codigo ?? ""}: disponivel ${v.disponivel}, pedido ${qtd}.`);
        }

        const precoTabela = arred(Number(v.preco_promocional) > 0 && Number(v.preco_promocional) < Number(v.preco_venda)
          ? Number(v.preco_promocional)
          : Number(v.preco_venda));
        const preco = arred(Number(it.preco_unitario) > 0 ? Number(it.preco_unitario) : precoTabela);
        const descItem = arred(Number(it.desconto_valor) || 0);
        const totalItem = arred(preco * qtd - descItem);
        const descricao = [v.produto, v.cor_codigo ? "Cor " + v.cor_codigo : null, v.comprimento ? v.comprimento + (v.comprimento_unidade || "") : null]
          .filter(Boolean).join(" | ");

        subtotal += arred(preco * qtd);
        custoTotal += arred(Number(v.custo_medio) * qtd);
        linhas.push({ ...it, qtd, preco, precoTabela, descItem, totalItem, v, descricao });
      }

      const descontoValor = arred(descValorSol + (subtotal * descPctSol) / 100);
      const acrescimo = arred(p.acrescimo || 0);
      const total = arred(subtotal - descontoValor + acrescimo);

      // 2) Cria a venda
      const rv = run(
        `INSERT INTO vendas(numero, loja_id, caixa_id, usuario_id, vendedor_id, cliente_id, subtotal,
           desconto_valor, desconto_pct, acrescimo, total, custo_total, status, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'concluida', ?)`,
        numero, loja, cx?.id ?? null, u.id, p.vendedor_id ?? u.id, p.cliente_id ?? null,
        arred(subtotal), descontoValor, descPctSol, acrescimo, total,
        arred(custoTotal),
        p.observacoes || null
      );
      const vendaId = Number(rv.lastInsertRowid);

      // 3) Itens + baixa de estoque + movimento
      for (const l of linhas) {
        run(
          `INSERT INTO vendas_itens(venda_id, variacao_id, descricao, quantidade, preco_unitario, preco_tabela,
             desconto_valor, total, custo_unitario, comissao_pct)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          vendaId, l.variacao_id, l.descricao, l.qtd, l.preco, l.precoTabela, l.descItem, l.totalItem,
          arred(Number(l.v.custo_medio)),
          Number(p.vendedor_id ? (one<{ comissao_pct: number }>("SELECT comissao_pct FROM usuarios WHERE id = ?", p.vendedor_id)?.comissao_pct ?? 0) : u.comissao_pct)
        );

        const est = one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", l.variacao_id, loja);
        const antes = est?.quantidade ?? 0;
        const depois = antes - l.qtd;
        if (est) {
          run("UPDATE estoque SET quantidade = ?, atualizado_em = datetime('now','localtime') WHERE variacao_id = ? AND loja_id = ?", depois, l.variacao_id, loja);
        } else {
          run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", l.variacao_id, loja, depois);
        }
        run(
          `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
             custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
           VALUES (?,?, 'venda', ?,?,?,?,?,?, 'venda', ?,?)`,
          l.variacao_id, loja, l.qtd, antes, depois, arred(Number(l.v.custo_medio)), numero, "Venda PDV", vendaId, u.id
        );
      }

      // 4) Pagamentos + caixa + fiado
      const totalPago = arred((p.pagamentos || []).reduce((s, x) => s + Number(x.valor || 0), 0));
      let troco = 0;
      for (const pg of p.pagamentos || []) {
        const forma = one<any>("SELECT id, nome, tipo, taxa_pct, entra_no_caixa FROM formas_pagamento WHERE id = ?", pg.forma_pagamento_id);
        if (!forma) throw new Error("Forma de pagamento invalida.");
        const valor = arred(Number(pg.valor));
        let recebido = pg.valor_recebido !== undefined && pg.valor_recebido !== null ? arred(Number(pg.valor_recebido)) : null;
        let tr = null;
        if (forma.tipo === "dinheiro" && recebido !== null && recebido > valor) {
          tr = arred(recebido - valor);
          troco = arred(troco + tr);
        }
        run(
          `INSERT INTO vendas_pagamentos(venda_id, forma_pagamento_id, valor, parcelas, valor_recebido, troco, autorizacao)
           VALUES (?,?,?,?,?,?,?)`,
          vendaId, forma.id, valor, Number(pg.parcelas || 1), recebido, tr, pg.autorizacao || null
        );

        if (Number(forma.entra_no_caixa) === 1 && cx) {
          run(
            "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, forma_pagamento_id, descricao, usuario_id) VALUES (?, 'venda', ?, ?, ?, ?)",
            cx.id, valor, forma.id, numero, u.id
          );
        }

        if (forma.tipo === "fiado") {
          if (!p.cliente_id) throw new Error("Venda no fiado exige um cliente identificado.");
          const cli = one<any>("SELECT id, nome, limite_credito FROM clientes WHERE id = ?", p.cliente_id);
          const saldoAnt = one<{ s: number }>(
            "SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s FROM fiado_lancamentos WHERE cliente_id = ?",
            p.cliente_id
          )?.s ?? 0;
          const novo = arred(saldoAnt + valor);
          if (Number(cli?.limite_credito) > 0 && novo > Number(cli.limite_credito)) {
            throw new Error(`Limite de fiado de ${cli.nome} excedido (saldo ficaria R$ ${novo.toFixed(2)} de R$ ${Number(cli.limite_credito).toFixed(2)}).`);
          }
          run(
            `INSERT INTO fiado_lancamentos(cliente_id, venda_id, tipo, valor, saldo_apos, vencimento, forma_pagamento_id, usuario_id)
             VALUES (?,?, 'compra', ?,?, date('now','localtime','+30 days'), ?, ?)`,
            p.cliente_id, vendaId, valor, novo, forma.id, u.id
          );
        }
      }

      if (totalPago < total - 0.01) {
        throw new Error(`Pagamento insuficiente: total R$ ${total.toFixed(2)}, pago R$ ${totalPago.toFixed(2)}.`);
      }

      auditar({
        usuario_id: u.id, usuario_nome: u.nome, acao: "venda", entidade: "vendas", entidade_id: vendaId,
        detalhe: `${numero} | ${linhas.length} itens | total R$ ${total.toFixed(2)}`,
      });

      return { venda_id: vendaId, numero, total, troco, subtotal, desconto: descontoValor, itens: linhas.length };
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao finalizar a venda." };
  }

  revalidatePath("/caixa");
  revalidatePath("/vendas");
  return { ok: true, ...resultado };
}

/* ================================================================== */
/* Cancelamento e devolucao                                           */
/* ================================================================== */

export async function cancelarVenda(vendaId: number, motivo: string) {
  const u = await exigir();
  if (u.papel !== "admin" && u.papel !== "gerente") {
    return { ok: false, erro: "Somente gerente ou administrador pode cancelar vendas." };
  }
  const v = one<any>("SELECT id, numero, status, total, loja_id, caixa_id FROM vendas WHERE id = ?", vendaId);
  if (!v) return { ok: false, erro: "Venda nao encontrada." };
  if (v.status !== "concluida") return { ok: false, erro: "Venda ja cancelada ou devolvida." };

  try {
    tx(() => {
      const itens = all<any>("SELECT variacao_id, quantidade, custo_unitario FROM vendas_itens WHERE venda_id = ?", vendaId);
      for (const it of itens) {
        const est = one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", it.variacao_id, v.loja_id);
        const antes = est?.quantidade ?? 0;
        const depois = antes + it.quantidade;
        run("UPDATE estoque SET quantidade = ?, atualizado_em = datetime('now','localtime') WHERE variacao_id = ? AND loja_id = ?", depois, it.variacao_id, v.loja_id);
        run(
          `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
             custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
           VALUES (?,?, 'cancelamento', ?,?,?,?,?,?, 'venda', ?,?)`,
          it.variacao_id, v.loja_id, it.quantidade, antes, depois, it.custo_unitario, v.numero, "Cancelamento de venda", vendaId, u.id
        );
      }
      // estorna fiado
      run("UPDATE fiado_lancamentos SET tipo='cancelamento', observacoes='Venda cancelada' WHERE venda_id = ?", vendaId);
      run(
        "UPDATE vendas SET status='cancelada', cancelada_em=datetime('now','localtime'), cancelada_por_id=?, motivo_cancelamento=? WHERE id=?",
        u.id, motivo || "Nao informado", vendaId
      );
      if (v.caixa_id) {
        const pagos = all<any>("SELECT valor, forma_pagamento_id FROM vendas_pagamentos WHERE venda_id = ?", vendaId);
        for (const pg of pagos) {
          run(
            "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, forma_pagamento_id, descricao, usuario_id) VALUES (?, 'estorno', ?, ?, ?, ?)",
            v.caixa_id, pg.valor, pg.forma_pagamento_id, "Estorno " + v.numero, u.id
          );
        }
      }
      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "cancelar_venda", entidade: "vendas", entidade_id: vendaId, detalhe: motivo });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao cancelar." };
  }
  revalidatePath("/vendas");
  return { ok: true };
}

export async function registrarDevolucao(vendaId: number, itens: { venda_item_id: number; quantidade: number; destino: "estoque" | "perda" }[], motivo: string) {
  const u = await exigir();
  const v = one<any>("SELECT id, numero, loja_id, status FROM vendas WHERE id = ?", vendaId);
  if (!v) return { ok: false, erro: "Venda nao encontrada." };
  if (itens.length === 0) return { ok: false, erro: "Selecione ao menos um item." };

  try {
    tx(() => {
      const numero = proximoNumero("devolucao", "D", 5, "devolucoes");
      let total = 0;
      const rd = run(
        "INSERT INTO devolucoes(numero, venda_id, loja_id, motivo, total, usuario_id) VALUES (?,?,?,?,0,?)",
        numero, vendaId, v.loja_id, motivo || null, u.id
      );
      const devId = Number(rd.lastInsertRowid);

      for (const d of itens) {
        const vi = one<any>("SELECT id, variacao_id, quantidade, preco_unitario, desconto_valor, devolvido, custo_unitario FROM vendas_itens WHERE id = ? AND venda_id = ?", d.venda_item_id, vendaId);
        if (!vi) throw new Error("Item da venda nao encontrado.");
        const resta = arred(vi.quantidade - vi.devolvido);
        const qtd = Number(d.quantidade);
        if (!(qtd > 0) || qtd > resta) throw new Error(`Quantidade de devolucao invalida (restam ${resta}).`);

        const valorUnit = arred(vi.preco_unitario - (vi.desconto_valor / vi.quantidade));
        const valor = arred(valorUnit * qtd);
        total += valor;

        run(
          "INSERT INTO devolucoes_itens(devolucao_id, venda_item_id, variacao_id, quantidade, valor, destino) VALUES (?,?,?,?,?,?)",
          devId, vi.id, vi.variacao_id, qtd, valor, d.destino
        );
        run("UPDATE vendas_itens SET devolvido = devolvido + ? WHERE id = ?", qtd, vi.id);

        if (d.destino === "estoque") {
          const est = one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", vi.variacao_id, v.loja_id);
          const antes = est?.quantidade ?? 0;
          const depois = antes + qtd;
          run("UPDATE estoque SET quantidade = ?, atualizado_em = datetime('now','localtime') WHERE variacao_id = ? AND loja_id = ?", depois, vi.variacao_id, v.loja_id);
          run(
            `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
               custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
             VALUES (?,?, 'devolucao', ?,?,?,?,?,?, 'devolucao', ?,?)`,
            vi.variacao_id, v.loja_id, qtd, antes, depois, vi.custo_unitario, numero, motivo || "Devolucao de cliente", devId, u.id
          );
        }
      }

      run("UPDATE devolucoes SET total = ? WHERE id = ?", arred(total), devId);

      const restantes = one<{ n: number }>(
        "SELECT COUNT(*) n FROM vendas_itens WHERE venda_id = ? AND devolvido < quantidade", vendaId
      )?.n ?? 0;
      run("UPDATE vendas SET status = ? WHERE id = ?", restantes === 0 ? "devolvida_total" : "devolvida_parcial", vendaId);

      auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "devolucao", entidade: "vendas", entidade_id: vendaId, detalhe: `${numero} | R$ ${total.toFixed(2)}` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao registrar devolucao." };
  }
  revalidatePath("/vendas");
  return { ok: true };
}
