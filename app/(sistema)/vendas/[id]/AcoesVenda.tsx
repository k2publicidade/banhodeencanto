"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelarVenda, registrarDevolucao } from "@/app/actions/pdv";
import { num } from "@/lib/format";
import { Secao, Tabela } from "@/components/ui";

/**
 * Acoes da venda (devolucao e cancelamento) no cliente.
 *
 * Chamam as server actions cancelarVenda/registrarDevolucao direto, sem
 * redirect: o operador ve a resposta na propria tela e a pagina e recarregada
 * via router.refresh() somente quando a operacao e aceita.
 */

export type ItemDevolvivel = {
  id: number;
  descricao: string;
  quantidade: number;
  devolvido: number;
  disponivel_devolver: number;
};

type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

function Mensagem({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  const ok = aviso.tipo === "ok";
  return (
    <div
      style={{
        marginTop: 12,
        padding: "9px 12px",
        borderRadius: 10,
        fontSize: 13,
        background: ok ? "#e6f5ed" : "#fdeaea",
        border: "1px solid " + (ok ? "#9ed3b8" : "#e2a9a9"),
        color: ok ? "#166b46" : "#9c2b2b",
      }}
    >
      {aviso.texto}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Devolucao / troca                                                   */
/* ------------------------------------------------------------------ */

export function PainelDevolucao({ vendaId, itens }: { vendaId: number; itens: ItemDevolvivel[] }) {
  const router = useRouter();
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const [destino, setDestino] = useState<Record<number, "estoque" | "perda">>({});
  const [motivo, setMotivo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const linhas = useMemo(
    () =>
      itens
        .map((i) => ({
          venda_item_id: i.id,
          quantidade: Number(String(qtd[i.id] ?? "").replace(",", ".")) || 0,
          destino: destino[i.id] ?? ("estoque" as const),
        }))
        .filter((l) => l.quantidade > 0),
    [itens, qtd, destino]
  );

  const totalPecas = linhas.reduce((s, l) => s + l.quantidade, 0);

  async function enviar() {
    setAviso(null);
    if (linhas.length === 0) {
      setAviso({ tipo: "erro", texto: "Informe a quantidade devolvida de ao menos um item." });
      return;
    }
    const acima = itens.find((i) => {
      const pedida = linhas.find((l) => l.venda_item_id === i.id)?.quantidade ?? 0;
      return pedida > i.disponivel_devolver;
    });
    if (acima) {
      setAviso({
        tipo: "erro",
        texto: `"${acima.descricao}": pode devolver no maximo ${num(acima.disponivel_devolver)} peca(s).`,
      });
      return;
    }

    setProcessando(true);
    try {
      const r = await registrarDevolucao(vendaId, linhas, motivo);
      if (!r.ok) {
        setAviso({ tipo: "erro", texto: r.erro || "Falha ao registrar devolucao." });
        return;
      }
      setQtd({});
      setMotivo("");
      setAviso({
        tipo: "ok",
        texto: `Devolucao registrada (${totalPecas} peca(s)). O estoque ja foi atualizado.`,
      });
      router.refresh();
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Secao
      titulo="Registrar devolucao / troca"
      descricao="Informe a quantidade devolvida de cada item e se a mercadoria volta ao estoque ou vira perda"
    >
      <Tabela>
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Vendido</th>
            <th className="num">Ja devolvido</th>
            <th className="num">Pode devolver</th>
            <th style={{ width: 130 }} className="num">Qtd a devolver</th>
            <th style={{ width: 190 }}>Destino</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>{i.descricao}</td>
              <td className="num">{num(i.quantidade)}</td>
              <td className="num">{num(i.devolvido)}</td>
              <td className="num">
                <strong>{num(i.disponivel_devolver)}</strong>
              </td>
              <td className="num">
                <input
                  value={qtd[i.id] ?? ""}
                  placeholder="0"
                  disabled={i.disponivel_devolver <= 0}
                  onChange={(e) => setQtd({ ...qtd, [i.id]: e.target.value })}
                  style={{ textAlign: "right" }}
                />
              </td>
              <td>
                <select
                  value={destino[i.id] ?? "estoque"}
                  disabled={i.disponivel_devolver <= 0}
                  onChange={(e) => setDestino({ ...destino, [i.id]: e.target.value === "perda" ? "perda" : "estoque" })}
                >
                  <option value="estoque">Voltar ao estoque</option>
                  <option value="perda">Perda / descarte</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </Tabela>

      <div style={{ marginTop: 12 }}>
        <label htmlFor="motivo_devolucao">Motivo da devolucao</label>
        <input
          id="motivo_devolucao"
          value={motivo}
          placeholder="Ex: cor errada, defeito, cliente desistiu"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primario" onClick={enviar} disabled={processando || totalPecas === 0}>
          {processando ? "Registrando..." : `Registrar devolucao${totalPecas ? ` (${totalPecas})` : ""}`}
        </button>
      </div>

      <Mensagem aviso={aviso} />
    </Secao>
  );
}

/* ------------------------------------------------------------------ */
/* Cancelamento                                                        */
/* ------------------------------------------------------------------ */

export function PainelCancelamento({ vendaId, numero }: { vendaId: number; numero: string }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  async function enviar() {
    setAviso(null);
    if (!motivo.trim()) {
      setAviso({ tipo: "erro", texto: "Informe o motivo do cancelamento." });
      return;
    }
    if (!window.confirm(`Cancelar a venda ${numero}? O estoque volta, o caixa e estornado e o fiado e cancelado.`)) return;

    setProcessando(true);
    try {
      const r = await cancelarVenda(vendaId, motivo.trim());
      if (!r.ok) {
        setAviso({ tipo: "erro", texto: r.erro || "Falha ao cancelar a venda." });
        return;
      }
      setMotivo("");
      setAviso({ tipo: "ok", texto: "Venda cancelada. Estoque devolvido e caixa estornado." });
      router.refresh();
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Secao titulo="Cancelar venda" descricao="Devolve todos os itens ao estoque, estorna o caixa e cancela o fiado">
      <div className="grade-form" style={{ gap: 12 }}>
        <div>
          <label htmlFor="motivo_cancelamento">Motivo do cancelamento</label>
          <input
            id="motivo_cancelamento"
            value={motivo}
            placeholder="Ex: erro de operacao, cliente desistiu na hora"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <button className="btn btn-perigo" onClick={enviar} disabled={processando}>
          {processando ? "Cancelando..." : "Cancelar esta venda"}
        </button>
      </div>
      <Mensagem aviso={aviso} />
    </Secao>
  );
}
