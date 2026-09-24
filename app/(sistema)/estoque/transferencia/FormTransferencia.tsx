"use client";

import { useEffect, useState } from "react";
import { acaoCriarTransferencia, saldosDoItem } from "@/app/actions/estoque";
import { Campo, Linha } from "@/components/ui";

type EstoqueOpcao = { loja_id: number; nome: string; eh_deposito: number; padrao: number; pecas: number };
type OpcaoSku = { id: number; texto: string };
type Saldo = { loja_id: number; loja: string; eh_deposito: number; quantidade: number; disponivel: number };
type LinhaItem = { chave: number; variacao_id: string; quantidade: string; saldos: Saldo[] | null; carregando: boolean };

let proximaChave = 1;

export default function FormTransferencia({
  estoques,
  skus,
  origemInicial,
  destinoInicial,
  itemInicial,
}: {
  estoques: EstoqueOpcao[];
  skus: OpcaoSku[];
  origemInicial: number;
  destinoInicial: number;
  itemInicial?: number;
}) {
  const [origem, setOrigem] = useState(String(origemInicial || ""));
  const [destino, setDestino] = useState(String(destinoInicial || ""));
  const [linhas, setLinhas] = useState<LinhaItem[]>([
    { chave: proximaChave++, variacao_id: itemInicial ? String(itemInicial) : "", quantidade: "", saldos: null, carregando: false },
  ]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregouInicial, setCarregouInicial] = useState(false);

  // Item que chegou pela tela de estoque ("Transferir" na linha do SKU):
  // busca os saldos assim que a tela abre.
  useEffect(() => {
    if (carregouInicial || !itemInicial) return;
    setCarregouInicial(true);
    carregarSaldos(linhas[0].chave, String(itemInicial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregouInicial, itemInicial]);

  const nomeDe = (id: number | string) => estoques.find((e) => e.loja_id === Number(id))?.nome ?? "—";

  async function carregarSaldos(chave: number, variacaoId: string) {
    if (!variacaoId) {
      setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, saldos: null } : l)));
      return;
    }
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, carregando: true } : l)));
    try {
      const saldos = (await saldosDoItem(Number(variacaoId))) as Saldo[];
      setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, saldos, carregando: false } : l)));
    } catch {
      setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, carregando: false } : l)));
    }
  }

  function adicionar() {
    setLinhas((ls) => [...ls, { chave: proximaChave++, variacao_id: "", quantidade: "", saldos: null, carregando: false }]);
  }

  function remover(chave: number) {
    setLinhas((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.chave !== chave)));
  }

  const totalPecas = linhas.reduce((s, l) => s + (Number(l.quantidade.replace(",", ".")) || 0), 0);
  const problema = (l: LinhaItem) => {
    const q = Number(l.quantidade.replace(",", ".")) || 0;
    if (!l.saldos || q <= 0) return null;
    const saldo = l.saldos.find((s) => s.loja_id === Number(origem));
    const tem = saldo?.quantidade ?? 0;
    return tem < q ? `No ${nomeDe(origem)} existem ${tem} unidade(s) deste SKU.` : null;
  };

  return (
    <form
      action={acaoCriarTransferencia}
      onSubmit={(e) => {
        if (!origem || !destino) { e.preventDefault(); setErro("Escolha o estoque de origem e o de destino."); return; }
        if (origem === destino) { e.preventDefault(); setErro("Origem e destino precisam ser diferentes."); return; }
        if (!linhas.some((l) => l.variacao_id && Number(l.quantidade.replace(",", ".")) > 0)) {
          e.preventDefault(); setErro("Adicione ao menos um produto com quantidade."); return;
        }
        setErro(null);
      }}
    >
      {erro ? <div className="aviso aviso-erro">{erro}</div> : null}

      <Linha colunas="1fr 1fr">
        <div>
          <label htmlFor="loja_origem">Sai de (origem)</label>
          <select id="loja_origem" name="loja_origem" value={origem} onChange={(e) => setOrigem(e.target.value)} required>
            <option value="">— escolha o estoque —</option>
            {estoques.map((e) => (
              <option key={e.loja_id} value={e.loja_id}>
                {e.nome}{e.eh_deposito ? " (galpao)" : ""} — {e.pecas} pecas
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="loja_destino">Entra em (destino)</label>
          <select id="loja_destino" name="loja_destino" value={destino} onChange={(e) => setDestino(e.target.value)} required>
            <option value="">— escolha o estoque —</option>
            {estoques.map((e) => (
              <option key={e.loja_id} value={e.loja_id}>
                {e.nome}{e.eh_deposito ? " (galpao)" : ""} — {e.pecas} pecas
              </option>
            ))}
          </select>
        </div>
      </Linha>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {linhas.map((l, indice) => {
          const aviso = problema(l);
          return (
            <div key={l.chave} className="card" style={{ padding: 12 }}>
              <Linha colunas="3fr 1fr auto">
                <div>
                  <label htmlFor={`variacao-${l.chave}`}>Produto / SKU {indice + 1}</label>
                  <select
                    id={`variacao-${l.chave}`}
                    name="variacao_id"
                    value={l.variacao_id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, variacao_id: v } : x)));
                      carregarSaldos(l.chave, v);
                    }}
                    required
                  >
                    <option value="">— selecione o SKU —</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>{s.texto}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`quantidade-${l.chave}`}>Quantidade</label>
                  <input
                    id={`quantidade-${l.chave}`}
                    name="quantidade"
                    inputMode="decimal"
                    value={l.quantidade}
                    onChange={(e) => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, quantidade: e.target.value } : x)))}
                    placeholder="10"
                    required
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button type="button" className="btn btn-neutro" onClick={() => remover(l.chave)} disabled={linhas.length === 1}>
                    Remover
                  </button>
                </div>
              </Linha>

              <div style={{ fontSize: 12, marginTop: 8, color: "#7d7466" }}>
                {l.carregando ? "Conferindo saldo..." : null}
                {!l.carregando && l.saldos && l.saldos.length === 0 ? "Este SKU ainda nao tem saldo em nenhum estoque." : null}
                {!l.carregando && l.saldos && l.saldos.length > 0 ? (
                  <>
                    Saldo por estoque:{" "}
                    {l.saldos.map((s) => (
                      <span key={s.loja_id} style={{ marginRight: 10 }}>
                        <strong>{s.loja}</strong> {s.quantidade}
                        {s.loja_id === Number(origem) ? " (origem)" : ""}
                        {s.loja_id === Number(destino) ? " (destino)" : ""}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
              {aviso ? <div className="aviso aviso-erro" style={{ marginTop: 8 }}>{aviso}</div> : null}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-neutro" onClick={adicionar}>+ Adicionar produto</button>
        <div style={{ flex: 1 }} />
        <button type="submit" className="btn btn-primario">
          Transferir {totalPecas > 0 ? `${totalPecas} peca(s)` : ""} para {destino ? nomeDe(destino) : "o destino"}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <Campo
          rotulo="Observacao (opcional)"
          nome="observacoes"
          placeholder="Ex: reposicao da vitrine, pedido da cliente Maria, remessa semanal"
        />
      </div>
    </form>
  );
}
