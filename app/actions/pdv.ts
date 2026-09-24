"use server";

import { revalidatePath } from "next/cache";
import { all, one, run, tx, proximoNumero, auditar, config } from "@/lib/db";
import { arred } from "@/lib/format";
import { exigir, verificarSenha } from "@/lib/auth";

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

const CAMPOS_ITEM_BASE = `
  vv.variacao_id, vv.sku, vv.ean, vv.produto, vv.nome_reduzido, vv.marca,
  vv.cor, vv.cor_codigo, vv.cor_hex, vv.comprimento, vv.comprimento_unidade,
  vv.preco_venda, vv.preco_promocional, vv.custo_medio,
  %ESTOQUE%, vv.disponivel, vv.unidade_estoque,
  vv.localizacao, vv.corredor, vv.prateleira, vv.posicao,
  vv.ean as ean13
`;

/**
 * Colunas do item do PDV. A view do estoque escolhido chama o saldo de
 * `quantidade` e a view consolidada de `estoque`; aqui vira sempre `estoque`.
 */
function camposItem(doEstoque: boolean) {
  return CAMPOS_ITEM_BASE.replace("%ESTOQUE%", doEstoque ? "vv.quantidade AS estoque" : "vv.estoque");
}

/** Busca por nome, SKU, cor, marca, codigo interno ou codigo de barras.
 *  Com `lojaId`, o saldo mostrado e o do estoque escolhido (estoque separado). */
export async function buscarItens(termo: string, limite = 24, lojaId?: number | null): Promise<ItemBusca[]> {
  await exigir();
  const t = String(termo || "").trim();
  if (t.length < 1) return [];

  const soDigitos = t.replace(/\D/g, "");
  const like = "%" + t.replace(/[%_]/g, "") + "%";
  const doEstoque = Number(lojaId) > 0;
  const origem = doEstoque ? "vw_estoque_loja vv" : "vw_variacoes vv";
  const filtroLoja = doEstoque ? "vv.loja_id = ?" : "";

  // 1) Casamento exato por codigo (barras / interno / SKU) tem prioridade
  if (soDigitos.length >= 6) {
    const exatos = await all<ItemBusca>(
      `SELECT ${camposItem(doEstoque)} FROM ${origem}
       WHERE (vv.ean = ? OR vv.codigo_interno = ? OR vv.sku = ?) ${doEstoque ? "AND " + filtroLoja : ""}
       LIMIT ?`,
      soDigitos, t.toUpperCase(), t.toUpperCase(), ...(doEstoque ? [Number(lojaId)] : []), limite
    );
    if (exatos.length) return exatos;
  }

  // 2) Busca textual
  return await all<ItemBusca>(
    `SELECT ${camposItem(doEstoque)} FROM ${origem}
     WHERE vv.variacao_status = 'ativo' ${doEstoque ? "AND " + filtroLoja : ""}
       AND (vv.produto ILIKE ?
            OR vv.nome_reduzido ILIKE ?
            OR vv.sku ILIKE ?
            OR vv.ean LIKE ?
            OR vv.marca ILIKE ?
            OR vv.cor ILIKE ?
            OR vv.cor_codigo LIKE ?
            OR vv.localizacao ILIKE ?)
     ORDER BY
       CASE WHEN vv.produto ILIKE ? THEN 0 ELSE 1 END,
       vv.produto, vv.cor_codigo, vv.comprimento
     LIMIT ?`,
    ...(doEstoque ? [Number(lojaId)] : []),
    like, like, like, "%" + soDigitos + "%", like, like, like, like, t + "%", limite
  );
}

