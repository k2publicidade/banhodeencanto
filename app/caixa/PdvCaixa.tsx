"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moeda, parseMoeda, arred } from "@/lib/format";
import {
  buscarItens,
  buscarPorCodigo,
  buscarClientes,
  finalizarVenda,
  abrirCaixa,
  fecharCaixa,
  lancarMovimentoCaixa,
  validarSupervisor,
  type ItemBusca,
} from "@/app/actions/pdv";

type Linha = {
  variacao_id: number;
  sku: string | null;
  nome: string;
  cor: string | null;
  cor_codigo: string | null;
  cor_hex: string | null;
  comprimento: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto_valor: number;
  disponivel: number;
  local: string;
};

type Props = {
  usuario: { id: number; nome: string; papel: string };
  caixa: { id: number; terminal: string | null; abertura_em: string; esperadoDinheiro: number } | null;
  /** Estoque de onde o PDV vende (o do caixa aberto, ou o estoque padrao). */
  estoque: { id: number; nome: string; eh_deposito: number; opcoes: { id: number; nome: string }[] };
  formas: { id: number; nome: string; tipo: string; aceita_troco: number }[];
  vendedores: { id: number; nome: string; apelido: string | null }[];
  config: Record<string, string>;
  resumoCaixa: { dinheiro: number; esperadoDinheiro: number; totalGeral: number; qtd: number; sangrias: number; suprimentos: number; abertura: number };
  resumoDia: { vendas: number; total: number; pecas: number };
};

