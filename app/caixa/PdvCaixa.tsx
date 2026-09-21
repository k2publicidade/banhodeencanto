"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  formas: { id: number; nome: string; tipo: string; aceita_troco: number }[];
  vendedores: { id: number; nome: string; apelido: string | null }[];
  config: Record<string, string>;
  resumoCaixa: { dinheiro: number; esperadoDinheiro: number; totalGeral: number; qtd: number; sangrias: number; suprimentos: number; abertura: number };
  resumoDia: { vendas: number; total: number; pecas: number };
};

export default function PdvCaixa({ usuario, caixa, formas, vendedores, config, resumoCaixa, resumoDia }: Props) {
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

  const [modal, setModal] = useState<null | "pagamento" | "caixa" | "movimento" | "fechar" | "consulta">(null);
  const [pagamentos, setPagamentos] = useState<{ forma_id: number; valor: number; parcelas: number; recebido: number }[]>([]);
  const [senhaSup, setSenhaSup] = useState("");
  const [cupom, setCupom] = useState<any | null>(null);
  const [processando, setProcessando] = useState(false);

  const refCodigo = useRef<HTMLInputElement>(null);
  const refBusca = useRef<HTMLInputElement>(null);
  const refAviso = useRef<number | null>(null);

  const avisar = useCallback((tipo: "ok" | "erro" | "info", texto: string) => {
    setAviso({ tipo, texto });
    if (refAviso.current) window.clearTimeout(refAviso.current);
    refAviso.current = window.setTimeout(() => setAviso(null), 4200);
  }, []);

  /* -------------------- totais -------------------- */
  const subtotal = useMemo(() => arred(linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade - l.desconto_valor, 0)), [linhas]);
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
        const r = await buscarItens(termo);
        if (vivo) setResultados(r);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 220);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [termo]);

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
            preco_unitario: arred(Number((it as any).preco_promocional) > 0 && Number((it as any).preco_promocional) < Number((it as any).preco_venda ?? (it as any).preco_unitario)
              ? Number((it as any).preco_promocional)
              : Number((it as any).preco_venda ?? (it as any).preco_unitario)),
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
      const it = await buscarPorCodigo(c);
      if (it) {
        adicionar(it);
        avisar("ok", `+ ${it.produto} ${it.cor_codigo ?? ""} ${it.comprimento ?? ""}`);
      } else {
        const r = await buscarItens(c, 8);
        if (r.length === 1) {
          adicionar(r[0]);
          avisar("ok", `+ ${r[0].produto}`);
        } else if (r.length > 1) {
          setTermo(c);
          setResultados(r);
          avisar("info", `${r.length} itens encontrados - escolha um.`);
        } else {
          avisar("erro", `Codigo "${c}" nao encontrado.`);
        }
      }
      setCodigo("");
    },
    [codigo, adicionar, avisar]
  );

  const alterarQtd = (id: number, delta: number) =>
    setLinhas((a) => a.flatMap((l) => (l.variacao_id === id ? (l.quantidade + delta <= 0 ? [] : [{ ...l, quantidade: l.quantidade + delta }]) : [l])));

  const remover = (id: number) => setLinhas((a) => a.filter((l) => l.variacao_id !== id));
  const limpar = () => {
    if (linhas.length && !window.confirm("Descartar a venda em andamento?")) return;
    setLinhas([]);
    setDescPct(0);
    setDescValor(0);
    setAcrescimo(0);
    setClienteId(null);
    setClienteNome("Cliente Balcao");
    refCodigo.current?.focus();
  };

  /* -------------------- atalhos de teclado -------------------- */
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
            else setLinhas((a) => a.map((l, i) => (i === a.length - 1 ? { ...l, quantidade: n } : l)));
          }
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        refBusca.current?.focus();
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
      <div style={{ minHeight: "100vh", background: "#f2eee6", padding: 24 }}>
        <div className="nao-imprimir" style={{ maxWidth: 420, margin: "0 auto 14px", display: "flex", gap: 8 }}>
          <button className="btn btn-primario" style={{ flex: 1 }} onClick={() => window.print()}>
            Imprimir cupom
          </button>
          <button className="btn btn-neutro" style={{ flex: 1 }} onClick={() => { setCupom(null); refCodigo.current?.focus(); }}>
            Nova venda (F8)
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
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f2eee6" }}>
      {/* ---------- topo ---------- */}
      <header
        style={{
          background: "linear-gradient(180deg,#00303c,#001a22)",
          color: "#fff",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: "2px solid #c8913a",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="" style={{ height: 40, width: "auto" }} />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 17, letterSpacing: "0.02em" }}>
            Banho de Encanto <span style={{ color: "#d9a44c", fontSize: 13 }}>PDV</span>
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}>
            {caixa ? `${caixa.terminal || "CAIXA"} • aberto` : "CAIXA FECHADO"} • {usuario.nome}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {caixa ? (
          <>
            <Indicador rotulo="Dinheiro em caixa" valor={moeda(resumoCaixa.esperadoDinheiro)} cor="#d9a44c" />
            <Indicador rotulo="Vendas do caixa" valor={moeda(resumoCaixa.totalGeral)} cor="#6fcdd9" />
          </>
        ) : (
          <span className="tag tag-vermelho piscar" style={{ fontSize: 12 }}>CAIXA FECHADO</span>
        )}
        <Indicador rotulo="Vendas hoje" valor={`${resumoDia.vendas} • ${moeda(resumoDia.total)}`} cor="#fff" />

        <button className="btn btn-sm btn-neutro" onClick={() => setModal("consulta")}>
          Consulta preco (F1)
        </button>
        {caixa ? (
          <>
            <button className="btn btn-sm btn-neutro" onClick={() => setModal("movimento")}>Sangria / Suprimento</button>
            <button className="btn btn-sm btn-neutro" onClick={() => setModal("fechar")}>Fechar caixa</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ouro" onClick={() => setModal("caixa")}>Abrir caixa</button>
        )}
        <a className="btn btn-sm btn-neutro" href="/painel">Painel</a>
      </header>

      {/* ---------- aviso ---------- */}
      {aviso ? (
        <div
          className={"aparecer"}
          style={{
            padding: "8px 16px",
            fontSize: 13.5,
            fontWeight: 600,
            background: aviso.tipo === "erro" ? "#fdeaea" : aviso.tipo === "ok" ? "#e6f5ed" : "#fdf3e0",
            color: aviso.tipo === "erro" ? "#9c2b2b" : aviso.tipo === "ok" ? "#166b46" : "#8a5a12",
            borderBottom: "1px solid rgba(0,0,0,0.07)",
          }}
        >
          {aviso.texto}
        </div>
      ) : null}

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 392px", minHeight: 0 }}>
        {/* ================= COLUNA ESQUERDA ================= */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 14, gap: 12 }}>
          {/* leitor de codigo de barras */}
          <form onSubmit={aoBipar} className="card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="bip">Codigo de barras / SKU / codigo interno</label>
              <input
                id="bip"
                ref={refCodigo}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Bipe o produto ou digite o codigo e tecle Enter"
                autoComplete="off"
                autoFocus
                style={{ fontSize: 16, padding: "11px 13px", fontWeight: 600 }}
              />
            </div>
            <button type="submit" className="btn btn-primario btn-lg">Adicionar</button>
          </form>

          {/* busca por nome */}
          <div className="card" style={{ padding: 12 }}>
            <label htmlFor="busca">Busca por nome, cor, marca ou referencia (F3)</label>
            <input
              id="busca"
              ref={refBusca}
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Ex: jumbo 1B 60, crochet cacheado, mega hair..."
              autoComplete="off"
            />
            {buscando ? <div style={{ fontSize: 12, color: "#7d7466", marginTop: 6 }}>Buscando...</div> : null}
            {resultados.length > 0 ? (
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto", border: "1px solid #e7e1d6", borderRadius: 9 }}>
                {resultados.map((r) => (
                  <button
                    key={r.variacao_id}
                    onClick={() => adicionar(r)}
                    style={{
                      display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 11px",
                      background: "none", border: "none", borderBottom: "1px solid #f2eee6", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    {r.cor_hex ? <span style={{ width: 13, height: 13, borderRadius: 4, background: r.cor_hex, border: "1px solid #d5ccba", flexShrink: 0 }} /> : null}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.produto}</span>
                      <span style={{ color: "#7d7466", fontSize: 12.5 }}>
                        {" "}{r.cor_codigo ? `• ${r.cor_codigo}` : ""} {r.comprimento ? `• ${r.comprimento}${r.comprimento_unidade}` : ""} {r.marca ? `• ${r.marca}` : ""}
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "#7d7466" }}>{r.sku}</span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span style={{ display: "block", fontWeight: 700 }}>{moeda(r.preco_promocional && r.preco_promocional < r.preco_venda ? r.preco_promocional : r.preco_venda)}</span>
                      <span className={"tag " + (r.disponivel <= 0 ? "tag-vermelho" : r.disponivel <= 5 ? "tag-amarelo" : "tag-verde")} style={{ fontSize: 10.5 }}>
                        {r.disponivel} em estoque
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* carrinho */}
          <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e7e1d6", display: "flex", alignItems: "center", gap: 10 }}>
              <strong style={{ fontFamily: "Georgia, serif", fontSize: 16 }}>Itens da venda</strong>
              <span className="tag tag-azul">{linhas.length} itens • {pecas} pecas</span>
              <div style={{ flex: 1 }} />
              {linhas.length ? <button className="btn btn-sm btn-perigo" onClick={limpar}>Cancelar venda (F8)</button> : null}
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {linhas.length === 0 ? (
                <div style={{ padding: 46, textAlign: "center", color: "#7d7466" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-mark.png" alt="" style={{ height: 76, opacity: 0.25 }} />
                  <div style={{ marginTop: 12, fontSize: 14 }}>
                    Bipe um produto ou busque pelo nome para comecar a venda
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5 }}>
                    Atalhos: F2 quantidade • F3 buscar • F4 desconto • F8 cancelar • F9 finalizar
                  </div>
                </div>
              ) : (
                <table className="tabela-sistema">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      <th>Produto</th>
                      <th style={{ width: 118 }} className="num">Unitario</th>
                      <th style={{ width: 128 }} className="num">Qtd</th>
                      <th style={{ width: 104 }} className="num">Desconto</th>
                      <th style={{ width: 104 }} className="num">Total</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, idx) => (
                      <tr key={l.variacao_id}>
                        <td style={{ color: "#7d7466" }}>{idx + 1}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {l.cor_hex ? <span style={{ width: 12, height: 12, borderRadius: 3, background: l.cor_hex, border: "1px solid #d5ccba" }} /> : null}
                            <strong>{l.nome}</strong>
                          </div>
                          <div style={{ fontSize: 11.5, color: "#7d7466" }}>
                            {l.sku} {l.cor_codigo ? `• Cor ${l.cor_codigo}` : ""} {l.comprimento ? `• ${l.comprimento}` : ""}
                            {l.local ? ` • ${l.local}` : ""}
                          </div>
                        </td>
                        <td className="num">
                          <input
                            value={String(l.preco_unitario).replace(".", ",")}
                            onChange={(e) => {
                              const v = parseMoeda(e.target.value);
                              setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, preco_unitario: v } : x)));
                            }}
                            style={{ textAlign: "right", padding: "5px 7px", width: 100 }}
                          />
                        </td>
                        <td className="num">
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <button className="btn btn-sm btn-neutro" onClick={() => alterarQtd(l.variacao_id, -1)}>−</button>
                            <input
                              value={l.quantidade}
                              onChange={(e) => {
                                const v = Math.max(1, Math.round(Number(e.target.value) || 1));
                                setLinhas((a) => a.map((x) => (x.variacao_id === l.variacao_id ? { ...x, quantidade: v } : x)));
                              }}
                              style={{ width: 52, textAlign: "center", padding: "5px 4px" }}
                            />
                            <button className="btn btn-sm btn-neutro" onClick={() => alterarQtd(l.variacao_id, +1)}>+</button>
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
                            style={{ textAlign: "right", padding: "5px 7px", width: 88 }}
                          />
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {moeda(l.preco_unitario * l.quantidade - l.desconto_valor)}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-perigo" title="Remover" onClick={() => remover(l.variacao_id)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* ================= COLUNA DIREITA ================= */}
        <aside style={{ background: "#fff", borderLeft: "1px solid #e7e1d6", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 14, borderBottom: "1px solid #e7e1d6" }}>
            <label>Cliente</label>
            {clienteId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tag tag-azul" style={{ fontSize: 12.5, padding: "5px 10px" }}>{clienteNome}</span>
                <button className="btn btn-sm btn-neutro" onClick={() => { setClienteId(null); setClienteNome("Cliente Balcao"); }}>Trocar</button>
              </div>
            ) : (
              <>
                <input
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                  placeholder="Buscar por nome, CPF ou telefone"
                />
                {listaClientes.length > 0 ? (
                  <div style={{ marginTop: 6, border: "1px solid #e7e1d6", borderRadius: 9, overflow: "hidden" }}>
                    <button
                      className="btn btn-sm btn-neutro"
                      style={{ width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid #f2eee6" }}
                      onClick={() => { setClienteId(null); setClienteNome("Cliente Balcao"); setBuscaCliente(""); setListaClientes([]); }}
                    >
                      Cliente Balcao (sem cadastro)
                    </button>
                    {listaClientes.map((c) => (
                      <button
                        key={c.id}
                        className="btn btn-sm btn-neutro"
                        style={{ width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid #f2eee6", justifyContent: "space-between" }}
                        onClick={() => { setClienteId(c.id); setClienteNome(c.nome); setBuscaCliente(""); setListaClientes([]); }}
                      >
                        <span>{c.nome}</span>
                        <span style={{ fontSize: 11, color: c.saldo_fiado > 0 ? "#9c2b2b" : "#7d7466" }}>
                          {c.saldo_fiado > 0 ? `fiado ${moeda(c.saldo_fiado)}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            <div style={{ marginTop: 12 }}>
              <label htmlFor="vendedor">Vendedor</label>
              <select id="vendedor" value={vendedorId} onChange={(e) => setVendedorId(Number(e.target.value))}>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>{v.apelido || v.nome}</option>
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
                marginTop: 12, padding: "14px 16px", borderRadius: 12,
                background: "linear-gradient(180deg,#00303c,#001a22)", color: "#fff",
              }}
            >
              <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>
                Total a pagar
              </div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 38, color: "#e8c77c", lineHeight: 1.15 }}>
                {moeda(total)}
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.65)" }}>{pecas} pecas • {linhas.length} itens</div>
            </div>
          </div>

          <div style={{ padding: 14, borderTop: "1px solid #e7e1d6", display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-sucesso btn-lg" style={{ width: "100%" }} disabled={!linhas.length} onClick={abrirPagamento}>
              Finalizar venda (F9)
            </button>
            <button className="btn btn-neutro btn-sm" style={{ width: "100%" }} onClick={limpar}>Limpar</button>
          </div>
        </aside>
      </div>

      {/* ================= MODAIS ================= */}
      {modal === "pagamento" ? (
        <ModalPagamento
          total={total}
          pagamentos={pagamentos}
          setPagamentos={setPagamentos}
          formas={formas}
          troco={troco}
          totalPago={totalPago}
          senhaSup={senhaSup}
          setSenhaSup={setSenhaSup}
          limiteDesconto={Number(config.cupom_desconto_max_pct || 20)}
          pctDesconto={subtotalBruto > 0 ? (descontoTotal / subtotalBruto) * 100 : 0}
          processando={processando}
          onConfirmar={confirmarVenda}
          onFechar={() => setModal(null)}
        />
      ) : null}

      {modal === "caixa" ? (
        <ModalSimples titulo="Abrir caixa" onFechar={() => setModal(null)}>
          <AbrirCaixaForm onOk={() => { setModal(null); avisar("ok", "Caixa aberto."); router.refresh(); }} onErro={(e) => avisar("erro", e)} />
        </ModalSimples>
      ) : null}

      {modal === "movimento" ? (
        <ModalSimples titulo="Sangria / Suprimento" onFechar={() => setModal(null)}>
          <MovimentoCaixaForm
            onOk={(m) => { setModal(null); avisar("ok", m); router.refresh(); }}
            onErro={(e) => avisar("erro", e)}
          />
        </ModalSimples>
      ) : null}

      {modal === "fechar" && caixa ? (
        <ModalSimples titulo="Fechamento de caixa" onFechar={() => setModal(null)}>
          <FecharCaixaForm
            resumo={resumoCaixa}
            onOk={(m) => { setModal(null); avisar("ok", m); router.refresh(); }}
            onErro={(e) => avisar("erro", e)}
          />
        </ModalSimples>
      ) : null}

      {modal === "consulta" ? (
        <ModalConsulta onFechar={() => setModal(null)} />
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
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{rotulo}</div>
      <div style={{ fontWeight: 700, color: cor, fontSize: 14 }}>{valor}</div>
    </div>
  );
}

function LinhaTotais({ rotulo, valor, vermelho }: { rotulo: string; valor: string; vermelho?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
      <span style={{ color: "#7d7466" }}>{rotulo}</span>
      <strong style={{ color: vermelho ? "#9c2b2b" : "#3a352e" }}>{valor}</strong>
    </div>
  );
}

export function ModalSimples({ titulo, children, onFechar }: { titulo: string; children: React.ReactNode; onFechar: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,26,34,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
      onClick={onFechar}
    >
      <div className="card aparecer" style={{ maxWidth: 430, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e7e1d6", display: "flex", alignItems: "center" }}>
          <strong style={{ fontFamily: "Georgia, serif", fontSize: 17 }}>{titulo}</strong>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-neutro" onClick={onFechar}>Fechar</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

function ModalPagamento(props: {
  total: number;
  pagamentos: { forma_id: number; valor: number; parcelas: number; recebido: number }[];
  setPagamentos: (p: any) => void;
  formas: { id: number; nome: string; tipo: string; aceita_troco: number }[];
  troco: number;
  totalPago: number;
  senhaSup: string;
  setSenhaSup: (s: string) => void;
  limiteDesconto: number;
  pctDesconto: number;
  processando: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const { total, pagamentos, setPagamentos, formas, troco, totalPago, senhaSup, setSenhaSup, limiteDesconto, pctDesconto, processando, onConfirmar, onFechar } = props;
  const falta = arred(total - totalPago);
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,26,34,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div className="card aparecer" style={{ maxWidth: 620, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e7e1d6", background: "linear-gradient(180deg,#00303c,#001a22)", color: "#fff" }}>
          <div style={{ fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.65 }}>Total da venda</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 40, color: "#e8c77c" }}>{moeda(total)}</div>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {pagamentos.map((p, i) => {
            const forma = formas.find((f) => f.id === p.forma_id);
            return (
              <div key={i} style={{ border: "1px solid #e7e1d6", borderRadius: 11, padding: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1.4 }}>
                    <label>Forma de pagamento</label>
                    <select value={p.forma_id} onChange={(e) => atualizar(i, "forma_id", Number(e.target.value))}>
                      {formas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Valor</label>
                    <input
                      value={String(p.valor).replace(".", ",")}
                      onChange={(e) => atualizar(i, "valor", parseMoeda(e.target.value))}
                      style={{ textAlign: "right" }}
                    />
                  </div>
                  {forma?.tipo === "credito" ? (
                    <div style={{ width: 96 }}>
                      <label>Parcelas</label>
                      <select value={p.parcelas} onChange={(e) => atualizar(i, "parcelas", Number(e.target.value))}>
                        {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
                      </select>
                    </div>
                  ) : null}
                  {pagamentos.length > 1 ? (
                    <button className="btn btn-sm btn-perigo" onClick={() => setPagamentos(pagamentos.filter((_, j) => j !== i))}>×</button>
                  ) : null}
                </div>

                {forma?.tipo === "dinheiro" ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label>Valor recebido do cliente</label>
                      <input
                        value={p.recebido ? String(p.recebido).replace(".", ",") : ""}
                        placeholder="0,00"
                        onChange={(e) => atualizar(i, "recebido", parseMoeda(e.target.value))}
                        style={{ textAlign: "right" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {[p.valor, 20, 50, 100, 200].filter((v, idx, a) => v > 0 && a.indexOf(v) === idx).map((v) => (
                        <button key={v} className="btn btn-sm btn-neutro" onClick={() => atualizar(i, "recebido", v)}>
                          {v === p.valor ? "Exato" : moeda(v)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          <button
            className="btn btn-neutro btn-sm"
            onClick={() => setPagamentos([...pagamentos, { forma_id: formas[0]?.id, valor: Math.max(0, falta), parcelas: 1, recebido: 0 }])}
          >
            + Adicionar outra forma (pagamento dividido)
          </button>

          <div style={{ background: "#faf8f4", border: "1px solid #e7e1d6", borderRadius: 11, padding: 12 }}>
            <LinhaTotais rotulo="Total pago" valor={moeda(totalPago)} />
            <LinhaTotais rotulo={falta > 0 ? "Falta" : "Troco"} valor={moeda(Math.abs(falta))} vermelho={falta > 0.01} />
          </div>

          {excedeLimite ? (
            <div style={{ background: "#fdf3e0", border: "1px solid #e8c77c", borderRadius: 11, padding: 12 }}>
              <strong style={{ fontSize: 13, color: "#8a5a12" }}>
                Desconto de {pctDesconto.toFixed(1)}% acima do limite de {limiteDesconto}%
              </strong>
              <p style={{ fontSize: 12.5, margin: "6px 0 8px", color: "#7d7466" }}>
                Informe o PIN ou a senha de um gerente/administrador para autorizar.
              </p>
              <input
                type="password"
                value={senhaSup}
                onChange={(e) => setSenhaSup(e.target.value)}
                placeholder="PIN ou senha do supervisor"
              />
              {sup === "checando" ? (
                <div style={{ fontSize: 12, color: "#7d7466", marginTop: 6 }}>Conferindo...</div>
              ) : null}
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

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-neutro" onClick={onFechar} style={{ flex: 0.6 }}>Voltar</button>
            <button
              className="btn btn-sucesso btn-lg"
              style={{ flex: 2 }}
              disabled={processando || falta > 0.01 || (excedeLimite && sup !== "ok")}
              onClick={onConfirmar}
            >
              {processando ? "Processando..." : "Confirmar venda"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AbrirCaixaForm({ onOk, onErro }: { onOk: () => void; onErro: (e: string) => void }) {
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        const r = await abrirCaixa(parseMoeda(valor));
        setEnviando(false);
        if (!r.ok) onErro(r.erro || "Falha ao abrir caixa.");
        else onOk();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <p style={{ fontSize: 13, color: "#7d7466", margin: 0 }}>
        Informe o valor em dinheiro que esta sendo colocado na gaveta (fundo de troco).
      </p>
      <div>
        <label>Valor de abertura</label>
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="200,00" style={{ textAlign: "right", fontSize: 18 }} autoFocus />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>{enviando ? "Abrindo..." : "Abrir caixa"}</button>
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
        else onOk(tipo === "sangria" ? "Sangria registrada." : tipo === "suprimento" ? "Suprimento registrado." : "Despesa registrada.");
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div>
        <label>Tipo de movimento</label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
          <option value="sangria">Sangria (retirar dinheiro da gaveta)</option>
          <option value="suprimento">Suprimento (colocar dinheiro na gaveta)</option>
          <option value="despesa">Despesa (pagamento com dinheiro do caixa)</option>
        </select>
      </div>
      <div>
        <label>Valor</label>
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" style={{ textAlign: "right", fontSize: 18 }} autoFocus />
      </div>
      <div>
        <label>Observacao</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex: retirada para cofre" />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>{enviando ? "Salvando..." : "Registrar"}</button>
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
      <div style={{ background: "#faf8f4", border: "1px solid #e7e1d6", borderRadius: 11, padding: 12 }}>
        <LinhaTotais rotulo="Fundo de troco" valor={moeda(resumo?.abertura ?? 0)} />
        <LinhaTotais rotulo="Vendas em dinheiro" valor={moeda(resumo?.dinheiro ?? 0)} />
        <LinhaTotais rotulo="Suprimentos" valor={moeda(resumo?.suprimentos ?? 0)} />
        <LinhaTotais rotulo="Sangrias" valor={"- " + moeda(resumo?.sangrias ?? 0)} vermelho />
        <div style={{ borderTop: "1px solid #e7e1d6", marginTop: 8, paddingTop: 8 }}>
          <LinhaTotais rotulo="Esperado na gaveta" valor={moeda(resumo?.esperadoDinheiro ?? 0)} />
        </div>
      </div>
      <div>
        <label>Valor contado na gaveta</label>
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" style={{ textAlign: "right", fontSize: 18 }} autoFocus />
      </div>
      {valor ? (
        <div className={"tag " + (Math.abs(diferenca) < 0.01 ? "tag-verde" : "tag-vermelho")} style={{ display: "block", padding: 10, borderRadius: 9, fontSize: 13.5 }}>
          Diferenca: <strong>{moeda(diferenca)}</strong> {Math.abs(diferenca) < 0.01 ? "(bateu)" : diferenca > 0 ? "(sobra)" : "(falta)"}
        </div>
      ) : null}
      <div>
        <label>Observacoes do fechamento</label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
      </div>
      <button className="btn btn-primario btn-lg" disabled={enviando}>{enviando ? "Fechando..." : "Fechar caixa"}</button>
    </form>
  );
}

function ModalConsulta({ onFechar }: { onFechar: () => void }) {
  const [t, setT] = useState("");
  const [r, setR] = useState<ItemBusca[]>([]);
  useEffect(() => {
    if (t.trim().length < 2) { setR([]); return; }
    const id = window.setTimeout(async () => setR(await buscarItens(t, 15)), 250);
    return () => window.clearTimeout(id);
  }, [t]);
  return (
    <ModalSimples titulo="Consulta de preco e estoque" onFechar={onFechar}>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Nome, cor, SKU ou codigo" autoFocus />
      <div style={{ marginTop: 10, maxHeight: 340, overflowY: "auto" }}>
        {r.map((x) => (
          <div key={x.variacao_id} style={{ padding: "8px 2px", borderBottom: "1px solid #f2eee6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{x.produto}</span>
              <strong>{moeda(x.preco_venda)}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#7d7466" }}>
              {x.sku} {x.cor_codigo ? `• Cor ${x.cor_codigo}` : ""} {x.comprimento ? `• ${x.comprimento}${x.comprimento_unidade}` : ""} • estoque {x.disponivel}
              {x.localizacao ? ` • ${[x.localizacao, x.corredor, x.prateleira, x.posicao].filter(Boolean).join(" ")}` : ""}
            </div>
          </div>
        ))}
      </div>
    </ModalSimples>
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
        <span>Subtotal</span><span>{moeda(venda.subtotal)}</span>
      </div>
      {venda.desconto_valor > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>Desconto</span><span>- {moeda(venda.desconto_valor)}</span>
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 4 }}>
        <span>TOTAL</span><span>{moeda(venda.total)}</span>
      </div>
      <div className="cupom-linha" />
      {venda.pagamentos?.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>{p.forma}{p.parcelas > 1 ? ` ${p.parcelas}x de ${moeda(p.valor / p.parcelas)}` : ""}</span>
          <span>{moeda(p.valor)}</span>
        </div>
      ))}
      {venda.troco > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span>Troco</span><span>{moeda(venda.troco)}</span>
        </div>
      ) : null}
      <div className="cupom-linha" />
      <div style={{ textAlign: "center", fontSize: 10.5, marginTop: 8 }}>
        <div>{venda.mensagem}</div>
        <div style={{ marginTop: 6 }}>{venda.itens?.length} itens • {venda.pecas} pecas</div>
        <div style={{ marginTop: 6, letterSpacing: "0.2em" }}>{venda.codigoBarrasTexto}</div>
        <div style={{ marginTop: 4 }}>*** {venda.numero} ***</div>
      </div>
    </div>
  );
}