/** Casamento exato por codigo de barras / codigo interno / SKU (leitor USB). */
export async function buscarPorCodigo(codigo: string, lojaId?: number | null): Promise<ItemBusca | null> {
  await exigir();
  const c = String(codigo || "").trim();
  if (!c) return null;
  const doEstoque = Number(lojaId) > 0;
  const origem = doEstoque ? "vw_estoque_loja vv" : "vw_variacoes vv";
  const r = await one<ItemBusca>(
    `SELECT ${camposItem(doEstoque)} FROM ${origem}
     WHERE (vv.ean = ? OR vv.codigo_interno = ? OR vv.sku = ? OR vv.ean = ?) ${doEstoque ? "AND vv.loja_id = ?" : ""}
     LIMIT 1`,
    c, c.toUpperCase(), c.toUpperCase(), c.replace(/\D/g, ""), ...(doEstoque ? [Number(lojaId)] : [])
  );
  return r ?? null;
}

export async function buscarClientes(termo: string, limite = 12) {
  await exigir();
  const like = "%" + String(termo || "").trim() + "%";
  return await all<{ id: number; nome: string; apelido: string | null; telefone: string | null; cpf_cnpj: string | null; limite_credito: number; saldo_fiado: number }>(
    `SELECT c.id, c.nome, c.apelido, c.telefone, c.cpf_cnpj, c.limite_credito,
            COALESCE((SELECT SUM(CASE WHEN f.tipo='compra' THEN f.valor ELSE -f.valor END)
                      FROM fiado_lancamentos f WHERE f.cliente_id = c.id), 0) AS saldo_fiado
     FROM clientes c
     WHERE c.ativo = 1 AND (c.nome ILIKE ? OR c.apelido ILIKE ?
           OR c.cpf_cnpj LIKE ? OR c.telefone LIKE ? OR c.codigo LIKE ?)
     ORDER BY c.nome LIMIT ?`,
    like, like, like, like, like, limite
  );
}

/* ================================================================== */
/* Caixa                                                              */
/* ================================================================== */

export async function caixaAberto() {
  return await one<{ id: number; abertura_em: string; valor_abertura: number; terminal: string | null; usuario_id: number | null; operador: string | null; loja_id: number | null }>(
    `SELECT c.id, c.abertura_em, c.valor_abertura, c.terminal, c.usuario_id, c.loja_id, u.nome AS operador
     FROM caixas c LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.status = 'aberto' ORDER BY c.id DESC LIMIT 1`
  );
}

export async function resumoCaixa(caixaId: number) {
  const r = await one<{ dinheiro: number; outras: number; sangrias: number; suprimentos: number; vendas: number; qtd: number }>(
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

  const cx = await one<{ valor_abertura: number }>("SELECT valor_abertura FROM caixas WHERE id = ?", caixaId);
  const abertura = cx?.valor_abertura ?? 0;
  const esperadoDinheiro = arred(abertura + r.dinheiro + r.suprimentos - r.sangrias);
  return { ...r, abertura, esperadoDinheiro, totalGeral: arred(abertura + r.vendas + r.suprimentos - r.sangrias) };
}

export async function abrirCaixa(valorAbertura: number, terminal = "CAIXA 1", lojaId?: number | null) {
  const u = await exigir();
  const resultado = await tx(async () => {
    const ja = await caixaAberto();
    if (ja) return { ok: false, erro: "Ja existe um caixa aberto (" + (ja.terminal || "caixa") + ")." };

    // O caixa abre em um ESTOQUE: o PDV vende e baixa do estoque desse local.
    let loja = Number(lojaId) > 0 ? Number(lojaId) : 0;
    if (loja) {
      const l = await one<any>("SELECT id, nome, eh_deposito, ativa FROM lojas WHERE id = ?", loja);
      if (!l || !l.ativa) return { ok: false, erro: "Estoque invalido ou desativado." };
      if (l.eh_deposito === 1) return { ok: false, erro: "Galpao/deposito nao vende no balcao: escolha um estoque do tipo loja." };
    } else {
      loja =
        (await one<{ id: number }>("SELECT id FROM lojas WHERE ativa = 1 AND padrao = 1 AND eh_deposito = 0 LIMIT 1"))?.id ??
        (await one<{ id: number }>("SELECT id FROM lojas WHERE ativa = 1 AND eh_deposito = 0 ORDER BY id LIMIT 1"))?.id ??
        (await one<{ id: number }>("SELECT id FROM lojas WHERE ativa = 1 ORDER BY id LIMIT 1"))?.id ??
        1;
    }

    const r = await run(
      "INSERT INTO caixas(loja_id, usuario_id, terminal, valor_abertura, status) VALUES (?,?,?,?, 'aberto') RETURNING id",
      loja, u.id, terminal, arred(valorAbertura)
    );
    const caixaId = Number(r.lastInsertRowid);
    await run(
      "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, descricao, usuario_id) VALUES (?, 'abertura', ?, ?, ?)",
      caixaId, arred(valorAbertura), "Abertura de caixa", u.id
    );
    await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "abrir_caixa", entidade: "caixas", entidade_id: caixaId, detalhe: "Valor " + valorAbertura });
    return { ok: true, caixa_id: caixaId };
  });
  if (resultado.ok) revalidatePath("/caixa");
  return resultado;
}