export default function PdvCaixa({ usuario, caixa, estoque, formas, vendedores, config, resumoCaixa, resumoDia }: Props) {
  const estoqueId = estoque.id;
  const router = useRouter();

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ItemBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro" | "info"; texto: string } | null>(null);

  const [clienteId, setClienteId] = useState<number | null>(null);
  const [clienteNome, setClienteNome] = useState("Cliente Balcao");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [listaClientes, setListaClientes] = useState<any[]>([]);
  const [vendedorId, setVendedorId] = useState<number>(vendedores[0]?.id ?? usuario.id);

  const [descPct, setDescPct] = useState(0);
  const [descValor, setDescValor] = useState(0);
  const [acrescimo, setAcrescimo] = useState(0);

  const [modal, setModal] = useState<null | "pagamento" | "caixa" | "movimento" | "fechar" | "consulta" | "menu" | "detalhes">(null);
  const [pagamentos, setPagamentos] = useState<{ forma_id: number; valor: number; parcelas: number; recebido: number }[]>([]);
  const [senhaSup, setSenhaSup] = useState("");
  const [cupom, setCupom] = useState<any | null>(null);
  const [processando, setProcessando] = useState(false);

  const refCodigo = useRef<HTMLInputElement>(null);
  const refAviso = useRef<number | null>(null);

  const avisar = useCallback((tipo: "ok" | "erro" | "info", texto: string) => {
    setAviso({ tipo, texto });
    if (refAviso.current) window.clearTimeout(refAviso.current);
    refAviso.current = window.setTimeout(() => setAviso(null), 4600);
  }, []);

  /* -------------------- totais -------------------- */
  const subtotalBruto = useMemo(() => arred(linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade, 0)), [linhas]);
  const descontoTotal = useMemo(() => arred(descValor + (subtotalBruto * descPct) / 100), [descValor, descPct, subtotalBruto]);
  const total = useMemo(() => arred(subtotalBruto - descontoTotal + acrescimo), [subtotalBruto, descontoTotal, acrescimo]);
  const pecas = useMemo(() => linhas.reduce((s, l) => s + l.quantidade, 0), [linhas]);

  /* -------------------- busca por nome -------------------- */
  useEffect(() => {
    if (termo.trim().length < 2) {
      setResultados([]);
      return;
    }
    let vivo = true;
    const t = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarItens(termo, 24, estoqueId);
        if (vivo) setResultados(r);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 220);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [termo, estoqueId]);

  useEffect(() => {
    if (buscaCliente.trim().length < 2) {
      setListaClientes([]);
      return;
    }
    const t = window.setTimeout(async () => setListaClientes(await buscarClientes(buscaCliente)), 250);
    return () => window.clearTimeout(t);
  }, [buscaCliente]);

  /* -------------------- acoes do carrinho -------------------- */
  const adicionar = useCallback(
    (it: ItemBusca | Linha, quantidade = 1) => {
      const disponivel = Number((it as any).disponivel ?? 0);
      const permiteNeg = config.pdv_permite_estoque_negativo === "1";
      setLinhas((atual) => {
        const i = atual.findIndex((l) => l.variacao_id === (it as any).variacao_id);
        if (i >= 0) {
          const novo = [...atual];
          const q = novo[i].quantidade + quantidade;
          if (!permiteNeg && q > disponivel) {
            avisar("erro", `Estoque insuficiente: ${disponivel} un disponiveis de ${novo[i].nome}.`);
            return atual;
          }
          novo[i] = { ...novo[i], quantidade: q };
          return novo;
        }
        if (!permiteNeg && quantidade > disponivel) {
          avisar("erro", `Sem estoque suficiente (${disponivel} un). Venda bloqueada.`);
          return atual;
        }
        return [
          ...atual,
          {
            variacao_id: (it as any).variacao_id,
            sku: (it as any).sku,
            nome: (it as any).produto ?? (it as any).nome,
            cor: (it as any).cor,
            cor_codigo: (it as any).cor_codigo,
            cor_hex: (it as any).cor_hex,
            comprimento: (it as any).comprimento ? `${(it as any).comprimento}${(it as any).comprimento_unidade ?? ""}` : null,
            quantidade,
            preco_unitario: arred(
              Number((it as any).preco_promocional) > 0 &&
                Number((it as any).preco_promocional) < Number((it as any).preco_venda ?? (it as any).preco_unitario)
                ? Number((it as any).preco_promocional)
                : Number((it as any).preco_venda ?? (it as any).preco_unitario)
            ),
            desconto_valor: 0,
            disponivel,
            local: [(it as any).localizacao, (it as any).corredor, (it as any).prateleira, (it as any).posicao].filter(Boolean).join(" "),
          },
        ];
      });
      setTermo("");
      setResultados([]);
      setCodigo("");
      refCodigo.current?.focus();
    },
    [avisar, config.pdv_permite_estoque_negativo]
  );

  const aoBipar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const c = codigo.trim();
      if (!c) return;
      const it = await buscarPorCodigo(c, estoqueId);
      if (it) {
        adicionar(it);
        avisar("ok", `+ ${it.produto} ${it.cor_codigo ?? ""} ${it.comprimento ?? ""}`);
      } else {
        const r = await buscarItens(c, 8, estoqueId);
        if (r.length === 1) {
          adicionar(r[0]);
          avisar("ok", `+ ${r[0].produto}`);
        } else if (r.length > 1) {
          setTermo(c);
          setResultados(r);
          avisar("info", `${r.length} itens encontrados - escolha um.`);
        } else {
          avisar("erro", `Codigo "${c}" nao encontrado em ${estoque.nome}.`);
        }
      }
      setCodigo("");
    },
    [codigo, adicionar, avisar, estoqueId, estoque.nome]
  );

  const alterarQtd = (id: number, delta: number) =>
    setLinhas((a) => a.flatMap((l) => (l.variacao_id === id ? (l.quantidade + delta <= 0 ? [] : [{ ...l, quantidade: l.quantidade + delta }]) : [l])));

  const definirQtd = (id: number, valor: number) =>
    setLinhas((a) => a.map((l) => (l.variacao_id === id ? { ...l, quantidade: Math.max(1, Math.round(valor) || 1) } : l)));

  const remover = (id: number) => setLinhas((a) => a.filter((l) => l.variacao_id !== id));

  const limpar = () => {
    if (linhas.length && !window.confirm("Descartar a venda em andamento?")) return;
    setLinhas([]);
    setDescPct(0);
    setDescValor(0);
    setAcrescimo(0);
    setClienteId(null);
    setClienteNome("Cliente Balcao");
    setModal(null);
    refCodigo.current?.focus();
  };

  /* -------------------- atalhos de teclado (desktop) -------------------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      const emCampo = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT");
      if (e.key === "F2") {
        e.preventDefault();
        if (linhas.length) {
          const v = window.prompt(`Quantidade para ${linhas[linhas.length - 1].nome}:`, String(linhas[linhas.length - 1].quantidade));
          if (v !== null) {
            const n = Math.max(0, Math.round(Number(v)));
            if (n === 0) remover(linhas[linhas.length - 1].variacao_id);
            else definirQtd(linhas[linhas.length - 1].variacao_id, n);
          }
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        refCodigo.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        const v = window.prompt("Desconto em % sobre a venda:", String(descPct));
        if (v !== null) setDescPct(Math.min(100, Math.max(0, Number(String(v).replace(",", ".")) || 0)));
      } else if (e.key === "F9") {
        e.preventDefault();
        if (linhas.length) abrirPagamento();
      } else if (e.key === "F8") {
        e.preventDefault();
        limpar();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !emCampo && linhas.length) {
        remover(linhas[linhas.length - 1].variacao_id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [linhas, descPct]);

  useEffect(() => {
    if (caixa) refCodigo.current?.focus();
  }, [caixa]);

  /* -------------------- pagamento -------------------- */
  function abrirPagamento() {
    if (!caixa) {
      avisar("erro", "Abra o caixa antes de vender.");
      setModal("caixa");
      return;
    }
    if (linhas.length === 0) return;
    const dinheiro = formas.find((f) => f.tipo === "dinheiro")?.id ?? formas[0]?.id;
    setPagamentos([{ forma_id: dinheiro!, valor: total, parcelas: 1, recebido: 0 }]);
    setSenhaSup("");
    setModal("pagamento");
  }

  const totalPago = arred(pagamentos.reduce((s, p) => s + p.valor, 0));
  const troco = useMemo(() => {
    const dinheiroIds = formas.filter((f) => f.tipo === "dinheiro").map((f) => f.id);
    return arred(
      pagamentos.reduce((s, p) => {
        if (!dinheiroIds.includes(p.forma_id)) return s;
        return s + Math.max(0, (p.recebido || 0) - p.valor);
      }, 0)
    );
  }, [pagamentos, formas]);

  async function confirmarVenda() {
    setProcessando(true);
    try {
      const r = await finalizarVenda({
        itens: linhas.map((l) => ({
          variacao_id: l.variacao_id,
          quantidade: l.quantidade,
          preco_unitario: l.preco_unitario,
          desconto_valor: l.desconto_valor,
        })),
        pagamentos: pagamentos.map((p) => ({
          forma_pagamento_id: p.forma_id,
          valor: p.valor,
          parcelas: p.parcelas,
          valor_recebido: p.recebido > 0 ? p.recebido : null,
        })),
        cliente_id: clienteId,
        vendedor_id: vendedorId,
        desconto_valor: descValor,
        desconto_pct: descPct,
        acrescimo,
        senha_supervisor: senhaSup || undefined,
      });

      if (!r.ok) {
        avisar("erro", r.erro || "Falha ao finalizar.");
        setProcessando(false);
        return;
      }

      const detalhe = await (await fetch(`/api/venda/${(r as any).venda_id}`)).json();
      setCupom(detalhe);
      setLinhas([]);
      setDescPct(0);
      setDescValor(0);
      setAcrescimo(0);
      setClienteId(null);
      setClienteNome("Cliente Balcao");
      setModal(null);
      avisar("ok", `Venda ${(r as any).numero} finalizada. Troco ${moeda((r as any).troco)}`);
      router.refresh();
    } finally {
      setProcessando(false);
    }
  }

  /* ================================================================== */
  /* CUPOM                                                              */
  /* ================================================================== */
  if (cupom) {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--color-creme-200)", padding: "14px 12px" }}>
        <div
          className="nao-imprimir"
          style={{ maxWidth: 420, margin: "0 auto 12px", display: "flex", gap: 8 }}
        >
          <button className="btn btn-primario" style={{ flex: 1 }} onClick={() => window.print()}>
            Imprimir cupom
          </button>
          <button
            className="btn btn-neutro"
            style={{ flex: 1 }}
            onClick={() => {
              setCupom(null);
              refCodigo.current?.focus();
            }}
          >
            Nova venda
          </button>
        </div>
        <div className="cupom card" style={{ maxWidth: 420, margin: "0 auto", padding: "16px 18px" }}>
          <CupomConteudo venda={cupom} />
        </div>
      </div>
    );
  }

  /* ================================================================== */
  /* PDV                                                                */
  /* ================================================================== */
  return (
    <div className="pdv nao-imprimir">
      {/* ---------- topo: versao celular ---------- */}
      <header className="pdv-topo so-no-mobile">
        <div className="pdv-topo-linha">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-sm.webp" alt="" style={{ height: 34, width: "auto" }} />
          <div className="pdv-topo-info">
            <strong>PDV</strong>
            <span>
              {caixa ? `${caixa.terminal || "CAIXA"} · aberto` : "CAIXA FECHADO"} · {usuario.nome}
            </span>
            <span style={{ fontSize: 10.5, color: "var(--color-ouro-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              estoque: {estoque.nome}
            </span>
          </div>
          {caixa ? (
            <span className="tag tag-verde" style={{ fontSize: 11 }}>
              {moeda(resumoCaixa.esperadoDinheiro)}
            </span>
          ) : (
            <span className="tag tag-vermelho piscar" style={{ fontSize: 11 }}>
              FECHADO
            </span>
          )}
          <button className="btn btn-icone" aria-label="Mais opcoes do caixa" style={{ fontSize: 18 }} onClick={() => setModal("menu")}>
            ⋯
          </button>
        </div>
      </header>

      {/* ---------- topo: versao desktop ---------- */}
      <header className="pdv-topo so-no-desktop">
        <div className="pdv-topo-linha" style={{ padding: "10px 16px", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-sm.webp" alt="" style={{ height: 40, width: "auto" }} />
          <div className="pdv-topo-info">
            <strong>
              Banho de Encanto <span style={{ color: "var(--color-ouro-400)", fontSize: 13 }}>PDV</span>
            </strong>
            <span>
              {caixa ? `${caixa.terminal || "CAIXA"} • aberto` : "CAIXA FECHADO"} • {usuario.nome}
            </span>
          </div>

          <Indicador rotulo="Estoque de venda" valor={estoque.nome} cor="#d9a44c" />

          {caixa ? (
            <>
              <Indicador rotulo="Dinheiro em caixa" valor={moeda(resumoCaixa.esperadoDinheiro)} cor="#d9a44c" />
              <Indicador rotulo="Vendas do caixa" valor={moeda(resumoCaixa.totalGeral)} cor="#6fcdd9" />
            </>
          ) : (
            <span className="tag tag-vermelho piscar" style={{ fontSize: 12 }}>
              CAIXA FECHADO
            </span>
          )}
          <Indicador rotulo="Vendas hoje" valor={`${resumoDia.vendas} • ${moeda(resumoDia.total)}`} cor="#fff" />

          <button className="btn btn-sm btn-neutro" onClick={() => setModal("consulta")}>
            Consulta preco (F1)
          </button>
          {caixa ? (
            <>
              <button className="btn btn-sm btn-neutro" onClick={() => setModal("movimento")}>
                Sangria / Suprimento
              </button>
              <button className="btn btn-sm btn-neutro" onClick={() => setModal("fechar")}>
                Fechar caixa
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-ouro" onClick={() => setModal("caixa")}>
              Abrir caixa
            </button>
          )}
          <Link className="btn btn-sm btn-neutro" href="/painel">
            Painel
          </Link>
        </div>
      </header>

      {/* ---------- corpo ---------- */}
      <div className="pdv-corpo">
        <section className="pdv-principal">
          {/* leitura de codigo de barras */}
          <form onSubmit={aoBipar} className="pdv-painel" style={{ padding: 12 }}>
            <label htmlFor="bip">Codigo de barras / SKU</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="bip"
                ref={refCodigo}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Bipe ou digite o codigo"
                autoComplete="off"
                enterKeyHint="done"
                autoFocus
                style={{ flex: 1, fontSize: 17, fontWeight: 600, minWidth: 0 }}
              />
              <button type="submit" className="btn btn-primario" style={{ flex: "0 0 auto" }}>
                Adicionar
              </button>
            </div>
          </form>

          {/* busca por nome */}
          <div className="pdv-painel" style={{ padding: 12, marginTop: 10 }}>
            <label htmlFor="busca">Busca por nome, cor, marca ou referencia (F3)</label>
            <input
              id="busca"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Ex: jumbo 1B 60, crochet cacheado, mega hair..."
              autoComplete="off"
              type="search"
              enterKeyHint="search"
            />
            {buscando ? (
              <div style={{ fontSize: 12, color: "var(--color-creme-600)", marginTop: 6 }}>Buscando...</div>
            ) : null}
            {resultados.length > 0 ? (
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 300,
                  overflowY: "auto",
                  border: "1px solid var(--color-creme-300)",
                  borderRadius: 12,
                }}
              >
                {resultados.map((r) => (
                  <button key={r.variacao_id} type="button" className="pdv-resultado" onClick={() => adicionar(r)}>
                    {r.cor_hex ? (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          background: r.cor_hex,
                          border: "1px solid var(--color-creme-400)",
                          flexShrink: 0,
                        }}
                      />
                    ) : null}
                    <span className="nome">
                      <b>{r.produto}</b>
                      <span>
                        {r.cor_codigo ? `Cor ${r.cor_codigo}` : ""} {r.comprimento ? `• ${r.comprimento}${r.comprimento_unidade}` : ""}{" "}
                        {r.marca ? `• ${r.marca}` : ""}
                      </span>
                      <span>{r.sku}</span>
                    </span>
                    <span className="valor">
                      <b>{moeda(r.preco_promocional && r.preco_promocional < r.preco_venda ? r.preco_promocional : r.preco_venda)}</b>
                      <span
                        className={
                          "tag " + (r.disponivel <= 0 ? "tag-vermelho" : r.disponivel <= 5 ? "tag-amarelo" : "tag-verde")
                        }
                        style={{ fontSize: 10.5 }}
                      >
                        {r.disponivel} un
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* carrinho */}
          <div className="pdv-painel" style={{ marginTop: 10 }}>
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--color-creme-300)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 400 }}>Itens da venda</strong>
              <span className="tag tag-azul">
                {linhas.length} itens • {pecas} pecas
              </span>
              <div style={{ flex: 1 }} />
              {linhas.length ? (
                <button className="btn btn-sm btn-perigo" onClick={limpar}>
                  Cancelar venda
                </button>
              ) : null}
            </div>

            {linhas.length === 0 ? (
              <div style={{ padding: "34px 18px", textAlign: "center", color: "var(--color-creme-600)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark-sm.webp" alt="" style={{ height: 66, opacity: 0.22 }} />
                <div style={{ marginTop: 12, fontSize: 14 }}>Bipe um produto ou busque pelo nome para comecar a venda</div>
              </div>
            ) : (
              <>
                {/* celular: cartoes com passo de quantidade */}
                <div className="so-no-mobile">
                  {linhas.map((l, idx) => (
                    <div className="pdv-item" key={l.variacao_id}>
                      {l.cor_hex ? <span className="pdv-item-cor" style={{ background: l.cor_hex }} /> : null}
                      <div className="pdv-item-info">
                        <strong>
                          {idx + 1}. {l.nome}
                        </strong>
                        <div className="sub">
                          {l.sku} {l.cor_codigo ? `• Cor ${l.cor_codigo}` : ""} {l.comprimento ? `• ${l.comprimento}` : ""}
                          {l.local ? ` • ${l.local}` : ""}
                        </div>

                        <div className="pdv-item-controles">
                          <div className="pdv-passo">
                            <button type="button" aria-label="Diminuir quantidade" onClick={() => alterarQtd(l.variacao_id, -1)}>
                              −
                            </button>
                            <input
                              value={l.quantidade}
                              inputMode="numeric"
                              aria-label="Quantidade"
                              onChange={(e) => definirQtd(l.variacao_id, Number(e.target.value))}
                            />
                            <button type="button" aria-label="Aumentar quantidade" onClick={() => alterarQtd(l.variacao_id, +1)}>
                              +
                            </button>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="pdv-item-preco">{moeda(l.preco_unitario * l.quantidade - l.desconto_valor)}</div>
                            <div className="sub" style={{ fontSize: 11.5 }}>
                              {moeda(l.preco_unitario)} / un
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label style={{ fontSize: 10.5 }}>Preco un.</label>
                            <input
                              value={l.preco_unitario.toFixed(2).replace(".", ",")}
                              inputMode="decimal"
                              onChange={(e) => {
                                const v = parseMoeda(e.target.value);
                                setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, preco_unitario: v } : x)));
                              }}
                              style={{ textAlign: "right", minHeight: 40, padding: "8px 10px" }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label style={{ fontSize: 10.5 }}>Desconto R$</label>
                            <input
                              value={l.desconto_valor ? String(l.desconto_valor).replace(".", ",") : ""}
                              placeholder="0,00"
                              inputMode="decimal"
                              onChange={(e) => {
                                const v = parseMoeda(e.target.value);
                                setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, desconto_valor: v } : x)));
                              }}
                              style={{ textAlign: "right", minHeight: 40, padding: "8px 10px" }}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-perigo"
                            style={{ alignSelf: "flex-end", minWidth: 46 }}
                            aria-label={`Remover ${l.nome}`}
                            onClick={() => remover(l.variacao_id)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* desktop: tabela */}
                <div className="so-no-desktop" style={{ overflowX: "auto" }}>
                  <table className="tabela-sistema">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>#</th>
                        <th>Produto</th>
                        <th style={{ width: 118 }} className="num">
                          Unitario
                        </th>
                        <th style={{ width: 128 }} className="num">
                          Qtd
                        </th>
                        <th style={{ width: 104 }} className="num">
                          Desconto
                        </th>
                        <th style={{ width: 104 }} className="num">
                          Total
                        </th>
                        <th style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l, idx) => (
                        <tr key={l.variacao_id}>
                          <td style={{ color: "var(--color-creme-600)" }}>{idx + 1}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              {l.cor_hex ? (
                                <span
                                  style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 3,
                                    background: l.cor_hex,
                                    border: "1px solid var(--color-creme-400)",
                                  }}
                                />
                              ) : null}
                              <strong>{l.nome}</strong>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--color-creme-600)" }}>
                              {l.sku} {l.cor_codigo ? `• Cor ${l.cor_codigo}` : ""} {l.comprimento ? `• ${l.comprimento}` : ""}
                              {l.local ? ` • ${l.local}` : ""}
                            </div>
                          </td>
                          <td className="num">
                            <input
                              value={l.preco_unitario.toFixed(2).replace(".", ",")}
                              onChange={(e) => {
                                const v = parseMoeda(e.target.value);
                                setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, preco_unitario: v } : x)));
                              }}
                              style={{ textAlign: "right", padding: "5px 7px", width: 100, minHeight: 34 }}
                            />
                          </td>
                          <td className="num">
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <button className="btn btn-sm btn-neutro" onClick={() => alterarQtd(l.variacao_id, -1)}>
                                −
                              </button>
                              <input
                                value={l.quantidade}
                                onChange={(e) => definirQtd(l.variacao_id, Number(e.target.value))}
                                style={{ width: 52, textAlign: "center", padding: "5px 4px", minHeight: 34 }}
                              />
                              <button className="btn btn-sm btn-neutro" onClick={() => alterarQtd(l.variacao_id, +1)}>
                                +
                              </button>
                            </div>
                          </td>
                          <td className="num">
                            <input
                              value={l.desconto_valor ? String(l.desconto_valor).replace(".", ",") : ""}
                              placeholder="0,00"
                              onChange={(e) => {
                                const v = parseMoeda(e.target.value);
                                setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, desconto_valor: v } : x)));
                              }}
                              style={{ textAlign: "right", padding: "5px 7px", width: 88, minHeight: 34 }}
                            />
                          </td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {moeda(l.preco_unitario * l.quantidade - l.desconto_valor)}
                          </td>
                          <td>
                            <button className="btn btn-sm btn-perigo" title="Remover" onClick={() => remover(l.variacao_id)}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------- lateral (desktop) ---------- */}
        <aside className="pdv-lateral so-no-desktop">
          <div style={{ padding: 14, borderBottom: "1px solid var(--color-creme-300)" }}>
            <label>Cliente</label>
            {clienteId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tag tag-azul" style={{ fontSize: 12.5, padding: "5px 10px" }}>
                  {clienteNome}
                </span>
                <button
                  className="btn btn-sm btn-neutro"
                  onClick={() => {
                    setClienteId(null);
                    setClienteNome("Cliente Balcao");
                  }}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <CampoCliente
                busca={buscaCliente}
                setBusca={setBuscaCliente}
                lista={listaClientes}
                onEscolher={(id, nome) => {
                  setClienteId(id);
                  setClienteNome(nome);
                  setBuscaCliente("");
                  setListaClientes([]);
                }}
              />
            )}

            <div style={{ marginTop: 12 }}>
              <label htmlFor="vendedor">Vendedor</label>
              <select id="vendedor" value={vendedorId} onChange={(e) => setVendedorId(Number(e.target.value))}>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.apelido || v.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ padding: 14, flex: 1, overflowY: "auto" }}>
            <LinhaTotais rotulo="Subtotal" valor={moeda(subtotalBruto)} />
            <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <div style={{ flex: 1 }}>
                <label>Desconto %</label>
                <input
                  value={descPct ? String(descPct).replace(".", ",") : ""}
                  placeholder="0"
                  onChange={(e) => setDescPct(Number(String(e.target.value).replace(",", ".")) || 0)}
                  style={{ textAlign: "right" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Desconto R$</label>
                <input
                  value={descValor ? String(descValor).replace(".", ",") : ""}
                  placeholder="0,00"
                  onChange={(e) => setDescValor(parseMoeda(e.target.value))}
                  style={{ textAlign: "right" }}
                />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label>Acrescimo / frete R$</label>
              <input
                value={acrescimo ? String(acrescimo).replace(".", ",") : ""}
                placeholder="0,00"
                onChange={(e) => setAcrescimo(parseMoeda(e.target.value))}
                style={{ textAlign: "right" }}
              />
            </div>
            {descontoTotal > 0 ? <LinhaTotais rotulo="Desconto aplicado" valor={"- " + moeda(descontoTotal)} vermelho /> : null}

            <div
              style={{
                marginTop: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: "linear-gradient(180deg,#00303c,#001a22)",
                color: "#fff",
              }}
            >
              <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>
                Total a pagar
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 38, color: "#e8c77c", lineHeight: 1.15 }}>
                {moeda(total)}
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.65)" }}>
                {pecas} pecas • {linhas.length} itens
              </div>
            </div>
          </div>

          <div style={{ padding: 14, borderTop: "1px solid var(--color-creme-300)", display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-sucesso btn-lg" style={{ width: "100%" }} disabled={!linhas.length} onClick={abrirPagamento}>
              Finalizar venda (F9)
            </button>
            <button className="btn btn-neutro btn-sm" style={{ width: "100%" }} onClick={limpar}>
              Limpar
            </button>
          </div>
        </aside>
      </div>

      {/* ---------- barra fixa de total (celular) ---------- */}
      <div className="pdv-resumo so-no-mobile">
        <div className="pdv-resumo-linha">
          <div className="pdv-total">
            <span>Total</span>
            <strong>{moeda(total)}</strong>
            <small>
              {pecas} pecas • {linhas.length} itens
              {descontoTotal > 0 ? ` • desc. ${moeda(descontoTotal)}` : ""}
            </small>
          </div>
          <button
            className="btn btn-neutro btn-icone"
            aria-label="Cliente, desconto e vendedor"
            onClick={() => setModal("detalhes")}
          >
            ⚙
          </button>
          <button className="btn btn-sucesso btn-lg" disabled={!linhas.length} onClick={abrirPagamento} style={{ minWidth: 132 }}>
            Finalizar
          </button>
        </div>
      </div>

      {/* ---------- aviso flutuante ---------- */}
      {aviso && !modal ? (
        <div className={"app-aviso aparecer app-aviso-" + aviso.tipo} role="status">
          {aviso.texto}
        </div>
      ) : null}

      {/* ================= MODAIS / FOLHAS ================= */}
      {modal === "pagamento" ? (
        <Folha
          titulo="Pagamento"
          aviso={aviso}
          onFechar={() => setModal(null)}
          rodape={
            <>
              <button className="btn btn-neutro" onClick={() => setModal(null)} style={{ flex: 0.8 }}>
                Voltar
              </button>
              <ConfirmarPagamento
                total={total}
                totalPago={totalPago}
                processando={processando}
                onConfirmar={confirmarVenda}
              />
            </>
          }
        >
          <PagamentoForm
            total={total}
            pagamentos={pagamentos}
            setPagamentos={setPagamentos}
            formas={formas}
            totalPago={totalPago}
            senhaSup={senhaSup}
            setSenhaSup={setSenhaSup}
            limiteDesconto={Number(config.cupom_desconto_max_pct || 20)}
            pctDesconto={subtotalBruto > 0 ? (descontoTotal / subtotalBruto) * 100 : 0}
          />
        </Folha>
      ) : null}

      {modal === "menu" ? (
        <Folha titulo="Caixa" onFechar={() => setModal(null)} aviso={aviso}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-neutro btn-lg" onClick={() => setModal("consulta")}>
              Consulta de preco e estoque
            </button>
            {caixa ? (
              <>
                <button className="btn btn-neutro btn-lg" onClick={() => setModal("movimento")}>
                  Sangria / Suprimento
                </button>
                <button className="btn btn-neutro btn-lg" onClick={() => setModal("fechar")}>
                  Fechar caixa
                </button>
              </>
            ) : (
              <button className="btn btn-ouro btn-lg" onClick={() => setModal("caixa")}>
                Abrir caixa
              </button>
            )}
            <Link className="btn btn-neutro btn-lg" href="/painel">
              Ir para o painel
            </Link>
            <div style={{ fontSize: 12.5, color: "var(--color-creme-600)", textAlign: "center", marginTop: 4 }}>
              Hoje: {resumoDia.vendas} vendas • {moeda(resumoDia.total)} • {resumoDia.pecas} pecas
            </div>
          </div>
        </Folha>
      ) : null}

      {modal === "detalhes" ? (
        <Folha titulo="Cliente, vendedor e desconto" aviso={aviso} onFechar={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label>Cliente</label>
              {clienteId ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="tag tag-azul" style={{ fontSize: 13, padding: "7px 12px" }}>
                    {clienteNome}
                  </span>
                  <button
                    className="btn btn-sm btn-neutro"
                    onClick={() => {
                      setClienteId(null);
                      setClienteNome("Cliente Balcao");
                    }}
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <CampoCliente
                  busca={buscaCliente}
                  setBusca={setBuscaCliente}
                  lista={listaClientes}
                  onEscolher={(id, nome) => {
                    setClienteId(id);
                    setClienteNome(nome);
                    setBuscaCliente("");
                    setListaClientes([]);
                  }}
                />
              )}
            </div>

            <div>
              <label htmlFor="vendedor-mobile">Vendedor</label>
              <select id="vendedor-mobile" value={vendedorId} onChange={(e) => setVendedorId(Number(e.target.value))}>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.apelido || v.nome}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Desconto %</label>
                <input
                  value={descPct ? String(descPct).replace(".", ",") : ""}
                  placeholder="0"
                  inputMode="decimal"
                  onChange={(e) => setDescPct(Number(String(e.target.value).replace(",", ".")) || 0)}
                  style={{ textAlign: "right" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Desconto R$</label>
                <input
                  value={descValor ? String(descValor).replace(".", ",") : ""}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => setDescValor(parseMoeda(e.target.value))}
                  style={{ textAlign: "right" }}
                />
              </div>
            </div>

            <div>
              <label>Acrescimo / frete R$</label>
              <input
                value={acrescimo ? String(acrescimo).replace(".", ",") : ""}
                placeholder="0,00"
                inputMode="decimal"
                onChange={(e) => setAcrescimo(parseMoeda(e.target.value))}
                style={{ textAlign: "right" }}
              />
            </div>

            <div className="card" style={{ padding: 12 }}>
              <LinhaTotais rotulo="Subtotal" valor={moeda(subtotalBruto)} />
              {descontoTotal > 0 ? <LinhaTotais rotulo="Desconto" valor={"- " + moeda(descontoTotal)} vermelho /> : null}
              {acrescimo > 0 ? <LinhaTotais rotulo="Acrescimo" valor={moeda(acrescimo)} /> : null}
              <LinhaTotais rotulo="Total" valor={moeda(total)} />
            </div>

            <button className="btn btn-primario btn-lg" onClick={() => setModal(null)}>
              Aplicar
            </button>
          </div>
        </Folha>
      ) : null}

      {modal === "caixa" ? (
        <Folha titulo="Abrir caixa" onFechar={() => setModal(null)} aviso={aviso}>
          <AbrirCaixaForm
            estoqueId={estoqueId}
            opcoes={estoque.opcoes}
            onOk={() => {
              setModal(null);
              avisar("ok", "Caixa aberto.");
              router.refresh();
            }}
            onErro={(e) => avisar("erro", e)}
          />
        </Folha>
      ) : null}

      {modal === "movimento" ? (
        <Folha titulo="Sangria / Suprimento" onFechar={() => setModal(null)} aviso={aviso}>
          <MovimentoCaixaForm
            onOk={(m) => {
              setModal(null);
              avisar("ok", m);
              router.refresh();
            }}
            onErro={(e) => avisar("erro", e)}
          />
        </Folha>
      ) : null}

      {modal === "fechar" && caixa ? (
        <Folha titulo="Fechamento de caixa" onFechar={() => setModal(null)} aviso={aviso}>
          <FecharCaixaForm
            resumo={resumoCaixa}
            onOk={(m) => {
              setModal(null);
              avisar("ok", m);
              router.refresh();
            }}
            onErro={(e) => avisar("erro", e)}
          />
        </Folha>
      ) : null}

      {modal === "consulta" ? (
        <Folha titulo="Consulta de preco e estoque" onFechar={() => setModal(null)} aviso={aviso}>
          <ModalConsulta />
        </Folha>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/* Componentes auxiliares                                               */
/* ==================================================================== */

function Indicador({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div style={{ textAlign: "right", lineHeight: 1.2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
        {rotulo}
      </div>
      <div style={{ fontWeight: 700, color: cor, fontSize: 14 }}>{valor}</div>
    </div>
  );
}

function LinhaTotais({ rotulo, valor, vermelho }: { rotulo: string; valor: string; vermelho?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 14 }}>
      <span style={{ color: "var(--color-creme-600)" }}>{rotulo}</span>
      <strong style={{ color: vermelho ? "#9c2b2b" : "var(--color-creme-800)", fontVariantNumeric: "tabular-nums" }}>
        {valor}
      </strong>
    </div>
  );
}

/** Busca de cliente reaproveitada no desktop e na folha do celular. */
function CampoCliente({
  busca,
  setBusca,
  lista,
  onEscolher,
}: {
  busca: string;
  setBusca: (s: string) => void;
  lista: any[];
  onEscolher: (id: number | null, nome: string) => void;
}) {
  return (
    <>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome, CPF ou telefone"
        type="search"
      />
      {lista.length > 0 ? (
        <div style={{ marginTop: 8, border: "1px solid var(--color-creme-300)", borderRadius: 12, overflow: "hidden" }}>
          <button
            type="button"
            className="pdv-resultado"
            onClick={() => onEscolher(null, "Cliente Balcao")}
            style={{ borderRadius: 0 }}
          >
            <span className="nome">
              <b>Cliente Balcao (sem cadastro)</b>
            </span>
          </button>
          {lista.map((c) => (
            <button
              key={c.id}
              type="button"
              className="pdv-resultado"
              style={{ borderRadius: 0 }}
              onClick={() => onEscolher(c.id, c.nome)}
            >
              <span className="nome">
                <b>{c.nome}</b>
              </span>
              <span className="valor">
                {c.saldo_fiado > 0 ? (
                  <span className="tag tag-vermelho">fiado {moeda(c.saldo_fiado)}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Folha inferior no celular, janela centralizada no desktop. */
export function Folha({
  titulo,
  children,
  onFechar,
  rodape,
  aviso,
}: {
  titulo: string;
  children: React.ReactNode;
  onFechar: () => void;
  rodape?: React.ReactNode;
  aviso?: { tipo: "ok" | "erro" | "info"; texto: string } | null;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    document.body.classList.add("travado");
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.classList.remove("travado");
    };
  }, [onFechar]);

  return (
    <div className="folha-fundo" onClick={onFechar}>
      <div className="folha" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="folha-puxador" />
        <div className="folha-topo">
          <strong>{titulo}</strong>
          <button className="btn btn-sm btn-neutro" onClick={onFechar} aria-label="Fechar">
            Fechar
          </button>
        </div>
        {aviso ? (
          <div className={"folha-aviso folha-aviso-" + aviso.tipo} role="status">
            {aviso.texto}
          </div>
        ) : null}
        <div className="folha-corpo">{children}</div>
        {rodape ? <div className="folha-rodape">{rodape}</div> : null}
      </div>
    </div>
  );
}

function ConfirmarPagamento({
  total,
  totalPago,
  processando,
  onConfirmar,
}: {
  total: number;
  totalPago: number;
  processando: boolean;
  onConfirmar: () => void;
}) {
  const falta = arred(total - totalPago);
  return (
    <button
      className="btn btn-sucesso btn-lg"
      style={{ flex: 2 }}
      disabled={processando || falta > 0.01}
      onClick={onConfirmar}
    >
      {processando ? "Processando..." : falta > 0.01 ? `Faltam ${moeda(falta)}` : "Confirmar venda"}
    </button>
  );
}

function PagamentoForm(props: {
  total: number;
  pagamentos: { forma_id: number; valor: number; parcelas: number; recebido: number }[];
  setPagamentos: (p: any) => void;
  formas: { id: number; nome: string; tipo: string; aceita_troco: number }[];
  totalPago: number;
  senhaSup: string;
  setSenhaSup: (s: string) => void;
  limiteDesconto: number;
  pctDesconto: number;
}) {
  const { total, pagamentos, setPagamentos, formas, totalPago, senhaSup, setSenhaSup, limiteDesconto, pctDesconto } = props;
  const falta = arred(total - totalPago);
  const troco = arred(
    pagamentos.reduce((s, p) => {
      const forma = formas.find((f) => f.id === p.forma_id);
      if (forma?.tipo !== "dinheiro") return s;
      return s + Math.max(0, (p.recebido || 0) - p.valor);
    }, 0)
  );
  const excedeLimite = pctDesconto > limiteDesconto;

  /* Confere o PIN/senha do supervisor assim que ele e digitado, sem esperar
     o fechamento da venda: o operador ja sabe se pode ou nao continuar. */
  const [sup, setSup] = useState<"ocioso" | "checando" | "ok" | "invalido">("ocioso");

  useEffect(() => {
    if (!excedeLimite) {
      setSup("ocioso");
      return;
    }
    const chave = senhaSup.trim();
    if (chave.length < 4) {
      setSup("ocioso");
      return;
    }
    let vivo = true;
    setSup("checando");
    const t = window.setTimeout(async () => {
      try {
        const valido = await validarSupervisor(chave);
        if (vivo) setSup(valido ? "ok" : "invalido");
      } catch {
        if (vivo) setSup("invalido");
      }
    }, 350);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [senhaSup, excedeLimite]);

  const atualizar = (i: number, campo: string, v: any) => {
    const novo = [...pagamentos];
    novo[i] = { ...novo[i], [campo]: v };
    setPagamentos(novo);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pagamentos.map((p, i) => {
        const forma = formas.find((f) => f.id === p.forma_id);
        return (
          <div key={i} style={{ border: "1px solid var(--color-creme-300)", borderRadius: 13, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong style={{ flex: 1, fontSize: 14 }}>
                Pagamento {pagamentos.length > 1 ? i + 1 : ""}
              </strong>
              {pagamentos.length > 1 ? (
                <button
                  className="btn btn-sm btn-perigo"
                  aria-label="Remover forma de pagamento"
                  onClick={() => setPagamentos(pagamentos.filter((_: any, j: number) => j !== i))}
                >
                  ×
                </button>
              ) : null}
            </div>

            {/* formas de pagamento em botoes grandes (toque) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
              {formas.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={"btn btn-sm " + (p.forma_id === f.id ? "btn-primario" : "btn-neutro")}
                  onClick={() => atualizar(i, "forma_id", f.id)}
                >
                  {f.nome}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label>Valor</label>
                <input
                  value={p.valor.toFixed(2).replace(".", ",")}
                  inputMode="decimal"
                  onChange={(e) => atualizar(i, "valor", parseMoeda(e.target.value))}
                  style={{ textAlign: "right", fontWeight: 700 }}
                />
              </div>
              {forma?.tipo === "credito" ? (
                <div style={{ width: 104 }}>
                  <label>Parcelas</label>
                  <select value={p.parcelas} onChange={(e) => atualizar(i, "parcelas", Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {forma?.tipo === "dinheiro" ? (
              <div style={{ marginTop: 10 }}>
                <label>Valor recebido do cliente</label>
                <input
                  value={p.recebido ? p.recebido.toFixed(2).replace(".", ",") : ""}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => atualizar(i, "recebido", parseMoeda(e.target.value))}
                  style={{ textAlign: "right", fontWeight: 700 }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {[p.valor, 20, 50, 100, 200].filter((v, idx, a) => v > 0 && a.indexOf(v) === idx).map((v) => (
                    <button key={v} className="btn btn-sm btn-neutro" onClick={() => atualizar(i, "recebido", v)}>
                      {v === p.valor ? "Exato" : moeda(v)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {p.recebido > p.valor && forma?.tipo === "dinheiro" ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "#166b46", fontWeight: 600 }}>
                Troco: {moeda(p.recebido - p.valor)}
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        className="btn btn-neutro btn-bloco"
        onClick={() => setPagamentos([...pagamentos, { forma_id: formas[0]?.id, valor: Math.max(0, falta), parcelas: 1, recebido: 0 }])}
      >
        + Adicionar outra forma (pagamento dividido)
      </button>

      <div style={{ background: "var(--color-creme-100)", border: "1px solid var(--color-creme-300)", borderRadius: 13, padding: 12 }}>
        <LinhaTotais rotulo="Total da venda" valor={moeda(total)} />
        <LinhaTotais rotulo="Total pago" valor={moeda(totalPago)} />
        <LinhaTotais rotulo={falta > 0 ? "Falta" : "Troco"} valor={moeda(Math.abs(falta > 0 ? falta : troco))} vermelho={falta > 0.01} />
      </div>

      {excedeLimite ? (
        <div style={{ background: "#fdf3e0", border: "1px solid #e8c77c", borderRadius: 13, padding: 12 }}>
          <strong style={{ fontSize: 13, color: "#8a5a12" }}>
            Desconto de {pctDesconto.toFixed(1)}% acima do limite de {limiteDesconto}%
          </strong>
          <p style={{ fontSize: 12.5, margin: "6px 0 8px", color: "var(--color-creme-600)" }}>
            Informe o PIN ou a senha de um gerente/administrador para autorizar.
          </p>
          <input
            type="password"
            value={senhaSup}
            inputMode="numeric"
            onChange={(e) => setSenhaSup(e.target.value)}
            placeholder="PIN ou senha do supervisor"
          />
          {sup === "checando" ? <div style={{ fontSize: 12, color: "var(--color-creme-600)", marginTop: 6 }}>Conferindo...</div> : null}
          {sup === "ok" ? (
            <div style={{ fontSize: 12, color: "#166b46", marginTop: 6 }}>Supervisor autorizado. Pode confirmar a venda.</div>
          ) : null}
          {sup === "invalido" ? (
            <div style={{ fontSize: 12, color: "#9c2b2b", marginTop: 6 }}>
              PIN/senha nao confere com nenhum gerente ou administrador ativo.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/* Formularios de caixa                                                 */
/* ==================================================================== */

function AbrirCaixaForm({
  onOk,
  onErro,
  estoqueId,
  opcoes,
}: {
  onOk: () => void;
  onErro: (e: string) => void;
  estoqueId: number;
  opcoes: { id: number; nome: string }[];
}) {
  const [valor, setValor] = useState("");
  const [loja, setLoja] = useState(String(estoqueId));
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        const r = await abrirCaixa(parseMoeda(valor), "CAIXA 1", Number(loja));
        setEnviando(false);
        if (!r.ok) onErro(r.erro || "Falha ao abrir caixa.");
        else onOk();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <p style={{ fontSize: 13, color: "var(--color-creme-600)", margin: 0 }}>
        Informe o valor em dinheiro que esta sendo colocado na gaveta (fundo de troco).
      </p>
      <div>
        <label>Estoque de onde este caixa vende</label>
        <select value={loja} onChange={(e) => setLoja(e.target.value)}>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>{o.nome}</option>
          ))}
        </select>
        <div style={{ fontSize: 11.5, color: "var(--color-creme-600)", marginTop: 4 }}>
          A venda baixa do estoque escolhido. Galpao/deposito nao aparece aqui.
        </div>
      </div>
      <div>
        <label>Valor de abertura</label>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="200,00"
          inputMode="decimal"
          style={{ textAlign: "right", fontSize: 19, fontWeight: 700 }}
          autoFocus
        />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>
        {enviando ? "Abrindo..." : "Abrir caixa"}
      </button>
    </form>
  );
}

function MovimentoCaixaForm({ onOk, onErro }: { onOk: (m: string) => void; onErro: (e: string) => void }) {
  const [tipo, setTipo] = useState<"sangria" | "suprimento" | "despesa">("sangria");
  const [valor, setValor] = useState("");
  const [desc, setDesc] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        const r = await lancarMovimentoCaixa(tipo, parseMoeda(valor), desc);
        setEnviando(false);
        if (!r.ok) onErro(r.erro || "Falha no lancamento.");
        else
          onOk(
            tipo === "sangria" ? "Sangria registrada." : tipo === "suprimento" ? "Suprimento registrado." : "Despesa registrada."
          );
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div>
        <label>Tipo de movimento</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {[
            { v: "sangria", t: "Sangria — retirar dinheiro da gaveta" },
            { v: "suprimento", t: "Suprimento — colocar dinheiro na gaveta" },
            { v: "despesa", t: "Despesa — pagamento com dinheiro do caixa" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              className={"btn " + (tipo === o.v ? "btn-primario" : "btn-neutro")}
              style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}
              onClick={() => setTipo(o.v as any)}
            >
              {o.t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label>Valor</label>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          style={{ textAlign: "right", fontSize: 19, fontWeight: 700 }}
        />
      </div>
      <div>
        <label>Observacao</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex: retirada para cofre" />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>
        {enviando ? "Salvando..." : "Registrar"}
      </button>
    </form>
  );
}

function FecharCaixaForm({ resumo, onOk, onErro }: { resumo: any; onOk: (m: string) => void; onErro: (e: string) => void }) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const diferenca = arred(parseMoeda(valor) - (resumo?.esperadoDinheiro ?? 0));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        const r = await fecharCaixa(parseMoeda(valor), obs);
        setEnviando(false);
        if (!r.ok) onErro(r.erro || "Falha ao fechar.");
        else onOk(`Caixa fechado. Diferenca: ${moeda((r as any).diferenca)}`);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ background: "var(--color-creme-100)", border: "1px solid var(--color-creme-300)", borderRadius: 13, padding: 12 }}>
        <LinhaTotais rotulo="Fundo de troco" valor={moeda(resumo?.abertura ?? 0)} />
        <LinhaTotais rotulo="Vendas em dinheiro" valor={moeda(resumo?.dinheiro ?? 0)} />
        <LinhaTotais rotulo="Suprimentos" valor={moeda(resumo?.suprimentos ?? 0)} />
        <LinhaTotais rotulo="Sangrias" valor={"- " + moeda(resumo?.sangrias ?? 0)} vermelho />
        <div style={{ borderTop: "1px solid var(--color-creme-300)", marginTop: 8, paddingTop: 8 }}>
          <LinhaTotais rotulo="Esperado na gaveta" valor={moeda(resumo?.esperadoDinheiro ?? 0)} />
        </div>
      </div>
      <div>
        <label>Valor contado na gaveta</label>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          style={{ textAlign: "right", fontSize: 19, fontWeight: 700 }}
        />
      </div>
      {valor ? (
        <div
          className={"tag " + (Math.abs(diferenca) < 0.01 ? "tag-verde" : "tag-vermelho")}
          style={{ display: "block", padding: 11, borderRadius: 11, fontSize: 13.5 }}
        >
          Diferenca: <strong>{moeda(diferenca)}</strong>{" "}
          {Math.abs(diferenca) < 0.01 ? "(bateu)" : diferenca > 0 ? "(sobra)" : "(falta)"}
        </div>
      ) : null}
      <div>
        <label>Observacoes do fechamento</label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>
        {enviando ? "Fechando..." : "Fechar caixa"}
      </button>
    </form>
  );
}

function ModalConsulta() {
  const [t, setT] = useState("");
  const [r, setR] = useState<ItemBusca[]>([]);
  useEffect(() => {
    if (t.trim().length < 2) {
      setR([]);
      return;
    }
    const id = window.setTimeout(async () => setR(await buscarItens(t, 15)), 250);
    return () => window.clearTimeout(id);
  }, [t]);
  return (
    <>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Nome, cor, SKU ou codigo" type="search" autoFocus />
      <div style={{ marginTop: 10 }}>
        {r.map((x) => (
          <div key={x.variacao_id} style={{ padding: "10px 2px", borderBottom: "1px solid var(--color-creme-200)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{x.produto}</span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{moeda(x.preco_venda)}</strong>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-creme-600)" }}>
              {x.sku} {x.cor_codigo ? `• Cor ${x.cor_codigo}` : ""}{" "}
              {x.comprimento ? `• ${x.comprimento}${x.comprimento_unidade}` : ""} • estoque {x.disponivel}
              {x.localizacao ? ` • ${[x.localizacao, x.corredor, x.prateleira, x.posicao].filter(Boolean).join(" ")}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ==================================================================== */
/* Cupom (recibo)                                                       */
/* ==================================================================== */

export function CupomConteudo({ venda }: { venda: any }) {
  if (!venda) return null;
  const largura = venda.larguraCupom || "80mm";
  return (
    <div className="cupom" style={{ width: largura === "a4" ? "100%" : largura }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{venda.empresa}</div>
        <div style={{ fontSize: 11 }}>{venda.slogan}</div>
        {venda.cnpj ? <div style={{ fontSize: 10.5 }}>CNPJ {venda.cnpj}</div> : null}
        <div style={{ fontSize: 10.5 }}>{venda.endereco}</div>
        <div style={{ fontSize: 10.5 }}>{venda.telefone}</div>
      </div>
      <div className="cupom-linha" />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>Venda {venda.numero}</span>
        <span>{venda.data}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>Operador: {venda.operador}</span>
        <span>Vendedor: {venda.vendedor}</span>
      </div>
      {venda.cliente ? <div style={{ fontSize: 11 }}>Cliente: {venda.cliente}</div> : null}
      <div className="cupom-linha" />
      <table style={{ width: "100%", fontSize: 11 }}>
        <tbody>
          {venda.itens?.map((it: any, i: number) => (
            <tr key={i}>
              <td style={{ verticalAlign: "top", paddingBottom: 4 }}>
                <div>{it.descricao}</div>
                <div style={{ fontSize: 10.5 }}>
                  {it.quantidade} x {moeda(it.preco_unitario)}
                  {it.desconto_valor > 0 ? ` (-${moeda(it.desconto_valor)})` : ""}
                </div>
              </td>
              <td style={{ textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>{moeda(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cupom-linha" />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span>Subtotal</span>
        <span>{moeda(venda.subtotal)}</span>
      </div>
      {venda.desconto_valor > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>Desconto</span>
          <span>- {moeda(venda.desconto_valor)}</span>
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 4 }}>
        <span>TOTAL</span>
        <span>{moeda(venda.total)}</span>
      </div>
      <div className="cupom-linha" />
      {venda.pagamentos?.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>
            {p.forma}
            {p.parcelas > 1 ? ` ${p.parcelas}x de ${moeda(p.valor / p.parcelas)}` : ""}
          </span>
          <span>{moeda(p.valor)}</span>
        </div>
      ))}
      {venda.troco > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>Troco</span>
          <span>{moeda(venda.troco)}</span>
        </div>
      ) : null}
      <div className="cupom-linha" />
      <div style={{ textAlign: "center", fontSize: 10.5, marginTop: 8 }}>
        <div>{venda.mensagem}</div>
        <div style={{ marginTop: 6 }}>
          {venda.itens?.length} itens • {venda.pecas} pecas
        </div>
        <div style={{ marginTop: 6, letterSpacing: "0.2em" }}>{venda.codigoBarrasTexto}</div>
        <div style={{ marginTop: 4 }}>*** {venda.numero} ***</div>
      </div>
    </div>
  );
}