export async function lancarMovimentoCaixa(tipo: "sangria" | "suprimento" | "despesa", valor: number, descricao: string) {
  const u = await exigir();
  if (valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  const resultado = await tx(async () => {
    const cx = await caixaAberto();
    if (!cx) return { ok: false, erro: "Nenhum caixa aberto." };
    const r = await resumoCaixa(cx.id);
    if (tipo === "sangria" && valor > r.esperadoDinheiro) {
      return { ok: false, erro: `Sangria maior que o dinheiro em caixa (${r.esperadoDinheiro.toFixed(2)}).` };
    }
    await run(
      "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, descricao, usuario_id) VALUES (?,?,?,?,?)",
      cx.id, tipo, arred(valor), descricao || tipo, u.id
    );
    await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: tipo, entidade: "caixas", entidade_id: cx.id, detalhe: descricao + " R$ " + valor });
    return { ok: true };
  });
  if (resultado.ok) revalidatePath("/caixa");
  return resultado;
}

export async function fecharCaixa(valorInformado: number, observacoes = "") {
  const u = await exigir();
  const resultado = await tx(async () => {
    const cx = await caixaAberto();
    if (!cx) return { ok: false, erro: "Nenhum caixa aberto." };
    const r = await resumoCaixa(cx.id);
    const diferenca = arred(valorInformado - r.esperadoDinheiro);
    await run(
      `UPDATE caixas SET status='fechado', fechamento_em=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),
        valor_fechamento_informado=?, valor_sistema=?, diferenca=?, fechado_por_id=?, observacoes=?
       WHERE id=?`,
      arred(valorInformado), r.esperadoDinheiro, diferenca, u.id, observacoes || null, cx.id
    );
    await auditar({
      usuario_id: u.id, usuario_nome: u.nome, acao: "fechar_caixa", entidade: "caixas", entidade_id: cx.id,
      detalhe: `informado=${valorInformado} sistema=${r.esperadoDinheiro} diferenca=${diferenca}`,
    });
    return { ok: true, diferenca, esperado: r.esperadoDinheiro };
  });
  if (resultado.ok) revalidatePath("/caixa");
  return resultado;
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
  const porPin = await one<{ id: number; nome: string }>(
    "SELECT id, nome FROM usuarios WHERE pin = ? AND papel IN ('admin','gerente') AND ativo = 1",
    pin
  );
  if (porPin) return true;

  const admins = await all<{ id: number; senha_hash: string }>(
    "SELECT id, senha_hash FROM usuarios WHERE papel IN ('admin','gerente') AND ativo = 1"
  );
  return admins.some((a) => verificarSenha(pin, a.senha_hash));
}

export async function finalizarVenda(p: PayloadVenda) {
  const u = await exigir();
  if (!p.itens || p.itens.length === 0) return { ok: false, erro: "Venda sem itens." };

  // Limite de desconto para o operador (config configuravel)
  const limite = Number(await config("cupom_desconto_max_pct", "20")) || 20;
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

  let resultado: any;
  try {
    resultado = await tx(async () => {
      const cx = await caixaAberto();
      // Vende do estoque do caixa aberto; sem caixa aberto, usa o estoque
      // marcado como padrao (o "estoque que vende").
      const loja = cx?.loja_id ?? (await one<{ id: number }>("SELECT id FROM lojas WHERE padrao = 1 LIMIT 1"))?.id ?? 1;
      const nomeLoja = (await one<{ nome: string }>("SELECT nome FROM lojas WHERE id = ?", loja))?.nome ?? "estoque";
      const numero = await proximoNumero("venda", "V", 6, "vendas");
      const permiteEstoqueNegativo = (await config("pdv_permite_estoque_negativo", "0")) === "1";
      const comissaoPct = Number(p.vendedor_id
        ? (await one<{ comissao_pct: number }>("SELECT comissao_pct FROM usuarios WHERE id = ?", p.vendedor_id))?.comissao_pct ?? 0
        : u.comissao_pct);
      let subtotal = 0;
      let custoTotal = 0;
      const linhas: any[] = [];

      // 1) Valida itens e calcula totais (o preco vem do banco, nao do cliente)
      for (const it of p.itens) {
        const v = await one<any>(
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

        const permiteNegativo = Number(v.permite_estoque_negativo) === 1 || permiteEstoqueNegativo;
        // O saldo conferido e o do ESTOQUE DO CAIXA (estoque separado), nao o total.
        const local = await one<{ quantidade: number; reservado: number }>(
          "SELECT quantidade, reservado FROM estoque WHERE variacao_id = ? AND loja_id = ?",
          it.variacao_id, loja
        );
        const disponivelLocal = Number(local?.quantidade ?? 0) - Number(local?.reservado ?? 0);
        if (!permiteNegativo && disponivelLocal < qtd) {
          throw new Error(
            `Estoque insuficiente de ${v.produto} ${v.cor_codigo ?? ""} em ${nomeLoja}: disponivel ${disponivelLocal}, pedido ${qtd}. ` +
            `Transfira do galpao ou venda de outro estoque.`
          );
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
      const rv = await run(
        `INSERT INTO vendas(numero, loja_id, caixa_id, usuario_id, vendedor_id, cliente_id, subtotal,
           desconto_valor, desconto_pct, acrescimo, total, custo_total, status, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'concluida', ?) RETURNING id`,
        numero, loja, cx?.id ?? null, u.id, p.vendedor_id ?? u.id, p.cliente_id ?? null,
        arred(subtotal), descontoValor, descPctSol, acrescimo, total,
        arred(custoTotal),
        p.observacoes || null
      );
      const vendaId = Number(rv.lastInsertRowid);

      // 3) Itens + baixa de estoque + movimento
      for (const l of linhas) {
        await run(
          `INSERT INTO vendas_itens(venda_id, variacao_id, descricao, quantidade, preco_unitario, preco_tabela,
             desconto_valor, total, custo_unitario, comissao_pct)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          vendaId, l.variacao_id, l.descricao, l.qtd, l.preco, l.precoTabela, l.descItem, l.totalItem,
          arred(Number(l.v.custo_medio)),
          comissaoPct
        );

        const est = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", l.variacao_id, loja);
        const antes = est?.quantidade ?? 0;
        const depois = antes - l.qtd;
        if (est) {
          await run("UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE variacao_id = ? AND loja_id = ?", depois, l.variacao_id, loja);
        } else {
          await run("INSERT INTO estoque(variacao_id, loja_id, quantidade, reservado) VALUES (?,?,?,0)", l.variacao_id, loja, depois);
        }
        await run(
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
        const forma = await one<any>("SELECT id, nome, tipo, taxa_pct, entra_no_caixa FROM formas_pagamento WHERE id = ?", pg.forma_pagamento_id);
        if (!forma) throw new Error("Forma de pagamento invalida.");
        const valor = arred(Number(pg.valor));
        let recebido = pg.valor_recebido !== undefined && pg.valor_recebido !== null ? arred(Number(pg.valor_recebido)) : null;
        let tr = null;
        if (forma.tipo === "dinheiro" && recebido !== null && recebido > valor) {
          tr = arred(recebido - valor);
          troco = arred(troco + tr);
        }
        await run(
          `INSERT INTO vendas_pagamentos(venda_id, forma_pagamento_id, valor, parcelas, valor_recebido, troco, autorizacao)
           VALUES (?,?,?,?,?,?,?)`,
          vendaId, forma.id, valor, Number(pg.parcelas || 1), recebido, tr, pg.autorizacao || null
        );

        if (Number(forma.entra_no_caixa) === 1 && cx) {
          await run(
            "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, forma_pagamento_id, descricao, usuario_id) VALUES (?, 'venda', ?, ?, ?, ?)",
            cx.id, valor, forma.id, numero, u.id
          );
        }

        if (forma.tipo === "fiado") {
          if (!p.cliente_id) throw new Error("Venda no fiado exige um cliente identificado.");
          const cli = await one<any>("SELECT id, nome, limite_credito FROM clientes WHERE id = ?", p.cliente_id);
          const saldoAnt = (await one<{ s: number }>(
            "SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) s FROM fiado_lancamentos WHERE cliente_id = ?",
            p.cliente_id
          ))?.s ?? 0;
          const novo = arred(saldoAnt + valor);
          if (Number(cli?.limite_credito) > 0 && novo > Number(cli.limite_credito)) {
            throw new Error(`Limite de fiado de ${cli.nome} excedido (saldo ficaria R$ ${novo.toFixed(2)} de R$ ${Number(cli.limite_credito).toFixed(2)}).`);
          }
          await run(
            `INSERT INTO fiado_lancamentos(cliente_id, venda_id, tipo, valor, saldo_apos, vencimento, forma_pagamento_id, usuario_id)
             VALUES (?,?, 'compra', ?,?, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') + interval '30 days','YYYY-MM-DD'), ?, ?)`,
            p.cliente_id, vendaId, valor, novo, forma.id, u.id
          );
        }
      }

      if (totalPago < total - 0.01) {
        throw new Error(`Pagamento insuficiente: total R$ ${total.toFixed(2)}, pago R$ ${totalPago.toFixed(2)}.`);
      }

      await auditar({
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
  try {
    await tx(async () => {
      const v = await one<any>("SELECT id, numero, status, total, loja_id, caixa_id FROM vendas WHERE id = ?", vendaId);
      if (!v) throw new Error("Venda nao encontrada.");
      if (v.status !== "concluida") throw new Error("Venda ja cancelada ou devolvida.");
      const itens = await all<any>("SELECT variacao_id, quantidade, custo_unitario FROM vendas_itens WHERE venda_id = ?", vendaId);
      for (const it of itens) {
        const est = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", it.variacao_id, v.loja_id);
        const antes = est?.quantidade ?? 0;
        const depois = antes + it.quantidade;
        await run("UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE variacao_id = ? AND loja_id = ?", depois, it.variacao_id, v.loja_id);
        await run(
          `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
             custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
           VALUES (?,?, 'cancelamento', ?,?,?,?,?,?, 'venda', ?,?)`,
          it.variacao_id, v.loja_id, it.quantidade, antes, depois, it.custo_unitario, v.numero, "Cancelamento de venda", vendaId, u.id
        );
      }
      // estorna fiado
      await run("UPDATE fiado_lancamentos SET tipo='cancelamento', observacoes='Venda cancelada' WHERE venda_id = ?", vendaId);
      await run(
        "UPDATE vendas SET status='cancelada', cancelada_em=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'), cancelada_por_id=?, motivo_cancelamento=? WHERE id=?",
        u.id, motivo || "Nao informado", vendaId
      );
      if (v.caixa_id) {
        const pagos = await all<any>("SELECT valor, forma_pagamento_id FROM vendas_pagamentos WHERE venda_id = ?", vendaId);
        for (const pg of pagos) {
          await run(
            "INSERT INTO caixa_movimentos(caixa_id, tipo, valor, forma_pagamento_id, descricao, usuario_id) VALUES (?, 'estorno', ?, ?, ?, ?)",
            v.caixa_id, pg.valor, pg.forma_pagamento_id, "Estorno " + v.numero, u.id
          );
        }
      }
      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "cancelar_venda", entidade: "vendas", entidade_id: vendaId, detalhe: motivo });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao cancelar." };
  }
  revalidatePath("/vendas");
  return { ok: true };
}

export async function registrarDevolucao(vendaId: number, itens: { venda_item_id: number; quantidade: number; destino: "estoque" | "perda" }[], motivo: string) {
  const u = await exigir();
  if (itens.length === 0) return { ok: false, erro: "Selecione ao menos um item." };

  try {
    await tx(async () => {
      const v = await one<any>("SELECT id, numero, loja_id, status FROM vendas WHERE id = ?", vendaId);
      if (!v) throw new Error("Venda nao encontrada.");
      if (v.status !== "concluida" && v.status !== "devolvida_parcial") {
        throw new Error("Venda ja cancelada ou devolvida integralmente.");
      }
      const numero = await proximoNumero("devolucao", "D", 5, "devolucoes");
      let total = 0;
      const rd = await run(
        "INSERT INTO devolucoes(numero, venda_id, loja_id, motivo, total, usuario_id) VALUES (?,?,?,?,0,?) RETURNING id",
        numero, vendaId, v.loja_id, motivo || null, u.id
      );
      const devId = Number(rd.lastInsertRowid);

      for (const d of itens) {
        const vi = await one<any>("SELECT id, variacao_id, quantidade, preco_unitario, desconto_valor, devolvido, custo_unitario FROM vendas_itens WHERE id = ? AND venda_id = ?", d.venda_item_id, vendaId);
        if (!vi) throw new Error("Item da venda nao encontrado.");
        const resta = arred(vi.quantidade - vi.devolvido);
        const qtd = Number(d.quantidade);
        if (!(qtd > 0) || qtd > resta) throw new Error(`Quantidade de devolucao invalida (restam ${resta}).`);

        const valorUnit = arred(vi.preco_unitario - (vi.desconto_valor / vi.quantidade));
        const valor = arred(valorUnit * qtd);
        total += valor;

        await run(
          "INSERT INTO devolucoes_itens(devolucao_id, venda_item_id, variacao_id, quantidade, valor, destino) VALUES (?,?,?,?,?,?)",
          devId, vi.id, vi.variacao_id, qtd, valor, d.destino
        );
        await run("UPDATE vendas_itens SET devolvido = devolvido + ? WHERE id = ?", qtd, vi.id);

        if (d.destino === "estoque") {
          const est = await one<{ quantidade: number }>("SELECT quantidade FROM estoque WHERE variacao_id = ? AND loja_id = ?", vi.variacao_id, v.loja_id);
          const antes = est?.quantidade ?? 0;
          const depois = antes + qtd;
          await run("UPDATE estoque SET quantidade = ?, atualizado_em = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') WHERE variacao_id = ? AND loja_id = ?", depois, vi.variacao_id, v.loja_id);
          await run(
            `INSERT INTO estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
               custo_unitario, documento, motivo, referencia_tipo, referencia_id, usuario_id)
             VALUES (?,?, 'devolucao', ?,?,?,?,?,?, 'devolucao', ?,?)`,
            vi.variacao_id, v.loja_id, qtd, antes, depois, vi.custo_unitario, numero, motivo || "Devolucao de cliente", devId, u.id
          );
        }
      }

      await run("UPDATE devolucoes SET total = ? WHERE id = ?", arred(total), devId);

      const restantes = (await one<{ n: number }>(
        "SELECT COUNT(*) n FROM vendas_itens WHERE venda_id = ? AND devolvido < quantidade", vendaId
      ))?.n ?? 0;
      await run("UPDATE vendas SET status = ? WHERE id = ?", restantes === 0 ? "devolvida_total" : "devolvida_parcial", vendaId);

      await auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "devolucao", entidade: "vendas", entidade_id: vendaId, detalhe: `${numero} | R$ ${total.toFixed(2)}` });
    });
  } catch (e: any) {
    return { ok: false, erro: e?.message || "Falha ao registrar devolucao." };
  }
  revalidatePath("/vendas");
  return { ok: true };
}
